# 高并发设计

> 10 万 QPS 打进来，200 个 Tomcat 线程全部阻塞在数据库连接池上，每个请求等 50ms 拿不到连接，用户看到的是白屏。问题不在代码写得差，在于没算清楚资源账。本章回答：高并发的本质是什么？流量模型怎么算？水平扩展和无状态设计怎么落地？经典高并发架构的每一层各自解决什么问题？

## 1. 高并发问题本质

高并发不是"请求多"这么简单。本质问题是**有限资源的竞争**。理解资源瓶颈在哪里，才能对症下药。

### 1.1 四类资源竞争

| 资源 | 竞争表现 | 典型瓶颈 | 解决方向 |
| :-- | :-- | :-- | :-- |
| **CPU** | 计算密集，线程上下文切换频繁 | 加密解密、序列化、复杂计算 | 异步化、缓存结果、减少计算 |
| **内存** | 大对象堆积、频繁 GC | 大 List 加载、缓存穿透 | 分页、流式处理、合理缓存策略 |
| **磁盘 IO** | 日志写入、文件读写阻塞 | 同步写日志、大量小文件 | 异步写入、批量刷盘、SSD |
| **网络 IO** | 线程阻塞等待远程响应 | 数据库慢查询、第三方 API 超时 | 连接池、超时控制、熔断降级 |

### 1.2 一个请求的资源消耗链路

![concurrency-layered-arch](/java/concurrency-layered-arch.svg)

每一次请求都在消耗多种资源。高并发下，任何一种资源成为瓶颈，都会导致系统整体变慢甚至崩溃。

### 1.3 线程模型与资源消耗

```java
// 传统同步模型：一个请求占一个线程，线程是昂贵资源
// Tomcat 默认 200 线程，意味着最多同时处理 200 个请求
@GetMapping("/order/{id}")
public Order getOrder(@PathVariable Long id) {
    Order order = orderService.findById(id);     // 线程阻塞等待 DB
    User user = userService.getUser(order.getUserId()); // 线程阻塞等待 RPC
    return enrichOrder(order, user);
}

// 异步模型（WebFlux / Virtual Thread）：不阻塞线程
// 虚拟线程可以创建百万级，不再受 OS 线程数限制
@GetMapping("/order/{id}")
public Mono<Order> getOrder(@PathVariable Long id) {
    return orderService.findById(id)
        .flatMap(order -> userService.getUser(order.getUserId())
            .map(user -> enrichOrder(order, user)));
}
```

## 2. 流量模型

在设计高并发系统之前，必须先**量化你的流量**。拍脑袋说"我们要扛住高并发"是不负责任的。

### 2.1 三个核心指标

| 指标 | 全称 | 含义 | 举例 |
| :-- | :-- | :-- | :-- |
| **QPS** | Queries Per Second | 每秒查询数（通常指读） | 首页 QPS = 5000 |
| **TPS** | Transactions Per Second | 每秒事务数（通常指写） | 下单 TPS = 500 |
| **RT** | Response Time | 响应时间（毫秒） | 接口 RT = 50ms |

### 2.2 核心经验公式

```txt
并发线程数 = QPS × RT（秒）
```

推导过程：

- 假设 QPS = 1000，每个请求处理时间 RT = 100ms = 0.1s
- 在任意时刻，系统中同时在处理的请求数 = 1000 × 0.1 = 100
- 所以需要至少 100 个并发线程

**实际应用**：

```txt
场景：某电商秒杀活动预估

秒杀开始瞬间峰值 QPS = 50,000
商品详情接口 RT = 20ms = 0.02s
所需并发线程数 = 50,000 × 0.02 = 1,000

下单接口 RT = 200ms = 0.2s（涉及库存扣减、订单创建）
所需并发线程数 = 50,000 × 0.2 = 10,000

结论：下单接口是瓶颈，需要缓存拦截大部分请求，
      真正到达下单接口的 QPS 控制在 1,000 以内
```

### 2.3 容量规划公式

```txt
所需机器数 = 峰值 QPS / 单机 QPS 承载能力

单机 QPS = 并发线程数 / 平均 RT(秒)
         = (线程池大小 × CPU 利用率目标) / 平均 RT(秒)
```

```java
// 示例：评估 Tomcat 线程池配置
// 机器配置：4C8G
// 目标 CPU 利用率：70%（留 30% 余量应对突发）
// 平均接口 RT：50ms

// Tomcat 默认线程数 200
// 理论单机 QPS = 200 / 0.05 = 4,000
// 但实际要考虑 CPU 利用率，有效 QPS ≈ 4,000 × 0.7 = 2,800

// 如果峰值 QPS = 20,000
// 所需机器数 = 20,000 / 2,800 ≈ 8 台（向上取整，建议冗余 20%）
// 实际部署 10 台
```

## 3. 水平扩展与无状态设计

应对高并发最直接的方式是**加机器**。但加机器的前提是系统能水平扩展。

### 3.1 垂直扩展 vs 水平扩展

| 维度 | 垂直扩展（Scale Up） | 水平扩展（Scale Out） |
| :-- | :-- | :-- |
| 方式 | 升级单机配置（加 CPU、加内存） | 增加机器数量 |
| 上限 | 物理极限（单机最多多少核多少内存） | 理论无上限 |
| 成本 | 非线性增长（高端硬件溢价） | 线性增长 |
| 复杂度 | 低（不用改代码） | 高（需要无状态、分布式） |
| 容错 | 单点故障 | 任意一台挂不影响整体 |
| 推荐 | 早期、数据库层 | 应用层、缓存层 |

```txt
垂直扩展                          水平扩展

  ┌─────────────┐              ┌───────┐ ┌───────┐ ┌───────┐
  │   4C 8G     │              │ 2C 4G │ │ 2C 4G │ │ 2C 4G │
  │  ──────→    │              │       │ │       │ │       │
  │   8C 16G    │              │       │ │       │ │       │
  │  ──────→    │              └───┬───┘ └───┬───┘ └───┬───┘
  │   16C 32G   │                  │         │         │
  └─────────────┘              ┌───▼─────────▼─────────▼───┐
    单机越来越强                 │        负载均衡器          │
                               └───────────────────────────┘
                                  机器越多越强
```

### 3.2 无状态设计

水平扩展的前提是**应用服务无状态**——任何一台机器都能处理任何请求，不依赖本地状态。

```java
// ❌ 有状态：Session 存在本地 JVM 内存
// 如果用户第一次请求打到 A 机，Session 在 A 的内存里
// 第二次请求打到 B 机，B 找不到 Session，用户被踢出登录
@RestController
public class UserController {
    
    @PostMapping("/login")
    public String login(HttpSession session, @RequestBody LoginRequest req) {
        User user = userService.authenticate(req);
        session.setAttribute("currentUser", user); // 存在本地 JVM
        return "登录成功";
    }
    
    @GetMapping("/profile")
    public User profile(HttpSession session) {
        return (User) session.getAttribute("currentUser"); // 只能在同一台机器读到
    }
}

// ✅ 无状态：Session 外置到 Redis
// 所有机器共享同一个 Session 存储，任何机器都能处理任何请求
@RestController
public class UserController {
    
    @PostMapping("/login")
    public String login(@RequestBody LoginRequest req, HttpServletResponse response) {
        User user = userService.authenticate(req);
        String token = jwtUtil.generateToken(user.getId());
        // Token 无状态，不需要服务端 Session
        response.setHeader("Authorization", "Bearer " + token);
        return "登录成功";
    }
    
    @GetMapping("/profile")
    public User profile(@RequestHeader("Authorization") String token) {
        Long userId = jwtUtil.parseToken(token);
        return userService.getById(userId);
    }
}
```

### 3.3 Session 外置到 Redis

如果必须使用服务端 Session（如 Spring Security），则外置到 Redis：

```yaml
# application.yml - Spring Session 配置
spring:
  session:
    store-type: redis
    redis:
      host: redis-cluster.example.com
      port: 6379
    timeout: 30m

# 依赖引入
# spring-session-data-redis
```

```java
// 代码不用改，Spring Session 自动将 HttpSession 序列化到 Redis
// 请求打到任何一台机器，都能从 Redis 获取 Session
@RestController
public class OrderController {
    
    @GetMapping("/cart")
    public List<CartItem> getCart(HttpSession session) {
        // 这个 Session 实际存储在 Redis 中，不是本地 JVM
        return (List<CartItem>) session.getAttribute("cart");
    }
}
```

## 4. 高并发经典架构

高并发不是某一层能解决的问题，而是**逐层消峰、逐层保护**的系统工程。

### 4.1 全链路架构

![concurrency-layered-arch](/java/concurrency-layered-arch.svg)

### 4.2 各层职责与消峰效果

| 层级 | 职责 | 消峰手段 | 预期效果 |
| :-- | :-- | :-- | :-- |
| CDN | 静态资源加速 | 就近缓存，不回源 | 消除 60-80% 静态请求 |
| 网关 | 统一入口管控 | 令牌桶限流、熔断、降级 | 拦截超量请求，保护后端 |
| 应用服务 | 业务逻辑处理 | 本地缓存、异步化 | 分散压力，提高吞吐 |
| 缓存层 | 热点数据缓存 | Redis 集群、多级缓存 | 拦截 80-95% 读请求 |
| 数据库 | 持久化存储 | 主从分离、分库分表 | 最终承受的请求量大幅减少 |

### 4.3 每层的工程实践

#### 4.3.1 网关层：限流

```java
// 令牌桶限流（使用 Guava RateLimiter）
@RestController
public class SeckillController {

    // 每秒放行 1000 个请求
    private final RateLimiter rateLimiter = RateLimiter.create(1000);

    @PostMapping("/seckill/{itemId}")
    public ResponseEntity<String> seckill(@PathVariable Long itemId) {
        // 尝试获取令牌，最多等待 200ms
        if (!rateLimiter.tryAcquire(200, TimeUnit.MILLISECONDS)) {
            return ResponseEntity.status(HttpStatus.TOO_MANY_REQUESTS)
                .body("系统繁忙，请稍后再试");
        }
        return ResponseEntity.ok(seckillService.seckill(itemId));
    }
}
```

#### 4.3.2 为什么用令牌桶而不是漏桶？

你可能注意到了，上面用的是 Guava RateLimiter——它背后是令牌桶算法。但限流算法不止一种，选错了会出问题。比如秒杀场景用漏桶（强制匀速），用户会骂街；API 限流用固定窗口（按分钟计数），窗口交替瞬间可能放过两倍流量。

| 算法 | 原理 | 是否允许突发 | 适用场景 |
| :-- | :-- | :---: | :-- |
| **令牌桶** | 桶中放令牌，请求取令牌才能通过 | ✅ 允许 | 通用限流，允许短时突发 |
| **漏桶** | 请求进入桶，匀速流出 | ❌ 强制匀速 | 流量整形，保护下游 |
| **滑动窗口** | 按时间窗口统计请求数 | ❌ 精确控制 | API 精确限流 |
| **固定窗口** | 按固定时间段统计 | ⚠️ 有边界突刺 | 简单场景 |

**秒杀场景选令牌桶**：允许用户在前 100ms 内集中提交（突发），然后匀速放行。如果用漏桶，所有请求被强制匀速，用户体验差。

**API 限流选滑动窗口**：需要精确控制"每分钟最多 100 次调用"，滑动窗口没有固定窗口的"边界突刺"问题（窗口交替瞬间允许 2 倍流量）。

实际项目中，Sentinel 默认使用滑动窗口，Guava RateLimiter 使用令牌桶。选型时看需求：要突发能力用令牌桶，要精确控制用滑动窗口。

滑动窗口限流的一个完整实现：

```java
class SlidingWindowRateLimiter {
    private final int maxRequests;
    private final long windowMillis;
    private final TreeMap<Long, Integer> requests = new TreeMap<>();

    SlidingWindowRateLimiter(int maxRequests, long windowSeconds) {
        this.maxRequests = maxRequests;
        this.windowMillis = windowSeconds * 1000;
    }

    public synchronized boolean tryAcquire() {
        long now = System.currentTimeMillis();
        long windowStart = now - windowMillis;
        // 丢弃窗口之外的记录
        requests.headMap(windowStart).clear();
        int count = requests.values().stream().mapToInt(Integer::intValue).sum();
        if (count < maxRequests) {
            requests.merge(now, 1, Integer::sum);
            return true;
        }
        return false;
    }
}
```

#### 4.3.3 缓存层：多级缓存

```java
// 本地缓存 → Redis → 数据库，逐级穿透
@Service
public class ProductService {

    // L1：本地缓存（Caffeine，JVM 内存，最快但容量有限）
    private final Cache<String, Product> localCache = Caffeine.newBuilder()
        .maximumSize(10_000)
        .expireAfterWrite(1, TimeUnit.MINUTES)
        .build();

    // L2：Redis（分布式缓存，容量大，跨机器共享）
    @Autowired
    private RedisTemplate<String, Product> redisTemplate;

    @Autowired
    private ProductRepository productRepository;

    public Product getProduct(String productId) {
        // L1: 本地缓存
        Product product = localCache.getIfPresent(productId);
        if (product != null) {
            return product;
        }

        // L2: Redis
        String redisKey = "product:" + productId;
        product = redisTemplate.opsForValue().get(redisKey);
        if (product != null) {
            localCache.put(productId, product); // 回填 L1
            return product;
        }

        // L3: 数据库
        product = productRepository.findById(productId)
            .orElseThrow(() -> new ProductNotFoundException(productId));

        // 回填缓存
        redisTemplate.opsForValue().set(redisKey, product, 30, TimeUnit.MINUTES);
        localCache.put(productId, product);

        return product;
    }
}
```

#### 4.3.4 数据库层：读写分离

```yaml
# Spring 配置：读写分离数据源
spring:
  datasource:
    master:
      url: jdbc:mysql://master:3306/db
      username: rw_user
    slave:
      url: jdbc:mysql://slave:3306/db
      username: ro_user
```

```java
// 使用 AbstractRoutingDataSource 实现动态数据源切换
public class ReadWriteRoutingDataSource extends AbstractRoutingDataSource {

    @Override
    protected Object determineCurrentLookupKey() {
        return ReadWriteContext.isRead() ? "slave" : "master";
    }
}

// 注解方式标记读写
@Target({ElementType.METHOD})
@Retention(RetentionPolicy.RUNTIME)
public @interface ReadOnly {}

// AOP 自动切换数据源
@Aspect
@Component
public class DataSourceAspect {

    @Before("@annotation(readOnly)")
    public void setReadDataSource(ReadOnly readOnly) {
        ReadWriteContext.setRead();
    }

    @After("@annotation(readOnly)")
    public void clear(ReadOnly readOnly) {
        ReadWriteContext.clear();
    }
}

// 使用
@Service
public class OrderQueryService {

    @ReadOnly
    public OrderDTO getOrder(Long orderId) {
        // 自动走从库
        return orderRepository.findById(orderId);
    }
}
```

### 4.4 经典秒杀架构

秒杀是高并发的极端场景，需要全链路协同：

```txt
                    ┌─────────────────────────────┐
                    │        用户浏览器/APP         │
                    │   前端静态化 + 按钮防重复点击   │
                    └──────────────┬──────────────┘
                                   │
                                   ▼
                    ┌─────────────────────────────┐
                    │          CDN 层             │
                    │   静态页面 + 倒计时 JS 缓存    │
                    └──────────────┬──────────────┘
                                   │
                                   ▼
                    ┌─────────────────────────────┐
                    │          网关层              │
                    │   ① 令牌桶限流（总 QPS 上限）  │
                    │   ② 用户身份校验              │
                    │   ③ 恶意请求过滤              │
                    └──────────────┬──────────────┘
                                   │
                                   ▼
                    ┌─────────────────────────────┐
                    │       秒杀服务（前置过滤）      │
                    │   ④ 本地缓存判断库存           │
                    │   ⑤ Redis 原子扣减库存        │
                    │   ⑥ 发送 MQ 消息             │
                    └──────────────┬──────────────┘
                                   │ MQ 异步
                                   ▼
                    ┌─────────────────────────────┐
                    │       订单服务（异步处理）      │
                    │   ⑦ 创建订单                 │
                    │   ⑧ 扣减数据库库存            │
                    │   ⑨ 支付超时回滚              │
                    └─────────────────────────────┘
```

```java
// Redis 原子扣减库存（Lua 脚本保证原子性）
// stock:seckill:{itemId} = 库存数
// seckill:users:{itemId} = 已抢到的用户集合
private static final String LUA_SCRIPT = """
    local stock = tonumber(redis.call('GET', KEYS[1]))
    if stock == nil or stock <= 0 then
        return -1  -- 库存不足
    end
    local exists = redis.call('SISMEMBER', KEYS[2], ARGV[1])
    if exists == 1 then
        return -2  -- 重复抢购
    end
    redis.call('DECR', KEYS[1])
    redis.call('SADD', KEYS[2], ARGV[1])
    return 1  -- 成功
    """;

@Service
public class SeckillService {

    @Autowired
    private StringRedisTemplate redisTemplate;

    @Autowired
    private RabbitTemplate rabbitTemplate;

    public String seckill(Long itemId, Long userId) {
        // ⑤ Redis 原子扣减
        Long result = redisTemplate.execute(
            new DefaultRedisScript<>(LUA_SCRIPT, Long.class),
            List.of("stock:seckill:" + itemId, "seckill:users:" + itemId),
            String.valueOf(userId)
        );

        if (result == -1) return "已售罄";
        if (result == -2) return "请勿重复抢购";

        // ⑥ 发送 MQ，异步创建订单
        SeckillMessage message = new SeckillMessage(itemId, userId);
        rabbitTemplate.convertAndSend("seckill.exchange", "seckill.order", message);

        return "抢购成功，正在创建订单";
    }
}
```

### 4.5 高并发设计 Checklist

| 防线 | 措施 | 工具/技术 |
| :-- | :-- | :-- |
| 前端 | 静态化、按钮防重、倒计时同步 | CDN、Nginx |
| 接入层 | 限流、熔断、降级 | Sentinel、Resilience4j、网关 |
| 应用层 | 本地缓存、异步化、池化 | Caffeine、线程池、CompletableFuture |
| 缓存层 | 热点缓存、缓存预热、防穿透 | Redis、Lua 脚本 |
| 消息层 | 削峰填谷、异步解耦 | RocketMQ、RabbitMQ、Kafka |
| 数据层 | 读写分离、分库分表 | ShardingSphere、MyCat |
| 兜底层 | 限流兜底、优雅降级 | 返回缓存数据、排队页面 |
