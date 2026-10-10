# 堆外内存：分配、释放与监控

堆外内存不受 JVM 堆规范直接约束，却会计入进程总内存。理解它的分配、释放和监控方式，才能解释“堆使用正常但进程仍被 OOMKilled”的现象，也才能判断问题究竟出在 Java 堆、直接缓冲区还是其他本地内存区域。

NIO 的具体使用见 [Java NIO](../04-java-network/chapter-05-nio.md)，堆外泄漏案例从[JVM 线上诊断](../06-diagnostics/01-jvm/chapter-01-jvm-diagnostics.md)进入。

## 1. 什么是堆外内存

堆外内存通常泛指 Java 堆之外、由 JVM 或本地代码管理的进程内存，例如线程栈、Metaspace、CodeCache 和直接缓冲区。它不在 JVM 运行时数据区的规范中，却会在实际工程中成为进程内存持续增长的原因。本页重点关注 `ByteBuffer.allocateDirect()` 创建的直接缓冲区。

### 1.1 堆内对象与堆外内存

普通 Java 对象分配在堆上，由 GC 自动回收。直接缓冲区则是通过 `ByteBuffer.allocateDirect()` 分配到堆外的**本地内存**，不受 GC 直接管理。

```txt
普通对象:
  new byte[1024]  →  分配在 Eden  →  GC 自动回收

堆外内存:
  ByteBuffer.allocateDirect(1024)  →  分配在本地内存  →  DirectByteBuffer 被 GC 时通过 Cleaner 释放
```

### 1.2 DirectByteBuffer 的释放路径 {#direct-bytebuffer-release}

`DirectByteBuffer` 本身是堆上的小对象，它关联的内存在堆外。堆外内存的释放通常依赖 `DirectByteBuffer` 被回收后触发的清理任务。[垃圾回收](./chapter-04-gc.md)会解释虚引用和引用队列，这里先建立直觉：

```txt
DirectByteBuffer（堆上，小对象）
  └─ 持有一个 Cleaner 对象
       └─ Cleaner 关联一个虚引用 + 回收动作（释放本地内存）

当 DirectByteBuffer 不再被任何 GC Root 引用 → GC 回收它
  → 虚引用被放入 ReferenceQueue
  → Cleaner 线程从队列中取出虚引用
  → 执行回收动作：Unsafe.freeMemory(address)
```

关键点：堆外内存的释放依赖 GC 触发。如果 GC 不频繁，大量 DirectByteBuffer 堆积在堆中，对应的堆外内存就一直不释放。这就是为什么 NIO 框架（如 Netty）会主动管理堆外内存，而不是依赖 GC。

## 2. NIO 为什么需要堆外内存

### 2.1 减少用户空间中的堆内存拷贝

传统的 I/O 操作需要在用户空间（堆）和内核空间之间拷贝数据：

```txt
使用 Java 堆缓冲区:
  内核缓冲区 → Java 堆缓冲区 → Socket/文件缓冲区
                 ↑ 需要在 JVM 堆与本地内存之间复制
```

使用直接缓冲区后，某些 I/O 路径可以减少一次到 Java 堆的拷贝：

```txt
使用直接缓冲区:
  内核缓冲区 ↔ 直接缓冲区 ↔ Socket/文件缓冲区
                  ↑ 可以减少一次到 JVM 堆的复制
```

这是 NIO 和 Netty 使用直接缓冲区的动机之一。实际复制次数取决于使用的 API、缓冲区复用方式和操作系统路径；直接缓冲区不会自动把所有 I/O 变成零拷贝，`sendfile()` 等零拷贝机制仍需显式使用。原理和取舍见 [Java NIO](../04-java-network/chapter-05-nio.md) 与 [Netty](../04-java-network/chapter-06-netty.md)。

## 3. 堆外内存为什么难以排查

### 3.1 不受 `-Xmx` 限制

`-Xmx4g` 只限制 Java 堆。直接缓冲区、线程栈、Metaspace 和 CodeCache 分别受各自机制控制。应用可能只使用了 2GB Java 堆，却因为直接缓冲区和线程栈占用了更多本地内存。

`jstat` 和堆内对象直方图只能反映 Java 堆，无法直接说明进程 RSS 为什么持续增长。诊断时应同时比较三组数据：

- 容器或进程的总内存，例如 RSS 以及 cgroup 内存限制。
- Java 堆使用量，例如 `jstat -gcutil`。
- JVM 本地内存分类和变化量，例如 NMT。

### 3.2 使用 NMT 观察本地内存变化

NMT 必须在 JVM 启动时开启。以下命令以 JDK 21 为例：

```bash
# 启动参数
-XX:NativeMemoryTracking=summary

# 查看当前分类
jcmd <pid> VM.native_memory summary scale=MB

# 记录基线；经过一段稳定运行后再比较
jcmd <pid> VM.native_memory baseline
jcmd <pid> VM.native_memory summary.diff scale=MB
```

```bash
# 示例输出（分类和数值随 JVM 与运行状态变化）：
#                   Total: reserved=6GB + committed=4GB
#        Java Heap (reserved=2GB, committed=2GB)
#        Class     (reserved=1GB, committed=500MB)
#        Thread    (reserved=500MB, committed=500MB)
#        Internal  (reserved=1GB, committed=1GB)
```

NMT 的分类、单位和具体归属会随 JDK 实现与版本变化。`summary` 适合先判断哪类本地内存增长；需要继续缩小到调用点时，可在目标 JVM 支持的情况下使用 `detail`，但采集开销和输出规模也会增加。

### 3.3 释放依赖 GC 和引用清理

释放时机见 [DirectByteBuffer 的释放路径](#direct-bytebuffer-release)。当分配速度超过清理速度时，堆外内存会持续增长；GC 越晚发生，清理通常也越晚。

```java
// 危险：在循环中分配大量 DirectByteBuffer
while (true) {
    ByteBuffer buf = ByteBuffer.allocateDirect(10 * 1024 * 1024);  // 10MB
    // buf 在下次 GC 前不会被释放
    // 如果循环速度快于 GC → 堆外内存持续增长 → OOM
}
```

## 4. 配置直接缓冲区上限

`-XX:MaxDirectMemorySize` 限制 `java.nio` 直接缓冲区的总容量，不限制线程栈、Metaspace 等其他本地内存。它限制的是缓冲区容量总和；由于分页对齐，实际占用的进程内存可能与容量不同。

| 参数 | 说明 |
| :-- | :-- |
| `-XX:MaxDirectMemorySize=256m` | 限制直接缓冲区总容量；未设置时由 JVM 自动选择上限 |
| `-XX:NativeMemoryTracking=summary` | 在 JVM 启动时开启 NMT，按分类收集本地内存用量 |
| `-XX:NativeMemoryTracking=detail` | 在 JVM 启动时记录更细的分配信息，开销高于 `summary` |

先限制直接缓冲区可以尽早暴露过度分配，但不能替代对缓冲区生命周期的管理。出现 `Cannot reserve ... direct buffer memory` 时，应同时确认业务是否确实需要这个容量，以及未释放的 `DirectByteBuffer` 是否持续累积。

## 5. 按症状定位问题

| 症状 | 优先检查 |
| :-- | :-- |
| Java 堆正常，但容器 RSS 持续增长 | cgroup 限制、NMT 分类差值、线程数、Metaspace、CodeCache |
| 直接缓冲区达到上限并抛出 OOM | `-XX:MaxDirectMemorySize`、缓冲区复用方式、未关闭的资源 |
| 堆外内存在释放后仍不下降 | `DirectByteBuffer` 是否仍可达、GC 是否触发、是否依赖应用层主动释放 |
| NMT 无法查询 | JVM 是否以 `-XX:NativeMemoryTracking=summary` 或 `detail` 启动 |

线上症状、命令输出和修复案例见 [TCP 层与堆外内存案例](../06-diagnostics/01-jvm/chapter-05-cases-offheap-network.md)。

> 本章覆盖了直接缓冲区的分配、释放、容量限制和基本监控。NIO 缓冲区的选择与使用见 [Java NIO](../04-java-network/chapter-05-nio.md)，完整故障案例从 [JVM 线上诊断](../06-diagnostics/01-jvm/chapter-01-jvm-diagnostics.md)进入。
