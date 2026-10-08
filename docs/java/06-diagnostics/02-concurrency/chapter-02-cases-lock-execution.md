# 并发案例：锁与执行模型

> 凌晨两点，定时对账任务准时启动。下单服务突然卡死——接口 RT 从 200ms 暴涨到 20 秒，所有下单请求无响应。`jstack` 一跑——死锁。下单线程和对账线程互相拿着对方要的锁，四条锁交叉成一个环。重启恢复，第二天同一时间再次触发。另一家大促现场，优惠券服务也挂了——2000 任务的队列满了，CallerRunsPolicy 把 Tomcat 的 IO 线程全占死，网关层 504。还有个调度系统，`ConcurrentHashMap` 里同一个 Task 对象存了 3 份——因为 `setStatus()` 改了 hashCode。并发 bug 最残酷的地方在于：它不靠逻辑犯错，靠时间犯错。升级到 JDK 21 虚拟线程后，压测吞吐从 5000 跌到 800——`synchronized` 把虚拟线程钉在了 carrier 上。另一台机器，`CompletableFuture` + DiscardPolicy 静默丢弃了 `FutureTask`，`allOf().join()` 永远等不到结果。还有线程池 core=max+无界队列——maxPoolSize 永远不触发。迁移到虚拟线程后，某个凌晨 3 点整个服务突然无响应——所有 carrier 线程都被 pin 住，虚拟线程调度器静默死锁，任何常规监控都无法发现。以及 RestTemplate 没有 `readTimeout`——下游挂了 10 秒，整个系统瘫痪 3 小时。

## 1. 案例 1：对账与下单的死锁 —— 两个团队，两个锁序 {#case-1}

### 1.1 事故背景

这是一个真实线上事故。某电商平台的订单服务日常运行稳定，但连续两天凌晨 2:00 定时对账任务启动后，订单服务就突然卡死——接口 RT 从 200ms 暴涨到 20s+，用户反馈"点了下单没反应"。CPU 使用率只有 8%，但线程数飙到 400+——经典死锁信号。第一次值班同事手快重启了服务，现场丢了，白白多等了两个小时等它复现。第二天同一时间问题再次出现，这次没人敢重启了，先 dump。

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

## 3. 案例 3：ConcurrentHashMap 去重失效 —— 可变 key 的 hashCode 陷阱 {#case-3}

### 3.1 事故背景

某任务调度系统，主线程定时从数据库读取未完成的任务，存入 `ConcurrentHashMap` 做**去重**——如果任务已在处理中，就不重复提交。结果线上频繁 OOM。排查发现：同一个 Task 对象在 `ConcurrentHashMap` 里存了 3 份，等于同一任务被调度了 3 次。

### 3.2 第一步：复现

```java
@Data  // Lombok: 生成 getter/setter/equals/hashCode（基于所有字段）
public class Task {
    private Integer id;
    private String taskName;
    private TaskInfo taskInfo;
}

@Data
public class TaskInfo {
    private Integer totalNum;
    private int status;  // 0:未开始  1:处理中  2:已完成
}
```

调度主逻辑：

```java
ConcurrentHashMap<Task, Boolean> runningTasks = new ConcurrentHashMap<>();

// 主线程定时从数据库读取未完成的任务
Task task = taskDao.findUnfinished();  // status = 0（未开始）
runningTasks.put(task, true);          // hashCode 基于 status=0 计算

// 将任务状态更新为"处理中"，写回数据库
task.getTaskInfo().setStatus(1);
taskDao.update(task);

// 后续轮询时，同一个 task 又被读出来（status=1）
// 此时 runningTasks.put(task, true) 本应去重，但……
// hashCode 变了！基于 status=1 重新计算，落到了不同的桶
runningTasks.put(task, true);  // 去重失败！同一个 Task 存了第二份
```

### 3.3 第二步：看 ConcurrentHashMap 的 key 定位逻辑

JDK 8 `ConcurrentHashMap.putVal()` 的关键代码：

```java
int hash = spread(key.hashCode());  // ← 先算 hash
int i = (n - 1) & hash;             // ← 定位桶位置

// 在桶内遍历，用 equals 和 hash 比较是否已存在
for (Node<K,V> f = tabAt(tab, i); f != null; f = f.next) {
    if (f.hash == hash &&           // ← hash 不相等就跳过，根本不会走到 equals
        ((fk = f.key) == key || (fk != null && key.equals(fk))))
        return f;  // 已存在
}
```

同一把钥匙（Task id=1），因为 hashCode 变了，落到了不同的桶。`ConcurrentHashMap` 用 hash 值做快速过滤——hash 不等，直接跳过，根本不会调 `equals`。所以即使 `equals` 认为它们是同一个对象，也无济于事。

### 3.4 第三步：修复

**根因：可变字段参与了 hashCode 计算。** 修复方案 —— 重写 `hashCode` 和 `equals`，只用不变的字段（id）：

```java
public class Task {
    private Integer id;
    private String taskName;
    private TaskInfo taskInfo;

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (!(o instanceof Task)) return false;
        return Objects.equals(id, ((Task) o).id);
    }

    @Override
    public int hashCode() {
        return Objects.hash(id);  // 只基于 id，不受 status 变化影响
    }
}
```

修复后，同一个 Task（id=1）无论 status 怎么变，hashCode 始终一致，`ConcurrentHashMap` 的去重能力恢复正常。

### 3.5 延伸：这不是 ConcurrentHashMap 的 bug

`ConcurrentHashMap` 的文档明确写了：它是线程安全的，但**不保证复合操作的原子性**，且 **key 的 equals/hashCode 必须稳定**。这是使用者必须遵守的契约，不是容器的 bug。

类似的陷阱还包括：

- `HashSet` / 任何依赖 `hashCode` 的容器都有这个问题

### 3.6 总结

| 症状 | 根因 | 修复 |
| :-- | :-- | :-- |
| `ConcurrentHashMap` 存了重复 key | 可变字段改变 hashCode | 重写 hashCode，只依赖不可变字段 |
| `containsKey` 返回 false | key 被修改后 hash 变了 | 同上 |
| 排查时 map.size > 预期值 | 同一对象存在不同桶中 | 代码审查 + hashCode 审计 |
| 根本原则 | **放在哈希容器中的 key 必须是不可变的** | 用 `record` / 不可变类 / 只用 id 做 key |

**教训：** 可变对象作为 Map 的 key = 定时炸弹。代码审查里如果看到 `Map<某可变对象, ...>`，直接问一句："这个对象的 hashCode 会不会变？" 如果答案是"会"——别让它做 key。

## 4. 案例 4：虚拟线程 pinning —— 同步锁让 5000 QPS 跌到 800 {#case-4}

### 4.1 事故背景

2025 年，某视频流媒体处理团队将核心服务从 JDK 17 升级到 JDK 21，并将 `ExecutorService` 替换为 `Executors.newVirtualThreadPerTaskExecutor()`。升级前压测吞吐 5000 QPS，升级后跌到 800。CPU 使用率 40%，但请求延迟暴涨。日志里没有任何异常，监控看起来一切正常——但就是变慢了。

### 4.2 第一步：JFR 揪出看不见的瓶颈

```bash
# 启动 60 秒 JFR 录制，关注虚拟线程事件
jcmd <pid> JFR.start duration=60s filename=vt.jfr

# 用 jfr 命令行工具打印 pinning 事件
jfr print --events jdk.VirtualThreadPinned vt.jfr
```

输出：

```txt
jdk.VirtualThreadPinned {
  startTime = 10:23:45.102
  duration = 212 ms
  eventThread = "" (virtual)
  stackTrace = [
    com.zaxxer.hikari.pool.HikariPool.getConnection()      ← 老版本 HikariCP
    com.zaxxer.hikari.HikariDataSource.getConnection()
    com.example.VideoService.processVideo(VideoService.java:56)
    ...
  ]
}
```

几千个 `VirtualThreadPinned` 事件，全部指向 `HikariPool.getConnection()`。

### 4.3 第二步：为什么 pinning 导致吞吐暴跌？

虚拟线程的工作原理：JDK 21 默认 `parallelism = CPU 核数` 个 **carrier 线程**（平台线程），海量虚拟线程在这少数几个 carrier 上被调度。虚拟线程遇到 I/O 阻塞时，JVM 自动将其从 carrier 上**卸载**，carrier 线程去执行其他就绪的虚拟线程。这就是虚拟线程能给高 IO 并发带来质变的原因。

**但是**——当虚拟线程在 `synchronized` 块内阻塞时，JVM 无法卸载它。虚拟线程被"钉住"（pinned）在 carrier 上，carrier 被占死。

```txt
8 个 carrier → 每个被 pinned → 实际并发 = 8

5000 QPS × 平均处理 50ms = 250 个并发需求 → 8 个可用 → 排队 242 个
```

这就是吞吐从 5000 跌到 800 的数学解释。

### 4.4 第三步：修复

**方案 A（治本）：升级 HikariCP 到 5.1.0+**

老版本 `HikariPool.getConnection()` 使用了 `synchronized`：

```java
// HikariCP 5.0.x（问题版本）
public synchronized Connection getConnection() throws SQLException {
    return pool.borrowObject();  // ← 这里阻塞时，虚拟线程被 pinned
}
```

升级到 5.1.0+ 后，HikariCP 将 `synchronized` 替换为 `ReentrantLock`：

```java
// HikariCP 5.1.0+（修复版本）
public Connection getConnection() throws SQLException {
    lock.lock();
    try {
        return pool.borrowObject();  // ← ReentrantLock 下阻塞时，虚拟线程可以正常卸载
    } finally {
        lock.unlock();
    }
}
```

`ReentrantLock` 底层使用 `LockSupport.park()`，虚拟线程在 park 时能正常卸载。升级后吞吐恢复到 5200 QPS。

**方案 B（治标）：如果框架无法升级，用 Semaphore 限流**

```java
private static final Semaphore DB_SEMAPHORE = new Semaphore(50);

public void processVideo(VideoRequest req) {
    DB_SEMAPHORE.acquire();
    try {
        Video video = videoDao.findById(req.getVideoId());
    } finally {
        DB_SEMAPHORE.release();
    }
}
```

用 Semaphore 限制同时进入 `synchronized` 危险区的虚拟线程数量。

**方案 C（如果你有 JDK 24+）：直接升级**

JDK 24 的 JEP 491 消除了 `synchronized` 的 pinning 问题。JDK 25 LTS 将于 2025 年 9 月发布。

### 4.5 诊断信号

| 信号 | 工具 | 含义 |
| :-- | :-- | :-- |
| 虚拟线程环境下吞吐不升反降 | 压测对比 | 可能存在 pinning |
| `jfr print --events jdk.VirtualThreadPinned` | JFR | 精确定位 pinning 代码位置 |
| 大量虚拟线程 `WAITING`、carrier 全部 `RUNNABLE` | `jcmd Thread.print` | carrier 被占满 |
| `-Djdk.tracePinnedThreads=full` 输出 | JVM 参数 | JDK 21-23 可用，JDK 24+ 已移除 |

### 4.6 总结

虚拟线程不是"开了就快"的银弹。它的调度优势建立在"非 pinning 的阻塞操作"上。pinning 场景包括：

- `synchronized` 块内的阻塞 I/O（JDK 21-23）
- Native 方法（JNI）内的阻塞
- 某些老版本 JDBC 驱动的内部实现

排查节奏：先看 JFR `VirtualThreadPinned` 事件 → 定位代码位置 → 判断框架是否可升级 → 不可升级则用 Semaphore 限流或把阻塞操作移到平台线程池。
