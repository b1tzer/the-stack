# 堆外内存：分配、释放与监控

堆外内存不受 JVM 堆规范直接约束，却会计入进程总内存。理解它的分配、释放和监控方式，才能解释“堆使用正常但进程仍被 OOMKilled”的现象，也才能判断问题究竟出在 Java 堆、直接缓冲区还是其他本地内存区域。

NIO 的具体使用见 [Java NIO](../04-java-network/chapter-05-nio.md)，堆外泄漏案例从[JVM 线上诊断](../06-diagnostics/01-jvm/chapter-01-jvm-diagnostics.md)进入。

## 1. 什么是堆外内存

堆外内存通常泛指 Java 堆之外、由 JVM 或本地代码管理的进程内存，例如线程栈、Metaspace、CodeCache 和直接缓冲区。它不在 JVM 运行时数据区的规范中，却会在实际工程中成为进程内存持续增长的原因。本页重点关注 `ByteBuffer.allocateDirect()` 创建的直接缓冲区。

### 1.1 堆内对象与堆外内存

普通 Java 对象分配在堆上，由 GC 自动回收。直接缓冲区则是通过 `ByteBuffer.allocateDirect()` 分配到堆外的**本地内存**，不受 GC 直接管理。

```txt
普通对象:
  new byte[1024]  →  Java 堆  →  不再可达后由 GC 回收

直接缓冲区:
  ByteBuffer.allocateDirect(1024)
    →  堆上的 DirectByteBuffer + 本地数据区
    →  清理动作释放本地数据区
```

### 1.2 DirectByteBuffer 的释放路径 {#direct-bytebuffer-release}

`ByteBuffer.allocateDirect()` 创建的 `DirectByteBuffer` 是堆上的 Java 对象，缓冲区的数据区位于本地内存。以 JDK 21 的典型 HotSpot 实现为例，直接缓冲区会关联清理对象及释放本地内存的动作：

```txt
ByteBuffer.allocateDirect(size)
  → 创建堆上的 DirectByteBuffer
  → 在本地内存分配数据区，并注册清理动作

DirectByteBuffer 不再被强可达引用保留
  → GC 的引用处理识别到相应的清理条件
  → Cleaner 执行清理动作
  → 释放本地内存，并更新直接缓冲区的内存计数
```

这条链路不是同步析构。对象变得不可达，不等于本地内存会在同一时刻释放；引用处理和清理任务还需要执行。应用也不应依赖某次 GC 必然及时释放某个直接缓冲区。

直接缓冲区分配速度很快、清理又跟不上时，本地内存可能在一段时间内持续增长。需要明确控制生命周期的代码，应考虑可显式管理生命周期的缓冲区或内存段方案，而不是把 GC 当成确定的释放时钟。这就是为什么 NIO 框架（如 Netty）会主动管理堆外内存，而不是依赖 GC。

## 2. NIO 为什么需要堆外内存

### 2.1 为什么直接缓冲区可能减少复制

Java 堆是用户空间内存的一部分，但用户空间不等于 Java 堆。使用堆缓冲区执行某些 NIO 操作时，JDK 可能需要通过临时的直接缓冲区在 Java 堆与本地 I/O 接口之间复制数据；直接缓冲区的数据区位于本地内存，某些 I/O 路径可以直接使用这块内存，从而减少中间复制。

是否减少复制以及减少几次，取决于具体 API、操作系统和实现。直接缓冲区并不等于零拷贝，`sendfile()` 等机制是另一类需要单独理解的技术。原理和取舍见 [Java NIO](../04-java-network/chapter-05-nio.md) 与 [Netty](../04-java-network/chapter-06-netty.md)。

## 3. 堆外内存为什么难以排查

### 3.1 不受 `-Xmx` 限制

`-Xmx4g` 只限制 Java 堆。直接缓冲区、线程栈、Metaspace 和 CodeCache 分别受各自机制控制。应用可能只使用了 2GB Java 堆，却因为直接缓冲区和线程栈占用了更多本地内存。

`jstat` 的常用选项可以观察 GC、类加载等运行状态，堆内对象直方图则用于了解 Java 堆中各类对象的数量和占用。它们不能单独解释进程 RSS 的全部变化。诊断时应同时比较三组数据：

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
# 以下为格式示意，不是一次真实运行的完整输出：
# Native Memory Tracking:
#
# Total: reserved=6144MB, committed=4096MB
# -                 Java Heap (reserved=2048MB, committed=2048MB)
# -                     Class (reserved=1024MB, committed=512MB)
# -                    Thread (reserved=512MB, committed=256MB)
```

实际输出还会包含其他分类和更细的 malloc、mmap 等信息；分类名称、字段和数值取决于目标 JVM 及运行状态。不要把这里的示意值当成相互精确对应的真实内存账目。

NMT 的 reserved 表示 JVM 为相关内存区域预留的地址空间，committed 表示已提交的部分；两者都不能直接当作进程 RSS。NMT 只覆盖它能够跟踪的 JVM 内部内存，不能替代操作系统层面的进程和容器内存监控。`summary` 适合先判断哪类本地内存增长；需要继续缩小到调用点时，可在目标 JVM 支持的情况下使用 `detail`，但采集开销和输出规模也会增加。

NMT 主要跟踪 HotSpot 内部内存，不是整个进程的完整内存分配账本。直接缓冲区、JNI 代码或第三方本地库的内存，不能假设都会完整出现在 NMT 分类中。排查直接缓冲区增长时，应额外观察 `BufferPoolMXBean` 提供的 direct 缓冲区指标：

```java
import java.lang.management.BufferPoolMXBean;
import java.lang.management.ManagementFactory;

for (BufferPoolMXBean pool : ManagementFactory.getPlatformMXBeans(BufferPoolMXBean.class)) {
    if ("direct".equals(pool.getName())) {
        System.out.printf("count=%d, totalCapacity=%d MB, memoryUsed=%d MB%n",
                pool.getCount(),
                pool.getTotalCapacity() / 1024 / 1024,
                pool.getMemoryUsed() / 1024 / 1024);
    }
}
```

这些指标也不是整个进程的内存总量，但更适合直接观察 JVM 暴露的直接缓冲区池。若 RSS 持续增长，而 Java 堆和这些指标都没有相应变化，再结合 NMT、线程数、JNI 或本地库分配情况继续缩小范围。

### 3.3 释放依赖 GC 和引用清理

释放时机见 [DirectByteBuffer 的释放路径](#direct-bytebuffer-release)。当分配速度超过清理速度时，堆外内存会持续增长；GC 越晚发生，清理通常也越晚。

```java
while (true) {
    ByteBuffer buf = ByteBuffer.allocateDirect(10 * 1024 * 1024);

    // 示例：如果持续快速分配，而旧缓冲区的清理跟不上，
    // 直接缓冲区的容量或本地内存可能持续增长。
}
```

这段代码用于说明风险，不是一个每次运行都会稳定复现 OOM 的测试。实际表现取决于分配速度、引用可达性、GC 和 Cleaner 的执行进度，以及直接缓冲区容量上限。生产代码应复用缓冲区，或采用明确的资源生命周期管理，不要依赖"不断创建对象，等 GC 自己清理"来管理大量直接内存。

## 4. 配置直接缓冲区上限

`-XX:MaxDirectMemorySize` 限制的是 `java.nio` 直接缓冲区的容量总和，不是整个进程的本地内存上限，也不是对 RSS 的限制。HotSpot 会分别跟踪直接缓冲区的总容量和实际为其分配的本地内存大小，两者可能不同，例如页对齐会带来额外分配。因此，即使直接缓冲区容量没有超过该参数的上限，进程的实际内存占用仍可能更高；线程栈、Metaspace、CodeCache、JNI 和其他本地分配也不受这个参数统一限制。如果未显式设置，JVM 会自动选择直接缓冲区分配上限，具体值应以目标 JDK 和运行环境为准，不能简单理解为"默认无限制"。

| 参数 | 说明 |
| :-- | :-- |
| `-XX:MaxDirectMemorySize=256m` | 限制直接缓冲区总容量；未设置时由 JVM 自动选择上限 |
| `-XX:NativeMemoryTracking=summary` | 在 JVM 启动时开启 NMT，按分类收集本地内存用量 |
| `-XX:NativeMemoryTracking=detail` | 在 JVM 启动时记录更细的分配信息，开销高于 `summary` |

设置 `MaxDirectMemorySize` 可以限制直接缓冲区容量的增长，并让超出上限的分配较早失败，但它不会自动解决缓冲区泄漏。遇到 `Cannot reserve ... direct buffer memory` 时，应同时检查当前直接缓冲区容量、缓冲区创建和复用方式、引用是否仍然存活，以及清理是否跟得上分配速度；不要在未确认原因时只提高上限。

## 5. 按症状定位问题

| 症状 | 优先检查 |
| :-- | :-- |
| Java 堆正常，但容器 RSS 持续增长 | cgroup 限制、NMT 分类差值、线程数、Metaspace、CodeCache |
| 直接缓冲区达到上限并抛出 OOM | `-XX:MaxDirectMemorySize`、缓冲区复用方式、未关闭的资源 |
| 堆外内存在释放后仍不下降 | `DirectByteBuffer` 是否仍可达、GC 是否触发、是否依赖应用层主动释放 |
| NMT 无法查询 | JVM 是否以 `-XX:NativeMemoryTracking=summary` 或 `detail` 启动 |
| RSS 持续增长，但 NMT 分类变化不明显 | `BufferPoolMXBean` 的 direct 指标、JNI 和第三方本地库分配、线程栈、容器内存统计 |

线上症状、命令输出和修复案例见 [TCP 层与堆外内存案例](../06-diagnostics/01-jvm/chapter-05-cases-offheap-network.md)。

> 本章覆盖了直接缓冲区的分配、释放、容量限制和基本监控。NIO 缓冲区的选择与使用见 [Java NIO](../04-java-network/chapter-05-nio.md)，完整故障案例从 [JVM 线上诊断](../06-diagnostics/01-jvm/chapter-01-jvm-diagnostics.md)进入。
