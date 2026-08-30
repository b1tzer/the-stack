# 缓存一致性

> 缓存与数据库是两份数据，如何保证它们一致，是缓存架构的核心难题。本章讲解几种写方案、主流的 Cache Aside 模式、延迟双删，以及基于 Binlog 的最终一致性方案，并给出 Spring Boot 落地代码。

## 1. 四种写方案

缓存更新策略有四种经典模式：

| 方案 | 读写流程 | 特点 |
| :-- | :-- | :-- |
| Cache Aside | 应用先写数据库，再删缓存 | 主流，简单可控 |
| Read Through | 读时缓存自己查库并填充 | 缓存层封装了读逻辑 |
| Write Through | 写时缓存自己同步写库 | 缓存层封装了写逻辑 |
| Write Behind | 写时只写缓存，异步刷库 | 性能高，但可能丢数据 |

其中 Cache Aside（旁路缓存）是最常见、最可控的方案，其余几种要求缓存层实现更复杂的逻辑。

## 2. Cache Aside

Cache Aside 的核心规则：

```text
读：先查缓存，命中返回；未命中查库，回填缓存
写：先更新数据库，再删除缓存
```

![Cache Aside 读写流程](/redis/03-cache-engineering-chapter-04-consistency-1.svg)

### 2.1 为什么删缓存而不是更新缓存

| 方式 | 问题 |
| :-- | :-- |
| 更新缓存 | 并发写可能覆盖，且很多更新是无用的（写了没人读） |
| 删除缓存 | 简单安全，下次读时按需回填，天然「懒加载」 |

删除缓存避免了「更新缓存」的并发覆盖问题，也避免了缓存那些从未被读取的数据。

### 2.2 为什么先更新数据库再删缓存

先删缓存再更新数据库，存在「删缓存后、数据库还没更新完，此时有读请求回填旧值」的窗口；先更新数据库再删缓存，把「旧值回填」的窗口缩到最小。两者都无法做到绝对一致，但「先更新库、后删缓存」更接近正确。

### 2.3 Spring Boot 完整实现

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

## 3. 延迟双删

延迟双删用于进一步缩小「先删缓存再更新库」方案的并发窗口，或兜底删除失败的情况。

```text
1. 删除缓存
2. 更新数据库
3. 延迟一小段时间（如 500ms）
4. 再次删除缓存
```

![延迟双删流程](/redis/03-cache-engineering-chapter-04-consistency-2.svg)

### 3.1 实现

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

## 4. Canal 方案

对于强一致需求的场景，可以基于数据库 Binlog 实现异步同步。

![Canal 同步方案流程](/redis/03-cache-engineering-chapter-04-consistency-3.svg)

Canal 模拟 MySQL 从库，订阅主库的 Binlog，解析出数据变更事件，再投递到消息队列，由消费端更新或删除缓存。

### 4.1 架构

```text
MySQL → Canal Server → Kafka/RabbitMQ → 消费端 → 删除/更新 Redis 缓存
```

| 组件 | 职责 |
| :-- | :-- |
| Canal Server | 模拟 MySQL 从库，订阅 Binlog，解析行变更 |
| 消息队列 | 解耦 Canal 与消费端，保证投递可靠性 |
| 消费端 | 监听消息，删除或更新对应的 Redis 缓存 |

### 4.2 消费端实现

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

### 4.3 特性

| 特性 | 说明 |
| :-- | :-- |
| 解耦 | 缓存更新逻辑与业务代码完全分离 |
| 最终一致 | 异步同步，存在秒级延迟 |
| 可靠 | 消息队列保证投递，可重试 |
| 适用场景 | 对一致性要求较高、且能接受秒级延迟的业务 |

> Canal 方案的优势在于：业务代码完全不感知缓存更新逻辑，所有同步工作由独立的消费端完成。缺点是引入了额外组件（Canal + MQ），运维复杂度增加。

## 5. 方案选型

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
