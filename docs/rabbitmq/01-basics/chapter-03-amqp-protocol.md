# AMQP 协议

> AMQP 0-9-1 是 RabbitMQ 的核心协议。理解协议帧结构和通信流程，是排查问题、优化性能的基础。

## 1. AMQP 0-9-1 概述

AMQP（Advanced Message Queuing Protocol）是一个开放标准的应用层消息协议：

- 0-9-1 版本是 RabbitMQ 实现的版本
- 基于 TCP，使用二进制帧传输
- 定义了消息格式、交换、队列、绑定等语义

## 2. 协议帧结构

```text
┌──────────┬──────────┬──────────┬──────────┬──────────┐
│  Type    │ Channel  │  Size    │ Payload  │  Frame   │
│ (1 byte) │ (2 byte) │ (4 byte) │ (N byte) │ End (0xCE)│
└──────────┴──────────┴──────────┴──────────┴──────────┘
```

帧类型：

| 类型 | 说明 |
| :-- | :-- |
| Method (1) | AMQP 方法调用（如 Basic.Publish） |
| Header (2) | 消息属性头 |
| Body (3) | 消息体 |
| Heartbeat (8) | 心跳保活 |

## 3. 连接建立流程

```text
Client                          Server
  │                               │
  │──── TCP Connect ─────────────▶│
  │                               │
  │◀─── Protocol Header ──────────│  "AMQP 0-0-9-1"
  │                               │
  │──── Connection.Start-Ok ─────▶│
  │◀─── Connection.Start ─────────│  SASL 机制
  │                               │
  │──── Connection.Tune-Ok ──────▶│  协商参数
  │◀─── Connection.Tune ──────────│  心跳/帧大小
  │                               │
  │──── Connection.Open ─────────▶│
  │◀─── Connection.Open-Ok ───────│
  │                               │
  │◀══════ 连接就绪 ════════════▶│
```

## 4. 关键协议参数

### 4.1 Frame Max

- 默认 131072 字节（128KB）
- 单个 AMQP 帧的最大大小
- 影响大消息的传输效率

### 4.2 Heartbeat

- 默认 60 秒
- 双向心跳检测连接活性
- 生产环境建议 30~60 秒

### 4.3 Channel Max

- 默认 2047
- 单个 Connection 最大 Channel 数
- 高并发场景可适当调大

## 5. AMQP 方法一览

核心方法分类：

| 类 | 方法 | 说明 |
| :-- | :-- | :-- |
| Connection | Start/Tune/Open/Close | 连接管理 |
| Channel | Open/Close/Flow | 通道管理 |
| Exchange | Declare/Delete | 交换器管理 |
| Queue | Declare/Bind/Unbind/Delete | 队列管理 |
| Basic | Publish/Consume/Get/Ack/Nack/Reject | 消息操作 |
| Tx | Select/Commit/Rollback | 事务 |
| Confirm | Select | 发布确认 |
