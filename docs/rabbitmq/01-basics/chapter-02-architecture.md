# 整体架构

> RabbitMQ 的架构由 Virtual Host、Connection、Channel、Exchange、Queue、Binding 六个核心概念组成。理解它们之间的关系，是掌握 RabbitMQ 的基础。

## 1. 架构层次

```text
┌─────────────────────────────────────────────┐
│                RabbitMQ Broker               │
│                                              │
│  ┌────────────────────────────────────────┐  │
│  │         Virtual Host (vhost)           │  │
│  │                                        │  │
│  │   Connection ← Channel ← Producer     │  │
│  │                                        │  │
│  │   Exchange ──Binding──▶ Queue          │  │
│  │                                        │  │
│  │   Consumer ← Channel ← Connection     │  │
│  └────────────────────────────────────────┘  │
│                                              │
│  ┌────────────────────────────────────────┐  │
│  │         Virtual Host (vhost)           │  │
│  │           ...                          │  │
│  └────────────────────────────────────────┘  │
└─────────────────────────────────────────────┘
```

## 2. 核心组件

### 2.1 Virtual Host

vhost 是逻辑隔离单元，类似于数据库中的 schema：

- 不同 vhost 的 Exchange、Queue 完全隔离
- 权限按 vhost 粒度控制
- 生产环境建议按业务域划分 vhost

### 2.2 Connection 与 Channel

```text
Application → TCP Connection → Channel 1 → 发布消息
                              → Channel 2 → 消费消息
                              → Channel 3 → 管理操作
```

- Connection 是 TCP 长连接，开销较大
- Channel 是 Connection 内的虚拟连接，轻量级
- 一个 Connection 可以复用多个 Channel
- Java 客户端推荐一个线程一个 Channel

### 2.3 Exchange

Exchange 是消息路由的入口，不存储消息：

| 类型 | 路由规则 |
| :-- | :-- |
| direct | routing key 精确匹配 |
| topic | routing key 通配符匹配 |
| fanout | 广播到所有绑定队列 |
| headers | 基于消息属性匹配 |

### 2.4 Queue

Queue 是消息的存储单元：

- 消息最终存储在 Queue 中
- 消费者从 Queue 拉取或订阅消息
- 支持持久化、排他、自动删除等属性

### 2.5 Binding

Binding 是 Exchange 和 Queue 之间的连接关系：

- 包含 routing key 或 headers 匹配规则
- 一个 Exchange 可以绑定多个 Queue
- 一个 Queue 可以绑定多个 Exchange

## 3. Erlang 运行时

RabbitMQ 基于 Erlang/OTP 构建：

- Erlang 的轻量级进程模型天然适合消息代理
- 每个 Queue 是一个 Erlang 进程
- 分布式 Erlang 提供集群通信能力
- BEAM 虚拟机的软实时特性保证低延迟

## 4. 消息流转全流程

```text
1. Producer 建立 Connection，创建 Channel
2. Producer 发送消息到指定 Exchange，携带 routing key
3. Exchange 根据类型和 routing key 匹配 Binding
4. 消息路由到匹配的 Queue
5. Queue 将消息推送给订阅的 Consumer（或 Consumer 主动拉取）
6. Consumer 处理完成后发送 ACK
7. Queue 收到 ACK 后删除消息
```
