# 缓存模式全景

> 前几章分别讲了穿透、击穿、雪崩、一致性等「问题与解法」，但没有从正面梳理过「缓存到底有几种用法」。本章系统对比四种缓存模式，给出代码级实现和选型决策树，帮助你在项目初期做出正确的架构选择。

## 1. Cache Aside（旁路缓存）

Cache Aside 是最常见、最灵活的模式。应用代码同时管理缓存和数据库：读时先查缓存、未命中则查库并回填；写时先更新数据库、再删除缓存。

### 1.1 读写流程

```text
读：GET 缓存 → 命中返回 → 未命中 SELECT 数据库 → SETEX 缓存 → 返回
写：UPDATE 数据库 → DEL 缓存
```

### 1.2 代码实现

```java
@Service
public class UserCacheAsideService {

    private final StringRedisTemplate redis;
    private final UserMapper userMapper;

    public User getUser(Long userId) {
        String key = "user:" + userId;
        String cached = redis.opsForValue().get(key);
        if (cached != null) {
            return JSON.parseObject(cached, User.class);
        }

        User user = userMapper.selectById(userId);
        if (user != null) {
            int ttl = 300 + ThreadLocalRandom.current().nextInt(61);
            redis.opsForValue().set(key, JSON.toJSONString(user), ttl, TimeUnit.SECONDS);
        }
        return user;
    }

    @Transactional
    public void updateUser(Long userId, User user) {
        userMapper.updateById(user);
        // 事务提交后再删缓存
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

### 1.3 优缺点

| 维度 | 说明 |
| :-- | :-- |
| 优点 | 实现简单，应用完全掌控，灵活度最高 |
| 缺点 | 缓存逻辑与业务代码耦合，每个 Service 都要写一遍 |
| 适用场景 | 大多数业务场景，尤其是读多写少 |

## 2. Read Through（读穿透）

Read Through 把缓存查询逻辑封装在缓存层内部。应用只和缓存交互，缓存自己负责「未命中时查库并回填」。

### 2.1 读写流程

```text
读：GET 缓存 → 命中返回 → 未命中 → 缓存层自己查库 → 回填 → 返回
写：同 Cache Aside（先更新库，再删缓存）
```

### 2.2 代码实现

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

### 2.3 优缺点

| 维度 | 说明 |
| :-- | :-- |
| 优点 | 业务代码更干净，缓存逻辑集中管理 |
| 缺点 | 需要封装缓存层，初次接入成本较高 |
| 适用场景 | 多处复用同一数据源，希望统一封装加载逻辑 |

## 3. Write Through（写穿透）

Write Through 在写入时同步更新缓存和数据库，保证两者一致。应用只写缓存，缓存层同步写库。

### 3.1 读写流程

```text
读：同 Read Through
写：SET 缓存 → 缓存层同步 UPDATE 数据库
```

### 3.2 代码实现

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

### 3.3 优缺点

| 维度 | 说明 |
| :-- | :-- |
| 优点 | 读性能高，缓存始终最新 |
| 缺点 | 写延迟增加（每次写都要同步写库），写操作不频繁的场景浪费 |
| 适用场景 | 读多写少、对读一致性要求高的场景 |

## 4. Write Behind（异步写回）

Write Behind 只写缓存，异步批量刷库。写性能最高，但存在数据丢失风险。

### 4.1 读写流程

```text
读：同 Read Through
写：SET 缓存 → 异步批量 UPDATE 数据库
```

### 4.2 代码实现

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

### 4.3 优缺点

| 维度 | 说明 |
| :-- | :-- |
| 优点 | 写性能极高，适合高写入吞吐 |
| 缺点 | 缓存宕机则数据丢失，一致性最弱 |
| 适用场景 | 写密集型、允许少量数据丢失（如计数器、日志类数据） |

## 5. 模式对比

| 维度 | Cache Aside | Read Through | Write Through | Write Behind |
| :-- | :-- | :-- | :-- | :-- |
| 缓存管理方 | 应用代码 | 缓存层 | 缓存层 | 缓存层 |
| 写路径 | 先更新库，后删缓存 | 先更新库，后删缓存 | 先写缓存，同步写库 | 先写缓存，异步写库 |
| 一致性 | 中等 | 中等 | 强 | 弱 |
| 写性能 | 中 | 中 | 低 | 高 |
| 实现复杂度 | 低 | 中 | 中 | 高 |
| 数据丢失风险 | 无 | 无 | 无 | 有 |
| 适用场景 | 大多数场景 | 统一封装加载 | 读多写少、强一致 | 写密集、可容忍丢失 |

## 6. 选型决策树

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
