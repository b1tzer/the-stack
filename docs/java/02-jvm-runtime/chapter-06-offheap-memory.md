# 堆外内存：分配、释放与监控

堆外内存不受 JVM 堆规范直接约束，却会计入进程总内存。理解它的分配、释放和监控方式，才能解释“堆使用正常但进程仍被 OOMKilled”的现象，也才能判断问题究竟出在 Java 堆、直接缓冲区还是其他本地内存区域。

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

### 1.2 DirectByteBuffer 的释放路径

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

`-Xmx4g` 只限制 Java 堆。堆外内存另外计算。一个应用可能堆只用了 2GB，但堆外内存用了 3GB，总内存 5GB。

```bash
# 如果 JVM 启动时已开启 NMT，查看本地内存分类
jcmd <pid> VM.native_memory summary

# 输出示例:
#                    Total:  reserved=6GB  +  committed=4GB
#        Java Heap (reserved=2GB, committed=2GB)
#        Class (reserved=1GB, committed=500MB)
#        Thread (reserved=500MB, committed=500MB)
#        Internal (reserved=1GB, committed=1GB)   ← 这里包含堆外内存
```

### 3.2 释放依赖 GC 和引用清理

释放时机见 [1.2 DirectByteBuffer 的释放路径](#12-directbytebuffer-的释放路径)。当分配速度超过清理速度时，堆外内存会持续增长；GC 越晚发生，清理通常也越晚。

```java
// 危险：在循环中分配大量 DirectByteBuffer
while (true) {
    ByteBuffer buf = ByteBuffer.allocateDirect(10 * 1024 * 1024);  // 10MB
    // buf 在下次 GC 前不会被释放
    // 如果循环速度快于 GC → 堆外内存持续增长 → OOM
}
```

### 3.3 常规堆工具无法直接观测

`jstat` 看不到堆外内存。`jmap -histo` 只能看到堆上的 `DirectByteBuffer` 对象（很小），看不到实际分配的堆外内存大小。

```bash
# NMT 必须在 JVM 启动时开启；之后才能汇总本地内存
# 启动参数：-XX:NativeMemoryTracking=summary
jcmd <pid> VM.native_memory summary

# NMT 开启后，还可以获取与上次基线的差值
jcmd <pid> VM.native_memory summary.diff
```

线上症状、命令输出和修复案例见 [TCP 层与堆外内存案例](../06-diagnostics/01-jvm/chapter-05-cases-offheap-network.md)。

## 4. 参数与监控

### 4.1 常用 JVM 参数

| 参数 | 说明 |
| :-- | :-- |
| `-XX:MaxDirectMemorySize=256m` | 限制直接缓冲区总容量，不影响线程栈、Metaspace 等其他本地内存；未显式设置时默认与最大 Java 堆相同 |
| `-XX:NativeMemoryTracking=summary` | 在 JVM 启动时开启 NMT，按分类收集本地内存用量 |
