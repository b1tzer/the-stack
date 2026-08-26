# Spring 整合数据访问

> 独立使用 MyBatis，20 行模板代码：创建 SqlSessionFactory、获取 SqlSession、获取 Mapper、执行 SQL、处理异常、关闭 SqlSession。整合 Spring 后，一个 `@Autowired UserMapper mapper` 就够了，其余全部消失。Spring 到底对 MyBatis 做了什么，让 Mapper 接口可以直接注入、事务自动生效、缓存行为发生变化？

## 1. 核心问题：独立 vs 整合

### 1.1 独立使用 MyBatis 的完整流程

在没有 Spring 的情况下，使用 MyBatis 需要手动完成每一步：

```java
// 第1步：读取配置，构建 SqlSessionFactory
String resource = "mybatis-config.xml";
InputStream inputStream = Resources.getResourceAsStream(resource);
SqlSessionFactory sqlSessionFactory =
    new SqlSessionFactoryBuilder().build(inputStream);

// 第2步：打开 SqlSession
SqlSession session = sqlSessionFactory.openSession();

// 第3步：获取 Mapper 代理对象
UserMapper mapper = session.getMapper(UserMapper.class);

// 第4步：执行 SQL
User user = mapper.selectById(1L);
System.out.println(user.getName());

// 第5步：手动提交/回滚事务
session.commit();  // 或 session.rollback()

// 第6步：关闭 SqlSession
session.close();
```

每一个步骤都不能省略，每一步都可能出错（忘记关闭、忘记提交、异常时未回滚）。

### 1.2 Spring 整合后的使用方式

```java
@Service
public class UserService {

    @Autowired
    private UserMapper userMapper;  // 直接注入，无需手动创建

    @Transactional
    public User getUser(Long id) {
        return userMapper.selectById(id);  // 直接调用，事务自动管理
    }
    // 方法结束自动提交/回滚，无需手动关闭资源
}
```

### 1.3 核心差异对比

| 维度 | 独立 MyBatis | Spring 整合后 |
|------|-------------|--------------|
| **Mapper 创建** | `session.getMapper()` 手动获取 | `@Autowired` 自动注入 |
| **SqlSession 管理** | 手动 open/close，必须 finally 关闭 | `SqlSessionTemplate` 自动管理 |
| **事务管理** | 手动 commit/rollback | `@Transactional` 声明式事务 |
| **异常处理** | MyBatis 的 `PersistenceException` | 自动转换为 Spring 的 `DataAccessException` |
| **连接获取** | 每次手动从 DataSource 获取 | `DataSourceUtils.getConnection()` 与事务上下文绑定 |
| **线程安全** | SqlSession 非线程安全，需小心 | `SqlSessionTemplate` 内部线程安全 |
| **缓存行为** | 一级缓存在 SqlSession 生命周期内有效 | 一级缓存与事务绑定（详见 5.4） |

```text
独立 MyBatis 流程：
┌──────────┐    ┌──────────────┐    ┌───────────┐
│ 手动读取  │───→│ 手动创建      │───→│ 手动获取   │
│ 配置文件  │    │ SqlSessionFactory│  │ SqlSession │
└──────────┘    └──────────────┘    └─────┬─────┘
                                          │
    ┌─────────────┐    ┌────────────────┐ │
    │ 手动关闭     │←───│ 手动 commit    │←┘
    │ SqlSession   │    │ /rollback      │
    └─────────────┘    └────────────────┘

Spring 整合后流程：
┌──────────┐    ┌─────────────────┐    ┌──────────────┐
│ @MapperScan│───→│ MapperFactoryBean│───→│ @Autowired    │
│ 扫描接口  │    │ 创建代理对象      │    │ 注入 Mapper   │
└──────────┘    └─────────────────┘    └──────┬───────┘
                                              │
                              ┌────────────────┤
                              ▼                ▼
                    ┌──────────────┐  ┌──────────────┐
                    │ SqlSessionTemplate│  │ @Transactional│
                    │ 自动管理 Session │  │ 自动管理事务   │
                    └──────────────┘  └──────────────┘
```

## 2. @MapperScan 原理

### 2.1 没有 @MapperScan 时的问题

MyBatis 的 Mapper 接口没有 `@Component` 注解，Spring 默认不会扫描它们。如果不做任何配置，直接 `@Autowired UserMapper` 会报错：

```text
NoSuchBeanDefinitionException: No qualifying bean of type 'UserMapper'
```

传统解决方案是给每个 Mapper 加 `@Mapper` 注解：

```java
@Mapper  // 每个 Mapper 都要加
public interface UserMapper {
    User selectById(Long id);
}
```

但当项目有几十上百个 Mapper 时，逐个添加注解非常繁琐。`@MapperScan` 就是为了解决批量注册的问题。

### 2.2 @MapperScan 的使用

```java
@SpringBootApplication
@MapperScan("com.example.mapper")  // 扫描指定包下的所有 Mapper 接口
public class MyApplication {
    public static void main(String[] args) {
        SpringApplication.run(MyApplication.class, args);
    }
}
```

一行注解，`com.example.mapper` 包下的所有接口都会被注册为 Spring Bean。

### 2.3 源码解析：三步完成 Mapper 注册

`@MapperScan` 的核心流程分为三步：

```text
@MapperScan("com.example.mapper")
    │
    ▼
第1步：@Import(MapperScannerRegistrar.class)
    │     ImportBeanDefinitionRegistrar 实现
    │     在 BeanDefinition 注册阶段被调用
    │
    ▼
第2步：创建 ClassPathMapperScanner
    │     继承自 Spring 的 ClassPathBeanDefinitionScanner
    │     专门用于扫描 Mapper 接口
    │
    ▼
第3步：将每个 Mapper 接口的 BeanDefinition 替换为 MapperFactoryBean
          │
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

**时序图**：

![spring-mybatis-integration](/spring/spring-mybatis-integration.svg)

### 2.4 MapperProxy 的本质

MyBatis 的 Mapper 接口并没有实现类。`getMapper()` 返回的是一个 **JDK 动态代理**对象：

```java
// MyBatis 内部
public class MapperProxy<T> implements InvocationHandler {

    private final SqlSession sqlSession;
    private final Class<T> mapperInterface;

    @Override
    public Object invoke(Object proxy, Method method, Object[] args) {
        // 根据接口全限定名 + 方法名，定位到 MappedStatement
        String statementId = mapperInterface.getName() + "." + method.getName();
        // 根据方法返回类型决定调用方式
        if (method.getReturnType() == List.class) {
            return sqlSession.selectList(statementId, args[0]);
        } else {
            return sqlSession.selectOne(statementId, args[0]);
        }
    }
}
```

这就是为什么 Mapper 接口不需要实现类——每一次方法调用都被代理拦截，转化为 SQL 执行。

## 3. SqlSessionTemplate

### 3.1 DefaultSqlSession 的问题

MyBatis 默认的 `DefaultSqlSession` 有一个致命问题：**非线程安全**。

```java
// DefaultSqlSession 的核心字段
public class DefaultSqlSession implements SqlSession {
    private Configuration configuration;
    private Executor executor;       // 执行器，持有 Connection
    private boolean dirty;           // 是否有写操作
    // ...
}
```

`Executor` 内部持有数据库连接，如果多线程共享同一个 `DefaultSqlSession`，会导致：
- 连接被多个线程同时使用，数据错乱
- `dirty` 标记被并发修改，事务状态不确定
- 缓存操作不是线程安全的

### 3.2 SqlSessionTemplate 的设计

Spring 提供的 `SqlSessionTemplate` 实现了 `SqlSession` 接口，同时实现了 `DisposableBean`。它的核心设计是：

```java
public class SqlSessionTemplate implements SqlSession, DisposableBean {

    private final SqlSessionFactory sqlSessionFactory;
    private final SqlSessionInterceptor proxyInterceptor;

    // 构造时创建一个代理
    public SqlSessionTemplate(SqlSessionFactory sqlSessionFactory,
                               ExecutorType executorType,
                               PersistenceExceptionTranslator exceptionTranslator) {
        // ...
        this.sqlSessionProxy = (SqlSession) Proxy.newProxyInstance(
            SqlSessionFactory.class.getClassLoader(),
            new Class[]{SqlSession.class},
            proxyInterceptor   // 所有方法调用都经过拦截器
        );
    }

    @Override
    public <T> T selectOne(String statement) {
        return this.sqlSessionProxy.selectOne(statement);
    }
    // ... 其他方法同理，都委托给代理
}
```

**SqlSessionInterceptor 拦截器**是关键：

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
            // 关键：关闭 SqlSession（实际是减少引用计数）
            closeSqlSession(sqlSession, SqlSessionTemplate.this.sqlSessionFactory);
        }
    }
}
```

### 3.3 对比总结

| 特性 | DefaultSqlSession | SqlSessionTemplate |
|------|-------------------|-------------------|
| 线程安全 | ❌ 非线程安全 | ✅ 线程安全（每次调用获取新 Session） |
| 事务感知 | ❌ 不感知 Spring 事务 | ✅ 自动绑定到当前事务 |
| 异常转换 | ❌ 抛出 MyBatis 原生异常 | ✅ 转换为 Spring DataAccessException |
| 生命周期管理 | ❌ 需手动 close | ✅ 自动管理（finally 中关闭） |
| 使用方式 | 手动创建和销毁 | 注入后直接使用 |

```text
DefaultSqlSession（非线程安全）：
Thread-1 ──┐
            ├──→ [同一个 SqlSession] ──→ 数据错乱！
Thread-2 ──┘

SqlSessionTemplate（线程安全）：
Thread-1 ──→ [SqlSession A] ──→ 正常执行 → 自动关闭
Thread-2 ──→ [SqlSession B] ──→ 正常执行 → 自动关闭
Thread-3 ──→ [SqlSession C] ──→ 正常执行 → 自动关闭
            （每次调用获取新 Session，互不干扰）
```

## 4. 一级缓存"失效"的真相

### 4.1 一级缓存的基本原理

MyBatis 的一级缓存是 SqlSession 级别的缓存。在同一个 SqlSession 中，执行相同的查询会命中缓存：

```java
// 独立使用 MyBatis
SqlSession session = sqlSessionFactory.openSession();
UserMapper mapper = session.getMapper(UserMapper.class);

User user1 = mapper.selectById(1L);  // 查询数据库
User user2 = mapper.selectById(1L);  // 命中一级缓存，不查数据库

System.out.println(user1 == user2);  // true，同一个对象
```

### 4.2 Spring 中一级缓存"失效"的困惑

很多开发者在 Spring 中发现一级缓存"不生效"了：

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

两次查询之间没有更新操作，按理说第二次应该命中缓存，但实际上每次都查了数据库。这是为什么？

### 4.3 原因分析：SqlSession 的生命周期

答案在于 `SqlSessionTemplate` 的设计。回顾前面的拦截器代码：

```java
// SqlSessionInterceptor.invoke() 的关键逻辑
SqlSession sqlSession = getSqlSession(...);  // 获取 SqlSession
try {
    Object result = method.invoke(sqlSession, args);
    return result;
} finally {
    closeSqlSession(sqlSession, ...);  // 关闭 SqlSession
}
```

**没有 `@Transactional` 时**：每次 Mapper 调用都会：
1. 获取一个新的 SqlSession
2. 执行查询
3. 关闭 SqlSession（一级缓存随之清空）

所以两次 `selectById` 使用的是不同的 SqlSession，缓存自然无法命中。

### 4.4 加上 @Transactional 后的变化

```java
@Service
public class UserService {

    @Autowired
    private UserMapper userMapper;

    @Transactional  // 加上事务注解
    public void testCache() {
        User user1 = userMapper.selectById(1L);  // 查数据库
        User user2 = userMapper.selectById(1L);  // 命中一级缓存！
        System.out.println(user1 == user2);       // true
    }
}
```

**有 `@Transactional` 时**：Spring 的事务管理器确保整个事务期间复用同一个 SqlSession：

```text
没有 @Transactional：
调用 selectById(1)
    │
    ├── getSqlSession()      → 创建 SqlSession-1
    ├── selectById(1)        → 查数据库
    ├── closeSqlSession()    → 关闭 SqlSession-1（缓存清空）
    │
调用 selectById(1)
    │
    ├── getSqlSession()      → 创建 SqlSession-2（新的！）
    ├── selectById(1)        → 查数据库（缓存未命中）
    └── closeSqlSession()    → 关闭 SqlSession-2

有 @Transactional：
开启事务
    │
    ├── getSqlSession()      → 创建/获取 SqlSession-1，绑定到当前事务
    ├── selectById(1)        → 查数据库
    │
    ├── getSqlSession()      → 获取到同一个 SqlSession-1（从事务上下文）
    ├── selectById(1)        → 命中一级缓存！
    │
提交事务
    └── closeSqlSession()    → 关闭 SqlSession-1
```

### 4.5 Spring 的设计选择

这不是 Bug，而是 Spring 的 **刻意设计**。理由如下：

**无事务场景**：每次查询都是独立操作，使用独立的 SqlSession 是合理的。如果复用 SqlSession，会导致：
- 缓存数据可能过时（其他事务可能已修改数据）
- SqlSession 的生命周期难以管理
- 隐式持有数据库连接，可能导致连接泄漏

**有事务场景**：同一事务内的操作天然具有隔离性保证，复用 SqlSession 是安全的。缓存在事务范围内有效，事务提交/回滚后 SqlSession 被关闭，缓存自然清除。

```text
┌──────────────────────────────────────────────────────────┐
│              一级缓存在 Spring 中的行为                     │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  无 @Transactional                                       │
│  ┌──────┐   ┌──────┐   ┌──────┐                        │
│  │Session│   │Session│   │Session│  ← 每次新建           │
│  │  -1   │   │  -2   │   │  -3   │                      │
│  └──┬───┘   └──┬───┘   └──┬───┘                        │
│     │          │          │                              │
│   缓存失效   缓存失效   缓存失效  ← 缓存永远不命中         │
│                                                          │
│  有 @Transactional                                       │
│  ┌──────────────────────────────┐                       │
│  │        Session - 1           │  ← 事务内复用          │
│  │  ┌─────┐  ┌─────┐  ┌─────┐ │                       │
│  │  │缓存 │  │缓存 │  │缓存 │ │                       │
│  │  │命中  │  │命中  │  │未命中│ │                       │
│  │  └─────┘  └─────┘  └─────┘ │                       │
│  └──────────────────────────────┘                       │
│     事务结束 → Session 关闭 → 缓存清空                    │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

### 4.6 实践建议

| 场景 | 建议 |
|------|------|
| 需要缓存 | 使用 `@Transactional`，或使用 MyBatis 二级缓存 / Spring Cache |
| 不需要缓存 | 不加 `@Transactional`，每次查询获取最新数据 |
| 跨方法复用缓存 | 将多次查询放在同一个 `@Transactional` 方法中 |
| 高并发场景 | 慎用一级缓存，考虑 Redis 等分布式缓存 |

