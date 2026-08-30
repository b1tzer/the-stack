# Quorum Queue 与 Raft

> Quorum Queue 基于 Raft 共识协议，是 RabbitMQ 推荐的高可用队列方案。本章深入 Raft 协议在 RabbitMQ 中的实现。

## 1. Raft 协议基础

Raft 是分布式共识算法，核心机制：

```text
Leader Election（领导选举）
Log Replication（日志复制）
Safety（安全性保证）
```

## 2. Quorum Queue 的 Raft 实现

### 2.1 Leader 选举

```text
Node 1 (Leader)    Node 2 (Follower)    Node 3 (Follower)
      │                    │                    │
      │──心跳─────────────▶│                    │
      │──心跳─────────────────────────────────▶│
      │                    │                    │
      │                    │ (Leader 故障)       │
      │                    │                    │
      │                    │◀──选举请求──────────│
      │                    │──投票─────────────▶│
      │                    │                    │ (成为 Leader)
```

### 2.2 日志复制

```text
Producer ──▶ Leader
                │
                ├──复制──▶ Follower 1
                │            │
                │            └──确认──▶ Leader
                │
                └──复制──▶ Follower 2
                             │
                             └──确认──▶ Leader

多数确认后 → 消息提交 → 返回 Producer 确认
```

## 3. Quorum Queue 配置

```java
Map<String, Object> args = new HashMap<>();
args.put("x-queue-type", "quorum");
args.put("x-quorum-initial-group-size", 3);
args.put("x-delivery-limit", 5);
channel.queueDeclare("order.quorum", true, false, false, args);
```

## 4. Leader 选举配置

```ini
# rabbitmq.conf
quorum_queue.leader_locator = client-local  # 优先本地节点
# 或
quorum_queue.leader_locator = balanced       # 均衡分布
```

## 5. 性能特性

| 特性 | 说明 |
| :-- | :-- |
| 写入延迟 | 比经典队列高（需要多数确认） |
| 读取延迟 | Leader 本地读取，与经典队列相当 |
| 吞吐量 | 受 Raft 日志复制影响，略低于经典队列 |
| 消息堆积 | 内存受限，不适合大量堆积 |

## 6. 运维命令

```bash
# 查看队列 Leader 分布
rabbitmq-diagnostics quorum_queue_members <queue-name>

# 查看 Raft 状态
rabbitmq-diagnostics inspect_quorum_queue <queue-name>
```
