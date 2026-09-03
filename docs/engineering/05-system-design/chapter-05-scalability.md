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

// 代码层面无需改变，自动路由
@Service
public class UserService {
    @Transactional  // 写操作自动路由到主库
    public void updateUser(User user) {
        userRepository.save(user);
    }
    
    public User findById(Long id) {  // 读操作自动路由到从库
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

```java
// 雪花算法（Snowflake）
public class SnowflakeIdGenerator {
    private final long datacenterId;
    private final long workerId;
    private long sequence = 0;
    private long lastTimestamp = -1;
    
    // 时间戳 | 数据中心 | 机器ID | 序列号
    // 41 bit  | 5 bit    | 5 bit  | 12 bit
    
    public synchronized long nextId() {
        long timestamp = System.currentTimeMillis();
        if (timestamp == lastTimestamp) {
            sequence = (sequence + 1) & 0xFFF;  // 4096
            if (sequence == 0) timestamp = waitNextMillis();
        } else {
            sequence = 0;
        }
        lastTimestamp = timestamp;
        return ((timestamp - 1288834974657L) << 22) |
               (datacenterId << 17) |
               (workerId << 12) |
               sequence;
    }
    
    private long waitNextMillis() {
        long ts = System.currentTimeMillis();
        while (ts <= lastTimestamp) ts = System.currentTimeMillis();
        return ts;
    }
}
```

## 5. 扩展策略选择

| 策略 | 适用场景 | 复杂度 |
| :-- | :-- | :-- |
| 垂直拆分 | 按业务拆数据库 | 低 |
| 读写分离 | 读多写少 | 中 |
| 分库分表 | 单表超过 1000 万行 | 高 |
| 分布式缓存 | 热点数据读取 | 中 |

> **核心原则**：扩展性设计要在合适的时间做。过早引入分库分表会增加不必要的复杂度。先优化单机性能，再考虑水平扩展。

## 6. 分库分表设计

### 6.1 什么时候需要分库分表

| 指标 | 阈值 | 说明 |
| :-- | :-- | :-- |
| 单表行数 | > 2000 万行 | B+ 树深度增加，查询变慢 |
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
| 精确路由 | 根据分片键直接定位 | 最高（O(1)） | `WHERE user_id = ?` |
| 范围路由 | 按范围定位部分分片 | 高 | `WHERE create_time BETWEEN ? AND ?` |
| 广播路由 | 遍历所有分片 | 最低（O(n)） | `WHERE status = 'PAID'`（无分片键） |

### 6.4 ShardingSphere 配置示例

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
// 应用层路由：根据数据时间选择查询热库或冷库
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

数据库分区也是一种方案，MySQL 按时间范围分区后，归档时 `ALTER TABLE orders DROP PARTITION p2023` 秒级完成，不锁表。定时归档任务则在凌晨低峰期分批将老数据从热库迁移到冷库。

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
            case DELETE -> esTemplate.delete(message.getRowData().get("id"));
        }
    }
}
```

优点是业务代码无侵入、新增数据源只需加消费者；缺点是有秒级延迟、Canal 本身需要高可用。

### 8.4 方案三：最终一致 + 对账

在异步同步的基础上，增加定时对账机制作为兜底：

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
| **可靠性** | 中（任一失败影响主流程） | 高（binlog 不丢） | 高（对账兜底） |
| **性能影响** | 大（串行多写） | 小（异步） | 无（后台任务） |
| **推荐指数** | ⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ |

> **最佳实践**：Canal 异步同步 + 定时对账的组合是业界主流方案。Canal 保证实时性，对账保证最终一致性，两者互补。

### 8.6 读写分离的主从延迟问题

读写分离看起来完美：写走主库，读走从库，各司其职。但你有没有想过：用户刚下了单，立刻查订单列表——写请求走主库成功了，读请求却打到了从库，从库还没同步过来。用户看到的是“订单不存在”。这不是理论推演，是每天都在发生的生产 Bug。

用户下单后立即查询订单，写请求走主库，读请求走从库。如果主从之间有 100ms~1s 的延迟，用户会看到"订单不存在"。这是一个真实且常见的生产问题。

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

**策略三：接受延迟（非关键场景）**

对于个人中心、商品列表等非关键场景，1 秒的延迟可以接受。不需要特殊处理，用户刷新一下就能看到最新数据。

**选择建议**：支付结果、订单状态等关键场景用策略一；写后立即读的场景用策略二；非关键场景用策略三。不要所有读都走主库——那就失去了读写分离的意义。
