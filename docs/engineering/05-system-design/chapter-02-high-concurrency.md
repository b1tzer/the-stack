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
// 传统同步模型：一个请求占一个工作线程，线程是昂贵资源
// Tomcat 默认 200 工作线程，同步模型下最多同时处理约 200 个请求
// （异步 Servlet 可在等待期间释放工作线程，不受此上限约束）
@GetMapping("/order/{id}")
public Order getOrder(@PathVariable Long id) {
    Order order = orderService.findById(id);     // 线程阻塞等待 DB
    User user = userService.getUser(order.getUserId()); // 线程阻塞等待 RPC
    return enrichOrder(order, user);
}

// 响应式模型（WebFlux）：非阻塞 IO + 异步信号，等待期间不占用工作线程
// 前提是链路中的数据库、RPC 调用都采用非阻塞实现
@GetMapping("/order/{id}")
public Mono<Order> getOrder(@PathVariable Long id) {
    return orderService.findById(id)
        .flatMap(order -> userService.getUser(order.getUserId())
            .map(user -> enrichOrder(order, user)));
}
```

响应式（WebFlux）和虚拟线程是两种不同的模型，不能混为一谈：

- **响应式**：非阻塞 IO 加异步信号，等待期间释放工作线程，但要求全链路非阻塞，混入阻塞式 JDBC 调用仍会占住线程。
- **虚拟线程**：代码仍是同步阻塞写法，在支持卸载的阻塞操作中阻塞时，虚拟线程从载体线程卸载、不占用 OS 线程；但部分场景（如 synchronized 内、部分 native 调用）会发生 pinning，无法及时卸载。可创建的虚拟线程数量大，但不等于系统可承载的请求数，数据库连接池等下游资源仍是上限。

## 2. 流量模型

在设计高并发系统之前，必须先**量化你的流量**。拍脑袋说"我们要扛住高并发"是不负责任的。

### 2.1 三个核心指标

| 指标 | 全称 | 含义 | 举例 |
| :-- | :-- | :-- | :-- |
| **QPS** | Queries Per Second | 每秒查询数（通常指读） | 首页 QPS = 5000 |
| **TPS** | Transactions Per Second | 每秒事务数（通常指写） | 下单 TPS = 500 |
| **RT** | Response Time | 响应时间（毫秒） | 接口 RT = 50ms |

### 2.2 核心经验公式

估算并发压力，用 Little 定律：

```txt
平均在途请求数 = QPS × RT（秒）
```

推导过程：

- 假设 QPS = 1000，每个请求处理时间 RT = 100ms = 0.1s
- 在任意时刻，系统中同时在处理的请求数 = 1000 × 0.1 = 100
- 这是在途请求数的估算，不是必须配置 100 个线程

注意区分两个概念：在途请求可能正在执行 CPU 计算，也可能阻塞等待数据库、网络等资源。平均在途请求数不等于所需线程数，线程数还需结合 CPU 核数、阻塞等待时间占比、下游连接池上限等因素综合确定。

**实际应用**：

```txt
场景：某电商秒杀活动预估

秒杀开始瞬间峰值 QPS = 50,000
商品详情接口 RT = 20ms = 0.02s
平均在途请求数 = 50,000 × 0.02 = 1,000

下单接口 RT = 200ms = 0.2s（涉及库存扣减、订单创建）
平均在途请求数 = 50,000 × 0.2 = 10,000

结论：下单接口压力最大，需要缓存拦截大部分请求，
      真正到达下单接口的 QPS 控制在 1,000 以内
```

### 2.3 容量规划公式

```txt
所需机器数 = 峰值 QPS / 单机可持续 QPS

单机可持续 QPS = 平均在途请求数 / 平均 RT(秒)
```

这个公式表达的是理论关系，不是直接的配置工具。实际单机可持续 QPS 受 CPU 核数、IO 等待比例、下游连接池上限、延迟目标和压测结果共同制约，需要以压测数据为准，而不是用公式反推线程池大小。线程数也不等于实际平均在途请求数，只有在请求确实由这些工作线程同步处理、线程充分占用时才近似成立。

```java
// 示例：评估 Tomcat 线程池配置
// 机器配置：4C8G
// 平均接口 RT：50ms
// 压测得到单机可持续 QPS 约 2,800（CPU 利用率约 70%，留余量应对突发）

// Tomcat 默认 200 个工作线程，是工作线程数上限，不是并发上限
// 同步模型下 200 线程对应约 200 个在途请求
// 单机 QPS = 200 / 0.05 = 4,000 是理论上限，实际受 CPU、连接池制约约为 2,800

// 如果峰值 QPS = 20,000
// 所需机器数 = 20,000 / 2,800 ≈ 8 台（向上取整）
// 再预留容量余量，应对单机故障、滚动发布期间的容量损失，实际部署 10 台
```

## 3. 水平扩展与无状态设计

应对高并发最直接的方式是**加机器**。但加机器的前提是系统能水平扩展。

### 3.1 垂直扩展 vs 水平扩展

| 维度 | 垂直扩展（Scale Up） | 水平扩展（Scale Out） |
| :-- | :-- | :-- |
| 方式 | 升级单机配置（加 CPU、加内存） | 增加机器数量 |
| 上限 | 物理极限（单机最多多少核多少内存） | 可近似线性扩展，但受共享依赖与运维成本制约 |
| 成本 | 非线性增长（高端硬件溢价） | 线性增长 |
| 复杂度 | 低（不用改代码） | 高（需要无状态、分布式） |
| 容错 | 单点故障 | 单实例故障时其余实例可继续服务，前提是剩余容量充足 |
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

表中的比例是示例值，实际效果取决于缓存命中率、请求分布、资源类型和访问模式，并非通用预期。

### 4.3 每层的工程实践

#### 4.3.1 网关层：限流

```java
// 令牌桶限流（使用 Guava RateLimiter）
@RestController
public class FlashSaleController {

    // 每秒放行 1000 个请求
    private final RateLimiter rateLimiter = RateLimiter.create(1000);

    @PostMapping("/flash-sale/{itemId}")
    public ResponseEntity<String> flashSale(@PathVariable Long itemId) {
        // 尝试获取令牌，最多等待 200ms
        if (!rateLimiter.tryAcquire(200, TimeUnit.MILLISECONDS)) {
            return ResponseEntity.status(HttpStatus.TOO_MANY_REQUESTS)
                .body("系统繁忙，请稍后再试");
        }
        return ResponseEntity.ok(flashSaleService.flashSale(itemId));
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

**秒杀场景选令牌桶**：令牌桶允许短时突发（突发额度取决于桶容量配置），让真实用户能在秒杀瞬间提交请求，而不是被强制匀速拖慢。但秒杀的核心是保护库存、订单等下游资源，如果目标是让下游匀速消化请求，漏桶的流量整形同样适用，选型取决于保护对象，不是单纯的"用户体验"。

**API 限流选滑动窗口**：需要精确控制"每分钟最多 100 次调用"，滑动窗口能避免固定窗口在窗口交替瞬间的计数突刺（固定窗口在交替瞬间允许 2 倍流量）。

实际项目中，Sentinel 的 QPS 限流底层基于滑动窗口计数，Guava RateLimiter 是基于令牌桶的平滑限速实现（SmoothBursty 允许突发、SmoothWarmingUp 带预热）。选型时看需求：要突发能力用令牌桶，要精确控制用滑动窗口。

滑动窗口限流的一个教学实现（仅说明算法原理，生产环境建议用 Sentinel 等成熟组件）：

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

这个实现有两个局限，不能直接用于生产：

- 它是单机限流，每个 JVM 实例各自计数，多个应用实例部署后无法协同完成全局限流。分布式全局限流需要共享计数器（如 Redis + Lua）或集中式限流方案，并权衡一致性、延迟和故障策略。
- TreeMap 按毫秒记录并在每次请求时遍历窗口内全部记录，高请求量下遍历开销和 synchronized 全局锁竞争会随时间戳数量增长。生产实现通常采用固定数量的时间桶等有界结构。

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

上面是读路径的多级缓存回填。写路径需要单独处理两级缓存的失效顺序和并发回填竞争，TTL 只能限制旧数据的存活时间，不能保证强一致性。

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
// 两个键使用相同的 hash tag {itemId}，确保在 Redis Cluster 中落在同一哈希槽
// stock:flash-sale:{itemId} = 库存数
// flash-sale:users:{itemId} = 已抢到的用户集合
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
public class FlashSaleService {

    @Autowired
    private StringRedisTemplate redisTemplate;

    @Autowired
    private RabbitTemplate rabbitTemplate;

    public String flashSale(Long itemId, Long userId) {
        // ⑤ Redis 原子扣减
        Long result = redisTemplate.execute(
            new DefaultRedisScript<>(LUA_SCRIPT, Long.class),
            List.of("stock:flash-sale:{" + itemId + "}", "flash-sale:users:{" + itemId + "}"),
            String.valueOf(userId)
        );

        if (result == -1) return "已售罄";
        if (result == -2) return "请勿重复抢购";

        // ⑥ 发送 MQ，异步创建订单
        FlashSaleMessage message = new FlashSaleMessage(itemId, userId);
        rabbitTemplate.convertAndSend("flash-sale.exchange", "flash-sale.order", message);

        return "已受理，订单创建中";
    }
}
```

这里 Redis 只是预扣库存，真正的订单创建异步进行。有几个一致性要点需要补全：

- MQ 发送失败时，库存已扣减但订单未创建。convertAndSend() 只表示消息"发出去了"，不是可靠交付。需要配合 RabbitMQ 发布确认、消费端幂等，以及对 Redis 预扣结果与订单状态的对账，失败时幂等补偿。
- 要区分两个概念：库存总量键（stock:flash-sale:{itemId}）是秒杀期间的库存计数，不能设置 TTL 或随意过期，否则库存数据丢失、重新初始化后可能超卖。订单超时未支付时，释放的是该笔订单对应的预占，需要单独记录预占关系（用户、数量、到期时间），并按业务规则幂等释放。
- 关于 Outbox：本地消息表或 Outbox 解决的是"数据库事务内写业务数据与写待发送消息"的原子性，但这里的 Redis 预扣与数据库不在同一事务，仅靠 Outbox 不能自动保证 Redis 预扣成功与消息记录成功原子提交，仍需对账和幂等补偿兜底。

返回"已受理"而非"抢购成功"，因为此刻订单尚未落库，只有订单服务确认创建成功后才是真正抢购成功。

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
