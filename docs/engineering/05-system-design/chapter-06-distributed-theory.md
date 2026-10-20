# CAP 理论与 BASE 理论

> **核心问题**：分布式系统为什么不能同时满足一致性、可用性和分区容错性？工程实践中如何在 C 和 A 之间做取舍？BASE 理论如何指导系统设计？

## 1. 类比：分布式系统的"不可能三角"

就像"便宜、好、快"三者难以兼得，分布式系统中"一致性、可用性、分区容错性"也无法同时满足三个。更准确地说，P 是前提，只能在 C 和 A 之间取舍（详见 §7）。

## 2. CAP 三要素

![CAP 三要素](/java/cap-triangle.svg)

### 2.1 三要素详解

| 要素 | 含义 | 通俗理解 | 衡量标准 |
| :-- | :-- | :-- | :-- |
| **一致性（C）** | 所有节点在同一时刻看到相同的数据 | 你在 ATM-A 存了 100 元，立刻在 ATM-B 能查到 | 线性一致性（Linearizability） |
| **可用性（A）** | 每个请求都能在合理时间内收到非错误响应 | 系统不会返回超时或错误，但数据可能不是最新的 | 每个请求都有响应 |
| **分区容错性（P）** | 网络分区（节点间通信中断）时系统仍能运行 | 机房之间网络断了，系统还能工作 | 网络故障时系统不停机 |

## 3. 为什么 CAP 不可兼得？

**分布式系统中，网络分区（P）是必然发生的**（网络不可靠），因此实际上只能在 **C 和 A 之间做取舍**。

### 3.1 用一个例子说明

![网络分区下 CP 与 AP 的取舍](/java/cap-partition-choice.svg)

> **为什么 P 不可放弃**：分布式系统中，网络分区是客观存在的（网络抖动、机器宕机、光纤被挖断），无法避免。因此 P 是前提，只能在 C 和 A 之间权衡。单机系统没有网络分区问题，所以可以同时满足 CA。

## 4. CP vs AP：如何选择？

### 4.1 常见系统的行为倾向

> **说明**：下表给出的是各系统在**默认配置与典型操作**下的取舍倾向，用于快速选型参考，并非绝对归类。CAP 讨论的是网络分区发生时一致性与可用性的具体保证，实际行为取决于读写路径、故障检测、选举策略与客户端路由，同一产品在不同配置下可能表现出不同取舍（例如 Cassandra 可调一致性级别，MongoDB 可通过 readConcern/writeConcern 调整）。

| 系统 | 类型 | 原因 | 适用场景 |
| :-- | :-- | :-- | :-- |
| **MySQL（单机）** | CA | 单机无网络分区问题 | 单机 OLTP |
| **MySQL（主从）** | CP | 主库宕机时从库不提供写服务（默认异步复制，切换时可能丢失未同步数据） | 需要强一致性的业务 |
| **ZooKeeper** | CP | Leader 选举期间不可用，但数据强一致 | 配置中心、分布式锁 |
| **etcd** | CP | Raft 协议保证强一致，少数节点故障时可能不可用 | K8s 元数据存储 |
| **Redis Cluster** | AP | 异步复制，主节点宕机时副本可能数据不一致，且可能丢失已确认写入 | 缓存、会话存储 |
| **Eureka** | AP | 节点间同步失败时仍提供服务发现 | 服务注册发现 |
| **Nacos** | CP/AP 可配置 | 注册中心用 AP，配置中心用 CP | 微服务基础设施 |
| **Elasticsearch** | AP | 主分片写入后即返回，副本异步，允许短暂不一致 | 搜索、日志分析 |
| **Cassandra** | AP（可调） | 一致性级别影响读写所需副本响应数，默认最终一致 | 大规模写入场景 |
| **MongoDB** | CP（默认） | 默认读写主节点，保证受 readConcern/writeConcern 与读取路径影响 | 文档存储 |

### 4.2 选型决策指南

![CAP 选型决策树](/java/cap-decision-tree.svg)

| 业务场景 | 推荐选型 | 原因 |
| :-- | :-- | :-- |
| **金融转账** | CP | 数据不一致会导致资金损失 |
| **分布式锁** | CP | 锁不一致会导致并发问题 |
| **配置中心** | CP | 配置不一致会导致系统行为异常 |
| **服务注册发现** | AP | 短暂的服务列表不一致可以容忍 |
| **缓存** | AP | 缓存不一致可以通过过期策略解决 |
| **搜索引擎** | AP | 搜索结果短暂不一致用户无感知 |
| **电商下单** | AP + 补偿 | 优先可用（用户能下单），通过消息队列保证最终一致 |

## 5. 一致性模型

CAP 中的"一致性"只是最严格的线性一致性，实际工程中有多种一致性级别可选。

| 一致性级别 | 含义 | 典型代价 | 示例 |
| :-- | :-- | :-- | :-- |
| **强一致性（线性一致性）** | 写入后立即可读到最新值 | 需多数派确认或全局协调，延迟较高 | etcd、正确实现的分布式锁 |
| **顺序一致性** | 所有节点看到的操作顺序一致 | 需维护全局操作顺序 | ZooKeeper（写全局有序，读可滞后） |
| **因果一致性** | 有因果关系的操作顺序一致 | 需传播因果依赖 | 社交网络（先发帖再评论） |
| **最终一致性** | 一段时间后所有节点数据一致 | 无同步等待，存在不一致窗口 | DNS、Redis 主从 |

> **读己之写**是会话一致性保证（自己写的数据自己能立即读到，如修改个人信息后刷新页面），并非与上述模型并列的强弱级别，可与其他一致性模型组合使用。

> 分布式锁需要的是互斥语义，其正确实现追求线性一致性，但并非所有分布式锁实现都天然具备这一保证，取决于锁在故障、租约到期时能否维持互斥（详见 §10）。

> 更强的一致性通常需要更多协调或等待，但延迟、吞吐量与分区期间的可用性取决于具体协议和拓扑，不存在适用于所有系统的固定排序；上表的「典型代价」只是粗略提示，并非严格的单调关系。

> **工程建议**：大多数业务场景不需要强一致性，**最终一致性 + 读己之写**已能覆盖大部分需求。是否需要强一致性，取决于业务不变量是否必须立即成立、超卖或重复写入是否会造成不可接受的损失，以及系统是否有能力检测并修复不一致，而不是由业务类别本身决定。金融转账、扣减库存通常要求强一致，但具体仍取决于超卖容忍度与并发控制设计。

## 6. BASE 理论（CAP 的工程实践）

> **BASE**：**B**asically **A**vailable（基本可用）+ **S**oft State（软状态）+ **E**ventually Consistent（最终一致性）

BASE 是对 CAP 中 AP 方案的工程化总结，核心思想是：**不追求强一致性，允许数据在一段时间内不一致，但最终会达到一致状态**。

### 6.1 三要素详解

#### 6.1.1 基本可用（Basically Available）

系统出现故障时，允许损失部分功能，但核心功能仍然可用。

| 场景 | 正常情况 | 基本可用（降级） |
| :-- | :-- | :-- |
| 电商搜索 | 返回精确结果 + 个性化推荐 | 返回基础搜索结果，关闭推荐 |
| 秒杀 | 所有用户都能访问 | 部分用户被引导到排队页面 |
| 支付 | 实时到账 | 显示"处理中"，异步到账 |

#### 6.1.2 软状态（Soft State）

允许系统中的数据存在中间状态（不同节点的数据副本之间可以有延迟）。

```txt
硬状态：数据要么是 A，要么是 B，没有中间状态
软状态：数据可以处于"同步中"的中间状态

示例：
- 订单状态：已支付 → 同步中（软状态）→ 已发货
- MySQL 主从：主库写入 → 同步延迟（软状态）→ 从库更新
```

#### 6.1.3 最终一致性（Eventually Consistent）

经过一段时间后，所有节点的数据最终会达到一致状态。

![最终一致性：主从同步与缓存失效](/java/base-eventual-consistency.svg)

### 6.2 最终一致性的实现模式

| 模式 | 原理 | 适用场景 | 示例 |
| :-- | :-- | :-- | :-- |
| **读时修复** | 读取时发现不一致，触发修复 | 读多写少 | Cassandra Read Repair |
| **延迟补写** | 副本不可用时暂存写入提示，副本恢复后补写 | 可容忍副本短暂落后 | Dynamo Hinted Handoff |
| **异步修复** | 后台定时任务对比修复 | 对实时性要求不高 | 反熵（Anti-Entropy）协议 |
| **消息队列** | 通过 MQ 异步同步数据 | 跨服务数据同步 | 订单 → MQ → 库存扣减 |
| **Binlog 订阅** | 订阅数据库变更日志 | DB 与缓存/ES 同步 | Canal 监听 MySQL Binlog |

### 6.3 工程实践案例

#### 6.3.1 电商下单流程中的 BASE

![电商下单的 BASE 实践](/java/base-ecommerce-order.svg)

## 7. CAP 的常见误解

| 误解 | 真相 |
| :-- | :-- |
| CAP 只能三选二 | 更准确地说：P 是前提，在 C 和 A 之间做取舍。而且不是全局二选一，可以针对不同操作做不同选择 |
| CP 系统完全不可用 | CP 系统在网络分区时**部分不可用**，分区恢复后立即可用。正常情况下 C、A、P 都满足 |
| AP 系统数据永远不一致 | AP 系统在网络分区时**暂时不一致**；分区恢复后，具备相应修复与冲突解决机制的系统数据会收敛到一致状态（最终一致性） |
| 单机系统不需要考虑 CAP | 单机系统没有 P 的问题，可以同时满足 CA。但单机系统有单点故障风险 |
| CAP 是精确的数学定理 | CAP 更像是一个指导原则，实际系统中 C 和 A 都有程度之分，不是非黑即白 |

## 8. 常见问题

**Q：CAP 理论中，为什么 P 不可放弃？**

> 分布式系统中，网络分区是客观存在的（网络抖动、机器宕机、光纤被挖断），无法避免。因此 P 是前提，只能在 C 和 A 之间权衡。如果放弃 P，那就是单机系统，不是分布式系统。

**Q：CAP 选型常见错误？**

> ① 强一致性场景（如金融转账）选了 AP 系统，导致数据不一致造成资金损失；② 高可用场景（如服务注册发现）选了 CP 系统，导致 Leader 选举期间服务不可用；③ 不区分场景，全部用 CP 或全部用 AP，正确做法是根据不同业务场景选择不同策略。

**Q：最终一致性的"最终"是多久？**

> 取决于具体实现。MySQL 主从同步通常是毫秒到秒级；消息队列异步处理通常是秒级；DNS 传播可能是分钟到小时级。关键是业务能否接受这个延迟窗口。

**Q：如何在代码中实现最终一致性？**

> 最常用的模式是**本地消息表 + 消息队列**：① 业务操作和消息写入在同一个本地事务中；② 后台任务扫描消息表，发送到 MQ；③ 消费者处理消息，实现跨服务数据同步。这样即使 MQ 暂时不可用，消息也不会丢失。

**Q：Nacos 为什么同时支持 CP 和 AP？**

> Nacos 针对不同场景使用不同协议：注册中心使用 AP 模式（Distro 协议），因为服务发现需要高可用，短暂的服务列表不一致可以容忍；配置中心使用 CP 模式（Raft 协议），因为配置不一致会导致系统行为异常。这是"按场景选择"的最佳实践。

## 9. 分布式事务

### 9.1 为什么需要分布式事务

当一个业务操作跨多个服务、多个数据库时，本地事务无法保证原子性：

```txt
用户下单：
  1. 订单服务 → 创建订单（订单库）
  2. 库存服务 → 扣减库存（库存库）
  3. 账户服务 → 扣减余额（账户库）

  如果步骤 3 失败了，步骤 1 和 2 怎么办？
```

### 9.2 两阶段提交（2PC）

```txt
阶段1：准备（Prepare）          阶段2：提交（Commit/Rollback）

  ┌──────────┐                   ┌──────────┐
  │ 协调者    │                   │ 协调者    │
  └────┬─────┘                   └────┬─────┘
       │ Prepare                      │ Commit
  ┌────┼────────┐                ┌────┼────────┐
  │    │        │                │    │        │
  ▼    ▼        ▼                ▼    ▼        ▼
┌───┐┌───┐  ┌───┐            ┌───┐┌───┐  ┌───┐
│ A ││ B │  │ C │            │ A ││ B │  │ C │
│YES││YES│  │YES│            │ ✓ ││ ✓ │  │ ✓ │
└───┘└───┘  └───┘            └───┘└───┘  └───┘
```

```java
// 基于数据库 XA 协议的 2PC 实现（以 Atomikos 为例）
@Configuration
public class XaDataSourceConfig {

    @Bean
    public DataSource orderDataSource() {
        MysqlXaDataSource xa = new MysqlXaDataSource();
        xa.setUrl("jdbc:mysql://order-host:3306/order_db");
        xa.setUser("root");
        xa.setPassword("****");
        return new AtomikosDataSourceBean(xa);
    }

    @Bean
    public DataSource inventoryDataSource() {
        MysqlXaDataSource xa = new MysqlXaDataSource();
        xa.setUrl("jdbc:mysql://inventory-host:3306/inventory_db");
        xa.setUser("root");
        xa.setPassword("****");
        return new AtomikosDataSourceBean(xa);
    }
}

// 使用 JTA 管理分布式事务
@Service
public class OrderService {

    @Transactional  // 由 JtaTransactionManager 驱动，将两个 XA 数据源纳入同一全局事务
    public void createOrder(OrderRequest request) {
        orderDao.insert(request.getOrder());       // 数据库 1
        inventoryDao.deduct(request.getItems());    // 数据库 2
        // 提交决议形成前发生可回滚错误，协调器会回滚两个数据库；
        // 提交阶段或协调者故障后，可能需要事务恢复，存在启发式结果
    }
}
```

> 上述示例省略了 `JtaTransactionManager` 的配置：两个 `AtomikosDataSourceBean` 必须注册到同一个 JTA 事务管理器，`@Transactional` 才会经由该管理器开启全局事务。若缺少这一步，两个 DAO 操作只是各自独立的本地事务，并不会跨库回滚。

### 9.3 TCC（Try-Confirm-Cancel）

TCC 将一个分布式事务拆成三个阶段，每个参与者的 Try、Confirm、Cancel 各自在本地事务内执行，由事务协调器统一调度（以下示例基于 Seata TCC 注解）：

```java
// TCC 模式示例：订单创建（基于 Seata TCC，@TwoPhaseBusinessAction 为 Seata 注解）
// 1. Try：预留资源
@Service
public class OrderTccService {

    @TwoPhaseBusinessAction(
        name = "createOrder",
        commitMethod = "confirm",
        rollbackMethod = "cancel"
    )
    public boolean tryCreate(
            BusinessActionContext context,
            @BusinessActionContextParameter(paramName = "order") Order order) {
        // 冻结库存（不是真正扣减）
        inventoryDao.freeze(order.getProductId(), order.getQuantity());
        // 冻结余额（不是真正扣减）
        accountDao.freeze(order.getUserId(), order.getAmount());
        // 创建预订单（状态：待确认）
        orderDao.insert(order, OrderStatus.TRYING);
        return true;
    }

    // 2. Confirm：确认提交
    public boolean confirm(BusinessActionContext context) {
        Order order = (Order) context.getActionContext("order");
        inventoryDao.confirmFreeze(order.getProductId(), order.getQuantity());
        accountDao.confirmFreeze(order.getUserId(), order.getAmount());
        orderDao.updateStatus(order.getId(), OrderStatus.CONFIRMED);
        return true;
    }

    // 3. Cancel：回滚释放
    public boolean cancel(BusinessActionContext context) {
        Order order = (Order) context.getActionContext("order");
        inventoryDao.releaseFreeze(order.getProductId(), order.getQuantity());
        accountDao.releaseFreeze(order.getUserId(), order.getAmount());
        orderDao.updateStatus(order.getId(), OrderStatus.CANCELLED);
        return true;
    }
}
```

> **事务边界与异常处理**：Try 阶段的冻结库存、冻结余额、创建预订单通常分属不同服务或数据库，各自是独立本地事务。若库存冻结成功而余额冻结失败，协调器会触发 Cancel 释放已冻结的库存，因此 Cancel 必须**幂等**（重复执行不产生副作用）。此外还需处理两类边界：**空回滚**（Try 未执行成功却收到 Cancel，需能识别并直接返回）与**悬挂**（Cancel 先于 Try 到达，需防止随后到达的 Try 覆盖已回滚的状态）。上述示例聚焦预留/确认/取消三段结构，省略了上下文参数序列化与反序列化、分支事务状态记录、重复回调处理等实现细节，这些由 Seata 框架与业务侧共同完成。

### 9.4 Saga 模式

Saga 将长事务拆成一系列本地事务，每个事务有对应的补偿操作：

```txt
正向流程：T1 → T2 → T3 → T4（成功）
补偿流程：T1 → T2 → T3(失败) → C2 → C1（回滚）

T1: 创建订单    →  C1: 取消订单
T2: 扣减库存    →  C2: 恢复库存
T3: 扣减余额    →  C3: 恢复余额
T4: 通知发货    →  C4: 取消发货
```

```java
// Saga 编排模式（概念示意，注解非真实框架 API）
@Component
public class OrderSaga {

    @SagaCompensable(cancelMethod = "cancelCreateOrder")
    public void createOrder(Order order) {
        orderDao.insert(order);
    }

    @SagaCompensable(cancelMethod = "cancelDeductInventory")
    public void deductInventory(Order order) {
        inventoryDao.deduct(order.getProductId(), order.getQuantity());
    }

    @SagaCompensable(cancelMethod = "cancelDeductBalance")
    public void deductBalance(Order order) {
        accountDao.deduct(order.getUserId(), order.getAmount());
    }

    // 补偿方法
    public void cancelCreateOrder(Order order) {
        orderDao.cancel(order.getId());
    }

    public void cancelDeductInventory(Order order) {
        inventoryDao.restore(order.getProductId(), order.getQuantity());
    }

    public void cancelDeductBalance(Order order) {
        accountDao.refund(order.getUserId(), order.getAmount());
    }
}
```

> **框架说明**：上述 `@SagaCompensable` 为概念示意，并非可直接运行的真实框架注解。Seata 的 Saga 实现主要通过**状态机 JSON**（StateMachine）定义服务调用与补偿关系，再由 `StateMachineEngine` 执行；Temporal 则采用代码编排 + 自动持久化。无论哪种实现，补偿操作都必须**幂等**：网络重试或重复投递可能导致同一补偿执行多次。

### 9.5 分布式事务方案对比

| 维度 | 2PC/XA | TCC | Saga | 本地消息表 |
| :-- | :-- | :-- | :-- | :-- |
| **原理** | 协调者统一 Prepare/Commit | 预留→确认→取消 | 正向操作+补偿操作 | 消息表+定时轮询 |
| **一致性** | 强一致（协议目标，故障恢复期可能阻塞） | 最终一致 | 最终一致 | 最终一致 |
| **性能** | 低（阻塞等待） | 中 | 中高 | 高 |
| **业务侵入** | 低（框架处理） | 高（需实现 Try/Confirm/Cancel） | 中（需实现补偿） | 低 |
| **锁粒度** | 数据库行锁（长时间持有） | 业务级资源冻结 | 无全局锁（本地事务仍有数据库锁） | 无跨库锁 |
| **适用场景** | 单体/少量数据库 | 资金交易、高一致性要求 | 长流程、跨多服务 | 异步最终一致 |
| **异常处理** | 回滚简单 | Cancel 需幂等 | 补偿需幂等 | 消息需幂等 |
| **典型框架** | Atomikos、Narayana | Seata TCC | Seata Saga、Temporal | RocketMQ 事务消息 |

## 10. 分布式锁

### 10.1 为什么需要分布式锁

在单机环境下，Java 的 `synchronized` 或 `ReentrantLock` 就能解决并发问题。但在分布式系统中，多个 JVM 进程运行在不同机器上，JVM 级别的锁失效了：

```txt
  JVM-1 (机器A)              JVM-2 (机器B)
  ┌─────────────┐           ┌─────────────┐
  │ synchronized│           │ synchronized│
  │ 锁对象=本地  │           │ 锁对象=本地  │
  │ ✓ 获得锁    │           │ ✓ 也获得锁  │  ← 两个都拿到了！
  │ 扣减库存     │           │ 扣减库存     │  ← 超卖了！
  └─────────────┘           └─────────────┘
```

### 10.2 Redis 实现分布式锁

```java
// 基础版：SET NX EX
public class RedisDistributedLock {

    private final StringRedisTemplate redis;
    private static final String LOCK_PREFIX = "lock:";

    public boolean tryLock(String lockKey, String requestId, long expireSeconds) {
        Boolean result = redis.opsForValue().setIfAbsent(
            LOCK_PREFIX + lockKey,
            requestId,
            Duration.ofSeconds(expireSeconds)
        );
        return Boolean.TRUE.equals(result);
    }

    // 释放锁：必须用 Lua 脚本保证原子性（判断 + 删除）
    public boolean unlock(String lockKey, String requestId) {
        String script = """
            if redis.call('get', KEYS[1]) == ARGV[1] then
                return redis.call('del', KEYS[1])
            else
                return 0
            end
            """;
        Long result = redis.execute(
            new DefaultRedisScript<>(script, Long.class),
            List.of(LOCK_PREFIX + lockKey),
            requestId
        );
        return Long.valueOf(1L).equals(result);
    }
}
```

**为什么用 requestId？** 防止误删别人的锁。线程 A 的锁过期后，线程 B 获得了锁，如果 A 执行完直接 `del`，会把 B 的锁删掉。

### 10.3 Redisson 看门狗机制

Redisson 提供了更健壮的分布式锁实现，核心特性是**看门狗（Watchdog）自动续期**：

```java
// Redisson 分布式锁
@Service
public class InventoryService {

    @Autowired
    private RedissonClient redisson;

    public void deductStock(Long productId, int quantity) {
        RLock lock = redisson.getLock("lock:stock:" + productId);

        try {
            // 尝试获取锁，最多等待 10 秒，锁自动过期 30 秒
            // 看门狗会在后台每 10 秒续期一次（默认过期时间的 1/3）
            if (lock.tryLock(10, TimeUnit.SECONDS)) {
                // 业务逻辑
                Stock stock = stockMapper.selectByProductId(productId);
                if (stock.getQuantity() >= quantity) {
                    stockMapper.deduct(productId, quantity);
                } else {
                    throw new BusinessException("库存不足");
                }
            } else {
                throw new BusinessException("获取锁超时");
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new BusinessException("获取锁被中断");
        } finally {
            if (lock.isHeldByCurrentThread()) {
                lock.unlock();
            }
        }
    }
}
```

```txt
看门狗续期机制：

  线程 A 获取锁（过期时间 30s）
  │
  ├─ 0s: 获取锁成功
  ├─ 10s: 看门狗续期 → 过期时间重置为 30s
  ├─ 20s: 看门狗续期 → 过期时间重置为 30s
  ├─ 25s: 业务完成，主动释放锁
  │
  └─ 如果线程 A 崩溃 → 没有续期 → 30s 后锁自动过期 → 不会死锁
```

> **看门狗的边界**：看门狗解决的是「业务正常执行期间的租约续期」问题，并不能消除所有锁失效窗口。当客户端进程暂停（GC 停顿、CPU 抢占）、网络隔离或 Redis 主从故障转移时，服务端的锁可能已过期并被其他客户端取得，而原持有者仍在继续执行。对于库存、账户这类必须严格防止过期持有者继续写入的资源，仅靠看门狗不够，还需要**栅栏令牌（Fencing Token）**：每次获取锁时生成一个单调递增的令牌，受保护资源（存储层）在写入时校验令牌，拒绝小于已接受最大令牌的过期写入。注意令牌必须与成功授予的锁正确关联，且资源端需可靠持久化已接受的最大令牌，仅在客户端生成递增数字并不构成保护。

### 10.4 ZooKeeper 实现分布式锁

```java
// ZooKeeper 临时顺序节点实现分布式锁
public class ZookeeperDistributedLock {

    private final CuratorFramework client;
    private static final String LOCK_PATH = "/locks";

    public InterProcessMutex getLock(String lockKey) {
        return new InterProcessMutex(client, LOCK_PATH + "/" + lockKey);
    }
}

// 使用
@Service
public class OrderService {

    @Autowired
    private ZookeeperDistributedLock zkLock;

    public void createOrder(OrderRequest request) {
        InterProcessMutex lock = zkLock.getLock("create-order");
        boolean acquired = false;
        try {
            acquired = lock.acquire(10, TimeUnit.SECONDS);
            if (!acquired) {
                throw new BusinessException("获取锁超时");
            }
            doCreateOrder(request);
        } finally {
            if (acquired) {
                lock.release();
            }
        }
    }
}
```

> 说明：示例省略了方法签名中的 `throws Exception`。Curator 的 `InterProcessMutex.acquire(long, TimeUnit)` 与 `release()` 均抛出受检异常，实际使用时需在方法签名声明或捕获处理，示例中暂以省略保持聚焦。

```txt
ZooKeeper 锁原理（临时顺序节点）：

  /locks/create-order/
    ├── _c_000000001  ← 线程A创建（最小，获得锁）
    ├── _c_000000002  ← 线程B创建（监听 001）
    └── _c_000000003  ← 线程C创建（监听 002）

  线程A释放 → 临时节点删除 → 线程B收到通知 → 获得锁
  线程B崩溃 → 临时节点自动删除 → 线程C收到通知 → 获得锁
```

### 10.5 分布式锁方案对比

| 维度 | Redis (SET NX) | Redis (Redisson) | ZooKeeper | 数据库唯一索引 |
| :-- | :-- | :-- | :-- | :-- |
| **性能** | 极高（内存操作） | 高 | 中（写 ZK 日志） | 低（磁盘 IO） |
| **可靠性** | 中（主从切换可能丢锁） | 高（看门狗续期） | 高（临时节点自动清理） | 中（依赖数据库可用性） |
| **可重入** | 需自行实现 | 内置支持 | 内置支持 | 需自行实现 |
| **公平性** | 非公平 | 可配置公平锁 | 公平（顺序节点） | 非公平 |
| **阻塞等待** | 需自行实现（轮询） | 内置支持 | 内置支持（Watcher） | 需自行实现 |
| **锁超时** | 过期时间 | 看门狗自动续期 | 临时节点随会话 | 需定时清理 |
| **适用场景** | 简单互斥、低一致性 | 通用分布式锁 | 强一致要求 | 简单场景、无额外组件 |
| **额外依赖** | Redis | Redis + Redisson | ZooKeeper | 无 |

### 10.6 Redlock：Redis 多节点锁

单个 Redis 实例的主从切换可能导致锁丢失，Redis 作者 Antirez 提出了 Redlock 算法：

```java
// Redisson Redlock 实现
RLock lock1 = redisson1.getLock("lock:resource");
RLock lock2 = redisson2.getLock("lock:resource");
RLock lock3 = redisson3.getLock("lock:resource");

// 在 3 个独立 Redis 实例上获取锁，多数成功才算获得锁
RedissonRedLock redLock = new RedissonRedLock(lock1, lock2, lock3);

boolean acquired = false;
try {
    // 最多等待 10 秒，锁自动过期 30 秒
    acquired = redLock.tryLock(10, 30, TimeUnit.SECONDS);
    if (acquired) {
        // 业务逻辑
    }
} finally {
    if (acquired) {
        redLock.unlock();
    }
}
```

> **争议**：Martin Kleppmann 在 2016 年发文《How to do distributed locking》指出，Redlock 依赖多个 Redis 节点的时钟近似同步，时钟漂移或进程暂停（如 GC 停顿超过租约时长）会导致两个客户端同时认为自己持有锁。因此 Redlock 只提供「尽力而为」的互斥，不构成严格的安全保证。若资源写入需要严格互斥，应在存储层加**栅栏令牌（Fencing Token）**校验，而非仅依赖客户端锁。实际工程中，如果对一致性要求极高，建议使用 ZooKeeper 或 Etcd；如果业务能容忍极小概率的锁失效，Redis 方案的性能优势更明显。
