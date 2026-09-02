# Federation 与 Shovel

> Federation 和 Shovel 是 RabbitMQ 的跨集群消息复制方案，用于连接不同数据中心或不同集群。

## 1. Federation

Federation 在两个 RabbitMQ 集群之间建立"联邦"关系，上游的消息自动同步到下游。

```text
上游集群 (Beijing)              下游集群 (Shanghai)
  Exchange A ──Federation Link──▶ Exchange A'
  Queue B    ──Federation Link──▶ Queue B'
```

### 配置

```bash
# 启用 Federation 插件
rabbitmq-plugins enable rabbitmq_federation
rabbitmq-plugins enable rabbitmq_federation_management

# 添加 upstream
rabbitmqctl set_parameter federation-upstream my-upstream \
  '{"uri":"amqp://user:***@upstream-host:5672","prefetch-count":1000}'

# 设置策略
rabbitmqctl set_policy federate-me "^order\\." \
  '{"federation-upstream-set":"all"}' --apply-to exchanges
```

### 适用场景

- 跨数据中心消息同步
- 多环境（开发/测试/生产）消息桥接
- 云上云下消息互通

## 2. Shovel

Shovel 比 Federation 更灵活：可以在任意两个 Broker（不限于 RabbitMQ）之间搬运消息。

```text
Source Broker ──Shovel──▶ Destination Broker
(RabbitMQ)                (RabbitMQ / 其他 AMQP)
```

### 配置

```bash
rabbitmq-plugins enable rabbitmq_shovel
rabbitmq-plugins enable rabbitmq_shovel_management

# 动态 Shovel
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

## 3. Federation vs Shovel

| 维度 | Federation | Shovel |
|------|-----------|--------|
| 粒度 | Exchange/Queue 级别 | 单条消息级别 |
| 配置 | 策略驱动 | 参数驱动 |
| 协议 | 只支持 AMQP | 支持 AMQP + MQTT |
| 灵活性 | 较低 | 较高 |
| 适用场景 | 集群间同步 | 精确的消息搬运 |

## 4. 注意事项

- Federation 是异步的，不保证实时同步
- 消息可能被重复投递（网络中断恢复后）
- 消费者确认不会回传到上游（下游独立消费）
- 跨集群延迟会影响整体吞吐量
