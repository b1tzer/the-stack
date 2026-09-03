# 缓存抽象

> 查询数据库的方法被频繁调用，每次都要走数据库，性能扛不住。Spring Cache 用注解就能给方法加缓存，不侵入业务代码。但缓存用不好，比不用还糟糕——穿透、击穿、雪崩，任何一个都能把数据库打挂。

## 1. @Cacheable / @CachePut / @CacheEvict

```java
@Service
public class ProductService {

    private final ProductRepository repository;

    public ProductService(ProductRepository repository) {
        this.repository = repository;
    }

    // @Cacheable：查缓存，有就返回，没有就执行方法并缓存结果
    @Cacheable(value = "products", key = "#id")
    public Product findById(Long id) {
        System.out.println("查询数据库: " + id);
        return repository.findById(id).orElse(null);
    }

    // @CachePut：每次都执行方法，并更新缓存
    @CachePut(value = "products", key = "#product.id")
    public Product update(Product product) {
        return repository.save(product);
    }

    // @CacheEvict：删除缓存
    @CacheEvict(value = "products", key = "#id")
    public void delete(Long id) {
        repository.deleteById(id);
    }

    // 清空整个 products 缓存
    @CacheEvict(value = "products", allEntries = true)
    public void clearCache() {
        System.out.println("缓存已清空");
    }

    // 组合操作
    @Caching(evict = {
        @CacheEvict(value = "users", key = "#id"),
        @CacheEvict(value = "userList", allEntries = true)
    })
    public void clearCache(Long id) { /* ... */ }
}
```

| 注解 | 执行方法？ | 读缓存？ | 写缓存？ | 典型场景 |
| :-- | :-- | :-- | :-- | :-- |
| `@Cacheable` | 缓存未命中时才执行 | ✅ | 缓存未命中时写入 | 查询 |
| `@CachePut` | 每次都执行 | ❌ | ✅ 每次都更新 | 更新 |
| `@CacheEvict` | 每次都执行 | ❌ | ✅ 删除缓存 | 删除/失效 |

> **踩坑提醒**：`@Cacheable` 默认用方法参数做 Key。如果参数是复杂对象，会用对象的 `toString()` 做 Key，可能导致缓存命中失败。

## 2. 缓存管理器与 Redis 集成

```java
@Configuration
@EnableCaching
public class CacheConfig {

    @Bean
    public RedisCacheManager cacheManager(RedisConnectionFactory factory) {
        // 默认配置：600 秒过期
        RedisCacheConfiguration defaultConfig = RedisCacheConfiguration.defaultCacheConfig()
                .entryTtl(Duration.ofSeconds(600))
                .serializeKeysWith(RedisSerializationContext.SerializationPair
                        .fromSerializer(new StringRedisSerializer()))
                .serializeValuesWith(RedisSerializationContext.SerializationPair
                        .fromSerializer(new GenericJackson2JsonRedisSerializer()))
                .disableCachingNullValues();

        // 针对不同缓存名配置不同的过期时间
        Map<String, RedisCacheConfiguration> configMap = new HashMap<>();
        configMap.put("products", defaultConfig.entryTtl(Duration.ofMinutes(30)));
        configMap.put("users", defaultConfig.entryTtl(Duration.ofHours(1)));
        configMap.put("hotData", defaultConfig.entryTtl(Duration.ofSeconds(60)));

        return RedisCacheManager.builder(factory)
                .cacheDefaults(defaultConfig)
                .withInitialCacheConfigurations(configMap)
                .transactionAware()
                .build();
    }
}
```

序列化方式对比：

| 序列化方式 | 可读性 | 体积 | 跨语言 | 推荐度 |
| :-- | :-- | :-- | :-- | :-- |
| `JdkSerializationRedisSerializer` | ❌ 二进制 | 大 | ❌ | 不推荐 |
| `StringRedisSerializer` | ✅ | 小 | ✅ | Key 推荐 |
| `GenericJackson2JsonRedisSerializer` | ✅ JSON | 中 | ✅ | Value 推荐 |
| `Jackson2JsonRedisSerializer` | ✅ JSON | 中 | ✅ | 需指定类型 |

> **踩坑提醒**：用 `JdkSerializationRedisSerializer`（默认）存的缓存，用 Redis CLI 看到的是乱码。生产环境务必配置 JSON 序列化。

## 3. 缓存穿透 / 击穿 / 雪崩

### 3.1 缓存穿透

**问题**：查询的数据数据库中也没有，缓存永远不命中，请求全部打到数据库。

```java
// 防护方案一：缓存空值
@Cacheable(value = "products", key = "#id", unless = "#result == null ? false : true")
public Product findById(Long id) {
    Product product = repository.findById(id).orElse(null);
    if (product == null) {
        // 缓存空值，设置较短过期时间
        redisTemplate.opsForValue().set("products:" + id, "NULL", 5, TimeUnit.MINUTES);
    }
    return product;
}

// 防护方案二：布隆过滤器
@Service
public class ProductService {

    private BloomFilter<Long> productBloomFilter;

    @PostConstruct
    public void init() {
        productBloomFilter = BloomFilter.create(
            Funnels.longFunnel(), 1000000, 0.01);
        productRepository.findAll().forEach(p ->
            productBloomFilter.put(p.getId()));
    }

    public Product getProduct(Long id) {
        if (!productBloomFilter.mightContain(id)) {
            return null;  // 一定不存在，不查库
        }
        return productRepository.findById(id).orElse(null);
    }
}
```

### 3.2 缓存击穿

**问题**：热点 Key 过期的瞬间，大量请求同时打到数据库。

```java
// 防护：分布式锁
public Product findByIdWithLock(Long id) {
    String key = "products:" + id;
    Product product = redisTemplate.opsForValue().get(key);
    if (product != null) return product;

    String lockKey = "lock:product:" + id;
    boolean locked = redisTemplate.opsForValue()
            .setIfAbsent(lockKey, "1", 10, TimeUnit.SECONDS);
    if (locked) {
        try {
            product = repository.findById(id).orElse(null);
            if (product != null) {
                redisTemplate.opsForValue().set(key, product, 30, TimeUnit.MINUTES);
            }
        } finally {
            redisTemplate.delete(lockKey);
        }
    }
    return product;
}
```

### 3.3 缓存雪崩

**问题**：大量 Key 同时过期，请求全部打到数据库。

```java
// 防护：过期时间加随机值
public Product findByIdWithJitter(Long id) {
    String key = "products:" + id;
    Product product = redisTemplate.opsForValue().get(key);
    if (product == null) {
        product = repository.findById(id).orElse(null);
        if (product != null) {
            // 基础过期 30 分钟 + 随机 0-5 分钟
            long ttl = 30 * 60 + ThreadLocalRandom.current().nextInt(300);
            redisTemplate.opsForValue().set(key, product, ttl, TimeUnit.SECONDS);
        }
    }
    return product;
}
```

### 3.4 速查表

| 问题 | 原因 | 现象 | 防护方案 |
| :-- | :-- | :-- | :-- |
| 穿透 | 查询不存在的数据 | 缓存永远 miss | 缓存空值 / 布隆过滤器 |
| 击穿 | 热点 Key 过期 | 瞬时高并发打 DB | 互斥锁 / 逻辑过期 |
| 雪崩 | 大量 Key 同时过期 | DB 瞬间压力暴涨 | 过期时间加随机值 |

> **经验法则**：缓存穿透是代码问题（没处理 null），缓存击穿是热点问题（没加锁），缓存雪崩是配置问题（过期时间太统一）。

## 4. 自定义缓存 Key 生成策略

```java
// SpEL 表达式自定义 Key
@Cacheable(value = "users", key = "#username + ':' + #region")
public User findByUsernameAndRegion(String username, String region) {
    return repository.findByUsernameAndRegion(username, region);
}

// 自定义 KeyGenerator
@Configuration
public class CacheKeyConfig {

    @Bean
    public KeyGenerator customKeyGenerator() {
        return (target, method, params) -> {
            return target.getClass().getSimpleName()
                    + ":" + method.getName()
                    + ":" + Arrays.deepHashCode(params);
        };
    }
}

// 使用
@Cacheable(value = "products", keyGenerator = "customKeyGenerator")
public List<Product> search(String keyword, int page, int size) {
    return repository.search(keyword, PageRequest.of(page, size));
}
```

SpEL 常用变量：

| 变量 | 含义 | 示例 |
| :-- | :-- | :-- |
| `#参数名` | 方法参数 | `#id`, `#username` |
| `#result` | 方法返回值（unless 中可用） | `#result.size() > 0` |
| `#root.method` | 当前方法 | `#root.method.name` |
| `#root.target` | 目标对象 | `#root.target.class.simpleName` |
| `T(类名)` | 调用静态方法 | `T(System).currentTimeMillis()` |

> **踩坑提醒**：`#result` 只能在 `unless` 和 `condition` 中使用，不能在 `key` 中使用（因为 Key 在方法执行前就要确定）。

## 5. 多级缓存架构

```java
@Configuration
@EnableCaching
class MultiLevelCacheConfig {

    @Bean
    public CacheManager cacheManager(RedisConnectionFactory redisFactory) {
        // L1: Caffeine 本地缓存（快速，容量小）
        CaffeineCacheManager caffeineCacheManager = new CaffeineCacheManager();
        caffeineCacheManager.setCaffeine(Caffeine.newBuilder()
            .maximumSize(10000)
            .expireAfterWrite(Duration.ofMinutes(5)));

        // L2: Redis 分布式缓存（容量大，跨实例共享）
        RedisCacheManager redisCacheManager = RedisCacheManager.builder(redisFactory)
            .cacheDefaults(RedisCacheConfiguration.defaultCacheConfig()
                .entryTtl(Duration.ofMinutes(30))
                .serializeKeysWith(RedisSerializationContext.SerializationPair
                    .fromSerializer(new StringRedisSerializer()))
                .serializeValuesWith(RedisSerializationContext.SerializationPair
                    .fromSerializer(new GenericJackson2JsonRedisSerializer())))
            .build();

        // 组合缓存管理器
        CompositeCacheManager compositeManager = new CompositeCacheManager();
        compositeManager.setCacheManagers(List.of(caffeineCacheManager, redisCacheManager));
        compositeManager.setFallbackToNoOpCache(false);
        return compositeManager;
    }
}
```

## 6. 缓存一致性方案

```java
@Service
public class UserCacheService {

    // 先更新数据库，再删除缓存（Cache Aside 模式）
    @Transactional
    public User updateUser(Long id, UserUpdateDTO dto) {
        User user = userRepository.findById(id).orElseThrow();
        user.setName(dto.getName());
        user.setEmail(dto.getEmail());
        userRepository.save(user);
        return user;
    }

    @CacheEvict(value = "users", key = "#id")
    public void evictUserCache(Long id) {
        // 清除缓存
    }
}
```

## 7. 最佳实践

1. **先更新 DB，再删缓存**——Cache Aside 模式是业界主流方案
2. **缓存过期时间加随机值**——避免大量缓存同时过期
3. **热数据用本地缓存**——Caffeine 比 Redis 快 10 倍以上
4. **缓存 key 命名规范**——`业务:对象:ID`，如 `user:detail:10086`
5. **监控缓存命中率**——命中率低于 80% 说明缓存策略需要优化
6. **JSON 序列化**——不要用默认的 JDK 序列化，Redis CLI 看到的是乱码
7. **缓存空值**——防止缓存穿透，设置较短过期时间
8. **热数据不过期**——对极热数据（如配置项）不设过期时间，通过主动更新维护一致性
