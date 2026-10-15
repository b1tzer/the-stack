# 线程封闭：`ThreadLocal` 与无共享编程

> 每条线程持有一份独立数据，那些让人焦头烂额的并发问题会不会凭空消失？

## 1. 面对竞争的两条路

第 1 章已经明确：并发 bug 的根源是**共享 + 可变 + 状态**三者同时成立。锁、CAS、内存屏障走的都是同一条路——**允许共享，但严格约束共享的时序**。这条路走得下去，但每一步都在付出代价：

- 加锁：线程阻塞、上下文切换
- CAS：自旋、ABA、单变量约束
- 内存屏障：限制特定内存访问的重排序，以满足可见性和有序性要求

还有另一条几乎被忽略的路：**从源头消除共享**。

如果一份数据只被一条线程读写，那"竞争"这个词就无从谈起——不需要锁，不需要 happens-before 推理，不需要屏障。这条路叫**线程封闭（Thread Confinement）**。

### 1.1 三种线程封闭方式

Java 中的线程封闭有三种典型形态：

| 形态 | 手段 | 典型场景 |
| :-- | :-- | :-- |
| Ad-hoc 封闭 | 靠代码约定（如"这个字段只有 EDT 线程能访问"） | Swing / JavaFX 的 UI 线程模型 |
| 栈封闭（Stack Confinement） | 数据只存在于方法局部变量中 | 大多数无状态服务方法 |
| `ThreadLocal` | JDK 提供的显式 API，值绑定到当前线程 | 请求上下文、日期格式化器、事务边界 |

前两种依赖工程纪律，一旦有人打破约定，编译器不会报错、运行时不会告警。`ThreadLocal` 由 JDK 提供了显式的线程局部存储机制，是本章重点讨论的方式。

### 1.2 一个能立刻救命的场景

`SimpleDateFormat` 是线程不安全的。生产上最经典的 bug 就是把它作为静态字段共享：

```java
// ❌ 反模式：SimpleDateFormat 作为静态共享字段
public class OrderService {
    private static final SimpleDateFormat SDF =
        new SimpleDateFormat("yyyy-MM-dd HH:mm:ss");

    public String formatCreateTime(Order o) {
        return SDF.format(o.getCreateTime());
        // 高并发下抛 NumberFormatException / ArrayIndexOutOfBoundsException
        // 更隐蔽的：偶发地返回错误的时间字符串
    }
}
```

线程安全的三条修复路径：

```java
// ✅ 方案一：每次 new，简单但有分配开销
public String formatCreateTime(Order o) {
    return new SimpleDateFormat("yyyy-MM-dd HH:mm:ss").format(o.getCreateTime());
}

// ✅ 方案二：ThreadLocal，每条线程一份
private static final ThreadLocal<SimpleDateFormat> SDF =
    ThreadLocal.withInitial(() -> new SimpleDateFormat("yyyy-MM-dd HH:mm:ss"));

public String formatCreateTime(Order o) {
    return SDF.get().format(o.getCreateTime());
}

// ✅ 方案三：换成 java.time.DateTimeFormatter（本身就是线程安全的）
private static final DateTimeFormatter FMT =
    DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss");
```

三种方案各有取舍：JDK 8+ 优先选方案三；无法升级或需要复用重量级对象时，方案二是标准姿势。方案二就是线程封闭的最小案例。

### 1.3 共享同步与线程封闭的边界

| 维度 | 共享 + 同步 | 线程封闭 |
| :-- | :-- | :-- |
| 数据可变性 | 需要跨线程可见的写入 | 每条线程独立演化 |
| 内存开销 | 一份 | 与活跃线程数成正比 |
| 正确性成本 | 依赖 happens-before 推理 | 天然满足 |
| 传递成本 | 直接读取 | 跨线程需显式复制 |
| 典型场景 | 计数器、缓存、共享配置 | 请求上下文、格式化器、事务上下文 |

规则很直接：**能合理采用线程封闭时，优先评估这种方案**。剩下的场景（多线程必须协同）才轮到锁、CAS、并发集合出场。

## 2. `ThreadLocal` 的存储结构

理解 `ThreadLocal` 的行为，必须先破除一个常见误解：**值不存在 `ThreadLocal` 对象里，也不存在某个全局 `Map` 里**。

### 2.1 值挂在 `Thread` 对象上

每一个 `Thread` 实例有两个字段：

```java
// java.lang.Thread 的相关字段（JDK 21 源码简化，包级可见，默认初始化为 null）
public class Thread implements Runnable {
    ThreadLocal.ThreadLocalMap threadLocals;
    ThreadLocal.ThreadLocalMap inheritableThreadLocals;
    // ...
}
```

存储关系是这样的：

```txt
   Thread-A                          Thread-B
  ┌─────────────────────┐          ┌─────────────────────┐
  │ threadLocals ──┐    │          │ threadLocals ──┐    │
  └────────────────┼────┘          └────────────────┼────┘
                   ▼                                ▼
          ThreadLocalMap                   ThreadLocalMap
          ┌──────────────┐                 ┌──────────────┐
          │ [TL_X → v1]  │                 │ [TL_X → v3]  │
          │ [TL_Y → v2]  │                 │ [TL_Z → v4]  │
          └──────────────┘                 └──────────────┘

       TL_X, TL_Y, TL_Z 是 ThreadLocal 实例（全局共享的 key）
       v1..v4 是每条线程各自的 value
```

`ThreadLocal` 实例本身只是**一把 key**，真正的存储在 `Thread.threadLocals`。这解释了三个关键事实：

- 一个 `ThreadLocal` 实例可以被多条线程共用（作为 key 是安全的）
- `set(v)` 写入的是**当前线程**的 `ThreadLocalMap`，与 `ThreadLocal` 实例无关
- 线程死亡时，`Thread.threadLocals` 随对象回收，值一并消失（前提是线程真的能死）

### 2.2 `ThreadLocalMap` 的独立实现

`ThreadLocalMap` 不是 `HashMap`，是 `ThreadLocal` 内部的一个私有类。它有三处刻意的偏离：

| 维度 | `HashMap` | `ThreadLocalMap` |
| :-- | :-- | :-- |
| 冲突解决 | 拉链法（链表 + 红黑树） | 开放地址法（线性探测） |
| Entry 的 key | 强引用 | **弱引用** |
| 使用规模 | 通常存百到千条 | 通常存个位数到十几条 |

选择开放地址法的直接原因是**每条线程只放少量 Entry**，链表节点的额外对象分配得不偿失；顺带一个副作用是探测过程可以顺路清理过期 Entry（key 已被 GC 的槽位），这是后面讲内存泄漏时会反复出现的关键机制。

Entry 的定义：

```java
static class Entry extends WeakReference<ThreadLocal<?>> {
    Object value;  // 强引用

    Entry(ThreadLocal<?> k, Object v) {
        super(k);  // key 存到 WeakReference 里
        value = v;
    }
}
```

**key 弱引用 + value 强引用**是这一整章最重要的一个非对称设计。它带来了两个直接后果：

- `ThreadLocal` 实例被外部强引用释放后，`Entry.key` 会在下一次 GC 被回收，槽位变成"过期 Entry"
- 但 `Entry.value` 仍被 `ThreadLocalMap` 强引用，`ThreadLocalMap` 又被 `Thread` 强引用——**value 不会自动消失**

后一条就是内存泄漏的种子，3.3 节展开。

### 2.3 `get` / `set` / `remove` 的调用路径

```txt
    ThreadLocal.set(v)
           │
           ▼
    Thread.currentThread()
           │
           ▼
    thread.threadLocals   ──── 若为 null 则懒初始化
           │
           ▼
    ThreadLocalMap.set(this, v)     // this 是 ThreadLocal 实例
           │
           ▼
    线性探测找到空槽或已过期槽
           │
           ▼
    写入 Entry(this, v)
```

- `get()` 首次访问时会触发 `initialValue()`（或 `withInitial` 提供的 Supplier）懒加载
- `set(null)` 并**不等价于** `remove()`：前者只是把 value 置空，Entry 仍然占着槽位
- `remove()` 在清空 Entry 的同时会调用 `expungeStaleEntry` 清理相关探测区间中的过期 Entry

## 3. 内存泄漏的形成机制

关于 `ThreadLocal` 的内存泄漏，网上流传最广的说法是"因为 key 是弱引用所以会泄漏"。这个说法把因果关系讲反了。

### 3.1 泄漏路径的完整链条

看引用链：

```txt
Thread (Root, GC 从这里出发)
   │  强引用
   ▼
ThreadLocalMap
   │  强引用
   ▼
Entry[i]
   │            │
 弱引用       强引用
   ▼            ▼
ThreadLocal    value
 (key)        (业务对象)
```

`ThreadLocal` 实例通常是 `static final` 字段，也被类加载器强引用。这条外部强引用在，key 就不会被 GC。此时无论泄漏与否，`get()` 都能正常工作。

真正出问题的场景是：**外部对 `ThreadLocal` 的强引用消失了，但线程还活着**。

```java
void handleRequest() {
    ThreadLocal<byte[]> tl = new ThreadLocal<>();  // 局部变量
    tl.set(new byte[10 * 1024 * 1024]);            // 10 MB
    // 方法返回后，tl 变量出栈
    // 但 Worker 线程还活着，Entry 仍在 threadLocals 里
}
```

方法返回后：

- `tl` 出栈，指向 `ThreadLocal` 实例的强引用消失
- 下次 GC 时，`Entry.key`（弱引用）被回收，槽位变成 `key=null, value=byte[10MB]`
- `Thread.threadLocals` 仍然强引用这个 Entry，10 MB 不会被回收
- 从外部代码已经**无法访问**这个 value——没有 `ThreadLocal` 实例作为 key，`get()` 找不到它

关键洞察：**弱引用不是导致泄漏的原因，而是留下"我已经过期，请清理我"的信号**。如果 key 也是强引用，情况会更糟——连"这个槽位已经无主"的信号都没有。

### 3.2 线程池是泄漏放大器

单线程应用里，线程死了 `threadLocals` 一起回收，泄漏被限制在线程生命周期内。线程池打破了这个前提：Worker 长期复用会延长线程局部数据的存活时间，若任务反复写入上下文却没有及时清理，Map 中的值就可能长期保留。

```java
// ❌ 反模式：只 set 不 remove
executor.execute(() -> {
    RequestContext ctx = buildContext(request);  // 1 KB
    ThreadLocalHolder.CTX.set(ctx);
    handleBusiness();
    // Worker 归池，ctx 仍被 Entry 强引用
});
```

生产事故的典型形态：

- 老年代占用曲线在数天内缓慢上升
- Full GC 后不下降或只下降一点
- Heap Dump 显示大量 `ThreadLocalMap$Entry`，`value` 指向业务对象
- 触发 OOM 时通常伴随线程池 Worker 长期不重建

还要区分两种情况：key 被 GC 后留下的 stale entry，以及 key 仍然有效、但业务值已经不应继续保留的 Entry。后者在静态 `ThreadLocal` 配合线程池时尤其常见，例如静态的 `RequestContext` ThreadLocal 被任务写入后未清理。两者的成因不同，但都说明线程上下文需要明确的清理时机。

### 3.3 `remove()` 的强制性

推荐始终使用 try-finally：

```java
// ✅ 正确姿势
executor.execute(() -> {
    try {
        ThreadLocalHolder.CTX.set(buildContext(request));
        handleBusiness();
    } finally {
        ThreadLocalHolder.CTX.remove();   // 关键
    }
});
```

`remove()` 的额外收益：内部实现会顺带清理相关探测区间中的过期 Entry，并重新安排区间内需要移动的有效 Entry。这也是 `ThreadLocalMap` 采用线性探测的隐性价值——探测过程本身就是清理过程。

`ThreadLocalMap` 会在部分读写操作中顺带清理过期 Entry，但这种清理是按需进行的，并不保证及时清空所有过期值。对于业务代码显式设置的线程上下文，应在使用结束时主动调用对应的 `remove()`，不要把内存回收寄托在 Map 的被动清理上。

### 3.4 内存泄漏诊断路径

生产环境的排查步骤：

```txt
jstat -gcutil <pid> 1000     # 观察 OU（老年代使用率）是否单调上升
       │
       ▼
jmap -dump:live,format=b,file=heap.bin <pid>
       │
       ▼
MAT 打开，Dominator Tree
       │
       ▼
搜索 ThreadLocal$ThreadLocalMap$Entry
       │
       ├─ 若 Entry.key == null 且 value 巨大：重点检查是否存在长期保留
       └─ 沿 GC Root 追溯：定位到哪个 Worker 线程
       │
       ▼
grep 代码库：ThreadLocal.set 且缺 remove
```

MAT 有一个专用视图 `Path to GC Roots → exclude weak references`，能直接看到 value 从 Worker 线程被强引用的完整链路。

## 4. `InheritableThreadLocal`：父子线程的传递

普通 `ThreadLocal` 只服务当前线程。如果需要子线程读到父线程写入的值，就要换 `InheritableThreadLocal`。

### 4.1 复制发生的时机

```txt
Thread parent = Thread.currentThread();
parent.inheritableThreadLocals = { TL_TRACE_ID: "req-42" }

Thread child = new Thread(() -> ...);
    │
    ▼  Thread 构造函数触发
    │
    ▼
if (parent.inheritableThreadLocals != null) {
    child.inheritableThreadLocals =
        ThreadLocalMap.createInheritedMap(parent.inheritableThreadLocals);
}
```

复制**只发生在 `new Thread()` 那一刻**，且只复制一次。这条规则决定了它的所有边界。

### 4.2 复制语义

- **复制的是绑定，不一定是对象**：默认 `childValue` 返回父线程的原值引用，父子线程拥有各自的 Map Entry，但 Entry 可能指向同一个可变对象
- **后续重新绑定互不影响**：复制完成后，父线程 `set()` 不会更新子线程的绑定，子线程 `set()` 也不会更新父线程的绑定；但如果双方共享同一个可变对象，对该对象的修改仍然相互可见
- **可定制复制逻辑**：重写 `childValue(T parentValue)` 可以改变传递的值，例如复制一个 Map 容器；是否真正深拷贝，取决于复制逻辑是否也复制了内部可变对象

```java
InheritableThreadLocal<Map<String, String>> ctx =
    new InheritableThreadLocal<>() {
        @Override
        protected Map<String, String> childValue(Map<String, String> parentValue) {
            return new HashMap<>(parentValue);  // 复制 Map 容器；value 对象仍可能共享
        }
    };
```

### 4.3 线程池场景下的失效

`InheritableThreadLocal` 的传递语义假设了"父线程创建子线程"这个动作与"业务任务提交"是同一件事。在线程池模型下这个假设不成立。线程池中的 Worker 通常会被多个任务复用，而继承发生在 Worker 创建时，不发生在每次任务提交时：

```txt
时刻 T0: 线程池刚创建，尚未有 Worker（或只有部分 Worker）
时刻 T1: Main 线程 set("traceId", "req-42")
时刻 T2: Main 线程 executor.execute(task-1)
         此时才可能创建 Worker-1，它会继承 T2 时刻 Main 线程的上下文
时刻 T3: Main 线程 set("traceId", "req-99")
时刻 T4: Main 线程 executor.execute(task-2)
         Worker-1 复用执行 task-2，但它的 inheritableThreadLocals
         仍是 T2 创建时刻的快照，get() 拿到 "req-42" 而不是 "req-99"
```

Worker 可能在某次任务提交过程中才被创建，因此继承到当时提交线程的上下文；之后即使执行其他请求，也不会自动更新成新请求的上下文。若任务结束后没有清理，旧值还可能继续留在 Worker 上。

生产表现：

- 日志 MDC 突然丢 traceId，或拿到上一个请求的 traceId
- SkyWalking / OpenTelemetry 链路在异步边界断链
- 多租户上下文串号（Worker 保留了上一个任务残留的值）

`InheritableThreadLocal` 在线程池下不仅是"不生效"，还可能是"错误生效"——保留了错误的旧值。

## 5. 线程池下的正确解法：`TransmittableThreadLocal`

阿里开源的 `TransmittableThreadLocal`（TTL）解决的正是上一节的问题。核心思路是**把复制时机从"线程创建"改到"任务提交"**。

### 5.1 抓拍—回放模型

```txt
Main 线程                         Worker 线程
   │                                  │
   │ ttl.set("req-42")                │
   │                                  │
   │ executor.execute(                │
   │     TtlRunnable.get(task))       │
   │     │                            │
   │     ▼                            │
   │ 抓拍当前所有 TTL 的值            │
   │   snapshot = capture()           │
   │                                  │
   ├─────────────────────────────────►│  提交
   │                                  │
   │                                  │  执行前：
   │                                  │  backup = replay(snapshot)
   │                                  │  （把快照灌进 Worker 线程）
   │                                  │
   │                                  │  执行 task.run()
   │                                  │
   │                                  │  执行后：
   │                                  │  restore(backup)
   │                                  │  （还原 Worker 之前的值）
```

三个关键点：

- 在**包装任务时**抓拍（通常紧邻提交操作），而不是在 Worker 创建时抓拍；不要长期复用一个早已抓拍过上下文的任务包装对象
- 在**执行前**灌进 Worker，执行完**还原**，避免污染下一个任务
- 默认抓拍的是值引用，不是对象的深拷贝；需要隔离可变对象时，应通过自定义复制逻辑生成独立副本
- 抓拍与回放的开销通常随 TTL value 数量及其大小增长；具体量级依实现、对象生命周期和负载而变，需要基准测试

### 5.2 使用方式

```java
public class TraceContext {
    // 只需把 ThreadLocal 换成 TransmittableThreadLocal
    public static final TransmittableThreadLocal<String> TRACE_ID =
        new TransmittableThreadLocal<>();
}

// 方式一：任务提交时手动包装
executor.execute(TtlRunnable.get(() -> handle(request)));

// 方式二：把线程池整体包装一次，业务代码零改造
ExecutorService pool = TtlExecutors.getTtlExecutorService(rawPool);
pool.execute(() -> handle(request));

// 方式三：JVM 启动加 -javaagent:transmittable-thread-local.jar
// 通过字节码增强自动包装部分受支持的异步执行路径，减少手动包装；
// 不是对所有第三方线程池和异步框架的无条件覆盖，引入后需核对版本兼容性
```

### 5.3 TTL 的代价与边界

| 维度 | `ThreadLocal` | `InheritableThreadLocal` | `TransmittableThreadLocal` |
| :-- | :-- | :-- | :-- |
| 传递范围 | 当前线程 | 子线程（创建时快照） | 提交时快照，跨线程池有效 |
| 线程池场景 | 不传递 | ❌ 静默失效 | ✅ 生效 |
| 每次提交的开销 | 无 | 无 | 一次抓拍 + 一次回放 |
| 依赖 | JDK 内置 | JDK 内置 | 引入 TTL 库 |
| 与虚拟线程配合 | 正常 | 正常 | 需要注意 Agent 兼容性 |

TTL 不是免费午餐——每次任务提交都要抓拍所有已注册的 TTL 值。如果一个应用有几十个 TTL 且任务提交极其频繁（每秒百万级），抓拍的分配开销值得关注。

### 5.4 生产上的典型使用

[Spring 数据访问与事务](../../spring/04-data-access/chapter-04-transaction.md)、[Spring AOP](../../spring/01-core/chapter-05-aop.md)和链路追踪专题会展开这些组件；本章只点出它们与 `ThreadLocal` 的关系：

- **日志 MDC**（Logback / Log4j2）：`MDC.put("traceId", ...)` 底层就是一个 `ThreadLocal`；异步日志线程 / 异步任务需要 TTL 才能保留 traceId
- **Spring 事务传播**：`TransactionSynchronizationManager` 用 `ThreadLocal` 保存当前事务；`@Async` 场景下事务不会传递就是这个原因
- **Spring Security 上下文**：`SecurityContextHolder` 默认策略是 `ThreadLocal`；异步方法里拿不到用户凭证也是同源问题
- **SkyWalking / OpenTelemetry**：链路 span 依赖 `ThreadLocal` 保存当前 span，跨线程场景必须靠 TTL 或专门的 context propagation 包

## 6. 反模式一览

| 反模式 | 现象 | 正确做法 |
| :-- | :-- | :-- |
| `set` 后不 `remove` | 线程池场景内存泄漏 | try-finally 中强制 `remove()` |
| 用 `ThreadLocal` 存超大对象（缓存、图片、Full DTO） | 泄漏放大数十倍 | 只存必要的轻量上下文 |
| 在线程池间用 `InheritableThreadLocal` 传递 | traceId / 租户上下文静默丢失 | 换 TTL，或在提交前显式复制 |
| 一个 `ThreadLocal` 存多种业务字段（Map 混装） | 生命周期不齐、清理时机混乱 | 拆成多个语义单一的 `ThreadLocal` |
| 把 `ThreadLocal` 当"隐式参数"传递跨越太多层 | 代码可读性下降，重构风险高 | 显式方法参数优先，`ThreadLocal` 只在真正跨层的场景（日志、事务、追踪）用 |
| `set(null)` 当 `remove` 用 | 原 value 被置空，但 Entry/key 和槽位仍残留 | 明确调用 `remove()` |

## 7. 本章小结

| 问题 | 根源 | 解决方案 |
| :-- | :-- | :-- |
| 数据竞争 | 共享 + 可变 + 状态 | 从源头消除"共享"——线程封闭 |
| 内存泄漏 | value 强引用 + Worker 长期存活 | try-finally + `remove()` |
| 父子传递 | 复制时机受限于线程创建 | `InheritableThreadLocal`（不适用线程池） |
| 线程池跨提交传递 | 复制发生太早，快照过期 | `TransmittableThreadLocal` 抓拍—回放 |

`ThreadLocal` 是并发工具箱里最"反直觉"的一件——它不解决共享，而是干脆放弃共享。用得好，能把一整片同步代码变成无锁；用得不好，会带来更隐蔽的内存问题。

## 8. 下一步

ThreadLocal 通过线程封闭回避共享，但无法回答线程之间如何正确传递可见状态。下一步进入[Java 内存模型](./chapter-04-jmm.md)；线程池中的上下文丢失和泄漏可结合[线程池](./chapter-11-thread-pool.md)及[并发问题诊断](../06-diagnostics/02-concurrency/chapter-01-concurrency-diagnostics.md)排查。
