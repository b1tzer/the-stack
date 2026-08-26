# 微服务架构

> **核心问题**：如何合理拆分微服务？服务间如何通信？如何处理分布式事务？

## 1. 服务拆分原则

| 原则 | 说明 | 示例 |
|------|------|------|
| 单一业务能力 | 一个服务只做一件事 | 用户服务只管用户注册/登录/信息管理 |
| 高内聚低耦合 | 相关功能聚合，减少跨服务调用 | 订单和支付放在同一域 |
| 数据独立 | 每个服务拥有自己的数据库 | 用户服务用 MySQL，搜索服务用 ES |
| 团队对齐 | 一个服务由一个小团队维护 | 2-Pizza Team（6-8人） |

```java
// 差：按技术层拆分（反模式）
// service-user-controller
// service-user-service
// service-user-dao

// 好：按业务域拆分
// service-user        (用户注册、登录、信息管理)
// service-order       (下单、订单查询、订单状态管理)
// service-payment     (支付、退款、对账)
// service-inventory   (库存管理、库存扣减)
```

## 2. 服务间通信

### 2.1 同步通信（HTTP/gRPC）

```java
// REST 调用（Spring Cloud OpenFeign）
@FeignClient(name = "inventory-service", fallback = InventoryFallback.class)
public interface InventoryClient {
    
    @PostMapping("/api/v1/inventory/deduct")
    InventoryResponse deduct(@RequestBody DeductRequest request);
}

@Component
public class InventoryFallback implements InventoryClient {
    @Override
    public InventoryResponse deduct(DeductRequest request) {
        // 降级逻辑：返回失败，触发补偿
        return InventoryResponse.failure("库存服务暂时不可用");
    }
}

// gRPC 调用（性能更高的二进制协议）
// proto 文件定义
// service InventoryService {
//     rpc Deduct (DeductRequest) returns (DeductResponse);
// }
```

### 2.2 异步通信（消息队列）

```java
// 生产者：发送领域事件
@Service
public class OrderService {
    private final RocketMQTemplate rocketMQTemplate;
    
    public void createOrder(Order order) {
        // 1. 保存订单
        orderRepository.save(order);
        
        // 2. 发送事件（异步解耦）
        rocketMQTemplate.convertAndSend("order-created", 
            new OrderCreatedEvent(order.getId(), order.getAmount()));
    }
}

// 消费者：监听事件
@Component
@RocketMQMessageListener(topic = "order-created", consumerGroup = "inventory-group")
public class InventoryConsumer implements RocketMQListener<OrderCreatedEvent> {
    
    @Override
    public void onMessage(OrderCreatedEvent event) {
        // 扣减库存
        inventoryService.deduct(event.getOrderId());
    }
}
```

### 2.3 通信方式选型

| 方式 | 延迟 | 吞吐量 | 适用场景 |
|------|------|--------|----------|
| REST (HTTP) | 中 | 中 | 对外 API、简单调用 |
| gRPC | 低 | 高 | 内部服务间高频调用 |
| 消息队列 | 高 | 极高 | 事件驱动、最终一致性 |

## 3. 分布式事务

### 3.1 Saga 模式

```java
// 编排式 Saga：由一个协调者管理事务步骤
public class CreateOrderSaga {
    private final OrderService orderService;
    private final InventoryService inventoryService;
    private final PaymentService paymentService;
    
    public void execute(CreateOrderCommand command) {
        Long orderId = null;
        try {
            // Step 1: 创建订单
            orderId = orderService.create(command);
            
            // Step 2: 扣减库存
            inventoryService.deduct(orderId, command.getItems());
            
            // Step 3: 扣款
            paymentService.charge(orderId, command.getAmount());
            
        } catch (Exception e) {
            // 补偿操作（逆向回滚）
            if (orderId != null) {
                paymentService.refund(orderId);      // Step 3 补偿
                inventoryService.restore(orderId);    // Step 2 补偿
                orderService.cancel(orderId);         // Step 1 补偿
            }
            throw new OrderCreationException(\"订单创建失败\", e);
        }
    }
}
```

### 3.2 本地消息表

```java
// 在同一个本地事务中写入业务数据和消息
@Transactional
public void createOrder(Order order) {
    // 1. 保存订单
    orderRepository.save(order);
    
    // 2. 保存消息到本地消息表（同一事务）
    OutboxMessage msg = new OutboxMessage(
        \"order-created\",
        toJson(new OrderCreatedEvent(order.getId())),
        \"PENDING\"
    );
    outboxRepository.save(msg);
}

// 后台任务：扫描并发送消息
@Scheduled(fixedDelay = 1000)
public void publishPendingMessages() {
    List<OutboxMessage> messages = outboxRepository.findByStatus(\"PENDING\");
    for (OutboxMessage msg : messages) {
        try {
            rocketMQTemplate.send(msg.getTopic(), msg.getPayload());
            msg.setStatus(\"SENT\");
            outboxRepository.save(msg);
        } catch (Exception e) {
            msg.setRetryCount(msg.getRetryCount() + 1);
            outboxRepository.save(msg);
        }
    }
}
```

## 4. 服务治理

| 治理能力 | 工具 | 说明 |
|---------|------|------|
| 注册发现 | Nacos、Eureka | 服务自动注册与发现 |
| 负载均衡 | Ribbon、Spring Cloud LoadBalancer | 客户端负载均衡 |
| 熔断降级 | Sentinel、Resilience4j | 防止级联故障 |
| 配置中心 | Nacos Config、Apollo | 动态配置管理 |
| 链路追踪 | SkyWalking、Zipkin | 分布式调用链追踪 |
| API 网关 | Spring Cloud Gateway、Kong | 统一入口、鉴权、限流 |

> **核心原则**：微服务不是银弹。先从单体开始，当团队规模和业务复杂度增长到一定程度时，再逐步拆分。拆分时按业务域拆分，保持高内聚低耦合。
