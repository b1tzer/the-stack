# RabbitMQ 知识库

本页负责选择入口。RabbitMQ 的定位、优势、适用场景和版本建议由[第一篇概览](./01-basics/chapter-01-overview.md)说明。

## 从问题进入

| 你现在的问题 | 入口 |
| :-- | :-- |
| 不确定消息应该投递到哪里 | [Exchange 基础](./02-exchange/chapter-01-exchange-basics.md) |
| 消息可能丢失或发布后没有路由 | [发布确认](./04-producer/chapter-02-publisher-confirm.md) |
| 消费速度不稳定或可能重复消费 | [ACK 与预取机制](./05-consumer/chapter-02-ack-mechanism.md) |
| 节点故障后需要继续提供服务 | [集群与仲裁队列](./07-clustering/chapter-03-quorum-raft.md) |
| 准备安装或完成首个应用 | [实践章节](./10-practice/chapter-01-installation.md) |

## 按目录浏览

- **基础与路由**：[基础概览](./01-basics/chapter-01-overview.md)、[Exchange](./02-exchange/chapter-01-exchange-basics.md)、[队列](./03-queue/chapter-01-queue-basics.md)。
- **生产与消费**：[发布确认](./04-producer/chapter-02-publisher-confirm.md)、[ACK 机制](./05-consumer/chapter-02-ack-mechanism.md)、[死信队列](./03-queue/chapter-06-dead-letter.md)。
- **集群与运维**：[集群](./07-clustering/chapter-01-cluster-basics.md)、[故障排查](./08-operations/chapter-03-troubleshooting.md)、[性能调优](./08-operations/chapter-04-performance-tuning.md)。
- **实践与参考**：[首次应用](./10-practice/chapter-02-first-app.md)、[命令速查](./reference/commands.md)。

## 内容边界

Kafka 的分区与日志模型放在 [Kafka 知识库](../kafka/index.md)，Spring 集成放在 [Spring 知识库](../spring/index.md)，业务侧的幂等和事务方案放在[场景实战](../scenarios/index.md)。
