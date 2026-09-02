# Quorum Queue

> Quorum Queue 是 RabbitMQ 3.8+ 引入的高可用队列类型，基于 Raft 共识协议，取代了已废弃的镜像队列。

## 1. 为什么需要 Quorum Queue

镜像队列（Mirrored Queue）的问题：

- 异步复制：主节点崩溃时，未同步到镜像的消息丢失
- 故障转移复杂：需要重新选举镜像为主节点
- 状态不一致：脑裂时可能出现数据不一致

Quorum Queue 用 Raft 协议解决了这些问题：**每条消息必须被多数节点确认才算写入成功**。

## 2. Raft 协议在 Quorum Queue 中的应用

```text
Producer ──▶ Leader Node ──复制──▶ Follower 1
                             ──复制──▶ Follower 2
                             ──复制──▶ Follower 3

写入成功条件：Leader + 多数 Follower 确认（3节点需要2个确认，5节点需要3个确认）
```

```java
// 声明 Quorum Queue
Map<String, Object> args = new HashMap<>();
args.put("x-queue-type", "quorum");
channel.queueDeclare("order.queue", true, false, false, args);
```

## 3. Quorum Queue 的核心特性

| 特性 | 说明 |
|------|------|
| 强一致 | 每条消息多数确认才算写入成功 |
| 自动 Leader 选举 | Leader 崩溃后自动选举新 Leader |
| 不支持消息回溯 | 消息确认后即删除（和 Classic Queue 一样） |
| 不支持排他 | Quorum Queue 不能是 Exclusive |
| 不支持优先级 | 暂不支持 x-max-priority |
| 消息确认开销 | 每条消息需要 Raft 日志复制 |

## 4. Quorum Queue 参数

| 参数 | 默认值 | 说明 |
|------|--------|------|
| x-queue-type | classic | 必须设为 `quorum` |
| x-quorum-initial-group-size | 不限 | 初始组成员数 |
| x-delivery-limit | 20 | 最大投递次数（超过后进 DLX） |
| x-max-in-memory-length | 0 | 内存中最大消息数 |
| x-max-in-memory-bytes | 0 | 内存中最大字节数 |
| x-dead-letter-exchange | 无 | 死信 Exchange |

### 4.1 x-delivery-limit

这是 Quorum Queue 独有的参数，解决了一个重要问题：**消息被反复拒绝时怎么办**。

```java
Map<String, Object> args = new HashMap<>();
args.put("x-queue-type", "quorum");
args.put("x-delivery-limit", 5);  // 最多投递5次，超过后进 DLX
channel.queueDeclare("order.queue", true, false, false, args);
```

Classic Queue 没有这个参数，消息被 nack(requeue=true) 后会无限重试，可能造成死循环。

### 4.2 内存控制

```java
Map<String, Object> args = new HashMap<>();
args.put("x-queue-type", "quorum");
args.put("x-max-in-memory-length", 1000);   // 内存中最多1000条
args.put("x-max-in-memory-bytes", 104857600); // 内存中最多100MB
channel.queueDeclare("order.queue", true, false, false, args);
```

Quorum Queue 默认不在内存中缓存消息（`x-max-in-memory-length = 0`），消息直接写 Raft 日志。如果需要更快的消费速度，可以增大内存缓存。

## 5. 集群部署

```text
3 节点集群：
  Node 1 (Leader)  ──Raft──▶ Node 2 (Follower)
                           ──Raft──▶ Node 3 (Follower)

写入：Leader + 1 Follower 确认 → 成功
读取：只从 Leader 读（Quorum Queue 不支持从 Follower 读）

Leader 崩溃：自动选举新 Leader（约几秒）
```

### 5.1 节点数量选择

| 节点数 | 容错能力 | 写入需要确认数 |
|--------|----------|----------------|
| 3 | 容忍 1 节点故障 | 2 |
| 5 | 容忍 2 节点故障 | 3 |
| 7 | 容忍 3 节点故障 | 4 |

**推荐 3 或 5 节点**。7 节点以上，Raft 日志复制的开销会显著增加。

## 6. Quorum Queue 的性能特征

**写入性能**：

- 比 Classic Queue 慢（需要 Raft 共识）
- 典型延迟：1-5ms（vs Classic Queue 的微秒级）
- 吞吐量：约 2-5 万 msg/s（3 节点，取决于消息大小和持久化配置）

**消费性能**：

- 和 Classic Queue 相当
- 消费不需要 Raft 共识（只从 Leader 读）

**适用场景**：

- 消息不能丢（订单、支付、通知）
- 需要高可用
- 消息量中等（万级 QPS）

**不适用场景**：

- 需要微秒级延迟（用 Classic Queue）
- 消息量极大（>10 万 QPS，用 Kafka）
- 临时队列（用 Classic Exclusive Queue）

## 7. 从镜像队列迁移到 Quorum Queue

```text
1. 创建新的 Quorum Queue（不同名称）
2. 修改生产者：发送到新 Queue
3. 等待旧 Queue 消费完毕
4. 删除旧 Queue 和镜像策略
```

不能原地转换 Classic Queue 为 Quorum Queue，必须创建新 Queue。
