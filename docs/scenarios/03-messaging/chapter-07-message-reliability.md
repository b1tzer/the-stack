# 消息可靠性闭环

> 本场景回答：一条业务事件从数据库产生到消费完成，怎样做到不丢、可控重试、失败可追踪，并在故障注入后证明这些结论。

## 明确可靠性边界

先区分三种语义：

| 语义 | 含义 | 适用场景 |
| :-- | :-- | :-- |
| At Most Once | 允许丢失，不产生重复 | 指标、日志等可丢事件 |
| At Least Once | 不允许丢失，但可能重复 | 订单通知、库存变更等可幂等事件 |
| Exactly Once | 在约定边界内不丢不重 | 消息系统内部事务，或端到端幂等后的业务效果 |

生产端确认、Broker 持久化和消费端提交只能保护各自的一段链路。业务端到端的“恰好处理一次”仍依赖唯一键、状态守卫或去重表；消息系统承诺的 Exactly Once 不会自动覆盖数据库与下游服务之间的副作用。

```text
业务数据库
  │ 同一事务写业务数据 + Outbox
  ▼
发布任务 ──确认──▶ Broker ──投递──▶ 消费者
                         │             │
                         │             ├─ 幂等写业务库
                         │             ├─ 提交 Offset / ACK
                         │             └─ 失败重试
                         │
                         └─ 持久化与副本

未确认消息留在 Outbox；重试超限进入死信；死信可审计后重放。
```

本文给出 broker 无关的闭环设计。RabbitMQ 的 Confirm、Quorum Queue 和 ACK，以及 Kafka 的 ISR、幂等生产者和事务机制，分别见[消息系统高可用实战](./chapter-04-high-availability.md)、[死信队列](../../rabbitmq/03-queue/chapter-06-dead-letter.md)和 [Exactly Once 语义](../../kafka/03-reliability/chapter-04-exactly-once.md)。

## 用 Outbox 保证业务与事件同时提交

### 1. 建立可重投事件表

```sql
CREATE TABLE outbox_events (
    message_id CHAR(36) NOT NULL,
    aggregate_type VARCHAR(64) NOT NULL,
    aggregate_id VARCHAR(64) NOT NULL,
    event_type VARCHAR(64) NOT NULL,
    payload JSON NOT NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    available_at DATETIME(6) NOT NULL,
    retry_count INT NOT NULL DEFAULT 0,
    last_error VARCHAR(512) NULL,
    created_at DATETIME(6) NOT NULL,
    updated_at DATETIME(6) NOT NULL,
    PRIMARY KEY (message_id),
    INDEX idx_outbox_pending (status, available_at)
) ENGINE=InnoDB;
```

业务写入和事件写入必须在同一个本地事务中：

```sql
START TRANSACTION;
INSERT INTO orders(order_no, user_id, status)
VALUES ('ORD-20261011-001', 1001, 'CREATED');

INSERT INTO outbox_events(
    message_id, aggregate_type, aggregate_id, event_type,
    payload, available_at, created_at, updated_at
) VALUES (
    '3b6b3a6e-3e4e-4d73-9fb7-3c7cc59a86d2',
    'order',
    'ORD-20261011-001',
    'order.created',
    JSON_OBJECT('orderNo', 'ORD-20261011-001', 'userId', 1001),
    UTC_TIMESTAMP(6),
    UTC_TIMESTAMP(6),
    UTC_TIMESTAMP(6)
);
COMMIT;
```

事务提交后，业务记录和事件记录同时存在；提交前崩溃则两者都不存在。不要再依赖“先提交数据库、再调用 MQ”，因为两次操作之间进程崩溃会永久丢事件。

### 2. 发布并记录确认结果

发布任务按 `available_at` 扫描 `PENDING`，调用生产者接口。发送成功只表示客户端调用返回，不等于 Broker 已接收。以下为接口流程示意，不是某个框架的完整实现：

```text
1. 按 message_id 发送消息，并携带幂等生产者能力或业务唯一键
2. 收到 Broker 确认后，将 Outbox 记录标记为 SENT
3. 确认超时或连接失败时，保持 PENDING，递增 retry_count
4. 使用指数退避和随机抖动安排下一次发送
5. 超过重试上限时进入 DEAD，保留 payload 和 last_error
```

若消息在 Broker 确认前已实际落盘，重发会产生重复；消费端仍必须幂等。不要因为生产端幂等就把消费端去重删除。

### 3. 防止重复发布任务同时取同一条事件

同一批发布实例可能同时扫描到同一条 Outbox。可按以下任一方式处理：

- 在单条更新上使用版本号或条件更新，先取得发布权；
- 使用数据库锁或支持抢占的消息表；
- 依赖消息系统支持的幂等生产者，把重复发送限制在协议层。

下面的条件更新用于表达“只有一个任务把状态从 `PENDING` 改为 `SENDING`”：

```sql
UPDATE outbox_events
SET status = 'SENDING',
    updated_at = UTC_TIMESTAMP(6)
WHERE message_id = '3b6b3a6e-3e4e-4d73-9fb7-3c7cc59a86d2'
  AND status = 'PENDING';
```

受影响行数为 0 时，跳过这条记录。发布成功后再标记 `SENT`；发布失败要根据错误决定回到 `PENDING` 或进入退避状态。

## 让 Broker 保存消息

不同消息系统的确认机制不同，但都要回答两个问题：

1. 生产者如何知道消息已经持久化；
2. 单个节点失效后，消息是否仍有足够副本。

| 系统 | 生产端确认 | 副本保护 | 仍需业务处理 |
| :-- | :-- | :-- | :-- |
| RabbitMQ | Publisher Confirm | 对关键消息使用 Quorum Queue 等复制队列 | 重发产生的重复、死信和重放 |
| Kafka | `acks`、幂等生产者、事务按场景选择 | 关键数据提高 `min.insync.replicas`，并结合 ISR | Offset 提交时机、消费副作用 |
| Redis Stream | `XADD` 返回流 ID，可用复制和持久化评估 | 主从、Cluster 和持久化边界不同 | 消费组 PEL、重投与幂等 |

不要只开启“发送成功”日志。确认必须来自 Broker 或明确的协议回执；日志只说明客户端进入了发送流程。

配置值不能脱离副本数、磁盘刷盘策略和故障模型。例如提高确认强度会增加延迟和可用性风险，必须用实际拓扑与压测确定。

## 让消费端只提交已完成的工作

### 1. 先处理业务，再提交位点

消费端的最小安全顺序是：

```text
收到消息
  → 校验消息结构
  → 在业务事务中执行幂等写入
  → 业务事务提交
  → 提交 Offset 或发送 ACK
```

如果业务事务提交后、Offset/ACK 提交前进程崩溃，消息会再次投递。这是 At Least Once 的正常重复，不是异常；幂等写入必须吸收它。

反向顺序“先 ACK 再处理业务”在处理过程中崩溃时会丢消息，除非业务副作用本身可恢复。

### 2. 把幂等边界放进业务事务

订单事件可使用订单状态守卫：

```sql
START TRANSACTION;
UPDATE orders
SET status = 'PAID',
    paid_at = UTC_TIMESTAMP(6)
WHERE order_no = 'ORD-20261011-001'
  AND status = 'PENDING_PAYMENT';

-- 受影响行数为 1 时，才写入本次事件的业务副作用
INSERT INTO payment_effects(event_id, order_no, created_at)
VALUES (
    '3b6b3a6e-3e4e-4d73-9fb7-3c7cc59a86d2',
    'ORD-20261011-001',
    UTC_TIMESTAMP(6)
);
COMMIT;
```

`event_id` 作为唯一键，状态条件作为第二道守卫。第二次消费时条件更新返回 0，或唯一键冲突，均不得再次执行积分、通知等不可撤销副作用。

如果业务动作跨多个服务，使用本地事务加 Outbox、TCC 或 Saga；不要让一个数据库事务跨越长时间网络调用。方案选择见[分布式事务](./chapter-05-distributed-transaction.md)。

## 设计重试、死信和重放

### 1. 使用有界重试

```text
第 1 次立即重试
第 2 次约 5 秒后
第 3 次约 30 秒后
第 4 次约 2 分钟后
之后进入死信或人工队列
```

以上只是格式示例。实际间隔要结合业务超时、下游恢复时间、消息 TTL 和积压速度确定，并加入随机抖动，避免大量消息同时恢复。

无限重试会占用连接、Offset 和存储，并阻塞同分区或同队列的其他消息。只有明确可自动恢复的瞬时错误才适合短重试；数据非法、权限不足和业务冲突应尽快进入死信。

### 2. 死信必须包含足够上下文

死信记录至少保存：

- 原始 `message_id`、业务键和消息时间；
- 原始主题、分区或队列、Offset/投递次数；
- 最后一次错误码、堆栈摘要和重试次数；
- 生产者、消费者版本和关联 Trace ID；
- 是否允许重放、负责人和处理状态。

死信不是垃圾桶。每次进入死信都要告警或进入待办队列；修复问题后按原始 `message_id` 重放，并继续依赖消费端幂等。

### 3. 避免重试破坏顺序

需要严格顺序的消息按业务键路由到同一分区或队列。失败消息立即移到其他消费者，可能让后续消息先完成。

二选一：

- 保持顺序：同键消息串行，失败时暂停该键并原地重试；
- 保持可用：允许乱序，消费端根据版本、状态或最终对账恢复正确结果。

大多数业务同时要求“不阻塞全部流量”和“最终正确”，应优先设计状态版本与补偿，而不是全局串行。

## 监控整条消息链路

只看 Broker 在线状态无法判断消息是否可靠。至少关联以下数据：

| 层级 | 指标或记录 | 异常含义 |
| :-- | :-- | :-- |
| Outbox | `PENDING/SENDING/DEAD` 数量、最老年龄、重试率 | 业务事件没有进入 Broker |
| 生产端 | 发送量、确认延迟、确认失败、重复发送率 | 网络或 Broker 确认异常 |
| Broker | 存储增长、副本不足、ISR 收缩、队列长度 | 持久化或容量风险 |
| 消费端 | Lag、处理速率、失败率、重复率、并发数 | 消费能力不足或业务失败 |
| 死信 | 新增速率、最老记录、重放成功率 | 存在持续性业务错误 |
| 端到端 | Trace ID、源事件数、目标副作用数、对账差异 | 链路整体不一致 |

“生产消息数 = 消费成功数”不能直接作为可靠性结论，因为重复、过滤、分组和业务失败都会改变计数。应按业务键、状态和时间窗口对账。

## 执行故障演练

在预发布环境逐项注入故障，每项都要有预期结果和停止条件：

1. **发送后、确认前杀死生产者**：Outbox 保持待发送或重发，业务数据不丢。
2. **Broker 节点在消息持久化后失效**：消息由剩余副本提供，确认强度按设计生效。
3. **消费者提交业务事务后、ACK 前杀死进程**：消息重投，业务副作用只执行一次。
4. **注入重复消息和乱序消息**：状态守卫与版本控制阻止错误副作用。
5. **持续注入非法消息**：达到重试上限后进入死信并告警，不阻塞正常消息。
6. **制造消费积压**：根据 Lag 和处理速率扩容或限流，确认不会重置 Offset 造成跳跃。

每次演练记录消息 ID、时间线、最终状态和实际 RPO/RTO。只验证服务“没有报错”不算通过。

## 面试追问速答 {#interview-questions}

### 1. 怎么保证消息不丢？

分段回答：业务与事件同事务写入 Outbox；生产端等待 Broker 确认；Broker 使用满足故障模型的持久化和副本；消费者处理业务后才提交 Offset/ACK；死信、监控和对账补齐剩余链路。

### 2. Exactly Once 真的能做到吗？

能做到的是指定边界内，例如 Kafka 生产者到分区的幂等和事务。业务端到端还要把数据库副作用纳入幂等或事务边界，所以通常表述为 At Least Once 加业务幂等。

### 3. 为什么重试反而可能重复？

确认超时并不代表消息未到达，ACK/Offset 提交失败也会重投。接收方无法可靠区分“第一次”和“上一次没提交”，必须用唯一键、条件更新或去重表。

### 4. 死信队列和重试怎么配合？

瞬时错误做有限次数、带抖动的退避重试；确定性错误尽快进入死信。死信必须告警、保留上下文、支持修复后重放，并继续使用原消息 ID。

### 5. 如何同时保证顺序和可用性？

按业务键分区或路由到同一队列可保持局部顺序，但失败会阻塞同键消息。全局顺序代价更高；多数场景使用版本、状态机和最终对账，允许局部乱序后修复。

### 6. 消息积压时怎么处理？

先区分生产突增还是消费变慢；查看 Lag、处理速率和下游瓶颈。可扩容消费者、暂停非关键生产或增加过滤，但不能随意跳 Offset，也不能用无限线程掩盖下游故障。

### 7. 怎么证明消息链路可靠？

在预发布逐段杀死进程、切断连接、注入重复/乱序/非法消息和制造积压，用消息 ID、Outbox、Offset、死信和业务对账证明最终只产生一次正确副作用。

## 相关场景

- 消息重复与去重见[消息去重](./chapter-03-deduplication.md)。
- 局部顺序与重投冲突见[消息顺序性](./chapter-06-message-ordering.md)。
- 本地消息表、TCC 和 Saga 见[分布式事务](./chapter-05-distributed-transaction.md)。
- 端到端幂等手段见[幂等性设计](../02-concurrency/chapter-03-idempotency.md)。
