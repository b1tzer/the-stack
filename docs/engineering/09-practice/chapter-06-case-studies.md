# 案例分析

> **核心问题**：如何将前面学到的知识综合运用到实际项目中？

## 1. 案例：电商订单系统设计

### 1.1 需求分析

```java
// 业务需求：
// - 用户可以浏览商品、加入购物车、下单、支付
// - 订单支持取消、退款
// - 高并发场景：秒杀活动，预计 QPS 10000+
// - 数据量：预计年订单量 1 亿条

// 非功能需求：
// - 可用性：99.99%
// - 响应时间：P99 < 200ms
// - 数据一致性：支付和库存最终一致
```

### 1.2 架构设计

```java
// 技术选型
// - 应用框架：Spring Boot + Spring Cloud
// - 数据库：MySQL（主从）+ Redis（缓存）
// - 消息队列：RocketMQ（异步解耦）
// - 搜索：Elasticsearch（商品搜索）
// - 部署：Kubernetes

// 服务拆分
// - 商品服务：商品管理、库存管理
// - 订单服务：订单创建、查询、状态管理
// - 支付服务：支付、退款
// - 用户服务：注册、登录、信息管理
// - 搜索服务：商品搜索
```

### 1.3 核心代码

```java
// 订单创建（DDD 领域模型）
public class Order {
    private Long id;
    private String orderNo;
    private Long userId;
    private OrderStatus status;
    private Money totalAmount;
    private List<OrderLine> lines;
    
    public static Order create(Long userId, List<OrderLine> lines) {
        Order order = new Order();
        order.id = SnowflakeIdGenerator.nextId();
        order.orderNo = generateOrderNo();
        order.userId = userId;
        order.lines = lines;
        order.totalAmount = lines.stream()
            .map(OrderLine::getSubtotal)
            .reduce(Money::add)
            .orElseThrow();
        order.status = OrderStatus.CREATED;
        return order;
    }
    
    public OrderCancelledEvent cancel() {
        if (!canCancel()) {
            throw new OrderCannotCancelException(this.id);
        }
        this.status = OrderStatus.CANCELLED;
        return new OrderCancelledEvent(this.id, this.lines);
    }
    
    private boolean canCancel() {
        return status == OrderStatus.CREATED || status == OrderStatus.PAID;
    }
}

// 秒杀场景：预扣库存 + 异步下单
@Service
public class SeckillService {
    private final RedisTemplate<String, String> redis;
    private final RocketMQTemplate mq;
    
    // 秒杀入口：原子扣减库存
    public SeckillResult seckill(Long userId, Long productId) {
        String stockKey = "seckill:stock:" + productId;
        
        // Lua 脚本保证原子性
        String script = """
            local stock = tonumber(redis.call('GET', KEYS[1]))
            if stock == nil or stock <= 0 then
                return -1
            end
            redis.call('DECR', KEYS[1])
            return stock - 1
            """;
        
        Long result = redis.execute(
            new DefaultRedisScript<>(script, Long.class),
            List.of(stockKey)
        );
        
        if (result < 0) {
            return SeckillResult.soldOut();
        }
        
        // 发送 MQ 消息，异步创建订单
        mq.convertAndSend("seckill-order", new SeckillOrderMessage(userId, productId));
        return SeckillResult.success();
    }
}

// 异步下单消费者
@Component
@RocketMQMessageListener(topic = "seckill-order", consumerGroup = "order-group")
public class SeckillOrderConsumer implements RocketMQListener<SeckillOrderMessage> {
    
    @Override
    public void onMessage(SeckillOrderMessage msg) {
        // 检查用户是否已购买（防重复）
        if (hasPurchased(msg.getUserId(), msg.getProductId())) {
            return;
        }
        
        // 创建订单
        Order order = orderService.createSeckillOrder(msg.getUserId(), msg.getProductId());
        
        // 发送支付超时消息（30 分钟未支付自动取消）
        mq.convertAndSend("order-timeout", 
            new OrderTimeoutMessage(order.getId()), 
            MessageBuilder.withPayload(new OrderTimeoutMessage(order.getId()))
                .setHeader("DELAY", 5)  // 延迟消息
                .build()
        );
    }
}
```

### 1.4 设计决策记录

```markdown
# ADR-001: 秒杀场景使用 Redis + MQ 架构

## 决策
秒杀场景采用 Redis 预扣库存 + RocketMQ 异步下单的架构。

## 理由
1. Redis 单机 10 万+ QPS，远超数据库
2. Lua 脚本保证库存扣减的原子性
3. MQ 异步处理下单，削峰填谷
4. 库存扣减失败直接返回，不进入下单流程

## 后果
正面：支撑 10000+ QPS 秒杀场景
负面：系统复杂度增加，需要处理 MQ 消费失败的补偿
```

## 2. 案例：用户权限系统设计

```java
// RBAC + 数据权限
// 角色：管理员、部门经理、普通员工
// 权限：功能权限（菜单、按钮）+ 数据权限（行级）

// 功能权限：Spring Security + 自定义注解
@PreAuthorize("hasPermission('order', 'write')")
public void createOrder(OrderCommand cmd) { /* ... */ }

// 数据权限：MyBatis 拦截器自动追加 WHERE 条件
// 管理员：无限制
// 部门经理：只看本部门数据
// 普通员工：只看自己的数据
```

## 3. 经验总结

| 经验 | 说明 |
|------|------|
| 先单体后拆分 | 不要一开始就用微服务 |
| 渐进式架构 | 根据业务增长逐步演进 |
| 技术服务于业务 | 技术选型以解决业务问题为导向 |
| 文档化决策 | 使用 ADR 记录重要决策 |
| 自动化一切 | 测试、部署、监控都要自动化 |

> **案例分析的价值**：理论学习是基础，但真正的成长来自于实践。通过案例分析，将前面学到的设计原则、架构模式、DDD 概念综合运用，形成解决实际问题的能力。
