# Redis 集成（Spring Data Redis）

> 本章是 `RedisTemplate` / `StringRedisTemplate` 直接操作 Redis 数据结构的唯一权威章节。Redis 原生机制（数据结构、命令、持久化、集群）见 [Redis 专项](../../redis/01-data-model/chapter-01-overview)。

## 与缓存抽象的分工 {#redis-vs-caching}

- 本章讲 `RedisTemplate` 直接操作 Redis 数据结构的 API、序列化器、连接工厂、Lua 脚本执行。
- [Spring 缓存抽象](./chapter-11-caching.md) 讲 `@Cacheable` / `CacheManager`，以及把 Redis 作为缓存后端。

## 1. 依赖与配置 {#redis-dependency}

```xml
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-data-redis</artifactId>
</dependency>
```

```yaml
spring:
  data:
    redis:
      host: localhost
      port: 6379
      password:
      database: 0
      timeout: 3000ms
      lettuce:
        pool:
          max-active: 8
          max-idle: 8
          min-idle: 0
```

::: warning 版本锚点
Spring Boot 3.x 配置前缀是 `spring.data.redis.*`；2.x 是 `spring.redis.*`。本文示例统一用 3.x。
:::

引入 starter 后，Spring Boot 自动装配 `RedisConnectionFactory` 与 `RedisTemplate` / `StringRedisTemplate`，注入即可使用。

## 2. RedisTemplate 与序列化器 {#redis-template}

`RedisTemplate` 是操作 Redis 的入口，`StringRedisTemplate` 是它的字符串特化版本：

| 模板 | Key / Value 序列化器 | 适用场景 |
| :-- | :-- | :-- |
| `RedisTemplate<K, V>` | 默认 `JdkSerializationRedisSerializer` | 需自定义时再配置 |
| `StringRedisTemplate` | `StringRedisSerializer` | 只读写字符串，命令语义最直观 |

`RedisTemplate` 默认对 Key 和 Value 都用 JDK 序列化，存入 Redis 的是二进制乱码，命令行无法查看，也影响跨语言读取。生产环境通常自定义为「Key 字符串、Value JSON」：

```java
@Configuration
public class RedisConfig {

    @Bean
    public RedisTemplate<String, Object> redisTemplate(RedisConnectionFactory factory) {
        RedisTemplate<String, Object> template = new RedisTemplate<>();
        template.setConnectionFactory(factory);

        StringRedisSerializer stringSerializer = new StringRedisSerializer();
        template.setKeySerializer(stringSerializer);
        template.setHashKeySerializer(stringSerializer);

        GenericJackson2JsonRedisSerializer jsonSerializer = new GenericJackson2JsonRedisSerializer();
        template.setValueSerializer(jsonSerializer);
        template.setHashValueSerializer(jsonSerializer);

        template.afterPropertiesSet();
        return template;
    }
}
```

常用序列化器对比：

| 序列化器 | 可读性 | 跨语言 | 推荐场景 |
| :-- | :-- | :-- | :-- |
| `JdkSerializationRedisSerializer` | ❌ 二进制 | ❌ | 不推荐 |
| `StringRedisSerializer` | ✅ | ✅ | Key、纯字符串 |
| `GenericJackson2JsonRedisSerializer` | ✅ JSON | ✅ | 对象 Value（写入 `@class` 类型信息） |
| `Jackson2JsonRedisSerializer` | ✅ JSON | ✅ | 对象 Value（需显式指定类型，不带类型信息） |

五种数据结构的操作入口：

```java
redisTemplate.opsForValue().set("user:1", user, 5, TimeUnit.MINUTES); // String
redisTemplate.opsForHash().put("cart:1", "sku:100", 2);              // Hash
redisTemplate.opsForList().rightPush("queue", "task");               // List
redisTemplate.opsForSet().add("tags", "java", "redis");              // Set
redisTemplate.opsForZSet().add("rank", "user:1", 100);               // ZSet
```

## 3. 连接工厂与 Lettuce {#redis-connection}

Spring Boot 默认客户端是 Lettuce（Spring Boot 2.0 起），不再默认 Jedis。

| 客户端 | 底层实现 | 特点 |
| :-- | :-- | :-- |
| Lettuce | Netty，异步非阻塞 | 线程安全，单连接共享，支持响应式 |
| Jedis | 同步阻塞 | 每个连接独占，多线程需连接池 |

默认自动装配已够用，需要调超时、连接池时才手动配置：

```java
@Bean
public RedisConnectionFactory redisConnectionFactory() {
    RedisStandaloneConfiguration server = new RedisStandaloneConfiguration("localhost", 6379);
    server.setPassword("");

    LettuceClientConfiguration config = LettuceClientConfiguration.builder()
            .commandTimeout(Duration.ofSeconds(3))
            .shutdownTimeout(Duration.ofMillis(100))
            .build();

    return new LettuceConnectionFactory(server, config);
}
```

Lettuce 基于 Netty，单个连接即可在多线程间共享，不需要像 Jedis 那样按线程配置连接池。只有在对命令延迟有严格上限、需要限制并发连接数时，才引入 `commons-pool2` 并配置 `spring.data.redis.lettuce.pool.*`。

## 4. Lua 脚本执行 {#redis-lua}

Redis 单线程串行执行命令，Lua 脚本在服务端原子执行，天然适合「读改写」这类需要原子性的操作。Spring Data Redis 通过 `DefaultRedisScript` 封装：

```java
// 原子自增：INCRBY
DefaultRedisScript<Long> script = new DefaultRedisScript<>();
script.setScriptText("return redis.call('INCRBY', KEYS[1], ARGV[1])");
script.setResultType(Long.class);

Long result = redisTemplate.execute(script, List.of("counter"), "1");
```

参数约定：

| 参数 | 对应 Lua 变量 | 说明 |
| :-- | :-- | :-- |
| 第一个 `List` 参数 | `KEYS` | 操作的 Key，建议只传 Key |
| 后续可变参数 | `ARGV` | 附加参数，不建议传 Key |

把脚本放在资源文件里更清晰：

```java
@Bean
public DefaultRedisScript<Long> deductStockScript() {
    DefaultRedisScript<Long> script = new DefaultRedisScript<>();
    script.setLocation(new ClassPathResource("scripts/deduct_stock.lua"));
    script.setResultType(Long.class);
    return script;
}
```

```lua
-- scripts/deduct_stock.lua
-- KEYS[1] 库存 key，ARGV[1] 扣减数量
local stock = tonumber(redis.call('GET', KEYS[1]) or '0')
if stock < tonumber(ARGV[1]) then
    return -1
end
return redis.call('DECRBY', KEYS[1], ARGV[1])
```

```java
Long remain = redisTemplate.execute(deductStockScript, List.of("stock:1001"), "2");
if (remain == -1) {
    throw new RuntimeException("库存不足");
}
```

> 注意：Lua 脚本执行期间会阻塞 Redis 单线程，脚本必须短小、避免死循环或长时间遍历。脚本内容变更时，配合 `setResultType` 显式声明返回类型，避免默认按 `List` 解析。
