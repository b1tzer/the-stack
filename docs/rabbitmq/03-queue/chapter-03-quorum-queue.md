# Quorum Queue

> Quorum Queue（仲裁队列）是 RabbitMQ 3.8 引入的队列类型，基于 Raft 共识协议实现高可用。它是镜像队列的替代方案，推荐在生产环境使用。

## 1. Raft 共识

Quorum Queue 使用 Raft 协议保证数据一致性：

```text
Leader ──复制──▶ Follower 1
  │
  └──复制──▶ Follower 2

写入需要 多数节点 确认（2/3 或 3/5）
```

- Leader 处理所有读写
- Follower 同步数据
- Leader 故障时自动选举新 Leader

## 2. 声明 Quorum Queue

```java
Map<String, Object> args = new HashMap<>();
args.put("x-queue-type", "quorum");
channel.queueDeclare("order.quorum", true, false, false, args);
```

关键特性：

- 必须持久化（durable = true）
- 不支持 exclusive
- 不支持 auto-delete

## 3. 与镜像队列的对比

| 特性 | Classic + 镜像 | Quorum Queue |
| :-- | :-- | :-- |
| 一致性协议 | 异步复制 | Raft 共识 |
| 消息确认 | Leader 确认即返回 | 多数节点确认 |
| 数据安全 | 可能丢消息 | 不丢已确认消息 |
| 故障恢复 | 可能数据不一致 | 自动选举 Leader |
| 吞吐量 | 更高 | 略低 |
| 消息堆积 | 更好 | 受限于内存 |
| 死信 | 支持 | 支持 |
| 优先级 | 支持 | 部分支持 |

## 4. 节点数量建议

| 节点数 | 容错能力 | 适用场景 |
| :-- | :-- | :-- |
| 3 | 容忍 1 节点故障 | 大多数场景 |
| 5 | 容忍 2 节点故障 | 高可靠性要求 |
| 7 | 容忍 3 节点故障 | 极端可靠性要求 |

推荐 3 节点或 5 节点。

## 5. 配置参数

```java
Map<String, Object> args = new HashMap<>();
args.put("x-queue-type", "quorum");
args.put("x-quorum-initial-group-size", 3);    // 初始组大小
args.put("x-delivery-limit", 5);                // 消息重投次数限制
args.put("x-dead-letter-exchange", "dlx");       // 死信交换器
args.put("x-dead-letter-routing-key", "dlx.order"); // 死信路由 key
```

## 6. 适用场景

- 生产环境必须使用（替代镜像队列）
- 对数据安全要求高的场景
- 金融、订单、支付等核心业务
- 需要自动故障恢复的场景

## 7. 不适用场景

- 超高吞吐（百万级 QPS）
- 大量消息堆积（亿级）
- 极低延迟要求（微秒级）
- 临时队列、排他队列
