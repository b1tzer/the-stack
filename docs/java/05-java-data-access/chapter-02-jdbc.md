# JDBC：Java 数据访问的底层抽象

> 上一章我们理解了持久化的必要性——Java 对象必须跨越 JVM 生命周期存入数据库。但"存进去"和"取出来"具体怎么做？每种数据库（MySQL、Oracle、PostgreSQL）都有自己的通信协议和 C API，难道每换一种数据库就要重写一遍数据访问代码？本章要回答的核心问题是：**JDBC 如何用一套统一的 Java 接口，屏蔽底层数据库的差异，让开发者用同一套代码操作所有关系数据库？** 我们将从 JDBC 存在的历史原因出发，拆解它的核心接口与编程模型，分析它的性能瓶颈，并揭示它作为所有 ORM 框架底层基础的真正地位。

## 1. JDBC 为什么存在

### 1.1 没有 JDBC 的年代

想象一下 1990 年代中期的 Java 开发场景。你要连接 MySQL，需要用 MySQL 提供的 C 语言客户端库（`libmysqlclient`），通过 JNI 调用本地方法。你要换成 Oracle，又得换成 Oracle 的 OCI（Oracle Call Interface）库。每种数据库的 API 完全不同：函数名不同、参数不同、错误码不同、资源释放方式不同。

```java
// 假设的"无 JDBC"时代——连接 MySQL
native void mysql_connect(String host, int port, String user, String pwd);
native ResultSet mysql_query(String sql);
native void mysql_close();

// 连接 Oracle——完全不同的 API
native void oci_logon(String tnsName, String user, String pwd);
native void oci_execute(String sql);
native void oci_logoff();
```

这意味着，厂商专有 API 会让数据访问层难以跨数据库复用。迁移到另一数据库通常要同步调整驱动、SQL、类型映射和事务语义。

### 1.2 JDBC 的价值：统一抽象

1997 年，Sun 公司在 JDK 1.1 中引入了 JDBC（Java Database Connectivity）规范。它的核心设计思想非常简单：

**定义一套标准接口，让各数据库厂商提供自己的实现（驱动）。**

```java
// 无论底层是 MySQL、Oracle 还是 PostgreSQL，代码写法完全一样
Connection conn = DriverManager.getConnection(url, user, password);
PreparedStatement ps = conn.prepareStatement("SELECT * FROM users WHERE id = ?");
ps.setLong(1, 1001L);
ResultSet rs = ps.executeQuery();
```

这就是典型的**面向接口编程**：应用代码主要依赖 JDBC 标准接口（`java.sql.*`），具体实现由各厂商的 JDBC 驱动（Driver）提供。切换数据库通常要更换驱动和连接 URL，但还可能涉及 SQL 方言、类型映射、事务隔离、批量语义与错误码差异，不能假定业务代码完全不变。

| 维度 | 没有 JDBC | 有了 JDBC |
| :-- | :-- | :-- |
| API 统一性 | 每个数据库一套 API | 一套 `java.sql.*` 接口 |
| 换数据库成本 | 重写数据访问层 | 更换驱动和 URL，并验证 SQL 与行为差异 |
| 代码可移植性 | 几乎为零 | 高（SQL 方言除外） |
| 驱动管理 | 厂商各自为政 | 标准化 Driver 接口 |

### 1.3 JDBC 是 ORM 的地基

在后续章节中我们会学习 MyBatis、Hibernate/JPA 等 ORM 框架。但请记住一个关键事实：**所有 Java ORM 框架，无论上层多么花哨，底层都是通过 JDBC 与数据库通信的。**

![jdbc-architecture](/java/jdbc-architecture.svg)

理解 JDBC，就是理解 Java 数据访问的"基岩层"。它不是最优雅的 API，但它是所有上层建筑的地基。

## 2. 核心接口

JDBC 的 API 设计围绕四个核心接口展开，每个接口有明确的职责边界和生命周期。理解它们，就理解了 JDBC 的骨架。

### 2.1 DataSource——连接的工厂

`DataSource` 是获取数据库连接的标准入口。它描述如何创建或借出 `Connection`，但池化、异步初始化、监控和 XA 等能力取决于具体实现。

```java
// 方式一：DriverManager（早期方式，硬编码连接信息）
Connection conn = DriverManager.getConnection(
    "jdbc:mysql://localhost:3306/mydb", "root", "password"
);

// 方式二：DataSource（推荐方式，配置与代码分离）
DataSource ds = new MysqlDataSource();
ds.setUrl("jdbc:mysql://localhost:3306/mydb");
ds.setUser("root");
ds.setPassword("password");
Connection conn = ds.getConnection();
```

为什么推荐 `DataSource`？因为它支持连接池、支持 JNDI 查找、支持分布式事务。在实际生产环境中，你几乎不会直接 `new MysqlDataSource()`，而是使用连接池框架（如 HikariCP）提供的 `DataSource` 实现。这一点我们在 2.6 节详细展开。

### 2.2 Connection——一次数据库会话

`Connection` 代表与数据库的一个**物理连接**（底层是一个 TCP Socket）。它是一个有状态的对象：维护事务状态、设置隔离级别、缓存 PreparedStatement。

```java
Connection conn = dataSource.getConnection();
try {
    conn.setAutoCommit(false);          // 开启手动事务
    // ... 执行多条 SQL ...
    conn.commit();                       // 提交事务
} catch (SQLException e) {
    conn.rollback();                     // 回滚事务
    throw e;
} finally {
    conn.close();                        // 归还连接（如果是连接池，close = 归还）
}
```

**关键认知：Connection 通常是昂贵资源。** 创建连接可能包含 TCP 握手、TLS 和数据库认证，耗时受网络与数据库配置影响。长生命周期服务通常使用连接池（第 6 节详述）来复用连接并控制连接数。

### 2.3 PreparedStatement——SQL 的执行者

`PreparedStatement` 是可接受参数绑定、多次执行的 SQL 语句对象。JDBC API 将其描述为预编译语句；驱动是否在服务端真正预编译、何时编译，以及是否缓存执行计划由驱动与数据库实现决定。

```java
// 创建 PreparedStatement（此时 SQL 发送到数据库进行预编译）
PreparedStatement ps = conn.prepareStatement(
    "SELECT id, name, email FROM users WHERE age > ? AND city = ?"
);

// 绑定参数（? 占位符从 1 开始编号）
ps.setInt(1, 18);
ps.setString(2, "北京");

// 执行查询
ResultSet rs = ps.executeQuery();
```

使用 `PreparedStatement` 的主要原因是参数化查询能降低拼接 SQL 带来的注入风险。重复执行时是否减少解析或优化开销，则要结合驱动和数据库验证。

### 2.4 ResultSet——查询结果的游标

`ResultSet` 是查询结果的**迭代器**。它维护一个游标，初始指向第一行之前，每次调用 `next()` 移动到下一行。

```java
ResultSet rs = ps.executeQuery();
while (rs.next()) {
    Long id = rs.getLong("id");
    String name = rs.getString("name");
    String email = rs.getString("email");
    // 把每一行数据映射为 Java 对象
    User user = new User(id, name, email);
    users.add(user);
}
```

`ResultSet` 默认是**只读、只向前**的游标（`TYPE_FORWARD_ONLY`），这意味着你不能往回翻。这个设计是有意为之——只向前的游标性能最好，内存占用最小，适合绝大多数场景。

### 2.5 接口对比总览

| 接口 | 类比 | 职责 | 生命周期 | 实现方 |
| :-- | :-- | :-- | :-- | :-- |
| `DataSource` | 工厂 | 创建连接 | 应用级（通常单例） | 数据库厂商 / 连接池框架 |
| `Connection` | 一次会话 | 维护事务，创建 Statement | 一次业务操作 | JDBC 驱动 |
| `PreparedStatement` | 一条命令 | 绑定参数，执行 SQL | 一次查询/更新 | JDBC 驱动 |
| `ResultSet` | 一份报告 | 迭代查询结果 | 一次查询结果 | JDBC 驱动 |

生命周期关系如下：

```txt
DataSource（应用级，长期存活）
  └─ 创建 → Connection（一次会话，用完关闭/归还）
       └─ 创建 → PreparedStatement（一次 SQL 执行）
            └─ 产生 → ResultSet（一次查询结果，遍历完关闭）
```

**每一个层级都是上一层的产物：** DataSource 生产 Connection，Connection 生产 PreparedStatement，PreparedStatement 生产 ResultSet。理解这个创建链，就理解了 JDBC 的对象模型。

## 3. JDBC 编程模板

让我们写一个完整的 JDBC 代码，从头到尾走一遍：查询指定年龄以上的用户列表。

### 3.1 完整示例

```java
public List<User> findUsersByAge(int minAge) throws SQLException {
    List<User> users = new ArrayList<>();
    
    // 1. 获取连接
    Connection conn = null;
    PreparedStatement ps = null;
    ResultSet rs = null;
    
    try {
        conn = dataSource.getConnection();
        
        // 2. 创建 PreparedStatement
        ps = conn.prepareStatement(
            "SELECT id, name, email, age FROM users WHERE age > ?"
        );
        ps.setInt(1, minAge);
        
        // 3. 执行查询
        rs = ps.executeQuery();
        
        // 4. 遍历结果集，映射为 Java 对象
        while (rs.next()) {
            User user = new User();
            user.setId(rs.getLong("id"));
            user.setName(rs.getString("name"));
            user.setEmail(rs.getString("email"));
            user.setAge(rs.getInt("age"));
            users.add(user);
        }
        
    } finally {
        // 5. 关闭资源（注意关闭顺序：ResultSet → PreparedStatement → Connection）
        if (rs != null) try { rs.close(); } catch (SQLException ignored) {}
        if (ps != null) try { ps.close(); } catch (SQLException ignored) {}
        if (conn != null) try { conn.close(); } catch (SQLException ignored) {}
    }
    
    return users;
}
```

### 3.2 模板代码的痛苦

仔细审视这段代码，你会发现**真正的业务逻辑只有 5 行**（SQL 和结果映射），剩下的全是样板代码：

| 代码部分 | 行数 | 是否业务逻辑 |
| :-- | :-- | :-- |
| 获取连接 | 2 行 | ❌ 基础设施 |
| 创建 Statement + 绑定参数 | 4 行 | 部分（SQL 是，绑定是样板） |
| 执行查询 | 1 行 | ❌ 基础设施 |
| 遍历 ResultSet → 映射对象 | 8 行 | ❌ 纯样板（手动 getter → setter） |
| 关闭资源（try-catch-finally） | 4 行 | ❌ 基础设施 |
| **合计** | **~25 行** | **仅 1 行 SQL 是业务逻辑** |

这就是 JDBC 的核心痛点：**样板代码太多，业务逻辑被淹没在基础设施代码中。** 写一个查询尚且如此，一个真实业务方法可能涉及多次查询、更新、事务控制，代码量会爆炸式增长。

```java
// Java 7 引入 try-with-resources 后，资源关闭稍微优雅了一些
try (Connection conn = dataSource.getConnection();
     PreparedStatement ps = conn.prepareStatement(sql)) {
    ps.setInt(1, minAge);
    try (ResultSet rs = ps.executeQuery()) {
        while (rs.next()) {
            // 映射逻辑
        }
    }
}
```

try-with-resources 解决了资源关闭的样板问题，但**ResultSet 到 Java 对象的映射**仍然是手动的、重复的、易错的。这正是 ORM 框架要解决的核心问题——第 3、4 章的主题。

## 4. PreparedStatement 与 SQL 注入

`PreparedStatement` 不仅仅是一个"写法更优雅"的替代品。它解决了一个**安全问题**和一个**性能问题**。

### 4.1 SQL 注入：拼接字符串的代价

假设你要根据用户名查询用户信息，用字符串拼接的方式：

```java
// 危险代码！
String name = request.getParameter("name");  // 用户输入
String sql = "SELECT * FROM users WHERE name = '" + name + "'";
Statement stmt = conn.createStatement();
ResultSet rs = stmt.executeQuery(sql);
```

正常情况下，用户输入 `张三`，生成的 SQL 是：

```sql
SELECT * FROM users WHERE name = '张三'
```

没问题。但如果攻击者输入的是：

```txt
' OR '1'='1' --
```

生成的 SQL 变成：

```sql
SELECT * FROM users WHERE name = '' OR '1'='1' --'
```

`WHERE` 条件永远为真，`--` 注释掉了后面的代码。**攻击者绕过了身份验证，拿到了整张用户表的数据。** 这就是 SQL 注入——OWASP Top 10 安全漏洞之一，至今仍在真实世界中频繁被利用。

更危险的注入：

```txt
'; DROP TABLE users; --
```

这会直接**删除你的用户表**。

### 4.2 PreparedStatement 的参数化查询

`PreparedStatement` 通过参数占位符 `?` 把参数值作为绑定值传递，不参与 SQL 文本拼接：

```java
// 安全代码
String name = request.getParameter("name");
PreparedStatement ps = conn.prepareStatement(
    "SELECT * FROM users WHERE name = ?"
);
ps.setString(1, name);  // 参数作为纯数据传递，不会被解析为 SQL
ResultSet rs = ps.executeQuery();
```

`?` 处的绑定值会被当作数据参数，而不会改变 SQL 文本结构。即使输入 `' OR '1'='1' --`，它也只是参与条件比较的字符串。参数化查询降低注入风险，但仍应避免把值直接拼接到 SQL 中。

```txt
┌──────────────────────────────────────────────────────┐
│              字符串拼接（危险）                          │
│                                                      │
│  SQL 语法 + 用户输入 → 混合成一条完整 SQL → 发给数据库    │
│  ↑ 数据和代码没有边界，注入就发生在这里                    │
└──────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────┐
│           PreparedStatement（安全）                     │
│                                                      │
│  SQL 模板（带 ?）→ 先发送给数据库预编译                   │
│  参数值 → 独立发送，只作为绑定值                          │
│  ↑ 数据和代码完全分离，注入无从发生                       │
└──────────────────────────────────────────────────────┘
```

### 4.3 预编译协议与性能边界

除安全性外，`PreparedStatement` 在重复执行相同结构的语句时可能减少 SQL 解析或执行计划生成开销，但收益取决于驱动和数据库。下图以 MySQL 协议为例：

```txt
JDBC 驱动                              数据库服务器
  │                                       │
  │── 1. COM_STMT_PREPARE ──────────────→ │  发送带 ? 的 SQL 模板
  │     "SELECT * FROM users WHERE id = ?"│
  │                                       │  → 解析语法
  │                                       │  → 生成执行计划
  │                                       │  → 缓存，返回 statement_id = 7
  │←─ 2. statement_id = 7  ────────────── │
  │                                       │
  │── 3. COM_STMT_EXECUTE ──────────────→ │  后续执行只需传 id + 参数
  │     statement_id=7, params=[1001]     │  → 直接拿缓存的执行计划运行
  │←─ 4. 结果集 ─────────────────────────  │
  │                                       │
  │── 5. COM_STMT_EXECUTE ──────────────→ │  换个参数再执行
  │     statement_id=7, params=[1002]     │  → 跳过解析和优化
  │←─ 6. 结果集 ────────────────────────── │
```

第一次执行时，SQL 模板（带 `?`）通过 `COM_STMT_PREPARE` 命令发给数据库，数据库完成三件事：

1. **解析 SQL**：检查语法、验证表和列的存在
2. **优化执行计划**：选择最优的索引和查询策略
3. **缓存执行计划**：返回一个 `statement_id`，后续通过这个 ID 引用

后续用不同参数执行同一条 SQL 时，驱动只发 `COM_STMT_EXECUTE`（statement_id + 参数值），数据库跳过解析和优化，直接使用缓存的执行计划。对于高频查询（如根据 ID 查用户），这个优化非常显著。

需要注意的是，JDBC 驱动可以有两种方式实现 `PreparedStatement`：

| 方式 | 工作机制 | 优点 | 缺点 |
| :-- | :-- | :-- | :-- |
| 服务端预编译 | 将带 `?` 的 SQL 发给数据库预编译，得到 statement_id，后续靠 id 执行 | 执行计划可跨请求复用，性能最优 | 多一次网络往返（PREPARE + EXECUTE） |
| 客户端模拟 | 驱动本地把参数值拼成完整 SQL，用普通 `Statement` 协议发给数据库 | 无额外 PREPARE 往返 | 每次都需要数据库重新解析和优化 |

MySQL Connector/J 默认使用客户端模拟模式——`useServerPrepStmts` 默认为 `false`。这是出于兼容性考虑：某些早期 MySQL 版本的服务端预编译有 bug，而且一次 PREPARE + 一次 EXECUTE 对单次执行的查询反而是负优化。只有明确设置 `useServerPrepStmts=true&cachePrepStmts=true` 时才启用服务端预编译，此时才能获得执行计划缓存的收益。

```java
// 同一条 SQL 模板，执行 1000 次，只解析和优化一次
PreparedStatement ps = conn.prepareStatement(
    "SELECT * FROM users WHERE id = ?"
);
for (long id : userIds) {
    ps.setLong(1, id);
    ResultSet rs = ps.executeQuery();
    // 处理结果...
    rs.close();
}
```

**一句话总结：PreparedStatement 的两个价值——安全靠参数化，性能靠预编译。** 在现代 Java 开发中，没有任何理由使用裸的 `Statement`。


前面的内容覆盖 JDBC 的接口、参数化查询和结果处理。接下来从请求延迟和资源占用出发，分析连接创建、逐条执行与连接池参数之间的取舍。

> **下一页：** [JDBC 性能瓶颈与连接池](./chapter-02-jdbc-performance-pool.md)
