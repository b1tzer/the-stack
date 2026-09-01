# Spring Boot 集成

## 1. 配置

```yaml
spring:
  datasource:
    url: jdbc:mysql://localhost:3306/mydb?useSSL=false&serverTimezone=Asia/Shanghai
    username: root
    password: secret
    driver-class-name: com.mysql.cj.jdbc.Driver
    hikari:
      maximum-pool-size: 20
      minimum-idle: 5
```

## 2. JPA 适配

```yaml
spring:
  jpa:
    database-platform: org.hibernate.dialect.MySQL8Dialect
    hibernate:
      ddl-auto: update
```

## 3. MyBatis 适配

```xml
<!-- 返回自增主键 -->
<insert id="insert" useGeneratedKeys="true" keyProperty="id">
    INSERT INTO users (name, email) VALUES (#{name}, #{email})
</insert>

<!-- 批量插入 -->
<insert id="batchInsert">
    INSERT INTO users (name, email) VALUES
    <foreach collection="list" item="item" separator=",">
        (#{item.name}, #{item.email})
    </foreach>
</insert>
```

## 4. 连接池配置（HikariCP）

```yaml
spring:
  datasource:
    hikari:
      # 连接池名称
      pool-name: MyHikariPool
      # 最大连接数（推荐：CPU 核数 * 2 + 磁盘数）
      maximum-pool-size: 20
      # 最小空闲连接数
      minimum-idle: 5
      # 连接超时时间（毫秒）
      connection-timeout: 30000
      # 空闲连接超时（毫秒）
      idle-timeout: 600000
      # 连接最大生命周期（毫秒）
      max-lifetime: 1800000
      # 连接测试查询
      connection-test-query: SELECT 1
```

```java
// 自定义数据源配置
@Configuration
public class DataSourceConfig {
    
    @Bean
    @ConfigurationProperties("spring.datasource.hikari")
    public HikariDataSource dataSource() {
        return DataSourceBuilder.create().type(HikariDataSource.class).build();
    }
}
```

## 5. 多数据源配置

```java
@Configuration
public class MultiDataSourceConfig {
    
    @Bean("masterDataSource")
    @ConfigurationProperties("spring.datasource.master")
    public DataSource masterDataSource() {
        return DataSourceBuilder.create().build();
    }
    
    @Bean("slaveDataSource")
    @ConfigurationProperties("spring.datasource.slave")
    public DataSource slaveDataSource() {
        return DataSourceBuilder.create().build();
    }
    
    @Bean
    @Primary
    public DataSource routingDataSource(
            @Qualifier("masterDataSource") DataSource master,
            @Qualifier("slaveDataSource") DataSource slave) {
        Map<Object, Object> targetDataSources = new HashMap<>();
        targetDataSources.put("master", master);
        targetDataSources.put("slave", slave);
        
        AbstractRoutingDataSource routingDataSource = new ReadWriteRoutingDataSource();
        routingDataSource.setDefaultTargetDataSource(master);
        routingDataSource.setTargetDataSources(targetDataSources);
        return routingDataSource;
    }
}

// 动态数据源路由
public class ReadWriteRoutingDataSource extends AbstractRoutingDataSource {
    private static final ThreadLocal<String> CONTEXT = new ThreadLocal<>();
    
    public static void useMaster() { CONTEXT.set("master"); }
    public static void useSlave() { CONTEXT.set("slave"); }
    public static void clear() { CONTEXT.remove(); }
    
    @Override
    protected Object determineCurrentLookupKey() {
        return CONTEXT.get();
    }
}
```

## 6. MyBatis 高级配置

```java
// 自定义类型处理器
@MappedTypes(LocalDateTime.class)
public class LocalDateTimeTypeHandler extends BaseTypeHandler<LocalDateTime> {
    @Override
    public void setNonNullParameter(PreparedStatement ps, int i, LocalDateTime parameter, JdbcType jdbcType) throws SQLException {
        ps.setTimestamp(i, Timestamp.valueOf(parameter));
    }
    
    @Override
    public LocalDateTime getNullableResult(ResultSet rs, String columnName) throws SQLException {
        Timestamp ts = rs.getTimestamp(columnName);
        return ts != null ? ts.toLocalDateTime() : null;
    }
    // ... 其他方法
}

// 动态 SQL
@Select("<script>" +
    "SELECT * FROM users WHERE 1=1 " +
    "<if test='name != null'>AND name = #{name}</if> " +
    "<if test='age != null'>AND age = #{age}</if> " +
    "<if test='status != null'>AND status = #{status}</if> " +
    "</script>")
List<User> findByCondition(UserQuery query);
```

## 7. 事务管理

```java
@Service
public class OrderService {
    
    @Autowired
    private OrderRepository orderRepository;
    
    @Autowired
    private InventoryService inventoryService;
    
    // 声明式事务
    @Transactional(rollbackFor = Exception.class)
    public Order createOrder(OrderRequest request) {
        // 扣减库存
        inventoryService.deduct(request.getProductId(), request.getQuantity());
        
        // 创建订单
        Order order = new Order();
        order.setUserId(request.getUserId());
        order.setProductId(request.getProductId());
        order.setQuantity(request.getQuantity());
        order.setStatus("created");
        return orderRepository.save(order);
    }
    
    // 编程式事务
    @Autowired
    private TransactionTemplate transactionTemplate;
    
    public Order createOrderProgrammatic(OrderRequest request) {
        return transactionTemplate.execute(status -> {
            try {
                inventoryService.deduct(request.getProductId(), request.getQuantity());
                Order order = new Order();
                // ... 设置订单属性
                return orderRepository.save(order);
            } catch (Exception e) {
                status.setRollbackOnly();
                throw e;
            }
        });
    }
}
```

## 8. 最佳实践

1. **使用 HikariCP 连接池** — 性能最好的连接池
2. **连接池大小合理设置** — 不是越大越好
3. **读写分离使用动态数据源** — 透明切换读写
4. **MyBatis 使用 #{} 防止 SQL 注入**
5. **事务注解指定 rollbackFor** — 默认只回滚 RuntimeException
6. **避免在事务中做远程调用** — 缩短事务时间
7. **批量操作使用 batch 模式** — 减少网络往返

