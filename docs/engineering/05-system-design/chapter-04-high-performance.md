# 高性能设计

> **核心问题**：如何优化系统性能？数据库查询慢怎么办？如何利用缓存和 CDN？

## 1. 数据库性能优化

### 1.1 索引优化

```java
// 慢查询：没有索引
// SELECT * FROM orders WHERE user_id = 123 AND status = 'PAID';
// 执行计划：全表扫描（100 万行）

// 优化：添加联合索引
// CREATE INDEX idx_user_status ON orders(user_id, status);
// 执行计划：索引扫描（1000 行）

// 索引设计原则
// 1. 最左前缀原则：联合索引 (a, b, c) 可用于 a / a,b / a,b,c 查询
// 2. 覆盖索引：查询字段都在索引中，避免回表
// 3. 选择性高的列放前面：区分度高的列优先

// 反范例：索引失效
// WHERE YEAR(created_at) = 2024  ← 函数导致索引失效
// 优化：WHERE created_at >= '2024-01-01' AND created_at < '2025-01-01'
```

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
Map<Long, User> userMap = userRepository.findByIdIn(userIds).stream()
    .collect(Collectors.toMap(User::getId, Function.identity()));
orders.forEach(o -> o.setUserName(userMap.get(o.getUserId()).getName()));

// 更好：使用 JOIN 查询
@Query(\"SELECT o, u.name FROM Order o JOIN User u ON o.userId = u.id\")
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
        log.info(\"预加载 {} 个热点商品到缓存\", hotProducts.size());
    }
}
```

## 3. CDN 加速

```java
// 静态资源使用 CDN
// 配置示例（application.yml）：
// cdn:
//   base-url: https://cdn.example.com
//   static-patterns: /css/**, /js/**, /images/**

// 动态内容的 CDN 策略
// 1. 接口响应设置 Cache-Control 头
@GetMapping(\"/api/products/{id}\")
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
    
    public Long createOrder(CreateOrderCommand cmd) {
        // 同步：创建订单（必须同步）
        Order order = orderRepository.save(new Order(cmd));
        
        // 异步：发送通知、更新统计、记录日志
        CompletableFuture.runAsync(() -> {
            notificationService.sendOrderCreated(order.getId());
            statisticsService.incrementOrderCount();
            auditLogService.log(\"ORDER_CREATED\", order.getId());
        });
        
        return order.getId();
    }
}
```

## 5. 性能优化 Checklist

| 层次 | 优化手段 | 预期收益 |
|------|---------|----------|
| 数据库 | 索引优化、SQL 优化、读写分离 | 10-100 倍 |
| 缓存 | 多级缓存、热点预加载 | 100-1000 倍 |
| 应用 | 异步处理、批量操作 | 2-10 倍 |
| 网络 | CDN、压缩、连接池 | 2-5 倍 |
| 架构 | 分库分表、微服务拆分 | 线性扩展 |

> **核心原则**：性能优化的第一步是测量，不是猜测。用 Profiler 找到真正的瓶颈，然后针对性优化。80% 的性能问题出在 20% 的代码上。
