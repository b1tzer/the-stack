# 缓存抽象

> 核心问题：Spring Cache 如何用注解给方法加缓存？注解为什么能生效？它提供了哪些能力？

## 1. 缓存的本质：数据库的副本

缓存是数据库的一份临时副本。查询命中缓存，本质是"副本与数据库此刻一致，用更快的路径返回"；缓存失效，本质是"副本过期或不存在，回源数据库重建副本"。

副本一旦失效，就会出现穿透、击穿、雪崩三类事故。这三类问题及完整解法已在 [缓存失效：穿透·击穿·雪崩](../../scenarios/01-cache/chapter-01-cache-invalidation.md) 专门讲解，本文不重复，只在 [§4.3](#sync) 点出 Spring 自带的防护入口。

## 2. 缓存如何生效：AOP + CacheManager

注解为什么能让方法"自动"缓存？靠 AOP。`@EnableCaching` 开启后，标注了缓存注解的方法会被代理拦截：

```java
@Configuration
@EnableCaching
public class CacheConfig { }
```

```text
调用 findById(id)
  → 生成缓存 Key
  → 从 CacheManager 取出对应的 Cache（如 Redis）
  → 命中：直接返回缓存值，不执行方法体
  → 未命中：执行方法体 → 结果写入 Cache → 返回
```

两个核心抽象：

| 抽象 | 职责 |
| :-- | :-- |
| `CacheManager` | 管理一组 `Cache`，如 `RedisCacheManager` |
| `Cache` | 单个缓存的读写接口，如 `RedisCache` |

内置实现是 `ConcurrentMapCacheManager`（内存缓存）；接入 Redis 时换成 `RedisCacheManager`，注解代码一行不改——这正是"缓存抽象"的含义：**调用方只面向 `Cache` 接口编程，缓存实现可替换。**

## 3. 三大核心注解：读、写、删

```java
@Service
public class ProductService {

    private final ProductRepository repository;

    public ProductService(ProductRepository repository) {
        this.repository = repository;
    }

    // @Cacheable：命中则返回缓存，未命中则执行方法并缓存结果
    @Cacheable(value = "products", key = "#id")
    public Product findById(Long id) {
        return repository.findById(id).orElse(null);
    }

    // @CachePut：每次都执行方法，用返回值更新缓存
    @CachePut(value = "products", key = "#product.id")
    public Product update(Product product) {
        return repository.save(product);
    }

    // @CacheEvict：执行方法后删除缓存
    @CacheEvict(value = "products", key = "#id")
    public void delete(Long id) {
        repository.deleteById(id);
    }
}
```

| 注解 | 是否执行方法 | 读缓存 | 写缓存 | 典型场景 |
| :-- | :-- | :-- | :-- | :-- |
| `@Cacheable` | 仅未命中时 | ✅ | 未命中时写入 | 查询 |
| `@CachePut` | 每次执行 | ❌ | ✅ 每次更新 | 更新 |
| `@CacheEvict` | 每次执行 | ❌ | ✅ 删除 | 删除/失效 |

> ⚠️ **自调用失效**：注解靠 AOP 代理生效。若在同类方法内用 `this.findById(...)` 调用，走的是原始对象而非代理，缓存注解不生效。需要缓存的方法应通过注入的 Bean 调用。

## 4. 注解的完整能力

三个注解是基础，围绕它们还有一组能力。

### 4.1 @Caching：组合多个操作

一次操作同时影响多个缓存：

```java
@Caching(
    evict = {
        @CacheEvict(value = "users", key = "#id"),
        @CacheEvict(value = "userList", allEntries = true)
    }
)
public void clearUserCache(Long id) { }
```

### 4.2 condition 与 unless：条件缓存

```java
// condition：不满足则完全不走缓存（调用前评估）
@Cacheable(value = "products", key = "#id", condition = "#id > 0")
public Product findById(Long id) {
    return repository.findById(id).orElse(null);
}

// unless：满足则不缓存结果（调用后评估，只影响"写"这一步）
@Cacheable(value = "products", key = "#id", unless = "#result == null")
public Product findById(Long id) {
    return repository.findById(id).orElse(null);
}
```

| 属性 | 评估时机 | 作用 | 常见用法 |
| :-- | :-- | :-- | :-- |
| `condition` | 方法调用前 | 不满足则完全跳过缓存 | `#id > 0` |
| `unless` | 方法调用后 | 满足则不缓存结果 | `#result == null` |

> ⚠️ `unless = "#result == null"` 表示"结果为 null 时不缓存"，即**不缓存空值**。默认（不写 `unless`）会把 null 也缓存起来，起到防穿透的作用；是否缓存空值由 `unless` 决定。

### 4.3 sync：单线程回源 {#sync}

`@Cacheable(sync = true)` 让同一个 Key 只允许一个线程回源执行方法，其余线程等待缓存结果，避免瞬时并发打穿数据库：

```java
@Cacheable(value = "products", key = "#id", sync = true)
public Product findById(Long id) {
    return repository.findById(id).orElse(null);
}
```

> 📖 `sync` 是 Spring Cache 自带的击穿防护入口。更完整的穿透 / 击穿 / 雪崩解法（布隆过滤器、互斥锁、TTL 随机化）见 [缓存失效：穿透·击穿·雪崩](../../scenarios/01-cache/chapter-01-cache-invalidation.md)。

### 4.4 @CacheConfig：类级默认配置

同一类里多个方法反复写 `cacheNames` 显得冗余，用 `@CacheConfig` 统一声明：

```java
@Service
@CacheConfig(cacheNames = "products")
public class ProductService {

    @Cacheable(key = "#id")
    public Product findById(Long id) {
        return repository.findById(id).orElse(null);
    }

    @CacheEvict(key = "#id")
    public void delete(Long id) {
        repository.deleteById(id);
    }
}
```

方法上的属性会覆盖类级配置；`@CacheConfig` 不提供 `key` 默认值，每个注解仍需各自指定 `key`。

## 5. Key 生成策略

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
        return (target, method, params) ->
            target.getClass().getSimpleName()
                + ":" + method.getName()
                + ":" + Arrays.deepHashCode(params);
    }
}

@Cacheable(value = "products", keyGenerator = "customKeyGenerator")
public List<Product> search(String keyword, int page, int size) {
    return repository.search(keyword, PageRequest.of(page, size));
}
```

SpEL 常用变量：

| 变量 | 含义 | 示例 |
| :-- | :-- | :-- |
| `#参数名` | 方法参数 | `#id`, `#username` |
| `#result` | 方法返回值（仅 `unless`/`condition` 可用） | `#result.size() > 0` |
| `#root.method` | 当前方法 | `#root.method.name` |
| `#root.target` | 目标对象 | `#root.target.class.simpleName` |
| `T(类名)` | 调用静态方法 | `T(System).currentTimeMillis()` |

> ⚠️ `#result` 只能在 `unless` 和 `condition` 中使用，不能在 `key` 中使用——Key 在方法执行前就要确定，此时还没有返回值。

## 6. Redis 集成与序列化

```java
@Configuration
@EnableCaching
public class CacheConfig {

    @Bean
    public RedisCacheManager cacheManager(RedisConnectionFactory factory) {
        RedisCacheConfiguration defaultConfig = RedisCacheConfiguration.defaultCacheConfig()
                .entryTtl(Duration.ofSeconds(600))
                .serializeKeysWith(RedisSerializationContext.SerializationPair
                        .fromSerializer(new StringRedisSerializer()))
                .serializeValuesWith(RedisSerializationContext.SerializationPair
                        .fromSerializer(new GenericJackson2JsonRedisSerializer()))
                .disableCachingNullValues();

        Map<String, RedisCacheConfiguration> configMap = new HashMap<>();
        configMap.put("products", defaultConfig.entryTtl(Duration.ofMinutes(30)));
        configMap.put("users", defaultConfig.entryTtl(Duration.ofHours(1)));

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

> ⚠️ 用 `JdkSerializationRedisSerializer`（默认）存的缓存，用 Redis CLI 看到的是乱码。生产环境务必配置 JSON 序列化。

## 7. 缓存一致性：Cache Aside

数据更新时，缓存副本需要失效。业界主流是 Cache Aside 模式——**先更新数据库，再删除缓存**：

```java
@Service
public class UserService {

    @Transactional
    @CacheEvict(value = "users", key = "#id")
    public User updateUser(Long id, UserUpdateDTO dto) {
        User user = userRepository.findById(id).orElseThrow();
        user.setName(dto.getName());
        user.setEmail(dto.getEmail());
        return userRepository.save(user);
    }
}
```

`@CacheEvict` 默认在方法**成功返回后**删除缓存；若方法抛异常或事务回滚，则缓存不会被删，下次仍读到旧值——这正是"先更新 DB 再删缓存"要的语义。

为什么不是"先删缓存再更新 DB"？并发时序对比：

```text
先删缓存，再更新 DB：
  A 删缓存 → B 读 miss 读旧值写回 → A 更新 DB → 缓存是旧值

先更新 DB，再删缓存：
  A 读 miss 读旧值 → B 更新 DB 并删缓存 → A 写回旧值 → 缓存是旧值
```

两种都存在窗口，但"先更新 DB 再删缓存"的窗口更小（读旧值发生在更新之前），因此更常用。对一致性要求更高的场景，可用"延迟双删"（删除后短暂延迟再删一次）兜底。

## 8. 最佳实践

1. **先更新 DB，再删缓存**——Cache Aside 是业界主流方案
2. **注解方法通过 Bean 调用**——同类内 `this.xxx()` 调用会绕过代理，注解失效
3. **key 命名规范**——`业务:对象:ID`，如 `user:detail:10086`
4. **JSON 序列化**——不要用默认 JDK 序列化，Redis CLI 看到的是乱码
5. **监控缓存命中率**——命中率持续偏低说明缓存策略需要优化
6. **热数据用本地缓存**——Caffeine 等本地缓存比远程 Redis 更快
