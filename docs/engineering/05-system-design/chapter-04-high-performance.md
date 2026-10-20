# 高性能设计

> **核心问题**：如何优化系统性能？数据库查询慢怎么办？如何利用缓存和 CDN？

## 1. 数据库性能优化

### 1.1 索引优化

```java
// 慢查询：没有索引
// SELECT * FROM orders WHERE user_id = 123 AND status = 'PAID';
// 执行计划：全表扫描

// 优化：添加联合索引
// CREATE INDEX idx_user_status ON orders(user_id, status);
// 执行计划：索引扫描

// 上面的「全表扫描 → 索引扫描」只是示意，实际扫描行数取决于数据分布、
// 统计信息、谓词选择性和优化器，必须用 EXPLAIN ANALYZE 核对真实执行计划

// 索引设计原则
// 1. 最左前缀原则：联合索引 (a, b, c) 可用于 a / a,b / a,b,c 查询
// 2. 覆盖索引：查询字段都在索引中，避免回表
// 3. 列顺序不只看选择性：要结合等值/范围条件、排序与分组、覆盖需求综合判断，
//    选择性只是因素之一，不能当作脱离查询模式的默认规则

// 反范例：索引失效
// WHERE YEAR(created_at) = 2024  ← 对索引列套函数，通常无法直接利用该列的普通索引
// 优化：WHERE created_at >= '2024-01-01' AND created_at < '2025-01-01'
```

> 索引列顺序与执行计划验证的完整边界见 [MySQL 索引设计](../../mysql/03-index/chapter-02-index-design.md)。

### 1.2 查询优化

```java
// 差：N+1 查询
List<Order> orders = orderRepository.findAll();
for (Order order : orders) {
    User user = userRepository.findById(order.getUserId());  // 每次循环都查 DB
    order.setUserName(user.getName());
}

// 好：批量查询
List<Order> orders = orderRepository.findAll();
Set<Long> userIds = orders.stream().map(Order::getUserId).collect(Collectors.toSet());
// 假设 user 存在且唯一，否则 get 前判空、toMap 用 merge 处理重复 key
Map<Long, User> userMap = userRepository.findByIdIn(userIds).stream()
    .collect(Collectors.toMap(User::getId, Function.identity()));
orders.forEach(o -> o.setUserName(userMap.get(o.getUserId()).getName()));

// 更好：使用 JOIN 查询（Order 通过 @ManyToOne 关联 User，JPQL 按关联路径 JOIN）
@Query("SELECT o, u.name FROM Order o JOIN o.user u")
List<Object[]> findOrdersWithUserName();
```

## 2. 缓存优化

```java
// 热点数据预加载
@Component
public class HotDataPreloader implements ApplicationRunner {
    
    @Override
    public void run(ApplicationArguments args) {
        // 系统启动时预加载热点数据到 Redis
        List<Product> hotProducts = productRepository.findTop100ByOrderBySalesDesc();
        hotProducts.forEach(p -> 
            redisTemplate.opsForValue().set(\"product:\" + p.getId(), serialize(p), Duration.ofHours(1))
        );
        log.info("预加载 {} 个热点商品到缓存", hotProducts.size());
    }
}
```

> 启动预热只适用于热点集合稳定、允许短暂陈旧的场景，多实例部署时每个实例都会重复执行。命中率、失效与击穿、穿透、雪崩的防护见 [缓存场景](../../scenarios/01-cache/chapter-03-multi-level-defense.md)。

## 3. CDN 加速

```java
// 静态资源使用 CDN
// 配置示例（application.yml）：
// cdn:
//   base-url: https://cdn.example.com
//   static-patterns: /css/**, /js/**, /images/**

// 动态内容的 CDN 策略
// 1. 接口响应设置 Cache-Control 头
// 仅对可公开共享、允许短时间陈旧的响应设置 max-age，个性化响应应设 private 或 no-store
@GetMapping("/api/products/{id}")
public ResponseEntity<ProductVO> getProduct(@PathVariable Long id) {
    ProductVO product = productService.findById(id);
    return ResponseEntity.ok()
        .cacheControl(CacheControl.maxAge(Duration.ofMinutes(5)))
        .body(product);
}
```

## 4. 异步处理

```java
// 同步操作转异步
@Service
public class OrderService {

    // 专用业务线程池，不要用默认的 ForkJoinPool.commonPool()
    private final Executor asyncExecutor; // 构造注入

    public Long createOrder(CreateOrderCommand cmd) {
        // 同步：创建订单（必须同步）
        Order order = orderRepository.save(new Order(cmd));

        // 异步：发送通知、更新统计、记录日志
        CompletableFuture<Void> future = CompletableFuture.runAsync(() -> {
            notificationService.sendOrderCreated(order.getId());
            statisticsService.incrementOrderCount();
            auditLogService.log("ORDER_CREATED", order.getId());
        }, asyncExecutor);

        // 记录执行异常，但不等于重试或最终完成
        future.exceptionally(ex -> {
            log.error("订单 {} 后置异步任务失败", order.getId(), ex);
            return null;
        });

        return order.getId();
    }
}
```

> 上面只是「允许丢失」的后台任务写法。专用执行器解决的是线程池隔离与拒绝策略，解决不了任务丢失；三个动作串行执行，`notificationService` 一旦抛异常，统计和审计不会执行，`exceptionally` 也只记录不重试。线程池满时 `runAsync` 会在提交处直接抛 `RejectedExecutionException`。通知、统计、审计一旦要求最终一定完成，需要落库、事务消息或 Outbox 保证可靠性。线程池隔离见 [Java 线程池](../../java/03-java-concurrency/chapter-11-thread-pool.md)，可靠异步与消息的边界见 [Spring 异步与消息](../../spring/07-async-and-messaging/chapter-02-async.md)。

## 5. 性能优化 Checklist

| 层次 | 优化手段 | 主要作用 | 前提条件与验证指标 |
| :-- | :-- | :-- | :-- |
| 数据库 | 索引优化、SQL 优化、读写分离 | 降低单次查询扫描量与主库压力 | 用 EXPLAIN 核对扫描行数，观察从库延迟与连接池等待 |
| 缓存 | 多级缓存、热点预加载 | 减少回源访问、降低热点查询延迟 | 观察命中率、回源 QPS 与端到端延迟，注意击穿与失效 |
| 应用 | 异步处理、批量操作 | 缩短调用方等待、摊薄单次开销 | 观察队列积压与线程池占用，确认下游吞吐跟得上 |
| 网络 | CDN、压缩、连接池 | 降低传输量与建连开销 | 观察命中率、传输体积与连接等待时间 |
| 架构 | 分库分表、微服务拆分 | 在瓶颈可拆分、流量能有效分散时分担压力 | 观察增加实例后的吞吐增幅，注意跨分片查询与协调开销 |

> **核心原则**：性能优化的第一步是测量，不是猜测。先通过延迟分位数（P95/P99）、吞吐量、CPU、连接池等待等指标定位瓶颈，再用 EXPLAIN 或 Profiler 核对具体原因，优化后回到同一组指标确认是否生效。收益没有依据的优化不做。
