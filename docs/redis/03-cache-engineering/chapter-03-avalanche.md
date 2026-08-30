# 缓存雪崩

> 缓存雪崩指「大量缓存 key 同时失效」或「缓存服务整体宕机」，导致海量请求瞬间直达数据库，把数据库打垮。本章讲解雪崩的成因与三种缓解手段，并给出 Spring Boot 落地代码。

## 1. 问题

雪崩有两种成因：

| 成因 | 说明 |
| :-- | :-- |
| 大量 key 同时过期 | 同一时间设置了相同 TTL 的 key 集体失效 |
| 缓存服务宕机 | Redis 整体不可用，所有请求直达数据库 |

![缓存雪崩成因](/redis/03-cache-engineering-chapter-03-avalanche-1.svg)

危害：数据库瞬时并发激增，连接耗尽，整个系统不可用。

## 2. TTL 随机化

给每个 key 的过期时间加上随机偏移，让它们错峰过期，避免「同时过期」。

```java
// 基础 TTL 300 秒 + 0~60 秒随机偏移
int baseTtl = 300;
int randomOffset = ThreadLocalRandom.current().nextInt(61);  // 0~60
int ttl = baseTtl + randomOffset;
redis.opsForValue().set(key, value, ttl, TimeUnit.SECONDS);
```

封装为工具方法，统一管理：

```java
public class CacheUtils {

    private static final int BASE_TTL = 300;       // 基础 5 分钟
    private static final int RANDOM_RANGE = 60;    // 随机 0~60 秒

    /**
     * 设置带随机偏移的缓存
     */
    public static void setWithRandomTtl(StringRedisTemplate redis,
                                         String key, String value) {
        int ttl = BASE_TTL + ThreadLocalRandom.current().nextInt(RANDOM_RANGE + 1);
        redis.opsForValue().set(key, value, ttl, TimeUnit.SECONDS);
    }
}
```

要点：

| 要点 | 说明 |
| :-- | :-- |
| 固定基础值 | 保持一个基准 TTL（如 300 秒） |
| 随机偏移 | 叠加一个随机范围（如 0~60 秒） |
| 错峰失效 | 不同 key 过期时间分散，避免同点洪峰 |

## 3. 多级缓存

在 Redis 之上再加一层「本地缓存」（如 Caffeine），形成多级缓存：

![多级缓存流程](/redis/03-cache-engineering-chapter-03-avalanche-2.svg)

| 层级 | 说明 | 特点 |
| :-- | :-- | :-- |
| L1 本地缓存 | 进程内，最快 | 各实例独立，容量小 |
| L2 Redis | 分布式缓存 | 共享，容量大 |
| DB | 最终数据源 | 最慢 |

即使 Redis 宕机，本地缓存仍能兜住一部分热点请求，减少直达数据库的压力。

### 3.1 Caffeine + Redis 实现

```xml
<!-- pom.xml -->
<dependency>
    <groupId>com.github.ben-manes.caffeine</groupId>
    <artifactId>caffeine</artifactId>
    <version>3.1.8</version>
</dependency>
```

```java
@Service
public class MultiLevelCacheService {

    private final Cache<Long, User> localCache;
    private final StringRedisTemplate redis;
    private final UserMapper userMapper;

    public MultiLevelCacheService(StringRedisTemplate redis, UserMapper userMapper) {
        this.redis = redis;
        this.userMapper = userMapper;

        // L1：本地缓存，最大 1000 条，5 分钟过期
        this.localCache = Caffeine.newBuilder()
            .maximumSize(1000)
            .expireAfterWrite(5, TimeUnit.MINUTES)
            .build();
    }

    public User getUser(Long userId) {
        // L1：查本地缓存
        User user = localCache.getIfPresent(userId);
        if (user != null) {
            return user;
        }

        // L2：查 Redis
        String cached = redis.opsForValue().get("user:" + userId);
        if (cached != null) {
            user = JSON.parseObject(cached, User.class);
            localCache.put(userId, user);  // 回填 L1
            return user;
        }

        // L3：查数据库
        user = userMapper.selectById(userId);
        if (user != null) {
            // 回填 L2（带随机 TTL 防雪崩）
            CacheUtils.setWithRandomTtl(redis, "user:" + userId,
                JSON.toJSONString(user));
            localCache.put(userId, user);  // 回填 L1
        }
        return user;
    }

    /**
     * 写入时清除所有层级
     */
    public void updateUser(Long userId, User user) {
        userMapper.updateById(user);
        redis.delete("user:" + userId);    // 清 L2
        localCache.invalidate(userId);      // 清 L1
    }
}
```

多级缓存的读取顺序和穿透防护：

```text
L1 命中 → 直接返回（最快，微秒级）
L1 未命中 → L2 命中 → 回填 L1，返回
L1/L2 均未命中 → L3（DB）→ 回填 L2 + L1，返回
```

> 本地缓存的坑：各实例的本地缓存是独立的，实例 A 更新了数据，实例 B 的本地缓存还是旧值。解决方式：写入时通过消息广播通知各实例清除本地缓存，或接受短暂不一致（本地缓存 TTL 设短一些）。

## 4. 熔断与降级

当检测到缓存不可用、数据库压力过大时，主动熔断降级，保护数据库。

| 手段 | 说明 |
| :-- | :-- |
| 熔断 | 缓存服务异常时，快速失败，不再穿透 |
| 降级 | 返回兜底数据（默认值、静态页）而非查库 |
| 限流 | 限制打到数据库的请求速率 |

![熔断降级流程](/redis/03-cache-engineering-chapter-03-avalanche-3.svg)

### 4.1 Sentinel 熔断降级

```xml
<!-- pom.xml -->
<dependency>
    <groupId>com.alibaba.csp</groupId>
    <artifactId>sentinel-core</artifactId>
    <version>1.8.7</version>
</dependency>
<dependency>
    <groupId>com.alibaba.csp</groupId>
    <artifactId>sentinel-annotation-aspectj</artifactId>
    <version>1.8.7</version>
</dependency>
```

```java
@Service
public class ResilientUserService {

    private final StringRedisTemplate redis;
    private final UserMapper userMapper;

    @SentinelResource(
        value = "getUser",
        fallback = "getUserFallback",       // 熔断降级走兜底
        blockHandler = "getUserBlockHandler" // 限流走兜底
    )
    public User getUser(Long userId) {
        String cached = redis.opsForValue().get("user:" + userId);
        if (cached != null) {
            return JSON.parseObject(cached, User.class);
        }
        User user = userMapper.selectById(userId);
        if (user != null) {
            redis.opsForValue().set("user:" + userId,
                JSON.toJSONString(user), 5, TimeUnit.MINUTES);
        }
        return user;
    }

    /**
     * 降级兜底：返回默认值，不查库
     */
    public User getUserFallback(Long userId, Throwable t) {
        User fallback = new User();
        fallback.setId(userId);
        fallback.setName("用户信息暂时不可用");
        return fallback;
    }

    /**
     * 限流兜底
     */
    public User getUserBlockHandler(Long userId, BlockException e) {
        return getUserFallback(userId, e);
    }
}
```

初始化 Sentinel 规则：

```java
@Configuration
public class SentinelConfig {

    @PostConstruct
    public void initRules() {
        // 降级规则：异常比例超过 50% 时熔断，持续 10 秒
        DegradeRule rule = new DegradeRule("getUser")
            .setGrade(CircuitBreakerStrategy.ERROR_RATIO.getType())
            .setCount(0.5)
            .setTimeWindow(10)
            .setMinRequestAmount(5);
        DegradeRuleManager.loadRules(Collections.singletonList(rule));
    }
}
```

## 5. 三大问题对比

缓存穿透、击穿、雪崩常被一起考察，核心区别在于「失效范围」：

| 问题 | 失效对象 | 数据是否存在 | 触发特征 |
| :-- | :-- | :-- | :-- |
| 穿透 | 不存在的 key | 数据库也不存在 | 单点重复，恶意查询 |
| 击穿 | 单个热点 key | 数据库存在 | 单点瞬间过期 |
| 雪崩 | 大量 key 或整个服务 | 数据库存在 | 大面积同时失效 |

判别口诀：**穿透查不到（数据本身没有）、击穿点过期（单个热点）、雪崩面过期（大面积/服务宕机）**。
