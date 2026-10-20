# 镜像队列

> ⚠️ 镜像队列（Mirrored Queue）自 RabbitMQ 3.9 弃用、4.0 移除，被 Quorum Queue 取代。本章仅作历史参考。

## 1. 镜像队列的原理

```txt
Queue: order.queue
  Master (Node 1) ← 所有读写
    │
    ├─ Mirror (Node 2) ← 异步复制
    └─ Mirror (Node 3) ← 异步复制
```

- 所有读写都走 Master
- Master 将消息异步复制到 Mirror
- Master 故障后，最老的 Mirror 默认提升为新 Master，可能因未同步而丢失消息

## 2. 镜像队列的问题

| 问题 | 说明 |
| :-- | :-- |
| 异步复制 | Master 故障时，尚未同步到被提升 Mirror 的消息可能丢失 |
| 故障转移 | 默认提升最老的 Mirror，受 ha-promote-on-failure 策略影响 |
| 性能开销 | 所有队列操作由 Master 处理，复制还增加网络与节点开销 |
| 网络分区 | 是否脑裂取决于分区处理策略，不必然出现多个 Master |

## 3. 为什么迁移到 Quorum Queue

| 维度 | 镜像队列 | Quorum Queue |
| :-- | :-- | :-- |
| 复制机制 | 主副本向镜像副本异步复制 | 基于 Raft 的多数派提交 |
| 消息安全 | 故障时可能丢失尚未同步到被提升副本的消息 | 已确认消息受多数派提交机制保护 |
| 故障转移 | 默认提升最老的 Mirror，结果受同步状态影响 | 通过 Raft 选举新 Leader，遵循日志安全规则 |
| 设计侧重点 | 以镜像复制换取高可用 | 侧重数据安全与一致性 |

**结论**：镜像队列已在 4.0 移除，新项目需要复制队列时优先使用 [Quorum Queue](../03-queue/chapter-03-quorum-queue.md)。复制与故障转移机制见 [Quorum 与 Raft](./chapter-03-quorum-raft.md)。

## 4. 迁移步骤

队列类型不能通过修改属性原地转换，需要另建 Quorum Queue 承接流量后再切换。生产者面向 Exchange 发布，切换时改的是路由目标（Exchange 绑定或 routing key），消费者也要转向新队列。下面是停机窗口下的简化流程，完整方案见 [Quorum Queue 的迁移章节](../03-queue/chapter-03-quorum-queue.md)。

```bash
# 1. 创建 Quorum Queue，配置 Exchange 绑定
# 2. 停止生产者，确认旧 Queue 不再接收新消息
# 3. 排空旧 Queue，处理未确认消息
# 4. 调整绑定，让路由指向新 Queue（解除旧 Queue 绑定或改 routing key）
# 5. 把消费者切换到新 Queue，恢复生产并验证
# 6. 确认业务正常后，删除旧 Queue 和镜像策略
```

以上流程省略了消息搬运、重复投递处理和回滚步骤，生产迁移前需按停机窗口与消息量选择具体方案。

清理策略前先查看实际生效的策略名称，不要假设都叫 ha-all；同一策略可能匹配多个队列，确认不再被其他队列需要后再清理：

```bash
rabbitmqctl list_policies -p /            # / 是默认虚拟主机，按实际环境替换
rabbitmqctl clear_policy -p / my-policy   # my-policy 替换为实际策略名
```
