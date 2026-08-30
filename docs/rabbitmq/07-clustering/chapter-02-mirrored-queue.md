# 镜像队列

> 镜像队列（Mirrored Queue）是 RabbitMQ 经典的高可用方案：队列在多个节点上维护副本。RabbitMQ 3.10+ 已废弃，推荐使用 Quorum Queue。

## 1. 工作原理

```text
Node 1 (Master)    Node 2 (Mirror)    Node 3 (Mirror)
┌──────────┐       ┌──────────┐       ┌──────────┐
│  Queue A │──────▶│  Queue A │──────▶│  Queue A │
│  Master  │ 异步   │  Mirror  │ 异步   │  Mirror  │
└──────────┘       └──────────┘       └──────────┘
```

- Master 处理所有读写
- Mirror 异步复制 Master 的消息
- Master 故障时，最老的 Mirror 提升为新 Master

## 2. 配置方式

### 2.1 命令行配置

```bash
# 所有队列镜像到所有节点
rabbitmqctl set_policy ha-all "." '{"ha-mode":"all"}' --apply-to queues

# 镜像到指定数量的节点
rabbitmqctl set_policy ha-two "." '{"ha-mode":"exactly","ha-params":2}' --apply-to queues

# 镜像到指定节点
rabbitmqctl set_policy ha-nodes "." '{"ha-mode":"nodes","ha-params":["rabbit@node1","rabbit@node2"]}' --apply-to queues
```

### 2.2 队列参数

```java
Map<String, Object> args = new HashMap<>();
args.put("x-ha-policy", "all");
channel.queueDeclare("ha.queue", true, false, false, args);
```

## 3. 同步模式

| 模式 | 说明 | 性能 |
| :-- | :-- | :-- |
| 异步（默认） | Master 确认即返回 | 高 |
| 同步 | 等待 Mirror 确认 | 低 |

```bash
# 强制同步
rabbitmqctl sync_queue <queue-name>

# 取消同步
rabbitmqctl cancel_sync_queue <queue-name>
```

## 4. 故障转移

```text
Master 故障 → 选择最老的 Mirror → 提升为新 Master → 客户端重连
```

故障转移期间：

- 未同步的消息可能丢失
- 客户端需要重新连接
- 消费者需要重新注册

## 5. 与 Quorum Queue 的对比

| 特性 | 镜像队列 | Quorum Queue |
| :-- | :-- | :-- |
| 一致性 | 异步复制 | Raft 共识 |
| 数据安全 | 可能丢消息 | 不丢已确认消息 |
| 性能 | 更高 | 略低 |
| 故障恢复 | 手动/自动切换 | 自动选举 |
| 状态 | 废弃（3.10+） | 推荐 |

**新项目必须使用 Quorum Queue，不要使用镜像队列。**
