# 多级缓存与纵深防御

> 单层 Redis 缓存有两个瓶颈：网络延迟（每次读都要跨网络）和单点压力（所有请求打到同一个 Redis）。本章先讲多级缓存——在 Redis 之前加一层本地缓存，形成「本地 → Redis → 数据库」三级架构；再把缓存预热、熔断降级、限流组合成一套纵深防御，兜住 Redis 宕机等极端场景。

## 1. 为什么需要多级缓存

| 问题 | 单层 Redis | 多级缓存 |
| :-- | :-- | :-- |
| 网络延迟 | 每次读 0.5~2ms | 本地缓存命中 < 0.01ms |
| Redis 宕机 | 全部穿透到数据库 | 本地缓存仍能兜底 |
| 热点 key 压力 | 单点承受全部 QPS | 本地缓存拦截大部分请求 |
| 带宽成本 | 高（每次都跨网络） | 低（大部分本地返回） |

核心思想：**把最热的数据放在离请求最近的地方**。

## 2. 架构设计

```txt
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
| 淘汰策略 | W-TinyLFU（默认） | allkeys-lru / volatile-lru |
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

## 6. 纵深防御：把多级缓存变成完整防线

多级缓存解决「读性能」和「单点压力」，但生产环境还要面对两个极端场景：冷启动时本地缓存没有数据、Redis 整体宕机。纵深防御就是把这些手段组合起来，让任何单一层级的故障都不直接打垮数据库。

### 6.1 纵深防御的思路

单一防御手段都有盲区：

| 手段 | 局限性 |
| :-- | :-- |
| TTL 随机化 | 只防「同时过期」，不防 Redis 宕机 |
| 多级缓存 | 本地缓存容量有限，冷启动时无数据 |
| 熔断降级 | 已经在降级了，用户体验受损 |

纵深防御的核心思想：**不指望一层挡住所有攻击，而是每一层拦住一部分，层层递减，最终到达数据库的请求量在可控范围内**。

```txt
                    ┌─────────────────┐
  请求洪峰 ──────────┤  L1 本地缓存      │ 拦截 80% 热点请求
                    └────────┬────────┘
                             ↓ 20% 未命中
                    ┌─────────────────┐
                    │ L2 Redis        │ 拦截 95% 剩余请求
                    └────────┬────────┘
                             ↓ 5% 未命中
                    ┌─────────────────┐
                    │ L3 熔断降级      │ Redis 不可用时兜底
                    └────────┬────────┘
                             ↓ 正常请求
                    ┌─────────────────┐
                    │ L4 数据库        │ 最终承受 <1% 流量
                    └─────────────────┘
```

其中 TTL 随机化、逻辑过期的实现见 [缓存失效：穿透·击穿·雪崩](./chapter-01-cache-invalidation) 的 §4.2 与 §3.3，本章不再重复。

### 6.2 第一层：缓存预热

缓存预热指在系统启动或流量高峰前，主动把热点数据加载到缓存中，避免冷启动时的全量穿透。

**启动时预热**：

```java
@Component
public class CacheWarmer implements ApplicationRunner {

    private final StringRedisTemplate redis;
    private final UserMapper userMapper;
    private final HotKeyDetector hotKeyDetector;

    @Override
    public void run(ApplicationArguments args) {
        log.info("开始缓存预热...");

        // 方式一：加载热门用户（按访问量排序，取 Top 1000）
        List<User> hotUsers = userMapper.selectTopUsers(1000);
        for (User user : hotUsers) {
            String key = "user:" + user.getId();
            int ttl = 300 + ThreadLocalRandom.current().nextInt(61);
            redis.opsForValue().set(key,
                JSON.toJSONString(user), ttl, TimeUnit.SECONDS);
        }

        log.info("缓存预热完成，加载 {} 条数据", hotUsers.size());
    }
}
```

**定时预热**：对于周期性热点（如每天早高峰的首页数据），可以用定时任务提前预热：

```java
@Component
public class ScheduledCacheWarmer {

    /**
     * 每天早上 7:30 预热当天的热点数据
     */
    @Scheduled(cron = "30 7 * * *")
    public void warmDailyHotData() {
        // 加载今日推荐商品、热门文章等
        loadHotProducts();
        loadTrendingArticles();
    }

    /**
     * 每 10 分钟刷新实时热 key
     */
    @Scheduled(fixedRate = 600_000)
    public void refreshHotKeys() {
        List<String> hotKeys = hotKeyDetector.getHotKeys();
        for (String key : hotKeys) {
            // 重新加载，续期 TTL
            refreshCache(key);
        }
    }
}
```

### 6.3 兜底：熔断降级与限流

当 Redis 整体不可用或数据库压力过大时，主动降级保护数据库。

**Redis 健康检查**：

```java
@Component
public class RedisHealthChecker {

    private final StringRedisTemplate redis;
    private volatile boolean redisHealthy = true;

    @Scheduled(fixedRate = 5000)
    public void check() {
        try {
            redis.getConnectionFactory().getConnection().ping();
            redisHealthy = true;
        } catch (Exception e) {
            redisHealthy = false;
            log.error("Redis 不可用，触发降级", e);
        }
    }

    public boolean isHealthy() {
        return redisHealthy;
    }
}
```

**降级查询**：

```java
@Service
public class ResilientUserService {

    private final MultiLevelCacheService cacheService;
    private final RedisHealthChecker healthChecker;
    private final UserMapper userMapper;

    public User getUser(Long userId) {
        // Redis 不健康时，跳过 L2，直接查本地缓存或数据库
        if (!healthChecker.isHealthy()) {
            return getUserWithFallback(userId);
        }
        return cacheService.getUser(userId);
    }

    /**
     * 降级路径：L1 → 默认值
     */
    private User getUserWithFallback(Long userId) {
        // 尝试本地缓存
        User user = cacheService.getLocal(userId);
        if (user != null) return user;

        // 返回兜底数据
        User fallback = new User();
        fallback.setId(userId);
        fallback.setName("用户信息暂时不可用");
        return fallback;
    }
}
```

**限流保护数据库**：即使有缓存层，也要对数据库做限流保护，防止极端情况下缓存全部失效：

```java
@Configuration
public class DbRateLimiterConfig {

    @Bean
    public RateLimiter dbRateLimiter() {
        // Guava RateLimiter：每秒最多 1000 个请求到达数据库
        return RateLimiter.create(1000);
    }
}

@Service
public class UserService {

    @Autowired
    private RateLimiter dbRateLimiter;

    public User getUserFromDb(Long userId) {
        if (!dbRateLimiter.tryAcquire(100, TimeUnit.MILLISECONDS)) {
            throw new RuntimeException("数据库限流，请稍后重试");
        }
        return userMapper.selectById(userId);
    }
}
```

### 6.4 完整防御链路

把四层防御串联起来：

```java
@Service
public class FullDefenseUserService {

    private final Cache<String, String> localCache;       // L1
    private final StringRedisTemplate redis;               // L2
    private final RedisHealthChecker healthChecker;        // 健康检查
    private final RateLimiter dbRateLimiter;               // 数据库限流
    private final UserMapper userMapper;

    public User getUser(Long userId) {
        String key = "user:" + userId;

        // ── 第一层：本地缓存 ──
        String cached = localCache.getIfPresent(key);
        if (cached != null) {
            return JSON.parseObject(cached, User.class);
        }

        // ── 第二层：Redis（仅在健康时访问）──
        if (healthChecker.isHealthy()) {
            try {
                cached = redis.opsForValue().get(key);
                if (cached != null) {
                    localCache.put(key, cached);
                    return JSON.parseObject(cached, User.class);
                }
            } catch (Exception e) {
                log.warn("Redis 查询失败，降级到数据库", e);
            }
        }

        // ── 第三层：数据库（限流保护）──
        if (!dbRateLimiter.tryAcquire(100, TimeUnit.MILLISECONDS)) {
            // 限流触发，返回兜底
            User fallback = new User();
            fallback.setId(userId);
            fallback.setName("系统繁忙，请稍后重试");
            return fallback;
        }

        User user = userMapper.selectById(userId);
        if (user != null) {
            String json = JSON.toJSONString(user);
            // 回填各层（仅在 Redis 健康时回填 L2）
            localCache.put(key, json);
            if (healthChecker.isHealthy()) {
                int ttl = 300 + ThreadLocalRandom.current().nextInt(61);
                redis.opsForValue().set(key, json, ttl, TimeUnit.SECONDS);
            }
        }
        return user;
    }
}
```

### 6.5 各层防御效果

假设 QPS 10000 的请求洪峰：

| 层级 | 拦截率 | 到达下一层的 QPS | 说明 |
| :-- | :-- | :-- | :-- |
| L1 本地缓存 | 80% | 2000 | 热点数据本地返回 |
| L2 Redis | 95% | 100 | 正常缓存命中 |
| L3 熔断/限流 | 90% | 10 | 异常时兜底 |
| L4 数据库 | - | 10 | 最终承受 0.1% 流量 |

> 纵深防御不是银弹，它的价值在于：任何单一层级的故障都不会直接打垮数据库。即使 Redis 完全宕机，本地缓存 + 熔断降级仍然能保护数据库。

## 7. 小结

| 要点 | 说明 |
| :-- | :-- |
| L1 TTL < L2 TTL | 避免 L1 旧值覆盖 L2 新值 |
| 监控命中率 | L1 命中率低于 50% 需要调优 |
| 写入时清除所有层级 | 避免脏读 |
| 多实例一致性 | 缩短 TTL 或消息广播 |
| 容量规划 | L1 存热点（千级），L2 存温数据（万级~十万级） |

纵深防御的分层：

| 层级 | 手段 | 防御目标 |
| :-- | :-- | :-- |
| 预防 | 缓存预热 + TTL 随机化 | 避免冷启动和同时过期 |
| 缓冲 | 多级缓存（L1 + L2） | 拦截大部分请求 |
| 兜底 | 熔断降级 + 数据库限流 | 保护数据库不被打垮 |

判别口诀：**预热防冷启动、随机防同时过期、多级防穿透、熔断防雪崩**。
