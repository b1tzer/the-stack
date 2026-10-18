# Pipeline 与 Pub/Sub

> Pipeline 用批量发送优化网络往返，Pub/Sub 用订阅机制实现消息广播。两者都运行在单机 Redis 上，本章讲解各自的用法、局限与适用场景。

## 1. Pipeline

Pipeline（管道）把多条命令批量发送给 Redis，一次性接收全部结果，减少网络往返（RTT）。

### 1.1 问题：RTT 开销

先看一个容易忽略的事实，Redis 命令执行本身极快，单条命令在内存中的执行时间通常是微秒级。真正拖慢批量操作的，是命令之间的网络往返。

```txt
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

![逐条发送与管道发送的 RTT 对比](/redis/02-standalone-core-chapter-04-pipeline-pubsub-2.svg)

RTT 的数量级决定了优化的价值。同机房内一次 RTT 可能只有零点几毫秒，跨机房或跨地域时一次 RTT 可能涨到几十毫秒。100 条命令如果逐条发送，跨地域场景就要付出 100 次 RTT，总延迟以秒计；改用 Pipeline 一次发出，总延迟收敛到 1 次 RTT 加服务端执行时间。命令越多、链路越远，收益越明显。

### 1.2 工作原理

Pipeline 是纯粹的客户端优化，服务端的执行语义没有任何变化。

客户端把多条命令编码成连续的 RESP 字节流，一次性写入 socket，不等待中间响应；写完后统一读取服务端按顺序返回的结果。

```txt
逐条发送：
  写 SET → 读 OK → 写 GET → 读 "1" → 写 INCR → 读 2
  （每次写读之间都要等一个 RTT）

管道发送：
  写 SET GET INCR（连续写入，不等待）→ 统一读取 OK "1" 2
```

服务端仍然逐条执行命令，只是收到的是一个连续的命令流，处理完第一条就处理下一条，再把结果按命令顺序写回同一个连接。

由此得到两个关键结论。

1. 结果顺序与命令顺序严格一致。客户端靠「第 N 条命令对应第 N 个响应」匹配结果，不需要额外的请求 ID。
2. 不改变原子性。管道只是把命令并发地送达，不是把命令打包成一个不可分割的单元。执行到一半时，其他客户端的命令仍可能插进来。

从 RESP 协议的角度看，Pipeline 没有引入任何新协议，只是把多个命令块连续写进同一个输入缓冲区（协议格式见 [RESP 协议](./chapter-02-command-resp.md#resp-protocol)）。服务端逐块解析、逐块执行，与单独发送每个命令时的解析和执行过程完全相同。所以 Pipeline 的本质是「把多次发送合并成一次发送」，而不是一种新的服务端能力。

### 1.3 Java 实现

Jedis 的 `pipelined()` 返回一个 `Pipeline` 对象，命令先缓冲在客户端，`sync()` 时一次性发出并取回全部结果。

```java
// Jedis
try (Jedis jedis = pool.getResource()) {
    Pipeline pipeline = jedis.pipelined();
    Response<String> setResult = pipeline.set("a", "1");
    Response<String> getResult = pipeline.get("a");
    Response<Long> incrResult = pipeline.incr("a");
    pipeline.sync();  // 一次性发出并取回全部结果

    System.out.println(getResult.get());  // "1"
    System.out.println(incrResult.get()); // 2
}
```

Lettuce 默认开启自动刷新，每条命令调用即发送。要用 Pipeline，需要先 `setAutoFlushCommands(false)` 关闭自动刷新，让命令暂存在客户端缓冲区，再 `flushCommands()` 一次性发出。

```java
// Lettuce（异步）
StatefulRedisConnection<String, String> connection = client.connect();
RedisAsyncCommands<String, String> async = connection.async();

// 关闭自动刷新，命令先暂存不发送
connection.setAutoFlushCommands(false);
try {
    RedisFuture<String> setFuture = async.set("a", "1");
    RedisFuture<String> getFuture = async.get("a");
    RedisFuture<Long> incrFuture = async.incr("a");

    // 统一刷新，批量发送三条命令
    connection.flushCommands();

    // 等待结果
    System.out.println(setFuture.get());  // OK
    System.out.println(getFuture.get());  // "1"
    System.out.println(incrFuture.get()); // 2
} finally {
    // 恢复自动刷新并关闭连接
    connection.setAutoFlushCommands(true);
    connection.close();
}
```

两者的差异在缓冲位置。Jedis 的 `Pipeline` 对象负责缓冲，Lettuce 靠连接级的自动刷新开关控制。共同点是都要显式触发一次批量发送动作，Jedis 用 `sync()`，Lettuce 用 `flushCommands()`。

### 1.4 性能收益

Pipeline 的收益取决于省掉的 RTT 次数，与单条命令的执行耗时无关。

把 N 条命令从逐条发送改为管道发送，网络往返从 N 次降到 1 次。当 RTT 远大于命令执行时间时，总耗时近似从 `N × RTT` 降到 `RTT + 命令总执行时间`。

用一个量化例子说明。假设单次 RTT 为 20ms，10 000 条 SET 命令每条执行耗时 1 微秒。

- 逐条发送，约 `10 000 × 20ms = 200s`
- 管道发送，约 `20ms + 10ms = 30ms`

差距近万倍。批量写入、批量预热缓存的场景因此必须用 Pipeline。

RTT 很小时收益会被稀释。本地回环场景（RTT 约 0.1ms）下，100 条命令逐条发送也就 10ms，管道优化的绝对收益有限。真正值得用管道的，是跨机房、跨地域这类 RTT 占主导的场景。

### 1.5 关键点

| 要点 | 说明 |
| :-- | :-- |
| 非原子 | Pipeline 只优化网络，不保证命令原子性 |
| 可被插队 | 其他客户端的命令可能插在 Pipeline 命令中间 |
| 结果顺序 | 响应顺序与命令顺序一致，客户端按序匹配 |
| 错误不中断 | 某条命令执行出错，不影响同批其他命令，需逐条检查结果 |
| 批量大小 | 按压测和响应体积分批；大批量命令会连续占用服务端执行线程 |
| 客户端内存 | 命令先缓冲在客户端，批量过大时客户端内存和 GC 压力上升 |
| 不适合事务场景 | 需要原子性时用 MULTI/EXEC 或 Lua |

错误处理值得单独说明。Pipeline 里某条命令出错（比如类型不匹配），Redis 只在这条命令的位置返回错误，其余命令照常执行、照常返回。这一点与事务不同，事务有「入队时语法错误则整个事务不执行」的规则，Pipeline 没有任何整体的错误语义，客户端必须逐条检查每个响应。

### 1.6 选择 Pipeline

需要原子性或条件判断时，应改用事务或 Lua 脚本。三种模式的完整差异和选型建议见[选择事务、Lua 或 Pipeline](./chapter-03-transaction-lua.md#choose-transaction-lua-pipeline)。

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

![发布订阅广播架构](/redis/02-standalone-core-chapter-04-pipeline-pubsub-1.svg)

### 2.2 工作原理

Pub/Sub 的消息投递是服务端主动推送的，与请求-响应模型不同。订阅者发出 `SUBSCRIBE` 后，连接就进入订阅状态，之后不再主动发命令，而是持续接收服务端推来的消息。

服务端用两个字典维护订阅关系。

```txt
pubsub_channels：频道名 → 订阅该频道的客户端列表
pubsub_patterns：模式（如 news.*）→ 订阅该模式的客户端列表
```

`SUBSCRIBE channel1` 把当前客户端加入 `pubsub_channels["channel1"]` 的列表，`PSUBSCRIBE news.*` 则加入模式字典。

`PUBLISH channel1 "hello"` 的投递流程。

```txt
1. 找到 pubsub_channels["channel1"] 的所有客户端，逐个推送消息
2. 遍历所有模式，命中与 channel1 匹配的模式，给对应订阅者推送
3. 返回收到消息的订阅者数量
```

订阅了频道的客户端会收到一次消息；如果它还订阅了匹配的模式，会收到两次，频道订阅一次、模式订阅一次。这是 Pub/Sub 一个容易被忽略的行为。

消息在投递过程中不落盘、不持久化。Redis 找到订阅者列表，把消息写进各自连接的输出缓冲区就算完成，不会为消息保留任何副本。这也是它「发了就忘」的本质来源。

### 2.3 Java 实现

```java
// 订阅者：subscribe 会阻塞当前线程，需在独立线程或进程运行
Jedis jedis = pool.getResource();
jedis.subscribe(new JedisPubSub() {
    @Override
    public void onMessage(String channel, String message) {
        System.out.println("收到消息：" + channel + " -> " + message);
    }
}, "channel1");
```

```java
// 发布者：使用另一条独立连接，与订阅者分开运行
Jedis publisher = pool.getResource();
publisher.publish("channel1", "hello");
```

`subscribe` 是阻塞调用，直到退订（`unsubscribe`）才返回。订阅逻辑必须放在独立线程或进程里运行，发布则用另一条普通连接即可。

### 2.4 关键局限

| 局限 | 说明 |
| :-- | :-- |
| 消息不持久化 | 订阅者不在线时收不到消息，消息也不会被缓存等待重投 |
| 不保证送达 | 没有确认机制，客户端断线或缓冲区满时消息可能丢失 |
| 不支持消息回放 | 无法重新消费历史消息 |
| 广播模式 | 每个订阅者收到所有消息，无法做负载均衡 |
| 订阅关系随连接消失 | 客户端断开后订阅自动解除，重连需重新订阅 |

「不保证送达」的底层原因在于输出缓冲区。Pub/Sub 走的是每个订阅者连接的输出缓冲区，Redis 只负责写进去，不等待客户端确认。如果某个订阅者读得太慢，输出缓冲区被撑满，Redis 会断开这个连接，后续消息全部丢失。

> Pub/Sub 只适合「实时通知」场景（如配置更新广播、缓存清除通知）。可靠性要求高的消息场景用 Stream 或专业消息队列。

### 2.5 Pub/Sub 与 Stream

两者都涉及「消息」，但定位完全不同。

| 维度 | Pub/Sub | Stream |
| :-- | :-- | :-- |
| 消息模型 | 广播，发给所有在线订阅者 | 队列，按消费组竞争消费 |
| 持久化 | 不持久化 | 消息落盘，可回放 |
| 离线消息 | 丢失 | 保留，重连后可继续消费 |
| 确认机制 | 无 | 有（XACK） |
| 典型场景 | 实时通知、缓存失效广播 | 消息队列、事件溯源 |

判断标准很直接。如果消息必须不丢、消费者离线后还要能补消费，用 Stream；如果只是「通知在线的人」，用 Pub/Sub。

## 3. 小结

| 工具 | 核心能力 | 一句话 |
| :-- | :-- | :-- |
| Pipeline | 批量网络 | 多条命令一次发，减少 RTT |
| Pub/Sub | 消息广播 | 发了就忘，实时通知 |
| 事务 | 命令打包 | 入队后一起执行，不支持条件判断 |
| Lua | 服务端脚本 | 原子执行 + 逻辑判断，最灵活 |
