# Page Cache 与零拷贝

## 1. Page Cache

Kafka 利用操作系统 Page Cache 缓存消息：
- 写入：先写 Page Cache，异步刷盘
- 读取：优先从 Page Cache 读取

## 2. 零拷贝

```
传统方式：
磁盘 → 内核缓冲区 → 用户缓冲区 → Socket缓冲区 → 网卡

零拷贝（sendfile）：
磁盘 → 内核缓冲区 → 网卡
```

Kafka 使用 `sendfile()` 系统调用，减少数据拷贝次数。

## 3. 高吞吐原因

1. 顺序写磁盘
2. Page Cache
3. 零拷贝
4. 批量发送
5. 压缩

```properties
# 刷盘策略
log.flush.interval.messages=10000
log.flush.interval.ms=1000
```

## 4. Page Cache 机制详解

Kafka 不自己管理缓存，而是依赖操作系统的 Page Cache：

```
写入流程:
Producer → Kafka Broker → Page Cache (内存) → 异步刷盘 → 磁盘
                                    │
                                    ▼
                              立即返回 ACK

读取流程:
Consumer → Kafka Broker → 检查 Page Cache
                              │
                              ├── 命中 → 直接返回（极快）
                              │
                              └── 未命中 → 从磁盘读取 → 加载到 Page Cache → 返回
```

**为什么 Kafka 不用 JVM 堆内存缓存？**
- GC 压力：大量对象会导致频繁 GC。
- 进程重启丢失：JVM 堆内存数据在进程重启后丢失。
- Page Cache 由操作系统管理，重启后仍然可用（文件缓存）。

## 5. 零拷贝（Zero-Copy）详解

```java
// Kafka 内部使用 FileChannel.transferTo() 实现零拷贝
// 底层调用 Linux sendfile() 系统调用

// 传统方式：4 次拷贝 + 4 次上下文切换
// 1. 磁盘 → 内核缓冲区 (DMA)
// 2. 内核缓冲区 → 用户缓冲区 (CPU)
// 3. 用户缓冲区 → Socket 缓冲区 (CPU)
// 4. Socket 缓冲区 → 网卡 (DMA)

// 零拷贝：2 次拷贝 + 2 次上下文切换
// 1. 磁盘 → 内核缓冲区 (DMA)
// 2. 内核缓冲区 → 网卡 (DMA，通过 scatter-gather)
```

## 6. 刷盘策略

Kafka 提供两种刷盘策略：

```properties
# 策略1：基于消息数量
log.flush.interval.messages=10000  # 每 10000 条消息刷盘一次

# 策略2：基于时间间隔
log.flush.interval.ms=1000         # 每 1 秒刷盘一次

# 注意：Kafka 推荐使用副本机制保证可靠性，而不是依赖频繁刷盘
```

**为什么推荐副本而非刷盘？**
- 刷盘会严重降低写入性能。
- 副本机制在内存级别同步，性能更高。
- 只有 `acks=all` + `min.insync.replicas>=2` 才能保证数据不丢失。

## 7. JVM 内存配置

```bash
# 推荐 JVM 配置
export KAFKA_HEAP_OPTS="-Xmx6g -Xms6g"  # 堆内存不超过 6GB
export KAFKA_JVM_PERFORMANCE_OPTS="-XX:+UseG1GC -XX:MaxGCPauseMillis=20"
```

**为什么堆内存不超过 6GB？**
- Kafka 主要依赖 Page Cache，不需要大堆内存。
- 大堆会导致长时间 GC 停顿。
- 剩余内存留给操作系统做 Page Cache。

## 8. 最佳实践

1. **留足内存给 Page Cache**：Kafka Broker 的内存 = JVM 堆（6GB）+ Page Cache（剩余全部）。
2. **不要频繁刷盘**：依赖副本机制保证可靠性，而不是 `log.flush.interval.messages=1`。
3. **使用 XFS 或 ext4 文件系统**：XFS 在大量小文件场景下性能更好。
4. **禁用 swap**：`vm.swappiness=1`，避免 Page Cache 被交换到磁盘。
