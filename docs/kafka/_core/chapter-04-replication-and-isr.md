# 副本与 ISR

> 副本机制是 Kafka 可靠性的物理基础。但"多存几份"只是表象——真正的难点在于：多个副本之间怎么保持同步？谁来决定哪些副本"够格"？Leader 宕机时怎么选新 Leader 而不丢数据？这些问题的答案都指向一个核心概念：ISR。

## 1. 从一个最基本的问题开始

假设你有一个 Partition，消息只存在一台 Broker 上。这台 Broker 的磁盘坏了，数据永久丢失。

最直觉的解法：多存几份。把同样的数据复制到 3 台 Broker 上，坏了一台还有两台。

但这个"复制"不是简单的拷贝。你需要回答一连串问题：

- 谁来处理读写请求？三个副本都能接请求吗？
- 如果三个副本都能接写入，写入顺序怎么保证？
- Follower 复制数据的速度跟不上 Leader 怎么办？
- Leader 宕机了，从剩下的副本里选新 Leader，选谁？怎么选？

Kafka 对这些问题的回答构成了它的副本模型：**Leader 独占读写，Follower 只管复制，ISR 管理同步状态**。

## 2. 为什么读写必须只走 Leader

这是 Kafka 副本模型的第一个关键决策。如果允许多个副本同时接写入：

```txt
Producer A → Broker 1（Leader）: 写入 msg1
Producer B → Broker 2（Follower）: 写入 msg2

Broker 1 的日志: [msg1, msg2]
Broker 2 的日志: [msg2, msg1]  ← 顺序反了
```

两个副本的写入顺序无法保证一致——没有全局时钟，网络延迟也不同。顺序一旦分叉，消费者从不同副本读到的数据就不一样，一致性彻底崩溃。

如果允许 Follower 接读：

```txt
Consumer → Broker 2（Follower）: 读取 offset 100
但 Broker 2 还没从 Leader 同步到 offset 100
→ Consumer 读不到，或者读到旧数据
```

所以 Kafka 的选择是：**Leader 独占读写，Follower 只做一件事——从 Leader 拉数据**。这个设计牺牲了读写负载均衡，换来了最简单的一致性保证。

## 3. LEO 和 HW：两个关键偏移量

每个副本维护两个偏移量，它们决定了"消费者能看到哪些数据"：

**LEO（Log End Offset）**：本地日志末尾的下一个待写入位置。换句话说，这个副本已经写到了哪。

**HW（High Watermark）**：所有**同步副本**中最小的 LEO。换句话说，"确认所有同步副本都已经写入"的边界。

```txt
Leader LEO = 150
Follower A LEO = 148
Follower B LEO = 145

HW = min(150, 148, 145) = 145
```

**消费者只能读到 HW 之前的消息**。为什么？因为 HW 之前的消息意味着"所有同步副本都已写入"——即使 Leader 立刻宕机，切换到任意同步副本，这些消息都还在。HW 之后的消息只存在于部分副本中，如果现在让消费者读到，Leader 宕机后这条消息可能丢失，消费者已经处理了但数据没了，这就是数据不一致。

HW 的设计是 Kafka 可靠性的核心：它在"消费者能看到的数据"和"所有副本都确认的数据"之间画了一条线。

## 4. ISR：哪些副本"够格"

不是所有 Follower 都有资格参与 HW 的计算。只有 **ISR（In-Sync Replicas）** 中的副本才被算在内。

ISR 是"与 Leader 保持同步的副本集合"，包含 Leader 自身。一个 Follower 被移出 ISR 的条件是：超过 `replica.lag.time.max.ms`（默认 30 秒）没有追上 Leader 的 LEO。

这里有一个容易误解的地方：**"追上 Leader 的 LEO"不是"追到 Leader 的 HW"**。判定条件是 `follower.LEO >= leader.LEO`，不是 `follower.LEO >= leader.HW`。因为 Follower 需要证明自己"已经复制了 Leader 的所有数据"，而不是"已经复制了所有副本都确认的数据"。

ISR 是动态的：

```txt
正常：ISR = {Leader, Follower1, Follower2}
Follower2 变慢：ISR = {Leader, Follower1}（Follower2 被移出）
Follower2 恢复：ISR = {Leader, Follower1, Follower2}（重新加入）
```

ISR 收缩意味着"确认写入成功的副本数减少"。如果 ISR 收缩到只剩 Leader，配合 `min.insync.replicas=2`，Broker 会拒绝 `acks=all` 的写入——因为 ISR 中的副本数不足。

## 5. acks=all 的完整时序

理解了 LEO、HW、ISR，才能真正理解 `acks=all` 的含义：

```txt
Producer            Leader                Follower A         Follower B
  │ ProduceReq acks=all │
  ├────────────────────▶│  写入本地日志，LEO 前进
  │                     │  挂起 DelayedProduce（不立刻返回）
  │                     │
  │                     │◀── Fetch(replicaId=A) ──│
  │                     │◀── Fetch(replicaId=B) ───────────────│
  │                     │  两个 Follower 各自拉取数据
  │                     │  Follower 写入本地日志，LEO 前进
  │                     │  Leader 更新 HW = min(ISR.LEO)
  │                     │
  │                     │  HW >= 目标 offset → 唤醒 DelayedProduce
  │◀── ProduceResp OK ──│
```

`acks=all` 的语义是：**消息写入所有 ISR 副本后才算成功**。它不是等所有副本都写入——OSR（落后的副本）不算在内。这就是为什么 ISR 的管理如此重要：ISR 太大，写入延迟高；ISR 太小，可靠性下降。

## 6. Leader Epoch：为什么不能只靠 HW 做截断

这是 Kafka 副本机制中最精妙、也最容易被忽略的部分。

Follower 切换 Leader 时，需要把本地日志"回退到与新 Leader 一致的位置"。早期的做法是"截断到本地 HW"——听起来合理，但存在一个数据丢失的场景：

```txt
T1: Leader L 写入 offset=100，ISR = {L, F}
    L 的 HW = 98（F 还没 ack 到 100）
T2: F 的 HW = 97（F 还没收到 L 的 HW 更新）
T3: L 宕机，F 当选新 Leader
    F 的日志只到 offset=97
T4: L 恢复，切成 Follower
    旧规则：截断到本地 HW=98
    L 保留了 offset=98 和 99 的数据
    但 F 作为新 Leader 从未见过这些数据
    → L 和 F 的日志分叉，数据丢失
```

问题的根源在于：HW 是一个"滞后"的值——它只在 Follower Fetch 响应中更新，可能比实际的同步进度慢。用一个可能过时的值做截断决策，就会出错。

**Leader Epoch**（KIP-101）修复了这个问题。每次 Leader 换届，Controller 分配一个单调递增的 epoch。新的截断协议：

```txt
1. L 恢复后，向新 Leader F 发送：我的最后 epoch 是 X
2. F 查自己的 epoch 记录：
   - 如果 epoch X 存在，返回该 epoch 对应的 endOffset
   - 如果不存在，返回更早 epoch 的 endOffset
3. L 截断到 min(返回的 endOffset, 本地 LEO)
```

关键在于第 2 步：F 用 epoch 精确定位"两条日志的公共前缀在哪里"。epoch 是单调递增的，所以公共前缀一定是某个 epoch 的边界。这比用 HW（一个可能过时的值）可靠得多。

## 7. Leader 选举

### 正常选举

Leader 所在 Broker 宕机后，Controller 从当前 ISR 中选第一个成员作为新 Leader。为什么是 ISR？因为 ISR 中的副本与 Leader 同步，选它不会丢数据。为什么是"第一个"？因为副本列表的顺序是创建时确定的，第一个成员就是 preferred replica，选它有利于负载均衡。

### Unclean Leader 选举

如果 ISR 为空呢？所有同步副本都挂了，只剩下 OSR（落后的副本）。这时候有两个选择：

- **禁止 Unclean 选举**：分区不可用，等 ISR 成员恢复。不丢数据，但服务中断。
- **允许 Unclean 选举**：从 OSR 中选 Leader。服务可用，但 OSR 副本中缺失的数据永久丢失。

`unclean.leader.election.enable=false`（推荐）意味着宁可不可用也不丢数据。这个选择取决于你的业务：金融交易不能丢数据，日志收集可以容忍少量丢失。

## 8. ISR 变更的传播

ISR 变更不是 Leader 自己说了算。Leader 发起变更请求（`AlterPartitionRequest`），但最终决定权在 Controller：

```txt
Leader → Controller: "ISR 变了，新 ISR 是 {我, F1}"
Controller: 校验后写入元数据日志
Controller → 所有 Broker: 广播变更
```

为什么要绕这一圈？因为 ISR 状态必须在 Leader 换届过程中也保持全局一致。如果 Leader 自己管理 ISR，两个 Broker 可能同时认为自己是 Leader，各自维护了不同的 ISR，集群就会出现"脑裂"。Controller 是唯一权威源，保证 ISR 状态的全局一致性。

## 9. 关键配置

| 参数 | 为什么这样设 |
| :-- | :-- |
| `default.replication.factor=3` | 3 副本是可靠性和成本的平衡点——坏了一台还有两台 |
| `min.insync.replicas=2` | 配合 acks=all，保证至少两个副本有数据 |
| `unclean.leader.election.enable=false` | 宁可不可用也不丢数据 |
| `replica.lag.time.max.ms=30000` | 保持默认。调小会因 GC 停顿、网络抖动触发 spurious shrink |

## 10. 监控

| 指标 | 含义 | 为什么重要 |
| :-- | :-- | :-- |
| `UnderReplicatedPartitions` | ISR 少于 RF 的分区数 | > 0 说明有副本掉队 |
| `UnderMinIsrPartitionCount` | ISR 少于 min.insync.replicas 的分区数 | > 0 说明 acks=all 已开始拒写 |
| `IsrShrinksPerSec` | ISR 收缩频率 | 频繁抖动说明参数与实际不匹配 |
| `UncleanLeaderElectionsPerSec` | Unclean 选举次数 | > 0 意味着真实的数据丢失 |

ISR 频繁收缩的排查见 [ISR 频繁收缩](../troubleshooting/chapter-02-isr-shrink.md)。
