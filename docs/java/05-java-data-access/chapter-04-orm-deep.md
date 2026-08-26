# ORM 深入：对象与关系如何转换

> 你写了个 `save(user)`，控制台却打了 3 条 SQL：INSERT、UPDATE 外键、再 INSERT 关联表。你以为 ORM 就是自动映射，但它在幕后做的远比你想的多——脏检查、延迟加载、缓存策略、N+1 问题。本章拆解 ORM 框架在"自动"与"可控"之间到底做了什么取舍。

## 1. MyBatis vs Hibernate/JPA

在 Java 生态中，ORM 的两大主流阵营是 **MyBatis** 和 **Hibernate/JPA**。它们解决同一个问题，但哲学截然不同。

### 1.1 两种哲学

**MyBatis 的信条：SQL 是王道。**

MyBatis 本质上是一个 SQL 映射框架。你手写 SQL，MyBatis 负责把查询结果映射成 Java 对象。它不做任何"智能"的事情——不会自动生成 SQL，不会偷偷帮你发额外的查询。

```xml
<!-- MyBatis Mapper XML -->
<select id="findUserWithOrders" resultMap="userWithOrdersMap">
    SELECT u.id, u.name, o.id as order_id, o.amount
    FROM users u
    LEFT JOIN orders o ON u.id = o.user_id
    WHERE u.id = #{userId}
</select>
```

**Hibernate/JPA 的信条：对象是王道。**

Hibernate 让你操作 Java 对象，框架负责生成 SQL。你调用 `entityManager.persist(user)`，Hibernate 自动翻译成 `INSERT INTO users ...`。

```java
// Hibernate/JPA
@Entity
public class User {
    @Id
    @GeneratedValue
    private Long id;
    private String name;

    @OneToMany(mappedBy = "user", fetch = FetchType.LAZY)
    private List<Order> orders;
}

// 保存时不用写 SQL
entityManager.persist(user);
```

### 1.2 详细对比

| 维度 | MyBatis | Hibernate/JPA |
|------|---------|---------------|
| **核心理念** | SQL 中心 | 对象中心 |
| **SQL 控制** | 完全手写 | 框架自动生成（也可手写） |
| **学习曲线** | 低（会 SQL 就行） | 高（需理解 ORM 概念、生命周期、缓存） |
| **灵活性** | 极高（任意 SQL） | 受限于框架映射能力 |
| **数据库迁移** | 需逐条改 SQL | HQL/JPQL 通常无需改 |
| **复杂查询** | 天然适合（多表联查、存储过程） | 需要 `@Query` 或 Criteria API |
| **性能调优** | 精确控制每条 SQL | 需理解框架行为才能调优 |
| **适合场景** | 复杂报表、遗留数据库、需要精确控制 SQL | 领域模型清晰、以对象行为为主的新项目 |
| **团队门槛** | 掌握 SQL 即可 | 需理解 Session、脏检查、Lazy 代理、缓存 |

### 1.3 选择建议

"SQL 复杂就选 MyBatis"这种说法并不成立——JPA 也能写原生 SQL，复杂报表照样能做。真正的分水岭是另一个问题：**你是否愿意让框架在你不注意的地方，替你决定何时发 SQL、发几条 SQL、以什么形式发**。

愿意让渡这份控制权，换来的是对象模型的表达力；不愿意，就要自己写 SQL 承担相应的模板成本。围绕这个核心矛盾，可以把选型拆成几个可判断的问题：

| 决策问题 | 倾向 MyBatis | 倾向 JPA/Hibernate |
| :-- | :--: | :---: |
| SQL 是否需要**逐条可见、可 Review、可被 DBA 审计**？ | ✅ | ❌ |
| 读路径是否以**多表 JOIN、聚合、报表**为主？ | ✅ | ⚠️（HQL/Criteria 更啰嗦） |
| 写路径是否有大量**聚合根内一致性、状态机、级联**等领域行为？ | ❌（需手写模板 SQL） | ✅ |
| 数据库是否是**遗留库、命名不规范、无外键、分库分表**？ | ✅ | ❌（映射频繁打架） |
| 是否需要**跨数据库方言可移植**（同一份代码上 MySQL/PG/Oracle）？ | ❌ | ✅ |
| 是否有大量**批量写、批量更新、复杂 upsert**？ | ✅ | ❌（批处理坑较多） |
| 团队是否理解 Session、一级缓存、Lazy 代理、脏检查、N+1？ | 不要求 | 硬性要求 |

其中最后一条是很多团队被反噬的根源：JPA 不是"学会注解就能用好"，Session 生命周期、脏检查、Lazy 代理、缓存一致性这些机制若未被团队理解，写出来的代码性能与正确性都会随机漂移。**没有人能吃住这些机制时，MyBatis 的显式性反而更安全**。

大型项目常见**混合使用**：JPA 负责简单 CRUD 和详情读取，把领域行为集中在聚合根上；MyBatis 负责复杂报表、批量写和涉及底层 SQL 特性的场景。这不是骑墙，而是承认两种哲学各自的适用边界。

## 2. Entity 生命周期

Hibernate/JPA 中，一个实体对象从诞生到消亡，会经历几个明确的状态。理解这些状态，是理解 ORM 行为的前提。

### 2.1 三种核心状态

```text
┌─────────────┐   persist()/save()   ┌──────────────┐   session 关闭   ┌──────────────┐
│  Transient   │ ────────────────────→ │  Persistent  │ ───────────────→ │   Detached   │
│  (瞬态)      │                       │  (持久态)     │                  │  (游离态)     │
│              │ ←──────────────────── │              │ ←────────────── │              │
└─────────────┘   delete()/remove()   └──────────────┘   merge()        └──────────────┘
       ↑                                      │
       │              GC 回收                  │
       └──────────────────────────────────────┘
```

| 状态 | 特征 | 举例 |
|------|------|------|
| **Transient（瞬态）** | 刚 `new` 出来，数据库中无对应记录，不受 Session 管理 | `User u = new User("张三")` |
| **Persistent（持久态）** | 已与数据库记录关联，受 Session 管理，修改属性会**自动同步到数据库** | `session.save(u)` 之后 |
| **Detached（游离态）** | 曾经是持久态，但 Session 已关闭。对象还在，但不再自动同步 | Session 关闭后，对象仍被持有 |

### 2.2 状态转换实战

```java
// 1. Transient —— 纯粹的 Java 对象
User user = new User();
user.setName("李四");
// 此时数据库中没有这条记录

// 2. Persistent —— 被 EntityManager 管理
entityManager.persist(user);
// 此时 user 被纳入管理，事务提交时自动 INSERT
// 如果修改 user.setAge(25)，事务提交时会自动 UPDATE

// 3. Detached —— Session 关闭后
entityManager.close();
// user 变成游离态，修改它不会自动同步到数据库

// 4. 回到 Persistent —— 重新关联
User merged = entityManager.merge(user);
// merged 是新的持久态对象，修改它会再次自动同步
```

### 2.3 踩坑提示

最容易出问题的是**在事务外修改持久态对象**：

```java
@Transactional
public void updateUser(Long id) {
    User user = entityManager.find(User.class, id); // Persistent
    user.setName("新名字");
    // 事务提交时自动 UPDATE —— 这是期望行为
}

// 但如果你这样做：
public void updateUserOutsideTx(Long id) {
    User user = entityManager.find(User.class, id);
    // 方法没有 @Transactional，find 内部的事务已提交
    user.setName("新名字");
    // 这个修改可能不会被持久化，取决于 flush 策略
}
```

**教训**：始终在事务边界内操作持久态对象。

## 3. Lazy Loading（延迟加载）

延迟加载是 ORM 中最强大也最危险的特性之一。

### 3.1 原理

当你查询一个 `User` 对象时，它的 `orders` 关联默认不会立即查询。只有当你**真正调用 `getOrders()`** 时，ORM 才会发出 SQL 去查 orders 表。

```java
@Entity
public class User {
    @Id
    @GeneratedValue
    private Long id;
    private String name;

    @OneToMany(mappedBy = "user", fetch = FetchType.LAZY)  // 延迟加载
    private List<Order> orders;
}
```

这个行为的底层实现是**代理对象**：Hibernate 不会真的给你一个 `ArrayList<Order>`，而是一个 Proxy，拦截 `getOrders()` 调用，在第一次访问时才发 SQL。

```text
调用 user.getOrders()
       │
       ▼
┌──────────────────┐     未加载      ┌──────────────────┐
│  Proxy (未初始化)  │ ─────────────→ │  执行 SQL 查询    │
│  List<Order>      │                │  SELECT * FROM    │
│                   │                │  orders WHERE     │
│                   │                │  user_id = ?      │
└──────────────────┘                └──────────────────┘
       │
       ▼
┌──────────────────┐
│  真实 List       │  已加载，后续访问直接返回
│  List<Order>     │
└──────────────────┘
```

### 3.2 LazyInitializationException

延迟加载有一个著名的陷阱：**Session 关闭后访问延迟属性**。

```java
// ❌ 典型错误
public UserDto getUser(Long id) {
    User user = entityManager.find(User.class, id);
    // 此方法没有 @Transactional
    // find 之后事务已提交，Session 已关闭

    return new UserDto(
        user.getName(),
        user.getOrders().size()  // 💥 LazyInitializationException!
    );
}
```

异常信息：`could not initialize proxy - no Session`

**解决方式**：

```java
// ✅ 方式1：在事务内访问
@Transactional(readOnly = true)
public UserDto getUser(Long id) {
    User user = entityManager.find(User.class, id);
    user.getOrders().size(); // 强制加载
    return toDto(user);
}

// ✅ 方式2：EntityGraph 指定预加载
@EntityGraph(attributePaths = {"orders"})
@Query("SELECT u FROM User u WHERE u.id = :id")
User findWithOrders(@Param("id") Long id);

// ✅ 方式3：Open Session in View（Spring Boot 默认行为）
// 配置 spring.jpa.open-in-view=true
// Session 在整个 HTTP 请求期间保持打开
// ⚠️ 争议很大：方便但可能隐藏性能问题
```

### 3.3 Eager vs Lazy 的选择

| | `FetchType.EAGER` | `FetchType.LAZY` |
|---|---|---|
| **行为** | 立即加载关联对象 | 访问时才加载 |
| **SQL** | 一条 JOIN 查询或额外查询 | 按需发 SQL |
| **适用** | 关联数据几乎总是需要 | 关联数据偶尔需要 |
| **风险** | 查太多不必要的数据 | `LazyInitializationException` |

**经验法则**：`@ManyToOne` 默认 EAGER，`@OneToMany` 默认 LAZY。**不要轻易改变默认值**——框架的设计者比你更懂常见场景。

## 4. N+1 查询问题

N+1 查询是 ORM 最臭名昭著的性能问题。几乎每个用 ORM 的项目都会踩一次。

### 4.1 问题重现

```java
// 查询所有用户
List<User> users = entityManager
    .createQuery("SELECT u FROM User u", User.class)
    .getResultList();

// 然后遍历每个用户的订单
for (User user : users) {
    System.out.println(user.getName() + ": " + user.getOrders().size());
}
```

**实际发出的 SQL**：

```sql
-- 第 1 条：查所有用户
SELECT * FROM users;

-- 第 2~N+1 条：每个用户各查一次订单
SELECT * FROM orders WHERE user_id = 1;
SELECT * FROM orders WHERE user_id = 2;
SELECT * FROM orders WHERE user_id = 3;
-- ... 假设有 100 个用户，就是 101 条 SQL
```

这就是 **N+1 问题**：1 条主查询 + N 条关联查询。

### 4.2 Hibernate 解决方案

**方案一：JOIN FETCH（最常用）**

```java
// 一条 SQL 搞定：用 JOIN 一次性查出用户和订单
List<User> users = entityManager.createQuery(
    "SELECT u FROM User u JOIN FETCH u.orders", User.class)
    .getResultList();

// 生成的 SQL：
// SELECT u.*, o.* FROM users u
// INNER JOIN orders o ON u.id = o.user_id
```

**方案二：@BatchSize**

```java
@Entity
public class User {
    @OneToMany(mappedBy = "user")
    @BatchSize(size = 20)  // 每次批量加载 20 个用户的订单
    private List<Order> orders;
}

// 生成的 SQL（不再是 N 条，而是 N/20 条）：
// SELECT * FROM orders WHERE user_id IN (1, 2, 3, ..., 20);
// SELECT * FROM orders WHERE user_id IN (21, 22, ..., 40);
```

**方案三：EntityGraph**

```java
@EntityGraph(attributePaths = {"orders"})
@Query("SELECT u FROM User u")
List<User> findAllWithOrders();
```

### 4.3 MyBatis 解决方案

MyBatis 天然没有 N+1 问题（因为 SQL 是你写的），但如果你用了嵌套查询（`<collection select="...">`），同样会触发 N+1。

**方案一：联合查询（推荐）**

```xml
<select id="findAllWithOrders" resultMap="userWithOrders">
    SELECT u.id, u.name, o.id AS oid, o.amount
    FROM users u
    LEFT JOIN orders o ON u.id = o.user_id
</select>

<resultMap id="userWithOrders" type="User">
    <id property="id" column="id"/>
    <result property="name" column="name"/>
    <collection property="orders" ofType="Order">
        <id property="id" column="oid"/>
        <result property="amount" column="amount"/>
    </collection>
</resultMap>
```

**方案二：批量加载**

```xml
<!-- 先查所有用户 -->
<select id="findAll" resultType="User">
    SELECT * FROM users
</select>

<!-- 再用 IN 批量查订单 -->
<select id="findOrdersByUserIds" resultType="Order">
    SELECT * FROM orders WHERE user_id IN
    <foreach collection="userIds" item="id" open="(" separator="," close=")">
        #{id}
    </foreach>
</select>
```

### 4.4 对比总结

| 方案 | 框架 | 效果 | 适用场景 |
|------|------|------|---------|
| JOIN FETCH | Hibernate | 一条 SQL，关联数据一起查 | 一对一、一对少 |
| @BatchSize | Hibernate | 分批查，减少 SQL 数量 | 一对多，数据量大 |
| EntityGraph | Hibernate | 声明式指定加载图 | Spring Data JPA |
| 联合查询 | MyBatis | 一条 SQL，手写 JOIN | 复杂关联 |
| IN 批量查询 | MyBatis | 两条 SQL，用 IN 合并 | 一对多 |

## 5. 对象-关系映射策略

映射的核心问题是：**Java 中的"关系"在数据库中如何表达？**

### 5.1 单表映射

最简单的场景：一个类对应一张表。

```java
@Entity
@Table(name = "products")
public class Product {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "product_name", length = 100, nullable = false)
    private String name;

    @Column(precision = 10, scale = 2)
    private BigDecimal price;

    @Enumerated(EnumType.STRING)
    private ProductStatus status;

    @Temporal(TemporalType.TIMESTAMP)
    private Date createdAt;
}
```

对应的数据库表：

```text
┌──────────────────────────────────┐
│           products               │
├──────────────────────────────────┤
│ id          BIGINT    PK, AUTO  │
│ product_name VARCHAR(100) NOT NULL│
│ price       DECIMAL(10,2)        │
│ status      VARCHAR(20)          │
│ created_at  TIMESTAMP            │
└──────────────────────────────────┘
```

### 5.2 一对多（One-to-Many）

一个用户有多个订单。

```java
// === 方式一：注解（主流）===
@Entity
public class User {
    @Id
    @GeneratedValue
    private Long id;
    private String name;

    @OneToMany(mappedBy = "user", cascade = CascadeType.ALL, orphanRemoval = true)
    private List<Order> orders = new ArrayList<>();
}

@Entity
public class Order {
    @Id
    @GeneratedValue
    private Long id;
    private BigDecimal amount;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "user_id")
    private User user;
}

// === 方式二：XML 配置 ===
```

```xml
<!-- User.hbm.xml -->
<hibernate-mapping>
    <class name="User" table="users">
        <id name="id" column="id">
            <generator class="identity"/>
        </id>
        <property name="name" column="name"/>
        <bag name="orders" inverse="true" cascade="all-delete-orphan">
            <key column="user_id"/>
            <one-to-many class="Order"/>
        </bag>
    </class>
</hibernate-mapping>
```

**注意 `mappedBy` 的含义**：它告诉 Hibernate "外键在 Order 那边"。如果不写，Hibernate 会创建一张**中间表**来维护关系，这通常不是你想要的。

### 5.3 多对一（Many-to-One）

多对一是多对一的反面，通常从"多"的一方看问题：

```java
@Entity
public class Order {
    @ManyToOne(fetch = FetchType.LAZY)  // 不要轻易改成 EAGER
    @JoinColumn(name = "user_id", nullable = false)
    private User user;
}
```

**fetch 策略的选择**：`@ManyToOne` 默认是 `EAGER`，但实践中建议显式写 `LAZY`。理由是：大多数场景下，你查订单时并不一定需要立即加载用户信息。真正需要时再通过 `JOIN FETCH` 显式加载。

### 5.4 多对多（Many-to-Many）

一个学生可以选多门课，一门课可以被多个学生选。

```java
@Entity
public class Student {
    @Id
    @GeneratedValue
    private Long id;
    private String name;

    @ManyToMany
    @JoinTable(
        name = "student_course",
        joinColumns = @JoinColumn(name = "student_id"),
        inverseJoinColumns = @JoinColumn(name = "course_id")
    )
    private Set<Course> courses = new HashSet<>();
}

@Entity
public class Course {
    @Id
    @GeneratedValue
    private Long id;
    private String title;

    @ManyToMany(mappedBy = "courses")
    private Set<Student> students = new HashSet<>();
}
```

数据库结构：

```text
┌──────────┐     ┌────────────────┐     ┌──────────┐
│ students │     │ student_course  │     │ courses  │
├──────────┤     ├────────────────┤     ├──────────┤
│ id  (PK) │←───│ student_id (FK) │     │ id  (PK) │
│ name     │     │ course_id  (FK) │───→│ title    │
└──────────┘     └────────────────┘     └──────────┘
```

**多对多的陷阱**：

1. **中间表额外字段**：如果关系本身有属性（如选课时间、成绩），你需要把中间表提升为独立实体，改用两个 `@ManyToOne`。
2. **Cascade 谨慎使用**：多对多上的 `CascadeType.ALL` 可能导致意外删除。
3. **Set vs List**：多对多关联建议用 `Set` 而非 `List`，避免 Hibernate 在更新时产生不必要的删除+重插操作。

### 5.5 继承映射

当实体类有继承关系时，如何映射到数据库？JPA 提供三种策略：

```java
@Entity
@Inheritance(strategy = InheritanceType.SINGLE_TABLE)
@DiscriminatorColumn(name = "vehicle_type")
public abstract class Vehicle {
    @Id @GeneratedValue
    private Long id;
    private String brand;
}

@Entity
@DiscriminatorValue("CAR")
public class Car extends Vehicle {
    private int seatCount;
}

@Entity
@DiscriminatorValue("TRUCK")
public class Truck extends Vehicle {
    private double loadCapacity;
}
```

| 策略 | 表结构 | 优点 | 缺点 |
|------|--------|------|------|
| `SINGLE_TABLE` | 一张表，用鉴别列区分 | 查询最快，无 JOIN | 列浪费（NULL 多） |
| `TABLE_PER_CLASS` | 每个子类一张表 | 结构清晰 | 多态查询需 UNION |
| `JOINED` | 父类和子类各一张表，用 JOIN 关联 | 无冗余，结构规范 | 查询需 JOIN，性能较差 |

**实践建议**：默认用 `SINGLE_TABLE`，除非子类字段差异极大（超过 20 个不同列）才考虑 `JOINED`。

## 6. 本章小结

ORM 是一把双刃剑。它把开发者从重复的 JDBC 代码中解放出来，但也引入了新的复杂性：

```text
┌─────────────────────────────────────────────────────────┐
│                    ORM 的本质                             │
│                                                         │
│   对象世界              ORM 映射             关系世界      │
│   ┌──────┐    ┌──────────────────┐    ┌──────────┐     │
│   │ Class │◄──→│ 注解 / XML 配置   │◄──→│ Table    │     │
│   │ Object│    │ 生命周期管理       │    │ Row      │     │
│   │ Ref   │    │ 缓存 / 延迟加载    │    │ FK       │     │
│   └──────┘    └──────────────────┘    └──────────┘     │
│                                                         │
│   关键权衡：                                              │
│   • 自动化 vs 可控性                                      │
│   • 对象模型 vs 数据模型                                   │
│   • 开发效率 vs 运行时性能                                  │
└─────────────────────────────────────────────────────────┘
```

**本章关键要点**：

1. **MyBatis 和 JPA 不是对错之分**，而是"SQL 优先"与"对象优先"的哲学差异。根据项目特征选择。
2. **Entity 生命周期**（Transient → Persistent → Detached）决定了 ORM 的行为边界。在事务内操作持久态对象是铁律。
3. **延迟加载**是性能优化利器，但 `LazyInitializationException` 是每个 ORM 开发者的成人礼。用 `@Transactional` 或 `JOIN FETCH` 来避免。
4. **N+1 问题**是 ORM 最大的性能陷阱。识别它、解决它，是中级开发者向高级迈进的必修课。
5. **映射策略**的选择影响数据库结构。`mappedBy`、`CascadeType`、`FetchType` 这三个注解属性值值得反复推敲。

> ORM 帮你省了手写 SQL 的力气，但 SQL 最终还是要发到数据库执行。数据库收到一条 SELECT 后，内部经历了什么？为什么有时候快如闪电，有时候慢得让人抓狂？下一章从 SQL 执行流程开始，拆解索引、锁、事务隔离——理解这些，你写的 SQL 才真正"懂数据库"。
