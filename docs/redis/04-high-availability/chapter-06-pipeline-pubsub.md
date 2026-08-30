# Pipeline 与 PubSub

> Pipeline 用批量发送优化网络往返，PubSub 用订阅机制实现消息广播，Stream 用日志结构实现可靠消息。本章讲解三者的用法、区别与适用场景。

## 1. Pipeline

Pipeline（管道）把多条命令批量发送给 Redis，一次性接收全部结果，减少网络往返（RTT）。

### 1.1 问题：RTT 开销

```text
无 Pipeline：
  客户端 → 服务端：SET a 1
  服务端 → 客户端：OK              （1 次 RTT）
  客户端 → 服务端：GET a
  服务端 → 客户端："1"             （1 次 RTT）
  客户端 → 服务端：INCR a
  服务端 → 客户端：2               （1 次 RTT）
  总计：3 次 RTT

有 Pipeline：
  客户端 → 服务端：SET a 1, GET a, INCR a（批量发送）
  服务端 → 客户端：OK, "1", 2             （批量返回）
  总计：1 次 RTT
```

### 1.2 Java 实现

```java
// Jedis
try (Jedis jedis = pool.getResource()) {
    Pipeline pipeline = jedis.pipelined();
    Response<String> setResult = pipeline.set("a", "1");
    Response<String> getResult = pipeline.get("a");
    Response<Long> incrResult = pipeline.incr("a");
    pipeline.sync();  // 执行所有命令

    // 获取结果
    System.out.println(getResult.get());  // "1"
    System.out.println(incrResult.get()); // 2
}
```

```java
// Lettuce（异步）
StatefulRedisConnection<String, String> connection = client.connect();
RedisAsyncCommands<String, String> async = connection.async();

RedisFuture<String> setFuture = async.set("a", "1");
RedisFuture<String> getFuture = async.get("a");
RedisFuture<Long> incrFuture = async.incr("a");

// 所有命令一起发送
async.flushCommands();

// 等待结果
String value = getFuture.get();
```

### 1.3 关键点

| 要点 | 说明 |
| :-- | :-- |
| 非原子 | Pipeline 只优化网络，不保证命令原子性 |
| 可被插队 | 其他客户端的命令可能插在 Pipeline 命令中间 |
| 批量大小 | 单次 Pipeline 不要太大（建议 ≤ 1000 条），避免阻塞服务端 |
| 不适合事务场景 | 需要原子性时用 MULTI/EXEC 或 Lua |

### 1.4 Pipeline vs 事务 vs Lua

| 维度 | Pipeline | 事务 | Lua |
| :-- | :-- | :-- | :-- |
| 核心目的 | 减少网络往返 | 命令原子执行 | 服务端原子脚本 |
| 原子性 | 否 | 是 | 是 |
| 逻辑判断 | 否 | 否 | 是 |
| 网络开销 | 最低 | 中 | 低 |
| 适用场景 | 批量读写 | 简单打包 | 复杂逻辑 |

> 三者经常被混淆。Pipeline 是网络优化，事务是命令打包，Lua 是服务端编程。

## 2. 发布订阅

发布订阅（Pub/Sub）实现消息广播：发布者向频道发消息，所有订阅者收到消息。

### 2.1 基本用法

```bash
# 订阅者
SUBSCRIBE channel1 channel2     # 订阅频道
PSUBSCRIBE news.*               # 按模式订阅

# 发布者
PUBLISH channel1 "hello"        # 向频道发消息
```

![发布订阅广播架构](/redis/04-high-availability-chapter-06-pipeline-pubsub-1.svg)

### 2.2 Java 实现

```java
// 订阅者
Jedis jedis = pool.getResource();
jedis.subscribe(new JedisPubSub() {
    @Override
    public void onMessage(String channel, String message) {
        System.out.println("收到消息：" + channel + " -> " + message);
    }
}, "channel1");

// 发布者
Jedis publisher = pool.getResource();
publisher.publish("channel1", "hello");
```

### 2.3 关键局限

| 局限 | 说明 |
| :-- | :-- |
| 消息不持久化 | 订阅者不在线时收不到消息 |
| 不保证送达 | 没有确认机制，消息可能丢失 |
| 不支持消息回放 | 无法重新消费历史消息 |
| 广播模式 | 每个订阅者收到所有消息，无法做负载均衡 |

> Pub/Sub 只适合「实时通知」场景（如配置更新广播、缓存清除通知）。可靠性要求高的消息场景用 Stream 或专业消息队列。

## 3. Stream

Stream 是 Redis 5.0 引入的日志型数据结构，解决了 Pub/Sub 消息不持久化的问题。

### 3.1 基本用法

```bash
# 生产消息
XADD mystream * name "张三" age 25
# 返回：1526919030474-0（消息 ID）

# 消费消息（阻塞读取）
XREAD COUNT 10 BLOCK 5000 STREAMS mystream 0

# 消费者组（负载均衡）
XGROUP CREATE mystream mygroup $    # 创建消费者组
XREADGROUP GROUP mygroup consumer1 COUNT 1 BLOCK 5000 STREAMS mystream >
XACK mystream mygroup 1526919030474-0  # 确认消息
```

### 3.2 消费者组

消费者组实现负载均衡：同组内的消费者各消费不同的消息，不重复。

```text
消费者组 mygroup：
  consumer1 → 消息 1, 4, 7
  consumer2 → 消息 2, 5, 8
  consumer3 → 消息 3, 6, 9
```

| 特性 | 说明 |
| :-- | :-- |
| 消息持久化 | 消息存储在 Redis 中，不会丢失 |
| 消费者组 | 同组内负载均衡，不重复消费 |
| 确认机制 | `XACK` 确认后消息才标记为已消费 |
| 回放 | 可以从任意位置重新消费 |
| 阻塞读取 | `XREAD BLOCK` 支持阻塞等待新消息 |

### 3.3 Java 实现

```java
// 生产者
jedis.xadd("mystream", StreamEntryID.NEW_ENTRY,
    Map.of("name", "张三", "age", "25"));

// 消费者（消费者组）
jedis.xgroupCreate("mystream", "mygroup", new StreamEntryID("0-0"), true);

List<StreamEntry> entries = jedis.xreadGroup(
    "mygroup", "consumer1",
    XReadGroupParams.xReadGroupParams().count(1).block(5000),
    Map.of("mystream", new StreamEntryID(">"))
);

for (StreamEntry entry : entries) {
    System.out.println("收到：" + entry.getFields());
    jedis.xack("mystream", "mygroup", entry.getID());
}
```

### 3.4 Stream vs Pub/Sub vs 消息队列

| 维度 | Pub/Sub | Stream | Kafka/RocketMQ |
| :-- | :-- | :-- | :-- |
| 消息持久化 | 否 | 是 | 是 |
| 消费者组 | 否 | 是 | 是 |
| 确认机制 | 否 | XACK | ACK |
| 消息回放 | 否 | 支持 | 支持 |
| 吞吐量 | 高 | 中 | 高 |
| 运维复杂度 | 低（Redis 自带） | 低（Redis 自带） | 高（独立部署） |
| 适用场景 | 实时通知 | 轻量级消息 | 大规模消息 |

选型建议：

| 场景 | 推荐 |
| :-- | :-- |
| 实时通知、缓存清除广播 | Pub/Sub |
| 轻量级消息队列（万级 QPS） | Stream |
| 大规模消息（百万级 QPS）、复杂路由 | Kafka / RocketMQ |

## 4. 小结

| 工具 | 核心能力 | 一句话 |
| :-- | :-- | :-- |
| Pipeline | 批量网络 | 多条命令一次发，减少 RTT |
| Pub/Sub | 消息广播 | 发了就忘，实时通知 |
| Stream | 可靠消息 | 轻量级消息队列，持久化 + 消费者组 |
| 事务 | 命令打包 | 入队后一起执行，不支持条件判断 |
| Lua | 服务端脚本 | 原子执行 + 逻辑判断，最灵活 |
