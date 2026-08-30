# 集群基础

> RabbitMQ 集群提供高可用和水平扩展能力。理解集群架构、节点类型和数据分布，是运维 RabbitMQ 的基础。

## 1. 集群架构

```text
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│   Node 1     │  │   Node 2     │  │   Node 3     │
│  (disc)      │  │  (disc)      │  │  (ram)       │
│              │  │              │  │              │
│  Queue A     │  │  Queue A     │  │  Queue B     │
│  (master)    │  │  (mirror)    │  │  (master)    │
│              │  │              │  │              │
│  元数据       │  │  元数据       │  │  元数据       │
│  消息数据     │  │  消息数据     │  │  仅内存      │
└──────────────┘  └──────────────┘  └──────────────┘
```

## 2. 节点类型

| 类型 | 说明 | 数据存储 |
| :-- | :-- | :-- |
| disc | 磁盘节点 | 元数据 + 消息持久化到磁盘 |
| ram | 内存节点 | 元数据仅在内存，消息可持久化 |

推荐：至少 2 个 disc 节点，其余可以是 ram 节点。

## 3. 集群搭建

### 3.1 Docker Compose

```yaml
services:
  rabbitmq1:
    image: rabbitmq:3-management
    hostname: rabbitmq1
    environment:
      RABBITMQ_ERLANG_COOKIE: "SWQOKODSQALRPCLNMEQG"

  rabbitmq2:
    image: rabbitmq:3-management
    hostname: rabbitmq2
    environment:
      RABBITMQ_ERLANG_COOKIE: "SWQOKODSQALRPCLNMEQG"

  rabbitmq3:
    image: rabbitmq:3-management
    hostname: rabbitmq3
    environment:
      RABBITMQ_ERLANG_COOKIE: "SWQOKODSQALRPCLNMEQG"
```

### 3.2 加入集群

```bash
# 在 Node 2 上执行
rabbitmqctl stop_app
rabbitmqctl join_cluster rabbit@rabbitmq1
rabbitmqctl start_app

# 在 Node 3 上执行
rabbitmqctl stop_app
rabbitmqctl join_cluster --ram rabbit@rabbitmq1
rabbitmqctl start_app
```

## 4. Erlang Cookie

集群节点通过 Erlang Cookie 进行认证：

- 所有节点必须使用相同的 Cookie
- Cookie 位于 `/var/lib/rabbitmq/.erlang.cookie`
- 权限必须是 400（仅所有者可读）

## 5. 集群元数据

所有节点共享以下元数据：

- 队列定义
- 交换器定义
- 绑定关系
- vhost 定义
- 用户权限

元数据变更通过 Erlang 分发协议同步。

## 6. 集群端口

| 端口 | 说明 |
| :-- | :-- |
| 5672 | AMQP 协议 |
| 15672 | Management UI |
| 4369 | epmd（Erlang Port Mapper Daemon） |
| 25672 | 节点间通信（Erlang distribution） |
