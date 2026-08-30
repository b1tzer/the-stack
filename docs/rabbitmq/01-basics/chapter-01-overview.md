# RabbitMQ 概览

> RabbitMQ 是什么、为什么选择它、核心架构长什么样——这三个问题的答案构成了理解 RabbitMQ 的起点。本章从 AMQP 协议的历史出发，讲清 RabbitMQ 的设计哲学与适用场景。

## 1. 什么是 RabbitMQ

RabbitMQ 是实现了 AMQP（Advanced Message Queuing Protocol）协议的开源消息代理，由 Rabbit Technologies Ltd 开发，2007 年发布，2010 年被 VMware（后为 Pivotal）收购，现由 Broadcom 维护。

它的本质是一个**智能的消息路由系统**——生产者不直接把消息发给队列，而是先发给 Exchange，由 Exchange 根据路由规则分发到一个或多个队列。

```text
Producer → Exchange → Binding → Queue → Consumer
           ──────── 路由层 ────────  ─── 存储层 ───
```

RabbitMQ 的核心定位：

| 定位 | 说明 |
| :-- | :-- |
| 消息代理 | 可靠地接收、存储、转发消息 |
| 协议网关 | 支持 AMQP 0-9-1、AMQP 1.0、MQTT、STOMP |
| 企业级中间件 | 提供确认、持久化、事务、死信等完整语义 |

## 2. 为什么选择 RabbitMQ

### 2.1 可靠性

RabbitMQ 提供多层消息保障：

```text
Publisher Confirm → 消息到达 Exchange
Mandatory Flag   → 消息路由到队列
Consumer ACK     → 消息被消费者成功处理
持久化            → 消息写入磁盘
镜像/仲裁队列     → 消息跨节点复制
```

### 2.2 灵活路由

Exchange 的四种类型提供了丰富的路由能力：

```text
Direct  → 精确匹配 routing key
Topic   → 通配符匹配 routing key
Fanout  → 广播到所有绑定队列
Headers → 基于消息头匹配
```

### 2.3 协议多面手

RabbitMQ 不只支持 AMQP 0-9-1：

| 协议 | 场景 |
| :-- | :-- |
| AMQP 0-9-1 | 主协议，Java/C#/.NET 客户端 |
| AMQP 1.0 | 企业集成，Azure Service Bus 兼容 |
| MQTT | IoT 设备，轻量级发布订阅 |
| STOMP | WebSocket 消息，Web 应用 |

### 2.4 运维友好

- 内置 Management UI（Web 控制台）
- HTTP API 供自动化运维
- 丰富的 Prometheus 指标
- 插件体系灵活扩展

## 3. 核心架构

```text
┌─────────────┐         ┌─────────────┐
│  Producer   │────────▶│  Exchange   │
└─────────────┘         └──────┬──────┘
                               │ Binding
                    ┌──────────┼──────────┐
                    ▼          ▼          ▼
              ┌──────────┐ ┌──────────┐ ┌──────────┐
              │  Queue   │ │  Queue   │ │  Queue   │
              └────┬─────┘ └────┬─────┘ └────┬─────┘
                   ▼            ▼            ▼
              ┌──────────┐ ┌──────────┐ ┌──────────┐
              │ Consumer │ │ Consumer │ │ Consumer │
              └──────────┘ └──────────┘ └──────────┘
```

## 4. 适用场景

| 场景 | 说明 |
| :-- | :-- |
| 异步处理 | 耗时操作放入队列，主流程快速返回 |
| 应用解耦 | 上下游服务通过消息通信，互不依赖 |
| 流量削峰 | 突发流量进入队列，消费者按能力消费 |
| 事件驱动 | 领域事件发布，实现最终一致性 |
| 消息分发 | 一条消息路由到多个消费者组 |

## 5. 局限性

| 局限 | 说明 |
| :-- | :-- |
| 吞吐量 | 单节点万级 QPS，远低于 Kafka 百万级 |
| 消息堆积 | 堆积大量消息时性能下降明显 |
| 延迟 | 比 Kafka 更高的端到端延迟 |
| 集群扩展 | 水平扩展能力有限，不适合大数据场景 |

**一句话选型建议：**

- 需要可靠投递、灵活路由、低延迟 → RabbitMQ
- 需要高吞吐、大数据流处理、日志收集 → Kafka
- 需要简单轻量、IoT 场景 → EMQX + MQTT
