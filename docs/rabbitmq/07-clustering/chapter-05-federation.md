# Federation 与 Shovel

> Federation 和 Shovel 是 RabbitMQ 的跨集群消息传递方案。它们解决的是消息要跨集群流动的问题，但这个流动是异步的、有损耗边界的，和集群内同步复制完全不同。

## 1. Federation

Federation 在两个集群之间建立联邦关系，上游的消息自动流向下游。

```txt
上游集群 (Beijing)              下游集群 (Shanghai)
  Exchange A ──Federation Link──▶ Exchange A'
  Queue B    ──Federation Link──▶ Queue B'
```

### Link 的原理

Federation 由下游向上游主动建立连接，流量方向是从上游拉到下游，不是上游推下来。上游把下游当成一个普通消费者，走标准 AMQP 协议。下游集群上出现一个看起来像本地资源的影子，但影子背后是什么，取决于联邦的资源类型。

对 Federated Exchange，下游交换机从上游交换机复制符合其绑定关系的消息流，再按下游的路由规则投递。Federation 会把下游的绑定关系传播到上游，因此不是把上游交换机的全部消息无条件复制过来。

对 Federated Queue，下游队列只在本地有消费需求、且上游有可转移消息时，才从上游队列取消息。它更接近跨节点的按需转移，而不是交换机联邦式的整片复制。

对下游消费者来说，它消费的是一个普通队列，感知不到消息其实来自另一个集群。

### 配置

```bash
rabbitmq-plugins enable rabbitmq_federation
rabbitmq-plugins enable rabbitmq_federation_management

# 添加上游
rabbitmqctl set_parameter federation-upstream my-upstream \
  '{"uri":"amqp://user:***@upstream-host:5672","prefetch-count":1000}'

# 设置策略
rabbitmqctl set_policy federate-me "^order\\." \
  '{"federation-upstream-set":"all"}' --apply-to exchanges
```

### 确认语义

Federation 通过 AMQP 链路异步转发消息，上游、链路、下游的确认分属不同层次。链路如何向上游确认，由上游的 ack-mode 决定，默认是 on-confirm：消息在下游确认发布成功后，才向上游确认。这个默认值在网络错误和 Broker 故障场景下不丢消息，是三档中最慢的。它只覆盖跨链路传递这一段，不替代持久化与业务幂等。

另两档是 on-publish 和 no-ack：on-publish 在下游发布后、尚未获得下游发布确认时就向上游确认，下游 Broker 在确认前故障会丢消息；no-ack 不做确认，最快但最容易丢。

无论哪一档，Federation 都不能提供跨集群的恰好一次投递或强一致。下游消费者 ack 只表示本地消费完成，与链路向上游的确认是两回事。所以 Federation 适合追求最终一致、可容忍重复投递的场景，不适合要求强一致的场景。

### 适用场景

- 跨数据中心消息同步
- 多环境消息桥接
- 云上云下消息互通

## 2. Shovel

Shovel 是一个持续运行的消息转移任务：从源端消费消息，再发布到目标端。源端和目标端可以属于不同 RabbitMQ 集群，也可以是支持相应 AMQP 协议的其他消息系统，两端可以使用不同协议。它不依赖联邦交换机或联邦队列的语义，也不会自动复制上游的拓扑与绑定关系，目标端的队列、交换机是否需要预先声明，取决于配置与协议能力。

```txt
Source Broker ──Shovel──▶ Destination Broker
(RabbitMQ)                (RabbitMQ / 其他 AMQP)
```

### 配置

```bash
rabbitmq-plugins enable rabbitmq_shovel
rabbitmq-plugins enable rabbitmq_shovel_management

rabbitmqctl set_parameter shovel my-shovel \
  '{
    "src-protocol": "amqp091",
    "src-uri": "amqp://source-host:5672",
    "src-queue": "order.queue",
    "dest-protocol": "amqp091",
    "dest-uri": "amqp://dest-host:5672",
    "dest-queue": "order.queue"
  }'
```

这是动态 Shovel，通过运行时参数声明，官方在多数场景推荐优先使用。它的确认模式默认 on-confirm，在目标端确认发布后才向源端确认。

## 3. Federation vs Shovel

| 维度 | Federation | Shovel |
| :-- | :-- | :-- |
| 粒度 | 联邦资源（交换机/队列） | 消息转移任务 |
| 配置 | 策略驱动 | 参数驱动 |
| 协议 | AMQP 0-9-1 | AMQP 0-9-1、AMQP 1.0 |
| 灵活性 | 较低 | 较高 |
| 适用场景 | 集群间消息流分发、按需转移 | 消息迁移、跨 Broker 转发、跨协议转移 |

选型看的是需要的消息流转语义：要让远端交换机接收上游符合绑定关系的消息流，或让消费端在本地无可用消息时从上游队列取消息，用 Federation；要从指定源端持续消费消息并重新发布到另一个 Broker，用 Shovel。两者都需要单独评估确认、重复投递、拓扑管理和故障恢复行为，不能只凭「复制」或「搬运」两个词判断可靠性。

## 4. 消息防环

跨集群用 Federation 做双向或多向同步时，最怕的是消息在两个集群之间来回转发，形成环路，同一条消息被反复复制。

对 Federated Exchange，防环靠 max-hops 参数，它限制消息经过 Federation Link 的次数，默认值为 1，达到上限的消息不再继续经联邦链路转发。这一机制由 RabbitMQ 自动维护，通常不需要用户自行给业务消息添加标记。需要区分的是，Federated Queue 没有同等的显式环路限制，多个联邦队列组成复杂拓扑时，不能指望交换机的 max-hops 规则来兜底。

所以设计双向或多向拓扑时，应明确消息来源与转发方向，优先采用容易验证的拓扑，避免让同一条业务消息经过不必要的多条联邦路径。

## 5. 注意事项

- Federation 与 Shovel 都是异步的，不保证实时同步
- 消息可能被重复投递，网络中断恢复后会有重发
- 确认语义取决于 ack-mode：默认 on-confirm 在下游确认后才向上游确认，on-publish 和 no-ack 存在不同程度的消息丢失风险
- 跨集群延迟、带宽、确认等待时间和消息大小共同影响吞吐，需通过压测确定实际容量，而非单凭网络距离推断
