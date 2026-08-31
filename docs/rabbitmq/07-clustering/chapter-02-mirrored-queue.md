# 镜像队列

> ⚠️ 镜像队列（Mirrored Queue）已在 RabbitMQ 3.x 中废弃，被 Quorum Queue 取代。本章仅作历史参考。

## 1. 镜像队列的原理

```text
Queue: order.queue
  Master (Node 1) ← 所有读写
    │
    ├─ Mirror (Node 2) ← 异步复制
    └─ Mirror (Node 3) ← 异步复制
```

- 所有读写都走 Master
- Master 将消息异步复制到 Mirror
- Master 崩溃后，最老的 Mirror 提升为新 Master

## 2. 镜像队列的问题

| 问题 | 说明 |
|------|------|
| 异步复制 | Master 崩溃时，未同步到 Mirror 的消息丢失 |
| 故障转移慢 | 需要重新选举 Mirror 为 Master |
| 性能瓶颈 | 所有读写都走 Master |
| 脑裂风险 | 网络分区时可能出现多个 Master |

## 3. 为什么迁移到 Quorum Queue

| 维度 | 镜像队列 | Quorum Queue |
|------|---------|--------------|
| 复制方式 | 异步 | 同步（Raft） |
| 消息丢失 | 可能 | 极低（多数确认） |
| 故障转移 | 手动/半自动 | 自动（Raft Leader 选举） |
| 一致性 | 最终一致 | 强一致 |

**结论**：新项目不要用镜像队列，直接用 Quorum Queue。

## 4. 迁移步骤

```bash
# 1. 创建 Quorum Queue（新名称）
# 2. 修改生产者发送到新 Queue
# 3. 等待旧 Queue 消费完毕
# 4. 删除旧 Queue 和镜像策略
rabbitmqctl clear_policy ha-all
```
