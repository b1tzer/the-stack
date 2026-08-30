# 管理与监控

> RabbitMQ 提供丰富的管理工具：Management UI、HTTP API、CLI、Prometheus 插件。

## 1. Management UI

```bash
rabbitmq-plugins enable rabbitmq_management
# 访问 http://host:15672
```

功能概览：

- 队列/交换器/绑定管理
- 消息发布与消费
- 用户与权限管理
- 集群状态监控
- 连接与通道查看

## 2. HTTP API

```bash
# 获取队列列表
curl -u guest:guest http://localhost:15672/api/queues

# 获取队列详情
curl -u guest:guest http://localhost:15672/api/queues/%2F/order.queue

# 发布消息
curl -u guest:guest -X POST http://localhost:15672/api/exchanges/%2F/order.exchange/publish \
  -H "content-type: application/json" \
  -d '{"properties":{},"routing_key":"order.created","payload":"hello","payload_encoding":"string"}'
```

## 3. rabbitmqctl CLI

```bash
# 集群状态
rabbitmqctl cluster_status

# 队列列表
rabbitmqctl list_queues name messages consumers

# 连接列表
rabbitmqctl list_connections name peer_host state

# 通道列表
rabbitmqctl list_channels consumer_count messages_unacknowledged

# 用户管理
rabbitmqctl add_user admin password
rabbitmqctl set_user_tags admin administrator
rabbitmqctl set_permissions -p / admin ".*" ".*" ".*"
```

## 4. Prometheus 插件

```bash
rabbitmq-plugins enable rabbitmq_prometheus
# 指标端点 http://host:15692/metrics
```

### 4.1 关键指标

| 指标 | 说明 |
| :-- | :-- |
| rabbitmq_queue_messages | 队列消息总数 |
| rabbitmq_queue_messages_ready | 待消费消息数 |
| rabbitmq_queue_messages_unacked | 未确认消息数 |
| rabbitmq_queue_consumers | 消费者数量 |
| rabbitmq_connections | 连接数 |
| rabbitmq_channels | 通道数 |
| rabbitmq_node_mem_used | 节点内存使用 |
| rabbitmq_node_disk_free | 节点磁盘空闲 |

## 5. Grafana Dashboard

推荐 Dashboard：

- RabbitMQ Overview: ID 10991
- RabbitMQ Queue: ID 11003
- RabbitMQ Erlang: ID 11005

## 6. 告警规则

| 告警 | 条件 |
| :-- | :-- |
| 内存告警 | 内存使用 > 80% |
| 磁盘告警 | 磁盘空闲 < 阈值 |
| 队列堆积 | messages > 10000 持续 5 分钟 |
| 消费者缺失 | consumers = 0 持续 2 分钟 |
| 连接数告警 | connections > 阈值 |
| 网络分区 | partitions > 0 |
