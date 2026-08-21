# MyBatis 集成

> 独立使用 MyBatis 要写 20 行模板代码：建 `SqlSessionFactory`、开 `SqlSession`、拿 Mapper、提交、关闭。Spring 整合后一个 `@Autowired UserMapper` 就够了。本章前三节讲用法，后四节讲原理——Mapper 接口凭什么能注入、`SqlSessionTemplate` 为什么线程安全、一级缓存为什么「失效」。

## 1. 配置

```yaml
mybatis:
  mapper-locations: classpath:mapper/*.xml
  type-aliases-package: com.example.entity
  configuration:
    map-underscore-to-camel-case: true
```

## 2. Mapper 接口

```java
@Mapper
public interface UserMapper {
    @Select("SELECT * FROM user WHERE id = #{id}")
    User findById(Long id);
    
    @Insert("INSERT INTO user(name, email) VALUES(#{name}, #{email})")
    @Options(useGeneratedKeys = true)
    int insert(User user);
}
```

## 3. MyBatis-Plus

```java
public interface UserMapper extends BaseMapper<User> {
    // 自动拥有 CRUD 方法
}

// 使用
List<User> users = userMapper.selectList(
    new QueryWrapper<User>().eq("status", 1)
);
```

## 4. MyBatis 高级用法

### 4.1 动态 SQL

```xml
<!-- mapper/UserMapper.xml -->
<mapper namespace="com.example.mapper.UserMapper">

    <!-- if 条件判断 -->
    <select id="searchUsers" resultType="User">
        SELECT * FROM users
        <where>
            <if test="keyword != null and keyword != ''">
                AND (name LIKE CONCAT('%', #{keyword}, '%')
                  OR email LIKE CONCAT('%', #{keyword}, '%'))
            </if>
            <if test="status != null">
                AND status = #{status}
            </if>
            <if test="minAge != null">
                AND age >= #{minAge}
            </if>
            <if test="maxAge != null">
                AND age <= #{maxAge}
            </if>
        </where>
        ORDER BY created_at DESC
    </select>

    <!-- foreach 批量插入 -->
    <insert id="batchInsert">
        INSERT INTO users (name, email, status) VALUES
        <foreach collection="list" item="user" separator=",">
            (#{user.name}, #{user.email}, #{user.status})
        </foreach>
    </insert>

    <!-- choose/when/otherwise 多条件分支 -->
    <select id="findUsers" resultType="User">
        SELECT * FROM users
        <where>
            <choose>
                <when test="id != null">
                    AND id = #{id}
                </when>
                <when test="email != null">
                    AND email = #{email}
                </when>
                <otherwise>
                    AND status = 'ACTIVE'
                </otherwise>
            </choose>
        </where>
    </select>

</mapper>
```

### 4.2 结果映射（嵌套对象）

```xml
<!-- 一对多映射 -->
<resultMap id="orderWithItems" type="Order">
    <id property="id" column="order_id"/>
    <result property="orderNo" column="order_no"/>
    <result property="totalAmount" column="total_amount"/>
    <result property="createdAt" column="created_at"/>

    <!-- 关联用户 -->
    <association property="user" javaType="User">
        <id property="id" column="user_id"/>
        <result property="name" column="user_name"/>
    </association>

    <!-- 关联订单项 -->
    <collection property="items" ofType="OrderItem">
        <id property="id" column="item_id"/>
        <result property="productName" column="product_name"/>
        <result property="quantity" column="quantity"/>
        <result property="price" column="price"/>
    </collection>
</resultMap>

<select id="findOrderWithItems" resultMap="orderWithItems">
    SELECT o.id AS order_id, o.order_no, o.total_amount, o.created_at,
           u.id AS user_id, u.name AS user_name,
           oi.id AS item_id, oi.product_name, oi.quantity, oi.price
    FROM orders o
    LEFT JOIN users u ON o.user_id = u.id
    LEFT JOIN order_items oi ON o.id = oi.order_id
    WHERE o.id = #{orderId}
</select>
```

### 4.3 MyBatis-Plus 高级查询

```java
public interface UserMapper extends BaseMapper<User> {

    // 自定义 SQL
    @Select("SELECT u.*, o.order_count FROM users u " +
            "LEFT JOIN (SELECT user_id, COUNT(*) as order_count " +
            "FROM orders GROUP BY user_id) o ON u.id = o.user_id " +
            "WHERE u.id = #{id}")
    UserWithOrderCount selectWithOrderCount(@Param("id") Long id);
}

// Service 层使用 LambdaQueryWrapper
@Service
public class UserServiceImpl extends ServiceImpl<UserMapper, User> implements UserService {

    public IPage<User> searchUsers(UserSearchRequest request) {
        LambdaQueryWrapper<User> wrapper = new LambdaQueryWrapper<User>()
            .like(StringUtils.isNotBlank(request.getKeyword()),
                  User::getName, request.getKeyword())
            .eq(request.getStatus() != null, User::getStatus, request.getStatus())
            .between(request.getMinAge() != null && request.getMaxAge() != null,
                     User::getAge, request.getMinAge(), request.getMaxAge())
            .orderByDesc(User::getCreatedAt);

        return page(new Page<>(request.getPage(), request.getSize()), wrapper);
    }

    // 批量插入
    public void batchInsert(List<User> users) {
        saveBatch(users, 500);  // 每批 500 条
    }
}
```

### 4.4 MyBatis 拦截器（插件）

```java
@Component
@Intercepts({
    @Signature(type = Executor.class, method = "query",
        args = {MappedStatement.class, Object.class, RowBounds.class, ResultHandler.class})
})
public class SlowSqlInterceptor implements Interceptor {

    private static final Logger log = LoggerFactory.getLogger(SlowSqlInterceptor.class);
    private static final long SLOW_SQL_THRESHOLD = 1000; // 1 秒

    @Override
    public Object intercept(Invocation invocation) throws Throwable {
        long start = System.currentTimeMillis();
        try {
            return invocation.proceed();
        } finally {
            long elapsed = System.currentTimeMillis() - start;
            if (elapsed > SLOW_SQL_THRESHOLD) {
                MappedStatement ms = (MappedStatement) invocation.getArgs()[0];
                log.warn("慢 SQL [{}ms]: {}", elapsed, ms.getId());
            }
        }
    }

    @Override
    public Object plugin(Object target) {
        return Plugin.wrap(target, this);
    }
}
```

**最佳实践：**

1. **动态 SQL 用 XML**——复杂的条件查询放在 XML 中更清晰
2. **简单查询用注解**——`@Select`、`@Insert` 适合简单 CRUD
3. **批量操作注意分批**——MySQL 的 `max_allowed_packet` 限制单条 SQL 大小
4. **慢 SQL 监控**——拦截器记录超过阈值的 SQL，及时优化

---

## 5. 原理：Mapper 为什么能注入

MyBatis 的 Mapper 接口没有任何实现类，`@Autowired UserMapper` 却不会报错。这背后是 `@MapperScan` 的三步注册，以及 `MapperProxy` 的动态代理。

### 5.1 没有 @MapperScan 时的问题

Mapper 接口没有 `@Component` 注解，Spring 默认不扫描它们。直接注入会报错：

```text
NoSuchBeanDefinitionException: No qualifying bean of type 'UserMapper'
```

传统方案是给每个 Mapper 加 `@Mapper` 注解，但当项目有几十上百个 Mapper 时，逐个添加非常繁琐。`@MapperScan` 解决的就是批量注册。

### 5.2 @MapperScan 的三步

```java
@SpringBootApplication
@MapperScan("com.example.mapper")  // 扫描指定包下的所有 Mapper 接口
public class MyApplication {
    public static void main(String[] args) {
        SpringApplication.run(MyApplication.class, args);
    }
}
```

```text
@MapperScan("com.example.mapper")
    │
    ▼
第1步：@Import(MapperScannerRegistrar.class)
    │     ImportBeanDefinitionRegistrar 实现，在 BeanDefinition 注册阶段被调用
    ▼
第2步：创建 ClassPathMapperScanner
    │     继承 Spring 的 ClassPathBeanDefinitionScanner，专门扫描 Mapper 接口
    ▼
第3步：将每个 Mapper 接口的 BeanDefinition 替换为 MapperFactoryBean
          ├── 设置 mapperInterface = UserMapper.class
          ├── 设置 sqlSessionFactory（自动注入）
          └── MapperFactoryBean.getObject() 返回 SqlSession.getMapper() 的代理对象
```

**MapperFactoryBean 的关键代码**：

```java
public class MapperFactoryBean<T> extends SqlSessionDaoSupport
        implements FactoryBean<T> {

    private Class<T> mapperInterface;

    @Override
    public T getObject() throws Exception {
        // 最终调用 SqlSession.getMapper(mapperInterface)
        return getSqlSession().getMapper(this.mapperInterface);
    }

    @Override
    public Class<T> getObjectType() {
        return this.mapperInterface;
    }
}
```

### 5.3 MapperProxy 的本质

Mapper 接口没有实现类，`getMapper()` 返回的是一个 **JDK 动态代理**：

```java
public class MapperProxy<T> implements InvocationHandler {

    private final SqlSession sqlSession;
    private final Class<T> mapperInterface;

    @Override
    public Object invoke(Object proxy, Method method, Object[] args) {
        // 根据接口全限定名 + 方法名，定位到 MappedStatement
        String statementId = mapperInterface.getName() + "." + method.getName();
        if (method.getReturnType() == List.class) {
            return sqlSession.selectList(statementId, args[0]);
        } else {
            return sqlSession.selectOne(statementId, args[0]);
        }
    }
}
```

这就是 Mapper 接口不需要实现类的根本原因：每一次方法调用都被代理拦截，转化为 SQL 执行。

---

## 6. 原理：SqlSessionTemplate 的线程安全设计

### 6.1 DefaultSqlSession 的问题

MyBatis 默认的 `DefaultSqlSession` **非线程安全**：

```java
public class DefaultSqlSession implements SqlSession {
    private Configuration configuration;
    private Executor executor;       // 执行器，持有 Connection
    private boolean dirty;           // 是否有写操作
}
```

`Executor` 内部持有数据库连接。多线程共享同一个 `DefaultSqlSession` 会导致连接被并发使用、`dirty` 标记并发修改，数据错乱。

### 6.2 SqlSessionTemplate 的代理拦截

Spring 的 `SqlSessionTemplate` 实现了 `SqlSession` 接口，但内部不直接干活，而是把所有调用委托给一个动态代理：

```java
private class SqlSessionInterceptor implements InvocationHandler {
    @Override
    public Object invoke(Object proxy, Method method, Object[] args) {
        // 每次调用都获取一个与当前事务绑定的 SqlSession
        SqlSession sqlSession = getSqlSession(
            SqlSessionTemplate.this.sqlSessionFactory,
            SqlSessionTemplate.this.executorType,
            SqlSessionTemplate.this.exceptionTranslator
        );
        try {
            Object result = method.invoke(sqlSession, args);
            // 非事务环境，手动 commit
            if (!isSqlSessionTransactional(sqlSession, SqlSessionTemplate.this.sqlSessionFactory)) {
                sqlSession.commit(true);
            }
            return result;
        } catch (Throwable t) {
            // 异常转换：MyBatis 异常 → Spring DataAccessException
            throw exceptionTranslator.translate("...", "...", t);
        } finally {
            // 关闭 SqlSession（实际是减少引用计数）
            closeSqlSession(sqlSession, SqlSessionTemplate.this.sqlSessionFactory);
        }
    }
}
```

关键点：**每次调用都获取一个与当前事务绑定的新 SqlSession**，用完即关，所以线程安全。

### 6.3 对比总结

| 特性 | DefaultSqlSession | SqlSessionTemplate |
| :-- | :-- | :-- |
| 线程安全 | ❌ 非线程安全 | ✅ 每次调用获取新 Session |
| 事务感知 | ❌ 不感知 Spring 事务 | ✅ 自动绑定到当前事务 |
| 异常转换 | ❌ 抛 MyBatis 原生异常 | ✅ 转换为 Spring DataAccessException |
| 生命周期管理 | ❌ 需手动 close | ✅ finally 中自动关闭 |

---

## 7. 原理：一级缓存为什么「失效」

### 7.1 一级缓存的基本原理

MyBatis 一级缓存是 SqlSession 级别的。同一个 SqlSession 里，执行相同的查询会命中缓存：

```java
SqlSession session = sqlSessionFactory.openSession();
UserMapper mapper = session.getMapper(UserMapper.class);

User user1 = mapper.selectById(1L);  // 查数据库
User user2 = mapper.selectById(1L);  // 命中一级缓存，不查数据库
System.out.println(user1 == user2);  // true，同一个对象
```

### 7.2 Spring 中「失效」的现象

```java
@Service
public class UserService {

    @Autowired
    private UserMapper userMapper;

    public void testCache() {
        User user1 = userMapper.selectById(1L);  // 查数据库
        User user2 = userMapper.selectById(1L);  // 还是查数据库！
        System.out.println(user1 == user2);       // false
    }
}
```

两次查询之间没有更新，第二次却仍然查库。原因在 `SqlSessionTemplate` 的生命周期设计。

### 7.3 原因：SqlSession 的生命周期

**没有 `@Transactional` 时**，每次 Mapper 调用都会走一遍「获取新 SqlSession → 执行 → 关闭」，一级缓存随 SqlSession 关闭而清空。两次 `selectById` 用的是不同 SqlSession，缓存自然无法命中。

**加上 `@Transactional` 后**，Spring 事务管理器确保整个事务期间复用同一个 SqlSession，缓存才能命中：

```java
@Transactional
public void testCache() {
    User user1 = userMapper.selectById(1L);  // 查数据库
    User user2 = userMapper.selectById(1L);  // 命中一级缓存！
    System.out.println(user1 == user2);       // true
}
```

### 7.4 这是刻意设计，不是 Bug

**无事务场景**：每次查询独立操作，用独立 SqlSession 合理——若复用，缓存可能过时、连接隐式持有导致泄漏。

**有事务场景**：同事务内操作天然有隔离性保证，复用 SqlSession 安全，缓存随事务提交/回滚自然清除。

### 7.5 实践建议

| 场景 | 建议 |
| :-- | :-- |
| 需要缓存 | 用 `@Transactional`，或 MyBatis 二级缓存 / Spring Cache |
| 不需要缓存 | 不加 `@Transactional`，每次拿最新数据 |
| 跨方法复用缓存 | 把多次查询放进同一个 `@Transactional` 方法 |
| 高并发场景 | 慎用一级缓存，考虑 Redis 等分布式缓存 |


