# Federation 与 Shovel

> Federation 和 Shovel 是 RabbitMQ 跨集群/跨机房消息同步的两种方案。

## 1. Federation

Federation 在两个 RabbitMQ 实例之间建立单向消息流：

```text
Upstream (上游)                Downstream (下游)
┌──────────┐                  ┌──────────┐
│ Exchange │──Federation Link──▶│ Exchange │
│  Queue   │                  │  Queue   │
└──────────┘                  └──────────┘
```

### 1.1 配置

```bash
# 启用插件
rabbitmq-plugins enable rabbitmq_federation
rabbitmq-plugins enable rabbitmq_federation_management

# 配置 upstream
rabbitmqctl set_parameter federation-upstream my-upstream \
  '{"uri":"amqp://user:pass@upstream-host","ack-mode":"on-confirm"}'

# 配置 policy
rabbitmqctl set_policy federate "^federated\." \
  '{"federation-upstream-set":"all"}' --apply-to exchanges
```

### 1.2 ACK 模式

| 模式 | 说明 | 可靠性 |
| :-- | :-- | :-- |
| on-confirm | 等待下游确认 | 高 |
| on-publish | 发送即确认 | 中 |
| no-ack | 不确认 | 低 |

## 2. Shovel

Shovel 是更灵活的消息搬运工具：

```text
Source Queue ──Shovel──▶ Destination Exchange
```

### 2.1 配置

```bash
# 启用插件
rabbitmq-plugins enable rabbitmq_shovel
rabbitmq-plugins enable rabbitmq_shovel_management

# 配置 shovel
rabbitmqctl set_parameter shovel my-shovel \
  '{"src-protocol":"amqp091","src-uri":"amqp://source-host","src-queue":"source.queue", \
    "dest-protocol":"amqp091","dest-uri":"amqp://dest-host","dest-exchange":"dest.exchange", \
    "ack-mode":"on-confirm","reconnect-delay":5}'
```

### 2.2 动态 Shovel

```bash
# 创建
rabbitmqctl set_parameter shovel my-shovel '{...}'

# 删除
rabbitmqctl clear_parameter shovel my-shovel

# 查看
rabbitmqctl list_parameters
```

## 3. Federation vs Shovel

| 特性 | Federation | Shovel |
| :-- | :-- | :-- |
| 方向 | 单向 | 单向/双向 |
| 粒度 | 交换器级别 | 队列到交换器 |
| 配置 | Policy | Parameter |
| 适用场景 | 跨集群交换器同步 | 点对点消息搬运 |
| 灵活性 | 较低 | 更高 |

## 4. 典型场景

- 多机房部署，消息就近消费
- 灾备集群，消息实时同步
- 混合云部署，本地与云端消息互通
- 数据迁移，逐步切换消费者
