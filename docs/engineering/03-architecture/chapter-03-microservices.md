# 微服务架构

> **核心问题**：如何合理拆分微服务？服务间如何通信？如何处理分布式事务？

## 1. 服务拆分原则

| 原则 | 说明 | 示例 |
| :-- | :-- | :-- |
| 单一业务能力 | 一个服务只做一件事 | 用户服务只管用户注册/登录/信息管理 |
| 高内聚低耦合 | 相关功能聚合，减少跨服务调用 | 订单和支付放在同一域 |
| 数据独立 | 服务拥有自己业务数据的写入权与访问边界 | 用户服务用 MySQL，搜索服务用 ES |
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

判断是否值得拆分，可从四个维度评估：

- 业务边界：该服务是否独占某些业务规则与状态，是否存在频繁跨服务协作。
- 数据边界：是否存在多个服务直接读写同一业务表、需要跨服务事务。
- 演进边界：两部分功能是否需要独立发布、独立扩缩容、由不同团队负责。
- 运行成本：拆分引入的网络调用、故障处理、部署与一致性成本是否值得。

微服务不是越细越好。若拆分后两个服务仍需频繁同步调用、共同修改与协调发布，边界往往需要重新评估。

## 2. 服务间通信

### 2.1 同步通信（HTTP/gRPC）

同步调用有两条技术路线：REST（HTTP 接口，常用 JSON 序列化，生态成熟）与 gRPC（基于 Protocol Buffers 的二进制协议，合适场景下通常性能更优）。同步调用失败需要根据调用语义配置超时、有限重试、熔断或降级，重试非幂等操作时需注意重复副作用；业务补偿属于更高层次的事务一致性话题，不应与通信层的失败处理混为一谈。

```txt
REST 调用：客户端通过 HTTP 接口调用，超时或异常时可走降级逻辑返回兜底结果。
gRPC 调用：先定义 proto 接口，再生成客户端与服务端代码，适合内部高频调用。
```

同步通信的落地代码见 [Spring 服务调用](../../spring/09-distributed/chapter-04-service-call)。

### 2.2 异步通信（消息队列）

异步通信用于解耦与削峰：生产者把领域事件写入消息队列，消费者监听并处理，二者互不阻塞。

```txt
生产者：保存业务数据 → 发送领域事件到消息队列
消费者：监听队列 → 处理事件（扣库存、发通知等）
```

消息队列的落地代码见 [Spring 消息集成](../../spring/07-async-and-messaging/chapter-04-messaging)。

### 2.3 通信方式选型

| 方式 | 典型选型依据 | 适用场景 |
| :-- | :-- | :-- |
| REST (HTTP) | HTTP 生态成熟、接口可读、便于外部集成 | 对外 API、简单调用 |
| gRPC | 强类型契约、代码生成、流式通信，合适场景下性能更优 | 内部服务间高频调用 |
| 消息队列 | 异步解耦、削峰填谷、事件传播、故障隔离 | 事件驱动、最终一致性 |

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
        // 简化示例：标志只标记「已确认执行成功」。超时抛异常时结果未知（服务端可能已执行），
        // 生产实现需先查询业务流水或幂等重试确认，再决定是否补偿，本例省略该恢复流程。
        boolean inventoryDeducted = false;
        boolean paymentCharged = false;
        try {
            // Step 1: 创建订单
            orderId = orderService.create(command);
            // Step 2: 扣减库存
            inventoryService.deduct(orderId, command.getItems());
            inventoryDeducted = true;
            // Step 3: 扣款
            paymentService.charge(orderId, command.getAmount());
            paymentCharged = true;
        } catch (Exception e) {
            compensate(orderId, paymentCharged, inventoryDeducted);
            throw new OrderCreationException("订单创建失败", e);
        }
    }

    // 逆序补偿已确认执行的步骤；各补偿步骤独立容错，单步失败不中断后续补偿
    private void compensate(Long orderId, boolean paymentCharged, boolean inventoryDeducted) {
        if (paymentCharged) compensateStep(() -> paymentService.refund(orderId));
        if (inventoryDeducted) compensateStep(() -> inventoryService.restore(orderId));
        if (orderId != null) compensateStep(() -> orderService.cancel(orderId));
    }

    private void compensateStep(Runnable action) {
        try {
            action.run();
        } catch (Exception ex) {
            // 补偿失败需持久化重试、告警或人工介入（本例省略实现）
        }
    }
}
```

上述示例仅展示 Saga 的基本补偿结构，省略了结果未知时的查询确认与补偿任务的持久化恢复。补偿不是数据库事务的严格回滚。远程调用超时意味着结果未知（服务端可能已执行），需要幂等重试或查询确认实际结果；各补偿步骤独立容错，单步失败不中断后续补偿，失败需持久化重试、告警或人工介入。

### 3.2 本地消息表

在同一本地事务里写入业务数据和待发送消息，再由后台任务扫描发送，为业务与消息提供原子落库基础，通过可靠投递、幂等消费和失败恢复实现最终一致：

```txt
1. 本地事务内：保存业务数据 + 写入消息表（状态 PENDING），二者在同一数据库事务中提交
2. 后台任务：扫描 PENDING 消息 → 发送到消息队列 → 收到 Broker 持久化确认后标记 SENT
3. 发送失败：递增重试次数，等待下轮扫描重试
```

最终一致成立的前提：消息需有稳定的业务标识，发送成功后、标记 SENT 前进程崩溃会导致重复投递，消费者需通过唯一约束或幂等记录防重复执行；发送确认以 Broker 持久化确认为准，不能仅凭客户端未抛异常判定；消费者持续失败或消息进入死信队列时，需通过重试、重新投递或人工修复恢复，告警只是恢复的起点而非终点。

分布式事务的落地代码见 [Spring 分布式事务](../../spring/09-distributed/chapter-02-distributed-transaction)。

## 4. 服务治理

| 治理能力 | 工具 | 说明 |
| :-- | :-- | :-- |
| 注册发现 | Nacos、Eureka | 服务自动注册与发现 |
| 负载均衡 | Spring Cloud LoadBalancer | 客户端负载均衡 |
| 熔断降级 | Sentinel、Resilience4j | 防止级联故障 |
| 配置中心 | Nacos Config、Apollo | 动态配置管理 |
| 链路追踪 | SkyWalking、Zipkin | 分布式调用链追踪 |
| API 网关 | Spring Cloud Gateway、Kong | 统一入口、鉴权、限流 |

> **核心原则**：微服务不是银弹。先从单体开始，当团队规模和业务复杂度增长到一定程度时，再逐步拆分。拆分时按业务域拆分，保持高内聚低耦合。
