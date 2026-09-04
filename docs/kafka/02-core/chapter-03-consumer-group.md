# 消费者组

> 消费者组不是一个"功能"，而是 Kafka 在"多个消费者怎么协作消费同一个 Topic"这个问题上给出的答案。理解它的关键在于：为什么一个分区只能被组内一个消费者消费？Rebalance 是什么，为什么不可避免？

## 1. 从两个基本需求开始

假设你有一个 Topic 有 3 个分区，消息量很大，一个消费者处理不过来。你需要多个消费者并行消费。

**需求一：并行消费**。3 个消费者，每个消费一个分区，速度变 3 倍。

**需求二：不重复消费**。同一条消息不能被两个消费者同时处理——否则下游系统会收到重复数据。

这两个需求之间有矛盾。如果 3 个消费者各自独立消费所有 3 个分区，那就是 3 倍的重复处理。如果要避免重复，就必须有一个规则：**每个分区只分配给一个消费者**。

消费者组就是这个规则的实现。

## 2. 消费者组模型

```txt
Topic 有 3 个分区

Consumer Group A（2 个消费者）：
  Consumer A1 → Partition 0, Partition 1
  Consumer A2 → Partition 2

Consumer Group B（3 个消费者）：
  Consumer B1 → Partition 0
  Consumer B2 → Partition 1
  Consumer B3 → Partition 2
```

核心规则：

- **一个分区只能被组内一个消费者消费**：保证组内不重复消费
- **一个消费者可以消费多个分区**：分区数 > 消费者数时
- **消费者数 > 分区数**：多余的消费者空闲，浪费资源
- **不同组独立消费**：Group A 和 Group B 各自维护自己的 Offset，互不影响

最后一条是 Kafka 天然支持"发布/订阅"的原因：同一个 Topic 可以被多个消费者组独立消费，每个组看到的是完整的消息流。

## 3. 为什么分区数是并行度的天花板

这个结论直接来自"一个分区只能被组内一个消费者消费"的规则：

```txt
Topic 有 3 个分区，消费者组有 5 个消费者

分配结果：
  Consumer 1 → Partition 0
  Consumer 2 → Partition 1
  Consumer 3 → Partition 2
  Consumer 4 → （空闲）
  Consumer 5 → （空闲）
```

多出来的消费者无事可做。所以分区数决定了消费并行度的上限——不是消费者数，不是 Broker 数，而是分区数。

这意味着：如果你的消费者处理速度跟不上生产速度，增加消费者实例的前提是分区数足够多。否则你加再多消费者也没用。

## 4. Rebalance：为什么不可避免

消费者组不是静态的。消费者会加入、离开、宕机。每次组成员变化，分区分配方案就必须重新计算——这就是 **Rebalance**。

触发 Rebalance 的场景：

| 场景 | 为什么会触发 |
| :-- | :-- |
| 新消费者加入 | 多了一个消费者，需要重新分配分区 |
| 消费者离开（主动退出） | 少了一个消费者，它负责的分区需要分配给别人 |
| 消费者被踢出（心跳超时） | Coordinator 认为消费者已死，触发 Rebalance |
| 消费者被踢出（poll 超时） | 消费者处理消息太久没调用 poll()，被认为已死 |
| Topic 分区数增加 | 多了新分区，需要分配给消费者 |

### 4.1 Rebalance 期间发生了什么 {#rebalance-flow}

上面描述的是 **Eager（急切式）Rebalance**，也是 Kafka 长期以来的默认行为，流程是"全停 → 重新分配 → 恢复"：

```txt
1. 某个消费者离开，向 Coordinator 发送 LeaveGroup
2. Coordinator 通知组内所有消费者："停止消费，准备 Rebalance"
3. 所有消费者发送 JoinGroup，报告自己订阅了哪些 Topic
4. Coordinator 选出 Group Leader（第一个加入的消费者）
5. Group Leader 根据分配策略计算分区分配方案
6. Group Leader 把方案发给 Coordinator
7. Coordinator 把每个消费者的分配方案分发给对应消费者
8. 每个消费者知道自己的分区，恢复消费
```

Eager 模式下，Rebalance 期间**所有消费者停止消费**。这不是 bug，而是有意为之——如果在重新分配过程中允许消费，可能出现同一个分区被两个消费者同时消费的窗口。

但"全停"不是唯一选择。Eager 的代价是：哪怕只有一个分区需要迁移，整个组的消费也会整体停顿一次。Kafka 2.4 起（[KIP-429](https://cwiki.apache.org/confluence/display/KAFKA/KIP-429)）引入 **Cooperative（协作式）Rebalance**，把重分配拆成多轮，只暂停真正需要迁移的分区，其余分区照常消费。它由 `CooperativeStickyAssignor` 承载，Kafka 3.0 起成为默认分配策略。两者的取舍见 [§5 分配策略](#assignor)。

## 5. 分配策略 {#assignor}

Kafka 提供了四种分配策略，它们的核心区别在于"Rebalance 时要不要尽量保持原有分配"：

**Range**：按分区编号范围分配。简单，但多 Topic 时可能不均衡——同一个消费者可能分到多个 Topic 的前半段。

**RoundRobin**：把所有 Topic 的分区放在一起轮询。更均衡，但 Rebalance 时可能打乱大量原有分配。

**Sticky**：在 RoundRobin 基础上增加"尽量保持原分配"的约束。Rebalance 时只迁移必要的分区。

**CooperativeSticky**（推荐）：在 Sticky 基础上改用"协作式"Rebalance——不是所有消费者同时停止，而是只暂停被迁移的分区，其他分区继续消费。

```txt
传统 Rebalance（Stop-the-World）：
  所有分区暂停 → 重新分配 → 恢复

CooperativeSticky（逐步迁移）：
  第1轮：识别需要迁移的分区，通知原消费者释放
  第2轮：新消费者获取迁移的分区，其他分区不受影响
```

### 5.1 选型与版本

四种策略的引入版本与 Rebalance 协议：

| 策略 | 引入版本 | Rebalance 协议 | 依据 |
| :-- | :-- | :-- | :-- |
| `RangeAssignor` | 早期（长期默认） | Eager | 3.0 前的默认值 |
| `RoundRobinAssignor` | 早期 | Eager | 与 Range 同属最早两种 |
| `StickyAssignor` | 0.11.0.0（2017） | Eager | [KIP-54](https://cwiki.apache.org/confluence/display/KAFKA/KIP-54) |
| `CooperativeStickyAssignor` | 2.4.0（2019） | Eager / Cooperative | [KIP-429](https://cwiki.apache.org/confluence/display/KAFKA/KIP-429) |
| 默认改为 `CooperativeSticky` | 3.0（2021） | Cooperative | [KIP-726](https://cwiki.apache.org/confluence/display/KAFKA/KIP-726) |

**生产环境选型**：Kafka 3.0 起默认即 `CooperativeStickyAssignor`，无需配置。Kafka 2.4 起同样可用，显式配置即可：

```java
props.put(ConsumerConfig.PARTITION_ASSIGNMENT_STRATEGY_CONFIG,
          CooperativeStickyAssignor.class.getName());
```

::: warning 版本差异

- **2.4+ 可用**：`CooperativeStickyAssignor` 自 2.4.0 引入，2.4 及以后的 2.x 都能用，显式配置即生效，与 3.0 行为等价。
- **3.0+ 新集群**：默认已是 CooperativeSticky，无需配置，直接受益。
- **存量老集群迁移**：已在运行的老消费者组要从 `Range/RoundRobin/Sticky` 迁到 Cooperative，必须走 [KIP-429](https://cwiki.apache.org/confluence/display/KAFKA/KIP-429) 的两步滚动升级——第一次滚动把 `CooperativeStickyAssignor` 加到策略列表末尾（此时仍走 Eager），第二次滚动再移除旧的 `Range/RoundRobin/Sticky`。不能一步到位，否则组内新旧消费者混用 Eager / Cooperative 协议，同一分区可能被两个消费者同时认领、都提交 offset。
- **组内配置必须一致**：`partition.assignment.strategy` 是组级协商出来的，只要组内有一个消费者不支持 Cooperative，整组退回 Eager。
:::

## 6. 心跳与 poll：两个超时的含义

消费者需要定期向 Coordinator 报告"我还活着"。有两个超时参数，它们检测的是不同的问题：

**`session.timeout.ms`**：心跳超时。消费者必须在 `heartbeat.interval.ms` 内发送心跳。如果超过 `session.timeout.ms` 没有心跳，Coordinator 认为消费者已死。

**`max.poll.interval.ms`**：poll 间隔超时。消费者必须在两次 `poll()` 调用之间不超过这个时间。如果处理消息太久没调用 `poll()`，Coordinator 认为消费者"卡住了"。

两个超时的区别在于：`session.timeout.ms` 检测的是"消费者进程是否还活着"（网络分区、进程崩溃），`max.poll.interval.ms` 检测的是"消费者是否还在正常消费"（处理逻辑阻塞、死锁）。

## 7. Offset 管理

消费者组的 Offset 是整个消费模型的"进度条"。它回答的问题是："这个消费者组消费到了哪里？"

### 7.1 自动提交 vs 手动提交

**自动提交**（`enable.auto.commit=true`）：消费者每隔 `auto.commit.interval.ms` 自动提交当前 Offset。问题在于：如果消息已经 poll 回来但还没处理完，Offset 已经提交了。此时消费者宕机，重启后从新 Offset 开始，那些未处理的消息就丢了。

**手动提交**（`enable.auto.commit=false`）：你控制什么时候提交 Offset。正确做法是处理完消息后再提交。但这里也有陷阱：如果你逐条处理逐条提交，性能极差；如果你等一批全部处理完再提交，处理过程中宕机，这批消息会被重新消费。

这就是为什么 Kafka 的消费端天然支持"At Least Once"——消息可能被重复消费，但不会丢失。要实现 Exactly Once，需要在业务层做幂等处理。

### 7.2 Offset 存在哪里

Offset 存储在 `__consumer_offsets` 这个内部 Topic 中。Key 是 `(group.id, topic, partition)`，Value 是 Offset。选择存 Topic 而不是内存或外部存储，是因为 Topic 本身就有副本和持久化——Offset 不会因为单点故障丢失。

## 8. 静态成员 {#static-membership}

传统消费者组中，消费者重启就会向 Group Coordinator（Broker）申请新的 `member.id` ，加入群组会触发 Rebalance。但在滚动部署场景下，你希望重启一个消费者不影响其他消费者。

静态成员（`group.instance.id`）解决了这个问题：消费者指定一个固定的 ID，重启后 Coordinator 用 ID 识别它是"同一个消费者"，只要在 `session.timeout.ms` 内重新连接就不触发 Rebalance。

## 9. Lag 监控

Lag = 最新 Offset - 已提交 Offset。它告诉你"消费者落后生产者多少条消息"。

```bash
kafka-consumer-groups.sh --describe --group my-group --bootstrap-server localhost:9092
# GROUP    TOPIC    PARTITION  CURRENT-OFFSET  LOG-END-OFFSET  LAG
# my-group my-topic 0          1000            1500            500
```

Lag 稳定不增长 → 消费速度跟得上。Lag 持续增长 → 消费者处理能力不足，需要优化或扩容。

Lag 过大的排查见 [消费者 Lag 过大](../05-troubleshooting/chapter-01-consumer-lag.md)。

## 10. 一句话总结

- 消费者组通过"一个分区只分配给一个消费者"的规则，在并行消费和不重复消费之间找到了平衡。
- Rebalance 是消费者组的动态适应机制——组成员变化时重新计算分配方案，代价是消费暂停。
- 分区数是消费并行度的天花板，Offset 是消费进度的"进度条"。
