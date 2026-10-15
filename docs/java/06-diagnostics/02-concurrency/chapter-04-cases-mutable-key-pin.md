# 并发案例：可变键与虚拟线程 pinning

> 本页与 [并发案例：锁与执行模型](./chapter-03-cases-lock-execution.md) 配套，重点说明并发集合可变键和虚拟线程 pinning。

## ConcurrentHashMap 去重失效：可变 key 的 hashCode 陷阱 {#case-3}

### 1.1 事故背景

某任务调度系统，主线程定时从数据库读取未完成的任务，存入 `ConcurrentHashMap` 做**去重**——如果任务已在处理中，就不重复提交。结果去重失效，同一任务被多次调度。`ConcurrentHashMap` 里出现了重复记录（下文会解释为什么会这样）。

### 1.2 第一步：复现

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
// 注意：ORM 重新查询通常返回新的 Java 实例，但业务身份（id）相同
// 此时 runningTasks.put(task, true) 本应去重，但……
// hashCode 可能变了：基于 status=1 重新计算，可能落入不同的桶
runningTasks.put(task, true);  // 若修改后的键无法匹配已有节点，Map 可能再次插入该业务任务
```

### 1.3 第二步：看 ConcurrentHashMap 的 key 定位逻辑

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

同一把钥匙（Task id=1），因为 hashCode 变了，可能落到不同的桶。`ConcurrentHashMap` 在插入时计算并保存键的 hash，查找时按当前 `hashCode()` 重新定位桶。hash 不等时容器直接跳过该候选，不会走到 `equals`；即便新旧 hash 落入同一桶，节点保存的旧 hash 与新值不一致也会匹配失败。根因是：键作为容器元素期间，参与相等性判断的状态发生了变化，破坏了插入与查找使用同一套键身份规则的前提。

### 1.4 第三步：修复

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

这种写法成立的前提是：`id` 在对象作为键期间保持不变，且在业务上能唯一标识需要去重的任务（若去重维度还包括租户、任务类型等，应一同纳入比较）。

修复后，同一个 Task（id=1）无论 status 怎么变，hashCode 始终一致，`ConcurrentHashMap` 的去重能力恢复正常。

### 1.5 延伸：这不是 ConcurrentHashMap 的 bug

`ConcurrentHashMap` 能保证单次方法调用的并发语义（如 `putIfAbsent` 等原子方法），但不会自动把多次调用组合成业务事务；同时，键的 `equals`/`hashCode` 必须遵循 Java 契约，且在其作为键期间不应改变相等性相关状态。这是使用者必须遵守的契约，不是容器的 bug。

类似的陷阱还包括：

- `HashSet` / 任何依赖 `hashCode` 的容器都有这个问题

### 1.6 总结

| 症状 | 根因 | 修复 |
| :-- | :-- | :-- |
| `ConcurrentHashMap` 存了重复 key | 可变字段改变 hashCode | 重写 hashCode，只依赖不可变字段 |
| `containsKey` 返回 false | key 被修改后 hash 变了 | 同上 |
| 排查时 `containsKey`/`remove` 找不到已存入的键 | 键的相等性相关状态可能发生变化 | 比较插入前后的 `hashCode`/`equals` 结果及对象身份 |
| 同一业务记录被重复登记 | 去重键设计或登记逻辑可能有问题 | 检查业务键、并发登记与清理流程 |
| 根本原则 | **作为哈希容器的 key，参与 `equals`/`hashCode` 的状态应在存储期间保持不变；实践中优先用不可变键或稳定的业务标识（如 id）** | 用 `record` / 不可变类 / 只用 id 做 key |

**教训：** 若键在存储期间的相等性相关状态会发生变化，后续查找与 `containsKey` 可能失败。代码审查里如果看到 `Map<某可变对象, ...>`，直接问一句："这个对象的 hashCode 会不会变？" 如果答案是"会"——别让它做 key。

## 虚拟线程 pinning：同步锁让 5000 QPS 跌到 800 {#case-4}

### 2.1 事故背景

以下吞吐、CPU 与 JFR 数据均为说明机制而构造的示意数值，不代表已验证的生产事故或特定环境下的性能基准。实际结果取决于 JDK 版本、硬件配置、连接池参数、下游响应时间及负载模型。

2025 年，某视频流媒体处理团队将核心服务从 JDK 17 升级到 JDK 21，并将 `ExecutorService` 替换为 `Executors.newVirtualThreadPerTaskExecutor()`。升级前压测吞吐 5000 QPS，升级后跌到 800。CPU 使用率 40%，但请求延迟暴涨。日志里没有任何异常，监控看起来一切正常——但就是变慢了。

### 2.2 第一步：JFR 揪出看不见的瓶颈

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

### 2.3 第二步：为什么 pinning 导致吞吐暴跌？

虚拟线程的工作原理：JDK 21 默认 `parallelism = CPU 核数` 个 **carrier 线程**（平台线程），海量虚拟线程在这少数几个 carrier 上被调度。虚拟线程遇到 I/O 阻塞时，JVM 自动将其从 carrier 上**卸载**，carrier 线程去执行其他就绪的虚拟线程。这就是虚拟线程能给高 IO 并发带来质变的原因。（注：本案例的 pinning 结论限定在 JDK 21–23；JDK 24 通过 JEP 491 改进了监视器与虚拟线程的交互，消除了几乎所有由 `synchronized` 导致的 pinning，见 §2.4 方案 C。）

**但是**——在 JDK 21–23 中，虚拟线程持有监视器期间执行某些阻塞操作时，可能被 pin 在 carrier 上，导致 carrier 无法用于执行其他虚拟线程。是否产生明显的性能影响，还取决于 pinning 的持续时间、频率与工作负载，而非一进入 `synchronized` 就必然发生。

```txt
8 个 carrier → 高频、长时间 pinning 时，多个 carrier 同时被占用
```

吞吐下降不能用 carrier 数量直接推算。它取决于 pinning 的持续时间与频率、数据库连接池大小、请求中的 CPU 工作量以及下游服务容量；需要结合 JFR 事件、`jcmd Thread.print` 与压测数据综合判断 pinning 是否构成主要瓶颈。JDK 21 官方文档也指出，pinning 并不必然导致性能下降，主要风险在于频繁且长时间的 pinning。

### 2.4 第三步：修复

**方案 A：优先升级依赖到已验证修复 pinning 的版本**

JFR 堆栈指向 `HikariPool.getConnection()`，这是排查线索而非定论。是否需要升级、升级到哪个版本能修复，**务必先核对所用版本的真实源码、发行说明与 issue**。以 HikariCP 为例，其 `getConnection()` 的具体同步路径在不同版本间有差异（并非“5.1.0 一律改用 `ReentrantLock`”），不能把“升级到某版本即修复”当作必然结论。

`ReentrantLock` 在竞争等待时通常通过 AQS 与 `LockSupport.park()` 等机制等待；对常见的虚拟线程锁竞争场景，这种等待可以释放 carrier。但换成 `ReentrantLock` 只解决“同步块内阻塞导致 pinning”这一项，连接池容量、锁竞争与数据库等待仍是独立的影响因素。

**方案 B：如果框架无法升级，用 Semaphore 限流**

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

用 Semaphore 限制同时进入 `synchronized` 危险区的虚拟线程数量。注意两点：Semaphore 只是资源并发控制手段，不保证消除 pinning——若被 pin 的位置不在受保护区间内，限流未必生效；其上限应结合数据库连接池容量与下游承载能力确定，并通过压测验证，而不是写死一个无依据的数值（示例中 `50` 仅作示意）。此外 `acquire()` 可中断，生产代码应按 `InterruptedException` 的正确语义处理。

**方案 C（如果你有 JDK 24+）：直接升级**

JDK 24 引入 JEP 491，解决了绝大多数由 `synchronized` 监视器机制导致的虚拟线程 pinning。若运行在 JDK 24+，应先验证实际运行时行为，再决定是否为此改写同步代码；Native 方法（JNI）等场景仍需单独评估。

### 2.5 诊断信号

| 信号 | 工具 | 含义 |
| :-- | :-- | :-- |
| 虚拟线程环境下吞吐不升反降 | 压测对比 | 可能存在 pinning |
| `jfr print --events jdk.VirtualThreadPinned` | JFR | 查看已记录的 pinning 事件及其堆栈，辅助定位发生阻塞的位置 |
| 大量虚拟线程 `WAITING`、carrier 全部 `RUNNABLE` | `jcmd Thread.print` | 线程状态作为线索，需结合栈帧与锁等待关系判断 |
| `-Djdk.tracePinnedThreads=full` 输出 | JVM 参数 | JDK 21-23 可用，JDK 24+ 已移除 |

JFR 事件能否记录取决于 pinning 的持续时间阈值（JDK 21 默认约 20ms）与录制时间窗，`jfr print` 提供的是证据线索而非自动定位；线程转储中的 `WAITING`/`RUNNABLE` 需结合栈帧与锁等待关系解读，不能直接对应根因。

### 2.6 总结

虚拟线程不是"开了就快"的银弹。它的调度优势建立在"非 pinning 的阻塞操作"上。pinning 场景包括：

- `synchronized` 块内的阻塞 I/O（JDK 21-23）
- Native 方法（JNI）内的阻塞
- 某些老版本 JDBC 驱动的内部实现

排查节奏：先看 JFR `VirtualThreadPinned` 事件 → 定位代码位置 → 判断框架是否可升级 → 不可升级则用 Semaphore 限流或把阻塞操作移到平台线程池。
