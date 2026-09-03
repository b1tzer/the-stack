# 并发集合：为共享数据挑一把合适的容器

> 多线程直接用 `HashMap` 会出什么问题？`ConcurrentHashMap` 从 JDK 7 到 JDK 8 换掉了 Segment，靠什么把并发度撑起来？想要一个"读完全无锁"的队列，代价是什么？

前面的章节讲的是**如何用锁、原子类、AQS 保护共享变量**。这一章换个视角：**JDK 已经把常见的并发场景封装成了容器**——`ConcurrentHashMap`、`CopyOnWriteArrayList`、`ConcurrentLinkedQueue`、`BlockingQueue` 家族。理解它们的内部结构，一是能选对；二是能推理性能形态——什么场景下这个容器会退化、什么场景下它比自己加锁快十倍。

## 1. 普通集合为什么不能并发使用

Java 标准库里 `ArrayList` / `HashMap` / `TreeMap` 的 Javadoc 都写着一句几乎相同的话："If multiple threads access an instance concurrently, and at least one of the threads modifies it structurally, it must be synchronized externally." 这不是建议，是硬性约束。

### 1.1 `ArrayList` 的 `size++` 竞态

`ArrayList.add()` 简化到最短：

```java
public boolean add(E e) {
    ensureCapacityInternal(size + 1);
    elementData[size++] = e;
    return true;
}
```

`size++` 在字节码层面是三步（读、加、写）。两线程并发：

```txt
线程 A: 读 size=5
线程 B: 读 size=5          ← A 还没写回
线程 A: elementData[5]=a, size=6
线程 B: elementData[5]=b, size=6   ← 覆盖了 A 的写
```

结果：**一次自增被吞掉**、一个位置被覆盖，`elementData` 里丢了一个元素；`size` 也可能出现"越界指向 null 位置"，触发后续 `ArrayIndexOutOfBoundsException`。这是最经典的"丢更新 + 结构损坏"复合症状。

### 1.2 `HashMap` 的死循环（JDK 7）

JDK 7 的 `HashMap` 有一个上过面试题几百次的 bug：**并发扩容时可能形成环形链表，导致 `get()` 死循环、CPU 100%**。

根因是 JDK 7 扩容用**头插法**迁移链表：

```txt
扩容前旧桶：A → B → null

线程 1 迁移到新桶（头插法）：B → A
线程 2 同时迁移到新桶（也头插）：A → B

若两条线程的迁移交叉，可能形成：
     A.next = B, B.next = A     ← 环
```

`get()` 触发到这个桶时沿着 `next` 走进环，永远不返回。

JDK 8 换成**尾插法**——迁移时保持链表原顺序，从根本上消除了环形链表。**但 `HashMap` 本身仍然不是线程安全的**：数据丢失、`resize` 期间读到中间状态、并发 put 的结构损坏都还存在。JDK 8 只是修了那一个死循环。

### 1.3 一张表总结普通集合的并发风险

| 集合 | 并发问题 | 根因 |
| :-- | :-- | :-- |
| `ArrayList` | 元素丢失、越界异常 | `size++` 非原子 |
| `HashMap`（JDK 7） | 死循环、数据丢失 | 头插法扩容 + 无同步 |
| `HashMap`（JDK 8） | 数据丢失、`resize` 中间态 | 无同步 |
| `HashSet` | 同 `HashMap` | 底层是 `HashMap` |
| `TreeMap` | 数据丢失、红黑树结构损坏 | 并发修改破坏树平衡 |

粗粒度的 `Collections.synchronizedMap` 能修正确性问题，代价是把整个 Map 变成串行访问——高并发下等于自杀。这是并发集合存在的意义：**用更细的粒度、或者干脆无锁的算法，把安全与并发度同时保住**。

## 2. `ConcurrentHashMap`：从 Segment 到 bin 级锁

`ConcurrentHashMap` 是 `java.util.concurrent` 里用得最多的容器。它的实现在 JDK 7 到 JDK 8 之间发生了一次结构性重写。

### 2.1 JDK 7：Segment 分段锁

思路是**分段加锁**——把整个 Map 切成若干段（Segment），每段有独立的锁，不同段的操作可以并行：

```txt
ConcurrentHashMap（JDK 7）
├── Segment[0]  (ReentrantLock) → HashEntry[] → 链表
├── Segment[1]  (ReentrantLock) → HashEntry[] → 链表
├── ...
└── Segment[15] (ReentrantLock) → HashEntry[] → 链表
    默认 16 段，并发度上限 = 16
```

核心结构：

```java
static final class Segment<K,V> extends ReentrantLock {
    transient HashEntry<K,V>[] table;
    transient int count;
}

final Segment<K,V>[] segments;   // 默认 16
```

**定位是两级 hash**：hash 的高位定位 Segment，低位定位 HashEntry。读操作靠 `volatile` 保证可见性，不加锁。

局限也直接摆在设计里：

- **并发度上限固定**——默认 16，构造后不可扩
- **热点 key 集中在少数 Segment**：并发度退化到几乎为 1
- **Segment 本身占内存**：每个 Segment 都是一个 `ReentrantLock` + 独立的 `HashEntry[]`

### 2.2 JDK 8：CAS + `synchronized` 锁 bin

JDK 8 抛弃了 Segment，回到**单个 `Node[]` 数组 + bin 级锁**：

```txt
ConcurrentHashMap（JDK 8+）
Node[] table
├── [0] → Node → Node → Node（链表）
├── [1] → null
├── [2] → TreeBin → 红黑树（链表长度 > 8 且表容量 ≥ 64 时转树）
├── [3] → Node
└── ...
锁粒度：单个 bin
```

`putVal` 的核心骨架：

```java
final V putVal(K key, V value, boolean onlyIfAbsent) {
    for (Node<K,V>[] tab = table;;) {
        Node<K,V> f; int n, i, fh;
        if (tab == null || (n = tab.length) == 0)
            tab = initTable();                              // CAS 初始化

        else if ((f = tabAt(tab, i = (n - 1) & hash)) == null) {
            // 空 bin：一次 CAS 直接插入，完全无锁
            if (casTabAt(tab, i, null, new Node<>(hash, key, value)))
                break;

        } else if ((fh = f.hash) == MOVED) {
            tab = helpTransfer(tab, f);                      // 参与扩容

        } else {
            // 非空 bin：只锁这个 bin 的头节点
            synchronized (f) {
                if (tabAt(tab, i) == f) {                    // 二次校验
                    // 链表或红黑树的插入逻辑
                }
            }
        }
    }
}
```

两个关键设计点：

- **空 bin 走 CAS**：完全无锁，写热点分散到不同 bin 时几乎无竞争
- **非空 bin 走 `synchronized`**：锁粒度到"单个 bin 的头节点"，比 Segment 细一个数量级

### 2.3 JDK 8 为什么从 `ReentrantLock` 换回 `synchronized`

反直觉的一件事：JDK 7 用的是 `ReentrantLock`（因为 Segment 继承它），JDK 8 换成了 `synchronized`。三个直接的原因：

- **JDK 6 之后 `synchronized` 已经不慢**：偏向锁、轻量级锁、锁消除、锁粗化把无竞争场景的开销压到几乎为零（第 6 章 §6.5、§6.6）。
- **粒度更细意味着单锁的竞争度更低**：每个 bin 的头节点独立当锁，绝大多数并发写落到不同 bin 上，走的都是偏向锁 / 轻量级锁路径。
- **`synchronized` 内部由 JVM 管理，减少对象元数据**：`ReentrantLock` 本身是 Java 对象，每个 Segment 都要单独维护同步状态；`synchronized` 直接用 Node 的对象头，节省内存。

### 2.4 `size()` 的分散计数

并发计数最容易撞的坑是"所有线程 CAS 同一个变量"。JDK 8 用 **`baseCount` + `CounterCell[]`** 分散热点：

```java
long baseCount;                    // 无竞争时直接 CAS 这个
volatile CounterCell[] counterCells;// 竞争激烈时打散到多个 Cell

public int size() {
    long sum = baseCount;
    if (counterCells != null) {
        for (CounterCell c : counterCells) {
            if (c != null) sum += c.value;
        }
    }
    return (sum > Integer.MAX_VALUE) ? Integer.MAX_VALUE : (int) sum;
}
```

这套思路和 `LongAdder`（第 7 章 §7.5）完全一致——**同一套代码在两个地方用**。代价是 `size()` 是"接近实时"的估算，不保证瞬时精确。

### 2.5 JDK 7 vs JDK 8 一览

| 维度 | JDK 7 Segment | JDK 8+ CAS + `synchronized` |
| :-- | :-- | :-- |
| 锁粒度 | 一整个 Segment（默认 16 个） | 单个 bin 的头节点 |
| 并发度上限 | 16 | bin 数（通常上千） |
| 空 bin 写入 | 需持 Segment 锁 | 一次 CAS 完成 |
| 数据结构 | 链表 | 链表 + 红黑树（长度 > 8 转树） |
| 锁类型 | `ReentrantLock` | `synchronized`（走锁升级） |
| 计数 | 每个 Segment 计数 | `baseCount` + `CounterCell[]` |

## 3. `CopyOnWrite` 容器：读完全无锁

`CopyOnWriteArrayList` / `CopyOnWriteArraySet` 的思路和 `ConcurrentHashMap` 完全不同：**读端根本不加锁**，写端通过复制整个底层数组来隔离读写。

### 3.1 写时复制的工作过程

```txt
当前数组：[A, B, C, D]   ← array 引用指向这里

线程 T1 执行 add(E)：
  1. 拿写锁（保证写-写互斥）
  2. 复制数组 → [A, B, C, D, null]
  3. 新数组尾部写入 E → [A, B, C, D, E]
  4. array = newArray（volatile 写发布）
  5. 释放写锁
```

核心代码简化：

```java
public class CopyOnWriteArrayList<E> {
    private transient volatile Object[] array;

    public boolean add(E e) {
        synchronized (lock) {                   // 写-写互斥
            Object[] old = array;
            Object[] neu = Arrays.copyOf(old, old.length + 1);
            neu[old.length] = e;
            array = neu;                        // volatile 写，读端立即可见
            return true;
        }
    }

    @SuppressWarnings("unchecked")
    public E get(int index) {
        return (E) array[index];                // 无锁读
    }
}
```

读的成本 = 一次数组访问，**没有 CAS、没有屏障之外的任何同步开销**。

### 3.2 迭代器是"快照"

`CopyOnWriteArrayList.iterator()` 拿到的是**创建那一刻的 `array` 引用**，之后无论谁 add / remove，迭代器一无所知：

```java
CopyOnWriteArrayList<String> list = new CopyOnWriteArrayList<>();
list.add("A");
list.add("B");

Iterator<String> it = list.iterator();     // 拿到 [A, B] 的快照

list.add("C");                              // 不影响 it

while (it.hasNext()) {
    print(it.next());                       // 只输出 A、B
}
```

这解决了 `ArrayList` 常见的 `ConcurrentModificationException`——迭代期间不会因为并发修改而抛异常。代价是**读到的可能是旧数据**（弱一致性）。

### 3.3 写成本 O(N) 决定了适用场景

| 维度 | 优势 | 代价 |
| :-- | :-- | :-- |
| 读 | 完全无锁，性能等同于普通数组访问 | 可能读到旧数据 |
| 写 | 不阻塞任何读 | 每次写复制整个数组，O(N) 时间和内存 |
| 迭代 | 不抛 `ConcurrentModificationException` | 迭代的是快照，不含期间新加的元素 |

适合"**读远大于写、且写发生频率很低、数据量不太大**"的场景：

- 事件监听器列表
- 白名单 / 黑名单 / 路由表
- 应用启动时加载、运行期极少变的配置

不适合任何需要频繁写的场景——写 100 万次意味着复制 100 万次整个数组。

### 3.4 一个典型用法

```java
public class EventBus {
    private final CopyOnWriteArrayList<Listener> listeners = new CopyOnWriteArrayList<>();

    public void register(Listener l)   { listeners.add(l); }
    public void unregister(Listener l) { listeners.remove(l); }

    public void fire(Event e) {
        for (Listener l : listeners) {         // 无锁遍历
            l.onEvent(e);
        }
    }
}
```

listeners 变化频率极低（一般只在启动或组件生命周期变化时），fire 高频调用。这是 CopyOnWrite 最舒服的场景。

## 4. `ConcurrentSkipListMap`：有序并发

`ConcurrentHashMap` 不保证遍历顺序。需要"线程安全 + 按 key 有序 + 支持范围查询"时，`ConcurrentSkipListMap` 是标准答案。

### 4.1 跳表结构

跳表（Skip List）是一种概率平衡的有序数据结构。它通过多层索引加速查找：

```txt
Level 3:  head ──────────────────────────► 50 ────────────────► null
Level 2:  head ─────────► 20 ─────────────► 50 ────► 70 ──────► null
Level 1:  head ► 10 ────► 20 ────► 30 ────► 50 ────► 70 ► 80 ─► null
```

查找 `50`：从 Level 3 直接跳到 50，一步命中。平均查找 O(log N)，与红黑树相当，**但插入 / 删除只需要调整链表指针，不涉及旋转**——这也是它比红黑树更适合并发的原因。

### 4.2 无锁插入的关键机制

`ConcurrentSkipListMap.put` 完全靠 CAS 完成，不使用 `synchronized`：

- 定位插入点后，用 CAS 修改前驱节点的 `next` 指针，把新节点接入
- CAS 失败说明其他线程改动了前驱，重新定位再试
- 索引层的建立也是 CAS——概率性地决定新节点建到哪一层

这套无锁算法让 `ConcurrentSkipListMap` 的读写都不需要加锁，代价是弱一致性（遍历时可能看到并发写入的中间状态，但不会抛异常）。

### 4.3 与 `ConcurrentHashMap` 的选型

| 维度 | `ConcurrentHashMap` | `ConcurrentSkipListMap` |
| :-- | :-- | :-- |
| 顺序 | 无 | 按 key 有序 |
| 底层 | 数组 + 链表 / 红黑树 | 跳表 |
| 查找 | O(1) 平均 | O(log N) |
| 范围查询 | 不支持 | `subMap` / `headMap` / `tailMap` |
| 典型场景 | 通用并发 Map | 需要排序或范围查询 |

代表场景：时间线索引（key 是时间戳）、按分数排名的排行榜、按前缀过滤的路由表。

## 5. 无锁队列与阻塞队列

队列是线程池、Reactor、事件总线、日志异步落盘的底层零件。JDK 里有两大家族：**无锁队列**（`ConcurrentLinkedQueue` / `LinkedTransferQueue`）与**阻塞队列**（`BlockingQueue` 家族）。

### 5.1 `ConcurrentLinkedQueue`：Michael-Scott 算法的直接实现

`ConcurrentLinkedQueue` 是无界、无锁、线程安全的 FIFO 队列。它的实现是 Michael 和 Scott 在 1996 年发表的**M&S 无锁队列算法**——教科书级的经典。

核心结构极简：

```java
private transient volatile Node<E> head;
private transient volatile Node<E> tail;

static final class Node<E> {
    volatile E item;
    volatile Node<E> next;
}
```

**入队（`offer`）的两步 CAS**：

```txt
初始：  head → dummy ── tail
                ▲
             (next=null)

线程 A 入队 X：
  1. CAS 把 tail.next 从 null 改成 new Node(X)   ← 关键第一步
       head → dummy → X
                       ▲
                     (tail 还没动)
  2. CAS 把 tail 从原节点改到 new Node             ← 关键第二步
       head → dummy → X
                       ▲
                      tail
```

两步中间可能被别的线程"抢跑"——但没关系。M&S 算法的巧妙在于：**任何看到 `tail.next != null` 的线程都会帮忙推进 `tail`**，然后再尝试自己的入队：

```java
public boolean offer(E e) {
    final Node<E> newNode = new Node<E>(Objects.requireNonNull(e));
    for (Node<E> t = tail, p = t;;) {
        Node<E> q = p.next;
        if (q == null) {
            // 找到"真正的尾节点"，尝试挂上新节点
            if (p.casNext(null, newNode)) {
                if (p != t)
                    casTail(t, newNode);          // 尽力推进 tail，失败也无妨
                return true;
            }
        } else if (p == q) {
            // 遇到自引用（因为节点被出队），重新定位
            p = (t != (t = tail)) ? t : head;
        } else {
            // tail 落后了，跳到 q 继续找
            p = (p != t && t != (t = tail)) ? t : q;
        }
    }
}
```

**关键理解**：`tail` 允许"暂时落后于真实尾"。JVM 依靠"任何线程发现 tail 落后都可以帮忙推进"这条协作规则，把整个入队过程做成完全无锁——**没有一处 `synchronized`，也没有一次 park**。

**出队（`poll`）同样两步 CAS**：把 `head.next.item` CAS 成 null 取出数据，再 CAS 推进 head。

### 5.2 无锁队列的正确性来源

无锁队列听着神奇——没有锁，凭什么保证并发正确？三个关键点：

- **CAS 是原子操作**：任何 CAS 要么整体成功，要么整体失败，不存在中间态
- **协作性算法**：任何看到"中间态"的线程都会主动帮忙推进到"完全态"（推 tail、跳过被移除节点）
- **失败即重试**：`for(;;)` 循环让失败线程立刻重试，不阻塞、不 park

M&S 队列是**无锁**（lock-free）而非**无等待**（wait-free）——不能保证每条线程都在有限步内完成，但保证整体上一定有线程在推进（不会全体死锁）。

### 5.3 `size()` 是 O(N)

一个必须记住的坑：`ConcurrentLinkedQueue.size()` **不是 O(1)**——它遍历整个队列计数：

```java
public int size() {
    int count = 0;
    for (Node<E> p = first(); p != null; p = succ(p)) {
        if (p.item != null)
            if (++count == Integer.MAX_VALUE)
                break;
    }
    return count;
}
```

原因是无锁算法里没法用 `AtomicInteger` 维护精确计数——每次入队 / 出队都用 CAS 更新一个全局计数会成为热点，反而拖垮性能。**生产代码里对 `ConcurrentLinkedQueue` 频繁调 `size()` 是常见反模式**：直接把 O(1) 期望的接口用出了 O(N) 的成本。

### 5.4 `LinkedTransferQueue`：`ConcurrentLinkedQueue` + 传递语义

`LinkedTransferQueue`（JDK 7 引入）是同源家族里的加强版：**同时是无锁队列，又支持"必须有消费者才成功"的传递语义**：

```java
LinkedTransferQueue<Task> queue = new LinkedTransferQueue<>();

// offer / put：立即返回，行为等同 ConcurrentLinkedQueue
queue.put(task);

// transfer：阻塞直到有消费者 take 到这个元素
queue.transfer(task);         // 一直等
queue.tryTransfer(task);       // 立即失败版
queue.tryTransfer(task, 1, TimeUnit.SECONDS);   // 超时版
```

三种语义在一个容器里：

| 方法 | 语义 | 用途 |
| :-- | :-- | :-- |
| `offer` / `put` | 入队立即返回，不等消费者 | 常规异步队列 |
| `transfer` | 阻塞到消费者取走 | 强"交接"场景 |
| `tryTransfer` | 只有消费者已在等时才成功 | 探测式提交 |

`LinkedTransferQueue` 底层用一种叫 **双队列（dual queue）** 的算法——同一条链表里同时保存"待消费的数据节点"和"等待数据的消费者节点"。入队时如果发现链尾是"等待消费者"节点，直接把数据塞给他；如果是"数据"节点，就把自己挂到尾部。

它比 `SynchronousQueue` 更灵活（因为可以 `offer` 不等）、比 `ConcurrentLinkedQueue` 更强大（因为可以 `transfer` 等）。**生产上凡是同时需要"异步入队 + 偶尔精确交接"的场景，都优先考虑 `LinkedTransferQueue`**。

### 5.5 `BlockingQueue` 家族一览

`BlockingQueue` 的核心语义：**队列满时 `put` 阻塞，队列空时 `take` 阻塞**。天然适合生产者-消费者模型。JDK 提供五种实现：

| 实现 | 边界 | 底层 | 锁数量 | 特点 |
| :-- | :-- | :-- | :-- | :-- |
| `ArrayBlockingQueue` | 有界 | 数组 | 1 把锁 | 简单、通用；put/take 互相阻塞 |
| `LinkedBlockingQueue` | 可选有界（默认 `Integer.MAX_VALUE`） | 单链表 | 2 把锁（put/take 分离） | 高吞吐；默认无界要小心 OOM |
| `SynchronousQueue` | 0（不存储） | 无 | CAS / 锁 | put 与 take 必须配对，"握手"传递 |
| `PriorityBlockingQueue` | 无界 | 二叉堆 | 1 把锁 | 按优先级出队 |
| `DelayQueue` | 无界 | `PriorityQueue` | 1 把锁 | 元素延时到期后才可出队 |

其中 `LinkedBlockingQueue` 的**两把锁**设计（`putLock` 和 `takeLock`）是它高吞吐的核心——生产者和消费者可以真正并行，而非 `ArrayBlockingQueue` 那种交替执行。

### 5.6 生产者-消费者的标准形态

```java
BlockingQueue<Task> queue = new ArrayBlockingQueue<>(1000);

// 生产者
new Thread(() -> {
    while (!Thread.currentThread().isInterrupted()) {
        Task t = createTask();
        queue.put(t);                         // 满则阻塞
    }
}).start();

// 消费者
new Thread(() -> {
    while (!Thread.currentThread().isInterrupted()) {
        Task t = queue.take();                // 空则阻塞
        process(t);
    }
}).start();
```

对比第 6 章 §6.3 那种自己写 `wait/notify` 的版本，`BlockingQueue` 少了三个坑：条件判断的 `while` 循环、`notifyAll` 惊群、忘了持锁的 `IllegalMonitorStateException`。所有这些都被封装到容器里。

### 5.7 三类队列的选型

| 需求 | 推荐 |
| :-- | :-- |
| 只是异步队列、不需要限流、不需要阻塞 | `ConcurrentLinkedQueue` |
| 生产者-消费者、需要"满则阻塞、空则阻塞"、可控内存 | `ArrayBlockingQueue`（有界） / `LinkedBlockingQueue`（显式指定容量） |
| 生产者-消费者、且需要"必须交给消费者才成功"的精确交接 | `LinkedTransferQueue` 或 `SynchronousQueue` |
| 按优先级消费 | `PriorityBlockingQueue` |
| 定时消费（延迟队列） | `DelayQueue` |

第 10 章 `ThreadPoolExecutor` 的 `workQueue` 就是从这里挑一种——不同队列直接决定线程池的调度形态（第 10 章 §10.2）。

## 6. 选型：安全、并发度、开销的三角权衡

并发容器的差异，本质是三个维度上的取舍：

```txt
             安全性
             /    \
            /      \
      并发度 ────── 内存 / 时间开销
```

`ConcurrentHashMap` 在三角形中间——安全、并发度高、开销中等。其他容器都是"某个维度极致 + 某个维度让步"：

| 容器 | 安全 | 并发度 | 主要开销 |
| :-- | :-- | :-- | :-- |
| `ConcurrentHashMap` | ✅ | 高（bin 级锁） | 中（数组 + Node） |
| `CopyOnWriteArrayList` | ✅ | 读极高、写极低 | 高（O(N) 内存复制） |
| `ConcurrentLinkedQueue` | ✅ | 高（无锁） | `size()` 是 O(N) |
| `LinkedTransferQueue` | ✅ | 高（无锁 + 传递） | 结构复杂、`size()` 也是 O(N) |
| `ArrayBlockingQueue` | ✅ | 中（一把锁） | 内存固定 |
| `LinkedBlockingQueue` | ✅ | 较高（两把锁） | 默认无界 → 潜在 OOM |
| `Collections.synchronizedMap` | ✅ | 极低（全局锁） | 简单，兜底方案 |

判断选哪个的一条起手线：**先想清楚读写比、有无顺序需求、能不能容忍弱一致性**。三个问题回答完，选型基本就出来了。

## 7. 本章小结

| 问题 | 根源 | 解决方案 |
| :-- | :-- | :-- |
| `ArrayList.add` 丢元素 | `size++` 非原子 | 用 `CopyOnWriteArrayList` 或外部同步 |
| `HashMap` 死循环（JDK 7） | 头插法 + 并发扩容 | JDK 8 尾插法；生产用 `ConcurrentHashMap` |
| Segment 并发度上限固定 | 段数构造后不可变 | JDK 8 换 bin 级锁 |
| 精确计数成为写热点 | 单个 `AtomicLong` CAS 争抢 | `baseCount + CounterCell[]` 分散计数 |
| 需要"读无锁"的容器 | 常规锁读写都要竞争 | `CopyOnWriteArrayList`（写时复制） |
| 需要"排序 + 并发"的 Map | 无 | `ConcurrentSkipListMap`（跳表） |
| 需要"无阻塞"的 FIFO 队列 | 阻塞队列 put/take 都要 park | `ConcurrentLinkedQueue`（M&S 算法） |
| 需要"精确交接"的队列 | `SynchronousQueue` 太受限 | `LinkedTransferQueue` |
| `size()` O(N) 陷阱 | 无锁队列不维护实时计数 | 不要频繁调 `size()`，用其他指标监控 |
| 生产者-消费者语义 | 手写 `wait/notify` 易错 | `BlockingQueue` 家族 |
