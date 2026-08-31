# 缓存写路径：四种模式与一致性

> 读路径的问题（穿透、击穿、雪崩）解决「怎么高效地读」，本章解决「怎么写」。缓存与数据库是两份数据，写入方式决定了它们能否保持一致。本章先讲四种经典缓存模式，再深入 Cache Aside 的一致性细节（延迟双删、Canal），并给出选型依据。

## 1. 四种写方案概览

缓存更新策略有四种经典模式：

| 方案 | 读写流程 | 特点 |
| :-- | :-- | :-- |
| Cache Aside | 应用先写数据库，再删缓存 | 主流，简单可控 |
| Read Through | 读时缓存自己查库并填充 | 缓存层封装了读逻辑 |
| Write Through | 写时缓存自己同步写库 | 缓存层封装了写逻辑 |
| Write Behind | 写时只写缓存，异步刷库 | 性能高，但可能丢数据 |

其中 Cache Aside（旁路缓存）是最常见、最可控的方案，其余几种要求缓存层实现更复杂的逻辑。

## 2. Cache Aside（旁路缓存）

Cache Aside 是最常见、最灵活的模式。应用代码同时管理缓存和数据库：读时先查缓存、未命中则查库并回填；写时先更新数据库、再删除缓存。

### 2.1 读写流程

```text
读：GET 缓存 → 命中返回 → 未命中 SELECT 数据库 → SETEX 缓存 → 返回
写：UPDATE 数据库 → DEL 缓存
```

![Cache Aside 读写流程](/redis/03-cache-engineering-chapter-04-consistency-1.svg)

### 2.2 为什么删缓存而不是更新缓存

| 方式 | 问题 |
| :-- | :-- |
| 更新缓存 | 并发写可能覆盖，且很多更新是无用的（写了没人读） |
| 删除缓存 | 简单安全，下次读时按需回填，天然「懒加载」 |

删除缓存避免了「更新缓存」的并发覆盖问题，也避免了缓存那些从未被读取的数据。

### 2.3 为什么先更新数据库再删缓存

先删缓存再更新数据库，存在「删缓存后、数据库还没更新完，此时有读请求回填旧值」的窗口；先更新数据库再删缓存，把「旧值回填」的窗口缩到最小。两者都无法做到绝对一致，但「先更新库、后删缓存」更接近正确。

### 2.4 Spring Boot 完整实现

```java
@Service
public class UserService {

    private final StringRedisTemplate redis;
    private final UserMapper userMapper;

    /**
     * 读路径：Cache Aside
     */
    public User getUser(Long userId) {
        String cacheKey = "user:" + userId;

        // 1. 先查缓存
        String cached = redis.opsForValue().get(cacheKey);
        if (cached != null) {
            return JSON.parseObject(cached, User.class);
        }

        // 2. 查数据库
        User user = userMapper.selectById(userId);
        if (user != null) {
            // 3. 回填缓存（带随机 TTL 防雪崩）
            int ttl = 300 + ThreadLocalRandom.current().nextInt(61);
            redis.opsForValue().set(cacheKey,
                JSON.toJSONString(user), ttl, TimeUnit.SECONDS);
        }
        return user;
    }

    /**
     * 写路径：先更新数据库，再删缓存
     * 必须在事务提交后再删缓存，否则事务回滚但缓存已删，导致不一致
     */
    @Transactional
    public void updateUser(Long userId, String name, int age) {
        // 1. 先更新数据库
        User user = new User();
        user.setId(userId);
        user.setName(name);
        user.setAge(age);
        userMapper.updateById(user);

        // 2. 事务提交后再删缓存（见下方 TransactionSynchronization）
        TransactionSynchronizationManager.registerSynchronization(
            new TransactionSynchronization() {
                @Override
                public void afterCommit() {
                    redis.delete("user:" + userId);
                }
            }
        );
    }
}
```

> 关键细节：删缓存必须在事务提交之后执行。如果在事务提交前删缓存，一旦事务回滚，数据库里是旧值，缓存已经被删了，下次读会把旧值重新写入缓存——造成持久不一致。`TransactionSynchronization.afterCommit()` 保证删缓存在事务提交后执行。

## 3. Read Through（读穿透）

Read Through 把缓存查询逻辑封装在缓存层内部。应用只和缓存交互，缓存自己负责「未命中时查库并回填」。

### 3.1 读写流程

```text
读：GET 缓存 → 命中返回 → 未命中 → 缓存层自己查库 → 回填 → 返回
写：同 Cache Aside（先更新库，再删缓存）
```

### 3.2 代码实现

Read Through 的核心是一个 `CacheLoader`：当缓存未命中时，由 Loader 负责从数据源加载数据。

```java
@Component
public class UserCacheLoader {

    private final UserMapper userMapper;

    /**
     * 缓存未命中时的加载逻辑
     */
    public User load(Long userId) {
        return userMapper.selectById(userId);
    }
}
```

```java
@Service
public class UserReadThroughService {

    private final StringRedisTemplate redis;
    private final UserCacheLoader cacheLoader;

    public User getUser(Long userId) {
        String key = "user:" + userId;

        // 1. 查缓存
        String cached = redis.opsForValue().get(key);
        if (cached != null) {
            return JSON.parseObject(cached, User.class);
        }

        // 2. 缓存未命中，委托 Loader 加载
        User user = cacheLoader.load(userId);
        if (user != null) {
            int ttl = 300 + ThreadLocalRandom.current().nextInt(61);
            redis.opsForValue().set(key, JSON.toJSONString(user), ttl, TimeUnit.SECONDS);
        }
        return user;
    }
}
```

> 如果用 Caffeine 作为本地缓存，它原生支持 `CacheLoader`：`Caffeine.newBuilder().build(userId -> cacheLoader.load(userId))`，未命中时自动调用 Loader，无需手动判断。

### 3.3 优缺点

| 维度 | 说明 |
| :-- | :-- |
| 优点 | 业务代码更干净，缓存逻辑集中管理 |
| 缺点 | 需要封装缓存层，初次接入成本较高 |
| 适用场景 | 多处复用同一数据源，希望统一封装加载逻辑 |

## 4. Write Through（写穿透）

Write Through 在写入时同步更新缓存和数据库，保证两者一致。应用只写缓存，缓存层同步写库。

### 4.1 读写流程

```text
读：同 Read Through
写：SET 缓存 → 缓存层同步 UPDATE 数据库
```

### 4.2 代码实现

```java
@Service
public class UserWriteThroughService {

    private final StringRedisTemplate redis;
    private final UserMapper userMapper;

    public User getUser(Long userId) {
        // 同 Read Through
        String key = "user:" + userId;
        String cached = redis.opsForValue().get(key);
        if (cached != null) {
            return JSON.parseObject(cached, User.class);
        }
        User user = userMapper.selectById(userId);
        if (user != null) {
            redis.opsForValue().set(key, JSON.toJSONString(user), 300, TimeUnit.SECONDS);
        }
        return user;
    }

    /**
     * 写入：先写缓存，同步写库
     */
    @Transactional
    public void updateUser(Long userId, User user) {
        String key = "user:" + userId;
        // 1. 更新缓存
        redis.opsForValue().set(key, JSON.toJSONString(user), 300, TimeUnit.SECONDS);
        // 2. 同步更新数据库
        userMapper.updateById(user);
    }
}
```

### 4.3 优缺点

| 维度 | 说明 |
| :-- | :-- |
| 优点 | 读性能高，缓存始终最新 |
| 缺点 | 写延迟增加（每次写都要同步写库），写操作不频繁的场景浪费 |
| 适用场景 | 读多写少、对读一致性要求高的场景 |

## 5. Write Behind（异步写回）

Write Behind 只写缓存，异步批量刷库。写性能最高，但存在数据丢失风险。

### 5.1 读写流程

```text
读：同 Read Through
写：SET 缓存 → 异步批量 UPDATE 数据库
```

### 5.2 代码实现

```java
@Service
public class UserWriteBehindService {

    private final StringRedisTemplate redis;
    private final UserMapper userMapper;

    // 待刷脏数据队列
    private final BlockingQueue<User> dirtyQueue = new LinkedBlockingQueue<>(10000);

    @PostConstruct
    public void startFlushWorker() {
        // 后台线程，每 5 秒批量刷一次
        Thread worker = new Thread(() -> {
            while (!Thread.currentThread().isInterrupted()) {
                try {
                    List<User> batch = new ArrayList<>();
                    // 阻塞等待至少 1 条，最多等 5 秒
                    User first = dirtyQueue.poll(5, TimeUnit.SECONDS);
                    if (first != null) {
                        batch.add(first);
                        dirtyQueue.drainTo(batch, 99);  // 最多取 100 条
                        batch.forEach(userMapper::updateById);
                    }
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                }
            }
        });
        worker.setDaemon(true);
        worker.start();
    }

    public User getUser(Long userId) {
        String key = "user:" + userId;
        String cached = redis.opsForValue().get(key);
        if (cached != null) {
            return JSON.parseObject(cached, User.class);
        }
        User user = userMapper.selectById(userId);
        if (user != null) {
            redis.opsForValue().set(key, JSON.toJSONString(user), 300, TimeUnit.SECONDS);
        }
        return user;
    }

    /**
     * 写入：只写缓存，异步入队等刷库
     */
    public void updateUser(Long userId, User user) {
        String key = "user:" + userId;
        redis.opsForValue().set(key, JSON.toJSONString(user), 300, TimeUnit.SECONDS);
        dirtyQueue.offer(user);
    }
}
```

### 5.3 优缺点

| 维度 | 说明 |
| :-- | :-- |
| 优点 | 写性能极高，适合高写入吞吐 |
| 缺点 | 缓存宕机则数据丢失，一致性最弱 |
| 适用场景 | 写密集型、允许少量数据丢失（如计数器、日志类数据） |

## 6. 模式对比

| 维度 | Cache Aside | Read Through | Write Through | Write Behind |
| :-- | :-- | :-- | :-- | :-- |
| 缓存管理方 | 应用代码 | 缓存层 | 缓存层 | 缓存层 |
| 写路径 | 先更新库，后删缓存 | 先更新库，后删缓存 | 先写缓存，同步写库 | 先写缓存，异步写库 |
| 一致性 | 中等 | 中等 | 强 | 弱 |
| 写性能 | 中 | 中 | 低 | 高 |
| 实现复杂度 | 低 | 中 | 中 | 高 |
| 数据丢失风险 | 无 | 无 | 无 | 有 |
| 适用场景 | 大多数场景 | 统一封装加载 | 读多写少、强一致 | 写密集、可容忍丢失 |

## 7. 选型决策树

```text
你的场景是什么？
  ├─ 大多数业务场景 → Cache Aside（首选）
  ├─ 希望统一封装缓存加载逻辑 → Read Through
  ├─ 读多写少、要求读一致性 → Write Through
  └─ 写密集、允许少量丢失 → Write Behind
```

实际项目中的常见组合：

| 组合 | 说明 |
| :-- | :-- |
| Cache Aside + 延迟双删 | 并发写频繁时的一致性保障 |
| Read Through + Caffeine | 本地缓存 + 自动加载，减少代码重复 |
| Cache Aside + Canal | 业务代码只管写，缓存同步由 Binlog 消费端负责 |

> 生产环境建议从 Cache Aside 开始，遇到具体问题再演进。不要一开始就上 Write Behind——它的复杂度和风险远高于收益，除非你的写入量真的到了瓶颈。

## 8. 一致性进阶：延迟双删

Cache Aside 的「先更新库、后删缓存」已把不一致窗口缩到最小，但仍非绝对一致。延迟双删用于进一步缩小并发窗口，或兜底删除失败的情况。

```text
1. 删除缓存
2. 更新数据库
3. 延迟一小段时间（如 500ms）
4. 再次删除缓存
```

![延迟双删流程](/redis/03-cache-engineering-chapter-04-consistency-2.svg)

### 8.1 实现

```java
public void updateUserWithDelayDoubleDelete(Long userId, User user) {
    String cacheKey = "user:" + userId;

    // 1. 先删缓存
    redis.delete(cacheKey);

    // 2. 更新数据库
    userMapper.updateById(user);

    // 3. 延迟后再删一次（异步，不阻塞主线程）
    CompletableFuture.delayedExecutor(500, TimeUnit.MILLISECONDS)
        .execute(() -> redis.delete(cacheKey));
}
```

要点：

| 要点 | 说明 |
| :-- | :-- |
| 第二次删除 | 兜底清理「并发读回填的旧值」 |
| 延迟时间 | 略大于业务读操作耗时 |
| 本质 | 降低概率，非绝对一致 |

> 延迟双删只是把不一致的概率降到很低，并不能保证绝对一致。若要绝对一致，需要引入分布式锁或消息队列串行化读写。

## 9. Canal 方案

对于强一致需求的场景，可以基于数据库 Binlog 实现异步同步。

![Canal 同步方案流程](/redis/03-cache-engineering-chapter-04-consistency-3.svg)

Canal 模拟 MySQL 从库，订阅主库的 Binlog，解析出数据变更事件，再投递到消息队列，由消费端更新或删除缓存。

### 9.1 架构

```text
MySQL → Canal Server → Kafka/RabbitMQ → 消费端 → 删除/更新 Redis 缓存
```

| 组件 | 职责 |
| :-- | :-- |
| Canal Server | 模拟 MySQL 从库，订阅 Binlog，解析行变更 |
| 消息队列 | 解耦 Canal 与消费端，保证投递可靠性 |
| 消费端 | 监听消息，删除或更新对应的 Redis 缓存 |

### 9.2 消费端实现

```java
@Component
public class CanalCacheConsumer {

    private final StringRedisTemplate redis;

    /**
     * 监听 Canal 投递的 binlog 消息
     * 消息格式：{"database":"db","table":"user","type":"UPDATE",
     *           "data":[{"id":1,"name":"新名字"}]}
     */
    @KafkaListener(topics = "canal-user", groupId = "cache-sync")
    public void onMessage(ConsumerRecord<String, String> record) {
        JSONObject msg = JSON.parseObject(record.value());
        String table = msg.getString("table");
        if (!"user".equals(table)) return;

        JSONArray data = msg.getJSONArray("data");
        for (int i = 0; i < data.size(); i++) {
            Long userId = data.getJSONObject(i).getLong("id");
            // 删除缓存，下次读时自动回填
            redis.delete("user:" + userId);
        }
    }
}
```

### 9.3 特性

| 特性 | 说明 |
| :-- | :-- |
| 解耦 | 缓存更新逻辑与业务代码完全分离 |
| 最终一致 | 异步同步，存在秒级延迟 |
| 可靠 | 消息队列保证投递，可重试 |
| 适用场景 | 对一致性要求较高、且能接受秒级延迟的业务 |

> Canal 方案的优势在于：业务代码完全不感知缓存更新逻辑，所有同步工作由独立的消费端完成。缺点是引入了额外组件（Canal + MQ），运维复杂度增加。

## 10. 一致性方案选型

| 维度 | Cache Aside | 延迟双删 | Canal |
| :-- | :-- | :-- | :-- |
| 一致性强度 | 中等 | 较强 | 最终一致 |
| 实现复杂度 | 低 | 低 | 高（需引入 Canal + MQ） |
| 业务侵入 | 中（Service 层删缓存） | 中 | 低（完全解耦） |
| 性能影响 | 低 | 低（异步延迟） | 低（异步） |
| 适用场景 | 大多数业务 | 并发写频繁 | 多服务共享同一数据源 |

选型建议：

- 大多数场景 → Cache Aside（先更新库，后删缓存 + 事务提交后删）
- 并发写频繁、一致性要求高 → 延迟双删
- 多服务共享数据、希望业务解耦 → Canal + MQ

