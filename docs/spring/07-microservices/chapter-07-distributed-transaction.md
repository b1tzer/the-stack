# 分布式事务

> 单体应用里一个 `@Transactional` 就能保证事务。微服务拆分后，下单涉及订单服务、库存服务、积分服务——三个服务三个数据库，本地事务管不了跨服务的数据一致性。分布式事务的目标是：要么全部成功，要么全部回滚。主流方案有 Seata（AT/TCC/SAGA）和 RocketMQ 事务消息。

## 1. 为什么需要分布式事务

```text
用户下单流程：
┌──────────┐    ┌──────────┐    ┌──────────┐
│ 订单服务  │───→│ 库存服务  │───→│ 积分服务  │
│  order_db │    │ stock_db │    │ point_db │
└──────────┘    └──────────┘    └──────────┘

问题：订单创建成功，库存扣减成功，积分增加失败 → 数据不一致
```

本地事务无法跨越服务边界。每个服务的本地事务只能保证自己数据库的一致性。

## 2. 分布式事务方案对比

| 方案 | 一致性 | 性能 | 复杂度 | 适用场景 |
| :-- | :-- | :-- | :-- | :-- |
| 2PC (XA) | 强一致 | 低（全局锁） | 中 | 数据库层面，传统企业应用 |
| Seata AT | 最终一致 | 高 | 低 | 大多数业务场景 |
| Seata TCC | 最终一致 | 高 | 高 | 高性能、需精确控制 |
| Seata SAGA | 最终一致 | 高 | 中 | 长事务、编排型流程 |
| RocketMQ 事务消息 | 最终一致 | 高 | 中 | 异步场景、消息驱动 |
| 本地消息表 | 最终一致 | 高 | 低 | 简单异步场景 |

## 3. Seata AT 模式

AT（Automatic Transaction）模式是最常用的 Seata 模式，对业务代码**零侵入**。

### 3.1 原理

```text
┌─────────────────────────────────────────────────────────┐
│                    Seata AT 执行流程                      │
│                                                          │
│  1. TM 开启全局事务 → 获取全局事务 ID (XID)                │
│  2. RM 执行本地 SQL                                       │
│  3. Seata 拦截 SQL，记录 before image（修改前数据快照）      │
│  4. 执行本地 SQL                                          │
│  5. Seata 记录 after image（修改后数据快照）                │
│  6. 本地事务提交，undo_log 写入本地数据库                   │
│  7. 所有 RM 执行完毕 → TM 通知 TC 提交/回滚                │
│  8. 提交：异步删除 undo_log                                │
│  8. 回滚：根据 undo_log 反向补偿                           │
└─────────────────────────────────────────────────────────┘
```

### 3.2 依赖与配置

```xml
<dependency>
    <groupId>io.seata</groupId>
    <artifactId>seata-spring-boot-starter</artifactId>
    <version>1.7.1</version>
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
      server-addr: localhost:8848
  config:
    type: nacos
    nacos:
      server-addr: localhost:8848
```

### 3.3 业务代码

```java
@Service
public class OrderService {

    @Autowired
    private OrderMapper orderMapper;
    @Autowired
    private StockFeignClient stockClient;
    @Autowired
    private PointFeignClient pointClient;

    // @GlobalTransactional 开启全局事务
    @GlobalTransactional(rollbackFor = Exception.class, name = "create-order")
    public void createOrder(CreateOrderDTO dto) {
        // 1. 本地事务：创建订单
        Order order = new Order();
        order.setUserId(dto.getUserId());
        order.setSkuId(dto.getSkuId());
        order.setAmount(dto.getAmount());
        order.setStatus("CREATED");
        orderMapper.insert(order);

        // 2. 远程调用：扣减库存（Seata 自动传播 XID）
        stockClient.deduct(dto.getSkuId(), dto.getQuantity());

        // 3. 远程调用：增加积分
        pointClient.addPoints(dto.getUserId(), calculatePoints(dto.getAmount()));

        // 4. 更新订单状态
        order.setStatus("PAID");
        orderMapper.updateById(order);

        // 如果任何一步抛异常，全局回滚
    }
}
```

### 3.4 被调用方（RM）

```java
@Service
public class StockService {

    @Autowired
    private StockMapper stockMapper;

    // 被调用方正常写本地事务即可，Seata 自动拦截
    @Transactional(rollbackFor = Exception.class)
    public void deduct(Long skuId, int quantity) {
        int rows = stockMapper.deduct(skuId, quantity);
        if (rows == 0) {
            throw new BusinessException("库存不足");
        }
    }
}
```

### 3.5 undo_log 表

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

## 4. Seata TCC 模式

TCC（Try-Confirm-Cancel）需要手动编写三个阶段，侵入性更强但性能更好。

```java
// 1. 定义 TCC 接口
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

// 2. 实现
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
        // Confirm：实际扣减，清除冻结记录
        Long skuId = context.getActionContext("skuId", Long.class);
        int quantity = context.getActionContext("quantity", Integer.class);
        stockMapper.deduct(skuId, quantity);
        frozenStockMapper.delete(skuId, quantity);
        return true;
    }

    @Override
    @Transactional
    public boolean cancel(BusinessActionContext context) {
        // Cancel：解冻库存
        Long skuId = context.getActionContext("skuId", Long.class);
        int quantity = context.getActionContext("quantity", Integer.class);
        stockMapper.unfreeze(skuId, quantity);
        frozenStockMapper.delete(skuId, quantity);
        return true;
    }
}
```

## 5. RocketMQ 事务消息

适合异步场景，最终一致：

```java
@Service
public class OrderService {

    @Autowired
    private RocketMQTemplate rocketMQTemplate;
    @Autowired
    private OrderMapper orderMapper;

    public void createOrder(CreateOrderDTO dto) {
        // 1. 本地事务：创建订单（状态：待确认）
        Order order = buildOrder(dto);
        order.setStatus("PENDING");
        orderMapper.insert(order);

        // 2. 发送半消息（half message）
        Message<OrderMessage> msg = MessageBuilder
                .withPayload(new OrderMessage(order.getId(), dto))
                .setHeader("KEYS", order.getId().toString())
                .build();
        rocketMQTemplate.sendMessageInTransaction(
                "tx-order-group",
                "order-topic",
                msg,
                order.getId()  // 传给本地事务回查
        );
    }

    // 本地事务执行器
    @RocketMQTransactionListener
    public class OrderTransactionListener implements RocketMQLocalTransactionListener {

        @Override
        public RocketMQLocalTransactionState executeLocalTransaction(Message msg, Object arg) {
            Long orderId = (Long) arg;
            try {
                // 执行业务逻辑：扣减库存、增加积分等
                stockClient.deduct(...);
                pointClient.addPoints(...);
                // 更新订单状态
                orderMapper.updateStatus(orderId, "CONFIRMED");
                return RocketMQLocalTransactionState.COMMIT;  // 提交半消息
            } catch (Exception e) {
                orderMapper.updateStatus(orderId, "CANCELLED");
                return RocketMQLocalTransactionState.ROLLBACK;  // 回滚
            }
        }

        @Override
        public RocketMQLocalTransactionState checkLocalTransaction(Message msg) {
            // 回查：检查本地事务是否完成
            Long orderId = Long.parseLong(msg.getHeaders().get("KEYS").toString());
            Order order = orderMapper.selectById(orderId);
            if ("CONFIRMED".equals(order.getStatus())) {
                return RocketMQLocalTransactionState.COMMIT;
            } else if ("CANCELLED".equals(order.getStatus())) {
                return RocketMQLocalTransactionState.ROLLBACK;
            }
            return RocketMQLocalTransactionState.UNKNOWN;  // 继续回查
        }
    }
}
```

## 6. 本地消息表

最简单的最终一致性方案，不依赖中间件：

```java
@Service
public class OrderService {

    @Autowired
    private OrderMapper orderMapper;
    @Autowired
    private MessageMapper messageMapper;

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

## 7. 选型建议

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

**最佳实践：**

1. **优先避免分布式事务**——通过业务设计（如合并服务、最终一致）减少跨服务事务
2. **AT 模式最常用**——零侵入，覆盖 80% 场景
3. **TCC 用于高性能场景**——库存扣减、余额支付等需要精确控制的场景
4. **幂等设计**——所有参与方必须幂等，网络重试可能导致重复调用
5. **超时设置合理**——全局事务超时 > 所有分支事务超时之和
6. **监控告警**——异常事务、悬挂事务要实时告警
