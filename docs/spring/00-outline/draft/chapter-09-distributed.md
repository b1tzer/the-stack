# 第 09 章：分布式系统

> 当你的应用从单机走向集群，曾经理所当然的"加个 synchronized 就能解决"的问题，突然全部失效。分布式系统的核心挑战是：在没有共享内存的世界里，如何达成协调、保证一致性、优雅地处理故障。本章从分布式锁、事务、服务调用、容错、配置中心到 API 网关，带你走完 Spring 生态的分布式全家桶。

---

## 9.1 分布式锁

### 9.1.1 分布式锁三要素

单机环境下 `synchronized` 或 `ReentrantLock` 就能解决的互斥问题，在集群部署时瞬间失效——因为每个 JVM 实例有自己独立的内存空间，锁对象根本不是同一个。分布式锁的本质是：**让多个进程在没有共享内存的条件下，就"谁有权执行"达成共识**。

一个合格的分布式锁必须满足三个要素：

| 要素 | 含义 | 反例 |
|------|------|------|
| **互斥** | 同一时刻只有一个客户端持有锁 | Redis `SETNX` 未设过期时间，进程崩溃后锁永远不释放 |
| **防死锁** | 持锁进程崩溃后锁能自动释放 | 忘了设 TTL，或者 TTL 到了但业务还没执行完 |
| **可重入** | 同一线程可多次加锁而不死锁 | 简单的 `SETNX` 实现不记录持有者，重入时自己把自己锁死 |

在 Spring 生态中，分布式锁的两种主流实现是 **Redis（Redisson）** 和 **ZooKeeper（Curator）**。选择哪种取决于你的业务场景——下一节会详细对比。

**踩坑提醒：** 千万不要自己用 `SETNX + EXPIRE` 写分布式锁。这两步不是原子操作，进程可能在 `SETNX` 之后、`EXPIRE` 之前崩溃，留下一个永远不过期的幽灵锁。

---

### 9.1.2 Redis 分布式锁（Redisson）

Redisson 是 Java 生态中最成熟的 Redis 分布式锁实现。它在底层用 **Lua 脚本** 保证加锁/解锁的原子性，并通过 **Watch Dog 机制** 自动续期，解决了"业务没执行完锁就过期"的问题。

**核心原理：**
- 加锁：执行 Lua 脚本，`KEYS[1]` 不存在时 `HSET` 写入 `clientId:threadId`，设置 TTL
- 解锁：Lua 脚本校验持有者身份一致后才删除，防止误删别人的锁
- 续期：Watch Dog 每隔 `lockWatchdogTimeout / 3`（默认 10 秒）自动续期到 30 秒

**依赖配置：**

```xml
<!-- pom.xml -->
<dependency>
    <groupId>org.redisson</groupId>
    <artifactId>redisson-spring-boot-starter</artifactId>
    <version>3.27.0</version>
</dependency>
```

```yaml
# application.yml
spring:
  data:
    redis:
      host: 127.0.0.1
      port: 6379
      password: your_password
```

**完整示例——扣减库存场景：**

```java
@Service
@Slf4j
public class InventoryService {

    private final RedissonClient redissonClient;
    private final InventoryMapper inventoryMapper;

    public InventoryService(RedissonClient redissonClient, InventoryMapper inventoryMapper) {
        this.redissonClient = redissonClient;
        this.inventoryMapper = inventoryMapper;
    }

    /**
     * 扣减库存，使用分布式锁保证并发安全
     * @param productId 商品ID
     * @param quantity  扣减数量
     * @return 是否扣减成功
     */
    public boolean deductStock(Long productId, int quantity) {
        String lockKey = "lock:inventory:" + productId;
        RLock lock = redissonClient.getLock(lockKey);

        try {
            // 尝试加锁：最多等待 5 秒，锁自动过期时间 30 秒
            boolean acquired = lock.tryLock(5, 30, TimeUnit.SECONDS);
            if (!acquired) {
                log.warn("获取锁失败，productId={}", productId);
                return false;
            }

            // 查询当前库存
            Inventory inventory = inventoryMapper.selectByProductId(productId);
            if (inventory == null || inventory.getStock() < quantity) {
                log.warn("库存不足，productId={}, 剩余={}", productId,
                        inventory != null ? inventory.getStock() : 0);
                return false;
            }

            // 扣减库存
            int rows = inventoryMapper.deductStock(productId, quantity);
            return rows > 0;

        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            log.error("获取锁被中断", e);
            return false;
        } finally {
            // 只有当前线程持有锁时才释放（可重入锁的安全检查）
            if (lock.isHeldByCurrentThread()) {
                lock.unlock();
            }
        }
    }
}
```

```java
// Mapper 接口
@Mapper
public interface InventoryMapper {

    @Select("SELECT id, product_id, stock FROM inventory WHERE product_id = #{productId}")
    Inventory selectByProductId(@Param("productId") Long productId);

    @Update("UPDATE inventory SET stock = stock - #{quantity} " +
            "WHERE product_id = #{productId} AND stock >= #{quantity}")
    int deductStock(@Param("productId") Long productId, @Param("quantity") int quantity);
}
```

**Redisson 的 Lua 脚本（加锁核心逻辑简化版）：**

```lua
-- 加锁 Lua 脚本
if (redis.call('exists', KEYS[1]) == 0) then
    redis.call('hincrby', KEYS[1], ARGV[2], 1);
    redis.call('pexpire', KEYS[1], ARGV[1]);
    return nil;
end;
if (redis.call('hexists', KEYS[1], ARGV[2]) == 1) then
    redis.call('hincrby', KEYS[1], ARGV[2], 1);
    redis.call('pexpire', KEYS[1], ARGV[1]);
    return nil;
end;
return redis.call('pttl', KEYS[1]);
```

**踩坑提醒：**
- Redis 主从架构下，锁写入 master 后 master 宕机，slave 提升为 master 但锁未同步——此时另一个客户端能获取到同一把锁。如果对一致性要求极高，应使用 RedLock 算法（但有争议，Martin Kleppmann 曾发文质疑）。
- `finally` 块中必须检查 `isHeldByCurrentThread()`，否则可能释放别人的锁。

---

### 9.1.3 ZooKeeper 分布式锁

ZooKeeper 分布式锁基于 **临时顺序节点（Ephemeral Sequential Node）** 实现。相比 Redis，它的优势是 **强一致性**（ZAB 协议保证），缺点是 **性能较低**。

**核心原理：**
1. 在 `/lock` 路径下创建临时顺序节点，如 `/lock/_c_uuid-0000000001`
2. 获取 `/lock` 下所有子节点，判断自己是否是最小序号
3. 如果是最小序号，获取锁成功；否则监听比自己小一号的节点
4. 业务完成后删除节点（或会话结束自动删除，防死锁）

**使用 Curator 实现：**

```xml
<dependency>
    <groupId>org.apache.curator</groupId>
    <artifactId>curator-recipes</artifactId>
    <version>5.5.0</version>
</dependency>
```

```java
@Configuration
public class ZookeeperConfig {

    @Bean
    public CuratorFramework curatorFramework() {
        CuratorFramework client = CuratorFrameworkFactory.builder()
                .connectString("127.0.0.1:2181")
                .sessionTimeoutMs(30000)
                .connectionTimeoutMs(15000)
                .retryPolicy(new ExponentialBackoffRetry(1000, 3))
                .build();
        client.start();
        return client;
    }
}
```

```java
@Service
@Slf4j
public class ZkLockService {

    private final CuratorFramework curatorClient;

    public ZkLockService(CuratorFramework curatorClient) {
        this.curatorClient = curatorClient;
    }

    public void doWithLock(String lockPath, Runnable task) throws Exception {
        InterProcessMutex lock = new InterProcessMutex(curatorClient, lockPath);

        try {
            // 最多等待 10 秒获取锁
            if (lock.acquire(10, TimeUnit.SECONDS)) {
                log.info("获取 ZooKeeper 锁成功: {}", lockPath);
                task.run();
            } else {
                throw new RuntimeException("获取 ZooKeeper 锁超时: " + lockPath);
            }
        } finally {
            if (lock.isAcquiredInThisProcess()) {
                lock.release();
                log.info("释放 ZooKeeper 锁: {}", lockPath);
            }
        }
    }
}
```

**Redis vs ZooKeeper 分布式锁选型对比：**

| 维度 | Redis（Redisson） | ZooKeeper（Curator） |
|------|-------------------|---------------------|
| 一致性模型 | AP（最终一致性） | CP（强一致性） |
| 性能 | 极高（~10 万 ops/s） | 中等（~1 万 ops/s） |
| 防死锁机制 | TTL + Watch Dog | 临时节点自动删除 |
| 可重入 | 支持（Lua 脚本） | 支持（记录线程） |
| 主从切换风险 | 可能丢锁 | 不会丢锁（ZAB 协议） |
| 运维复杂度 | 低（Redis 已广泛部署） | 高（需维护 ZK 集群） |
| 适用场景 | 高并发、允许极端情况丢锁 | 对一致性要求极高的场景 |

**踩坑提醒：** Curator 的 `InterProcessMutex` 不支持 tryLock 的超时单位为毫秒的精确控制——内部用 `System.currentTimeMillis()` 判断超时，时钟偏移可能导致问题。

---

## 9.2 分布式事务

### 9.2.1 CAP 与 BASE 理论

当一个业务操作跨多个微服务和数据库时，本地事务的 ACID 保证瞬间瓦解。分布式事务的第一课不是学框架，而是理解一个残酷的事实：**你不可能同时拥有所有好东西**。

**CAP 定理（Eric Brewer, 2000）：** 在分布式系统中，以下三者最多只能同时满足两个：

| 属性 | 含义 | 典型系统 |
|------|------|---------|
| **C（Consistency）** | 所有节点看到相同数据 | ZooKeeper, etcd |
| **A（Availability）** | 每个请求都能收到响应 | Cassandra, DynamoDB |
| **P（Partition Tolerance）** | 网络分区时系统仍能运行 | 所有分布式系统必须面对 |

现实是：网络分区（P）不可避免，所以实际选择是在 **CP** 和 **AP** 之间做取舍。

**BASE 理论** 是对 CAP 的工程妥协——既然做不到强一致，那就接受"基本可用、软状态、最终一致"：

- **Basically Available**：系统在故障时保证核心功能可用（降级、熔断）
- **Soft State**：允许中间状态存在（比如订单"支付中"）
- **Eventually Consistent**：经过一段时间后数据最终一致

```java
// 一个体现 BASE 思想的订单状态机
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

**总结：** CAP 告诉你"不可能三角"，BASE 告诉你"接受现实后怎么做"。实际工程中，绝大多数互联网系统选择 AP + 最终一致性。

---

### 9.2.2 Seata AT 模式

Seata 是阿里开源的分布式事务框架，AT（Automatic Transaction）模式是其中最"无侵入"的方案——业务代码几乎不需要修改，框架自动解析 SQL 生成逆向回滚日志。

**核心原理（一阶段提交 + 二阶段回滚）：**

1. **一阶段**：拦截业务 SQL，记录 before/after image 到 `undo_log` 表，本地事务提交
2. **二阶段-提交**：异步删除 `undo_log`（一阶段已提交，无需额外操作）
3. **二阶段-回滚**：根据 `undo_log` 中的 before image 生成反向 SQL 并执行

```yaml
# pom.xml 依赖
# <dependency>
#     <groupId>io.seata</groupId>
#     <artifactId>seata-spring-boot-starter</artifactId>
#     <version>2.1.0</version>
# </dependency>

# application.yml
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

    /**
     * 创建订单的分布式事务
     * @GlobalTransactional 开启全局事务，Seata 自动协调各分支事务
     */
    @GlobalTransactional(name = "create-order", timeoutMills = 60000)
    public Order createOrder(Long userId, Long productId, int quantity, BigDecimal amount) {
        log.info("开始全局事务, XID={}", RootContext.getXID());

        // 1. 创建订单（本地事务，会自动生成 undo_log）
        Order order = new Order();
        order.setUserId(userId);
        order.setProductId(productId);
        order.setQuantity(quantity);
        order.setAmount(amount);
        order.setStatus(OrderStatus.CREATED);
        orderMapper.insert(order);
        log.info("订单创建成功: {}", order.getId());

        // 2. 扣减库存（远程调用，Seata 自动拦截为分支事务）
        storageFeignClient.deduct(productId, quantity);
        log.info("库存扣减成功");

        // 3. 扣减账户余额（远程调用）
        accountFeignClient.debit(userId, amount);
        log.info("账户扣款成功");

        // 4. 更新订单状态
        order.setStatus(OrderStatus.PAID);
        orderMapper.updateStatus(order.getId(), OrderStatus.PAID);

        return order;
    }
}
```

**Seata AT 模式的全局锁机制：**
一阶段提交前，Seata 会向 TC（Transaction Coordinator）申请全局锁。如果另一个分布式事务也想修改同一行数据，必须等全局锁释放。这避免了脏写，但也引入了锁竞争。

**踩坑提醒：**
- `undo_log` 表必须建在每个参与事务的业务数据库中
- AT 模式要求数据库支持回滚，MongoDB 等 NoSQL 不适用
- 全局锁可能导致热点行的性能瓶颈——秒杀场景慎用

---

### 9.2.3 SAGA 模式

SAGA 模式是分布式事务的另一种思路：**不追求即时一致性，而是通过一系列正向操作和对应的补偿操作来实现最终一致性**。如果某个正向操作失败，按逆序执行已完成操作的补偿。

**SAGA vs 2PC 对比：**

| 维度 | 2PC（两阶段提交） | SAGA |
|------|-------------------|------|
| 一致性 | 强一致 | 最终一致 |
| 性能 | 低（全局锁等待） | 高（无全局锁） |
| 代码侵入 | 低（框架处理） | 高（需写补偿逻辑） |
| 适用场景 | 短事务、强一致要求 | 长事务、跨多个微服务 |
| 回滚方式 | 由协调者统一回滚 | 按逆序执行补偿操作 |

Spring 生态中推荐使用 **Seata SAGA 模式** 或 **Axon Framework**。以下是基于 Seata SAGA 状态机的简化示例：

```java
// SAGA 正向服务
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
        // 保存订单...
        log.info("SAGA 正向: 订单创建成功 {}", order.getId());
        return order;
    }

    // 补偿操作：取消订单
    public void cancelOrder(Long orderId) {
        // 更新订单状态为已取消
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

**SAGA 编排方式——状态机定义（JSON 配置风格）：**

```json
{
  "Name": "createOrderSaga",
  "States": {
    "Start": {
      "Type": "ServiceTask",
      "ServiceName": "orderSagaService",
      "ServiceMethod": "createOrder",
      "CompensateState": "CancelOrder",
      "Next": "DeductStock"
    },
    "DeductStock": {
      "Type": "ServiceTask",
      "ServiceName": "orderSagaService",
      "ServiceMethod": "deductStock",
      "CompensateState": "RestoreStock",
      "Next": "End"
    },
    "CancelOrder": {
      "Type": "Compensation",
      "ServiceName": "orderSagaService",
      "ServiceMethod": "cancelOrder"
    },
    "RestoreStock": {
      "Type": "Compensation",
      "ServiceName": "orderSagaService",
      "ServiceMethod": "restoreStock"
    }
  }
}
```

**踩坑提醒：** 补偿操作必须是 **幂等** 的——网络重试可能导致补偿被多次调用。另外，SAGA 没有隔离性，中间状态对外可见，需要在业务层面做好状态管理（比如用"冻结库存"代替直接扣减）。

---

### 9.2.4 最终一致性方案——RocketMQ 事务消息

在很多场景下，我们不需要 Seata 这样的"重"方案，而是用 **消息队列 + 本地事务** 实现最终一致性。RocketMQ 原生支持事务消息，是这种模式的最佳实践。

**核心原理（Half Message + 本地事务回查）：**

1. 生产者发送 **Half Message**（半消息）到 Broker，消费者暂时看不到
2. 生产者执行本地事务
3. 根据本地事务结果，向 Broker 发送 **Commit**（消费者可见）或 **Rollback**（丢弃）
4. 如果 Broker 长时间未收到确认，主动 **回查** 生产者的本地事务状态

```java
@Service
@Slf4j
public class OrderTransactionService {

    private final RocketMQTemplate rocketMQTemplate;
    private final OrderMapper orderMapper;
    private final TransactionLogMapper transactionLogMapper;

    public OrderTransactionService(RocketMQTemplate rocketMQTemplate,
                                   OrderMapper orderMapper,
                                   TransactionLogMapper transactionLogMapper) {
        this.rocketMQTemplate = rocketMQTemplate;
        this.orderMapper = orderMapper;
        this.transactionLogMapper = transactionLogMapper;
    }

    /**
     * 下单：本地事务 + 事务消息，保证订单创建和库存扣减最终一致
     */
    public Order placeOrder(OrderRequest request) {
        // 1. 先发 Half Message
        String txId = UUID.randomUUID().toString();
        Message<StockDeductMessage> msg = MessageBuilder
                .withPayload(new StockDeductMessage(request.getProductId(), request.getQuantity()))
                .setHeader("TX_ID", txId)
                .build();

        rocketMQTemplate.sendMessageInTransaction(
                "order-tx-producer-group",
                "topic:stock-deduct",
                msg,
                txId  // 传递给本地事务执行器
        );

        // 本地事务在 TransactionListener 中执行，此处先返回订单号
        return new Order(txId, request);
    }
}
```

```java
@Component
@Slf4j
@RocketMQTransactionListener
public class OrderTransactionListener implements RocketMQLocalTransactionListener {

    private final OrderMapper orderMapper;
    private final TransactionLogMapper transactionLogMapper;

    public OrderTransactionListener(OrderMapper orderMapper,
                                    TransactionLogMapper transactionLogMapper) {
        this.orderMapper = orderMapper;
        this.transactionLogMapper = transactionLogMapper;
    }

    /**
     * 执行本地事务（Half Message 发送成功后回调）
     */
    @Override
    public RocketMQLocalTransactionState executeLocalTransaction(Message msg, Object arg) {
        String txId = (String) arg;
        try {
            // 从消息中解析订单信息
            StockDeductMessage payload = (StockDeductMessage) msg.getPayload();

            // 执行本地事务：创建订单
            Order order = new Order();
            order.setTxId(txId);
            order.setProductId(payload.getProductId());
            order.setQuantity(payload.getQuantity());
            order.setStatus(OrderStatus.CREATED);
            orderMapper.insert(order);

            // 记录事务日志（用于幂等和回查）
            TransactionLog log = new TransactionLog();
            log.setTxId(txId);
            log.setStatus("COMMITTED");
            transactionLogMapper.insert(log);

            log.info("本地事务执行成功, txId={}", txId);
            return RocketMQLocalTransactionState.COMMIT;

        } catch (Exception e) {
            log.error("本地事务执行失败, txId={}", txId, e);
            return RocketMQLocalTransactionState.ROLLBACK;
        }
    }

    /**
     * 事务回查（Broker 长时间未收到确认时调用）
     */
    @Override
    public RocketMQLocalTransactionState checkLocalTransaction(Message msg) {
        String txId = msg.getHeaders().get("TX_ID", String.class);
        TransactionLog log = transactionLogMapper.selectByTxId(txId);

        if (log == null) {
            log.warn("事务日志不存在, txId={}", txId);
            return RocketMQLocalTransactionState.UNKNOWN;
        }

        switch (log.getStatus()) {
            case "COMMITTED":
                return RocketMQLocalTransactionState.COMMIT;
            case "ROLLBACKED":
                return RocketMQLocalTransactionState.ROLLBACK;
            default:
                return RocketMQLocalTransactionState.UNKNOWN;
        }
    }
}
```

**踩坑提醒：**
- 本地事务和事务日志必须在 **同一个数据库事务** 中写入，否则回查时找不到记录
- 消费端必须做 **幂等处理**——网络抖动可能导致消息被投递多次
- RocketMQ 事务消息只保证生产端的事务性，消费端失败需要业务自行重试

---

## 9.3 服务调用

### 9.3.1 OpenFeign 声明式调用

微服务之间互相调用是家常便饭，但手写 RestTemplate 的 URL 拼接、序列化、异常处理让人崩溃。OpenFeign 让你像调用本地方法一样调用远程服务——**声明一个接口，剩下的交给框架**。

```yaml
# application.yml
spring:
  cloud:
    openfeign:
      client:
        config:
          default:
            connect-timeout: 5000
            read-timeout: 10000
      circuitbreaker:
        enabled: true  # 开启熔断支持
```

```java
// 启用 Feign 客户端
@SpringBootApplication
@EnableFeignClients
public class OrderApplication {
    public static void main(String[] args) {
        SpringApplication.run(OrderApplication.class, args);
    }
}
```

```java
// 声明远程服务接口
@FeignClient(
    name = "storage-service",        // 服务名（注册中心中的名字）
    fallbackFactory = StorageFallbackFactory.class  // 降级工厂
)
public interface StorageFeignClient {

    @PostMapping("/api/storage/deduct")
    Result<Void> deduct(@RequestParam("productId") Long productId,
                        @RequestParam("quantity") int quantity);

    @GetMapping("/api/storage/{productId}")
    Result<StorageVO> getStorage(@PathVariable("productId") Long productId);
}
```

**FallbackFactory 降级（推荐方式，可获取异常信息）：**

```java
@Component
@Slf4j
public class StorageFallbackFactory implements FallbackFactory<StorageFeignClient> {

    @Override
    public StorageFeignClient create(Throwable cause) {
        log.error("Storage 服务调用失败，触发降级", cause);

        return new StorageFeignClient() {
            @Override
            public Result<Void> deduct(Long productId, int quantity) {
                // 降级逻辑：返回失败结果，由上层业务决定如何处理
                return Result.fail("库存服务暂不可用，请稍后重试");
            }

            @Override
            public Result<StorageVO> getStorage(Long productId) {
                return Result.fail("库存服务暂不可用");
            }
        };
    }
}
```

**踩坑提醒：**
- Feign 默认不传递请求头（如 Token），需要配置 `RequestInterceptor`
- `@PathVariable` 必须指定 `value`，否则在某些版本下参数绑定失败
- FallbackFactory 和 Fallback 只能选一个，不能同时配置

---

### 9.3.2 WebClient 响应式调用

Spring WebFlux 的 `WebClient` 是替代 `RestTemplate` 的现代方案。它支持非阻塞 I/O、响应式流，特别适合调用外部 API 需要高并发的场景。

```java
@Configuration
public class WebClientConfig {

    @Bean
    public WebClient webClient(WebClient.Builder builder) {
        return builder
                .baseUrl("https://api.example.com")
                .defaultHeader(HttpHeaders.CONTENT_TYPE, MediaType.APPLICATION_JSON_VALUE)
                .filter(ExchangeFilterFunctions.basicAuthentication("user", "pass"))
                .clientConnector(new ReactorClientHttpConnector(
                    HttpClient.create()
                        .responseTimeout(Duration.ofSeconds(10))
                        .option(ChannelOption.CONNECT_TIMEOUT_MILLIS, 5000)
                ))
                .build();
    }
}
```

```java
@Service
@Slf4j
public class ExternalApiService {

    private final WebClient webClient;

    public ExternalApiService(WebClient webClient) {
        this.webClient = webClient;
    }

    /**
     * 调用外部 API，带超时、重试和错误处理
     */
    public Mono<ExternalData> fetchData(String id) {
        return webClient.get()
                .uri("/data/{id}", id)
                .retrieve()
                // 4xx 错误处理
                .onStatus(HttpStatusCode::is4xxClientError, response ->
                    response.bodyToMono(String.class)
                        .flatMap(body -> Mono.error(
                            new BusinessException("请求参数错误: " + body)))
                )
                // 5xx 错误处理
                .onStatus(HttpStatusCode::is5xxServerError, response ->
                    Mono.error(new RuntimeException("外部服务异常: " + response.statusCode()))
                )
                .bodyToMono(ExternalData.class)
                .timeout(Duration.ofSeconds(10))                     // 超时控制
                .retryWhen(Retry.backoff(3, Duration.ofMillis(500))  // 指数退避重试
                    .maxBackoff(Duration.ofSeconds(5))
                    .filter(ex -> ex instanceof RuntimeException)    // 只重试运行时异常
                    .onRetryExhaustedThrow((spec, signal) ->
                        new RuntimeException("重试次数已用尽", signal.failure()))
                )
                .doOnError(e -> log.error("调用外部API失败, id={}", id, e))
                .doOnSuccess(data -> log.info("调用外部API成功, id={}", id));
    }

    /**
     * 批量并发调用示例
     */
    public Flux<ExternalData> fetchBatch(List<String> ids) {
        return Flux.fromIterable(ids)
                .parallel(10)                     // 最多 10 个并发
                .runOn(Schedulers.boundedElastic())
                .flatMap(this::fetchData)
                .sequential()
                .collectList()
                .flatMapMany(Flux::fromIterable);
    }
}
```

**RestTemplate / Feign / WebClient 三者对比：**

| 维度 | RestTemplate | OpenFeign | WebClient |
|------|-------------|-----------|-----------|
| 编程模型 | 同步阻塞 | 同步阻塞（声明式） | 异步非阻塞 |
| 学习成本 | 低 | 低 | 中等 |
| 代码量 | 多（手动拼装） | 少（接口声明） | 中等 |
| 服务发现 | 需 @LoadBalanced | 内置 | 需 @LoadBalanced |
| 响应式支持 | 不支持 | 不支持 | 原生支持 |
| 适用场景 | 简单调用、遗留系统 | 微服务间调用 | 高并发外部调用 |
| Spring 推荐 | 已标记维护模式 | 推荐 | 推荐 |

**踩坑提醒：** `WebClient` 的 `retrieve()` 默认不处理 4xx/5xx 状态码，必须手动添加 `onStatus()` 处理，否则会抛出不明不白的 `WebClientResponseException`。

---

## 9.4 服务容错

### 9.4.1 熔断器（Circuit Breaker）

一个依赖服务挂了，如果不做保护，请求会持续超时堆积，最终拖垮整个系统——这就是 **级联故障（Cascading Failure）**。熔断器的作用就像电路中的保险丝：**检测到异常达到阈值后，快速失败而不是继续等待**。

Resilience4j 的熔断器有三个状态：

```
CLOSED（正常）──失败率超阈值──→ OPEN（熔断）──超时后──→ HALF_OPEN（试探）
      ↑                                                      │
      └─────────── 试探成功 ←─────────────────────────────────┘
                                       试探失败 → OPEN
```

```xml
<dependency>
    <groupId>io.github.resilience4j</groupId>
    <artifactId>resilience4j-spring-boot3</artifactId>
    <version>2.2.0</version>
</dependency>
```

```yaml
# application.yml
resilience4j:
  circuitbreaker:
    instances:
      paymentService:
        sliding-window-size: 10                # 滑动窗口大小
        failure-rate-threshold: 50             # 失败率阈值（%）
        slow-call-rate-threshold: 80           # 慢调用率阈值
        slow-call-duration-threshold: 2s       # 慢调用判定时间
        permitted-number-of-calls-in-half-open-state: 3  # 半开状态试探次数
        wait-duration-in-open-state: 10s       # OPEN 状态持续时间
        minimum-number-of-calls: 5             # 最少调用次数才开始计算
        automatic-transition-from-open-to-half-open-enabled: true
```

```java
@Service
@Slf4j
public class PaymentService {

    private final PaymentFeignClient paymentClient;

    public PaymentService(PaymentFeignClient paymentClient) {
        this.paymentClient = paymentClient;
    }

    /**
     * 调用支付服务，带熔断保护
     * fallbackMethod 指定降级方法，签名必须匹配且多一个 Throwable 参数
     */
    @CircuitBreaker(name = "paymentService", fallbackMethod = "paymentFallback")
    public PayResult pay(PayRequest request) {
        log.info("调用支付服务: orderId={}", request.getOrderId());
        return paymentClient.pay(request);
    }

    /**
     * 熔断降级方法
     */
    private PayResult paymentFallback(PayRequest request, Throwable throwable) {
        log.warn("支付服务熔断降级, orderId={}, 原因={}",
                request.getOrderId(), throwable.getMessage());
        // 返回一个"处理中"的状态，后续通过补偿机制处理
        PayResult result = new PayResult();
        result.setOrderId(request.getOrderId());
        result.setStatus("PENDING");
        result.setMessage("支付服务暂时不可用，订单将稍后处理");
        return result;
    }
}
```

**踩坑提醒：**
- `minimum-number-of-calls` 设置太小会导致熔断器过于敏感（比如只调用 2 次有 1 次失败就触发）
- 熔断器实例是 **按名称隔离** 的，不同服务应使用不同的实例名
- 降级方法的参数列表必须与原方法完全一致，外加一个 `Throwable` 参数

---

### 9.4.2 限流与降级

熔断保护下游，限流保护自己。当流量超过系统处理能力时，**限流（Rate Limiter）** 和 **舱壁隔离（Bulkhead）** 是两道防线。

```yaml
resilience4j:
  ratelimiter:
    instances:
      apiLimiter:
        limit-for-period: 100            # 每个周期允许的请求数
        limit-refresh-period: 1s         # 限流周期
        timeout-duration: 500ms          # 获取许可的超时时间

  bulkhead:
    instances:
      orderBulkhead:
        max-concurrent-calls: 25         # 最大并发数
        max-wait-duration: 500ms         # 等待进入的超时时间

  thread-pool-bulkhead:
    instances:
      asyncBulkhead:
        max-thread-pool-size: 10
        core-thread-pool-size: 5
        queue-capacity: 20
        keep-alive-duration: 20ms
```

```java
@Service
@Slf4j
public class ApiService {

    /**
     * 限流：每秒最多 100 个请求，超出的直接快速失败
     */
    @RateLimiter(name = "apiLimiter", fallbackMethod = "rateLimitFallback")
    public String queryData(String param) {
        // 正常业务逻辑
        return "查询结果: " + param;
    }

    private String rateLimitFallback(String param, Throwable throwable) {
        log.warn("接口限流触发, param={}", param);
        return "系统繁忙，请稍后重试";
    }

    /**
     * 舱壁隔离：最多 25 个并发调用，防止一个慢接口拖垮整个服务
     */
    @Bulkhead(name = "orderBulkhead", fallbackMethod = "bulkheadFallback")
    public OrderVO getOrder(Long orderId) {
        // 可能耗时较长的查询
        return orderQueryService.getDetail(orderId);
    }

    private OrderVO bulkheadFallback(Long orderId, Throwable throwable) {
        log.warn("舱壁隔离触发, orderId={}", orderId);
        // 返回缓存数据或降级数据
        return orderCacheService.getCachedOrder(orderId);
    }
}
```

**限流算法对比：**

| 算法 | 原理 | 优点 | 缺点 |
|------|------|------|------|
| 固定窗口 | 固定时间段内计数 | 实现简单 | 窗口边界突发流量 |
| 滑动窗口 | 滑动时间窗口计数 | 平滑 | 实现复杂 |
| 令牌桶 | 固定速率放入令牌 | 允许一定突发 | 需要定时器 |
| 漏桶 | 固定速率处理请求 | 流量完全平滑 | 无法应对突发 |

Resilience4j 的 RateLimiter 基于 **固定窗口** 实现。如果需要令牌桶，可以考虑 Guava `RateLimiter` 或 Sentinel。

---

### 9.4.3 重试与超时

网络抖动、服务短暂不可用是分布式系统的常态。合理的重试策略能自动恢复这些瞬时故障，但 **不加控制的重试是灾难**——重试风暴能在几秒内把故障放大数十倍。

```yaml
resilience4j:
  retry:
    instances:
      remoteCall:
        max-attempts: 3                      # 最大重试次数
        wait-duration: 500ms                 # 初始等待时间
        exponential-backoff-multiplier: 2    # 指数退避倍数
        enable-exponential-backoff: true     # 开启指数退避
        retry-exceptions:                    # 哪些异常触发重试
          - java.io.IOException
          - java.net.SocketTimeoutException
          - feign.RetryableException
        ignore-exceptions:                   # 哪些异常不重试
          - com.example.BusinessException

  timelimiter:
    instances:
      remoteCall:
        timeout-duration: 5s                 # 超时时间
        cancel-running-future: true          # 超时后取消异步任务
```

```java
@Service
@Slf4j
public class RetryService {

    /**
     * 组合使用重试 + 超时 + 熔断
     * 执行顺序：Retry → CircuitBreaker → TimeLimiter（从外到内）
     */
    @Retry(name = "remoteCall")
    @CircuitBreaker(name = "remoteCall")
    @TimeLimiter(name = "remoteCall")
    public CompletableFuture<String> callRemote(String param) {
        return CompletableFuture.supplyAsync(() -> {
            log.info("调用远程服务: {}", param);
            // 模拟可能失败的远程调用
            return remoteClient.process(param);
        });
    }

    /**
     * 手动实现带指数退避的重试（不依赖框架时的参考实现）
     */
    public <T> T retryWithBackoff(Callable<T> task, int maxRetries, long initialDelay) {
        Exception lastException = null;
        for (int attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                return task.call();
            } catch (Exception e) {
                lastException = e;
                if (attempt < maxRetries) {
                    long delay = initialDelay * (1L << attempt);  // 指数退避
                    log.warn("第 {} 次重试失败, {}ms 后重试: {}",
                            attempt + 1, delay, e.getMessage());
                    try {
                        Thread.sleep(delay);
                    } catch (InterruptedException ie) {
                        Thread.currentThread().interrupt();
                        throw new RuntimeException("重试被中断", ie);
                    }
                }
            }
        }
        throw new RuntimeException("重试 " + maxRetries + " 次后仍然失败", lastException);
    }
}
```

**重试风暴风险与应对策略：**

| 风险 | 描述 | 应对 |
|------|------|------|
| 放大故障 | A 重试 B，B 重试 C，指数级增长 | 设置重试预算（retry budget） |
| 惊群效应 | 所有客户端同时重试 | 加随机抖动（jitter） |
| 幂等破坏 | 非幂等操作被重复执行 | 确保重试接口幂等 |
| 资源耗尽 | 重试占用线程/连接池 | 结合熔断器使用 |

**踩坑提醒：** `@Retry` + `@CircuitBreaker` + `@TimeLimiter` 组合使用时，**顺序很重要**。正确的注解顺序是 Retry 在最外层（先重试），CircuitBreaker 在中间（重试前先判断熔断），TimeLimiter 在最内层（每次调用超时控制）。

---

## 9.5 配置中心

### 9.5.1 Nacos Config

当你的微服务有十几个实例，配置文件散落在各个项目中，改个数据库连接地址需要重启所有服务——这是配置中心要解决的核心问题：**集中管理、动态刷新、环境隔离**。

```xml
<dependency>
    <groupId>com.alibaba.cloud</groupId>
    <artifactId>spring-cloud-starter-alibaba-nacos-config</artifactId>
    <version>2023.0.1.0</version>
</dependency>
```

```yaml
# bootstrap.yml（注意：必须在 bootstrap.yml 中配置，优先于 application.yml）
spring:
  application:
    name: order-service
  profiles:
    active: dev
  cloud:
    nacos:
      config:
        server-addr: 127.0.0.1:8848
        namespace: dev-namespace-id       # 命名空间隔离环境
        group: DEFAULT_GROUP
        file-extension: yaml
        shared-configs:                    # 共享配置
          - data-id: common-datasource.yaml
            group: SHARED_GROUP
            refresh: true
          - data-id: common-redis.yaml
            group: SHARED_GROUP
            refresh: true
```

```java
@RestController
@RefreshScope  // 关键：配置变更时自动刷新 Bean
@Slf4j
public class ConfigController {

    @Value("${order.timeout:30}")
    private int orderTimeout;

    @Value("${order.max-retry:3}")
    private int maxRetry;

    @GetMapping("/config/info")
    public Map<String, Object> getConfig() {
        return Map.of(
            "orderTimeout", orderTimeout,
            "maxRetry", maxRetry
        );
    }
}
```

**Nacos 配置优先级（从高到低）：**

1. `Nacos` 上的配置（远程）
2. `application-{profile}.yml`（本地 profile 配置）
3. `application.yml`（本地默认配置）
4. `@ConfigurationProperties` 默认值
5. `@Value` 默认值

**踩坑提醒：**
- `@RefreshScope` 刷新时会 **销毁并重建** Bean，如果 Bean 有状态会丢失
- `bootstrap.yml` 在 Spring Boot 3.x 需要额外引入 `spring-cloud-starter-bootstrap` 依赖
- 共享配置（shared-configs）的优先级 **低于** 应用自身的 data-id 配置

---

### 9.5.2 配置版本管理与灰度发布

Nacos 支持配置的历史版本和灰度发布，这是生产环境的必备能力——**改配置出问题时能秒级回滚，新配置先给少量实例验证**。

```java
// 通过 Nacos OpenAPI 进行版本管理（编程方式）
@Service
public class NacosConfigManager {

    private final ConfigService configService;

    public NacosConfigManager(ConfigService configService) {
        this.configService = configService;
    }

    /**
     * 获取配置的历史版本列表
     */
    public List<ConfigHistory> getHistory(String dataId, String group, int pageNo, int pageSize)
            throws NacosException {
        return configService.getConfigHistory(dataId, group, pageNo, pageSize);
    }

    /**
     * 回滚到指定的历史版本
     */
    public boolean rollback(String dataId, String group, String nid) throws NacosException {
        return configService.rollback(dataId, group, nid);
    }

    /**
     * 监听配置变更（自定义处理逻辑）
     */
    public void addListener(String dataId, String group, Consumer<String> onChange)
            throws NacosException {
        configService.addListener(dataId, group, new Listener() {
            @Override
            public Executor getExecutor() {
                return null; // 使用默认线程
            }

            @Override
            public void receiveConfigInfo(String configInfo) {
                log.info("配置变更: dataId={}, group={}", dataId, group);
                onChange.accept(configInfo);
            }
        });
    }
}
```

**灰度发布策略：**

```
┌─────────────────────────────────────────────────────┐
│                   Nacos 配置中心                       │
├─────────────────────────────────────────────────────┤
│                                                     │
│  data-id: order-service.yaml                        │
│  ┌─────────┐  ┌──────────┐  ┌──────────────────┐   │
│  │ 正式版本  │  │ 灰度版本  │  │ 灰度规则（IP列表）│   │
│  │ timeout=30│  │ timeout=60│  │ 10.0.1.5, .6    │   │
│  └─────────┘  └──────────┘  └──────────────────┘   │
│                                                     │
│  实例 10.0.1.5 → 读取灰度版本 (timeout=60)           │
│  实例 10.0.1.7 → 读取正式版本 (timeout=30)           │
└─────────────────────────────────────────────────────┘
```

```java
/**
 * 基于 Nacos 灰度插件的配置示例
 * 在 Nacos 控制台配置灰度规则：
 * - betaIps: 10.0.1.5,10.0.1.6  （灰度实例 IP 列表）
 */
@RestController
@RefreshScope
public class GrayConfigController {

    @Value("${feature.new-checkout:false}")
    private boolean newCheckoutEnabled;

    @GetMapping("/feature/checkout")
    public String checkoutStyle() {
        if (newCheckoutEnabled) {
            return "新版本结账流程（灰度）";
        }
        return "旧版本结账流程（正式）";
    }
}
```

**配置变更操作 SOP（生产环境建议）：**

1. 修改配置前，先 **导出当前配置** 作为备份
2. 在 Nacos 控制台修改配置并发布
3. 观察灰度实例的日志和指标（1-5 分钟）
4. 灰度验证通过后，全量发布
5. 出现异常，立即使用 **版本回滚** 功能恢复

**踩坑提醒：** Nacos 的配置回滚 **不会触发 @RefreshScope 刷新**——回滚后需要手动发布一次（即使是同样的内容）才能让客户端感知到变更。

---

## 9.6 API 网关

### 9.6.1 Spring Cloud Gateway

微服务对外暴露几十个端口，前端要记住每个服务的地址和端口——这是 API 网关要解决的第一个问题。但网关的价值远不止"统一入口"：**路由转发、负载均衡、认证鉴权、限流、日志**，所有横切关注点都可以在网关层统一处理。

Spring Cloud Gateway 的核心抽象是 **三元组**：

- **Route（路由）**：网关的基本单元，由 ID、目标 URI、Predicate 集合、Filter 集合组成
- **Predicate（断言）**：匹配条件（路径、请求头、参数等），决定请求是否匹配该路由
- **Filter（过滤器）**：对请求/响应做加工处理（添加头、路径重写、限流等）

```xml
<dependency>
    <groupId>org.springframework.cloud</groupId>
    <artifactId>spring-cloud-starter-gateway</artifactId>
</dependency>
<dependency>
    <groupId>org.springframework.cloud</groupId>
    <artifactId>spring-cloud-starter-loadbalancer</artifactId>
</dependency>
```

```yaml
# application.yml
server:
  port: 8080

spring:
  cloud:
    gateway:
      routes:
        # 订单服务路由
        - id: order-service
          uri: lb://order-service             # lb:// 表示使用负载均衡
          predicates:
            - Path=/api/orders/**             # 路径匹配
          filters:
            - StripPrefix=1                   # 去掉 /api 前缀
            - name: RequestRateLimiter        # 限流过滤器
              args:
                redis-rate-limiter.replenishRate: 10
                redis-rate-limiter.burstCapacity: 20

        # 用户服务路由
        - id: user-service
          uri: lb://user-service
          predicates:
            - Path=/api/users/**
            - Method=GET,POST                 # 限定 HTTP 方法
          filters:
            - StripPrefix=1
            - AddRequestHeader=X-Source, gateway  # 添加请求头

        # 外部 API 代理（路径重写示例）
        - id: external-api
          uri: https://api.thirdparty.com
          predicates:
            - Path=/external/**
          filters:
            - RewritePath=/external/(?<segment>.*), /v2/${segment}  # 路径重写
```

**路径重写与负载均衡工作流程：**

```
客户端 → GET /api/orders/123
         ↓
Gateway Predicate: Path=/api/orders/**  ✅ 匹配
         ↓
Filter 1: StripPrefix=1 → 路径变为 /orders/123
         ↓
Filter 2: LoadBalancer → 从 order-service 的实例列表中选择一个
         ↓
转发到: http://order-service-instance-2/orders/123
```

**踩坑提醒：**
- Gateway 基于 WebFlux（Netty），**不能引入 spring-boot-starter-web**（Tomcat），否则启动报错
- `lb://` 需要 `spring-cloud-starter-loadbalancer` 依赖，Spring Cloud 2020+ 移除了 Ribbon
- Predicate 的匹配是 **有序的**，第一个匹配成功的路由会被使用

---

### 9.6.2 网关过滤器

Gateway 的真正威力在 Filter——所有微服务都需要的"公共逻辑"在这里集中处理，业务服务可以专注于业务。

**全局过滤器——JWT 认证：**

```java
@Component
@Slf4j
public class AuthGlobalFilter implements GlobalFilter, Ordered {

    private final JwtUtil jwtUtil;
    private static final Set<String> WHITE_LIST = Set.of(
            "/api/auth/login",
            "/api/auth/register",
            "/api/health"
    );

    public AuthGlobalFilter(JwtUtil jwtUtil) {
        this.jwtUtil = jwtUtil;
    }

    @Override
    public Mono<Void> filter(ServerWebExchange exchange, GatewayFilterChain chain) {
        String path = exchange.getRequest().getURI().getPath();

        // 白名单直接放行
        if (WHITE_LIST.stream().anyMatch(path::startsWith)) {
            return chain.filter(exchange);
        }

        // 获取 Token
        String token = exchange.getRequest().getHeaders().getFirst("Authorization");
        if (token == null || !token.startsWith("Bearer ")) {
            log.warn("缺少认证 Token: {}", path);
            exchange.getResponse().setStatusCode(HttpStatus.UNAUTHORIZED);
            return exchange.getResponse().setComplete();
        }

        // 验证 Token
        try {
            Claims claims = jwtUtil.parseToken(token.substring(7));
            // 将用户信息传递给下游服务（通过请求头）
            ServerWebExchange mutatedExchange = exchange.mutate()
                    .request(r -> r
                            .header("X-User-Id", claims.getSubject())
                            .header("X-User-Role", claims.get("role", String.class))
                    )
                    .build();
            return chain.filter(mutatedExchange);
        } catch (Exception e) {
            log.warn("Token 验证失败: {}", e.getMessage());
            exchange.getResponse().setStatusCode(HttpStatus.UNAUTHORIZED);
            return exchange.getResponse().setComplete();
        }
    }

    @Override
    public int getOrder() {
        return -100;  // 优先级高，先于其他 Filter 执行
    }
}
```

**全局过滤器——请求日志：**

```java
@Component
@Slf4j
public class RequestLogFilter implements GlobalFilter, Ordered {

    @Override
    public Mono<Void> filter(ServerWebExchange exchange, GatewayFilterChain chain) {
        long startTime = System.currentTimeMillis();
        ServerHttpRequest request = exchange.getRequest();

        log.info("→ {} {} from {}",
                request.getMethod(),
                request.getURI().getPath(),
                request.getRemoteAddress());

        return chain.filter(exchange).then(Mono.fromRunnable(() -> {
            long duration = System.currentTimeMillis() - startTime;
            int statusCode = exchange.getResponse().getStatusCode() != null
                    ? exchange.getResponse().getStatusCode().value() : 0;

            log.info("← {} {} → {} ({}ms)",
                    request.getMethod(),
                    request.getURI().getPath(),
                    statusCode,
                    duration);
        }));
    }

    @Override
    public int getOrder() {
        return -200;  // 最高优先级，记录所有请求（包括被拦截的）
    }
}
```

**Filter 执行顺序：**

```
请求进入
  ↓
Gateway Filter（配置在路由上的 Filter，如 StripPrefix、AddRequestHeader）
  ↓
Global Filter（全局过滤器，按 Order 值从小到大执行）
  ↓
转发到下游服务
  ↓
Global Filter 响应阶段（按 Order 值从大到小执行）
  ↓
Gateway Filter 响应阶段
  ↓
响应返回客户端
```

**踩坑提醒：**
- Filter 中如果需要读取请求 Body（POST 请求体），需要 **缓存** Body（`ServerWebExchangeUtils.cacheRequestBody`），因为 Netty 的请求体只能读一次
- `getOrder()` 返回值越小优先级越高，认证 Filter 应该比日志 Filter 先执行（Order 更小）
- 全局 Filter 的 `filter()` 方法中如果 **不调用 `chain.filter()`**，请求会被直接拦截
