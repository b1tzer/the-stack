# Testcontainers 与数据库测试

> H2 和 MySQL 的行为差异让测试通过但生产报错——`GROUP_CONCAT` 分隔符默认不同、`JSON` 类型支持不同。Testcontainers 在测试时启动真实的 Docker 容器解决这个问题。

---

## 1. @DataJpaTest + H2 嵌入式数据库

`@DataJpaTest` 默认使用内存数据库（H2），自动回滚事务，适合快速验证 Repository 层：

```java
@DataJpaTest  // 自动配置 H2 内存数据库 + 事务回滚
class UserRepositoryTest {

    @Autowired
    private UserRepository userRepository;

    @Autowired
    private TestEntityManager entityManager;

    @Test
    @DisplayName("按用户名查询 - 应该返回用户")
    void shouldFindByUsername() {
        // TestEntityManager 直接操作数据库
        User saved = entityManager.persistAndFlush(new User(null, "alice", "a@b.com"));

        Optional<User> found = userRepository.findByUsername("alice");

        assertTrue(found.isPresent());
        assertEquals(saved.getId(), found.get().getId());
    }

    @Test
    @DisplayName("按邮箱查询 - 不存在时返回空")
    void shouldReturnEmptyForNonExistentEmail() {
        Optional<User> found = userRepository.findByEmail("nonexistent@email.com");
        assertTrue(found.isEmpty());
    }

    @Test
    @DisplayName("模糊查询 - 按名字包含")
    void shouldFindByNameContaining() {
        entityManager.persistAndFlush(new User(null, "张三丰", "a@test.com"));
        entityManager.persistAndFlush(new User(null, "张无忌", "b@test.com"));
        entityManager.persistAndFlush(new User(null, "李四", "c@test.com"));

        List<User> result = userRepository.findByNameContaining("张");
        assertEquals(2, result.size());
    }
}
```

> **踩坑提醒**：H2 的 SQL 方言和 MySQL 不完全兼容。`AUTO_INCREMENT`、`JSON` 类型、`GROUP_CONCAT` 等函数在 H2 中语法不同。如果项目用了 MySQL 特有语法，考虑用 Testcontainers。

---

## 2. Testcontainers 基础配置

### 2.1 Maven 依赖

```xml
<dependency>
    <groupId>org.testcontainers</groupId>
    <artifactId>mysql</artifactId>
    <scope>test</scope>
</dependency>
<dependency>
    <groupId>org.testcontainers</groupId>
    <artifactId>junit-jupiter</artifactId>
    <scope>test</scope>
</dependency>
```

### 2.2 基本用法

```java
@SpringBootTest
@Testcontainers
class UserRepositoryContainerTest {

    @Container
    static MySQLContainer<?> mysql = new MySQLContainer<>("mysql:8.0")
            .withDatabaseName("testdb")
            .withUsername("test")
            .withPassword("test")
            .withInitScript("schema.sql");  // 启动时执行建表脚本

    @DynamicPropertySource
    static void configureProperties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", mysql::getJdbcUrl);
        registry.add("spring.datasource.username", mysql::getUsername);
        registry.add("spring.datasource.password", mysql::getPassword);
    }

    @Autowired
    private UserRepository userRepository;

    @Test
    @DisplayName("原生 JSON 查询 - 在真实 MySQL 上测试")
    void shouldQueryByJsonField() {
        User user = new User();
        user.setUsername("alice");
        user.setMetadata("{\"level\": 3, \"vip\": true}");
        userRepository.save(user);

        // 这个查询用了 MySQL 的 JSON 函数，H2 不支持
        List<User> result = userRepository.findByMetadataLevel(3);
        assertFalse(result.isEmpty());
    }
}
```

### 2.3 多容器组合

```java
@SpringBootTest
@Testcontainers
class MultiContainerTest {

    @Container
    static MySQLContainer<?> mysql = new MySQLContainer<>("mysql:8.0")
        .withDatabaseName("testdb")
        .withUsername("test")
        .withPassword("test")
        .withInitScript("schema.sql");

    @Container
    static GenericContainer<?> redis = new GenericContainer<>("redis:7-alpine")
        .withExposedPorts(6379);

    @Container
    static KafkaContainer kafka = new KafkaContainer(
        DockerImageName.parse("confluentinc/cp-kafka:7.5.0"));

    @DynamicPropertySource
    static void configureProperties(DynamicPropertyRegistry registry) {
        // MySQL
        registry.add("spring.datasource.url", mysql::getJdbcUrl);
        registry.add("spring.datasource.username", mysql::getUsername);
        registry.add("spring.datasource.password", mysql::getPassword);

        // Redis
        registry.add("spring.data.redis.host", redis::getHost);
        registry.add("spring.data.redis.port", () -> redis.getMappedPort(6379));

        // Kafka
        registry.add("spring.kafka.bootstrap-servers", kafka::getBootstrapServers);
    }

    @Test
    void testWithRealDependencies() {
        // 使用真实的 MySQL、Redis、Kafka 进行测试
    }
}
```

### 2.4 支持的容器类型

```java
// Redis
@Container
static GenericContainer<?> redis = new GenericContainer<>("redis:7")
        .withExposedPorts(6379);

// PostgreSQL
@Container
static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:16")
        .withDatabaseName("testdb");

// MongoDB
@Container
static MongoDBContainer mongo = new MongoDBContainer("mongo:7");

// Kafka
@Container
static KafkaContainer kafka = new KafkaContainer(
        DockerImageName.parse("confluentinc/cp-kafka:7.5.0"));
```

---

## 3. 测试数据管理

### 3.1 @Transactional 自动回滚（最常用）

```java
@DataJpaTest
class UserRepositoryTest {

    @Autowired
    private UserRepository userRepository;

    @Test
    @Transactional  // 测试结束后自动回滚，不会污染其他测试
    void shouldSaveAndRollback() {
        userRepository.save(new User(null, "alice", "a@b.com"));
        assertEquals(1, userRepository.count());
        // 方法结束后事务回滚，数据库恢复原状
    }

    @Test
    @Transactional
    @Rollback(false)  // 特殊情况：不回滚（调试用）
    void shouldPersistPermanently() {
        userRepository.save(new User(null, "bob", "b@b.com"));
    }
}
```

### 3.2 @Sql 脚本初始化

```java
@DataJpaTest
class OrderQueryTest {

    // 使用 @Sql 注入测试数据
    @Test
    @Sql(scripts = "/test-data/users.sql")
    @DisplayName("查询活跃用户 - 应该过滤非活跃")
    void shouldFindActiveUsers() {
        List<User> activeUsers = userRepository.findByStatus("ACTIVE");
        assertFalse(activeUsers.isEmpty());
        activeUsers.forEach(u -> assertEquals("ACTIVE", u.getStatus()));
    }

    // 多脚本 + 执行阶段控制
    @Test
    @SqlGroup({
        @Sql(value = "/test-data/users.sql", executionPhase = Sql.ExecutionPhase.BEFORE_TEST_METHOD),
        @Sql(value = "/test-data/products.sql", executionPhase = Sql.ExecutionPhase.BEFORE_TEST_METHOD),
        @Sql(value = "/test-data/orders.sql", executionPhase = Sql.ExecutionPhase.BEFORE_TEST_METHOD),
        @Sql(value = "/test-data/cleanup.sql", executionPhase = Sql.ExecutionPhase.AFTER_TEST_METHOD)
    })
    void shouldQueryComplexOrders() {
        List<Order> orders = orderRepository.findByDateRange(...);
        assertFalse(orders.isEmpty());
    }
}
```

测试数据初始化 SQL（`src/test/resources/test-data/users.sql`）：

```sql
INSERT INTO users (username, email, status) VALUES ('alice', 'alice@test.com', 'ACTIVE');
INSERT INTO users (username, email, status) VALUES ('bob', 'bob@test.com', 'INACTIVE');
INSERT INTO users (username, email, status) VALUES ('charlie', 'charlie@test.com', 'ACTIVE');
```

### 3.3 @SqlConfig 精细控制

```java
@Sql(
    scripts = "/test-data/init.sql",
    config = @SqlConfig(
        encoding = "UTF-8",
        separator = ";",
        transactionMode = SqlConfig.TransactionMode.ISOLATED  // 独立事务执行
    )
)
```

### 3.4 类级别 @Sql

```java
// 用类级别注解，所有方法都生效
@DataJpaTest
@Sql("/test-data/base-data.sql")
class OrderRepositoryTest {
    // ... 所有测试方法都会先执行 base-data.sql
}
```

### 3.5 三种策略对比

| 策略 | 优点 | 缺点 | 适用场景 |
|------|------|------|--------|
| `@Transactional` 自动回滚 | 简单，无副作用 | 无法测试事务行为 | 简单 CRUD 测试 |
| `@Sql` 脚本 | 可复用，数据可控 | SQL 文件多，维护成本 | 复杂查询、报表 |
| `@SqlConfig` | 精细控制 | 配置复杂 | 特殊数据需求 |

> **踩坑提醒**：`@DataJpaTest` 默认带 `@Transactional` 且自动回滚。如果测试方法中调用了 `entityManager.flush()`，数据会写入数据库但最终回滚。如果同时用了 `@Sql`，SQL 在事务外执行，不会回滚。

---

## 4. Testcontainers 高级用法

### 4.1 容器复用

```java
@Container
static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:15")
    .withDatabaseName("test")
    .withUsername("test")
    .withPassword("test")
    .withReuse(true);  // 容器复用（需配置 testcontainers.reuse.enable=true）
```

在 `~/.testcontainers.properties` 中启用：

```properties
testcontainers.reuse.enable=true
```

### 4.2 测试基类抽取

```java
// 测试基类：所有需要数据库的测试继承此类
public abstract class AbstractDatabaseTest {

    @Container
    protected static final MySQLContainer<?> mysql =
        new MySQLContainer<>("mysql:8.0")
            .withDatabaseName("testdb")
            .withUsername("test")
            .withPassword("test");

    @DynamicPropertySource
    static void configureDataSource(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", mysql::getJdbcUrl);
        registry.add("spring.datasource.username", mysql::getUsername);
        registry.add("spring.datasource.password", mysql::getPassword);
    }
}

// 子类继承基类，自动获得数据库配置
@SpringBootTest
class UserRepositoryTest extends AbstractDatabaseTest {

    @Autowired
    private UserRepository userRepository;

    @Test
    void testSaveAndFind() {
        User user = userRepository.save(new User(null, "张三", "zhangsan@test.com"));
        assertNotNull(user.getId());

        Optional<User> found = userRepository.findById(user.getId());
        assertTrue(found.isPresent());
    }
}
```

### 4.3 自定义容器

```java
// 自定义 Nacos 容器
public class NacosContainer extends GenericContainer<NacosContainer> {

    public NacosContainer() {
        super("nacos/nacos-server:v2.3.0");
        withExposedPorts(8848, 9848);
        withEnv("MODE", "standalone");
        withEnv("SPRING_DATASOURCE_PLATFORM", "");
    }

    public String getGrpcPort() {
        return String.valueOf(getMappedPort(9848));
    }

    public String getHttpPort() {
        return String.valueOf(getMappedPort(8848));
    }
}

// 使用
@SpringBootTest
@Testcontainers
class NacosIntegrationTest {

    @Container
    static NacosContainer nacos = new NacosContainer();

    @DynamicPropertySource
    static void configure(DynamicPropertyRegistry registry) {
        registry.add("spring.cloud.nacos.config.server-addr",
            () -> nacos.getHost() + ":" + nacos.getHttpPort());
    }

    @Test
    void testConfigFromNacos() {
        // 测试从 Nacos 读取配置
    }
}
```

---

## 5. H2 vs Testcontainers 选型

| 维度 | H2 内存数据库 | Testcontainers |
|------|-------------|----------------|
| 启动速度 | 极快（毫秒） | 慢（5-30 秒） |
| 方言兼容 | ❌ 不完全兼容 | ✅ 完全一致 |
| CI 依赖 | 无 | 需要 Docker |
| 测试可信度 | 中（可能误通过） | 高（和生产一致） |
| 适用场景 | 简单 CRUD | 复杂 SQL、JSON、存储过程 |

> **经验法则**：简单项目用 H2 够了。如果用了 MySQL/PostgreSQL 特有功能（JSON 类型、全文索引、存储过程），必须用 Testcontainers。

---

## 最佳实践

1. **容器复用**——配置 `withReuse(true)` + `~/.testcontainers.properties` 中 `testcontainers.reuse.enable=true`
2. **初始化脚本**——`withInitScript("schema.sql")` 自动建表，无需手动执行 DDL
3. **使用固定版本镜像**——`"mysql:8.0"` 而非 `"mysql:latest"`，保证测试可重复
4. **测试基类抽取公共容器**——避免每个测试类都重复配置容器
5. **CI/CD 集成**——确保 CI 环境支持 Docker，否则 Testcontainers 无法运行
6. **并行测试**——Testcontainers 支持并行执行，但端口会动态分配，不会冲突
