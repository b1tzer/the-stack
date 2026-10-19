# Quorum Queue

> Quorum Queue 是 RabbitMQ 3.8+ 引入的高可用队列类型，基于 Raft 共识协议，是经典镜像队列的重要迁移目标。

## 1. 为什么需要 Quorum Queue

镜像队列（Mirrored Queue）的问题：

- 异步复制：主节点崩溃时，未同步到镜像的消息丢失
- 故障转移复杂：需要重新选举镜像为主节点
- 状态不一致：脑裂时可能出现数据不一致

Quorum Queue 用 Raft 协议解决了这些问题：**每条消息需复制到多数副本（含 Leader）满足提交条件后，Broker 才向生产者发送 Publisher Confirm**。

## 2. Raft 协议在 Quorum Queue 中的应用

```txt
Producer ──▶ Leader Node ──复制──▶ Follower 1
                             ──复制──▶ Follower 2

提交条件：复制到多数副本（含 Leader）（3 副本需 2 个，5 副本需 3 个）
```

```java
// 声明 Quorum Queue
Map<String, Object> args = new HashMap<>();
args.put("x-queue-type", "quorum");
channel.queueDeclare("order.queue", true, false, false, args);
```

## 3. Quorum Queue 的核心特性

| 特性 | 说明 |
| :-- | :-- |
| 强一致 | 消息复制到多数副本（含 Leader）满足提交条件后才确认 |
| 自动 Leader 选举 | Leader 崩溃后自动选举新 Leader |
| 无历史回放 | 消费者确认后消息不再作为待消费消息保留，不提供日志式任意历史回放 |
| 不支持排他 | Quorum Queue 不能是 Exclusive |
| 优先级 | 4.0 起支持（4.0-4.2 两级、4.3 起 32 级），无需 x-max-priority 声明 |
| 消息确认开销 | 每条消息需要 Raft 日志复制 |

## 4. Quorum Queue 参数

| 参数 | 默认值 | 说明 |
| :-- | :-- | :-- |
| x-queue-type | classic | 必须设为 `quorum` |
| x-quorum-initial-group-size | 3 | 初始副本数 |
| x-delivery-limit | 20（4.0 起） | 投递失败次数限制，超过后丢弃或进 DLX（若配置） |
| x-max-in-memory-length | 已失效 | 3.10 起被忽略，历史配置 |
| x-max-in-memory-bytes | 已失效 | 3.10 起被忽略，历史配置 |
| x-dead-letter-exchange | 无 | 死信 Exchange |

### 4.1 x-delivery-limit

这是 Quorum Queue 独有的参数，解决了一个重要问题：**消息被反复拒绝时怎么办**。默认值 20 自 RabbitMQ 4.0 引入，3.x 没有此默认限制。

```java
Map<String, Object> args = new HashMap<>();
args.put("x-queue-type", "quorum");
args.put("x-delivery-limit", 5);  // 投递失败次数上限，超过后丢弃或进 DLX（若配置）
channel.queueDeclare("order.queue", true, false, false, args);
```

Classic Queue 没有这套内建的投递次数限制，消费者持续以 requeue=true 退回消息且无其他限制时，可能形成快速重投递循环。注意：Quorum Queue 超过投递限制后，若未配置死信交换机，消息会被直接丢弃。需要保留超限消息时应配置死信路由；对死信可靠性有要求时，还需采用并验证 at-least-once 死信策略。

### 4.2 内存控制

`x-max-in-memory-length` 与 `x-max-in-memory-bytes` 是历史配置，自 RabbitMQ 3.10 起被 Quorum Queue 忽略。Quorum Queue 的消息内容存储在磁盘，内存中保留必要的元数据与运行状态，这两个参数已无调优效果。需要控制内存或提升消费速度时，应关注队列积压、消息大小与磁盘 I/O，而非调整这两个参数。

## 5. 集群部署

```txt
3 节点集群：
  Node 1 (Leader)  ──Raft──▶ Node 2 (Follower)
                           ──Raft──▶ Node 3 (Follower)

写入：复制到多数副本（含 Leader）满足提交条件
读取：只从 Leader 读（Quorum Queue 不支持从 Follower 读）

Leader 崩溃：自动选举新 Leader，恢复时间取决于故障检测与集群状态
```

### 5.1 副本数选择

下表指的是单个 Quorum Queue 的副本（Raft 成员）数，而非 RabbitMQ 集群的节点总数。创建队列时可通过 x-quorum-initial-group-size 指定初始副本数，默认 3；集群有 7 个节点，不代表每个 Quorum Queue 都有 7 个副本。

| 副本数 | 容错能力 | 提交所需多数成员数 |
| :-- | :-- | :-- |
| 3 | 容忍 1 副本故障 | 2 |
| 5 | 容忍 2 副本故障 | 3 |
| 7 | 容忍 3 副本故障 | 4 |

**推荐 3 或 5 副本**。副本数越大，Raft 日志复制开销越高。

## 6. Quorum Queue 的性能特征

**写入性能**：

- 比 Classic Queue 慢，需要 Raft 共识复制
- 写入延迟与吞吐受副本数、消息大小、磁盘 I/O 与确认方式影响，实际值需在目标负载下测量

**消费性能**：

- 受消息大小、磁盘 I/O、预取值、确认方式影响，实际值需在目标负载下测量
- 消费不需要 Raft 共识（只从 Leader 读）

**适用场景**：

- 需要在节点故障下提高已确认消息的数据安全性（订单、支付、通知）
- 需要高可用
- 对吞吐没有极端要求

**不适用场景**：

- 需要微秒级延迟（用 Classic Queue）
- 极端吞吐或需要长时间保留、重复读取消息的场景，应根据吞吐、保留与消费语义评估 Kafka 或 RabbitMQ Streams
- 临时队列（用 Classic Exclusive Queue）

## 7. 从镜像队列迁移到 Quorum Queue

不能原地转换 Classic Queue 为 Quorum Queue，必须创建新 Queue。下面的流程是停机窗口下的简化示例，不适用于要求零停机的生产系统。

```txt
1. 创建新的 Quorum Queue（不同名称）
2. 停止生产者，确保旧 Queue 不再接收新消息
3. 排空旧 Queue：让消费者继续运行直至队列清空；或停止消费者后用迁移工具转移剩余消息并核对结果
4. 修改生产者与消费者指向新 Queue
5. 验证新 Queue 收发与消费进度正常
6. 删除旧 Queue 和镜像策略
```

切换期间若新旧 Queue 同时接收消息，可能出现顺序变化或重复处理；已处理但未 ACK 的消息也需妥善处置。需要严格顺序或端到端可靠性时，应参考官方迁移指南采用经过验证的方案。
