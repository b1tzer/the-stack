# 分布式锁

> 在分布式环境下，多个进程要互斥访问共享资源，单机锁失效，需要分布式锁。本章从 SETNX 的坑讲起，逐步演进到 Redisson 看门狗、RedLock 争议，以及生产环境的选型建议。

## 1. SETNX 的问题

最早的实现用 `SETNX`（SET if Not eXists）加锁：

```java
// 有问题的实现
redis.setnx("lock", "1");   // 加锁
// ... 业务逻辑 ...
redis.del("lock");          // 释放锁
```

三个致命问题：

| 问题 | 说明 | 后果 |
| :-- | :-- | :-- |
| 死锁 | 加锁后进程崩溃，锁永远无法释放 | 其他进程永远拿不到锁 |
| 误删 | A 的锁过期了，B 拿到锁，A 却删了 B 的锁 | 并发控制失效 |
| 非原子 | 加锁与设置过期时间分两步 | 中间崩溃导致死锁 |

## 2. 原子加锁与释放

Redis 2.6.12 起，`SET` 命令支持 `NX` 和 `PX` 参数，把「加锁 + 设置过期」合并为一条原子命令：

```bash
SET lock:order uuid NX PX 30000
```

| 参数 | 含义 |
| :-- | :-- |
| `NX` | 不存在才设置（互斥） |
| `PX 30000` | 30 秒后自动过期（防死锁） |
| `uuid` | 唯一标识，标识锁的持有者 |

### 2.1 释放锁：Lua 原子校验 + 删除

释放锁前要校验「锁是我持有的」，校验 + 删除必须原子执行：

```lua
-- KEYS[1] = 锁的 key
-- ARGV[1] = 当前持有的 uuid
if redis.call("get", KEYS[1]) == ARGV[1] then
    return redis.call("del", KEYS[1])
else
    return 0
end
```

为什么不能用 `GET + DEL` 两步？因为两步之间锁可能已过期被其他进程获取，`DEL` 会误删别人的锁。

```java
// Java 实现
String uuid = UUID.randomUUID().toString();
boolean locked = jedis.set("lock:order", uuid, "NX", "PX", 30000) != null;
if (locked) {
    try {
        // 业务逻辑
    } finally {
        String script = "if redis.call('get',KEYS[1])==ARGV[1] then return redis.call('del',KEYS[1]) else return 0 end";
        jedis.eval(script, List.of("lock:order"), List.of(uuid));
    }
}
```

## 3. Redisson

Redisson 是 Java 的 Redis 客户端，封装了分布式锁，提供可重入锁、自动续期等能力。

```xml
<dependency>
    <groupId>org.redisson</groupId>
    <artifactId>redisson-spring-boot-starter</artifactId>
    <version>3.27.0</version>
</dependency>
```

```java
RLock lock = redisson.getLock("lock:order");
try {
    // 阻塞等待，最多等 10 秒，锁自动续期
    if (lock.tryLock(10, TimeUnit.SECONDS)) {
        try {
            // 业务逻辑
        } finally {
            lock.unlock();
        }
    }
} catch (InterruptedException e) {
    Thread.currentThread().interrupt();
}
```

### 3.1 相比手写 SET NX PX 的改进

| 能力 | 手写 | Redisson |
| :-- | :-- | :-- |
| 可重入 | 需手动实现计数器 | 内置（同一线程可重复加锁） |
| 自动续期 | 需自己起后台线程 | 看门狗自动续期 |
| 阻塞获取 | 需自己实现重试逻辑 | `tryLock` 支持等待时间 |
| 公平锁 | 需自己实现 | `getFairLock()` 开箱即用 |
| 读写锁 | 需自己实现 | `getReadWriteLock()` 开箱即用 |

## 4. 看门狗机制

手写锁的隐患：业务执行超过锁的过期时间，锁会提前释放，其他线程拿到锁导致并发。

### 4.1 原理

![Redisson 看门狗续期机制](/redis/06-patterns-chapter-01-distributed-lock.svg)

```text
线程 A 获取锁（默认 30 秒）
  → 看门狗启动（Netty 时间轮调度）
  → 每 10 秒检查：锁还持有吗？
    → 是：续期为 30 秒
    → 否：停止看门狗
  → 线程 A 释放锁
  → 看门狗停止
```

| 概念 | 说明 |
| :-- | :-- |
| 默认超时 | 30 秒 |
| 续期间隔 | 每 10 秒（超时的 1/3） |
| 续期逻辑 | 把过期时间重置为 30 秒 |
| 前提条件 | 不手动指定 leaseTime |

### 4.2 看门狗的触发条件

```java
// 看门狗生效：不指定 leaseTime
lock.lock();                // 默认 30 秒，自动续期
lock.tryLock(10, TimeUnit.SECONDS);  // 只指定 waitTime，自动续期

// 看门狗不生效：手动指定 leaseTime
lock.lock(10, TimeUnit.SECONDS);       // 10 秒后过期，不续期
lock.tryLock(10, 30, TimeUnit.SECONDS); // leaseTime=30，不续期
```

> 手动指定 leaseTime 时，你必须自己保证业务在 leaseTime 内完成。如果不确定业务耗时，不指定 leaseTime，让看门狗自动管理。

## 5. 其他锁类型

### 5.1 可重入锁

同一线程可以多次获取同一把锁（计数器递增），释放时计数器递减，归零后真正释放。

```java
RLock lock = redisson.getLock("lock:order");
lock.lock();      // 第一次加锁，计数器=1
lock.lock();      // 重入，计数器=2
lock.unlock();    // 计数器=1
lock.unlock();    // 计数器=0，真正释放
```

### 5.2 读写锁

读锁共享，写锁互斥。多个读可以并发，写与读和写都互斥。

```java
RReadWriteLock rwLock = redisson.getReadWriteLock("rwlock:data");
RLock readLock = rwLock.readLock();
RLock writeLock = rwLock.writeLock();

// 读操作
readLock.lock();
try { /* 读 */ } finally { readLock.unlock(); }

// 写操作
writeLock.lock();
try { /* 写 */ } finally { writeLock.unlock(); }
```

### 5.3 公平锁

按请求顺序获取锁，避免饥饿。

```java
RLock fairLock = redisson.getFairLock("lock:order");
fairLock.lock();
```

## 6. 单节点锁的失效

前面的锁都部署在单个 Redis 节点上。单节点一旦宕机，锁数据随之丢失：已获取的锁被提前释放，其他进程可能拿到同一把锁。这是单节点锁的物理上限，不是换一种加锁命令能解决的。

### 6.1 单节点宕机：锁数据丢失

锁本质上是 Redis 里的一条数据，存在单节点的内存里。主节点宕机时，这条数据既没写盘、也没复制到从节点，锁数据随即丢失。

```text
进程 A 获取锁 → 主节点宕机 → 锁数据丢失
→ 进程 B 重新获取同一把锁 → A、B 同时持有锁 → 互斥失效
```

问题不在加锁逻辑，而在锁的存储不可靠。

### 6.2 解决方案光谱

解决「锁数据丢失」有两个方向：让锁数据更不容易丢，或让业务不依赖锁的绝对互斥。方案按「可靠性 vs 复杂度」排序：

| 方案 | 可靠性 | 复杂度 | 适用场景 |
| :-- | :-- | :-- | :-- |
| 单节点 + 短锁期 + 业务幂等兜底 | 概率性互斥 | 低 | 缓存击穿、防重复提交 |
| 单节点 + AOF `fsync=always` + 哨兵 | 减少丢失窗口 | 中 | 可接受极少丢锁的常规业务 |
| etcd / ZooKeeper 租约锁 | 强一致 | 中高 | 资金类强一致场景 |
| RedLock（多节点） | 高可用 | 高、有争议 | 极少需要跨机房容错的场景 |

**首选：业务幂等兜底。** 锁负责大概率互斥、降低并发；业务幂等负责锁失效时仍保证结果正确。以缓存击穿为例：锁提前失效只是让两个请求多查了一次库，只要写缓存的逻辑幂等，最终写入的值相同，结果仍然正确。锁丢失不再构成灾难。

**次选：AOF `fsync=always` + 哨兵。** 每次写都落盘，配合哨兵自动切换，把丢失窗口压到「宕机前最后一个未落盘的写操作」。代价是写入性能明显下降，且仍不保证绝对不丢。

**强一致才用 etcd / ZooKeeper。** 资金类、绝不能双重扣款的场景，需要基于共识算法（Raft、Paxos）的租约锁，保证不丢锁、不脑裂。代价是引入一套新的分布式组件。

RedLock 处在光谱的另一端：可用性最高，复杂度和争议也最高。

### 6.3 RedLock 原理

```text
N = 5 个独立的 Redis 节点（非集群，互不复制）

加锁：
  1. 依次向 5 个节点请求加锁（SET key uuid NX PX）
  2. 统计成功数，≥ 3 个成功才算获取锁
  3. 锁的有效时间 = 过期时间 - 获取锁的耗时

释放：
  向所有节点释放锁（无论是否成功加锁）
```

### 6.4 RedLock 争议

RedLock 由 Redis 作者 antirez 提出，引发了分布式系统领域的争论：

**Martin Kleppmann（《Designing Data-Intensive Applications》作者）的质疑**：

| 问题 | 说明 |
| :-- | :-- |
| 时钟跳跃 | 节点的系统时钟被 NTP 调整，锁可能提前过期 |
| GC 停顿 | 持锁进程 GC 停顿期间锁过期，GC 恢复后仍以为持有锁 |
| 网络延迟 | 加锁请求到达不同节点的时间差，可能导致锁的有效期不一致 |

**antirez 的回应**：

| 回应 | 说明 |
| :-- | :-- |
| 时钟问题 | 可通过配置单调时钟缓解 |
| GC 问题 | 所有分布式锁都有这个问题，不是 RedLock 特有 |
| 实用性 | 在大多数生产环境中足够可靠 |

### 6.5 选型建议

RedLock 试图在「无共识」的系统上构建「强一致」的锁，理论上存在局限：真正的强一致锁需要共识算法保证。

| 场景 | 建议 |
| :-- | :-- |
| 一般业务（缓存击穿防护、幂等控制） | 单节点 Redis + Redisson，足够 |
| 短暂超卖可接受 | 单节点 Redis + Redisson + 业务幂等兜底 |
| 资金类强一致 | ZooKeeper / etcd（基于共识算法） |
| 极高可用 + 可接受争议 | RedLock |

## 7. 最佳实践

| 实践 | 说明 |
| :-- | :-- |
| 用成熟客户端 | 优先用 Redisson，别手写锁 |
| 锁要有超时 | 任何锁都要有过期时间，防死锁 |
| 校验再释放 | 释放前校验持有者，防误删（Redisson 自动处理） |
| 锁粒度要小 | 锁的范围尽量小，减少竞争 |
| 业务要幂等 | 分布式锁不能保证绝对互斥，业务要幂等兜底 |
| 不要指定 leaseTime | 除非你确定业务耗时，否则让看门狗管理 |
