# Page Cache 与零拷贝

> Kafka 不在 JVM 堆里管消息，读写路径直接落到内核 Page Cache；把消息发出去时，Broker 让内核把 Page Cache 中的字节直接推到网卡。本章从 `FileRecords#writeTo` 出发，追到 `TransportLayer` 两种实现，讲清「什么时候零拷贝真的成立，什么时候它默默失效」。

## 1. Kafka 为什么不用堆内存管消息

Broker 处理消息的整个路径上都不出现「把消息拷进 JVM 堆」这一步。写入时消息经 `MemoryRecords` 直接落到 `FileRecords` 对应的文件通道；读取时消息也不进入 Java 对象，直接以 `FileRecords` 分片形式交给网络层。这不是"性能优化"，而是 Kafka 的核心设计选择：

| 维度 | JVM 堆 | Page Cache |
| :-- | :-- | :-- |
| GC | 大量长生命周期对象 → 频繁 Full GC | 不在堆内 → 与 GC 无关 |
| 重启 | 进程崩溃即失效 | 内核托管 → 进程重启后仍在 |
| 冷热识别 | 靠应用层策略 | 内核 LRU 自动淘汰 |
| 与磁盘同步 | 需要写盘一次 + 拷入堆一次 | 内核以脏页方式回写 |
| 内存上限 | 受 `-Xmx` 限制 | 空闲物理内存全部可用 |

这也是 Kafka 官方建议把堆保持在几 GB 以内、把剩余内存全部留给 OS 的直接原因。堆调得越大，能被 Page Cache 使用的空间就越少；同时 GC 停顿越明显，Broker 越容易触发副本追不上、consumer session 超时等次生故障。

来源：[Kafka 官方文档 §Efficiency](https://kafka.apache.org/documentation/#maximizingefficiency)、[Kafka 官方文档 §OS/Filesystem](https://kafka.apache.org/documentation/#os)

## 2. 命中率的两条线索

Page Cache 命中率决定读放大。Kafka 里两类典型负载对 Page Cache 的利用完全不同：

- **实时消费**：Producer 刚把批次写进 Page Cache，Consumer 紧接着来取，几乎全命中，读路径不落盘。
- **回溯消费 / 消费者滞后**：目标 offset 对应的段早已被内核淘汰出 Page Cache，读到 `FileRecords#slice` 时触发缺页 → 走磁盘 → 加载回 Page Cache。若滞后严重且并发大，会把热数据的页也挤出去，形成雪崩。

监控层面盯 `MaxLag`、`RecordsLagMax`、`UnderReplicatedPartitions`，OS 层面看 `/proc/meminfo` 的 `Cached` 与 `iostat` 的 `%util`——两侧同时恶化就是 Page Cache 击穿。

## 3. `FileRecords#writeTo`：零拷贝的真正入口

Broker 向 Consumer/Follower 发送日志时，进入 `FileRecords#writeTo`。这是判定零拷贝是否成立的分叉点：

```java
// clients/src/main/java/org/apache/kafka/common/record/FileRecords.java
@Override
public long writeTo(TransferableChannel destChannel, long offset, int length) throws IOException {
    long newSize = Math.min(channel.size(), end) - start;
    int oldSize = sizeInBytes();
    if (newSize < oldSize)
        throw new KafkaException(...);

    long position = start + offset;
    int count = Math.min(length, oldSize);
    return destChannel.transferFrom(channel, position, count);
}
```

`TransferableChannel` 是 Kafka 自己定义的接口，`TransportLayer` 是它最重要的实现。是否零拷贝完全取决于目标 channel 的 `transferFrom` 走哪条路。

来源：[FileRecords.java](https://github.com/apache/kafka/blob/trunk/clients/src/main/java/org/apache/kafka/common/record/FileRecords.java)

### 3.1 明文通道：sendfile 生效

```java
// clients/src/main/java/org/apache/kafka/common/network/PlaintextTransportLayer.java
@Override
public long transferFrom(FileChannel fileChannel, long position, long count) throws IOException {
    return fileChannel.transferTo(position, count, socketChannel);
}
```

`FileChannel.transferTo` 在 Linux 上最终走 `sendfile(2)` 系统调用；配合支持 scatter-gather DMA 的网卡，数据始终在内核空间：

```text
磁盘 ──DMA──▶ Page Cache ──DMA(scatter-gather)──▶ NIC
                     │
                     └── 全程不经过用户态，不经过 JVM 堆
```

上下文切换从 4 次降到 2 次，CPU 拷贝从 2 次降到 0 次。这是 Kafka「消费者读接近线速」的机制来源，前提是 **`sendfile` 走得通**。

### 3.2 SSL 通道：零拷贝失效

一旦启用 SSL/TLS，`transferFrom` 走另一条实现：

```java
// clients/src/main/java/org/apache/kafka/common/network/SslTransportLayer.java
@Override
public long transferFrom(FileChannel fileChannel, long position, long count) throws IOException {
    // 概括流程：
    // 1) fileChannel.read(fileChannelBuffer, position) —— 从 Page Cache 读到 JVM 堆外 buffer
    // 2) sslEngine.wrap(src, netWriteBuffer)            —— 用户态加密
    // 3) socketChannel.write(netWriteBuffer)           —— 写回内核态
    ...
}
```

加密必须在用户态完成，数据必须从内核拷入 JVM，`sendfile` 直接失效。KAFKA-13799 明确指出：

> PlaintextTransportLayer and SslTransportLayer both use pagecache, but SslTransportLayer does not implement zero-copy.

启用 SSL 后典型影响：Broker 的 CPU 占用从个位数百分比涨到 30–50%，端到端 p99 延迟增加，同网卡下极限吞吐明显下降。这个成本不是"SSL 开销"这么泛，而是「零拷贝路径消失」这个具体机制。评估是否上 SSL、以及在哪些 listener 上启用 SSL 时必须把这一条纳入决策。

来源：[KAFKA-13799 Improve documentation for Kafka zero-copy](https://issues.apache.org/jira/browse/KAFKA-13799)、[SslTransportLayer.java](https://github.com/apache/kafka/blob/trunk/clients/src/main/java/org/apache/kafka/common/network/SslTransportLayer.java)

### 3.3 其他会让 `transferTo` 失效的情形

除了 SSL，`FileChannel.transferTo` 本身也有边界：

- 目标 channel 不是 `SocketChannel`/`FileChannel` 的子类：JVM 会退化为 read/write 循环。
- 操作系统不支持 `sendfile`（老版 Windows、部分嵌入式内核）：同上退化。
- 目标 socket 缓冲区已满：`transferTo` 返回值小于 `count`，Kafka 由 `Sender`/网络层负责下次继续，逻辑无损但吞吐受影响。
- 数据要在传输前修改（压缩转换、down-conversion）：这类路径不走 `transferTo`。例如低版本客户端订阅高版本消息格式时，Broker 需 down-convert，本身就要过用户态，零拷贝也不成立。

## 4. 索引文件用 mmap，不用 sendfile

写路径与索引查找采用另一种「零拷贝」——mmap。`AbstractIndex` 把 `.index` / `.timeindex` 通过 `MappedByteBuffer` 映射到进程虚拟地址空间：

```java
// storage/src/main/java/org/apache/kafka/storage/internals/log/AbstractIndex.java
protected MappedByteBuffer mmap;
```

- 索引小（默认单文件上限 10 MiB）→ 冷启动首次访问触发少量缺页后即整体驻留 Page Cache。
- 后续读写不再走系统调用，直接按虚地址访问 → 二分查找几乎是纯内存操作。

详细的索引二分与热/冷区优化见 [日志分段与索引](./chapter-01-log-segment.md) §4。sendfile 与 mmap 在 Kafka 里分工明确：**面向消费者/副本的批量传输走 sendfile；索引与元数据这类需要频繁小粒度访问的走 mmap**。

## 5. 刷盘：Kafka 为什么把这个交给内核

写路径在 `LogSegment#append` 内只是把字节交给 `FileRecords`，不主动 `fsync`。刷盘由内核按脏页机制回写：

```properties
# Broker 默认建议：不主动干预
# log.flush.interval.messages 与 log.flush.interval.ms 都不设
```

为什么不追刷盘？把它和副本机制对比一次就清楚了：

| 手段 | 单条延迟 | 数据丢失窗口 | 依赖 |
| :-- | :-- | :-- | :-- |
| `log.flush.interval.messages=1` | 每条都 `fsync`，磁盘 IOPS 上限直接顶到瓶颈 | 极小 | 单机磁盘可靠性 |
| `acks=all` + `min.insync.replicas=2` | 内存级同步 | 需要至少两个副本同时丢失才丢数据 | 副本分布与网络 |

结论：Kafka 用副本代替 `fsync`。让内核在合适时机把脏页刷下去，是让消费者读 Page Cache 命中率保持在高位、也让写入不被磁盘 IO 拖住的前提。真需要更强的持久化边界时，走 `acks=all + min.insync.replicas`，见 [ACK 机制与可靠性保证](../06-reliability/chapter-01-acks.md)。

## 6. 因此的工程约束

以上机制推导出的 Broker 内存与文件系统配置约束：

- 堆保持在几 GB 量级，剩余物理内存全部留给 Page Cache。`KAFKA_HEAP_OPTS` 里 Xmx 与 Xms 相等，避免动态扩堆。
- GC 使用 G1，`MaxGCPauseMillis` 保守设 20 ms 左右。堆越大越难满足这个目标。
- 关闭或最小化 swap：`vm.swappiness=1`。一旦 Page Cache 被换出去，Consumer 读的每次「命中」都会变成一次磁盘 IO。
- 文件系统优选 XFS 或 ext4，挂载参数关闭 `atime` 更新（`noatime,nodiratime`）。
- 关注 SSL 决策：内网 listener 优先明文，只有对外 listener 才启用 SSL；否则整条读路径都会失去 sendfile 的效率优势。

具体的 JVM 参数与 OS 参数模板在 [性能调优](../11-practice/chapter-06-performance-tuning.md) 里给出可复制的配置。

## 7. 一句话小结

- Kafka 把消息生命周期钉在 Page Cache 上，堆只做协议解析与调度。
- `FileRecords#writeTo → TransportLayer#transferFrom` 是零拷贝的判定点：明文走 `sendfile`；SSL 走 `read + wrap + write`，零拷贝失效。
- 索引不用 sendfile，用 mmap；两种"零拷贝"分工不同。
- 刷盘交给内核脏页机制，可靠性交给副本——`fsync` 与 `acks=all` 二选一，Kafka 选后者。
