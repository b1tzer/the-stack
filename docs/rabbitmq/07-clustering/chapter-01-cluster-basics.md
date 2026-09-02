# 集群基础

> RabbitMQ 集群提供高可用和水平扩展能力。理解集群架构、节点类型和数据分布，是运维 RabbitMQ 的基础。

## 1. 集群架构

```text
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│   Node 1     │  │   Node 2     │  │   Node 3     │
│  (disc)      │  │  (disc)      │  │  (disc)      │
│              │  │              │  │              │
│  Queue A     │  │  Queue A     │  │  Queue B     │
│  (Leader)    │  │  (Follower)  │  │  (Leader)    │
│              │  │  (Follower)  │  │              │
│  元数据       │  │  元数据       │  │  元数据       │
└──────────────┘  └──────────────┘  └──────────────┘
```

**关键概念**：

- 所有节点共享元数据（Exchange、Queue、Binding 的定义）
- Queue 的数据（消息）只在所属节点上
- Quorum Queue 的消息通过 Raft 复制到多个节点

## 2. 节点类型

| 类型 | 说明 | 推荐 |
|------|------|------|
| disc | 元数据持久化到磁盘 | 至少 2 个 disc 节点 |
| ram | 元数据仅在内存 | 不推荐（重启后元数据丢失） |

```bash
# 加入集群时指定类型
rabbitmqctl join_cluster rabbit@node1          # 默认 disc
rabbitmqctl join_cluster --ram rabbit@node1    # ram 节点
```

## 3. 集群搭建

### 3.1 Docker Compose

```yaml
services:
  rabbitmq1:
    image: rabbitmq:3-management
    hostname: rabbitmq1
    environment:
      RABBITMQ_ERLANG_COOKIE: "SWQOKODSQALRPCLNMEQG"
    volumes:
      - rabbitmq1_data:/var/lib/rabbitmq

  rabbitmq2:
    image: rabbitmq:3-management
    hostname: rabbitmq2
    environment:
      RABBITMQ_ERLANG_COOKIE: "SWQOKODSQALRPCLNMEQG"
    volumes:
      - rabbitmq2_data:/var/lib/rabbitmq

  rabbitmq3:
    image: rabbitmq:3-management
    hostname: rabbitmq3
    environment:
      RABBITMQ_ERLANG_COOKIE: "SWQOKODSQALRPCLNMEQG"
    volumes:
      - rabbitmq3_data:/var/lib/rabbitmq
```

### 3.2 加入集群

```bash
# 在 Node 2 上执行
rabbitmqctl stop_app
rabbitmqctl reset
rabbitmqctl join_cluster rabbit@rabbitmq1
rabbitmqctl start_app

# 验证
rabbitmqctl cluster_status
```

## 4. Erlang Cookie

集群节点通过 Erlang Cookie 进行认证：

- 所有节点必须使用相同的 Cookie
- Cookie 位于 `/var/lib/rabbitmq/.erlang.cookie`
- 权限必须是 400（仅所有者可读）

**Cookie 不一致是集群搭建失败的最常见原因。**

## 5. 集群端口

| 端口 | 说明 |
|------|------|
| 5672 | AMQP 协议 |
| 15672 | Management UI |
| 4369 | epmd（Erlang Port Mapper Daemon） |
| 25672 | 节点间通信（Erlang distribution） |

## 6. 集群的局限

- Queue 的数据不自动复制到所有节点（需要 Quorum Queue 或镜像队列）
- 单个 Queue 的 Leader 只在一个节点上，该节点成为瓶颈
- 网络分区可能导致脑裂

## 7. 节点故障处理

```bash
# 节点优雅关闭
rabbitmqctl stop_app

# 强制移除故障节点（从集群中剔除）
rabbitmqctl forget_cluster_node rabbit@failed_node
```
