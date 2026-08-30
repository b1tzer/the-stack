# 缓存击穿

> 缓存击穿指某个「热点 key」在过期的一瞬间，大量并发请求同时穿透缓存直达数据库。与穿透不同，击穿的数据在数据库里是存在的，只是缓存刚好过期。本章讲解击穿的成因与三种解法，重点补充 Redisson 分布式锁和逻辑过期的完整实现。

## 1. 问题

热点 key 平时一直命中缓存，但过期后缓存里没有它了，瞬间涌入的大量并发请求全部打到数据库。

![缓存击穿问题流程](/redis/03-cache-engineering-chapter-02-breakdown-1.svg)

典型场景：

| 场景 | 说明 |
| :-- | :-- |
| 秒杀商品详情 | 某个爆款商品详情页被大量刷新 |
| 热点新闻 | 某条热搜内容过期瞬间被刷屏 |
| 定时任务兜底 | 定时删除热点缓存后请求瞬间涌入 |

危害：单个热点 key 的过期，就能让数据库承受瞬时高并发，甚至拖垮数据库。

## 2. 互斥锁

互斥锁的思路：缓存未命中时，只允许一个请求去查数据库并重建缓存，其他请求等待或重试。

![互斥锁方案流程](/redis/03-cache-engineering-chapter-02-breakdown-2.svg)

### 2.1 原生实现

```java
// 伪代码
public String get(String key) {
    String value = redis.get(key);
    if (value != null) return value;

    // 尝试加锁，拿到锁的去查库重建缓存
    String lock = redis.set("lock:" + key, "1", "NX", "PX", 10000);
    if (lock != null) {
        try {
            value = db.query(key);           // 查数据库
            redis.set(key, value, 300);      // 重建缓存
        } finally {
            redis.del("lock:" + key);        // 释放锁
        }
        return value;
    } else {
        // 没拿到锁，等待后重试
        Thread.sleep(50);
        return get(key);
    }
}
```

要点：

| 要点 | 说明 |
| :-- | :-- |
| 双重检查 | 拿到锁后再查一次缓存，避免重复重建 |
| 锁超时 | 锁必须设过期时间，防止死锁 |
| 锁粒度 | 每个 key 一把锁，避免不同 key 互相阻塞 |

### 2.2 Redisson 分布式锁

原生 `SET NX PX` 有两个痛点：锁过期了业务还没执行完（提前释放），以及释放锁时需要 Lua 脚本保证原子性。Redisson 的 `RLock` 解决了这两个问题——内置看门狗（Watchdog）自动续命，`unlock()` 自动校验归属并原子释放。

```xml
<!-- pom.xml -->
<dependency>
    <groupId>org.redisson</groupId>
    <artifactId>redisson-spring-boot-starter</artifactId>
    <version>3.27.0</version>
</dependency>
```

```java
@Service
public class UserService {

    private final RedissonClient redisson;
    private final StringRedisTemplate redis;
    private final UserMapper userMapper;

    public User getUserWithLock(Long userId) {
        String cacheKey = "user:" + userId;
        String lockKey = "lock:user:" + userId;

        // 1. 先查缓存
        String cached = redis.opsForValue().get(cacheKey);
        if (cached != null) {
            return JSON.parseObject(cached, User.class);
        }

        // 2. 加分布式锁
        RLock lock = redisson.getLock(lockKey);
        try {
            // waitTime=0：拿不到锁立即返回，不阻塞
            // leaseTime=30s：看门狗默认每 10s 续命一次
            if (lock.tryLock(0, 30, TimeUnit.SECONDS)) {
                try {
                    // 3. 双重检查：拿到锁后再查一次缓存
                    cached = redis.opsForValue().get(cacheKey);
                    if (cached != null) {
                        return JSON.parseObject(cached, User.class);
                    }

                    // 4. 查数据库并回填缓存
                    User user = userMapper.selectById(userId);
                    if (user != null) {
                        redis.opsForValue().set(cacheKey,
                            JSON.toJSONString(user), 5, TimeUnit.MINUTES);
                    }
                    return user;
                } finally {
                    lock.unlock();
                }
            } else {
                // 5. 没拿到锁，短暂等待后重试
                Thread.sleep(50);
                return getUserWithLock(userId);
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new RuntimeException("获取锁被中断", e);
        }
    }
}
```

Redisson 看门狗机制：

| 特性 | 说明 |
| :-- | :-- |
| 自动续命 | 默认每 10 秒续一次（leaseTime / 3），锁不会提前过期 |
| 崩溃自愈 | 持锁方崩溃后不再续命，锁在 leaseTime 后自动释放 |
| 可重入 | 同一线程可多次加锁，计数器递增，unlock 递减 |
| 公平锁 | `redisson.getFairLock()` 支持公平排队，避免饥饿 |

> 对比原生 `SET NX PX`：原生方案需要自己实现续命逻辑和 Lua 释放脚本，Redisson 封装了这些细节，生产环境推荐使用。

## 3. 逻辑过期

逻辑过期指「不设置物理 TTL，而是在 value 里存一个逻辑过期时间」。缓存永不物理过期，靠后台异步刷新。

![逻辑过期方案流程](/redis/03-cache-engineering-chapter-02-breakdown-3.svg)

### 3.1 数据结构

```json
{
  "data": "实际数据",
  "expireTime": 1712500000000
}
```

### 3.2 实现要点

| 要点 | 说明 |
| :-- | :-- |
| 不设物理 TTL | 缓存不会物理过期，避免击穿 |
| 返回旧值 | 逻辑过期后仍先返回旧值，保证可用 |
| 异步重建 | 后台线程查库更新，不阻塞请求 |
| 加锁防并发重建 | 只允许一个线程去重建 |

### 3.3 完整实现

逻辑过期的关键在于：数据在写入缓存时就不设物理 TTL，而是在 value 里附带一个逻辑过期时间戳。读取时判断是否逻辑过期——没过期直接返回，过期了返回旧值并异步重建。

```java
@Data
public class CacheData<T> {
    private T data;
    private long expireTime;  // 逻辑过期时间戳（毫秒）
}
```

```java
@Service
public class UserService {

    private static final String CACHE_KEY = "user:logic:";
    private static final long LOGIC_TTL_MS = 5 * 60 * 1000;  // 逻辑过期 5 分钟
    private static final String REBUILD_LOCK = "lock:rebuild:user:";

    private final RedissonClient redisson;
    private final StringRedisTemplate redis;
    private final UserMapper userMapper;
    private final ExecutorService rebuildPool = Executors.newFixedThreadPool(4);

    /**
     * 初始化缓存（项目启动或数据写入时调用）
     * 不设物理 TTL，只在 value 里记录逻辑过期时间
     */
    public void initCache(Long userId) {
        User user = userMapper.selectById(userId);
        if (user == null) return;

        CacheData<User> cacheData = new CacheData<>();
        cacheData.setData(user);
        cacheData.setExpireTime(System.currentTimeMillis() + LOGIC_TTL_MS);

        redis.opsForValue().set(CACHE_KEY + userId,
            JSON.toJSONString(cacheData));  // 无 TTL
    }

    /**
     * 查询：逻辑未过期直接返回，过期则返回旧值 + 异步重建
     */
    public User getUser(Long userId) {
        String cached = redis.opsForValue().get(CACHE_KEY + userId);
        if (cached == null) {
            return null;  // 缓存不存在，需提前预热
        }

        CacheData<User> cacheData = JSON.parseObject(cached,
            new TypeReference<CacheData<User>>() {});

        // 逻辑未过期，直接返回
        if (System.currentTimeMillis() < cacheData.getExpireTime()) {
            return cacheData.getData();
        }

        // 逻辑已过期：尝试异步重建，同时返回旧值
        asyncRebuild(userId);
        return cacheData.getData();  // 返回旧值，保证可用性
    }

    /**
     * 异步重建：加锁防并发，查库更新缓存
     */
    private void asyncRebuild(Long userId) {
        RLock lock = redisson.getLock(REBUILD_LOCK + userId);
        if (!lock.tryLock()) {
            return;  // 已有线程在重建，跳过
        }

        rebuildPool.submit(() -> {
            try {
                User user = userMapper.selectById(userId);
                if (user == null) return;

                CacheData<User> newData = new CacheData<>();
                newData.setData(user);
                newData.setExpireTime(System.currentTimeMillis() + LOGIC_TTL_MS);

                redis.opsForValue().set(CACHE_KEY + userId,
                    JSON.toJSONString(newData));
            } finally {
                lock.unlock();
            }
        });
    }
}
```

## 4. 方案对比

| 维度 | 互斥锁 | 逻辑过期 |
| :-- | :-- | :-- |
| 数据一致性 | 强（重建期间返回新值） | 弱（逻辑过期后短暂返回旧值） |
| 可用性 | 未拿到锁的请求需等待 | 高（始终返回旧值） |
| 实现复杂度 | 低（Redisson 开箱即用） | 较高（需存时间戳 + 异步线程池） |
| 适用场景 | 对一致性要求高的场景 | 对可用性要求高的场景 |

选型建议：

- 一致性优先 → 互斥锁（Redisson `tryLock`）
- 可用性优先 → 逻辑过期（秒杀、热点资讯等「宁可返回旧值也不能让数据库崩」的场景）
