# 并发案例：锁与执行模型

> **案例说明：** 本页日期、业务背景、指标和工具输出均为构造或匿名化教学数据；除引用一手资料外，不应视为可核验的真实事件。排查方法与命令仍需结合目标 JDK、系统和生产变更流程验证。

> 本组案例先覆盖死锁与线程池饱和两类故障；可变键导致的并发集合失效、虚拟线程 pinning 另见下一页。每个场景先从线程状态和执行轨迹定位问题，再讨论锁顺序、任务队列、对象身份和同步边界。

## 对账与下单的死锁 —— 两个团队，两个锁序 {#case-1}

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
// 下单与对账必须竞争同一组 monitor，死锁才能复现，因此两服务共享同一组锁对象。
// 这是用于演示「共享锁身份」的简化结构；生产代码应封装锁的获取与释放，避免暴露锁对象。
public final class OrderStockLocks {
    public final Object orderLock = new Object();  // 保护订单状态
    public final Object stockLock = new Object();  // 保护库存扣减
}

// ═══════════════════════════════════════════════════════════
// OrderProcessService.java:156 — 实时下单（订单组维护）
// ═══════════════════════════════════════════════════════════
public class OrderProcessService {
    private final OrderStockLocks locks;  // 与对账服务注入同一实例

    public OrderProcessService(OrderStockLocks locks) {
        this.locks = locks;
    }

    public void createOrder(OrderRequest req) {
        // 锁序：orderLock → stockLock
        synchronized (locks.orderLock) {
            // ① 创建订单记录、校验状态
            Order order = buildAndValidateOrder(req);
            orderDao.insert(order);

            synchronized (locks.stockLock) {
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
    private final OrderStockLocks locks;  // 与下单服务注入同一实例

    public ReconciliationService(OrderStockLocks locks) {
        this.locks = locks;
    }

    /**
     * 每天凌晨 2:00 执行：对比订单金额与库存扣减金额是否一致。
     * 不一致的订单标记为异常，冻结库存。
     */
    @Scheduled(cron = "0 0 2 * * ?")
    public void reconcileOrder() {
        List<Order> orders = orderDao.findPendingReconciliation();
        for (Order order : orders) {
            // 锁序：stockLock → orderLock  ← 和下单方法正好反过来！
            synchronized (locks.stockLock) {
                // ① 锁定库存数据，防止对账期间库存被修改
                BigDecimal stockAmount = stockDao.sumDeductedAmount(order.getId());

                synchronized (locks.orderLock) {
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

根因：两条路径竞争同一组锁对象，但加锁顺序相反：

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
4. 死锁形成——下单线程在 BLOCKED 状态等 stockLock，对账线程在 BLOCKED 状态等 orderLock；线程转储可看到它们正等待对方持有的锁。低 CPU 和请求超时是排查线索，但不能单独证明死锁，需结合转储中的锁持有关系确认

死锁一旦形成，不会自动解开。在该共享锁设计下，下单线程和对账线程都永久卡住，后续所有调用 `createOrder` 的请求也会在 `orderLock` 上排队阻塞。最终整个订单服务的下单路径全部挂起。

### 1.5 修复：两管齐下

**第一，统一锁顺序（治本）。** 两个团队对齐，所有方法统一按 `orderLock → stockLock` 获取。一旦锁顺序全局一致，循环等待不可能形成：

```java
// ReconciliationService.java 修复后（locks 为共享的 OrderStockLocks 实例）
public void reconcileOrder() {
    List<Order> orders = orderDao.findPendingReconciliation();
    for (Order order : orders) {
        synchronized (locks.orderLock) {        // ← 改为和 createOrder 一致的顺序
            synchronized (locks.stockLock) {
                BigDecimal stockAmount = stockDao.sumDeductedAmount(order.getId());
                if (order.getTotalAmount().compareTo(stockAmount) != 0) {
                    freezeOrderAndStock(order);
                }
            }
        }
    }
}
```

**第二，用 `ReentrantLock.tryLock(timeout)` 兜底（可选防御，独立替代实现）。** 即便统一了锁顺序，业务复杂到多个模块交叉持锁时，仍可能出现意料之外的环。仅当确有明确等待时限要求的锁操作，才改用支持超时的锁 API（如 `ReentrantLock`），并定义获取失败后的补偿、重试与任务状态处理；超时机制不能替代锁顺序设计，也不应给所有锁获取无差别加超时。注意 `tryLock` 属于 `Lock` 接口，与上文 `synchronized` 是两套机制——下面的片段是把对应锁整体替换为 `ReentrantLock` 的独立版本，并非与 `OrderStockLocks` 的 `synchronized` 锁混用：

```java
// 独立替代实现：把两把锁整体替换为 ReentrantLock，并统一加锁顺序
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

**第三，代码审查规约。** 团队在 CR 检查清单里加了一条："多锁场景，锁获取顺序是否全局一致？不一致直接打回。" 统一锁序不只是修复发生死锁的两个方法，还应检查所有可能同时获取这两把共享锁的代码路径（如下单、对账、取消、库存补偿）；只要仍有一条路径采用相反顺序，循环等待就可能再次出现。

### 1.6 总结

| 信号 | 含义 | 工具 |
| :-- | :-- | :-- |
| CPU 较低、线程数升高、请求超时 | 存在阻塞或等待的可能，需结合线程转储确认等待原因 | `top` + `jstack` |
| `jstack` 末尾 `Found one Java-level deadlock` | 已有直接死锁证据 | `jstack` |
| 不同路径获取共享锁的顺序相反 | 潜在死锁根因，需结合实际锁对象验证 | 代码审查 |
| 修复用统一的锁顺序 | 消除循环等待 | 团队对齐规范 |
| 修复用 `tryLock(timeout)` | 最后防线，锁拿不到就降级而非死等 | `ReentrantLock.tryLock` |

**教训：** 涉及多把锁时，应优先通过统一的加锁顺序消除循环等待；若锁对象需动态排序，应使用稳定且无歧义的排序规则（仅依赖 `identityHashCode` 仍要考虑哈希碰撞）。仅当确需限制等待时间时，才对对应锁改用支持超时的锁 API，并定义获取失败后的业务处理——超时机制不能替代锁顺序设计。跨团队维护共享资源时，缺失锁资源申请的全局视图，正是这类锁序不一致被引入的组织原因。

## 618 的雪崩 —— CallerRunsPolicy 把 Tomcat 线程全拖下水 {#case-2}

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
00:12  Tomcat 工作线程（默认 200）被占用 150+，接口 RT > 5s
00:13  上游超时重试 + 用户疯狂刷新，QPS 膨胀到 25w —— 正反馈形成
00:15  服务可用率跌到 42%，重启 3 次无效（配置未变，重启后立刻再死）
00:35  降级为 DiscardOldestPolicy，系统恢复。总资损约 300w
```

### 2.2 根因分析：CallerRunsPolicy 的正反馈效应

CallerRunsPolicy 的语义是：**当线程池满了，提交任务的线程（调用者）自己执行这个任务。** 听起来是"不丢任务"的好策略。但在高并发 Web 场景下，调用者就是 Tomcat 工作线程（`http-nio-8080-exec-*`）。

于是形成了致命的链条：

```txt
1. 业务线程池满 → CallerRunsPolicy 让 Tomcat 工作线程执行任务
2. Tomcat 工作线程被优惠券领取业务占住（耗时 200ms+）
3. 能处理新 HTTP 请求的 Tomcat 工作线程变少 → 新请求排队
4. 用户看到页面卡住 → 疯狂刷新
5. 上游 Nginx/网关超时 → 发起重试
6. 更多请求涌进来 → 更多任务被提交到线程池
7. 线程池更满 → 更多 CallerRuns → 更少 Tomcat 工作线程可用 → 回到步骤 3
```

这会形成正反馈：若重试与新请求持续涌入而处理能力未恢复，拥塞可能进一步加剧。要确认 Tomcat 工作线程是否真的在执行优惠券任务，应结合线程池的队列与拒绝指标，以及线程转储中工作线程的调用栈——仅凭 `top -Hp` 的线程状态无法证明任务由调用者执行：

```txt
  PID USER      PR  NI    VIRT    RES    SHR S  %CPU  COMMAND
  101 root      20   0   4.2g   1.1g    28m R  98.0  biz-20       ← 业务线程
  102 root      20   0   4.2g   1.1g    28m R  97.8  biz-21       ← 业务线程
  ...
  201 root      20   0   4.2g   1.1g    28m S   0.0  http-nio-8080-exec-36  ← Tomcat 线程被 CallerRuns 占用
```

业务线程在跑（CPU 高），但部分 Tomcat 工作线程被 CallerRuns 占用，无法接收新请求。

### 2.3 修复：重新设计线程池

```java
// ❌ 错误配置
new ThreadPoolExecutor(80, 80, 0L, TimeUnit.MILLISECONDS,
    new LinkedBlockingQueue<>(2000),
    new ThreadPoolExecutor.CallerRunsPolicy());

// ✅ 修复配置
new ThreadPoolExecutor(
    4,                                      // corePoolSize
    8,                                      // maxPoolSize
    60L, TimeUnit.SECONDS,
    new ArrayBlockingQueue<>(1024),          // 有界队列
    new ThreadPoolExecutor.DiscardOldestPolicy()  // 丢弃最老任务后执行新任务
);
```

关键改动：

1. `maxPoolSize` 从 80 降到 8。线程数应结合任务的 CPU 消耗、阻塞时间与压测结果确定，并不单凭容器核数；原配置 80 个线程的上下文切换开销偏高也只是经验判断，需以实测为准。
2. `CallerRunsPolicy` → `DiscardOldestPolicy`。对需及时释放 Tomcat 工作线程的请求链路，应避免把耗时较长的业务任务转移到请求处理线程；具体可选快速失败、受控降级或独立异步处理。
3. 队列从 `LinkedBlockingQueue` 改为 `ArrayBlockingQueue`，并重新评估队列实现与容量；是否显著降低 GC 压力需以压测数据为准，不应默认成立。

**注意：`DiscardOldestPolicy` 会丢弃任务，仅适合"旧任务可过期、业务可容忍丢弃"的场景。** 原生策略在拒绝时丢弃队列头部最旧任务并重试提交当前任务，并不保证当前任务一定执行成功，也不会记录被丢弃任务的业务状态；重试时仍可能再次遭拒。若任务不能丢失，不能仅靠拒绝策略或幂等性兜底：需先明确拒绝发生后由谁负责重试、任务是否已持久化。对必须可靠执行的业务，应选择能让失败被明确感知和处理的提交机制——AbortPolicy 让调用方显式收到 `RejectedExecutionException`，但可靠性仍取决于调用方是否做持久化、幂等处理、重试上限与失败告警；它也不是所有可靠业务的唯一选择。

`ThreadPoolExecutor` 会优先把任务放入队列，仅在队列满后才把工作线程数扩展到 `maximumPoolSize`。因此这里 `corePoolSize=4`、队列容量 1024 时，流量上升通常会先让队列积压、再触发扩容；队列容量不只决定可积压数量，也影响扩容时机与排队延迟，应结合压测结果设置，不能只看 `maxPoolSize`。

修复后应在正常流量与突增流量下分别压测，观察活动线程数、队列长度、拒绝次数、任务耗时与 HTTP 延迟；并验证拒绝后调用方能否正确感知失败、优惠券领取结果与库存状态是否一致。若队列持续变长、拒绝次数不断增加或下游资源耗尽，说明只调整线程池参数不足以解决过载。

### 2.4 可选方案：用虚拟线程简化执行模型

在 JDK 21 及以上版本，若优惠券任务以阻塞式 I/O 为主，可评估改用虚拟线程简化任务执行模型。虚拟线程不需要像平台线程池那样固定工作线程数来复用线程，但并不意味着可以无限制提交任务：仍需根据数据库连接池、下游服务容量与业务限流控制并发，并为任务超时、取消和失败重试制定策略。虚拟线程降低的是线程管理成本，不是下游资源容量问题；替换执行模型不能替代容量管理与过载控制。示例：

```java
try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
    for (CouponRequest req : requests) {
        executor.submit(() -> processCoupon(req));
    }
}
```

详见[第 13 章虚拟线程的原理](../../03-java-concurrency/chapter-13-virtual-thread.md)。

### 2.5 总结

| 问题 | 根因 | 修复方向 |
| :-- | :-- | :-- |
| CallerRuns 拖垮 Tomcat | 业务线程池满了让调用者（Tomcat 工作线程）执行任务 | 对需及时释放 Tomcat 工作线程的链路，避免把耗时任务转移到请求处理线程 |
| 线程数过高 | 4C 容器开 80 线程，且未结合任务阻塞时间与压测 | 按任务 CPU 消耗、阻塞时间与压测结果确定，不单凭核数 |
| 重启无效 | 配置未变 | 修复配置后再部署；紧急降级用 DiscardOldest |
| 正反馈放大 | 超时重试 + 用户刷新 | 上游限流 + 快速失败 |

前两个案例分别说明锁序错误和线程池饱和。下一组案例聚焦另外两类并发故障：可变 key 破坏并发集合去重，以及虚拟线程 pinning 导致调度能力下降。

> **下一页：** [可变键与虚拟线程 pinning 案例](./chapter-04-cases-mutable-key-pin.md)
