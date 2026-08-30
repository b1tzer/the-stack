# Page Cache 与零拷贝

> Kafka 的高吞吐有两大利器：Page Cache 让读写接近内存速度，零拷贝让网络传输跳过用户态。本章拆解这两个机制的原理与生产调优。

## 1. Page Cache 机制

Kafka 不在 JVM 堆内管理消息数据，而是依赖操作系统的 Page Cache：

```text
写入流程：
Producer → Broker → Page Cache（内存）→ 异步刷盘 → 磁盘
                            │
                            ▼
                      立即返回 ACK

读取流程：
Consumer → Broker → 检查 Page Cache
                        │
                        ├── 命中 → 直接返回（极快，内存速度）
                        │
                        └── 未命中 → 磁盘读取 → 加载到 Page Cache → 返回
```

### 1.1 为什么不用 JVM 堆内存

| 维度 | JVM 堆内存 | Page Cache |
| :-- | :-- | :-- |
| GC 压力 | 大量对象导致频繁 GC | 不在堆内，无 GC 影响 |
| 进程重启 | 数据丢失 | 文件缓存，重启后仍可用 |
| 内存管理 | 需要手动管理 | 操作系统自动管理 |
| 内存大小 | 受 JVM 堆限制 | 使用全部空闲物理内存 |

> Kafka 的 JVM 堆只需要 6GB 左右，剩余内存全部留给操作系统做 Page Cache。这是 Kafka 内存配置的核心原则。

### 1.2 Page Cache 命中率

Page Cache 命中率决定了读取性能：

| 场景 | 命中率 | 说明 |
| :-- | :-- | :-- |
| 生产者刚写入、消费者立即读 | 极高 | 数据还在 Page Cache 中 |
| 消费者回溯读取旧数据 | 低 | 数据已被刷盘，需要磁盘读取 |
| 多个消费者读同一 Partition | 高 | 第一个消费者加载到 Page Cache，后续命中 |

> 消费者 Lag 越小，Page Cache 命中率越高。如果消费者严重落后（Lag 很大），读取会退化为磁盘随机读，性能急剧下降。

## 2. 零拷贝（Zero Copy）

### 2.1 传统方式 vs 零拷贝

传统方式读取磁盘数据发送到网络：

```text
1. 磁盘 → 内核缓冲区     （DMA 拷贝）
2. 内核缓冲区 → 用户缓冲区 （CPU 拷贝）← 多余
3. 用户缓冲区 → Socket 缓冲区（CPU 拷贝）← 多余
4. Socket 缓冲区 → 网卡    （DMA 拷贝）

4 次拷贝 + 4 次上下文切换
```

Kafka 使用 `sendfile()` 系统调用：

```text
1. 磁盘 → 内核缓冲区  （DMA 拷贝）
2. 内核缓冲区 → 网卡  （DMA 拷贝，通过 scatter-gather）

2 次拷贝 + 2 次上下文切换
```

### 2.2 sendfile() 原理

```c
// Linux 系统调用
ssize_t sendfile(int out_fd, int in_fd, off_t *offset, size_t count);

// 内核直接在内核缓冲区和网卡之间传输数据
// 不经过用户态，不占用 CPU
```

Kafka 内部使用 Java NIO 的 `FileChannel.transferTo()` 实现：

```java
// Kafka 源码中读取日志发送给消费者的底层实现
FileChannel fileChannel = new FileInputStream(logFile).getChannel();
fileChannel.transferTo(position, count, socketChannel);
```

### 2.3 零拷贝的效果

| 维度 | 传统方式 | 零拷贝 |
| :-- | :-- | :-- |
| 数据拷贝次数 | 4 次 | 2 次 |
| 上下文切换 | 4 次 | 2 次 |
| CPU 占用 | 高（CPU 参与拷贝） | 低（DMA 完成） |
| 吞吐量提升 | 基准 | 2~3 倍 |

## 3. 刷盘策略

Kafka 的消息先写入 Page Cache，再异步刷盘：

```properties
# 刷盘策略（不推荐频繁刷盘）
log.flush.interval.messages=10000   # 每 10000 条刷盘
log.flush.interval.ms=1000          # 每 1 秒刷盘
```

**为什么推荐副本而非频繁刷盘？**

| 方式 | 可靠性 | 性能 |
| :-- | :-- | :-- |
| `flush.interval.messages=1` | 高（每条都刷盘） | 极差（每次刷盘都阻塞） |
| `acks=all` + ISR 副本 | 高（多副本同步） | 好（内存级别同步） |

刷盘会触发 `fsync`，严重降低写入性能。Kafka 推荐用副本机制（`acks=all` + `min.insync.replicas=2`）保证可靠性，而不是依赖频繁刷盘。

## 4. JVM 内存配置

```bash
# 推荐配置
export KAFKA_HEAP_OPTS="-Xmx6g -Xms6g"
export KAFKA_JVM_PERFORMANCE_OPTS="-XX:+UseG1GC -XX:MaxGCPauseMillis=20"
```

内存分配原则：

```text
物理内存 32GB 的 Broker：
  JVM 堆 = 6GB
  Page Cache = 32GB - 6GB = 26GB（留给操作系统）
```

| 配置 | 建议 | 说明 |
| :-- | :-- | :-- |
| JVM 堆 | ≤ 6GB | Kafka 主要依赖 Page Cache，不需要大堆 |
| 剩余内存 | 全部给 Page Cache | 越多越好 |
| GC 策略 | G1GC | 低延迟 GC，避免长时间停顿 |
| swap | 关闭 | `vm.swappiness=1`，避免 Page Cache 被交换 |

> 堆内存过大（如 32GB）会导致长时间 GC 停顿，而且挤占了 Page Cache 的空间——得不偿失。

## 5. 文件系统选择

| 文件系统 | 优势 | 推荐 |
| :-- | :-- | :-- |
| XFS | 大量小文件性能好，inode 管理高效 | ✅ 推荐 |
| ext4 | 通用，稳定性好 | 可以 |
| ZFS | 压缩、快照 | 不推荐（与 Kafka 的 IO 模式不匹配） |

```bash
# XFS 挂载选项（推荐）
mkfs.xfs -f /dev/sdb1
mount -o noatime,nodiratime,nobarrier /dev/sdb1 /kafka
```

## 6. 最佳实践

1. **留足内存给 Page Cache**：Broker 内存 = JVM 堆（6GB）+ Page Cache（剩余全部）。
2. **不要频繁刷盘**：依赖副本机制，不要 `flush.interval.messages=1`。
3. **使用 XFS 文件系统**：大量小文件场景下 XFS 性能更好。
4. **禁用 swap**：`vm.swappiness=1`，避免 Page Cache 被交换到磁盘。
5. **监控 Page Cache 命中率**：消费者 Lag 大时命中率低，性能下降。
