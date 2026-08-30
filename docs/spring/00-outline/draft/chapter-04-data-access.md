# 第 04 章：数据访问与事务

## 4.1 Spring 数据访问抽象

### 4.1.1 独立使用 vs Spring 整合

**痛点**：自己写 MyBatis 要 6 步才能查个数据，Spring 整合后一个 `@Autowired` 就行——中间发生了什么？

#### 独立使用 MyBatis 的 6 步

```java
// 1. 读取配置文件
String resource = "mybatis-config.xml";
InputStream inputStream = Resources.getResourceAsStream(resource);

// 2. 构建 SqlSessionFactory
SqlSessionFactory sqlSessionFactory =
    new SqlSessionFactoryBuilder().build(inputStream);

// 3. 获取 SqlSession
SqlSession session = sqlSessionFactory.openSession();

// 4. 获取 Mapper 代理
UserMapper mapper = session.getMapper(UserMapper.class);

// 5. 执行查询
User user = mapper.findById(1L);

// 6. 关闭 SqlSession（必须手动关闭！）
session.close();
```

#### Spring 整合后

```java
@Service
public class UserService {
    @Autowired
    private UserMapper userMapper;  // 直接注入，无需手动管理 SqlSession

    public User findById(Long id) {
        return userMapper.findById(id);  // SqlSession 的创建和关闭由 Spring 管理
    }
}
```

#### Spring 做了什么

| 步骤 | 独立使用 | Spring 整合 |
|------|---------|------------|
| SqlSessionFactory 创建 | 手动 new | `SqlSessionFactoryBean` 自动创建 |
| SqlSession 获取 | `openSession()` | `SqlSessionTemplate` 自动获取 |
| Mapper 代理 | 手动 `getMapper()` | `MapperScannerConfigurer` 自动扫描注册 |
| SqlSession 关闭 | 手动 `close()` | `TransactionSynchronizationManager` 自动关闭 |
| 事务管理 | 手动 commit/rollback | `@Transactional` 声明式管理 |
| 异常转换 | 手动 catch | `PersistenceExceptionTranslationPostProcessor` 自动转换 |

> **踩坑提醒**：Spring 整合后，`SqlSession` 的生命周期与当前线程绑定（通过 `TransactionSynchronizationManager`）。如果你在非 Spring 管理的线程中调用 Mapper，会得到 `SqlSession is not bound to current thread` 异常。

---

### 4.1.2 JdbcTemplate 基础

**痛点**：不想引入 MyBatis/JPA 重量级框架，只想简单查个数据库？

#### 基本 CRUD

```java
@Repository
public class UserDao {

    @Autowired
    private JdbcTemplate jdbcTemplate;

    // 查询单条
    public User findById(Long id) {
        String sql = "SELECT id, username, email FROM users WHERE id = ?";
        return jdbcTemplate.queryForObject(sql, new BeanPropertyRowMapper<>(User.class), id);
    }

    // 查询列表
    public List<User> findAll() {
        return jdbcTemplate.query(
            "SELECT id, username, email FROM users",
            new BeanPropertyRowMapper<>(User.class));
    }

    // 插入
    public int insert(User user) {
        return jdbcTemplate.update(
            "INSERT INTO users (username, email) VALUES (?, ?)",
            user.getUsername(), user.getEmail());
    }

    // 更新
    public int updateEmail(Long id, String email) {
        return jdbcTemplate.update(
            "UPDATE users SET email = ? WHERE id = ?", email, id);
    }

    // 删除
    public int delete(Long id) {
        return jdbcTemplate.update("DELETE FROM users WHERE id = ?", id);
    }

    // 查询单个值
    public int count() {
        return jdbcTemplate.queryForObject("SELECT COUNT(*) FROM users", Integer.class);
    }
}
```

#### NamedParameterJdbcTemplate

```java
@Repository
public class UserAdvancedDao {

    @Autowired
    private NamedParameterJdbcTemplate namedTemplate;

    // 命名参数（比 ? 更可读）
    public List<User> findByCondition(String username, String email) {
        String sql = "SELECT * FROM users WHERE username = :name AND email = :email";

        MapSqlParameterSource params = new MapSqlParameterSource()
            .addValue("name", username)
            .addValue("email", email);

        return namedTemplate.query(sql, params, new BeanPropertyRowMapper<>(User.class));
    }

    // 批量插入
    public int[] batchInsert(List<User> users) {
        String sql = "INSERT INTO users (username, email) VALUES (:username, :email)";

        SqlParameterSource[] batch = users.stream()
            .map(user -> new BeanPropertyPropertySqlParameterSource(user))
            .toArray(SqlParameterSource[]::new);

        return namedTemplate.batchUpdate(sql, batch);
    }
}
```

#### SQLException 统一转换

Spring 将数据库特定的异常转换为统一的 `DataAccessException` 层次结构：

```
DataAccessException
  ├── BadSqlGrammarException          ← SQL 语法错误
  ├── DuplicateKeyException           ← 主键/唯一键冲突
  ├── DataIntegrityViolationException ← 数据完整性违反
  ├── EmptyResultDataAccessException  ← queryForObject 无结果
  └── DataAccessResourceFailureException ← 连接失败
```

> **踩坑提醒**：`queryForObject` 查不到数据时抛 `EmptyResultDataAccessException`，不是返回 null！如果希望查不到返回 null，用 `query(...).stream().findFirst().orElse(null)`。

---

### 4.1.3 数据源配置与连接池

**痛点**：每次请求都创建数据库连接？连接池参数怎么调才合理？

#### Spring Boot 默认数据源（HikariCP）

```yaml
spring:
  datasource:
    url: jdbc:mysql://localhost:3306/mydb?useSSL=false&serverTimezone=Asia/Shanghai
    username: root
    password: secret
    driver-class-name: com.mysql.cj.jdbc.Driver
    hikari:
      # 核心参数
      maximum-pool-size: 20        # 最大连接数
      minimum-idle: 5              # 最小空闲连接
      connection-timeout: 30000    # 获取连接超时（ms）
      idle-timeout: 600000         # 空闲连接存活时间（ms）
      max-lifetime: 1800000        # 连接最大存活时间（ms）
      # 性能参数
      pool-name: MyHikariPool
      auto-commit: true
      connection-test-query: SELECT 1
```

#### HikariCP 核心参数调优指南

| 参数 | 默认值 | 建议 | 说明 |
|------|--------|------|------|
| `maximum-pool-size` | 10 | CPU 核心数 × 2 + 磁盘数 | 不是越大越好！连接过多导致上下文切换 |
| `minimum-idle` | = maximum-pool-size | 设为 maximum-pool-size | 保持固定大小，避免伸缩抖动 |
| `connection-timeout` | 30000 | 3000-5000 | 获取连接的等待时间，快速失败 |
| `max-lifetime` | 1800000 | 1800000（30分钟） | 必须小于 MySQL 的 `wait_timeout` |
| `idle-timeout` | 600000 | 600000（10分钟） | 空闲连接回收时间 |

#### 连接池大小计算公式

```
连接池大小 ≈ CPU 核心数 × 2 + 磁盘数

例：4 核 CPU + 1 块 SSD = 4 × 2 + 1 = 9

说明：数据库连接是 IO 密集型操作，线程大部分时间在等待 IO。
过多连接反而导致数据库锁竞争和上下文切换。
```

> **踩坑提醒**：`max-lifetime` 必须小于 MySQL 的 `wait_timeout`（默认 8 小时）。否则 MySQL 侧已关闭连接，但连接池不知道，使用时会报 `Communications link failure`。HikariCP 默认 30 分钟，通常够用。

---

## 4.2 MyBatis 集成

### 4.2.1 Mapper 接口与 XML 映射

**痛点**：MyBatis 有两种写 SQL 的方式——注解和 XML，到底用哪个？

#### 方式一：注解方式

```java
@Mapper
public interface UserMapper {

    @Select("SELECT * FROM users WHERE id = #{id}")
    User findById(@Param("id") Long id);

    @Insert("INSERT INTO users (username, email) VALUES (#{username}, #{email})")
    @Options(useGeneratedKeys = true, keyProperty = "id")  // 回填自增 ID
    int insert(User user);

    @Update("UPDATE users SET email = #{email} WHERE id = #{id}")
    int updateEmail(@Param("id") Long id, @Param("email") String email);

    @Delete("DELETE FROM users WHERE id = #{id}")
    int delete(@Param("id") Long id);
}
```

#### 方式二：XML 映射

```java
// Mapper 接口（纯接口，不需要 SQL 注解）
@Mapper
public interface UserMapper {
    User findById(@Param("id") Long id);
    List<User> findByCondition(UserQuery query);
    int insert(User user);
}
```

```xml
<!-- resources/mapper/UserMapper.xml -->
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE mapper PUBLIC "-//mybatis.org//DTD Mapper 3.0//EN"
        "http://mybatis.org/dtd/mybatis-3-mapper.dtd">
<mapper namespace="com.example.mapper.UserMapper">

    <resultMap id="userResultMap" type="com.example.entity.User">
        <id property="id" column="id"/>
        <result property="username" column="username"/>
        <result property="email" column="email"/>
        <result property="createTime" column="create_time"/>
    </resultMap>

    <select id="findById" resultMap="userResultMap">
        SELECT * FROM users WHERE id = #{id}
    </select>

    <select id="findByCondition" resultMap="userResultMap">
        SELECT * FROM users
        <where>
            <if test="username != null and username != ''">
                AND username LIKE CONCAT('%', #{username}, '%')
            </if>
            <if test="email != null and email != ''">
                AND email = #{email}
            </if>
        </where>
    </select>

    <insert id="insert" useGeneratedKeys="true" keyProperty="id">
        INSERT INTO users (username, email, create_time)
        VALUES (#{username}, #{email}, #{createTime})
    </insert>
</mapper>
```

#### 两种方式对比

| 维度 | 注解方式 | XML 方式 |
|------|---------|---------|
| 简单 SQL | ✅ 直观方便 | ❌ 过于繁琐 |
| 复杂 SQL | ❌ 拼接困难 | ✅ 动态 SQL 强大 |
| 可维护性 | 差（SQL 散落在 Java 代码中） | 好（SQL 集中管理） |
| IDE 支持 | 一般 | 好（XML 有语法高亮） |
| 推荐场景 | 简单 CRUD | 复杂查询、动态条件 |

> **踩坑提醒**：XML 文件必须放在 `resources/mapper/` 目录下，且 `application.yml` 中要配置 `mybatis.mapper-locations=classpath:mapper/**/*.xml`。最常见的错误就是 XML 文件没被扫描到，报 `Invalid bound statement (not found)`。

---

### 4.2.2 动态 SQL

**痛点**：查询条件不确定——有时按名字搜，有时按日期范围搜，有时组合搜？动态 SQL 来了。

#### if / where / choose

```xml
<select id="findByCondition" resultType="User">
    SELECT * FROM users
    <where>
        <!-- if：条件为 true 时拼接 SQL -->
        <if test="username != null and username != ''">
            AND username LIKE CONCAT('%', #{username}, '%')
        </if>
        <if test="email != null and email != ''">
            AND email = #{email}
        </if>
        <if test="status != null">
            AND status = #{status}
        </if>
        <!-- choose/when/otherwise：类似 Java 的 switch -->
        <choose>
            <when test="sortBy == 'name'">
                ORDER BY username ASC
            </when>
            <when test="sortBy == 'date'">
                ORDER BY create_time DESC
            </when>
            <otherwise>
                ORDER BY id DESC
            </otherwise>
        </choose>
    </where>
    <!-- where 标签自动去掉第一个 AND -->
</select>
```

#### foreach（批量操作）

```xml
<!-- 批量插入 -->
<insert id="batchInsert">
    INSERT INTO users (username, email) VALUES
    <foreach collection="users" item="user" separator=",">
        (#{user.username}, #{user.email})
    </foreach>
</insert>

<!-- IN 查询 -->
<select id="findByIds" resultType="User">
    SELECT * FROM users WHERE id IN
    <foreach collection="ids" item="id" open="(" separator="," close=")">
        #{id}
    </foreach>
</select>
```

#### set（动态更新）

```xml
<update id="updateSelective">
    UPDATE users
    <set>
        <if test="username != null">username = #{username},</if>
        <if test="email != null">email = #{email},</if>
        <if test="status != null">status = #{status},</if>
    </set>
    <!-- set 标签自动去掉最后一个逗号 -->
    WHERE id = #{id}
</update>
```

> **踩坑提醒**：`<where>` 标签只去掉**开头**的 AND/OR。如果你的 SQL 是 `AND username = ... AND email = ...`，它会去掉第一个 AND，但保留中间的。另外 `<set>` 标签只去掉**末尾**的逗号。不要在 `<if>` 中手动写 WHERE 或 SET 关键字。

---

### 4.2.3 MyBatis-Plus 增强

**痛点**：简单 CRUD 也要写 XML？MyBatis-Plus 让你一行 SQL 都不写。

#### BaseMapper 基础 CRUD

```java
// 实体类
@Data
@TableName("users")
public class User {
    @TableId(type = IdType.AUTO)
    private Long id;
    private String username;
    private String email;
    @TableField(fill = FieldFill.INSERT)
    private LocalDateTime createTime;
    @TableField(fill = FieldFill.INSERT_UPDATE)
    private LocalDateTime updateTime;
}

// Mapper 继承 BaseMapper，自动拥有 CRUD 方法
@Mapper
public interface UserMapper extends BaseMapper<User> {
    // 不需要写任何方法，BaseMapper 提供了 17 个内置方法
}
```

```java
// 使用示例
@Service
public class UserServiceImpl {

    @Autowired
    private UserMapper userMapper;

    // 基本 CRUD
    public User findById(Long id) {
        return userMapper.selectById(id);
    }

    public int insert(User user) {
        return userMapper.insert(user);  // 自动回填 ID
    }

    public int deleteById(Long id) {
        return userMapper.deleteById(id);
    }

    // LambdaQueryWrapper（类型安全，避免字段名硬编码）
    public List<User> findByCondition(String username, String email) {
        LambdaQueryWrapper<User> wrapper = new LambdaQueryWrapper<User>()
            .like(StringUtils.isNotBlank(username), User::getUsername, username)
            .eq(StringUtils.isNotBlank(email), User::getEmail, email)
            .orderByDesc(User::getCreateTime);
        return userMapper.selectList(wrapper);
    }

    // 分页查询
    public IPage<User> findPage(int pageNum, int pageSize) {
        Page<User> page = new Page<>(pageNum, pageSize);
        LambdaQueryWrapper<User> wrapper = new LambdaQueryWrapper<User>()
            .eq(User::getStatus, 1);
        return userMapper.selectPage(page, wrapper);
    }
}
```

#### 分页插件配置

```java
@Configuration
public class MyBatisPlusConfig {

    @Bean
    public MybatisPlusInterceptor mybatisPlusInterceptor() {
        MybatisPlusInterceptor interceptor = new MybatisPlusInterceptor();
        // 分页插件
        interceptor.addInnerInterceptor(new PaginationInnerInterceptor(DbType.MYSQL));
        // 乐观锁插件
        interceptor.addInnerInterceptor(new OptimisticLockerInnerInterceptor());
        return interceptor;
    }
}
```

> **踩坑提醒**：`LambdaQueryWrapper` 的 `like` 方法不会自动加 `%`——需要手动传 `%keyword%`。但 MyBatis-Plus 的 `likeLeft`/`likeRight`/`like` 已经封装好了。注意：`eq` 的第二个参数传 `null` 时，默认会被忽略（不会拼接 `AND field = null`），这是设计如此。

---

### 4.2.4 SqlSessionTemplate 与线程安全

**痛点**：为什么 Spring 中直接注入 Mapper 是线程安全的？`SqlSessionTemplate` 的代理模式做了什么？

#### 代理模式原理

```java
// SqlSessionTemplate 实现了 SqlSession 接口
// 内部持有一个 SqlSessionProxy，每次调用都是代理
public class SqlSessionTemplate implements SqlSession {
    private final SqlSessionFactory sqlSessionFactory;
    private final SqlSession sqlSessionProxy;  // JDK 动态代理

    public SqlSessionTemplate(SqlSessionFactory sqlSessionFactory) {
        this.sqlSessionFactory = sqlSessionFactory;
        // 创建代理
        this.sqlSessionProxy = (SqlSession) Proxy.newProxyInstance(
            SqlSessionFactory.class.getClassLoader(),
            new Class[]{SqlSession.class},
            new SqlSessionInterceptor()  // 调用处理器
        );
    }

    // 每次调用 Mapper 方法，代理都会：
    // 1. 获取当前事务绑定的 SqlSession（如果有）
    // 2. 没有则创建新的
    // 3. 执行 SQL
    // 4. 非事务环境则关闭 SqlSession
    private class SqlSessionInterceptor implements InvocationHandler {
        @Override
        public Object invoke(Object proxy, Method method, Object[] args) {
            SqlSession session = SqlSessionUtils.getSqlSession(
                sqlSessionFactory, executorType, exceptionTranslator);
            try {
                Object result = method.invoke(session, args);
                // 如果没有 Spring 事务管理，手动提交
                if (!SqlSessionUtils.isSqlSessionTransactional(session, sqlSessionFactory)) {
                    session.commit();
                }
                return result;
            } catch (Throwable t) {
                // 异常转换：SQLException → DataAccessException
                throw exceptionTranslator.translateIfPossible(t);
            } finally {
                SqlSessionUtils.closeSqlSession(session, sqlSessionFactory);
            }
        }
    }
}
```

#### 一级缓存「失效」之谜

MyBatis 一级缓存是 **SqlSession 级别**的。Spring 整合后：

```
没有 @Transactional 时：
  调用 Mapper 方法 → 创建 SqlSession → 执行 → 关闭 SqlSession
  再次调用 → 创建新的 SqlSession → 一级缓存是空的 → 重新查数据库

有 @Transactional 时：
  开启事务 → 创建 SqlSession → 绑定到当前线程
  调用 Mapper 方法 → 复用同一个 SqlSession → 一级缓存生效！
  再次调用 → 命中缓存 → 不查数据库
  事务结束 → 关闭 SqlSession
```

> **踩坑提醒**：很多人发现「MyBatis 一级缓存没用」，就是因为没加 `@Transactional`。没有事务时每次调用都创建新的 SqlSession，缓存自然失效。但一级缓存也可能导致**脏读**——在同一事务中两次查询之间，另一个事务修改了数据但你读到的是旧值。

---

### 4.2.5 MyBatis 拦截器与插件

**痛点**：想记录每条 SQL 的执行耗时？想自动分页？MyBatis 拦截器可以拦截 SQL 执行的四个阶段。

#### 四大拦截点

| 拦截对象 | 可拦截方法 | 典型场景 |
|----------|-----------|---------|
| `Executor` | `update`, `query`, `commit`, `rollback` | 二级缓存、SQL 日志 |
| `StatementHandler` | `prepare`, `parameterize`, `batch` | SQL 改写、分页 |
| `ParameterHandler` | `setParameters` | 参数加密 |
| `ResultSetHandler` | `handleResultSets` | 结果集映射、脱敏 |

#### SQL 耗时日志拦截器

```java
@Intercepts({
    @Signature(
        type = Executor.class,
        method = "query",
        args = {MappedStatement.class, Object.class, RowBounds.class, ResultHandler.class}
    ),
    @Signature(
        type = Executor.class,
        method = "update",
        args = {MappedStatement.class, Object.class}
    )
})
@Component
public class SqlCostInterceptor implements Interceptor {

    private static final Logger log = LoggerFactory.getLogger(SqlCostInterceptor.class);

    @Override
    public Object intercept(Invocation invocation) throws Throwable {
        MappedStatement ms = (MappedStatement) invocation.getArgs()[0];
        Object parameter = invocation.getArgs()[1];

        // 获取完整 SQL（含参数）
        BoundSql boundSql = ms.getBoundSql(parameter);
        String sql = boundSql.getSql().replaceAll("[\\s]+", " ");
        String sqlId = ms.getId();

        long start = System.currentTimeMillis();
        try {
            return invocation.proceed();
        } finally {
            long cost = System.currentTimeMillis() - start;
            if (cost > 500) {
                log.warn("⚠️ 慢 SQL [{}] | 耗时: {}ms | SQL: {}", sqlId, cost, sql);
            } else {
                log.debug("SQL [{}] | 耗时: {}ms | SQL: {}", sqlId, cost, sql);
            }
        }
    }

    @Override
    public Object plugin(Object target) {
        return Plugin.wrap(target, this);
    }

    @Override
    public void setProperties(Properties properties) {
        // 可以从配置中读取属性
    }
}
```

> **踩坑提醒**：MyBatis 拦截器是基于 JDK 动态代理实现的，多个拦截器会形成**代理链**。拦截器的执行顺序与 `@Component` 的加载顺序有关，可以用 `@Order` 控制。另外不要在拦截器中做阻塞操作，否则会影响所有 SQL 的执行。

---

## 4.3 Spring Data JPA

### 4.3.1 实体定义与关联映射

**痛点**：数据库表之间的关系（一对一、一对多、多对多）怎么映射到 Java 对象？

#### 实体定义

```java
@Entity
@Table(name = "users")
public class User {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, unique = true, length = 50)
    private String username;

    @Column(nullable = false)
    private String email;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private UserStatus status = UserStatus.ACTIVE;

    @Column(name = "create_time", updatable = false)
    private LocalDateTime createTime;

    // 一对多：一个用户有多个订单
    @OneToMany(mappedBy = "user", cascade = CascadeType.ALL, orphanRemoval = true)
    @OrderBy("createTime DESC")
    private List<Order> orders = new ArrayList<>();

    // 多对多：用户和角色
    @ManyToMany(fetch = FetchType.LAZY)
    @JoinTable(
        name = "user_role",
        joinColumns = @JoinColumn(name = "user_id"),
        inverseJoinColumns = @JoinColumn(name = "role_id")
    )
    private Set<Role> roles = new HashSet<>();

    @PrePersist
    protected void onCreate() {
        this.createTime = LocalDateTime.now();
    }
}

@Entity
@Table(name = "orders")
public class Order {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false)
    private String orderNo;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "user_id", nullable = false)
    private User user;

    @OneToOne(cascade = CascadeType.ALL, orphanRemoval = true)
    @JoinColumn(name = "payment_id")
    private Payment payment;
}
```

#### 关联映射要点

| 关系 | 注解 | fetch 默认 | 注意事项 |
|------|------|-----------|---------|
| `@OneToOne` | `@JoinColumn` | EAGER | 考虑用 `LAZY` 避免 N+1 |
| `@ManyToOne` | `@JoinColumn` | EAGER | 默认 EAGER 通常是性能陷阱 |
| `@OneToMany` | `mappedBy` | LAZY | 用 `orphanRemoval=true` 管理子实体生命周期 |
| `@ManyToMany` | `@JoinTable` | LAZY | 避免用 `CascadeType.ALL`，用单独管理 |

> **踩坑提醒**：`@ManyToOne` 默认是 `FetchType.EAGER`，意味着查询 Order 时会自动 JOIN User。如果一次查 100 个 Order，会发出 100 条查询 User 的 SQL（N+1 问题）。**所有关联都建议用 `LAZY`**，需要时再用 `JOIN FETCH` 显式加载。

---

### 4.3.2 Repository 接口

**痛点**：JPA 不用写 SQL，方法名就能查询？但方法名写错了编译不报错、运行才挂？

#### 方法命名查询

```java
public interface UserRepository extends JpaRepository<User, Long> {

    // 方法名派生查询（Spring Data 解析方法名生成 SQL）
    // SELECT * FROM users WHERE username = ?
    Optional<User> findByUsername(String username);

    // SELECT * FROM users WHERE email LIKE '%keyword%'
    List<User> findByEmailContaining(String keyword);

    // SELECT * FROM users WHERE status = ? ORDER BY create_time DESC
    List<User> findByStatusOrderByCreateTimeDesc(UserStatus status);

    // SELECT * FROM users WHERE username LIKE ? AND status = ?
    Page<User> findByUsernameContainingAndStatus(String keyword, UserStatus status, Pageable pageable);

    // EXISTS 查询
    boolean existsByEmail(String email);

    // COUNT 查询
    long countByStatus(UserStatus status);

    // DELETE 查询（需要 @Transactional）
    @Transactional
    int deleteByStatus(UserStatus status);
}
```

#### @Query JPQL

```java
public interface UserRepository extends JpaRepository<User, Long> {

    // JPQL（面向对象的查询语言，用实体名而非表名）
    @Query("SELECT u FROM User u WHERE u.username LIKE %:keyword% OR u.email LIKE %:keyword%")
    List<User> search(@Param("keyword") String keyword);

    // 原生 SQL
    @Query(value = "SELECT * FROM users WHERE create_time > :date", nativeQuery = true)
    List<User> findRecentUsers(@Param("date") LocalDateTime date);

    // 关联查询（解决 N+1）
    @Query("SELECT u FROM User u LEFT JOIN FETCH u.orders WHERE u.id = :id")
    Optional<User> findByIdWithOrders(@Param("id") Long id);

    // 更新查询（必须加 @Modifying）
    @Modifying
    @Query("UPDATE User u SET u.status = :status WHERE u.id = :id")
    int updateStatus(@Param("id") Long id, @Param("status") UserStatus status);

    // 分页 + 排序
    @Query("SELECT u FROM User u WHERE u.status = :status")
    Page<User> findActiveUsers(@Param("status") UserStatus status, Pageable pageable);
}
```

> **踩坑提醒**：`@Modifying` 方法必须在 `@Transactional` 环境中执行（Service 层加 `@Transactional` 或方法本身加）。另外 `@Modifying` 默认不自动清除持久化上下文，如果更新后在同一事务中查询，可能得到旧数据——加 `@Modifying(clearAutomatically = true)` 解决。

---

### 4.3.3 Specification 动态查询

**痛点**：搜索功能有 10 个可选条件，用户可能只填其中几个——怎么动态组合查询？

```java
// 定义 Specification
public class UserSpecs {

    public static Specification<User> usernameLike(String username) {
        return (root, query, cb) -> {
            if (StringUtils.isBlank(username)) return null;
            return cb.like(root.get("username"), "%" + username + "%");
        };
    }

    public static Specification<User> emailEquals(String email) {
        return (root, query, cb) -> {
            if (StringUtils.isBlank(email)) return null;
            return cb.equal(root.get("email"), email);
        };
    }

    public static Specification<User> statusEquals(UserStatus status) {
        return (root, query, cb) -> {
            if (status == null) return null;
            return cb.equal(root.get("status"), status);
        };
    }

    public static Specification<User> createdAfter(LocalDateTime date) {
        return (root, query, cb) -> {
            if (date == null) return null;
            return cb.greaterThan(root.get("createTime"), date);
        };
    }
}

// Repository 继承 JpaSpecificationExecutor
public interface UserRepository extends JpaRepository<User, Long>,
                                         JpaSpecificationExecutor<User> {
}

// Service 中动态组合
@Service
public class UserService {

    @Autowired
    private UserRepository userRepository;

    public Page<User> search(UserSearchRequest request, Pageable pageable) {
        Specification<User> spec = Specification
            .where(UserSpecs.usernameLike(request.getUsername()))
            .and(UserSpecs.emailEquals(request.getEmail()))
            .and(UserSpecs.statusEquals(request.getStatus()))
            .and(UserSpecs.createdAfter(request.getStartTime()));

        return userRepository.findAll(spec, pageable);
    }
}

// 搜索请求 DTO
@Data
public class UserSearchRequest {
    private String username;
    private String email;
    private UserStatus status;
    private LocalDateTime startTime;
}
```

> **踩坑提醒**：`Specification` 返回 `null` 表示该条件不参与查询（Spring Data 会忽略 null specification）。但如果你用了 `and` 链式调用，第一个 `where` 不能传 null——用 `where(spec1).and(spec2)` 而不是 `where(null).and(spec1)`。

---

### 4.3.4 审计功能

**痛点**：每张表都有 `created_by`、`created_at`、`updated_by`、`updated_at` 字段，每个实体都要手动赋值？

#### 开启审计

```java
// 1. 启用 JPA 审计
@Configuration
@EnableJpaAuditing(auditorAwareRef = "auditorProvider")
public class JpaConfig {

    @Bean
    public AuditorAware<String> auditorProvider() {
        // 从 SecurityContext 获取当前用户
        return () -> Optional.ofNullable(SecurityContextHolder.getContext())
            .map(SecurityContext::getAuthentication)
            .filter(Authentication::isAuthenticated)
            .map(Authentication::getName)
            .or(() -> Optional.of("SYSTEM"));
    }
}

// 2. 审计基类
@MappedSuperclass
@EntityListeners(AuditingEntityListener.class)
public abstract class BaseEntity {

    @CreatedBy
    @Column(name = "created_by", updatable = false)
    private String createdBy;

    @CreatedDate
    @Column(name = "created_at", updatable = false)
    private LocalDateTime createdAt;

    @LastModifiedBy
    @Column(name = "updated_by")
    private String updatedBy;

    @LastModifiedDate
    @Column(name = "updated_at")
    private LocalDateTime updatedAt;

    // getters & setters
}

// 3. 实体继承基类
@Entity
@Table(name = "users")
public class User extends BaseEntity {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;
    private String username;
    private String email;
}
```

> **踩坑提醒**：`@CreatedDate` 和 `@LastModifiedDate` 只在 JPA `persist` 和 `merge` 时触发。如果你用 `@Query` 的 `@Modifying` 直接写 SQL 更新，审计字段**不会**自动更新——因为绕过了 JPA 的实体生命周期。

---

## 4.4 MyBatis vs JPA 选型

### 4.4.1 两条路线的本质差异

**痛点**：项目组为「用 MyBatis 还是 JPA」吵了三天——这不是信仰问题，是工程选型问题。

#### SQL 映射器 vs 对象关系映射

```
MyBatis 路线：
  Java 方法 → SQL 语句 → 结果集 → Java 对象
  你写 SQL，MyBatis 帮你映射

JPA 路线：
  Java 对象 → ORM 映射 → 自动生成 SQL → 结果集 → Java 对象
  你操作对象，JPA 帮你生成 SQL
```

| 维度 | MyBatis | JPA (Hibernate) |
|------|---------|-----------------|
| 核心思想 | SQL 映射器 | 对象关系映射（ORM） |
| SQL 控制 | 完全手写 | 自动生成，也可手写 |
| 学习曲线 | 低（会 SQL 就行） | 高（实体状态、懒加载、缓存） |
| 灵活性 | 极高（任意 SQL） | 受 ORM 框架约束 |
| 数据库移植 | 差（SQL 方言依赖） | 好（Hibernate 方言抽象） |
| 复杂查询 | 强（直接写 SQL） | 弱（JPQL 限制多） |
| 关联查询 | 手动映射 | 自动映射（但 N+1 是陷阱） |
| 二级缓存 | 需手动配置 | 内置支持 |

---

### 4.4.2 决策框架

**痛点**：到底什么场景用什么？四个维度帮你决策。

#### 四维决策矩阵

| 维度 | 选 MyBatis | 选 JPA |
|------|-----------|--------|
| **团队 SQL 能力** | SQL 功底扎实 | 更熟悉面向对象 |
| **查询复杂度** | 多表联查、统计报表 | 简单 CRUD 为主 |
| **精细调优** | 需要手动优化 SQL | 可接受框架生成的 SQL |
| **项目规模** | 大型项目、微服务 | 中小型项目、快速开发 |

#### 混合使用方案

```java
// 复杂查询用 MyBatis
@Mapper
public interface ReportMapper {
    @Select("SELECT department, COUNT(*) as cnt, AVG(salary) as avg_salary " +
            "FROM employees GROUP BY department HAVING cnt > 5")
    List<DepartmentStat> getDepartmentStats();
}

// 简单 CRUD 用 JPA
public interface UserRepository extends JpaRepository<User, Long> {
    Optional<User> findByUsername(String username);
}
```

> **踩坑提醒**：同一项目混用 MyBatis 和 JPA 时，**事务管理要统一**。JPA 用 `JpaTransactionManager`，MyBatis 用 `DataSourceTransactionManager`。如果混用，确保它们操作的是**同一个数据源**，且用同一个 `PlatformTransactionManager`。推荐用 `JpaTransactionManager` 统一管理。

---

## 4.5 事务管理

### 4.5.1 @Transactional 基础

**痛点**：方法执行到一半抛异常，数据库里只插入了一半数据——加个 `@Transactional` 就行？没那么简单。

#### 基本用法

```java
@Service
public class OrderService {

    @Autowired
    private OrderMapper orderMapper;

    @Autowired
    private StockMapper stockMapper;

    // 最基本的事务用法
    @Transactional(rollbackFor = Exception.class)  // ← 关键！
    public void createOrder(Order order) {
        // 1. 创建订单
        orderMapper.insert(order);

        // 2. 扣减库存
        int rows = stockMapper.deduct(order.getProductId(), order.getQuantity());
        if (rows == 0) {
            throw new BusinessException("库存不足");
        }

        // 3. 如果这里抛异常，上面两步都会回滚
    }
}
```

#### rollbackFor 的重要性

```java
// ❌ 错误：默认只回滚 RuntimeException 和 Error
@Transactional
public void bad() {
    doSomething();
    throw new Exception("checked exception");  // 不会回滚！
}

// ✅ 正确：指定 rollbackFor = Exception.class
@Transactional(rollbackFor = Exception.class)
public void good() {
    doSomething();
    throw new Exception("checked exception");  // 会回滚
}
```

#### PlatformTransactionManager 原理

```
@Transactional 执行流程：
  1. AOP 代理拦截方法调用
  2. TransactionManager.getTransaction() → 获取/创建数据库连接，设置 autoCommit=false
  3. 执行业务方法
  4. 如果正常返回 → TransactionManager.commit()
  5. 如果抛出需要回滚的异常 → TransactionManager.rollback()
  6. 释放数据库连接
```

> **踩坑提醒**：`@Transactional` 默认只回滚 `RuntimeException` 和 `Error`，**不回滚 checked exception**。这是最容易踩的坑。永远写 `@Transactional(rollbackFor = Exception.class)`。

---

### 4.5.2 传播行为

**痛点**：ServiceA 的事务方法调用 ServiceB 的事务方法，它们用同一个事务还是各管各的？

#### 七种传播行为（重点三种）

| 传播行为 | 说明 | 外部有事务 | 外部无事务 |
|----------|------|-----------|-----------|
| `REQUIRED`（默认） | 加入当前事务 | 共用事务 | 创建新事务 |
| `REQUIRES_NEW` | 挂起当前，创建新事务 | 独立事务 | 创建新事务 |
| `NESTED` | 在当前事务中创建保存点 | 嵌套事务 | 创建新事务 |

```java
@Service
public class OrderService {

    @Autowired
    private LogService logService;

    @Autowired
    private PaymentService paymentService;

    @Transactional(rollbackFor = Exception.class)
    public void createOrder(Order order) {
        orderMapper.insert(order);

        // REQUIRED（默认）：加入当前事务
        // 如果这里抛异常，订单和库存操作一起回滚
        stockService.deduct(order.getProductId(), order.getQuantity());

        // REQUIRES_NEW：独立事务
        // 即使订单创建失败，日志也已经写入（不回滚）
        logService.saveLog("创建订单: " + order.getOrderNo());

        // NESTED：嵌套事务（保存点）
        // 如果支付失败，只回滚支付操作，订单和库存不回滚
        try {
            paymentService.processPayment(order);
        } catch (Exception e) {
            log.warn("支付失败，订单保留: {}", order.getOrderNo());
        }
    }
}

@Service
public class LogService {
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void saveLog(String content) {
        logMapper.insert(new Log(content));
    }
}

@Service
public class PaymentService {
    @Transactional(propagation = Propagation.NESTED)
    public void processPayment(Order order) {
        paymentMapper.insert(new Payment(order));
        // 如果抛异常，只回滚到保存点
    }
}
```

#### 嵌套事务保存点原理

```
NESTED 事务流程：
  BEGIN TRANSACTION (外层)
    INSERT INTO orders ...
    SAVEPOINT sp1                    ← 创建保存点
      INSERT INTO payments ...
      如果失败 → ROLLBACK TO sp1    ← 只回滚到保存点
    RELEASE SAVEPOINT sp1            ← 释放保存点
  COMMIT (外层事务提交)
```

> **踩坑提醒**：`NESTED` 的保存点依赖 JDBC 的 `savepoint` 支持。MySQL InnoDB 支持，但有些数据库驱动不支持。另外 `NESTED` 和 `REQUIRES_NEW` 的区别：`REQUIRES_NEW` 是完全独立的事务（不受外层回滚影响），`NESTED` 仍然属于外层事务（外层回滚时嵌套也回滚）。

---

### 4.5.3 隔离级别与并发问题

**痛点**：两个人同时修改同一条数据，结果数据乱了？这就是隔离级别要解决的问题。

#### 四种并发问题

| 问题 | 描述 | 示例 |
|------|------|------|
| **脏读** | 读到未提交的数据 | 事务 A 修改了数据但未提交，事务 B 读到了修改后的值，A 回滚了 |
| **不可重复读** | 同一事务两次读同一行，结果不同 | 事务 A 读了数据，事务 B 修改并提交，A 再读发现变了 |
| **幻读** | 同一事务两次查询，行数不同 | 事务 A 查询有 5 条，事务 B 插入 1 条提交，A 再查有 6 条 |
| **第一类丢失更新** | 回滚覆盖了其他事务的修改 | 事务 A 回滚把事务 B 已提交的修改覆盖了 |

#### 四种隔离级别

| 隔离级别 | 脏读 | 不可重复读 | 幻读 | MySQL 默认 | Oracle 默认 |
|----------|------|-----------|------|-----------|------------|
| `READ_UNCOMMITTED` | ❌ 可能 | ❌ 可能 | ❌ 可能 | 否 | 否 |
| `READ_COMMITTED` | ✅ 解决 | ❌ 可能 | ❌ 可能 | 否 | **是** |
| `REPEATABLE_READ` | ✅ 解决 | ✅ 解决 | ⚠️ 部分 | **是** | 否 |
| `SERIALIZABLE` | ✅ 解决 | ✅ 解决 | ✅ 解决 | 否（性能差） | 否 |

```java
// 设置隔离级别
@Transactional(isolation = Isolation.REPEATABLE_READ)
public void transfer(Long fromId, Long toId, BigDecimal amount) {
    // 幻读场景：两次查询之间，其他事务可能插入新记录
    Account from = accountMapper.selectForUpdate(fromId);  // 悲观锁
    Account to = accountMapper.selectForUpdate(toId);

    if (from.getBalance().compareTo(amount) < 0) {
        throw new BusinessException("余额不足");
    }

    accountMapper.deduct(fromId, amount);
    accountMapper.add(toId, amount);
}
```

> **踩坑提醒**：MySQL 的 `REPEATABLE_READ` 通过 MVCC + Gap Lock 已经**基本解决**了幻读问题（但不是完全）。`SERIALIZABLE` 隔离级别会把所有 SELECT 都变成 `SELECT ... LOCK IN SHARE MODE`，性能急剧下降，生产环境慎用。

---

### 4.5.4 @Transactional 失效场景

**痛点**：明明加了 `@Transactional`，但异常后数据没有回滚？这些场景你中了几个？

#### 六大失效场景

```java
@Service
public class UserService {

    // ❌ 场景1：方法不是 public
    @Transactional(rollbackFor = Exception.class)
    private void notPublic() {  // private/protected/package-private 都不行
        // AOP 代理无法拦截非 public 方法
    }

    // ❌ 场景2：自调用（this 调用绕过了代理）
    public void createUser() {
        this.doCreate();  // ← 直接调用，不走代理！事务不生效
    }

    @Transactional(rollbackFor = Exception.class)
    public void doCreate() {
        // ...
    }

    // ❌ 场景3：异常被 catch 吞掉
    @Transactional(rollbackFor = Exception.class)
    public void createWithCatch() {
        try {
            doInsert();
            int result = 1 / 0;  // ArithmeticException
        } catch (Exception e) {
            log.error("出错了", e);  // 异常被 catch，Spring 不知道要回滚
        }
    }

    // ❌ 场景4：rollbackFor 未指定，抛的是 checked exception
    @Transactional  // 默认只回滚 RuntimeException
    public void createWithChecked() throws IOException {
        doInsert();
        throw new IOException("IO 错误");  // checked exception，不回滚
    }

    // ❌ 场景5：数据库引擎不支持事务（MySQL MyISAM）
    // MyISAM 不支持事务，表必须是 InnoDB

    // ❌ 场景6：propagation = Propagation.NOT_SUPPORTED
    @Transactional(propagation = Propagation.NOT_SUPPORTED)
    public void noTransaction() {
        // 以非事务方式运行，不会回滚
    }
}
```

#### 解决自调用问题

```java
@Service
public class UserService {

    // 方案1：注入自身代理
    @Autowired
    @Lazy  // 避免循环依赖
    private UserService self;

    public void createUser() {
        self.doCreate();  // 通过代理调用，事务生效
    }

    @Transactional(rollbackFor = Exception.class)
    public void doCreate() { ... }

    // 方案2：从 ApplicationContext 获取代理
    @Autowired
    private ApplicationContext context;

    public void createUser2() {
        UserService proxy = context.getBean(UserService.class);
        proxy.doCreate();
    }

    // 方案3：使用 AopContext（需要开启 exposeProxy）
    public void createUser3() {
        ((UserService) AopContext.currentProxy()).doCreate();
    }
}
```

> **踩坑提醒**：自调用是 `@Transactional` 失效最常见的原因。理解原理：Spring AOP 基于代理，`this.method()` 调用的是原始对象而非代理对象，AOP 增强不生效。最干净的方案是把需要事务的方法拆到另一个 Service 中。

---

### 4.5.5 编程式事务

**痛点**：有些场景需要更细粒度的事务控制——比如一个方法中部分操作需要独立事务。

#### TransactionTemplate

```java
@Service
public class OrderService {

    @Autowired
    private TransactionTemplate transactionTemplate;

    public void createOrderWithLog(Order order) {
        // 声明式事务：整个方法一个事务
        // 编程式事务：精确控制事务边界

        // 1. 在事务中创建订单
        Long orderId = transactionTemplate.execute(status -> {
            orderMapper.insert(order);
            stockService.deduct(order.getProductId(), order.getQuantity());
            return order.getId();
        });

        // 2. 非事务操作（或独立事务）
        // 日志写入失败不影响订单
        try {
            transactionTemplate.executeWithoutResult(status -> {
                logService.saveLog("订单创建成功: " + orderId);
            });
        } catch (Exception e) {
            log.warn("日志写入失败，不影响订单", e);
        }

        // 3. 带回滚标记的编程式事务
        transactionTemplate.executeWithoutResult(status -> {
            try {
                paymentService.process(order);
            } catch (PaymentException e) {
                status.setRollbackOnly();  // 手动标记回滚
                throw e;
            }
        });
    }
}
```

#### TransactionTemplate vs @Transactional

| 维度 | @Transactional | TransactionTemplate |
|------|---------------|---------------------|
| 代码侵入 | 无（声明式） | 有（代码中显式调用） |
| 粒度 | 方法级别 | 代码块级别 |
| 灵活性 | 低（整个方法一个事务） | 高（可以有多个事务块） |
| 可读性 | 好 | 差（嵌套 lambda） |
| 推荐场景 | 大多数场景 | 需要细粒度控制时 |

> **踩坑提醒**：`transactionTemplate.execute()` 的返回值就是事务方法的返回值。如果 lambda 中抛出 `RuntimeException`，事务自动回滚。如果抛出 checked exception，需要用 `try-catch` 并调用 `status.setRollbackOnly()` 手动回滚。

---

## 4.6 多数据源

### 4.6.1 AbstractRoutingDataSource

**痛点**：一个应用要连两个数据库（业务库 + 报表库），怎么动态切换？

#### 动态数据源实现

```java
// 1. 数据源上下文（ThreadLocal 存储当前使用的数据源标识）
public class DataSourceContext {
    private static final ThreadLocal<String> CONTEXT = new ThreadLocal<>();

    public static void set(String dataSourceKey) {
        CONTEXT.set(dataSourceKey);
    }

    public static String get() {
        return CONTEXT.get();
    }

    public static void clear() {
        CONTEXT.remove();
    }
}

// 2. 动态数据源
public class DynamicDataSource extends AbstractRoutingDataSource {
    @Override
    protected Object determineCurrentLookupKey() {
        return DataSourceContext.get();  // 从 ThreadLocal 获取当前数据源标识
    }
}

// 3. 配置
@Configuration
public class DataSourceConfig {

    @Bean
    @ConfigurationProperties("spring.datasource.master")
    public DataSource masterDataSource() {
        return DataSourceBuilder.create().build();
    }

    @Bean
    @ConfigurationProperties("spring.datasource.slave")
    public DataSource slaveDataSource() {
        return DataSourceBuilder.create().build();
    }

    @Bean
    @Primary
    public DataSource dynamicDataSource(
            @Qualifier("masterDataSource") DataSource master,
            @Qualifier("slaveDataSource") DataSource slave) {

        DynamicDataSource dynamic = new DynamicDataSource();

        Map<Object, Object> targetDataSources = new HashMap<>();
        targetDataSources.put("master", master);
        targetDataSources.put("slave", slave);

        dynamic.setTargetDataSources(targetDataSources);
        dynamic.setDefaultTargetDataSource(master);  // 默认主库
        return dynamic;
    }
}

// 4. 使用
@Service
public class UserService {

    public User findById(Long id) {
        // 默认走主库
        return userMapper.findById(id);
    }

    public List<User> findAll() {
        try {
            DataSourceContext.set("slave");  // 切换到从库
            return userMapper.findAll();
        } finally {
            DataSourceContext.clear();  // 必须清理！
        }
    }
}
```

> **踩坑提醒**：`DataSourceContext` 用的是 `ThreadLocal`，在使用线程池的异步场景中会丢失上下文。解决方案：用 `TaskDecorator` 在提交任务时传递 `ThreadLocal` 数据，或者用 `TransmittableThreadLocal`（阿里开源的 TTL）。

---

### 4.6.2 读写分离

**痛点**：读写分离后，写完主库立刻从从库读，数据还没同步过来——读到旧数据了。

#### AOP 自动切换

```java
// 自定义注解
@Target(ElementType.METHOD)
@Retention(RetentionPolicy.RUNTIME)
public @interface ReadOnly {}

// AOP 切面
@Aspect
@Component
@Order(Ordered.HIGHEST_PRECEDENCE)  // 确保在 @Transactional 之前执行
public class DataSourceAspect {

    @Around("@annotation(readOnly)")
    public Object around(ProceedingJoinPoint point, ReadOnly readOnly) throws Throwable {
        try {
            DataSourceContext.set("slave");
            return point.proceed();
        } finally {
            DataSourceContext.clear();
        }
    }

    @Around("@annotation(org.springframework.transaction.annotation.Transactional)")
    public Object aroundTransaction(ProceedingJoinPoint point) throws Throwable {
        try {
            DataSourceContext.set("master");  // 有事务的操作走主库
            return point.proceed();
        } finally {
            DataSourceContext.clear();
        }
    }
}

// 使用
@Service
public class UserService {

    @Transactional(rollbackFor = Exception.class)
    public void updateEmail(Long id, String email) {
        // 走主库（有 @Transactional）
        userMapper.updateEmail(id, email);
    }

    @ReadOnly
    public List<User> findAll() {
        // 走从库（有 @ReadOnly）
        return userMapper.findAll();
    }
}
```

#### 主从延迟问题

| 方案 | 原理 | 适用场景 |
|------|------|---------|
| 强制走主库 | 写后读都用主库 | 对一致性要求极高的场景 |
| 延迟检测 | 写后短暂时间内（如 1 秒内）强制走主库 | 读多写少，可接受短暂不一致 |
| GTID 同步检查 | 检查从库是否已同步到指定 GTID | 对一致性要求高，但实现复杂 |

> **踩坑提醒**：最常见的主从延迟问题：用户注册后立刻登录，从库还没同步用户数据，导致登录失败。解决：注册后直接走主库查询，或用 Redis 缓存刚写入的数据。

---

### 4.6.3 分库分表方案

**痛点**：单表数据量过亿，查询慢如蜗牛？分库分表是终极方案。

#### ShardingSphere-JDBC 分片原理

```
应用层
  → ShardingSphere JDBC（拦截 SQL，改写路由）
    → 数据源1（db_0, users_0, users_1）
    → 数据源2（db_1, users_2, users_3）
```

```yaml
# ShardingSphere 配置示例
spring:
  shardingsphere:
    datasource:
      names: ds0, ds1
      ds0:
        driver-class-name: com.mysql.cj.jdbc.Driver
        jdbc-url: jdbc:mysql://localhost:3306/db_0
        username: root
        password: root
      ds1:
        driver-class-name: com.mysql.cj.jdbc.Driver
        jdbc-url: jdbc:mysql://localhost:3307/db_1
        username: root
        password: root
    rules:
      sharding:
        tables:
          users:
            actual-data-nodes: ds$->{0..1}.users_$->{0..3}
            table-strategy:
              standard:
                sharding-column: user_id
                sharding-algorithm-name: users-inline
            database-strategy:
              standard:
                sharding-column: user_id
                sharding-algorithm-name: db-inline
        sharding-algorithms:
          users-inline:
            type: INLINE
            props:
              algorithm-expression: users_$->{user_id % 4}
          db-inline:
            type: INLINE
            props:
              algorithm-expression: ds$->{user_id % 2}
```

#### 分片策略对比

| 策略 | 优点 | 缺点 | 适用场景 |
|------|------|------|---------|
| Hash 分片 | 数据均匀 | 扩容困难（需迁移数据） | 数据量固定增长 |
| Range 分片 | 扩容简单 | 热点问题（新数据集中在一片） | 按时间分表 |
| 一致性 Hash | 扩容迁移少 | 实现复杂 | 弹性伸缩 |

> **踩坑提醒**：分库分表后，**跨片查询**和**分布式事务**是两大难题。`ORDER BY` + `LIMIT` 需要合并多片结果再排序，性能可能更差。分布式事务推荐用 Seata 的 AT 模式。分表前先考虑：读写分离、归档历史数据、缓存能否解决问题——分库分表应该是最后手段。

---

## 4.7 数据库迁移

### 4.7.1 Flyway

**痛点**：生产环境数据库结构跟开发环境不一样？手动执行 SQL 脚本容易遗漏？Flyway 自动管理数据库版本。

#### 基本使用

```
src/main/resources/db/migration/
  ├── V1__create_user_table.sql
  ├── V2__add_email_column.sql
  ├── V3__create_order_table.sql
  └── V4__add_index_on_email.sql
```

```sql
-- V1__create_user_table.sql
CREATE TABLE users (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(50) NOT NULL UNIQUE,
    email VARCHAR(100) NOT NULL,
    create_time DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

```yaml
# application.yml
spring:
  flyway:
    enabled: true
    locations: classpath:db/migration
    baseline-on-migrate: true     # 已有数据库时创建基线
    baseline-version: 0           # 基线版本号
    validate-on-migrate: true     # 迁移时校验脚本完整性
    out-of-order: false           # 是否允许乱序执行
```

#### Flyway 命名规则

| 类型 | 命名格式 | 说明 |
|------|---------|------|
| 版本迁移 | `V{版本号}__{描述}.sql` | `V1__create_user_table.sql` |
| 可重复执行 | `R__{描述}.sql` | `R__create_view.sql`（内容变化时重新执行） |
| 撤销（付费） | `U{版本号}__{描述}.sql` | Flyway Pro 功能 |

> **踩坑提醒**：`V` 版本号一旦执行成功就不能修改！Flyway 会计算脚本的 checksum，修改已执行的脚本会导致校验失败。如果需要修改已上线的表结构，创建新的 V 脚本。`baseline-on-migrate: true` 用于已有数据库的项目——它会把当前状态作为基线，只执行新脚本。

---

### 4.7.2 Liquibase

**痛点**：Flyway 只支持 SQL 脚本，想用 XML/YAML 管理迁移？Liquibase 更灵活。

#### changelog YAML 示例

```yaml
# changelog.yaml
databaseChangeLog:
  - changeSet:
      id: 1
      author: zhangsan
      changes:
        - createTable:
            tableName: users
            columns:
              - column:
                  name: id
                  type: BIGINT
                  autoIncrement: true
                  constraints:
                    primaryKey: true
                    nullable: false
              - column:
                  name: username
                  type: VARCHAR(50)
                  constraints:
                    nullable: false
                    unique: true
              - column:
                  name: email
                  type: VARCHAR(100)
                  constraints:
                    nullable: false

  - changeSet:
      id: 2
      author: zhangsan
      changes:
        - addColumn:
            tableName: users
            columns:
              - column:
                  name: phone
                  type: VARCHAR(20)

  - changeSet:
      id: 3
      author: zhangsan
      changes:
        - createIndex:
            tableName: users
            indexName: idx_email
            columns:
              - column:
                  name: email
```

#### Flyway vs Liquibase 选型

| 维度 | Flyway | Liquibase |
|------|--------|-----------|
| 迁移格式 | SQL 脚本为主 | XML/YAML/SQL/JSON |
| 学习曲线 | 低（就是 SQL） | 中（需学 changelog 格式） |
| 数据库无关 | ❌ SQL 依赖方言 | ✅ XML 抽象层 |
| 回滚支持 | 付费版 | ✅ 免费支持 |
| 社区活跃度 | 高 | 高 |
| Spring Boot 集成 | 原生支持 | 原生支持 |
| 推荐场景 | 团队 SQL 熟练、单数据库 | 多数据库、需要回滚 |

> **踩坑提醒**：Flyway 和 Liquibase 不要混用！它们各自维护一套迁移记录表（`flyway_schema_history` / `databasechangelog`），混用会导致版本管理混乱。选一个用到底。

---

## 4.8 响应式数据访问（R2DBC）

### 4.8.1 非阻塞数据库访问

**痛点**：WebFlux 的 Controller 是非阻塞的，但数据库查询还是 JDBC 阻塞的——这不白搭了吗？

#### JDBC 阻塞抵消 WebFlux 优势

```
WebFlux + JDBC（错误组合）：
  EventLoop 线程
    → 执行 JDBC 查询（阻塞 50ms）
      → 线程被挂起，无法处理其他请求
        → WebFlux 的非阻塞优势完全丧失

WebFlux + R2DBC（正确组合）：
  EventLoop 线程
    → 发起 R2DBC 查询（非阻塞）
      → 线程继续处理其他请求
        → 查询完成，通过回调返回结果
```

#### R2DBC vs JDBC

| 维度 | JDBC | R2DBC |
|------|------|-------|
| 编程模型 | 同步阻塞 | 异步非阻塞 |
| 连接模型 | 一个连接一个线程 | 连接可复用 |
| 返回类型 | 直接返回对象 | `Mono`/`Flux` |
| 驱动支持 | 所有数据库 | MySQL/PostgreSQL/H2 等 |
| 适用场景 | 传统 MVC | WebFlux 响应式 |

---

### 4.8.2 Spring Data R2DBC 实战

#### ReactiveCrudRepository

```java
// 依赖
// spring-boot-starter-data-r2dbc
// r2dbc-mysql 或 r2dbc-postgresql

// 实体
@Table("users")
public class User {
    @Id
    private Long id;
    private String username;
    private String email;
    private LocalDateTime createTime;
    // getters & setters
}

// Repository
public interface ReactiveUserRepository extends ReactiveCrudRepository<User, Long> {

    Mono<User> findByUsername(String username);

    Flux<User> findByEmailContaining(String keyword);

    @Query("SELECT * FROM users WHERE status = :status ORDER BY create_time DESC LIMIT :limit")
    Flux<User> findRecentByStatus(@Param("status") int status, @Param("limit") int limit);
}

// Service
@Service
public class ReactiveUserService {

    @Autowired
    private ReactiveUserRepository userRepository;

    public Mono<User> findById(Long id) {
        return userRepository.findById(id)
            .switchIfEmpty(Mono.error(new ResourceNotFoundException("User not found")));
    }

    public Flux<User> search(String keyword) {
        return userRepository.findByEmailContaining(keyword);
    }

    public Mono<User> createUser(User user) {
        user.setCreateTime(LocalDateTime.now());
        return userRepository.save(user);
    }
}

// Controller
@RestController
@RequestMapping("/api/users")
public class ReactiveUserController {

    @Autowired
    private ReactiveUserService userService;

    @GetMapping("/{id}")
    public Mono<User> getUser(@PathVariable Long id) {
        return userService.findById(id);
    }

    @GetMapping
    public Flux<User> listUsers(@RequestParam(required = false) String keyword) {
        if (StringUtils.isNotBlank(keyword)) {
            return userService.search(keyword);
        }
        return userService.findAll();
    }
}
```

#### DatabaseClient（更灵活）

```java
@Service
public class UserQueryService {

    @Autowired
    private DatabaseClient databaseClient;

    // 复杂查询
    public Flux<User> findByComplexCondition(String username, Integer minAge) {
        return databaseClient.sql(
                "SELECT * FROM users WHERE username LIKE :name AND age >= :age")
            .bind("name", "%" + username + "%")
            .bind("age", minAge)
            .map((row, metadata) -> {
                User user = new User();
                user.setId(row.get("id", Long.class));
                user.setUsername(row.get("username", String.class));
                user.setEmail(row.get("email", String.class));
                return user;
            })
            .all();
    }

    // 事务（使用 TransactionalOperator）
    @Transactional
    public Mono<Void> transfer(Long fromId, Long toId, BigDecimal amount) {
        return databaseClient.sql(
                "UPDATE accounts SET balance = balance - :amount WHERE id = :id AND balance >= :amount")
            .bind("amount", amount)
            .bind("id", fromId)
            .fetch()
            .rowsUpdated()
            .flatMap(rows -> {
                if (rows == 0) {
                    return Mono.error(new BusinessException("余额不足"));
                }
                return databaseClient.sql(
                        "UPDATE accounts SET balance = balance + :amount WHERE id = :id")
                    .bind("amount", amount)
                    .bind("id", toId)
                    .fetch()
                    .rowsUpdated()
                    .then();
            });
    }
}
```

#### R2DBC 限制

| 限制 | 说明 | 解决方案 |
|------|------|---------|
| 不支持 `@OneToMany` | 无 ORM 关联映射 | 手动 JOIN 或多次查询 |
| 不支持分页 | 无 Pageable 内置支持 | 手动 `LIMIT/OFFSET` |
| 连接池 | 需要额外配置 | 配置 `r2dbc-pool` |
| 驱动成熟度 | 部分数据库驱动不完善 | MySQL/PostgreSQL 较成熟 |

> **踩坑提醒**：R2DBC 的 `@Transactional` 依赖 `ReactiveTransactionManager`，不是传统的 `DataSourceTransactionManager`。Spring Boot 会自动配置，但如果你混用 JDBC 和 R2DBC，需要确保事务管理器正确。另外 R2DBC 不支持 `@Modifying` 注解，更新操作需要使用 `DatabaseClient`。

---

## 本章总结

Spring 数据访问与事务的核心脉络：

1. **抽象层**：Spring 对 JDBC/MyBatis/JPA 的统一抽象，异常转换、事务管理、资源管理
2. **持久化框架**：MyBatis（SQL 映射器，灵活）vs JPA（ORM，面向对象）——按团队能力和项目需求选择
3. **事务管理**：`@Transactional` 声明式事务是默认选择，理解传播行为、隔离级别、失效场景是关键
4. **高级特性**：多数据源、读写分离、分库分表——按数据规模逐步引入
5. **工程化**：Flyway/Liquibase 数据库迁移，保证环境一致性
6. **响应式**：R2DBC 解决 WebFlux 的数据访问瓶颈，但生态不如 JDBC 成熟

数据访问是应用的基石。写对 SQL、管好事务、选好框架，后端开发就稳了大半。
