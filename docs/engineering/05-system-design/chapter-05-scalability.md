# 可扩展设计

> **核心问题**：如何让系统支持 10 倍、100 倍的流量增长？分库分表怎么做？读写分离的实现？

## 1. 水平扩展原则

```java
// 无状态设计：任何请求可以被任何实例处理
// 有状态 → 无状态

// 差：Session 保存在本地
session.setAttribute(\"user\", user);

// 好：Session 保存在 Redis
// Spring Session 配置
// spring.session.store-type=redis
// spring.session.timeout=1800
```

## 2. 读写分离

```java
// 使用 ShardingSphere 实现读写分离
// 配置 application.yml：
// spring:
//   shardingsphere:
//     datasource:
//       names: master,slave0,slave1
//       master:
//         type: com.zaxxer.hikari.HikariDataSource
//         jdbc-url: jdbc:mysql://master:3306/db
//       slave0:
//         jdbc-url: jdbc:mysql://slave0:3306/db
//       slave1:
//         jdbc-url: jdbc:mysql://slave1:3306/db
//     rules:
//       readwrite-splitting:
//         data-sources:
//           ds:
//             write-data-source-name: master
//             read-data-source-names: slave0,slave1
//             load-balancer-name: round-robin

// 以上是 ShardingSphere 读写分离的默认路由示意，实际行为依赖版本与配置
// 事务内读、写后紧跟的读需强制走主库，见 §8.6
@Service
public class UserService {
    @Transactional  // 写操作路由到主库
    public void updateUser(User user) {
        userRepository.save(user);
    }
    
    public User findById(Long id) {  // 读操作默认路由到从库
        return userRepository.findById(id).orElse(null);
    }
}
```

## 3. 分库分表

```java
// 水平分表：按 user_id 取模分 8 张表
// orders_0, orders_1, ..., orders_7

// ShardingSphere 分片配置
// rules:
//   sharding:
//     tables:
//       orders:
//         actual-data-nodes: ds.orders_$->{0..7}
//         table-strategy:
//           standard:
//             sharding-column: user_id
//             sharding-algorithm-name: orders-inline
//     sharding-algorithms:
//       orders-inline:
//         type: INLINE
//         props:
//           algorithm-expression: orders_$->{user_id % 8}

// 分库分表后的查询问题
// 差：全局排序（需要合并所有分片结果）
// SELECT * FROM orders ORDER BY created_at DESC LIMIT 10;

// 好：带分片键查询（只查一个分片）
// SELECT * FROM orders WHERE user_id = 123 ORDER BY created_at DESC LIMIT 10;
```

## 4. 分布式 ID 生成

分库分表之后自增主键失效，需要全局唯一的 ID。UUID、雪花算法、号段模式三种方案的原理与选型见 [分布式 ID 生成](../../scenarios/04-data-access/chapter-04-distributed-id.md)。

方法论上有一条关键判断：ID 生成逻辑要集中封装，别散落在业务代码各处；是否独立部署成发号服务，取决于规模与选型。逻辑散落之后想换方案，才是一场全量改造。

## 5. 扩展策略选择

| 策略 | 适用场景 | 复杂度 |
| :-- | :-- | :-- |
| 垂直拆分 | 按业务拆数据库 | 低 |
| 读写分离 | 读多写少 | 中 |
| 分库分表 | 单表行数过大（参考 §6.1 阈值） | 高 |
| 分布式缓存 | 热点数据读取 | 中 |

> **核心原则**：扩展性设计要在合适的时间做。过早引入分库分表会增加不必要的复杂度。先优化单机性能，再考虑水平扩展。

## 6. 分库分表设计

### 6.1 什么时候需要分库分表

以下阈值是常见经验参考值，不是硬性触发条件。实际边界取决于行宽、索引规模、查询模式、硬件规格与增长预测，拆分前应结合慢查询、执行计划、磁盘 I/O 与备份恢复窗口综合判断。

| 指标 | 阈值 | 说明 |
| :-- | :-- | :-- |
| 单表行数 | > 2000 万行 | 单表过大，索引与扫描成本上升 |
| 单库数据量 | > 500 GB | 备份恢复时间过长 |
| 单库 QPS | > 5000 | 连接数、IO 成为瓶颈 |
| 写入 TPS | > 2000/s | 锁竞争严重 |

垂直拆分按业务拆库（订单库、用户库），解决不同业务的资源竞争；水平拆分按规则拆表（orders_0 ~ orders_3），解决单表数据量过大的问题。

### 6.2 分片键选择

分片键（Sharding Key）决定了数据如何分布，是分库分表设计中最关键的决策：

| 分片键选择 | 优点 | 缺点 | 适用场景 |
| :-- | :-- | :-- | :-- |
| 用户 ID | 同一用户数据在同一分片 | 大卖家/大V 成为热点 | 电商订单、社交动态 |
| 订单 ID | 数据均匀分布 | 跨用户查询需要广播 | 通用订单系统 |
| 时间 | 按时间范围查询高效 | 写入热点在最新分片 | 日志、监控数据 |

### 6.3 路由方式

| 路由方式 | 原理 | 查询效率 | 适用 SQL |
| :-- | :-- | :-- | :-- |
| 精确路由 | 根据分片键直接定位 | 最高（只查 1 个分片） | `WHERE user_id = ?` |
| 范围路由 | 按范围定位部分分片 | 高（查部分分片） | `WHERE create_time BETWEEN ? AND ?` |
| 广播路由 | 遍历所有分片 | 最低（查所有分片） | `WHERE status = 'PAID'`（无分片键） |

### 6.4 ShardingSphere 配置示例

以下为简化片段，省略了数据源类型、连接池等完整配置，不能直接复制使用。具体算法类型与配置项随 ShardingSphere 版本而异，此处仅展示配置结构与设计意图。

```yaml
spring:
  shardingsphere:
    datasource:
      names: ds0,ds1
      ds0:
        url: jdbc:mysql://host1:3306/order_db_0
      ds1:
        url: jdbc:mysql://host2:3306/order_db_1
    rules:
      sharding:
        tables:
          orders:
            actual-data-nodes: ds$->{0..1}.orders_$->{0..3}
            table-strategy:
              standard:
                sharding-column: user_id
                sharding-algorithm-name: order-mod
        sharding-algorithms:
          order-mod:
            type: MOD
            props:
              sharding-count: 4
```

### 6.5 扩容策略

| 策略 | 停机时间 | 数据迁移 | 复杂度 | 推荐场景 |
| :-- | :-- | :-- | :-- | :-- |
| 停机迁移 | 数小时 | 全量迁移 | 低 | 初创期、可接受停机 |
| 双写 | 无 | 新旧库同时写 | 中 | 中小规模 |
| 影子表 | 无 | 增量同步 + 切换 | 高 | 大规模、不停机 |

双写扩容流程：阶段1 双写（旧库为主）→ 阶段2 数据校验 → 阶段3 切换（新库为主）→ 阶段4 下线旧库。

## 7. 数据冷热分离

### 7.1 冷热数据的定义

```txt
┌─────────────────────────────────────────────┐
│  热数据（Hot）  ~10%   最近 1~7 天           │
│  存储：Redis / SSD    要求：毫秒级响应       │
├─────────────────────────────────────────────┤
│  温数据（Warm） ~30%   最近 1~6 个月         │
│  存储：MySQL SSD      要求：秒级响应         │
├─────────────────────────────────────────────┤
│  冷数据（Cold） ~60%   6 个月以前            │
│  存储：对象存储/HDD   要求：分钟级可接受     │
└─────────────────────────────────────────────┘
```

### 7.2 实现方案

```java
// 双查兜底：先查热库，未命中再查冷库
// 代价是热库未命中时引入额外延迟；仅凭热库未命中也无法区分「记录不存在」与「已归档」
// 能按订单时间或归档索引定位存储位置时，应优先直接路由
public Order getOrder(Long orderId) {
    Order cached = (Order) redis.opsForValue().get("order:" + orderId);
    if (cached != null) return cached;

    Order order = hotOrderMapper.selectById(orderId);
    if (order == null) {
        order = coldOrderMapper.selectById(orderId);  // 热库没有再查冷库
    }
    return order;
}
```

数据库分区也是一种方案，MySQL 按时间范围分区后，归档时 `ALTER TABLE orders DROP PARTITION p2023` 通常比逐行删除快得多，但仍涉及元数据锁与 DDL，耗时受表结构、版本与并发负载影响，并非完全不锁表。定时归档任务则在凌晨低峰期分批将老数据从热库迁移到冷库。

## 8. 多数据源一致性

### 8.1 问题背景

数据往往需要同时存在于多个存储中（MySQL + ES + Redis + 数据仓库），如何保证它们之间的数据一致？

### 8.2 方案一：同步双写

```java
@Transactional
public void createProduct(Product product) {
    productMapper.insert(product);            // 写 MySQL
    elasticsearchTemplate.save(product);      // 写 ES
    redis.opsForValue().set("product:" + product.getId(), product); // 写 Redis
}
```

注意：`@Transactional` 只管理对应事务管理器支持的资源，MySQL 的提交不会让 ES、Redis 的写入一起回滚，三者不构成原子事务。

优点是实现简单、实时性强；缺点是任意一个失败都会影响主流程，性能差且强耦合。

### 8.3 方案二：Canal 异步同步

通过监听 MySQL binlog，异步同步到其他数据源：

```txt
应用 → MySQL(写入) → binlog → Canal Server → MQ → ES/HBase/...
```

```java
// Canal 消费者：监听 binlog 变更，同步到 ES
@RabbitListener(queues = "canal.product")
public void onCanalMessage(CanalMessage message) {
    if ("product".equals(message.getTable())) {
        switch (message.getType()) {
            case INSERT, UPDATE -> esTemplate.save(convertToProduct(message.getRowData()));
            case DELETE -> esTemplate.delete(message.getRowData().get("id")); // 主键需从旧行镜像提取，取决于消息结构
        }
    }
}
```

优点是业务代码无侵入、新增数据源只需加消费者；缺点是有秒级延迟、Canal 本身需要高可用。

### 8.4 方案三：最终一致 + 对账

在异步同步的基础上，增加定时对账机制作为兜底。以下为示意代码，跨存储对象直接 equals 比较、源记录已删除时的 null、差异 ID 全量内存暂存都不适合直接用于生产，生产实现应基于业务字段或版本号比较、分批处理并区分增删改。

这段代码只核对 MySQL 现存记录，无法发现 ES 中多出来的孤儿文档。生产对账还应反向检查目标端多余记录，才能覆盖增、删、改三类差异。

```java
@Scheduled(cron = "0 0 3 * * ?")  // 每天凌晨 3 点对账
public void reconcile() {
    List<Long> mismatchIds = new ArrayList<>();
    // 分页对比 MySQL 和 ES 数据，找出不一致的记录
    int page = 0;
    while (true) {
        List<Product> dbProducts = productMapper.selectPage(page++, 1000);
        if (dbProducts.isEmpty()) break;
        for (Product p : dbProducts) {
            Product esP = esTemplate.get(p.getId());
            if (esP == null || !esP.equals(p)) mismatchIds.add(p.getId());
        }
    }
    // 修复不一致数据
    mismatchIds.forEach(id -> esTemplate.save(productMapper.selectById(id)));
}
```

### 8.5 方案对比

| 维度 | 同步双写 | Canal 异步同步 | 最终一致+对账 |
| :-- | :-- | :-- | :-- |
| **实时性** | 实时 | 秒级延迟 | 分钟/小时级修复 |
| **业务侵入** | 高（需改写入逻辑） | 低（监听 binlog） | 低（独立任务） |
| **可靠性** | 中（任一失败影响主流程） | 中高（依赖位点持久化、重试与幂等） | 高（对账兜底，取决于对账范围与修复正确性） |
| **性能影响** | 大（串行多写） | 小（异步） | 低（后台任务，仍消耗 CPU 与 I/O） |
| **推荐指数** | ⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ |

> **最佳实践**：Canal 异步同步 + 定时对账的组合是业界常见做法。Canal 负责实时同步，对账负责兜底纠错，两者互补。但最终一致性成立的前提是对账范围完整、比较逻辑正确且修复失败可重试，否则对账兜不住底。

### 8.6 读写分离的主从延迟问题

读写分离写走主库、读走从库，各司其职，但主从复制存在 100ms~1s 的延迟。用户刚下单就查订单列表，写请求在主库已成功，读请求却打到还没同步的从库，就会看到"订单不存在"。

**三种应对策略**：

**策略一：关键读走主库**

用 `@Master` 注解标记需要读主库的方法：

```java
@Target({ElementType.METHOD})
@Retention(RetentionPolicy.RUNTIME)
public @interface Master {}

// 写操作后紧跟的读操作，强制走主库
@Master
public Order getOrderAfterCreate(Long orderId) {
    return orderRepository.findById(orderId);  // 走主库
}
```

**策略二：写后短暂强制读主库（ThreadLocal 标记）**

```java
// 在切面中，写操作完成后设置 ThreadLocal 标记
@After("@annotation(Transactional)")
public void afterWrite() {
    ReadWriteContext.forceMaster(Duration.ofSeconds(2));  // 2 秒内读主库
}

// 数据源路由时检查标记
@Override
protected Object determineCurrentLookupKey() {
    if (ReadWriteContext.isForceMaster()) return "master";
    return ReadWriteContext.isRead() ? "slave" : "master";
}
```

标记的清理时机必须与强制读主库的窗口匹配：不能在写方法退出时立即清除，否则覆盖不了写后的短暂延迟窗口；也不应无限期保留。应在请求结束时（如 Filter 的 finally 块）可靠清理，否则线程池复用的下一个请求会读到过期的强制主库标记。

上面代码是示意，两点不能照搬：`forceMaster(Duration.ofSeconds(2))` 的 2 秒有效期不会由 ThreadLocal 自动实现，需要内部存时间戳并在路由时判断是否过期；`@After("@annotation(Transactional)")` 在方法返回时触发，不等于事务已经提交，覆盖提交后读请求时需明确事务提交时机与标记作用范围。

该方案只适用于同一请求内写后读的场景；跨请求的写后读一致性不能依赖 ThreadLocal（请求级状态无法跨请求传递），需要另行设计。

**策略三：接受延迟（非关键场景）**

对于个人中心、商品列表等非关键场景，1 秒的延迟可以接受，不需要特殊处理。用户稍后刷新通常能看到最新数据，但复制异常时延迟可能持续更久。

**选择建议**：支付结果、订单状态等关键场景用策略一；写后立即读的场景用策略二；非关键场景用策略三。所有读都强制走主库时，读写分离就退化为单库读写。
