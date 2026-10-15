# ORM 深入：对象与关系如何转换

> 本页比较 ORM 的映射机制和常见性能问题。Spring Data JPA 的 Repository、Specification 和审计用法见 [Spring Data JPA](../../spring/04-data-access/chapter-03-jpa.md)。

> ORM 不只负责把查询结果映射成 Java 对象。使用 Hibernate 时，实体状态、关联映射和获取策略都会影响 SQL 的执行时机与数量。本章从 MyBatis 与 JPA/Hibernate 的工作方式出发，解释实体生命周期、延迟加载和关联查询的常见问题。

## 1. MyBatis vs Hibernate/JPA

在 Java 生态中，两类主流数据访问方案是 **MyBatis**（SQL 映射框架）和 **Hibernate/JPA**（ORM 框架）。它们解决同一个问题，但管理的抽象层次不同。

### 1.1 两种工作方式

**MyBatis：以 SQL 为中心。**

MyBatis 本质上是一个 SQL 映射框架。你手写 SQL，MyBatis 负责把查询结果映射成 Java 对象。它不会像 Hibernate 那样基于实体状态自动生成常规 CRUD SQL，也通常不自动维护 JPA 式的实体关联与脏检查；但若配置嵌套查询（如 `<collection select="...">`），仍可能产生额外 SQL。

```xml
<!-- MyBatis Mapper XML -->
<select id="findUserWithOrders" resultMap="userWithOrdersMap">
    SELECT u.id, u.name, o.id as order_id, o.amount
    FROM users u
    LEFT JOIN orders o ON u.id = o.user_id
    WHERE u.id = #{userId}
</select>
```

**Hibernate/JPA：以对象为中心。**

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
| :-- | :-- | :-- |
| **核心理念** | SQL 中心 | 对象中心 |
| **SQL 控制** | 主要由开发者定义，框架负责参数绑定、执行与结果映射 | 框架自动生成（也可手写） |
| **学习曲线** | 入门成本较低，但仍需理解 SQL 映射、事务与框架配置 | 高（需理解 ORM 概念、生命周期、缓存） |
| **灵活性** | 极高（任意 SQL） | 受限于框架映射能力 |
| **数据库迁移** | 需逐条改 SQL | HQL/JPQL 通常无需改 |
| **复杂查询** | 显式编写 JOIN、聚合和存储过程调用 | 可用 `@Query` 或 Criteria API 表达 |
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
| 数据库是否是**遗留库、命名不规范、无外键、分库分表**？ | ✅ | ⚠️（映射约束较多） |
| 是否需要**跨数据库方言可移植**（同一份代码上 MySQL/PG/Oracle）？ | ❌ | ✅ |
| 是否有大量**批量写、批量更新、复杂 upsert**？ | ✅ | ❌（批处理坑较多） |
| 团队需要理解的机制 | 理解 SQL、参数绑定与结果映射 | 还需理解实体状态、持久化上下文、延迟加载与脏检查 |

其中最后一条是很多团队踩坑的根源：JPA 不是"学会注解就能用好"。Session 生命周期、脏检查、Lazy 代理、缓存一致性这些机制若未被团队理解，写出来的代码容易出现事务边界不清、延迟加载触发额外查询、实体状态不符合预期等问题。**团队还不具备这些机制时，MyBatis 的显式性反而更可控**。

大型项目常见**混合使用**：JPA 负责简单 CRUD 和详情读取，把领域行为集中在聚合根上；MyBatis 负责复杂报表、批量写和涉及底层 SQL 特性的场景。这不是骑墙，而是承认两者各自的适用边界。

## 2. Entity 生命周期

Hibernate/JPA 中，一个实体对象从诞生到消亡，会经历几个明确的状态。理解这些状态，是理解 ORM 行为的前提。

### 2.1 三种核心状态

```txt
            persist()/save()
┌─────────────┐ ────────────────→ ┌──────────────┐  持久化上下文结束  ┌──────────────┐
│  Transient   │                   │  Persistent  │ ────────────────→ │   Detached   │
│  (瞬态)      │                   │  (持久态)     │                   │  (游离态)     │
└─────────────┘                   │              │ ←─ merge() 返回 ── │              │
       │                           └──────┬───────┘  新的受管实例      └──────────────┘
       │                                  │ remove()
       │                                  ▼
       │                           ┌──────────────┐
       └───────────────────────────│   Removed     │
                                   │  (已标记删除)  │
                                   └──────────────┘
```

| 状态 | 特征 | 举例 |
| :-- | :-- | :-- |
| **Transient（瞬态）** | 刚 `new` 出来，数据库中无对应记录，不受 Session 管理 | `User u = new User("张三")` |
| **Persistent（持久态）** | 已与持久化上下文关联，属性变化会被跟踪；flush 或事务提交时写入数据库 | `persist()` 之后 |
| **Detached（游离态）** | 曾经是持久态，但 Session 已关闭。对象还在，但不再自动同步 | Session 关闭后，对象仍被持有 |

### 2.2 状态转换实战

```java
// 1. Transient —— 纯粹的 Java 对象
User user = new User();
user.setName("李四");
// 此时数据库中没有这条记录

// 2. Persistent —— 被 EntityManager 管理
entityManager.persist(user);
// user 成为受管理的实体；INSERT 通常在 flush 或事务提交时同步到数据库，
// 具体时机取决于提供者、主键生成策略和事务环境，提供者也可能提前执行。
// 对受管理实体的修改会被脏检查检测，并在后续 flush 时同步。

// 3. Detached —— 持久化上下文结束后
// （以下用独立创建、由应用管理的 EntityManager 演示；Spring 注入的共享
//  EntityManager 由容器管理生命周期，不应直接 close()）
entityManager.close();
// user 变成游离态，修改它不会自动同步到数据库

// 4. 重新关联：merge 把 user 的状态复制到受管理的实体并返回
User merged = entityManager.merge(user);
// merge 返回受当前持久化上下文管理的对象（merged）；
// 原来的 user 仍保持 Detached，不会因此变回受管理状态。
// 后续依赖脏检查的修改应作用在 merged 上。
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
    // 对象是否仍受管理，取决于当前持久化上下文的生命周期，
    // 而非方法上是否标注 @Transactional。
    user.setName("新名字");
    // 若 user 已 Detached，这个修改不会自动同步到数据库
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

这个行为的底层实现是**代理或持久化集合包装器**：Hibernate 不会真的给你一个已装满的 `ArrayList<Order>`，而是在首次访问关联数据时才发 SQL。对于实体关联，Hibernate 常用代理对象拦截访问；对于集合关联，Hibernate 通常使用持久化集合包装器。集合尚未初始化时，遍历或读取集合内容等操作时可能触发 SQL；具体是否导致完整初始化，取决于集合的初始化状态与加载配置。关联初始化后，后续访问通常可以复用已加载的数据。

```txt
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
| :-- | :-- | :-- |
| **获取语义** | 关联数据应在要求的获取时机可用 | 允许延迟获取关联数据 |
| **SQL 形态** | 可能 JOIN，也可能执行额外查询 | 访问未初始化的关联时可能执行查询 |
| **适用** | 关联数据几乎总是需要 | 关联数据偶尔需要 |
| **风险** | 读取不需要的数据，或产生额外查询 | 持久化上下文不可用时无法初始化关联 |

**经验法则**：`@ManyToOne` 默认 EAGER，`@OneToMany` 默认 LAZY。不要仅为了避免延迟加载异常就把关联全部改为 EAGER——EAGER 可能导致读取不需要的数据，也不能保证关联只通过一条 JOIN 查询获取。应根据查询用例选择获取策略，并用 SQL 日志验证实际行为。

## 4. N+1 查询问题

N+1 查询是 ORM 中常见的性能问题。当查询先返回 N 个用户、再为每个用户分别查询订单时，总查询次数会从 1 条增加到最多 1+N 条，这种查询模式称为 N+1。

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
-- ... 假设主查询返回 100 个用户，且每个用户的订单集合均未初始化、无缓存命中
-- 也未启用批量获取，则总计约 101 条 SQL：1 条用户查询 + 100 条订单查询
```

这就是 **N+1 问题**：1 条主查询 + N 条关联查询。

### 4.2 Hibernate 解决方案

**方案一：JOIN FETCH（最常用）**

```java
// 用 JOIN FETCH 在同一条查询中获取用户及其订单，避免随后逐个用户查询订单
List<User> users = entityManager.createQuery(
    "SELECT u FROM User u JOIN FETCH u.orders", User.class)
    .getResultList();

// Hibernate 通常生成包含 JOIN 的 SQL（示意，具体 SQL 以日志为准）：
// SELECT u.*, o.* FROM users u
// INNER JOIN orders o ON u.id = o.user_id
// 注意：INNER JOIN FETCH 会排除没有订单的用户；
// 若需保留这些用户，应改用 LEFT JOIN FETCH。
```

> 一对多 JOIN 会展开结果行，关联数据较多时可能增加传输量与结果处理成本；对集合关联做 fetch join 后再分页，也需特别处理。

**方案二：@BatchSize**

```java
@Entity
public class User {
    @OneToMany(mappedBy = "user")
    @BatchSize(size = 20)  // 每次批量加载 20 个用户的订单
    private List<Order> orders;
}

// size = 20 是批量获取的配置上限：当同一持久化上下文中存在多个符合批量获取条件
// 的未初始化集合时，Hibernate 可以将它们合并为带 IN 条件的查询，减少逐个加载
// 的数据库往返。实际批次数取决于待初始化集合的数量与具体加载场景，应以 SQL 日志验证。
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

MyBatis 不会替你自动为关联关系生成查询，因此开发者更容易从主 SQL 就看出查询数量；但使用 `<collection select="...">` 等嵌套查询时仍会产生 N+1，必须改写为 JOIN 或批量关联查询。

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
| :-- | :-- | :-- | :-- |
| JOIN FETCH | Hibernate | 一条 SQL 关联数据一起查；但 JOIN 展开结果行，分页需特殊处理 | 一对一及小规模一对多，且结果集规模可控 |
| @BatchSize | Hibernate | 分批查，减少 SQL 数量 | 一对多，数据量大 |
| EntityGraph | Hibernate | 声明式指定加载图 | Spring Data JPA |
| 联合查询 | MyBatis | 一条 SQL，手写 JOIN | 复杂关联 |
| IN 批量查询 | MyBatis | 两条 SQL，用 IN 合并 | 一对多 |


前面的内容解释了实体生命周期、延迟加载和 N+1 查询。接下来集中回答对象关系本身如何落到数据库结构，包括单表、一对多、多对多和继承映射。

> **下一页：** [对象关系映射策略](./chapter-07-orm-mapping-strategies.md)
