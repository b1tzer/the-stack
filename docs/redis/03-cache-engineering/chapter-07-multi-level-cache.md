# 多级缓存实战

> 单层 Redis 缓存在高并发场景下存在两个瓶颈：网络延迟（每次读都要跨网络）和单点压力（所有请求打到同一个 Redis）。多级缓存通过在 Redis 之前加一层本地缓存，形成「本地 → Redis → 数据库」的三级架构，兼顾速度与容量。本章从架构设计到 Spring Boot 实现，完整讲解多级缓存的落地方式。

## 1. 为什么需要多级缓存

| 问题 | 单层 Redis | 多级缓存 |
| :-- | :-- | :-- |
| 网络延迟 | 每次读 0.5~2ms | 本地缓存命中 < 0.01ms |
| Redis 宕机 | 全部穿透到数据库 | 本地缓存仍能兜底 |
| 热点 key 压力 | 单点承受全部 QPS | 本地缓存拦截大部分请求 |
| 带宽成本 | 高（每次都跨网络） | 低（大部分本地返回） |

核心思想：**把最热的数据放在离请求最近的地方**。

## 2. 架构设计

```text
请求 → L1 本地缓存（Caffeine，进程内，最快）
         ↓ 未命中
       L2 Redis（分布式，共享，容量大）
         ↓ 未命中
       L3 数据库（MySQL，最终数据源）
```

每一层的职责：

| 层级 | 技术选型 | 容量 | 速度 | 特点 |
| :-- | :-- | :-- | :-- | :-- |
| L1 | Caffeine / Guava Cache | 小（千级~万级） | 微秒 | 各实例独立，不共享 |
| L2 | Redis | 中（十万~百万级） | 毫秒 | 分布式共享 |
| L3 | MySQL | 大 | 十毫秒 | 持久化存储 |

### 2.1 各层参数设计原则

| 参数 | L1 本地缓存 | L2 Redis |
| :-- | :-- | :-- |
| 容量 | `maximumSize(1000~10000)` | 根据内存预算设置 `maxmemory` |
| TTL | 短（1~5 分钟） | 中（5~30 分钟 + 随机偏移） |
| 淘汰策略 | LRU（默认） | allkeys-lru / volatile-lru |
| 数据一致性 | 弱（实例间不共享） | 中等 |

> L1 的 TTL 必须短于 L2。如果 L1 TTL 比 L2 还长，会出现 L1 还有旧值但 L2 已经过期更新了的情况。

## 3. Spring Boot 实现

### 3.1 依赖

```xml
<dependency>
    <groupId>com.github.ben-manes.caffeine</groupId>
    <artifactId>caffeine</artifactId>
    <version>3.1.8</version>
</dependency>
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-data-redis</artifactId>
</dependency>
```

### 3.2 核心实现

```java
@Service
public class MultiLevelCacheService {

    private final Cache<String, String> localCache;
    private final StringRedisTemplate redis;
    private final UserMapper userMapper;

    public MultiLevelCacheService(StringRedisTemplate redis, UserMapper userMapper) {
        this.redis = redis;
        this.userMapper = userMapper;

        // L1：本地缓存
        this.localCache = Caffeine.newBuilder()
            .maximumSize(5000)                    // 最多 5000 条
            .expireAfterWrite(2, TimeUnit.MINUTES) // 2 分钟过期
            .recordStats()                         // 开启统计
            .build();
    }

    public User getUser(Long userId) {
        String key = "user:" + userId;

        // L1：查本地缓存
        String cached = localCache.getIfPresent(key);
        if (cached != null) {
            return JSON.parseObject(cached, User.class);
        }

        // L2：查 Redis
        cached = redis.opsForValue().get(key);
        if (cached != null) {
            localCache.put(key, cached);  // 回填 L1
            return JSON.parseObject(cached, User.class);
        }

        // L3：查数据库
        User user = userMapper.selectById(userId);
        if (user != null) {
            String json = JSON.toJSONString(user);
            // 回填 L2（带随机 TTL）
            int ttl = 300 + ThreadLocalRandom.current().nextInt(61);
            redis.opsForValue().set(key, json, ttl, TimeUnit.SECONDS);
            localCache.put(key, json);  // 回填 L1
        }
        return user;
    }

    /**
     * 写入时清除所有层级
     */
    @Transactional
    public void updateUser(Long userId, User user) {
        userMapper.updateById(user);
        TransactionSynchronizationManager.registerSynchronization(
            new TransactionSynchronization() {
                @Override
                public void afterCommit() {
                    redis.delete("user:" + userId);
                    localCache.invalidate("user:" + userId);
                }
            }
        );
    }

    /**
     * 获取 L1 命中率统计
     */
    public CacheStats getLocalCacheStats() {
        return localCache.stats();
    }
}
```

### 3.3 L1 命中率监控

Caffeine 的 `recordStats()` 开启后可以获取命中率：

```java
@RestController
@RequestMapping("/cache")
public class CacheMonitorController {

    @Autowired
    private MultiLevelCacheService cacheService;

    @GetMapping("/stats")
    public Map<String, Object> stats() {
        CacheStats stats = cacheService.getLocalCacheStats();
        Map<String, Object> result = new HashMap<>();
        result.put("hitRate", String.format("%.2f%%", stats.hitRate() * 100));
        result.put("missRate", String.format("%.2f%%", stats.missRate() * 100));
        result.put("hitCount", stats.hitCount());
        result.put("missCount", stats.missCount());
        result.put("evictionCount", stats.evictionCount());
        return result;
    }
}
```

> 命中率低于 50% 说明 L1 容量太小或 TTL 太短，需要调优。理想情况下 L1 命中率应在 80% 以上。

## 4. 多实例一致性问题

本地缓存的最大问题是：实例 A 更新了数据，实例 B 的本地缓存还是旧值。解决方式有三种：

| 方案 | 一致性 | 复杂度 | 说明 |
| :-- | :-- | :-- | :-- |
| 缩短 L1 TTL | 弱 | 低 | 最简单，接受短暂不一致 |
| 消息广播清除 | 强 | 中 | 写入时广播所有实例清除 L1 |
| Canal + MQ | 强 | 高 | Binlog 驱动，完全解耦 |

### 4.1 消息广播清除

写入时通过 Redis Pub/Sub 或 Kafka 广播清除指令：

```java
@Component
public class LocalCacheEvictionListener {

    private final Cache<String, String> localCache;

    /**
     * 监听 Redis Pub/Sub 的缓存清除消息
     */
    @RedisListener(channel = "cache:evict")
    public void onEvict(String key) {
        localCache.invalidate(key);
    }
}
```

写入时发布清除消息：

```java
public void updateUser(Long userId, User user) {
    userMapper.updateById(user);
    redis.delete("user:" + userId);
    localCache.invalidate("user:" + userId);

    // 广播给其他实例
    redis.convertAndSend("cache:evict", "user:" + userId);
}
```

## 5. 自定义 Spring CacheManager

如果项目使用 Spring 的 `@Cacheable` 注解，可以自定义 `CacheManager` 实现多级缓存：

```java
@Configuration
@EnableCaching
public class CacheConfig {

    @Bean
    public CacheManager cacheManager(RedisConnectionFactory factory) {
        // L1：Caffeine
        CaffeineCache caffeineCache = new CaffeineCache("users",
            Caffeine.newBuilder()
                .maximumSize(5000)
                .expireAfterWrite(2, TimeUnit.MINUTES)
                .build());

        // L2：Redis
        RedisCacheConfiguration redisConfig = RedisCacheConfiguration.defaultCacheConfig()
            .entryTtl(Duration.ofMinutes(5))
            .serializeValuesWith(RedisSerializationContext.SerializationPair
                .fromSerializer(new GenericJackson2JsonRedisSerializer()));

        RedisCache redisCache = new RedisCache("users",
            RedisCacheWriter.nonLockingRedisCacheWriter(factory),
            redisConfig);

        // 组合：先查 Caffeine，再查 Redis
        return new CompositeCacheManager(caffeineCache, redisCache);
    }
}
```

使用注解：

```java
@Cacheable(value = "users", key = "#userId")
public User getUser(Long userId) {
    return userMapper.selectById(userId);
}
```

> `CompositeCacheManager` 按顺序查询，命中即返回。需要注意的是 Spring 的 `CompositeCacheManager` 不会自动回填上层缓存，如果需要自动回填，建议使用前面的手动实现。

## 6. 小结

| 要点 | 说明 |
| :-- | :-- |
| L1 TTL < L2 TTL | 避免 L1 旧值覆盖 L2 新值 |
| 监控命中率 | L1 命中率低于 50% 需要调优 |
| 写入时清除所有层级 | 避免脏读 |
| 多实例一致性 | 缩短 TTL 或消息广播 |
| 容量规划 | L1 存热点（千级），L2 存温数据（万级~十万级） |
