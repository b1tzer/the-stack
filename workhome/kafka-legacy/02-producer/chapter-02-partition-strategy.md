# 分区策略

> 分区策略决定了消息被发送到哪个分区，直接影响消息顺序、负载均衡和消费并行度。本章讲清默认策略、自定义分区器，以及分区数与性能的关系。

## 1. 什么是分区，为什么需要它

Topic 是逻辑概念，本身不存储消息；消息实际存储在 Topic 被拆开的多个 **Partition**（分区）里。每个分区是一条**有序、不可变、可追加**的日志：消息只能追加到末尾，按写入顺序排列，用 Offset 唯一标识。

「有序」和「不可变」是理解 Kafka 一切行为的地基，它们直接决定了后面的结论：

| 性质 | 含义 | 它直接决定什么 |
| :-- | :-- | :-- |
| 有序 | 消息按写入先后排列，Offset 递增 | 单分区内严格有序 |
| 不可变 | 已写入的消息不能修改、删除 | 消费只能按顺序读，不能随机改 |
| 可追加 | 新消息只加在末尾 | 顺序写磁盘，这是高吞吐的来源 |

为什么要把一个 Topic 拆成多个分区？因为单台 Broker 的吞吐存在上限——顺序写磁盘的速度、网络带宽、单机 CPU 都无法无限提升。消息量超过单机上限时，唯一的出路是把数据拆开，分散到多台 Broker 并行写入、并行读取：

```txt
单机吞吐有上限（磁盘 / 网络 / CPU）
        ↓
把 Topic 拆成多个 Partition，分布到不同 Broker
        ↓
每个 Partition 独立追加写入、独立被消费
        ↓
写入并行度、消费并行度、水平扩展，全部来自 Partition
```

分区带来两个直接结果，它们是本章所有规则的前提：

| 结果 | 含义 |
| :-- | :-- |
| **并行度** | 一个 Topic 有几个分区，就能被几个消费者并行消费 |
| **顺序性** | 顺序只在单个分区内保证，跨分区无序 |

「并行度」的结论有一个前提：同一个消费者组内，一个分区只能被一个消费者消费。因此分区数就是消费并行度的天花板——消费者再多，超过分区数的部分只会闲置。这个约束在 [消费者组](../03-consumer/chapter-02-consumer-group.md) 里展开，这里只需记住：**分区数决定了并行度的上限**。

消息要落入某个分区，就必须有一套规则决定「这条消息进哪个分区」——这套规则就是分区策略。

## 2. 默认分区策略

Kafka 的默认分区器（`UniformStickyPartitioner`，2.4+）的行为：

```txt
1. 指定分区 → 直接发送到该分区
2. 有 Key → 对 Key 做 murmur2 哈希，取正后对分区数取模（相同 Key 到相同分区）
3. 无 Key → 粘性分区（批次内发到同一分区，批次满后切换）
```

```java
// 1. 指定分区
new ProducerRecord<>("topic", 0, "key", "value");

// 2. 有 Key → hash 路由
new ProducerRecord<>("topic", "user:1001", "value");

// 3. 无 Key → 粘性分区
new ProducerRecord<>("topic", "value");
```

### 2.1 粘性分区（Sticky Partitioner）

Kafka 2.4 之前默认使用 RoundRobin 分区器，无 Key 时每条消息轮询到不同分区——导致每个分区的 batch 都很小，发送效率低。

粘性分区的改进：无 Key 的消息在同一个 batch 内发到同一分区，batch 满后切换到下一个分区：

```txt
RoundRobin：msg0→P0, msg1→P1, msg2→P2, msg3→P0, ...（每个 batch 只有 1 条）
Sticky：    msg0→P0, msg1→P0, msg2→P0, ... batch满 → msg3→P1, msg4→P1, ...
```

粘性分区提高了 batch 利用率，减少了网络请求次数。

## 3. 自定义分区器

```java
public class BusinessPartitioner implements Partitioner {

    @Override
    public int partition(String topic, Object key, byte[] keyBytes,
                         Object value, byte[] valueBytes, Cluster cluster) {
        int partitionCount = cluster.partitionCountForTopic(topic);
        String keyValue = (String) key;

        // VIP 用户路由到分区 0（优先处理）
        if (keyValue != null && keyValue.startsWith("VIP")) {
            return 0;
        }

        // 其他用户均匀分配（避开分区 0）
        return Math.floorMod(key.hashCode(), partitionCount - 1) + 1;
    }

    @Override
    public void close() {}

    @Override
    public void configure(Map<String, ?> configs) {}
}

// 配置
props.put("partitioner.class", "com.example.BusinessPartitioner");
```

::: warning 示例与默认分区器的差异
- 默认分区器用 murmur2 哈希；示例用 `key.hashCode()`，两者算法不同，仅演示自定义能力。
- `key.hashCode()` 可能为负，示例用 `Math.floorMod` 保证非负；`partitionCount - 1` 在单分区时除零，生产代码需先判断分区数。
:::

## 4. 分区与顺序

顺序性为什么「只在单分区内」成立？回到第 1 节：每个分区是一条独立的追加日志，消息按写入先后排列，单分区内天然有序。跨分区则不同——各分区是相互独立的日志、各自推进，没有全局时钟，两条消息先后进入不同分区时无法判定先后，所以跨分区无序。

| 维度 | 顺序保证 |
| :-- | :-- |
| 单分区内 | 严格有序 |
| 跨分区 | 无序 |
| 全局有序 | 只用 1 个分区（牺牲并行度） |

需要局部有序的场景：同一用户的操作必须有序。解决方案：

```java
// 用用户 ID 作为 Key，同一用户的所有消息路由到同一分区
new ProducerRecord<>("user-events", userId, event);
```

## 5. 分区数与性能

| 分区数 | 优势 | 劣势 |
| :-- | :-- | :-- |
| 少（1~10） | 元数据开销小，Leader 选举快 | 并发度受限 |
| 中（10~100） | 平衡并发和开销 | 合理范围 |
| 多（>1000） | 高并发消费 | Leader 选举慢，Controller 压力大 |

### 5.1 经验公式

```txt
分区数 = max(生产者并发数, 消费者并发数)
```

### 5.2 分区过多的代价

| 代价 | 说明 |
| :-- | :-- |
| Leader 选举慢 | 每个分区都需要选举 Leader，分区越多越慢 |
| Controller 压力大 | 元数据管理开销增加 |
| 文件句柄多 | 每个分区对应多个文件，分区越多打开的文件越多 |
| 端到端延迟增加 | 分区越多，元数据与副本同步的协调开销越大 |

> 分区数超过 1000 时，Controller 故障恢复时间会显著增加。如果需要更多并行度，建议先优化消费者处理速度，而不是盲目增加分区。

## 6. 分区扩展

分区数只能增加、不能减少。为什么不能减？已写入的消息带着各自的 Offset 分布在各分区里，减少分区意味着把消息搬走、重新排 Offset——这会破坏第 1 节说的「有序、不可变」两个地基，还涉及跨 Broker 数据迁移，代价极高。所以 Kafka 只提供「加分区」这个单向操作。

```bash
# 只能增加，不能减少
kafka-topics.sh --alter --topic my-topic --partitions 6 --bootstrap-server localhost:9092
```

扩展分区的风险：

| 风险 | 说明 |
| :-- | :-- |
| Key 路由变化 | 有 Key 的消息 rehash 后可能路由到新分区，破坏顺序 |
| 消费者 Rebalance | 分区数变化触发 Rebalance |
| 数据倾斜 | 新分区没有历史数据，短期内数据不均衡 |

> 分区扩展前必须评估 Key 路由变化的影响。如果业务依赖 Key 的顺序性，扩展分区会导致顺序破坏。
