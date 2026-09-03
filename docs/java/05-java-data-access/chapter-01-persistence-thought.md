# 持久化思想：Java 对象如何保存

> Java 对象活在内存里，进程一关就灰飞烟灭。可业务数据不能这么脆弱——用户信息、订单记录、交易流水必须比 JVM 的生命周期更长久。本章要回答的核心问题是：**如何跨越内存与持久存储之间的鸿沟，让 Java 对象"活"得更久？** 我们将从内存对象的困境出发，剖析对象模型与关系模型的本质冲突，梳理 Java 持久化技术的三种层次，并勾勒出整个持久化技术演进的脉络。

## 1. 内存对象的困境

每一个 Java 开发者都写过这样的代码：

```java
User user = new User();
user.setName("张三");
user.setEmail("zhangsan@example.com");
user.setCreatedAt(LocalDateTime.now());
```

这几行代码在 JVM 堆内存中创建了一个 `User` 对象。它有地址、有状态、有行为，一切看起来都很完美——直到你按下 Ctrl+C，或者服务器重启。

**对象的宿命：生存在堆上，消亡于进程结束。**

Java 的内存管理模型决定了对象的生命周期与 JVM 进程绑定。GC（垃圾回收器）负责清理不再被引用的对象，但即便对象仍然活跃，进程退出的那一刻，堆上的所有数据都会归零。这不是 bug，而是设计如此——内存是易失性存储（volatile storage），它的速度以纳秒计，但代价是断电即丢。

然而，业务世界要求的恰恰相反：

| 需求维度 | 内存对象的现实 | 业务系统的期望 |
| :-- | :-- | :-- |
| 生命周期 | 跟随 JVM 进程 | 永久保存，跨越数年 |
| 容量 | 受限于堆大小（通常 GB 级） | 海量数据（TB 甚至 PB） |
| 并发访问 | 单进程内共享 | 多进程、多服务器并发读写 |
| 故障恢复 | 进程崩溃即丢失 | 断电、宕机后数据不丢 |
| 查询能力 | 只能遍历引用链 | 按任意条件灵活查询 |

一个电商平台每天产生数十万笔订单，一家银行每秒处理上千笔交易。这些数据不能因为一次 JVM 重启就消失。**持久化不是可选项，而是所有企业级应用的刚需。**

```txt
┌─────────────────────────────────────────────┐
│                   JVM 进程                    │
│  ┌─────────────────────────────────────┐    │
│  │              Heap                    │    │
│  │   User(张三)  Order(#1001)  ...      │    │
│  │   ↓ GC 管理    ↓ 进程退出即消失       │    │
│  └─────────────────────────────────────┘    │
│                     │                        │
│              需要跨越这条线                    │
│                     ↓                        │
├─────────────────────────────────────────────┤
│              持久化存储层                      │
│   Database / File / NoSQL  ← 数据在这里活下来  │
└─────────────────────────────────────────────┘
```

所以，持久化的本质问题就是：**如何把易失的内存状态，可靠地转化为持久的存储状态，并在需要时完整地还原回来？**

## 2. 两种模型的碰撞

解决持久化问题，最自然的选择是关系型数据库。Oracle、MySQL、PostgreSQL 已经在企业环境中服役了几十年，它们成熟、可靠、功能强大。但当你把 Java 对象往关系数据库里塞的时候，一个根本性的矛盾浮出水面——**对象模型与关系模型是两套完全不同的世界观。**

### 2.1 对象模型 vs 关系模型

让我们用一个具体的例子来感受这种冲突。假设你在设计一个电商系统的领域模型：

```java
public class Order {
    private Long id;
    private User buyer;              // 对象引用
    private List<OrderItem> items;   // 集合关联
    private OrderStatus status;      // 枚举（可继承体系）
}

public class PremiumOrder extends Order {
    private BigDecimal discountRate; // 继承
}
```

这段代码在 Java 里非常自然：对象通过引用关联，继承实现多态，集合表达一对多关系。但关系数据库不认这些。数据库的世界由表、行、列、外键构成，没有引用、没有继承、没有嵌套集合。

以下是两种模型在关键维度上的对比：

| 维度 | Java 对象模型 | 关系数据库模型 |
| :-- | :-- | :-- |
| **存储单元** | Object（对象实例） | Row（行/元组） |
| **关联方式** | 对象引用（`user.getOrder()`） | 外键（`user_id` 列） |
| **集合表达** | `List<OrderItem>` 内嵌于对象 | 独立的 `order_item` 表 + 外键 |
| **类型体系** | 支持继承、多态、接口 | 无继承，扁平的表结构 |
| **标识** | 对象引用（内存地址）或 `equals()` | 主键（Primary Key） |
| **生命周期** | GC 自动管理 | 显式 INSERT/UPDATE/DELETE |
| **查询方式** | 沿对象图导航（`order.getBuyer().getName()`） | SQL 声明式查询（JOIN） |
| **事务边界** | 无原生概念 | 显式 BEGIN/COMMIT/ROLLBACK |

### 2.2 对象-关系阻抗失配

这种根本性的差异，Martin Fowler 在《Patterns of Enterprise Application Architecture》中将其命名为**对象-关系阻抗失配（Object-Relational Impedance Mismatch）**。"阻抗失配"这个术语借自电子工程——当两个电路的阻抗不匹配时，信号会反射、失真、能量损耗。对象与关系之间的映射同样如此。

这种失配体现在以下具体问题上：

**粒度问题（Granularity）**：一个 Java 类可能对应多张表，或者多个类共享一张表。例如 `User` 类包含一个 `Address` 嵌套对象，是拆成两张表还是一张？

**标识问题（Identity）**：Java 用 `==` 比较引用，用 `equals()` 比较逻辑相等。数据库用主键判断"是否同一行"。两者不总是一致的——两个不同的 Java 对象可能对应同一行数据。

**关联问题（Associations）**：Java 中 `Order` 持有 `User` 的引用，导航一步即达。数据库中需要通过 `user_id` 外键做 JOIN 查询。方向性也有差异——Java 引用是单向的，数据库关系可以双向查询。

**继承问题（Inheritance）**：Java 有丰富的继承体系，但关系数据库压根没有继承的概念。`PremiumOrder extends Order` 在数据库里怎么存？一张表？两张表？还是每张子类一张表？

**导航问题（Navigation）**：在 Java 中遍历对象图是 `order.getBuyer().getAddress().getCity()`，自然流畅。在 SQL 中要写 `SELECT ... FROM orders o JOIN users u ON o.buyer_id = u.id JOIN addresses a ON u.address_id = a.id`，繁琐且与对象图的结构截然不同。

![orm-mapping](/java/orm-mapping.svg)

**这就是持久化技术存在的根本原因**——我们需要某种机制，在对象世界和关系世界之间架起桥梁，让开发者尽可能少地感知这种失配。

## 3. 持久化的三种层次

面对对象-关系阻抗失配，Java 社区发展出了多种解决方案。按照抽象层次从低到高，可以分为三个层次。

### 3.1 文件存储：序列化到文件

最朴素的方式——直接把 Java 对象"拍扁"存到文件里。Java 内置了 `ObjectOutputStream` 和 `ObjectInputStream` 来支持对象序列化：

```java
// 序列化：对象 → 文件
try (ObjectOutputStream oos = new ObjectOutputStream(
        new FileOutputStream("user.dat"))) {
    User user = new User("张三", "zhangsan@example.com");
    oos.writeObject(user);
}

// 反序列化：文件 → 对象
try (ObjectInputStream ois = new ObjectInputStream(
        new FileInputStream("user.dat"))) {
    User user = (User) ois.readObject();
    System.out.println(user.getName()); // 张三
}
```

这种方式看起来简单直接，但问题一大堆：

- **无法查询**：想找所有北京的用户？你得把整个文件读出来，逐个反序列化，然后在内存里过滤。
- **格式不透明**：序列化后的二进制数据人类不可读，调试困难。
- **版本兼容性差**：`User` 类加了一个字段，旧的序列化文件可能无法反序列化。
- **无并发控制**：多线程同时读写同一个文件，数据必乱。
- **性能瓶颈**：每次查询都要全量反序列化，数据量大了根本扛不住。

除了 JDK 原生序列化，还有 JSON、XML、Protocol Buffers 等格式可以做类似的文件持久化。它们各有优势（JSON 可读、Protobuf 高效），但本质上都是"把对象变成字节流存起来"，无法解决结构化查询和并发访问的问题。

**适用场景**：配置文件、缓存序列化、跨进程数据传输。不适合业务数据持久化。

### 3.2 直接 SQL：JDBC 手动映射

关系型数据库是企业级应用的主流选择，而 JDBC（Java Database Connectivity）是 Java 访问数据库的标准 API。通过 JDBC，你可以直接编写 SQL，手动将查询结果映射为 Java 对象：

```java
// 插入
String sql = "INSERT INTO users (name, email, created_at) VALUES (?, ?, ?)";
try (PreparedStatement ps = connection.prepareStatement(sql)) {
    ps.setString(1, user.getName());
    ps.setString(2, user.getEmail());
    ps.setTimestamp(3, Timestamp.valueOf(user.getCreatedAt()));
    ps.executeUpdate();
}

// 查询
String sql = "SELECT id, name, email, created_at FROM users WHERE id = ?";
try (PreparedStatement ps = connection.prepareStatement(sql)) {
    ps.setLong(1, userId);
    try (ResultSet rs = ps.executeQuery()) {
        if (rs.next()) {
            User user = new User();
            user.setId(rs.getLong("id"));
            user.setName(rs.getString("name"));
            user.setEmail(rs.getString("email"));
            user.setCreatedAt(rs.getTimestamp("created_at").toLocalDateTime());
        }
    }
}
```

JDBC 给了你完全的 SQL 控制权，性能可以调到极致。但代价是大量的样板代码（boilerplate）——每一行 SQL 都要手动绑定参数，每一个结果集都要手动映射字段。一个复杂查询的映射代码可能比业务逻辑还长。

更麻烦的是，JDBC 不处理对象关联。`Order` 关联了 `User` 和 `List<OrderItem>`，你得自己写多条 SQL，自己组装对象图。事务管理也需要手动 `connection.commit()` 和 `connection.rollback()`。

**适用场景**：对 SQL 有极致控制需求的场景、性能敏感的批量操作、遗留系统维护。

### 3.3 ORM：框架自动映射

ORM（Object-Relational Mapping，对象-关系映射）框架的出现，就是为了解决 JDBC 手动映射的痛点。框架在对象和数据库表之间建立映射关系，自动生成 SQL，自动完成结果集到对象的转换。

以 JPA（Java Persistence API）为例：

```java
@Entity
@Table(name = "users")
public class User {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    private String name;
    private String email;

    @OneToMany(mappedBy = "buyer")
    private List<Order> orders;
}

// 使用时
User user = entityManager.find(User.class, 1L);
System.out.println(user.getOrders().size()); // 自动加载关联的订单
```

ORM 框架帮你处理了最繁琐的部分：SQL 生成、参数绑定、结果映射、关联加载、事务管理。你只需要定义好映射关系，剩下的交给框架。

但 ORM 也不是银弹。它有自己的问题：

- **SQL 黑箱**：框架生成的 SQL 可能不是你期望的，N+1 查询问题就是典型。
- **学习曲线**：映射注解、生命周期回调、缓存策略、抓取策略……概念不少。
- **复杂查询受限**：当 SQL 变得复杂（多表嵌套子查询、窗口函数），ORM 的表达能力捉襟见肘。
- **性能陷阱**：懒加载在循环中可能触发大量额外查询，开发者如果不了解底层机制，很容易踩坑。

### 3.4 三种层次对比

| 维度 | 文件序列化 | JDBC 直接 SQL | ORM 框架 |
| :-- | :-- | :-- | :-- |
| **抽象层次** | 最低 | 中等 | 最高 |
| **SQL 控制** | 无（不用 SQL） | 完全控制 | 部分/自动生成 |
| **开发效率** | 低 | 低 | 高 |
| **查询能力** | 无结构化查询 | 完整 SQL | 受限（可扩展原生 SQL） |
| **并发支持** | 无 | 需手动管理 | 框架管理事务/锁 |
| **学习成本** | 低 | 中（需熟悉 JDBC API + SQL） | 中高（需掌握框架概念） |
| **性能调优空间** | 小 | 大 | 中（需理解框架行为） |
| **适用场景** | 配置/缓存/传输 | 性能敏感/复杂查询 | 业务系统主流方案 |

现实中的项目往往不是三选一，而是混合使用：ORM 处理常规 CRUD，JDBC 处理复杂查询和批量操作，序列化处理缓存和消息传输。

## 4. Java 持久化技术演进

Java 持久化技术的发展不是一蹴而就的，而是伴随着开发者痛点的不断升级，逐步演化而来。让我们沿着时间线，看看每一步解决了什么问题，又引入了什么新的挑战。

### 4.1 演进时间线

```txt
1997          2001           2006        2010          2014           2017+
  │             │              │            │             │              │
  ▼             ▼              ▼            ▼             ▼              ▼
JDBC 1.0   EJB 2.x CMP   Hibernate 2  JPA 1.0    Spring Data    响应式/云原生
  │         (重量级ORM)       │         (标准化)      JPA            持久化
  │             │              │            │             │              │
  │         痛点：太重、       业界实际      EJB3 吸取       约定优于        R2DBC/
  │         部署复杂          采用的ORM     Hibernate       配置，         Spring Data
  │                          方案          思想             零样板代码      Reactive
  ▼             ▼              ▼            ▼             ▼              ▼
"手动拼SQL" "框架帮你做，      "轻量级       "标准化ORM     "进一步简化      "异步非阻塞
 太累了"     但太复杂了"       ORM崛起"     接口"          数据访问"        数据访问"
```

### 4.2 各阶段详解

**JDBC 1.0（1997）—— 基础设施**

Sun 公司在 JDK 1.1 中引入了 JDBC API，定义了 Java 访问关系数据库的标准接口。从此，Java 程序员有了统一的方式来连接数据库、执行 SQL、处理结果集。JDBC 是一切的基础，后续所有持久化框架底层都依赖它。

```java
// 早期 JDBC 的典型写法
Connection conn = DriverManager.getConnection(url, user, password);
Statement stmt = conn.createStatement();
ResultSet rs = stmt.executeQuery("SELECT * FROM users");
while (rs.next()) {
    String name = rs.getString("name");
    // 手动映射，手动处理异常，手动关闭资源……
}
rs.close();
stmt.close();
conn.close();
```

JDBC 的问题在于太"原始"——大量样板代码、资源管理容易出错、手动映射繁琐。它提供了基础设施，但没有提供便利性。

**EJB 2.x CMP（2001）—— 过度设计的教训**

为了提升持久化的抽象层次，Java EE（当时还叫 J2EE）引入了 EJB 2.x 的 Container-Managed Persistence（CMP）。它的设想很好：开发者定义 EJB 组件，容器自动处理持久化。

但 EJB 2.x CMP 重量到令人窒息——需要部署描述符（XML 大量配置）、Home 接口/Remote 接口、容器依赖、复杂的生命周期回调。一个简单的 CRUD 操作，代码量比直接写 JDBC 还多。Rod Johnson 在《Expert One-on-One J2EE Design and Development》中直言 EJB 2.x 的设计是失败的，这也催生了 Spring 框架的诞生。

**Hibernate（2001-2006）—— 开源 ORM 的崛起**

Gavin King 在 2001 年开始开发 Hibernate，2003 年发布 2.0 版本。Hibernate 的核心理念是：**让开发者操作 Java 对象，框架负责生成 SQL**。

```java
// Hibernate 的使用体验
Session session = sessionFactory.openSession();
User user = (User) session.get(User.class, 1L); // 按主键加载
user.setName("李四");
session.update(user); // 框架自动生成 UPDATE SQL
session.close();
```

Hibernate 用 XML 映射文件（后来改为注解）描述对象-表的映射关系，自动处理关联加载、延迟初始化、脏检查、级联操作。它迅速成为 Java 社区事实上的 ORM 标准。

**JPA 1.0（2006）—— 标准化**

Hibernate 的成功促使 Java 社区将其思想标准化。Java EE 5 引入了 JPA（Java Persistence API），以 Hibernate 为蓝本定义了 ORM 的标准接口。JPA 不是具体实现，而是一套规范——Hibernate、EclipseLink、OpenJPA 等都是它的实现。

JPA 的出现让开发者有了不绑定特定框架的持久化代码，降低了迁移成本。

**Spring Data JPA（2010+）—— 进一步简化**

Spring Data 项目将"约定优于配置"的理念带入数据访问层。你只需要定义接口，框架自动生成实现：

```java
// 只需定义接口，无需写实现类
public interface UserRepository extends JpaRepository<User, Long> {
    List<User> findByCity(String city);        // 按方法名自动生成 SQL
    List<User> findByNameContaining(String name);
    @Query("SELECT u FROM User u WHERE u.email LIKE %:domain%")
    List<User> findByEmailDomain(@Param("domain") String domain);
}
```

Spring Data JPA 消除了 DAO 层的样板代码——不需要手动写 `EntityManager.find()`、不需要手写 `findByXxx` 的实现、不需要手动管理事务（配合 `@Transactional` 注解）。开发者把精力集中在业务逻辑上。

**MyBatis（2004-至今）—— 另一条路线**

在 Hibernate/JPA 走"全自动 ORM"路线的同时，MyBatis（前身是 iBATIS）走了一条不同的路——**半自动映射**。开发者手写 SQL，MyBatis 负责参数绑定和结果映射：

```xml
<!-- MyBatis Mapper XML -->
<select id="findUserById" resultType="User">
    SELECT id, name, email, created_at
    FROM users
    WHERE id = #{id}
</select>
```

MyBatis 在中国 Java 社区有着极高的市场占有率。它的优势在于 SQL 完全可控——对于复杂查询、性能调优、遗留数据库适配，这种"SQL 优先"的哲学更实用。它不要求你理解 ORM 的复杂概念，只需要会写 SQL。

### 4.3 两条路线的哲学之争

| 维度 | Hibernate/JPA（全自动 ORM） | MyBatis（半自动 SQL 映射） |
| :-- | :-- | :-- |
| 核心理念 | 对象优先，SQL 由框架生成 | SQL 优先，对象由框架映射 |
| SQL 控制 | 较弱（HQL/JPQL 间接控制） | 完全手写 |
| 学习曲线 | 陡峭（映射、缓存、抓取策略） | 平缓（SQL + XML/注解） |
| 开发效率 | 高（常规 CRUD 零 SQL） | 中（每个查询都写 SQL） |
| 复杂查询 | 难以表达（需 fallback 到原生 SQL） | 自然表达 |
| 数据库迁移 | 好（SQL 方言自动适配） | 需手动调整 SQL |
| 中国市场 | 份额较小 | 主流选择 |

这两条路线没有绝对的优劣。欧洲和北美市场 Hibernate/JPA 占主导，中国市场 MyBatis 更流行。本卷会同时覆盖两条路线，帮你理解各自的适用场景。

## 5. 本卷的路线图

本章建立了持久化的宏观认知，后续各章将沿着一条清晰的路径深入：

```txt
┌─────────────────────────────────────────────────────────────────┐
│                     本卷知识路线图                                │
├─────────┬───────────────────────────────────────────────────────┤
│ 第1章   │ 持久化思想 ← 你在这里                                  │
├─────────┼───────────────────────────────────────────────────────┤
│ 第2章   │ JDBC 深入 —— 连接管理、Statement、ResultSet、事务基础    │
├─────────┼───────────────────────────────────────────────────────┤
│ 第3章   │ MyBatis 实战 —— 映射、动态 SQL、缓存、插件机制           │
├─────────┼───────────────────────────────────────────────────────┤
│ 第4章   │ ORM 深入 —— JPA/Hibernate 映射策略、生命周期、N+1 问题   │
├─────────┼───────────────────────────────────────────────────────┤
│ 第5章   │ 性能优化 —— 连接池、批量操作、链路排查、最佳实践          │
└─────────┴───────────────────────────────────────────────────────┘
```

**阅读建议**：

- 如果你是 **JDBC 新手**，从第 2 章开始，打牢基础。
- 如果你已经在用 **MyBatis**，第 3 章会帮你从"会用"进阶到"理解原理"。
- 如果你需要在项目中做 **技术选型**（MyBatis vs JPA），读完第 3、4 章后你会有清晰的判断。
- 如果你关注 **系统性能**，第 5 章是重点——连接池与批处理是数据访问层最容易产生价值的优化手段。
- 如果你关注 **事务**，声明式事务、传播行为与隔离级别已移入 [Spring 专题](../../spring/04-data-access/chapter-04-transaction.md)。

每一章都尽量做到"知其然，知其所以然"——不仅告诉你怎么用，更告诉你为什么这样设计，以及在什么场景下该怎么做选择。

> 持久化的本质问题已经清楚了——对象活在内存，数据要活在磁盘。但具体怎么做？Java 提供了一套标准接口叫 JDBC，它让同一套代码能操作所有关系数据库。下一章从 JDBC 的核心接口开始，拆解它为什么存在、怎么做、以及为什么所有 ORM 框架最终都站在它肩膀上。
