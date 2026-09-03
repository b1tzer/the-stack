# Quorum 与 Raft

> Quorum Queue 基于 Raft 共识协议实现高可用。理解 Raft 是理解 Quorum Queue 行为的关键。

## 1. Raft 协议核心

Raft 是一种分布式共识算法，保证多个节点对日志顺序达成一致。

```txt
Leader ──日志复制──▶ Follower 1
                  ──▶ Follower 2

写入成功条件：Leader + 多数 Follower 确认
  3 节点：需要 2 个确认（Leader + 1 Follower）
  5 节点：需要 3 个确认（Leader + 2 Follower）
```

## 2. Quorum Queue 中的 Raft

```txt
Producer ──▶ Leader Node ──Raft 日志──▶ Follower 1
                                   ──▶ Follower 2

Consumer ◀── Leader Node（只从 Leader 读取）
```

- **写入**：消息先写入 Leader 的 Raft 日志，复制到多数节点后返回 Confirm
- **读取**：只从 Leader 读取（Quorum Queue 不支持从 Follower 读）
- **Leader 选举**：Leader 崩溃后，Follower 自动发起选举

## 3. Leader 选举

```txt
Leader 崩溃
  → Follower 发现心跳超时
  → Follower 转为 Candidate，发起投票
  → 多数节点投票 → 新 Leader 当选
  → 耗时通常 1-5 秒
```

## 4. 日志复制与持久性

```txt
消息写入流程：
  1. Producer 发送消息到 Leader
  2. Leader 追加到 Raft 日志（磁盘）
  3. Leader 复制日志到 Followers
  4. 多数节点写入磁盘后 → 返回 Producer Confirm
  5. Leader 提交（commit）→ 消息可被消费
```

**持久性保证**：只要多数节点不同时崩溃，消息就不会丢。

## 5. Quorum Queue 的脑裂处理

Raft 协议天然防止脑裂：

- 网络分区时，少数派分区的节点无法获得多数投票，不能选出 Leader
- 多数派分区正常工作
- 网络恢复后，少数派同步多数派的数据

## 6. 性能特征

| 维度 | 特征 |
| :-- | :-- |
| 写入延迟 | 1-5ms（需要 Raft 共识） |
| 读取延迟 | 微秒级（直接从 Leader 读） |
| 吞吐量 | 2-5 万 msg/s（3 节点） |
| 故障恢复 | 1-5 秒（Leader 重选） |

## 7. 集群大小建议

| 节点数 | 容错 | 适用场景 |
| :-- | :-- | :-- |
| 3 | 容忍 1 节点故障 | 大多数场景 |
| 5 | 容忍 2 节点故障 | 高可靠性要求 |
| 7 | 容忍 3 节点故障 | 极高可靠性（少用） |

**不要用偶数节点**：4 节点和 3 节点的容错能力相同（都只能容忍 1 个故障），但多了一个节点的开销。
