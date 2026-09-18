# 消息系统高可用实战

> 高可用不是单个开关，是一条链路上的三道防线。本章以订单系统为场景，把 RabbitMQ 分散在各专项里的机制串成一套能落地、能演练的方案。

## 1. 高可用在防什么

消息从生产到消费要经过三段，每一段都可能丢消息或中断服务。高可用的目标是把三段都补上兜底，链条最弱的一环决定整体可用性。

```txt
生产者 ──①发送──▶ Broker ──②投递──▶ 消费者
          这段会丢              这段会丢
        Broker 也会宕机
```

| 环节 | 故障表现 | 兜底机制 | 机制详解 |
| :-- | :-- | :-- | :-- |
| ① 生产者到 Broker | 发送后未落盘，Broker 崩溃 | Publisher Confirm | [Publisher Confirm](../../rabbitmq/04-producer/chapter-02-publisher-confirm.md) |
| ② Broker 内部 | 节点宕机、磁盘损坏 | Quorum Queue 多数确认 | [Quorum Queue](../../rabbitmq/03-queue/chapter-03-quorum-queue.md) |
| ③ Broker 到消费者 | 处理前崩溃、重复投递 | 手动 ACK + 幂等 | [ACK 机制](../../rabbitmq/05-consumer/chapter-02-ack-mechanism.md) |

三段机制各管一段，谁缺了消息都可能丢。下面按「Broker 不挂、消息不丢、消费不中断」的顺序展开，最后给故障演练和 checklist。

## 2. Broker 不挂：仲裁队列选型

Broker 单节点部署时，一台机器宕机，上面的队列和消息一起消失。这一步先解决「服务不挂」。

### 2.1 不用镜像队列

老方案是镜像队列（Mirrored Queue），Master 异步复制到 Mirror。它的致命缺陷在故障那一瞬间：Master 崩溃时，还没来得及同步到 Mirror 的消息就丢了。这是异步复制的天花板，不是配置能救的。RabbitMQ 已在 3.x 废弃镜像队列，细节见[镜像队列](../../rabbitmq/07-clustering/chapter-02-mirrored-queue.md)。

### 2.2 用仲裁队列

仲裁队列（Quorum Queue）用 Raft 共识替代异步复制，写入必须得到多数节点确认才算成功。3 节点集群里，写 Leader 加 1 个 Follower 成功才返回，任何 1 台宕机都不丢消息。

```java
Map<String, Object> args = new HashMap<>();
args.put("x-queue-type", "quorum");
channel.queueDeclare("order.queue", true, false, false, args);
```

`x-queue-type=quorum` 声明仲裁队列，第二个参数 `true` 表示 durable。机制细节（Leader 选举、日志复制、脑裂处理）见 [Quorum 与 Raft](../../rabbitmq/07-clustering/chapter-03-quorum-raft.md)。

### 2.3 节点数怎么定

节点数直接决定容错能力，不是越多越好。

| 节点数 | 容忍故障 | 代价 |
| :-- | :-- | :-- |
| 3 | 1 台 | 最小高可用单元 |
| 5 | 2 台 | 复制开销更高 |
| 4 | 1 台 | 和 3 一样，多一台白费 |

偶数节点是常见误区：4 节点的容错能力和 3 节点相同，都只能容忍 1 台故障，却多付一台的复制成本。生产默认 3 节点，对可靠性要求极高再上 5 节点。

### 2.4 不是所有队列都上仲裁

仲裁队列的代价是写入延迟升到 1 到 5 毫秒、吞吐降到每秒 2 到 5 万条，因为每条消息都要过 Raft 共识。所以按消息的重要程度分队列：

| 队列类型 | 适用 | 理由 |
| :-- | :-- | :-- |
| Quorum Queue | 订单、支付、库存 | 不能丢，可接受毫秒级延迟 |
| Classic Queue | 日志、埋点、临时任务 | 丢了影响小，要吞吐和低延迟 |

消息量大到每秒十万条以上的场景，Raft 复制会成为瓶颈，这时应该考虑 Kafka 而不是硬扛 RabbitMQ。Kafka 的副本模型见 [副本与 ISR](../../kafka/02-core/chapter-04-replication-and-isr.md)，两者取舍见 [消息队列选型](../../kafka/01-intro/chapter-03-mq-comparison.md)。

## 3. 消息不丢：Confirm 和 ACK 两道门

Broker 不挂了，还要保证消息在传输和处理过程中不丢。两道门分别在生产端和消费端。

### 3.1 生产端 Confirm

`basicPublish` 是异步的，调用返回成功不代表 Broker 收到了，TCP 没报错也可能在 Broker 写盘前崩溃。开启 Confirm 后，Broker 会明确回执「这条消息我已安全接收」。

```java
channel.confirmSelect();
channel.basicPublish("order.exchange", "order.created", props, body);
// 同步等待仅作示意，生产用异步确认
boolean confirmed = channel.waitForConfirms(5000);
if (!confirmed) {
    // 未确认：重发或落库补偿
}
```

Confirm 只保证 Broker 接收，不保证被消费。发送超时后的重发会产生重复消息，需要消费端幂等兜底。异步 Confirm、批量确认等完整写法见 [Publisher Confirm](../../rabbitmq/04-producer/chapter-02-publisher-confirm.md)。

### 3.2 消费端手动 ACK

消费端反过来，必须先处理业务再 ack。顺序反了会丢消息：先 ack 后处理，处理时进程崩溃，这条消息已经从队列删除了。

```java
channel.basicConsume("order.queue", false, new DefaultConsumer(channel) {
    @Override
    public void handleDelivery(String tag, Envelope envelope,
                               AMQP.BasicProperties props, byte[] body) {
        try {
            processOrder(body);
            channel.basicAck(envelope.getDeliveryTag(), false);
        } catch (Exception e) {
            channel.basicNack(envelope.getDeliveryTag(), false, true);
        }
    }
});
```

第二个参数 `false` 表示手动确认。重试策略、死信处理见 [ACK 机制](../../rabbitmq/05-consumer/chapter-02-ack-mechanism.md)。

### 3.3 幂等是最后一道

Confirm 重发、nack 重投、消费者崩溃，都会让同一消息被处理多次。队列层保证的是「不丢」，不是「不重复」。去重方案（Redis 去重、唯一约束、乐观锁）见本专题[消息去重](./chapter-05-deduplication.md)，这里不重复。

## 4. 消费不中断：堆积与流控

Broker 和消息都稳了，最后是消费能力。大促时生产者速率翻倍，消费者处理不过来，消息在队列里越堆越多，消费延迟飙升，这也是一种「不可用」。

### 4.1 Prefetch 背压

不设 Prefetch 时，Broker 会无限制推送，直到打爆消费者内存。设了 Prefetch，未确认消息数达到上限，Broker 自动停止推送，消费者 ack 一条才再推一条。

```java
channel.basicQos(50);  // 最多 50 条未确认
```

取值参考消费者每秒处理能力的 1 到 2 倍，机制与取值见 [Prefetch 与背压](../../rabbitmq/05-consumer/chapter-03-prefetch.md)。

### 4.2 横向扩容

单个消费者处理不过来时，加消费者实例，竞争消费同一个队列。扩容不需要改队列配置，新实例挂上即生效。分配策略见本专题[竞争消费者](./chapter-03-competing-consumers.md)。

### 4.3 防死循环

消费者反复 nack 同一条消息会陷入死循环，一直重试一直失败。仲裁队列的 `x-delivery-limit` 参数直接限制最大投递次数，超过后自动转死信。

```java
args.put("x-queue-type", "quorum");
args.put("x-delivery-limit", 5);  // 投递 5 次仍失败，转死信
```

参数含义见 [Quorum Queue](../../rabbitmq/03-queue/chapter-03-quorum-queue.md) §4.1。

## 5. 故障演练：怎么证明真的高可用

配置都上齐了，还得演练验证。纸上谈兵的高可用不算高可用，以下四个演练覆盖上面三段防线，建议上线前跑一遍。

### 5.1 演练一：kill Broker Leader 节点

**操作**：直接 kill 掉仲裁队列的 Leader 节点进程。

**预期**：Raft 在 1 到 5 秒内选举出新 Leader，期间少数未确认消息短暂不可消费，选举完成后恢复正常。

**验证**：

```bash
rabbitmqctl cluster_status  # 确认新 Leader 已选出
rabbitmqctl list_queues     # 确认队列仍在，消息数正确
```

### 5.2 演练二：网络分区

**操作**：用 iptables 断开一个节点和其他节点的网络，模拟脑裂。

**预期**：少数派节点拒绝写入，多数派正常服务，不出现双主。网络恢复后少数派自动同步。

**验证**：断网节点上 `rabbitmqctl cluster_status` 显示分区状态；恢复网络后观察日志里的数据同步记录。策略配置见 [网络分区](../../rabbitmq/07-clustering/chapter-04-network-partition.md)。

### 5.3 演练三：kill 消费者进程

**操作**：消费者处理到一半，直接 kill 进程，不给它 ack 的机会。

**预期**：未 ack 的消息自动重新入队，被其他存活消费者接手，消息不丢。

**验证**：消费端日志出现重复消息处理，靠幂等保证不产生脏数据。

### 5.4 演练四：kill 生产者（Confirm 前）

**操作**：生产者发送后、收到 Confirm 前，kill 进程。

**预期**：生产者重启后重发未确认消息，可能产生重复，消费端幂等兜底。

**验证**：确认业务数据没有重复写入，或重复写入被幂等拦截。

## 6. checklist

| 项 | 说明 |
| :-- | :-- |
| 关键队列用 Quorum Queue | `x-queue-type=quorum`，durable=true |
| 集群 3 节点起步 | 不用偶数节点 |
| 生产端开启 Publisher Confirm | 异步确认，超时重发 |
| 消费端手动 ACK | 先处理再 ack，不要先 ack 再处理 |
| 消费端做幂等 | at-least-once 下必然重复 |
| 设置 Prefetch | 防止消息堆积打爆消费者 |
| 配置 x-delivery-limit | 防止死循环投递 |
| 上线前跑故障演练 | 四类演练至少各跑一次 |
