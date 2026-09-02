# 延迟队列

> 延迟队列让任务在指定时间之后才被执行，用于订单超时取消、延迟通知、重试退避。本章从最简单的「轮询 ZSet」讲起，暴露它在可靠性上的缺陷，再演进到 Redis Streams 消费组，最后对比独立消息队列，给出选型边界。

## 1. 为什么需要延迟队列

延迟队列与普通队列的区别只有一点：任务入队后不是立即可被消费，而是等到某个时间点才「到期」，到期后消费者才能取到它。

| 场景 | 典型延迟时长 | 例子 |
| :-- | :-- | :-- |
| 订单超时未支付自动取消 | 15 ~ 30 分钟 | 下单后未支付，超时关单释放库存 |
| 延迟发送通知 | 数秒到数分钟 | 注册后 1 分钟发欢迎短信 |
| 重试退避 | 指数递增 | 失败后 1s、2s、4s 依次重试 |
| 定时提醒 | 固定时间点 | 会议开始前 10 分钟提醒 |

核心诉求是「先存起来，到时间才消费」。延迟队列的实现必须回答两个问题：任务存在哪、谁在到期时把它交给消费者。

## 2. ZSet 轮询：最简实现

ZSet 的 `score` 天然可以承载时间戳：`score = 执行时间`，`member = 任务 ID`。到期任务就是「score 小于等于当前时间」的成员，用 `ZRANGEBYSCORE` 一条命令即可取出。

### 2.1 添加任务

```java
public void addDelayedTask(String taskId, long executeAtMillis) {
    stringRedisTemplate.opsForZSet().add("delay:queue", taskId, executeAtMillis);
}
```

### 2.2 原子取出到期任务

「取出」必须把「查询到期任务」和「从队列删除」合并成一条 Lua 脚本，否则两个实例同时轮询会取到同一批任务、重复处理。

```lua
-- KEYS[1] = 延迟队列 ZSet
-- ARGV[1] = 当前时间戳（毫秒）
-- ARGV[2] = 本次最多取多少条
local tasks = redis.call('ZRANGEBYSCORE', KEYS[1], 0, ARGV[1], 'LIMIT', 0, ARGV[2])
if #tasks > 0 then
    redis.call('ZREM', KEYS[1], unpack(tasks))
end
return tasks
```

```java
private static final String DELAY_POP_SCRIPT = """
    local tasks = redis.call('ZRANGEBYSCORE', KEYS[1], 0, ARGV[1], 'LIMIT', 0, ARGV[2])
    if #tasks > 0 then
        redis.call('ZREM', KEYS[1], unpack(tasks))
    end
    return tasks
    """;

@Scheduled(fixedDelay = 1000)  // 每秒轮询一次
public void poll() {
    DefaultRedisScript<List> script = new DefaultRedisScript<>(DELAY_POP_SCRIPT, List.class);
    List<String> tasks = stringRedisTemplate.execute(script, List.of("delay:queue"),
        String.valueOf(System.currentTimeMillis()), "100");
    for (String taskId : tasks) {
        process(taskId);  // 这里暴露了可靠性问题
    }
}
```

### 2.3 ZSet 轮询的三个缺陷

| 缺陷 | 说明 | 后果 |
| :-- | :-- | :-- |
| 取出即丢失 | `ZREM` 后、`process` 前进程崩溃，任务已从队列删除却未执行 | 任务永久丢失 |
| 轮询延迟 | 定时任务间隔决定延迟下限，间隔小则空转浪费 CPU | 延迟不准、空转开销 |
| 单点瓶颈 | 通常只有一台实例轮询，吞吐受限；多实例轮询又需额外防重 | 伸缩性差 |

其中「取出即丢失」最致命。`ZRANGEBYSCORE + ZREM` 把任务删掉后，处理逻辑还没执行，进程崩溃，任务就从队列消失了。这是 ZSet 方案的天花板，不是换一种轮询写法能解决的——它缺的是「消费确认」机制。

## 3. Streams 消费组：可靠投递

Redis 5.0 引入的 Streams 提供了消费组（Consumer Group）、ACK、Pending Entries List（PEL），把「取出即丢失」补上了：消息被消费者读走后仍保留在 Stream 里，只有显式 ACK 才真正标记完成。

### 3.1 核心概念

| 概念 | 说明 |
| :-- | :-- |
| 消息 | Stream 中一条记录，有全局唯一 ID |
| 消费组 | 一组消费者，组内消息竞争消费，组间互不影响 |
| PEL | Pending Entries List，已投递给某消费者但尚未 ACK 的消息 |
| ACK | 消费确认，把消息从 PEL 移除 |
| XCLAIM | 把 PEL 中超时未 ACK 的消息转移给另一个消费者 |

PEL 是可靠性的关键：一条消息从「被消费者读取」到「被 ACK」之间，一直挂在 PEL 上。消费者崩溃了，消息不丢，只会在 PEL 里越积越多，等待被 `XCLAIM` 重新分配。

### 3.2 组合架构：ZSet 调度 + Streams 投递

单靠 Streams 无法实现延迟——消息写入 Stream 就立即可读了。于是用两段式组合：

```text
ZSet 存「未到期任务」 → 调度器定时搬移到期任务 → Stream 消费组可靠消费
```

- **ZSet** 只负责「排序 + 按时间筛选」，天然支持延迟
- **调度器** 是一个定时任务，把到期的任务从 ZSet 搬到 Stream
- **Stream 消费组** 负责可靠消费、ACK、超时重试

![ZSet 调度 + Streams 消费组架构](/redis/06-patterns-chapter-03-delay-queue-1.svg)

### 3.3 调度器：搬移到期任务

搬移同样要原子化：一次 Lua 脚本完成「取到期任务 → 写入 Stream → 从 ZSet 删除」。若中途崩溃，最坏情况是任务已在 Stream 但还没从 ZSet 删（下次搬移重复写入，靠消费端幂等兜底），而不会丢失。

```lua
-- KEYS[1] = 延迟队列 ZSet
-- KEYS[2] = 目标 Stream
-- ARGV[1] = 当前时间戳（毫秒）
-- ARGV[2] = 本次最多搬移多少条
local tasks = redis.call('ZRANGEBYSCORE', KEYS[1], 0, ARGV[1], 'LIMIT', 0, ARGV[2])
for i, task in ipairs(tasks) do
    redis.call('XADD', KEYS[2], '*', 'task', task)
    redis.call('ZREM', KEYS[1], task)
end
return #tasks
```

```java
private static final String MOVE_SCRIPT = """
    local tasks = redis.call('ZRANGEBYSCORE', KEYS[1], 0, ARGV[1], 'LIMIT', 0, ARGV[2])
    for i, task in ipairs(tasks) do
        redis.call('XADD', KEYS[2], '*', 'task', task)
        redis.call('ZREM', KEYS[1], task)
    end
    return #tasks
    """;

@Scheduled(fixedDelay = 500)  // 调度器，半秒搬移一次
public void moveDueTasks() {
    DefaultRedisScript<Long> script = new DefaultRedisScript<>(MOVE_SCRIPT, Long.class);
    stringRedisTemplate.execute(script, List.of("delay:queue", "delay:stream"),
        String.valueOf(System.currentTimeMillis()), "200");
}
```

调度器与消费者解耦后，搬移频率可以独立调优：搬移不消费，只是把「到期的」和「没到期的」分开，真正的处理压力交给消费组。

### 3.4 消费组：命令演示

用 redis-cli 走一遍完整流程：

```bash
# 1. 创建消费组（MKSTREAM 表示 Stream 不存在时先建）
XGROUP CREATE delay:stream group1 0 MKSTREAM

# 2. 消费者 consumer1 读取 10 条新消息，阻塞 2 秒
#    '>' 表示只读「从未投递给本组」的新消息
XREADGROUP GROUP group1 consumer1 COUNT 10 BLOCK 2000 STREAMS delay:stream >

# 3. 处理完成后 ACK，把消息移出 PEL
XACK delay:stream group1 1710000000000-0

# 4. 查看 group1 的 PEL（已投递但未 ACK）
XPENDING delay:stream group1

# 5. 若 consumer1 崩溃，把 PEL 中闲置超过 60 秒的消息转给 consumer2
XCLAIM delay:stream group1 consumer2 60000 1710000000000-0
```

### 3.5 可靠性机制详解

Streams 消费组提供的是 **at-least-once** 语义：消息至少被投递一次，可能重复，绝不丢失。

```text
消息生命周期：
  写入 Stream
    → XREADGROUP 投递给消费者，进入 PEL
    → 消费者处理
    → XACK，移出 PEL（完成）
    → 或消费者崩溃，消息滞留 PEL
    → XCLAIM 转移给其他消费者，重新进入处理流程
```

两条关键路径：

| 路径 | 机制 | 保障 |
| :-- | :-- | :-- |
| 正常消费 | `XREADGROUP` + `XACK` | 处理完才确认，崩溃则消息仍在 PEL |
| 故障恢复 | `XPENDING` + `XCLAIM` | 检测闲置超时的消息，转移给存活消费者 |

`XCLAIM` 的闲置阈值（上例 60 秒）要大于单条消息的正常处理耗时：阈值太小会把「正在处理」的消息误判为「消费者已崩溃」，造成重复投递；太大则故障恢复慢。

## 4. 幂等：at-least-once 的必然要求

at-least-once 意味着任务可能被执行多次，业务必须幂等。延迟队列的典型任务是「订单超时取消」，它天然幂等——状态机保证 `unpaid → cancelled` 只能发生一次，重复执行「取消」时订单已是 `cancelled`，直接跳过。

```java
// 订单状态机保证幂等：只有 unpaid 才能取消
public void cancelOrder(Long orderId) {
    // UPDATE orders SET status='cancelled'
    // WHERE id=? AND status='unpaid'
    int affected = orderMapper.cancelIfUnpaid(orderId);
    if (affected == 0) {
        // 已是 cancelled 或 paid，重复消费，直接返回
        return;
    }
    // 释放库存、退款等后续动作
}
```

> 📌 不要依赖 Redis 队列本身保证「只执行一次」。队列能保证的是「不丢」，而「不重复」是业务层的责任。任何基于 Redis 的延迟队列都应该默认消息会重复，用状态机、唯一约束或幂等表兜底。

## 5. Redis 延迟队列 vs 独立消息队列

| 维度 | Redis ZSet + Streams | RabbitMQ 延迟队列 | Kafka |
| :-- | :-- | :-- | :-- |
| 延迟实现 | ZSet 轮询搬移 | TTL + 死信交换机（DLX） | 无原生延迟，需时间轮或定时器 |
| 投递可靠性 | 需自行维护（PEL/ACK） | Broker 内置 | Broker 内置 |
| 持久化 | RDB/AOF，重启可能丢 | 默认持久化 | 持久化到磁盘 |
| 组件成本 | 复用现有 Redis | 需引入 RabbitMQ | 需引入 Kafka |
| 吞吐 | 中（轮询有开销） | 中 | 高 |
| 适用场景 | 轻量延迟、已有 Redis | 延迟消息多、需可靠持久化 | 大吞吐、已有 Kafka 基建 |

选型结论：

- **已有 Redis、延迟任务量不大** → ZSet + Streams，零额外组件
- **延迟消息量大、要求强持久化** → RabbitMQ（TTL + DLX 原生支持）
- **已有 Kafka、且延迟精度要求低** → Kafka 时间轮，避免引入第二套队列

## 6. 最佳实践 checklist

| 实践 | 说明 |
| :-- | :-- |
| 搬移用 Lua 原子化 | 「取到期 + 写 Stream + 删 ZSet」放一条脚本，避免丢失或重复 |
| 消费端必须幂等 | at-least-once 下任务会重复，用状态机/唯一约束兜底 |
| XCLAIM 阈值留余量 | 大于正常处理耗时，避免误判消费者崩溃 |
| 调度器独立调优 | 搬移频率与消费能力解耦，别让调度成为瓶颈 |
| 监控 PEL 堆积 | PEL 持续增长说明消费者跟不上或卡死，需告警 |
| 设置 TTL 防僵尸 | 无人消费的 Stream 和 ZSet 要设置过期，避免内存泄漏 |

... EOF no more lines ...