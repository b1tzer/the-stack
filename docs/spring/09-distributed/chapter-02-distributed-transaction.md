# 分布式事务

> 单体应用里一个 `@Transactional` 就能保证事务。微服务拆分后，下单涉及订单服务、库存服务、积分服务——三个服务三个数据库，本地事务管不了跨服务的数据一致性。分布式事务的目标是：要么全部成功，要么全部回滚。

## 1. CAP 与 BASE 理论

### 1.1 CAP 定理

在分布式系统中，以下三者最多只能同时满足两个：

| 属性 | 含义 | 典型系统 |
|------|------|---------|
| **C（Consistency）** | 所有节点看到相同数据 | ZooKeeper, etcd |
| **A（Availability）** | 每个请求都能收到响应 | Cassandra, DynamoDB |
| **P（Partition Tolerance）** | 网络分区时系统仍能运行 | 所有分布式系统必须面对 |

现实是：网络分区（P）不可避免，所以实际选择是在 **CP** 和 **AP** 之间做取舍。

### 1.2 BASE 理论

BASE 是对 CAP 的工程妥协——既然做不到强一致，那就接受"基本可用、软状态、最终一致"：

- **Basically Available**：系统在故障时保证核心功能可用（降级、熔断）
- **Soft State**：允许中间状态存在（比如订单"支付中"）
- **Eventually Consistent**：经过一段时间后数据最终一致

```java
public enum OrderStatus {
    CREATED,        // 软状态：已创建但未确认
    PAYING,         // 软状态：支付中（不确定最终是否成功）
    PAID,           // 最终一致状态
    CANCELLED;      // 最终一致状态

    public boolean isFinalState() {
        return this == PAID || this == CANCELLED;
    }
}
```

> **总结**：CAP 告诉你"不可能三角"，BASE 告诉你"接受现实后怎么做"。实际工程中，绝大多数互联网系统选择 AP + 最终一致性。

## 2. 分布式事务方案对比

| 方案 | 一致性 | 性能 | 复杂度 | 适用场景 |
|------|--------|------|--------|---------|
| 2PC (XA) | 强一致 | 低（全局锁） | 中 | 数据库层面，传统企业应用 |
| Seata AT | 最终一致 | 高 | 低 | 大多数业务场景 |
| Seata TCC | 最终一致 | 高 | 高 | 高性能、需精确控制 |
| Seata SAGA | 最终一致 | 高 | 中 | 长事务、编排型流程 |
| RocketMQ 事务消息 | 最终一致 | 高 | 中 | 异步场景、消息驱动 |
| 本地消息表 | 最终一致 | 高 | 低 | 简单异步场景 |

## 3. Seata AT 模式

AT（Automatic Transaction）模式是最常用的 Seata 模式，对业务代码**零侵入**。

### 3.1 原理

1. **一阶段**：拦截业务 SQL，记录 before/after image 到 `undo_log` 表，本地事务提交
2. **二阶段-提交**：异步删除 `undo_log`（一阶段已提交，无需额外操作）
3. **二阶段-回滚**：根据 `undo_log` 中的 before image 生成反向 SQL 并执行

### 3.2 依赖与配置

```xml
<dependency>
    <groupId>io.seata</groupId>
    <artifactId>seata-spring-boot-starter</artifactId>
    <version>2.1.0</version>
</dependency>
```

```yaml
seata:
  enabled: true
  application-id: order-service
  tx-service-group: my_tx_group
  service:
    vgroup-mapping:
      my_tx_group: default
  registry:
    type: nacos
    nacos:
      server-addr: 127.0.0.1:8848
```

### 3.3 业务代码

```java
@Service
@Slf4j
public class OrderService {

    private final OrderMapper orderMapper;
    private final StorageFeignClient storageFeignClient;
    private final AccountFeignClient accountFeignClient;

    public OrderService(OrderMapper orderMapper,
                        StorageFeignClient storageFeignClient,
                        AccountFeignClient accountFeignClient) {
        this.orderMapper = orderMapper;
        this.storageFeignClient = storageFeignClient;
        this.accountFeignClient = accountFeignClient;
    }

    @GlobalTransactional(name = "create-order", timeoutMills = 60000)
    public Order createOrder(Long userId, Long productId, int quantity, BigDecimal amount) {
        log.info("开始全局事务, XID={}", RootContext.getXID());

        // 1. 创建订单（本地事务）
        Order order = new Order();
        order.setUserId(userId);
        order.setProductId(productId);
        order.setQuantity(quantity);
        order.setAmount(amount);
        order.setStatus(OrderStatus.CREATED);
        orderMapper.insert(order);

        // 2. 扣减库存（远程调用，Seata 自动拦截为分支事务）
        storageFeignClient.deduct(productId, quantity);

        // 3. 扣减账户余额（远程调用）
        accountFeignClient.debit(userId, amount);

        // 4. 更新订单状态
        order.setStatus(OrderStatus.PAID);
        orderMapper.updateStatus(order.getId(), OrderStatus.PAID);

        return order;
    }
}
```

### 3.4 undo_log 表

每个参与事务的数据库都需要建 `undo_log` 表：

```sql
CREATE TABLE `undo_log` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `branch_id` BIGINT NOT NULL,
    `xid` VARCHAR(128) NOT NULL,
    `context` VARCHAR(128) NOT NULL,
    `rollback_info` LONGBLOB NOT NULL,
    `log_status` INT NOT NULL,
    `log_created` DATETIME NOT NULL,
    `log_modified` DATETIME NOT NULL,
    `ext` VARCHAR(100) DEFAULT NULL,
    PRIMARY KEY (`id`),
    UNIQUE KEY `ux_undo_log` (`xid`, `branch_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

> **踩坑提醒**：`undo_log` 表必须建在每个参与事务的业务数据库中。AT 模式要求数据库支持回滚，MongoDB 等 NoSQL 不适用。全局锁可能导致热点行的性能瓶颈——秒杀场景慎用。

## 4. Seata TCC 模式

TCC（Try-Confirm-Cancel）需要手动编写三个阶段，侵入性更强但性能更好。

```java
@LocalTCC
public interface StockTccService {

    @TwoPhaseBusinessAction(
        name = "deductStock",
        commitMethod = "confirm",
        rollbackMethod = "cancel"
    )
    boolean tryDeduct(
        @BusinessActionContextParameter(paramName = "skuId") Long skuId,
        @BusinessActionContextParameter(paramName = "quantity") int quantity
    );

    boolean confirm(BusinessActionContext context);
    boolean cancel(BusinessActionContext context);
}

@Service
public class StockTccServiceImpl implements StockTccService {

    @Autowired
    private StockMapper stockMapper;
    @Autowired
    private FrozenStockMapper frozenStockMapper;

    @Override
    @Transactional
    public boolean tryDeduct(Long skuId, int quantity) {
        // Try：冻结库存（不实际扣减）
        int rows = stockMapper.freeze(skuId, quantity);
        if (rows == 0) throw new BusinessException("库存不足");
        frozenStockMapper.insert(new FrozenStock(skuId, quantity));
        return true;
    }

    @Override
    @Transactional
    public boolean confirm(BusinessActionContext context) {
        Long skuId = context.getActionContext("skuId", Long.class);
        int quantity = context.getActionContext("quantity", Integer.class);
        stockMapper.deduct(skuId, quantity);
        frozenStockMapper.delete(skuId, quantity);
        return true;
    }

    @Override
    @Transactional
    public boolean cancel(BusinessActionContext context) {
        Long skuId = context.getActionContext("skuId", Long.class);
        int quantity = context.getActionContext("quantity", Integer.class);
        stockMapper.unfreeze(skuId, quantity);
        frozenStockMapper.delete(skuId, quantity);
        return true;
    }
}
```

## 5. SAGA 模式

SAGA 通过一系列正向操作和对应的补偿操作来实现最终一致性。如果某个正向操作失败，按逆序执行已完成操作的补偿。

| 维度 | 2PC（两阶段提交） | SAGA |
|------|-------------------|------|
| 一致性 | 强一致 | 最终一致 |
| 性能 | 低（全局锁等待） | 高（无全局锁） |
| 代码侵入 | 低（框架处理） | 高（需写补偿逻辑） |
| 适用场景 | 短事务、强一致要求 | 长事务、跨多个微服务 |
| 回滚方式 | 由协调者统一回滚 | 按逆序执行补偿操作 |

```java
@Service
@Slf4j
public class OrderSagaService {

    // 正向操作：创建订单
    public Order createOrder(OrderRequest request) {
        Order order = new Order();
        order.setUserId(request.getUserId());
        order.setProductId(request.getProductId());
        order.setAmount(request.getAmount());
        order.setStatus(OrderStatus.CREATED);
        log.info("SAGA 正向: 订单创建成功 {}", order.getId());
        return order;
    }

    // 补偿操作：取消订单
    public void cancelOrder(Long orderId) {
        log.info("SAGA 补偿: 订单已取消 {}", orderId);
    }

    // 正向操作：扣减库存
    public void deductStock(Long productId, int quantity) {
        log.info("SAGA 正向: 库存扣减 productId={}, qty={}", productId, quantity);
    }

    // 补偿操作：恢复库存
    public void restoreStock(Long productId, int quantity) {
        log.info("SAGA 补偿: 库存恢复 productId={}, qty={}", productId, quantity);
    }
}
```

> **踩坑提醒**：补偿操作必须是 **幂等** 的——网络重试可能导致补偿被多次调用。SAGA 没有隔离性，中间状态对外可见，需要在业务层面做好状态管理（比如用"冻结库存"代替直接扣减）。

## 6. RocketMQ 事务消息

用 **消息队列 + 本地事务** 实现最终一致性，适合异步场景。

**核心原理（Half Message + 本地事务回查）**：

1. 生产者发送 **Half Message** 到 Broker，消费者暂时看不到
2. 生产者执行本地事务
3. 根据本地事务结果，发送 **Commit** 或 **Rollback**
4. Broker 长时间未收到确认，主动 **回查** 生产者的本地事务状态

```java
@Service
@Slf4j
public class OrderTransactionService {

    private final RocketMQTemplate rocketMQTemplate;
    private final OrderMapper orderMapper;

    public Order placeOrder(OrderRequest request) {
        String txId = UUID.randomUUID().toString();
        Message<StockDeductMessage> msg = MessageBuilder
                .withPayload(new StockDeductMessage(request.getProductId(), request.getQuantity()))
                .setHeader("TX_ID", txId)
                .build();

        rocketMQTemplate.sendMessageInTransaction(
                "order-tx-producer-group",
                "topic:stock-deduct",
                msg,
                txId
        );

        return new Order(txId, request);
    }
}

@Component
@Slf4j
@RocketMQTransactionListener
public class OrderTransactionListener implements RocketMQLocalTransactionListener {

    @Override
    public RocketMQLocalTransactionState executeLocalTransaction(Message msg, Object arg) {
        String txId = (String) arg;
        try {
            // 执行本地事务
            orderMapper.insert(order);
            transactionLogMapper.insert(new TransactionLog(txId, "COMMITTED"));
            return RocketMQLocalTransactionState.COMMIT;
        } catch (Exception e) {
            return RocketMQLocalTransactionState.ROLLBACK;
        }
    }

    @Override
    public RocketMQLocalTransactionState checkLocalTransaction(Message msg) {
        String txId = msg.getHeaders().get("TX_ID", String.class);
        TransactionLog log = transactionLogMapper.selectByTxId(txId);
        if (log == null) return RocketMQLocalTransactionState.UNKNOWN;
        return "COMMITTED".equals(log.getStatus())
            ? RocketMQLocalTransactionState.COMMIT
            : RocketMQLocalTransactionState.ROLLBACK;
    }
}
```

> **踩坑提醒**：本地事务和事务日志必须在 **同一个数据库事务** 中写入。消费端必须做 **幂等处理**。

## 7. 本地消息表

最简单的最终一致性方案，不依赖中间件：

```java
@Service
public class OrderService {

    @Transactional
    public void createOrder(CreateOrderDTO dto) {
        // 1. 创建订单
        Order order = buildOrder(dto);
        orderMapper.insert(order);

        // 2. 写本地消息表（同一本地事务）
        Message msg = new Message();
        msg.setTopic("stock-deduct");
        msg.setPayload(JSON.toJSONString(new StockDeductDTO(dto.getSkuId(), dto.getQuantity())));
        msg.setStatus("PENDING");
        messageMapper.insert(msg);
    }
}

// 定时任务：扫描消息表，发送到 MQ
@Scheduled(fixedDelay = 1000)
public void sendPendingMessages() {
    List<Message> messages = messageMapper.findByStatus("PENDING");
    for (Message msg : messages) {
        try {
            rocketMQTemplate.sendOneWay(msg.getTopic(), msg.getPayload());
            messageMapper.updateStatus(msg.getId(), "SENT");
        } catch (Exception e) {
            log.error("消息发送失败: {}", msg.getId(), e);
        }
    }
}
```

## 8. 选型建议

```text
是否需要强一致？
├── 是 → 2PC/XA（性能差，慎用）
└── 否 → 最终一致即可
    ├── 业务侵入可以接受？
    │   ├── 是 → TCC（高性能，精确控制）
    │   └── 否 → AT（零侵入，最常用）
    ├── 长事务/编排型？
    │   └── SAGA
    └── 异步消息驱动？
        └── RocketMQ 事务消息 / 本地消息表
```

## 9. 最佳实践

1. **优先避免分布式事务**——通过业务设计（如合并服务、最终一致）减少跨服务事务
2. **AT 模式最常用**——零侵入，覆盖 80% 场景
3. **TCC 用于高性能场景**——库存扣减、余额支付等需要精确控制的场景
4. **幂等设计**——所有参与方必须幂等，网络重试可能导致重复调用
5. **超时设置合理**——全局事务超时 > 所有分支事务超时之和
6. **监控告警**——异常事务、悬挂事务要实时告警
