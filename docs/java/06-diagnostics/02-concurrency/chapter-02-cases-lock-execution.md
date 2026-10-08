# 并发案例：锁与执行模型

> **案例说明：** 本页日期、业务背景、指标和工具输出均为构造或匿名化教学数据；除引用一手资料外，不应视为可核验的真实事件。排查方法与命令仍需结合目标 JDK、系统和生产变更流程验证。

> 本页用四个构造场景覆盖死锁、线程池饱和、可变键导致的并发集合失效，以及虚拟线程 pinning。每个场景先从线程状态和执行轨迹定位问题，再讨论锁顺序、任务队列、对象身份和同步边界。

## 1. 案例 1：对账与下单的死锁 —— 两个团队，两个锁序 {#case-1}

### 1.1 事故背景

这是一个构造的教学场景。示例中，某电商平台的订单服务在连续两天凌晨 2:00 的定时对账任务启动后卡死——接口 RT 从 200ms 暴涨到 20s+，CPU 使用率为 8%，线程数增至 400+。首次重启丢失现场，次日同一时间再次出现时先 dump，再继续排查。

### 1.2 第一步：jstack 取证

```bash
jstack <pid> > thread.dump
```

打开 dump 文件，直接搜 `DEADLOCK`：

```txt
Found one Java-level deadlock:
=============================
"reconciliation-thread-2":
  waiting to lock monitor 0x00007f8c4c00a3b8 (object 0x000000076ab8c5a0, a java.lang.Object),
  which is held by "order-process-thread-15"
"order-process-thread-15":
  waiting to lock monitor 0x00007f8c4c0098a8 (object 0x000000076ab8c5b0, a java.lang.Object),
  which is held by "reconciliation-thread-2"

Java stack information for the threads listed above:
===================================================
"reconciliation-thread-2":
    at com.xxx.order.service.ReconciliationService.reconcileOrder(ReconciliationService.java:88)
    - waiting to lock <0x000000076ab8c5a0> (a java.lang.Object)  ← 等的是 orderLock
    - locked <0x000000076ab8c5b0> (a java.lang.Object)            ← 持的是 stockLock

"order-process-thread-15":
    at com.xxx.order.service.OrderProcessService.createOrder(OrderProcessService.java:156)
    - waiting to lock <0x000000076ab8c5b0> (a java.lang.Object)  ← 等的是 stockLock
    - locked <0x000000076ab8c5a0> (a java.lang.Object)            ← 持的是 orderLock
```

`jstack` 直接给出了答案：两条线程互相等待对方持有的锁——下单线程拿着 `orderLock` 等 `stockLock`，对账线程拿着 `stockLock` 等 `orderLock`。

### 1.3 第二步：看代码 —— 两个团队，两个锁序

顺着 jstack 给出的行号找到代码。下单业务和对账任务分属两个开发组维护：

```java
// ═══════════════════════════════════════════════════════════
// OrderProcessService.java:156 — 实时下单（订单组维护）
// ═══════════════════════════════════════════════════════════
public class OrderProcessService {
    private final Object orderLock = new Object();  // 保护订单状态
    private final Object stockLock = new Object();  // 保护库存扣减

    public void createOrder(OrderRequest req) {
        // 锁序：orderLock → stockLock
        synchronized (orderLock) {
            // ① 创建订单记录、校验状态
            Order order = buildAndValidateOrder(req);
            orderDao.insert(order);

            synchronized (stockLock) {
                // ② 扣减库存
                for (OrderItem item : req.getItems()) {
                    int remaining = stockDao.deduct(item.getSkuId(), item.getQty());
                    if (remaining < 0) {
                        throw new InsufficientStockException(item.getSkuId());
                    }
                }
            }
        }
    }
}

// ═══════════════════════════════════════════════════════════
// ReconciliationService.java:88 — 定时对账（结算组维护）
// ═══════════════════════════════════════════════════════════
public class ReconciliationService {
    private final Object orderLock = new Object();
    private final Object stockLock = new Object();

    /**
     * 每天凌晨 2:00 执行：对比订单金额与库存扣减金额是否一致。
     * 不一致的订单标记为异常，冻结库存。
     */
    @Scheduled(cron = "0 0 2 * * ?")
    public void reconcileOrder() {
        List<Order> orders = orderDao.findPendingReconciliation();
        for (Order order : orders) {
            // 锁序：stockLock → orderLock  ← 和下单方法正好反过来！
            synchronized (stockLock) {
                // ① 锁定库存数据，防止对账期间库存被修改
                BigDecimal stockAmount = stockDao.sumDeductedAmount(order.getId());

                synchronized (orderLock) {
                    // ② 读取订单金额，与库存扣减金额对比
                    if (order.getTotalAmount().compareTo(stockAmount) != 0) {
                        freezeOrderAndStock(order);  // 金额不一致，冻结
                    }
                }
            }
        }
    }
}
```

根因一目了然：

| 方法 | 锁顺序 | 维护团队 |
| :-- | :-- | :-- |
| `createOrder`（下单） | orderLock → stockLock | 订单组 |
| `reconcileOrder`（对账） | stockLock → orderLock | 结算组 |

两个团队各自独立开发，没人注意到对方的锁顺序。当对账任务在凌晨 2:00 启动，恰好与还活着的下单线程并发执行——死锁的四个条件齐了。

### 1.4 第三步：死锁的形成机制

当凌晨 2:00 对账任务启动，`reconciliation-thread` 遍历订单列表时，恰好与还在处理实时下单请求的 `order-process-thread` 在锁边界上撞车：

1. `order-process-thread` 进入 `createOrder()`，拿到 `orderLock`
2. 就在它准备拿 `stockLock` 的瞬间，`reconciliation-thread` 拿到了 `stockLock`，然后尝试拿 `orderLock`
3. 两条线程互相持有对方需要的锁，谁也不放手
4. 死锁形成——下单线程在 `BLOCKED` 状态等 `stockLock`，对账线程在 `BLOCKED` 状态等 `orderLock`，双方 CPU 使用率均为 0

死锁一旦形成，不会自动解开。下单线程和对账线程都永久卡住，后续所有调用 `createOrder` 的请求也会在 `orderLock` 上排队阻塞。最终整个订单服务的下单路径全部挂起。

### 1.5 修复：两管齐下

**第一，统一锁顺序（治本）。** 两个团队对齐，所有方法统一按 `orderLock → stockLock` 获取。一旦锁顺序全局一致，循环等待不可能形成：

```java
// ReconciliationService.java 修复后
public void reconcileOrder() {
    List<Order> orders = orderDao.findPendingReconciliation();
    for (Order order : orders) {
        synchronized (orderLock) {        // ← 改为和 createOrder 一致的顺序
            synchronized (stockLock) {
                BigDecimal stockAmount = stockDao.sumDeductedAmount(order.getId());
                if (order.getTotalAmount().compareTo(stockAmount) != 0) {
                    freezeOrderAndStock(order);
                }
            }
        }
    }
}
```

**第二，用 `ReentrantLock.tryLock(timeout)` 兜底（防御）。** 即便统一了锁顺序，业务复杂到多个模块交叉持锁时，仍可能出现意料之外的环。为所有锁获取加超时，拿不到就放手降级而非死等：

```java
private final ReentrantLock orderLock = new ReentrantLock();
private final ReentrantLock stockLock = new ReentrantLock();

public void reconcileOrder() {
    List<Order> orders = orderDao.findPendingReconciliation();
    for (Order order : orders) {
        try {
            if (!orderLock.tryLock(500, TimeUnit.MILLISECONDS)) {
                log.warn("对账任务获取 orderLock 超时，订单 {} 延后处理", order.getId());
                continue;
            }
            try {
                if (!stockLock.tryLock(500, TimeUnit.MILLISECONDS)) {
                    log.warn("对账任务获取 stockLock 超时，订单 {} 延后处理", order.getId());
                    continue;
                }
                try {
                    BigDecimal stockAmount = stockDao.sumDeductedAmount(order.getId());
                    if (order.getTotalAmount().compareTo(stockAmount) != 0) {
                        freezeOrderAndStock(order);
                    }
                } finally {
                    stockLock.unlock();
                }
            } finally {
                orderLock.unlock();
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            break;
        }
    }
}
```

**第三，代码审查规约。** 团队在 CR 检查清单里加了一条："多锁场景，锁获取顺序是否全局一致？不一致直接打回。"

### 1.6 总结

| 信号 | 含义 | 工具 |
| :-- | :-- | :-- |
| CPU 低、线程数高、请求无响应 | 大量线程 BLOCKED / WAITING——大概率死锁 | `top` + `jstack` |
| `jstack` 末尾 `Found one Java-level deadlock` | 经典死锁 | `jstack` |
| 两个代码路径锁顺序相反 | 根因 | 代码审查 |
| 修复用统一的锁顺序 | 消除循环等待 | 团队对齐规范 |
| 修复用 `tryLock(timeout)` | 最后防线，锁拿不到就降级而非死等 | `ReentrantLock.tryLock` |

**教训：** 任何涉及多把锁的方法，必须定义全局统一的加锁顺序（如按锁对象的 `identityHashCode` 排序），并给所有锁获取加超时。这个案例的致命组合（两个团队独立开发，锁顺序相反）在真实生产环境中反复出现——根源是跨团队协作时缺少锁资源申请的全局视图。

## 2. 案例 2：618 的雪崩 —— CallerRunsPolicy 把 Tomcat 线程全拖下水 {#case-2}

### 2.1 事故背景

2024 年 618 大促，某电商优惠券领取接口。预估 QPS 2 万，线程池配置如下：

```java
new ThreadPoolExecutor(
    80,                                    // corePoolSize
    80,                                    // maxPoolSize（与 core 相同！）
    0L, TimeUnit.MILLISECONDS,
    new LinkedBlockingQueue<>(2000),       // 有界队列 2000
    new ThreadPoolExecutor.CallerRunsPolicy()  // 拒绝策略
);
```

容器 K8s 4C8G，JVM `-Xmx6G`。00:10 分流量突然打到 5 万 QPS，之后发生的事用时间线来还原：

```txt
00:10  QPS 瞬间从 2w 打到 5w，队列 2000 满，开始 CallerRuns
00:12  Tomcat IO 线程（默认 200）被占用 150+，接口 RT > 5s
00:13  上游超时重试 + 用户疯狂刷新，QPS 膨胀到 25w —— 正反馈形成
00:15  服务可用率跌到 42%，重启 3 次无效（配置未变，重启后立刻再死）
00:35  降级为 DiscardOldestPolicy，系统恢复。总资损约 300w
```

### 2.2 根因分析：CallerRunsPolicy 的正反馈效应

CallerRunsPolicy 的语义是：**当线程池满了，提交任务的线程（调用者）自己执行这个任务。** 听起来是"不丢任务"的好策略。但在高并发 Web 场景下，调用者就是 Tomcat 的 IO 线程（`http-nio-8080-exec-*`）。

于是形成了致命的链条：

```txt
1. 业务线程池满 → CallerRunsPolicy 让 Tomcat 线程执行任务
2. Tomcat 线程被优惠券领取业务占住（耗时 200ms+）
3. 能处理新 HTTP 请求的 Tomcat 线程变少 → 新请求排队
4. 用户看到页面卡住 → 疯狂刷新
5. 上游 Nginx/网关超时 → 发起重试
6. 更多请求涌进来 → 更多任务被提交到线程池
7. 线程池更满 → 更多 CallerRuns → 更少 Tomcat 线程可用 → 回到步骤 3
```

这是一个**正反馈环**，一旦触发就会自我强化直到系统完全崩溃。`top -Hp` 的输出证实了这一点：

```txt
  PID USER      PR  NI    VIRT    RES    SHR S  %CPU  COMMAND
  101 root      20   0   4.2g   1.1g    28m R  98.0  biz-20       ← 业务线程
  102 root      20   0   4.2g   1.1g    28m R  97.8  biz-21       ← 业务线程
  ...
  201 root      20   0   4.2g   1.1g    28m S   0.0  http-nio-8080-exec-36  ← Tomcat 线程被 CallerRuns 占用
```

业务线程在跑（CPU 高），但 Tomcat 线程全部被 CallerRuns 占用，无法接收新请求。

### 2.3 修复：重新设计线程池

```java
// ❌ 错误配置
new ThreadPoolExecutor(80, 80, 0L, TimeUnit.MILLISECONDS,
    new LinkedBlockingQueue<>(2000),
    new ThreadPoolExecutor.CallerRunsPolicy());

// ✅ 修复配置
new ThreadPoolExecutor(
    4,                                      // corePoolSize = CPU 核数
    8,                                      // maxPoolSize = CPU * 2（IO 密集型）
    60L, TimeUnit.SECONDS,
    new ArrayBlockingQueue<>(1024),          // 有界队列
    new ThreadPoolExecutor.DiscardOldestPolicy() {  // 自定义降级
        @Override
        public void rejectedExecution(Runnable r, ThreadPoolExecutor e) {
            log.error("优惠券任务被丢弃，触发降级");
            alertService.send("优惠券领取任务堆积，已启动降级策略");
            // 丢掉最老的未执行任务，执行新任务
            if (!e.isShutdown()) {
                e.getQueue().poll();   // 丢弃最老的任务
                e.execute(r);          // 执行当前任务
            }
        }
    }
);
```

关键改动：

1. `maxPoolSize` 从 80 降到 8 —— 4C8G 的容器，80 个线程的上下文切换就占掉 38% CPU
2. `CallerRunsPolicy` → `DiscardOldestPolicy` —— **绝不能让 Tomcat 线程来跑业务**
3. 队列从 `LinkedBlockingQueue` 改为 `ArrayBlockingQueue` —— 减少 GC 压力

**注意：`DiscardOldestPolicy` 会丢任务。** 如果你的业务不能接受任务丢失，至少要满足两个条件之一：(1) 丢失的任务有幂等重试机制；(2) 设置独立的业务线程池并通过快速失败（AbortPolicy）+ 上游重试来保证可靠。

### 2.4 更根本的方案：IO 密集任务用虚拟线程

如果升级到 JDK 21+，直接换虚拟线程，无需池化、无需拒绝策略：

```java
try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
    for (CouponRequest req : requests) {
        executor.submit(() -> processCoupon(req));
    }
}
```

详见第 12 章虚拟线程的原理。

### 2.5 总结

| 问题 | 根因 | 修复方向 |
| :-- | :-- | :-- |
| CallerRuns 拖垮 Tomcat | 业务线程池满了让调用者（Tomcat 线程）执行任务 | 拒绝策略绝不绑 Tomcat 线程 |
| 线程数过高 | 4C 容器开 80 线程 | 按 CPU 核数 × 2 设置（IO 密集型） |
| 重启无效 | 配置未变 | 修复配置后再部署；紧急降级用 DiscardOldest |
| 正反馈放大 | 超时重试 + 用户刷新 | 上游限流 + 快速失败 |


前两个案例分别说明锁序错误和线程池饱和。下一组案例聚焦另外两类并发故障：可变 key 破坏并发集合去重，以及虚拟线程 pinning 导致调度能力下降。

> **下一页：** [可变键与虚拟线程 pinning 案例](./chapter-02-cases-mutable-key-pin.md)
