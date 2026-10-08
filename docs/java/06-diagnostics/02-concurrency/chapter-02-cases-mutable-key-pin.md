# 并发案例：可变键与虚拟线程 pinning

> 本页与 [并发案例：锁与执行模型](./chapter-02-cases-lock-execution.md) 配套，重点说明并发集合可变键和虚拟线程 pinning。

## 1. ConcurrentHashMap 去重失效：可变 key 的 hashCode 陷阱 {#case-3}

### 1.1 事故背景

某任务调度系统，主线程定时从数据库读取未完成的任务，存入 `ConcurrentHashMap` 做**去重**——如果任务已在处理中，就不重复提交。结果线上频繁 OOM。排查发现：同一个 Task 对象在 `ConcurrentHashMap` 里存了 3 份，等于同一任务被调度了 3 次。

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
// 此时 runningTasks.put(task, true) 本应去重，但……
// hashCode 变了！基于 status=1 重新计算，落到了不同的桶
runningTasks.put(task, true);  // 去重失败！同一个 Task 存了第二份
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

同一把钥匙（Task id=1），因为 hashCode 变了，落到了不同的桶。`ConcurrentHashMap` 用 hash 值做快速过滤——hash 不等，直接跳过，根本不会调 `equals`。所以即使 `equals` 认为它们是同一个对象，也无济于事。

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
```

修复后，同一个 Task（id=1）无论 status 怎么变，hashCode 始终一致，`ConcurrentHashMap` 的去重能力恢复正常。

### 1.5 延伸：这不是 ConcurrentHashMap 的 bug

`ConcurrentHashMap` 的文档明确写了：它是线程安全的，但**不保证复合操作的原子性**，且 **key 的 equals/hashCode 必须稳定**。这是使用者必须遵守的契约，不是容器的 bug。

类似的陷阱还包括：

- `HashSet` / 任何依赖 `hashCode` 的容器都有这个问题

### 1.6 总结

| 症状 | 根因 | 修复 |
| :-- | :-- | :-- |
| `ConcurrentHashMap` 存了重复 key | 可变字段改变 hashCode | 重写 hashCode，只依赖不可变字段 |
| `containsKey` 返回 false | key 被修改后 hash 变了 | 同上 |
| 排查时 map.size > 预期值 | 同一对象存在不同桶中 | 代码审查 + hashCode 审计 |
| 根本原则 | **放在哈希容器中的 key 必须是不可变的** | 用 `record` / 不可变类 / 只用 id 做 key |

**教训：** 可变对象作为 Map 的 key = 定时炸弹。代码审查里如果看到 `Map<某可变对象, ...>`，直接问一句："这个对象的 hashCode 会不会变？" 如果答案是"会"——别让它做 key。

## 2. 虚拟线程 pinning：同步锁让 5000 QPS 跌到 800 {#case-4}

### 2.1 事故背景

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

虚拟线程的工作原理：JDK 21 默认 `parallelism = CPU 核数` 个 **carrier 线程**（平台线程），海量虚拟线程在这少数几个 carrier 上被调度。虚拟线程遇到 I/O 阻塞时，JVM 自动将其从 carrier 上**卸载**，carrier 线程去执行其他就绪的虚拟线程。这就是虚拟线程能给高 IO 并发带来质变的原因。

**但是**——当虚拟线程在 `synchronized` 块内阻塞时，JVM 无法卸载它。虚拟线程被"钉住"（pinned）在 carrier 上，carrier 被占死。

```txt
8 个 carrier → 每个被 pinned → 实际并发 = 8

5000 QPS × 平均处理 50ms = 250 个并发需求 → 8 个可用 → 排队 242 个
```

这就是吞吐从 5000 跌到 800 的数学解释。

### 2.4 第三步：修复

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

### 2.5 诊断信号

| 信号 | 工具 | 含义 |
| :-- | :-- | :-- |
| 虚拟线程环境下吞吐不升反降 | 压测对比 | 可能存在 pinning |
| `jfr print --events jdk.VirtualThreadPinned` | JFR | 精确定位 pinning 代码位置 |
| 大量虚拟线程 `WAITING`、carrier 全部 `RUNNABLE` | `jcmd Thread.print` | carrier 被占满 |
| `-Djdk.tracePinnedThreads=full` 输出 | JVM 参数 | JDK 21-23 可用，JDK 24+ 已移除 |

### 2.6 总结

虚拟线程不是"开了就快"的银弹。它的调度优势建立在"非 pinning 的阻塞操作"上。pinning 场景包括：

- `synchronized` 块内的阻塞 I/O（JDK 21-23）
- Native 方法（JNI）内的阻塞
- 某些老版本 JDBC 驱动的内部实现

排查节奏：先看 JFR `VirtualThreadPinned` 事件 → 定位代码位置 → 判断框架是否可升级 → 不可升级则用 Semaphore 限流或把阻塞操作移到平台线程池。
