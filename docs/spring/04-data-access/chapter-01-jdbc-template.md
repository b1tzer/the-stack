# JdbcTemplate

> 独立用 JDBC 查一条数据，要写六步：加载驱动、建立连接、创建 Statement、执行查询、遍历结果集、在 finally 里关闭三个资源。JdbcTemplate 把这六步收成一行 `jdbcTemplate.query(sql, rowMapper, id)`。它不是「用得少就没价值」的边角料——MyBatis 的 `SqlSessionTemplate`、JPA 的 `EntityManager`，解决的都是它先解决过的问题：资源管理、异常转换、样板代码收敛。本章只讲 JdbcTemplate 本身，MyBatis 见 [第二章](./chapter-02-mybatis-integration.md)，事务见 [第四章](./chapter-04-transaction.md)。

## 1. 裸 JDBC 的六步样板

### 1.1 一段必须写完的代码

没有 Spring 时，用 JDBC 查一个用户，六步一步都不能少：

```java
// 第1步：加载驱动
Class.forName("com.mysql.cj.jdbc.Driver");

// 第2步：建立连接
Connection conn = DriverManager.getConnection(
    "jdbc:mysql://localhost:3306/app", "root", "password");

// 第3步：创建 PreparedStatement
PreparedStatement stmt = conn.prepareStatement("SELECT id, name FROM users WHERE id = ?");
stmt.setLong(1, id);

// 第4步：执行查询
ResultSet rs = stmt.executeQuery();

// 第5步：遍历结果集，手动映射对象
User user = null;
if (rs.next()) {
    user = new User(rs.getLong("id"), rs.getString("name"));
}

// 第6步：finally 里按逆序关闭三个资源
try {
    // ...
} finally {
    if (rs != null) rs.close();
    if (stmt != null) stmt.close();
    if (conn != null) conn.close();
}
```

六个步骤里，真正与业务相关的只有第 5 步——把 `ResultSet` 里的字段塞进 `User` 对象。其余五步是每次查询都要重写的模板。

### 1.2 样板代码的三处成本

这套模板不只是「写起来烦」，它有三个具体的危害：

| 成本 | 后果 |
| :-- | :-- |
| 资源泄漏 | 忘记关闭 `Connection`，连接池很快耗尽，线上开始报「连接不可用」 |
| 异常处理错乱 | `SQLException` 是受检异常，开发者为省事 `try-catch` 后吞掉，问题被掩盖 |
| 业务逻辑被淹没 | 五步样板夹着一步业务，改查询时很难一眼定位真正要改的那行 |

这三个问题，是 JdbcTemplate 诞生的直接原因，也是判断它「值不值得学」的标尺。

## 2. JdbcTemplate 如何收敛样板：模板方法 + 回调

### 2.1 先看可运行的样子

引入 `spring-boot-starter-jdbc` 后，`JdbcTemplate` 已由自动配置注册好，直接注入：

```java
@Service
public class UserService {

    private final JdbcTemplate jdbcTemplate;

    public UserService(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    public User findById(Long id) {
        return jdbcTemplate.queryForObject(
            "SELECT id, name FROM users WHERE id = ?",
            (rs, rowNum) -> new User(rs.getLong("id"), rs.getString("name")),
            id
        );
    }
}
```

第 1.1 节的六步，收敛成了三样东西：SQL 字符串、一个把行映射成对象的回调、查询参数。连接获取、Statement 创建、资源关闭全部消失。

### 2.2 模板方法与回调的分工

`JdbcTemplate` 的每一个查询方法，都是模板方法模式的一次应用：

```text
JdbcTemplate（模板方法，负责不变的流程）
    ├── 从 DataSource 拿连接
    ├── 创建 PreparedStatement
    ├── 绑定参数
    ├── 执行 SQL
    ├── 调用回调 → 用户只写这一块
    ├── 转换异常
    └── finally 归还连接（关 ResultSet / Statement / Connection）
```

模板方法模式把「不变的流程」与「变化的部分」拆开：流程固定，由 `JdbcTemplate` 持有；变化的是「这一行怎么映射成对象」，由调用方以回调（`RowMapper`）传入。

### 2.3 回调接口的形态

`JdbcTemplate` 依赖几个核心回调接口，它们共同构成整个 API 的形状：

| 回调接口 | 职责 | 典型场景 |
| :-- | :-- | :-- |
| `RowMapper<T>` | 把结果集一行映射成对象 | `query()` / `queryForObject()` |
| `RowCallbackHandler` | 逐行处理，不返回结果 | 需要流式处理大结果集 |
| `ResultSetExtractor<T>` | 自己遍历整个结果集 | 多行聚合成一个对象 |
| `PreparedStatementSetter` | 为预编译语句绑定参数 | 复杂参数绑定 |

其中 `RowMapper<T>` 用得最多，它只回答一个问题：拿到 `ResultSet` 的第 `rowNum` 行，返回什么对象。

## 3. DataSource 与连接管理

### 3.1 DataSource 从哪来

`JdbcTemplate` 自己不创建连接，它持有一个 `DataSource`，每次执行都向它要连接。在 Spring Boot 里，`DataSource` 由自动配置注册：

```yaml
spring:
  datasource:
    url: jdbc:mysql://localhost:3306/app
    username: root
    password: password
```

classpath 上有连接池实现时，自动配置默认用 **HikariCP** 作为 `DataSource` 实现。`JdbcTemplate` 只依赖 `DataSource` 接口，不关心背后是 HikariCP 还是 Druid——这正是它能被替换、被代理的地基。

### 3.2 连接的获取与归还

JDBC 的 `Connection` 是昂贵资源，JdbcTemplate 从不自己持有它，而是「用完即还」：

```text
queryForObject() 一次调用内部：
    拿连接（从连接池借）
    → 创建 Statement
    → 执行 + 回调
    → finally 归还连接（还给连接池）
```

因为拿、还都发生在同一个方法内、且由 `finally` 保证，调用方既不会漏还，也不会拿到一个半开半闭的连接。这解决了第 1.2 节的第一处成本——资源泄漏。

## 4. 异常转换：从 SQLException 到 DataAccessException

### 4.1 JDBC 异常为什么难处理

JDBC 几乎把所有错误都装进一个 `SQLException`。要区分「SQL 写错」和「违反唯一约束」，得看 `SQLException` 的 `SQLState` 和 `errorCode`——而这两个值每个数据库都不一样：

```text
同样是「SQL 语法错误」：
  MySQL 的 SQLState 是 42000
  其他数据库可能是别的值
```

这意味着直接处理 JDBC 异常，代码必然耦合具体数据库。Spring 要解决的就是：把这种「一个异常装一切、错误码随库而变」的情况，翻译成稳定的异常类型。

### 4.2 异常转换的机制

`JdbcTemplate` 捕获 `SQLException` 后，交给 `SQLExceptionTranslator` 翻译。默认实现 `SQLErrorCodeSQLExceptionTranslator` 根据数据库类型和 `SQLState`/`errorCode`，映射到 `DataAccessException` 层次：

```text
SQLException（SQLState=23000，违反约束）
        │
        ▼
SQLErrorCodeSQLExceptionTranslator
        │
        ▼
DuplicateKeyException（继承自 DataIntegrityViolationException）
```

`DataAccessException` 是运行时异常，有大量子类，各对应一类错误：

| 异常 | 含义 |
| :-- | :-- |
| `BadSqlGrammarException` | SQL 语法错误 |
| `DuplicateKeyException` | 唯一约束冲突 |
| `DataIntegrityViolationException` | 数据完整性被破坏 |
| `CannotAcquireLockException` | 拿不到数据库锁 |
| `QueryTimeoutException` | 查询超时 |

### 4.3 转换带来了什么

两点收益，都直接解决第 1.2 节的成本：

1. **不用再写 `try-catch(SQLException)`**。它是运行时异常，调用方按需处理，不处理也不会被迫吞异常。
2. **可以按语义捕获**。想单独处理「重复主键」，写 `catch (DuplicateKeyException e)` 即可，不必解析每个数据库的 `SQLState`。

## 5. 结果映射与参数绑定

### 5.1 RowMapper 结果映射

`RowMapper` 是「一行 → 一个对象」的转换。字段多的场景，手写 lambda 会啰嗦，可用 `BeanPropertyRowMapper` 按列名自动匹配：

```java
// 手写映射：字段少时直观
RowMapper<User> mapper = (rs, rowNum) ->
    new User(rs.getLong("id"), rs.getString("name"));

// 自动映射：列名与属性名一致时省事
RowMapper<User> beanMapper = new BeanPropertyRowMapper<>(User.class);
```

❌ 坑：`BeanPropertyRowMapper` 依赖列名与属性名**完全一致**。数据库用 `created_at` 而属性叫 `createdAt` 时，字段不会被赋值——这是它最常见的「静默失败」，此时应改用手写 `RowMapper` 或配置下划线转驼峰。

### 5.2 NamedParameterJdbcTemplate 命名参数

`JdbcTemplate` 用 `?` 占位符，参数一多就难对位。`NamedParameterJdbcTemplate` 改用 `:name` 命名参数：

```java
NamedParameterJdbcTemplate named = new NamedParameterJdbcTemplate(jdbcTemplate);

MapSqlParameterSource params = new MapSqlParameterSource()
    .addValue("id", id)
    .addValue("status", "ACTIVE");

User user = named.queryForObject(
    "SELECT id, name FROM users WHERE id = :id AND status = :status",
    params,
    (rs, rowNum) -> new User(rs.getLong("id"), rs.getString("name"))
);
```

命名参数让 SQL 和参数一一对应，参数超过三个时比 `?` 更不易出错。它是 `JdbcTemplate` 的薄封装，底层仍是同一个 `JdbcTemplate` 执行。

## 6. 何时用 JdbcTemplate

它适合的场景很窄，也很明确：

| 场景 | 是否适合 | 原因 |
| :-- | :-- | :-- |
| 简单查询、少量表 | ✅ 适合 | 直接、无 ORM 学习成本 |
| 需要精确控制 SQL | ✅ 适合 | 写什么就执行什么，无框架干预 |
| 复杂对象关系映射 | ❌ 不适合 | 手动写 `RowMapper` 成本随关联数上升 |
| 高频 CRUD 业务开发 | ❌ 不适合 | MyBatis、JPA 的映射与缓存更省力 |

一句话：**JdbcTemplate 是「地基」，不是「日常主力」**。理解它，是为了理解 MyBatis 的 `SqlSessionTemplate` 为什么那样设计、JPA 的 `EntityManager` 帮我们处理了什么。真正的业务开发，通常从 [第二章 MyBatis](./chapter-02-mybatis-integration.md) 或 [第三章 JPA](./chapter-03-jpa.md) 开始，涉及数据一致性时看 [第四章 事务](./chapter-04-transaction.md)。
