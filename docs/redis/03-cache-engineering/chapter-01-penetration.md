# 缓存穿透

> 缓存穿透指查询一个「缓存和数据库都不存在」的数据。这类请求每次都穿透缓存直达数据库，当被恶意或异常地大量发起时，会把数据库打垮。本章讲解穿透的成因、三种解法，以及如何在 Spring Boot 中落地组合防御。

## 1. 问题

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

## 2. 布隆过滤器

布隆过滤器（Bloom Filter）用于「快速判断一个 key 是否可能存在」——查询前先过滤掉必然不存在的 key。

### 2.1 原理

布隆过滤器是一个位数组 + 多个哈希函数：

```text
插入元素 x：
  用 k 个哈希函数对 x 求值，得到 k 个位置，把这 k 个位置都置为 1

查询元素 y：
  同样求 k 个位置，若所有位置都是 1，则「可能存在」
  若任意一个位置是 0，则「必然不存在」
```

### 2.2 特性

| 特性 | 说明 |
| :-- | :-- |
| 空间高效 | 固定大小的位数组，不存元素本身 |
| 必然不存在 | 判「不存在」100% 准确 |
| 可能误判 | 判「存在」有误判率（把不存在误判为存在） |
| 不可删除 | 传统布隆过滤器不支持删除元素 |

### 2.3 Redisson 实现

Redis 通过 RedisBloom 模块提供原生布隆过滤器，Java 项目中更常用的是 Redisson 内置实现，无需额外安装模块。

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

### 2.4 布隆过滤器的维护

布隆过滤器不是一劳永逸的，需要在数据变更时同步更新：

| 场景 | 操作 |
| :-- | :-- |
| 新增数据 | 写入数据库的同时调用 `bloomFilter.add()` |
| 删除数据 | 传统布隆过滤器不支持删除，需使用 Counting Bloom Filter 或定期重建 |
| 数据迁移 | 批量初始化时调用 `bloomFilter.add()` 批量写入 |

> 实际项目中，常见做法是在项目启动时从数据库全量加载一次布隆过滤器，之后通过监听 Binlog 或在 Service 层埋点来增量更新。

### 2.5 用法

在查缓存前先过布隆过滤器：

![布隆过滤器拦截流程](/redis/03-cache-engineering-chapter-01-penetration-2.svg)

布隆过滤器拦截了大部分「不存在」的请求，只有少数「可能存在的误判」会继续查缓存和数据库。

## 3. 缓存空值

缓存空值指「把不存在的查询结果（空值）也写入缓存」——这样下一次相同请求就能命中缓存，不再穿透。

```bash
SET cache:user:9999 "" EX 60   # 不存在的 key 缓存空字符串，60 秒过期
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

## 4. 组合防御：分层拦截

生产环境中，单一方案往往不够。推荐「布隆过滤器 + 缓存空值」组合使用，形成三层拦截：

```text
请求进入
  → 第一层：布隆过滤器（拦截必然不存在，零成本）
  → 第二层：缓存（命中直接返回）
  → 第三层：数据库（查到回填缓存，查不到回填空值）
```

| 层级 | 拦截目标 | 成本 |
| :-- | :-- | :-- |
| 布隆过滤器 | 所有不存在的 key（99%+） | 一次内存位运算，极低 |
| 缓存空值 | 少量漏网的不存在 key | 一次 Redis GET，低 |
| 数据库 | 真实存在的 key | 一次 SQL 查询，高 |

这个分层方案的核心思想是：**让尽可能多的请求在最便宜的层被拦住**。布隆过滤器挡住绝大部分，缓存空值兜住漏网之鱼，只有真正需要查库的请求才到达数据库。

## 5. 方案对比

| 维度 | 布隆过滤器 | 缓存空值 | 组合防御 |
| :-- | :-- | :-- | :-- |
| 实现复杂度 | 较高（需引入模块/客户端） | 低（几行代码） | 中等 |
| 内存占用 | 固定，与 key 数量无关 | 与空值 key 数量成正比 | 两者之和 |
| 误判 | 有（不存在误判为存在） | 无 | 无（空值兜底） |
| 数据一致性 | 好（不缓存数据本身） | 可能短暂不一致 | 可能短暂不一致 |
| 防护效果 | 强 | 一般 | 最强 |
| 适用场景 | 大规模、key 空间巨大 | 小规模、简单场景 | 生产环境推荐 |

选型建议：

- key 空间大、追求极致防护 → 布隆过滤器
- 场景简单、快速上线 → 缓存空值
- 生产环境 → 组合防御（推荐）
