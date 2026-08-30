# 多数据源

## 1. 配置

```yaml
spring:
  datasource:
    master:
      url: jdbc:mysql://master:3306/db
      username: root
      password: root
    slave:
      url: jdbc:mysql://slave:3306/db
      username: root
      password: root
```

## 2. 动态数据源

```java
public class DynamicDataSource extends AbstractRoutingDataSource {
    @Override
    protected Object determineCurrentLookupKey() {
        return DataSourceContextHolder.get();
    }
}

// 使用
@Target({METHOD, TYPE})
@Retention(RUNTIME)
public @interface DS {
    String value() default "master";
}
```

## 3. 读写分离

```java
@Aspect
@Component
public class DataSourceAspect {
    @Before("@annotation(slave)")
    public void before(JoinPoint point, Slave slave) {
        DataSourceContextHolder.set("slave");
    }
    
    @After("@annotation(slave)")
    public void after(JoinPoint point, Slave slave) {
        DataSourceContextHolder.clear();
    }
}
```

## 4. 分库分表方案

### 4.1 ShardingSphere-JDBC 集成

ShardingSphere 是 Apache 开源的分布式数据库中间件，支持分库分表、读写分离、分布式事务。

```xml
<dependency>
    <groupId>org.apache.shardingsphere</groupId>
    <artifactId>shardingsphere-jdbc-core-spring-boot-starter</artifactId>
    <version>5.4.1</version>
</dependency>
```

```yaml
# application.yml
spring:
  shardingsphere:
    datasource:
      names: ds0, ds1
      ds0:
        type: com.zaxxer.hikari.HikariDataSource
        driver-class-name: com.mysql.cj.jdbc.Driver
        jdbc-url: jdbc:mysql://db0:3306/order_db
        username: root
        password: ${DB_PASSWORD}
      ds1:
        type: com.zaxxer.hikari.HikariDataSource
        driver-class-name: com.mysql.cj.jdbc.Driver
        jdbc-url: jdbc:mysql://db1:3306/order_db
        username: root
        password: ${DB_PASSWORD}

    rules:
      sharding:
        tables:
          orders:
            actual-data-nodes: ds$->{0..1}.orders_$->{0..15}
            table-strategy:
              standard:
                sharding-column: user_id
                sharding-algorithm-name: orders-inline
            database-strategy:
              standard:
                sharding-column: user_id
                sharding-algorithm-name: db-inline
        sharding-algorithms:
          orders-inline:
            type: INLINE
            props:
              algorithm-expression: orders_$->{user_id % 16}
          db-inline:
            type: INLINE
            props:
              algorithm-expression: ds$->{user_id % 2}
```

### 4.2 动态数据源 + 分库分表完整方案

```java
// 分库分表后的查询完全透明
@Service
public class OrderService {

    @Autowired
    private OrderMapper orderMapper;

    // ShardingSphere 自动路由到正确的库和表
    @Transactional
    public Order createOrder(OrderRequest request) {
        Order order = new Order();
        order.setUserId(request.getUserId());  // 分片键
        order.setOrderNo(generateOrderNo());
        order.setTotalAmount(request.getAmount());
        orderMapper.insert(order);  // 自动路由到 ds{user_id%2}.orders_{user_id%16}
        return order;
    }

    // 查询也会自动路由
    public Order getOrder(Long orderId, Long userId) {
        // 必须携带分片键，否则会广播查询所有库表
        return orderMapper.selectByIdAndUserId(orderId, userId);
    }
}
```

### 4.3 读写分离配置

```yaml
spring:
  shardingsphere:
    rules:
      readwrite-splitting:
        data-sources:
          order-ds:
            write-data-source-name: ds-master
            read-data-source-names: ds-slave-0, ds-slave-1
            load-balancer-name: round-robin
        load-balancers:
          round-robin:
            type: ROUND_ROBIN
```

### 4.4 ShardingSphere 与自定义动态数据源对比

| 特性 | 自定义动态数据源 | ShardingSphere |
|------|----------------|----------------|
| 适用场景 | 2-3 个异构数据源 | 大规模同构分库分表 |
| 分片能力 | 不支持 | 内置分片算法 |
| 分布式事务 | 需自行实现 | 内置 XA / Seata |
| SQL 改写 | 不支持 | 自动改写、路由、归并 |
| 学习成本 | 低 | 中等 |
| 运维复杂度 | 低 | 中等（需管理分片规则） |

**最佳实践：**

1. **分片键选择**——选择查询频率最高的字段（如 `user_id`），避免跨库查询
2. **分表数量**——预估未来 3-5 年数据量，一般 16 或 64 张表
3. **全局 ID**——使用 Snowflake 或 Leaf 生成分布式唯一 ID，避免自增主键冲突
4. **避免跨库 JOIN**——将关联数据冗余或通过应用层聚合
5. **先读写分离，再分库分表**——读写分离能解决 80% 的性能问题
