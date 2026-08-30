# 雪崩纵深防御

> 第 3 章讲了雪崩的三种单一解法：TTL 随机化、多级缓存、熔断降级。但在生产环境中，单一手段不足以应对复杂的故障场景。本章把这些手段组合成一套「纵深防御」体系，从预防、缓冲、兜底三个层面构建完整防线。

## 1. 纵深防御的思路

单一防御的问题：

| 手段 | 局限性 |
| :-- | :-- |
| TTL 随机化 | 只防「同时过期」，不防 Redis 宕机 |
| 多级缓存 | 本地缓存容量有限，冷启动时无数据 |
| 熔断降级 | 已经在降级了，用户体验受损 |

纵深防御的核心思想：**不指望一层挡住所有攻击，而是每一层拦住一部分，层层递减，最终到达数据库的请求量在可控范围内**。

```text
                    ┌─────────────────┐
  请求洪峰 ─────────┤ L1 本地缓存      │ 拦截 80% 热点请求
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

## 2. 第一层：缓存预热

缓存预热指在系统启动或流量高峰前，主动把热点数据加载到缓存中，避免冷启动时的全量穿透。

### 2.1 启动时预热

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

### 2.2 定时预热

对于周期性热点（如每天早高峰的首页数据），可以用定时任务提前预热：

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

## 3. 第二层：TTL 随机化 + 逻辑过期

### 3.1 TTL 随机化

第 3 章已讲，核心是错峰过期：

```java
int ttl = baseTtl + ThreadLocalRandom.current().nextInt(randomRange + 1);
```

### 3.2 逻辑过期（补充）

对于核心热点数据，可以用逻辑过期实现「永不物理过期 + 异步刷新」：

```java
public User getHotUser(Long userId) {
    String key = "user:hot:" + userId;
    String cached = redis.opsForValue().get(key);
    if (cached == null) return null;

    CacheData<User> cacheData = JSON.parseObject(cached,
        new TypeReference<CacheData<User>>() {});

    if (System.currentTimeMillis() < cacheData.getExpireTime()) {
        return cacheData.getData();
    }

    // 逻辑过期，异步刷新，返回旧值
    asyncRebuild(userId);
    return cacheData.getData();
}
```

> 逻辑过期适用于「宁可返回旧值也不能没有值」的场景，比如秒杀商品详情、热搜榜单。

## 4. 第三层：多级缓存

第 7 章已详细讲解。关键参数：

| 层级 | TTL | 容量 | 作用 |
| :-- | :-- | :-- | :-- |
| L1 Caffeine | 1~2 分钟 | 1000~5000 条 | 拦截热点，降低 Redis 压力 |
| L2 Redis | 5~30 分钟 | 万级~十万级 | 主力缓存层 |

## 5. 第四层：熔断降级

当 Redis 整体不可用或数据库压力过大时，主动降级保护数据库。

### 5.1 Redis 健康检查

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

### 5.2 降级查询

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

### 5.3 限流保护数据库

即使有缓存层，也要对数据库做限流保护，防止极端情况下缓存全部失效：

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

## 6. 完整防御链路

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

## 7. 各层防御效果

假设 QPS 10000 的请求洪峰：

| 层级 | 拦截率 | 到达下一层的 QPS | 说明 |
| :-- | :-- | :-- | :-- |
| L1 本地缓存 | 80% | 2000 | 热点数据本地返回 |
| L2 Redis | 95% | 100 | 正常缓存命中 |
| L3 熔断/限流 | 90% | 10 | 异常时兜底 |
| L4 数据库 | - | 10 | 最终承受 0.1% 流量 |

> 纵深防御不是银弹，它的价值在于：任何单一层级的故障都不会直接打垮数据库。即使 Redis 完全宕机，本地缓存 + 熔断降级仍然能保护数据库。

## 8. 小结

| 层级 | 手段 | 防御目标 |
| :-- | :-- | :-- |
| 预防 | 缓存预热 + TTL 随机化 | 避免冷启动和同时过期 |
| 缓冲 | 多级缓存（L1 + L2） | 拦截大部分请求 |
| 兜底 | 熔断降级 + 数据库限流 | 保护数据库不被打垮 |

判别口诀：**预热防冷启动、随机防同时过期、多级防穿透、熔断防雪崩**。
