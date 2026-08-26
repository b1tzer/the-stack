# Pipeline 与 PubSub

> Pipeline 与发布订阅是 Redis 的两个辅助能力：Pipeline 用批量发送优化网络往返，PubSub 用订阅机制实现消息广播。本章讲解两者的用法与适用场景。

## 1. Pipeline

Pipeline（管道）把多条命令批量发送给 Redis，一次性接收全部结果，减少网络往返（RTT）。

### 1.1 问题：RTT 开销

一次命令一个往返，N 条命令就有 N 次网络往返：

```text
无 Pipeline：发送 → 等待 → 接收（重复 N 次）
```

### 1.2 Pipeline 的改进

把 N 条命令打包发送，一次性接收 N 个结果：

![Pipeline 批量收发](/redis/04-high-availability-chapter-06-pipeline-pubsub-1.svg)

```java
// Jedis 伪代码
Pipeline pipeline = jedis.pipelined();
pipeline.set("a", "1");
pipeline.get("a");
pipeline.incr("a");
List<Object> results = pipeline.syncAndReturnAll();  // 一次性返回所有结果
```

### 1.3 关键点

| 要点 | 说明 |
| :-- | :-- |
| 非原子 | Pipeline 只优化网络，不保证命令原子性 |
| 不保证顺序隔离 | 其他客户端的命令可能插在中间 |
| 适用批量读 | 批量 GET、批量写入等场景 |

> Pipeline 与事务、Lua 的区别：Pipeline 只是「网络层的批量发送」，命令之间可以被其他客户端插入；事务和 Lua 才是「执行层的原子性」。三者经常被混淆。

## 2. 发布订阅

发布订阅（Pub/Sub）实现消息的广播：发布者向频道发消息，订阅者收到消息。

```bash
SUBSCRIBE channel1 channel2     # 订阅频道
PUBLISH channel1 "hello"        # 向频道发消息
PSUBSCRIBE news.*               # 按模式订阅（匹配多个频道）
```

![发布订阅广播架构](/redis/04-high-availability-chapter-06-pipeline-pubsub-2.svg)

### 2.1 关键点

| 要点 | 说明 |
| :-- | :-- |
| 消息不持久化 | 订阅者不在线时收不到消息，消息不落盘 |
| 一对多广播 | 一条消息推送给所有订阅者 |
| 频道与模式 | 支持精确频道订阅与通配符模式订阅 |
| 不保证送达 | 消息可能丢失，无确认机制 |

> Pub/Sub 的消息不持久化、不保证送达，不适合可靠性要求高的消息场景。需要可靠消息用 Stream（见第一卷）或专业消息队列（Kafka、RocketMQ）。

## 3. 三者对比

| 维度 | Pipeline | 事务（MULTI/EXEC） | Lua 脚本 |
| :-- | :-- | :-- | :-- |
| 核心目的 | 减少网络往返 | 命令原子执行 | 服务端原子脚本 |
| 原子性 | 否 | 是（命令序列） | 是（脚本整体） |
| 逻辑判断 | 否 | 否 | 是 |
| 网络开销 | 低（批量） | 中 | 低（脚本一次发送） |

选型建议：

| 场景 | 推荐 |
| :-- | :-- |
| 批量读写、不在乎原子性 | Pipeline |
| 简单命令打包、要原子性 | 事务 |
| 复杂读-判断-写逻辑、要原子性 | Lua |
