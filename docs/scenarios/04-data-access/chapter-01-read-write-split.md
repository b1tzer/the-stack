# 读写分离

> 读写分离要回答一个具体问题：读流量把主库压垮之前，该不该拆、怎么拆。本章只讲场景决策，组件搭建细节用相对链接指向 PostgreSQL 与 Spring 的权威章节。

## 1. 什么时候需要读写分离

读写分离解决的是一个具体矛盾：读请求和写请求抢同一台数据库的 CPU 与连接。读请求通常占八成以上，又大多能容忍秒级延迟，把它们分流到只读副本，主库就能腾出资源专心处理写入。

判断该不该上，先看两个数字。

| 指标 | 临界值 | 判断 |
| :-- | :-- | :-- |
| QPS | 单库不足 5000 | 不用拆，先加索引、加缓存 |
| 读写比 | 读占比不足 80% | 拆了收益有限 |

单库 QPS 不足 5000 时，瓶颈大概率不在读写争抢，而在缺索引、缓存没生效或 SQL 本身慢。这时拆主从是解决错了问题，还白添一份复制延迟与一致性维护成本。

拆之前先算清代价。主从复制有延迟，写后立刻读可能读到旧数据；多一套副本、连接池、路由逻辑，故障面随之变大。只有读压力确实成了主库瓶颈、且读能接受秒级延迟时，读写分离才划算。

## 2. 三段式架构

读写分离在物理上是三段，各解决一个层次的问题。

```txt
应用层路由   决定一条 SQL 走主还是走从
    ↓
连接池       复用连接，压平连接数
    ↓
主从复制     把数据同步到副本，让读有地方去
```

| 段 | 解决的问题 | 落地组件 |
| :-- | :-- | :-- |
| 主从复制 | 数据同步，读请求有副本可去 | PostgreSQL 流复制 |
| 连接池 | PG 每连接一个进程，连接数是大头开销 | PgBouncer |
| 应用层路由 | 一条 SQL 走主还是走从 | Spring `AbstractRoutingDataSource` |

三段彼此解耦。复制搭好后，从库就是一个普通只读库；连接池把读写两端各自池化；应用层路由决定请求走向。任何一段都能单独替换，但少了任何一段，读写分离都不完整。

### 2.1 主从复制

流复制搭建属于 PostgreSQL 组件配置，从 `wal_level = replica`、`pg_hba.conf` 复制权限，到 `pg_basebackup` 拉基础备份、`standby.signal` 启动从库，完整步骤见 [流复制](../../postgresql/09-ha/chapter-01-streaming-replication)。

这里只强调一个场景决策：读写分离默认用异步复制，`synchronous_standby_names` 留空。同步复制要求主库每次写都等从库确认，写延迟直接翻倍，与「把读分流出去」的目标相悖。只有金融级、不能丢数据的场景才启用同步复制。

### 2.2 连接池

PostgreSQL 每个连接是一个独立 OS 进程，fork 一个连接的开销远高于 MySQL 的线程模型，上千应用连接直连数据库时，连接管理本身就成瓶颈。场景结论只有一句，用 PgBouncer 做连接池化，`pool_mode` 选 `transaction`。事务结束即归还连接，与 Spring `@Transactional` 的事务粒度天然对齐。

### 2.3 应用层路由

多数据源的基础配置见 [Spring 多数据源](../../spring/04-data-access/chapter-06-multi-datasource)，本章第 3 节给出读写分离场景下的完整路由实现。

## 3. 应用层路由

路由是读写分离最该花心思的一层，也最容易写错。核心是三个组件配合，`AbstractRoutingDataSource` 提供运行时切换数据源的能力，`ThreadLocal` 记录当前线程该走哪个库，AOP 切面在方法入口写标记、出口清标记。

### 3.1 数据源上下文

```java
/**
 * 数据源上下文：用 ThreadLocal 标记当前线程该走读还是走写
 */
public class DataSourceContext {
    private static final ThreadLocal<String> CONTEXT = new ThreadLocal<>();

    public static void useWrite() { CONTEXT.set("write"); }  // ✍️ 标记走主库
    public static void useRead()  { CONTEXT.set("read"); }   // 📖 标记走从库
    public static void clear()    { CONTEXT.remove(); }      // 🧹 清理，防串号
    public static String get()    { return CONTEXT.get(); }
}
```

用 `ThreadLocal` 而非全局变量，是因为路由标记必须跟线程走。一个请求一个线程，标记跟着请求生命周期，请求结束必须 `remove`，否则线程被连接池、Tomcat 线程池复用后，上一个请求的标记会串到下一个请求。

### 3.2 路由数据源

```java
/**
 * 路由数据源：每次要连接时，根据 DataSourceContext 决定用哪个真实数据源
 */
public class ReadWriteRoutingDataSource extends AbstractRoutingDataSource {
    @Override
    protected Object determineCurrentLookupKey() {
        return DataSourceContext.get();
    }
}
```

`AbstractRoutingDataSource` 的关键在 `determineCurrentLookupKey()`。Spring 每次向它要连接，都回调这个方法，拿返回值去 `targetDataSources` 这个 Map 里找对应的真实数据源。返回 null 时走默认数据源，也就是主库。

### 3.3 只读注解与切面

```java
/**
 * 只读注解：标在方法或类上，自动走从库
 */
@Target({ElementType.METHOD, ElementType.TYPE})
@Retention(RetentionPolicy.RUNTIME)
public @interface ReadOnly {}

/**
 * 切面：方法入口切数据源，出口清理
 */
@Aspect
@Component
@Order(Ordered.HIGHEST_PRECEDENCE)  // ⚠️ 必须排在 @Transactional 之前
public class DataSourceAspect {

    @Before("@annotation(readOnly) || @within(readOnly)")
    public void switchToRead(ReadOnly readOnly) {
        DataSourceContext.useRead();
    }

    @Before("@annotation(org.springframework.transaction.annotation.Transactional)")
    public void switchToWrite() {
        DataSourceContext.useWrite();
    }

    @After("@annotation(readOnly) || @within(readOnly) || @annotation(org.springframework.transaction.annotation.Transactional)")
    public void clear() {
        DataSourceContext.clear();
    }
}
```

`@Order(Ordered.HIGHEST_PRECEDENCE)` 是这层的命门。事务切面和数据源切面都拦在方法上，如果事务切面先执行，它拿连接时 `determineCurrentLookupKey()` 已被调用、数据源已定死，后面的切面再改 `ThreadLocal` 就晚了。数据源切面必须抢在事务切面前把标记写好。

### 3.4 Service 层使用

```java
@Service
public class OrderService {

    @Transactional  // 写事务，自动走主库
    public Order createOrder(CreateOrderRequest req) { ... }

    @ReadOnly  // 只读查询，自动走从库
    public Page<Order> listUserOrders(Long userId, Pageable pageable) {
        return orderRepository.findByUserId(userId, pageable);
    }

    @ReadOnly
    public OrderStatistics getStatistics(LocalDate from, LocalDate to) {
        return orderRepository.getStatistics(from, to);
    }
}
```

## 4. 写后读不一致

读写分离最尖锐的矛盾，是主库写成功后立刻从从库读会读到旧数据。复制不是同步的，从库永远比主库慢一拍，这一拍就是不一致窗口。处理方式有三种，按实现代价从低到高排列。

### 4.1 强制走主库

写操作之后紧跟的读，也走主库。既然这条读和刚写的写在同一台机器，就不存在复制延迟。

最干净的实现是复用事务标记。方法标了 `@Transactional`，切面已把它切到主库，方法内所有操作（含写后的读）都在主库事务里，天然一致：

```java
@Transactional
public Order createAndReturn(CreateOrderRequest req) {
    Order order = createOrder(req);  // 写主库
    // 同事务内的读也走主库，读到的就是刚写的数据
    return orderRepository.findById(order.getId()).orElseThrow();
}
```

不裹在事务里的写后读（比如写由消息驱动、读是另一个请求），在读入口显式调 `DataSourceContext.useWrite()` 即可。

代价是这条读没被分流。但它只影响「写后立刻读」这一小撮请求，绝大多数读仍走从库，整体收益不受损。

### 4.2 延迟读

能接受读到几秒前旧数据的场景，什么都不用做，直接走从库。列表页、统计页这类「差一秒无所谓」的读属于这一档。

```java
@ReadOnly
public List<Order> listRecentOrders(Long userId) {
    // 复制延迟下可能读到上一秒的列表，用户体验可接受
    return orderRepository.findTop20ByUserIdOrderByCreatedAtDesc(userId);
}
```

### 4.3 基于 LSN 等待

精确控制的思路是，写完后记录主库当前的 WAL 位置（LSN），轮询从库，等它回放到这个位置再读。LSN 是 PostgreSQL 里单调递增的字节偏移，天然适合当「追上没有」的判断依据。

```sql
SELECT pg_current_wal_lsn();      -- 主库：当前写到的 LSN
SELECT pg_last_wal_replay_lsn();  -- 从库：已回放到的 LSN
```

```java
public Order createOrderAndWaitRead(CreateOrderRequest req) {
    Order order = createOrder(req);  // 1. 写主库

    // 2. 拿到主库当前的 LSN
    String masterLsn = jdbcTemplate.queryForObject(
        "SELECT pg_current_wal_lsn()::text", String.class);

    // 3. 轮询从库，等它回放到这个 LSN，超时 3 秒放弃
    DataSourceContext.useRead();
    try {
        long deadline = System.currentTimeMillis() + 3000;
        while (System.currentTimeMillis() < deadline) {
            Boolean caughtUp = readJdbcTemplate.queryForObject(
                "SELECT pg_wal_lsn_diff(pg_last_wal_replay_lsn(), ?::pg_lsn) >= 0",
                Boolean.class, masterLsn);
            if (Boolean.TRUE.equals(caughtUp)) {
                break;
            }
            Thread.sleep(100);
        }
        return orderRepository.findById(order.getId()).orElseThrow();
    } finally {
        DataSourceContext.clear();
    }
}
```

这个方案每次写后读都要多跑一轮 SQL 加一段忙等，实现最复杂。它只在「读必须精确、又必须走从库」时才值得，比如支付后立刻查余额、且读 QPS 高到主库扛不住。

### 4.4 选型

| 方案 | 一致性 | 实现代价 | 适用场景 |
| :-- | :--: | :--: | :-- |
| 强制走主库 | 强 | 极低 | 写后立刻读，默认首选 |
| 延迟读 | 弱 | 无 | 列表、统计等容忍旧数据的读 |
| LSN 等待 | 强 | 高 | 读必须精确且读压力大 |

一句话判断，九成场景用强制走主库。只有读 QPS 高到必须把「写后读」也分流出去、且一致性不能妥协时，才上 LSN 等待。

## 5. 常见坑

### 5.1 prepared statement 失效

`transaction` 池化模式下，连接在事务结束即归还。Spring 的 prepared statement 缓存在归还后被清掉，下一次拿到的连接上没有这个 statement，报 `prepared statement does not exist`。

解决：要么在 JDBC 驱动侧关闭服务端 prepared statement，让 SQL 走简单协议；要么升级 PgBouncer 到 1.21+，它已支持协议级 prepared statement 透传，无需关闭。

### 5.2 SET 命令失效

`SET search_path = 'myschema'` 是会话级设置，事务结束、连接归还后，设置随连接一起消失，下一次拿到的连接又回到默认 schema。

解决：不在代码里 `SET`，把会话参数写进连接串的 `options`，让每次新建连接都带上。这类「依赖会话状态」的用法，本质和「连接不归你」的池化模型冲突，应消灭在源头。

### 5.3 从库大查询阻塞 vacuum

从库上一个跑很久的查询，会让主库无法清理该查询仍需要的旧行版本，主库表随之膨胀。

解决：开 `hot_standby_feedback`，让从库把最老活跃事务告诉主库；同时设 `max_standby_streaming_delay`，回放延迟超过阈值时取消从库上的冲突查询。宁可从库断一个查询，也不能让主库膨胀。

### 5.4 连接池耗尽

应用报 `Connection is not available, request timed out`，多半是长事务占着连接不放，池子被掏空。

排查先看有没有长时间运行的事务，再看业务里有没有大事务或慢 SQL 撑大事务时长。解法是给事务设超时，让超时事务回滚、释放连接。

```java
@Transactional(timeout = 30)  // 30 秒未完成即回滚，释放连接
public void longRunningTask() { ... }
```

## 6. 故障切换

主库宕机是绕不开的问题。手动切换用 `pg_promote()` 把从库提成主库，自动切换靠 Patroni 这类高可用组件做故障检测与选主。两者的配置与操作都属组件运维范畴，分别见 [流复制](../../postgresql/09-ha/chapter-01-streaming-replication) 的故障切换一节与 [高可用方案](../../postgresql/09-ha/chapter-03-ha-solutions)。

## 7. 总结

读写分离的决策顺序：先确认读压力确实压垮了主库，再按主从复制、连接池、应用层路由三段逐段落地，最后用强制走主库兜住写后读的一致性问题。组件细节不在此重复，遇到具体配置回对应权威章节查。
