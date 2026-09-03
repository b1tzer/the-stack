# 缓存失效：穿透·击穿·雪崩

> 缓存失效是缓存系统最常出的一类事故：请求本该被缓存拦住，却因为各种原因穿透到数据库。穿透、击穿、雪崩是其中三个经典问题，它们的区别在于「什么失效了」。本章先用一张表讲清三者边界，再逐一给出成因与完整解法。

## 1. 三者区别

| 问题 | 失效对象 | 数据是否存在 | 触发特征 | 核心解法 |
| :-- | :-- | :-- | :-- | :-- |
| 穿透 | 不存在的 key | 数据库也不存在 | 单点重复，恶意查询 | 布隆过滤器 / 缓存空值 |
| 击穿 | 单个热点 key | 数据库存在 | 单点瞬间过期 | 互斥锁 / 逻辑过期 |
| 雪崩 | 大量 key 或整个服务 | 数据库存在 | 大面积同时失效 | TTL 随机化 / 多级缓存 / 熔断降级 |

判别口诀：**穿透查不到（数据本身没有）、击穿点过期（单个热点）、雪崩面过期（大面积或服务宕机）**。

三者的共同点都是「缓存没拦住，请求直达数据库」，所以解法也共享一条主线：**让尽可能多的请求在最便宜的层被拦住**。下面逐个展开。

## 2. 缓存穿透

> 缓存穿透指查询一个「缓存和数据库都不存在」的数据。这类请求每次都穿透缓存直达数据库，当被恶意或异常地大量发起时，会把数据库打垮。

### 2.1 问题

正常查询会先查缓存，命中直接返回；未命中则查数据库，再把结果写入缓存。

![缓存穿透问题流程](/redis/03-cache-engineering-chapter-01-penetration-1.svg)

穿透的根源在于「缓存和数据库都没有数据」：既然数据库查不到，就不会写缓存，于是下一次相同请求还是查不到缓存、还是直达数据库。

典型场景：

| 场景 | 说明 |
| :-- | :-- |
| 恶意攻击 | 批量请求大量不存在的 key |
| 业务漏洞 | 用自增 ID 猜测，查询不存在的数据 |
| 数据冷启动 | 大量新业务 ID 尚未写入数据库 |

危害：数据库反复执行无效查询，连接被占满，最终拖垮整个系统。

### 2.2 布隆过滤器

布隆过滤器（Bloom Filter）用于「快速判断一个 key 是否可能存在」——查询前先过滤掉必然不存在的 key。

**原理**：布隆过滤器是一个位数组 + 多个哈希函数：

```txt
插入元素 x：
  用 k 个哈希函数对 x 求值，得到 k 个位置，把这 k 个位置都置为 1

查询元素 y：
  同样求 k 个位置，若所有位置都是 1，则「可能存在」
  若任意一个位置是 0，则「必然不存在」
```

**特性**：

| 特性 | 说明 |
| :-- | :-- |
| 空间高效 | 固定大小的位数组，不存元素本身 |
| 必然不存在 | 判「不存在」100% 准确 |
| 可能误判 | 判「存在」有误判率（把不存在误判为存在） |
| 不可删除 | 传统布隆过滤器不支持删除元素 |

**Redisson 实现**：Redis 通过 RedisBloom 模块提供原生布隆过滤器，Java 项目中更常用的是 Redisson 内置实现，无需额外安装模块。

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
public class UserBloomFilter {

    private final RBloomFilter<Long> bloomFilter;

    public UserBloomFilter(RedissonClient redisson) {
        // 初始化布隆过滤器：预期插入 100 万条，误判率 1%
        this.bloomFilter = redisson.getBloomFilter("user:bloom");
        this.bloomFilter.tryInit(1_000_000L, 0.01);
    }

    /**
     * 数据写入数据库时，同步添加到布隆过滤器
     * 通常在数据初始化、新增用户时调用
     */
    public void add(Long userId) {
        bloomFilter.add(userId);
    }

    /**
     * 查询前先过布隆过滤器
     * 返回 false 表示「一定不存在」，可直接返回空
     * 返回 true 表示「可能存在」，继续查缓存和数据库
     */
    public boolean mightContain(Long userId) {
        return bloomFilter.contains(userId);
    }
}
```

在查询链路中嵌入布隆过滤器：

```java
@Service
public class UserService {

    private final UserBloomFilter bloomFilter;
    private final StringRedisTemplate redis;
    private final UserMapper userMapper;

    public User getUser(Long userId) {
        // 1. 布隆过滤器拦截「必然不存在」的请求
        if (!bloomFilter.mightContain(userId)) {
            return null;  // 直接返回，不查缓存也不查库
        }

        // 2. 查缓存
        String cached = redis.opsForValue().get("user:" + userId);
        if (cached != null) {
            return JSON.parseObject(cached, User.class);
        }

        // 3. 查数据库
        User user = userMapper.selectById(userId);
        if (user != null) {
            redis.opsForValue().set("user:" + userId,
                JSON.toJSONString(user), 5, TimeUnit.MINUTES);
        }
        return user;
    }
}
```

**布隆过滤器的维护**：布隆过滤器不是一劳永逸的，需要在数据变更时同步更新：

| 场景 | 操作 |
| :-- | :-- |
| 新增数据 | 写入数据库的同时调用 `bloomFilter.add()` |
| 删除数据 | 传统布隆过滤器不支持删除，需使用 Counting Bloom Filter 或定期重建 |
| 数据迁移 | 批量初始化时调用 `bloomFilter.add()` 批量写入 |

> 实际项目中，常见做法是在项目启动时从数据库全量加载一次布隆过滤器，之后通过监听 Binlog 或在 Service 层埋点来增量更新。

在查缓存前先过布隆过滤器：

![布隆过滤器拦截流程](/redis/03-cache-engineering-chapter-01-penetration-2.svg)

布隆过滤器拦截了大部分「不存在」的请求，只有少数「可能存在的误判」会继续查缓存和数据库。

### 2.3 缓存空值

缓存空值指「把不存在的查询结果（空值）也写入缓存」——这样下一次相同请求就能命中缓存，不再穿透。

```bash
SET cache:user:9999 "{}" EX 60   # 缓存哨兵值 "{}" 表示「不存在」，60 秒过期
```

要点：

| 要点 | 说明 |
| :-- | :-- |
| 空值也缓存 | 查不到也写一个空值进缓存 |
| 设置短 TTL | 空值缓存时间要短（如 60 秒），避免长期占用 |
| 数据不一致风险 | 数据可能之后被写入，但空值缓存还没过期 |

缓存空值实现简单，但会引入「缓存与数据库短暂不一致」的问题：某个 key 刚被判定不存在、缓存了空值，随后数据被写入，但空值缓存未过期，导致短暂返回空。

Spring Boot 实现：

```java
public User getUser(Long userId) {
    String cached = redis.opsForValue().get("user:" + userId);
    if (cached != null) {
        // 空值标记：约定存储 "{}" 表示空值
        if ("{}".equals(cached)) {
            return null;
        }
        return JSON.parseObject(cached, User.class);
    }

    User user = userMapper.selectById(userId);
    if (user != null) {
        redis.opsForValue().set("user:" + userId,
            JSON.toJSONString(user), 5, TimeUnit.MINUTES);
    } else {
        // 缓存空值，短 TTL
        redis.opsForValue().set("user:" + userId, "{}", 60, TimeUnit.SECONDS);
    }
    return user;
}
```

### 2.4 组合防御：分层拦截

生产环境中，单一方案往往不够。推荐「布隆过滤器 + 缓存空值」组合使用，形成三层拦截：

```txt
请求进入
  → 第一层：布隆过滤器（拦截必然不存在，零成本）
  → 第二层：缓存（命中直接返回）
  → 第三层：数据库（查到回填缓存，查不到回填空值）
```

| 层级 | 拦截目标 | 成本 |
| :-- | :-- | :-- |
| 布隆过滤器 | 99% 的不存在 key（按误判率 1% 计） | 一次内存位运算，极低 |
| 缓存空值 | 少量漏网的不存在 key | 一次 Redis GET，低 |
| 数据库 | 真实存在的 key | 一次 SQL 查询，高 |

这个分层方案的核心思想是：**让尽可能多的请求在最便宜的层被拦住**。布隆过滤器挡住绝大部分，缓存空值兜住漏网之鱼，只有真正需要查库的请求才到达数据库。

### 2.5 方案对比

| 维度 | 布隆过滤器 | 缓存空值 | 组合防御 |
| :-- | :-- | :-- | :-- |
| 实现复杂度 | 较高（需引入模块/客户端） | 低（几行代码） | 较高（两者都要实现） |
| 内存占用 | 固定，与 key 数量无关 | 与空值 key 数量成正比 | 两者之和 |
| 误判 | 有（不存在误判为存在） | 无 | 有（源自布隆过滤器，被空值兜底） |
| 数据一致性 | 好（不缓存数据本身） | 可能短暂不一致 | 可能短暂不一致 |
| 防护效果 | 强 | 一般 | 最强 |
| 适用场景 | 大规模、key 空间巨大 | 小规模、简单场景 | 生产环境推荐 |

选型建议：

- key 空间大、追求极致防护 → 布隆过滤器
- 场景简单、快速上线 → 缓存空值
- 生产环境 → 组合防御（推荐）

## 3. 缓存击穿

> 缓存击穿指某个「热点 key」在过期的一瞬间，大量并发请求同时穿透缓存直达数据库。与穿透不同，击穿的数据在数据库里是存在的，只是缓存刚好过期。

### 3.1 问题

热点 key 平时一直命中缓存，但过期后缓存里没有它了，瞬间涌入的大量并发请求全部打到数据库。

![缓存击穿问题流程](/redis/03-cache-engineering-chapter-02-breakdown-1.svg)

典型场景：

| 场景 | 说明 |
| :-- | :-- |
| 秒杀商品详情 | 某个爆款商品详情页被大量刷新 |
| 热点新闻 | 某条热搜内容过期瞬间被刷屏 |
| 定时任务兜底 | 定时删除热点缓存后请求瞬间涌入 |

危害：单个热点 key 的过期，就能让数据库承受瞬时高并发，甚至拖垮数据库。

### 3.2 互斥锁

互斥锁的思路：缓存未命中时，只允许一个请求去查数据库并重建缓存，其他请求等待或重试。

![互斥锁方案流程](/redis/03-cache-engineering-chapter-02-breakdown-2.svg)

**原生实现**：

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

**Redisson 分布式锁**：原生 `SET NX PX` 有两个痛点：锁过期了业务还没执行完（提前释放），以及释放锁时需要 Lua 脚本保证原子性。Redisson 的 `RLock` 解决了这两个问题——内置看门狗（Watchdog）自动续命，`unlock()` 自动校验归属并原子释放。

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

### 3.3 逻辑过期

逻辑过期指「不设置物理 TTL，而是在 value 里存一个逻辑过期时间」。缓存永不物理过期，靠后台异步刷新。

![逻辑过期方案流程](/redis/03-cache-engineering-chapter-02-breakdown-3.svg)

**数据结构**：

```json
{
  "data": "实际数据",
  "expireTime": 1712500000000
}
```

**实现要点**：

| 要点 | 说明 |
| :-- | :-- |
| 不设物理 TTL | 缓存不会物理过期，避免击穿 |
| 返回旧值 | 逻辑过期后仍先返回旧值，保证可用 |
| 异步重建 | 后台线程查库更新，不阻塞请求 |
| 加锁防并发重建 | 只允许一个线程去重建 |

**完整实现**：逻辑过期的关键在于——数据在写入缓存时就不设物理 TTL，而是在 value 里附带一个逻辑过期时间戳。读取时判断是否逻辑过期：没过期直接返回，过期了返回旧值并异步重建。

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

### 3.4 方案对比

| 维度 | 互斥锁 | 逻辑过期 |
| :-- | :-- | :-- |
| 数据一致性 | 强（重建期间返回新值） | 弱（逻辑过期后短暂返回旧值） |
| 可用性 | 未拿到锁的请求需等待 | 高（始终返回旧值） |
| 实现复杂度 | 低（Redisson 开箱即用） | 较高（需存时间戳 + 异步线程池） |
| 适用场景 | 对一致性要求高的场景 | 对可用性要求高的场景 |

选型建议：

- 一致性优先 → 互斥锁（Redisson `tryLock`）
- 可用性优先 → 逻辑过期（秒杀、热点资讯等「宁可返回旧值也不能让数据库崩」的场景）

## 4. 缓存雪崩

> 缓存雪崩指「大量缓存 key 同时失效」或「缓存服务整体宕机」，导致海量请求瞬间直达数据库，把数据库打垮。

### 4.1 问题

雪崩有两种成因：

| 成因 | 说明 |
| :-- | :-- |
| 大量 key 同时过期 | 同一时间设置了相同 TTL 的 key 集体失效 |
| 缓存服务宕机 | Redis 整体不可用，所有请求直达数据库 |

![缓存雪崩成因](/redis/03-cache-engineering-chapter-03-avalanche-1.svg)

危害：数据库瞬时并发激增，连接耗尽，整个系统不可用。

### 4.2 TTL 随机化

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

### 4.3 多级缓存

TTL 随机化只防「同时过期」，防不住 Redis 整体宕机。要兜住宕机场景，需要在 Redis 之上再加一层本地缓存（Caffeine），形成多级缓存。这部分是完整的架构设计，见 [多级缓存与纵深防御](./chapter-03-multi-level-defense) 的 §1~§4。

### 4.4 熔断与降级

当检测到缓存不可用、数据库压力过大时，主动熔断降级，保护数据库。具体实现（Redis 健康检查、降级查询、数据库限流）见 [多级缓存与纵深防御](./chapter-03-multi-level-defense) 的 §6。
