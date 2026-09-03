# 微服务架构

> **核心问题**：如何合理拆分微服务？服务间如何通信？如何处理分布式事务？

## 1. 服务拆分原则

| 原则 | 说明 | 示例 |
| :-- | :-- | :-- |
| 单一业务能力 | 一个服务只做一件事 | 用户服务只管用户注册/登录/信息管理 |
| 高内聚低耦合 | 相关功能聚合，减少跨服务调用 | 订单和支付放在同一域 |
| 数据独立 | 每个服务拥有自己的数据库 | 用户服务用 MySQL，搜索服务用 ES |
| 团队对齐 | 一个服务由一个小团队维护 | 2-Pizza Team（6-8人） |

```txt
# 差：按技术层拆分（反模式）
service-user-controller / service-user-service / service-user-dao

# 好：按业务域拆分
service-user        # 用户注册、登录、信息管理
service-order       # 下单、订单查询、订单状态管理
service-payment     # 支付、退款、对账
service-inventory   # 库存管理、库存扣减
```

## 2. 服务间通信

### 2.1 同步通信（HTTP/gRPC）

同步调用有两条技术路线：REST（HTTP + JSON，生态成熟）与 gRPC（二进制协议，性能更高）。两者都需要处理调用失败时的降级与补偿。

```txt
REST 调用：客户端声明接口，声明降级回调；超时或异常时走降级逻辑返回兜底结果。
gRPC 调用：先定义 proto 接口，再生成客户端与服务端代码，适合内部高频调用。
```

同步通信的落地代码见 [Spring 服务调用](../../spring/09-distributed/chapter-03-service-call)。

### 2.2 异步通信（消息队列）

异步通信用于解耦与削峰：生产者把领域事件写入消息队列，消费者监听并处理，二者互不阻塞。

```txt
生产者：保存业务数据 → 发送领域事件到消息队列
消费者：监听队列 → 处理事件（扣库存、发通知等）
```

消息队列的落地代码见 [Spring 消息集成](../../spring/07-async-and-messaging/chapter-04-messaging)。

### 2.3 通信方式选型

| 方式 | 延迟 | 吞吐量 | 适用场景 |
| :-- | :-- | :-- | :-- |
| REST (HTTP) | 中 | 中 | 对外 API、简单调用 |
| gRPC | 低 | 高 | 内部服务间高频调用 |
| 消息队列 | 高 | 极高 | 事件驱动、最终一致性 |

## 3. 分布式事务

### 3.1 Saga 模式

编排式 Saga 由一个协调者管理事务步骤，每步失败时执行逆向补偿：

```java
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
                paymentService.refund(orderId);
                inventoryService.restore(orderId);
                orderService.cancel(orderId);
            }
            throw new OrderCreationException("订单创建失败", e);
        }
    }
}
```

### 3.2 本地消息表

在同一本地事务里写入业务数据和待发送消息，再由后台任务扫描发送，保证业务与消息的最终一致：

```txt
1. 本地事务内：保存业务数据 + 写入消息表（状态 PENDING）
2. 后台任务：扫描 PENDING 消息 → 发送到消息队列 → 标记 SENT
3. 发送失败：递增重试次数，等待下轮扫描重试
```

分布式事务的落地代码见 [Spring 分布式事务](../../spring/09-distributed/chapter-02-distributed-transaction)。

## 4. 服务治理

| 治理能力 | 工具 | 说明 |
| :-- | :-- | :-- |
| 注册发现 | Nacos、Eureka | 服务自动注册与发现 |
| 负载均衡 | Ribbon、Spring Cloud LoadBalancer | 客户端负载均衡 |
| 熔断降级 | Sentinel、Resilience4j | 防止级联故障 |
| 配置中心 | Nacos Config、Apollo | 动态配置管理 |
| 链路追踪 | SkyWalking、Zipkin | 分布式调用链追踪 |
| API 网关 | Spring Cloud Gateway、Kong | 统一入口、鉴权、限流 |

> **核心原则**：微服务不是银弹。先从单体开始，当团队规模和业务复杂度增长到一定程度时，再逐步拆分。拆分时按业务域拆分，保持高内聚低耦合。
