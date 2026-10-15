# ORM 深入：对象关系映射策略

> 本页与 [ORM 深入：对象与关系如何转换](./chapter-06-orm-deep.md) 配套，重点说明单表、关联映射与继承映射策略。

## 1. 对象-关系映射策略

映射的核心问题是：**Java 中的"关系"在数据库中如何表达？**

### 1.1 单表映射

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

    private LocalDateTime createdAt;
}
```

对应的数据库表：

```txt
┌──────────────────────────────────┐
│           products               │
├──────────────────────────────────┤
│ id          BIGINT    PK, AUTO  │
│ product_name VARCHAR(100) NOT NULL│
│ price       DECIMAL(10,2)        │
│ status      VARCHAR(20)          │
│ created_at  TIMESTAMP            │
└──────────────────────────────────┘

> 上表仅示意列名与类型。实际 `CREATE TABLE` 由 JPA 实现按数据库方言与 `@Column` 配置生成，具体类型、长度与约束以运行期生成的 DDL 或手写 DDL 为准。

### 1.2 一对多（One-to-Many）

一个用户有多个订单。

```java
// === 方式一：JPA 注解 ===
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

> 上面的 XML 是 Hibernate 传统的 `hbm.xml` 映射方式，与注解表达同一组映射关系，只是写法不同；新项目通常以注解为主。

**注意 `mappedBy` 的含义**：`User.orders` 用 `mappedBy = "user"` 声明自己是双向关联的反向侧，关系由拥有方 `Order.user` 维护，外键落在订单表的 `user_id`。若改成单向 `@OneToMany` 且不写 `mappedBy`，JPA 默认用一张关联表维护关系；这不是「删掉 mappedBy 仍是同一关系」，而是换了一种映射方式。

**`cascade` 与 `orphanRemoval` 的删除语义**：示例里的 `CascadeType.ALL` 包含 `REMOVE`，删除用户会级联删除其订单；`orphanRemoval = true` 会在订单移出集合时被直接删除。仅当订单生命周期确实依附于用户时才这样配置，否则应缩小级联范围或去掉孤儿删除。

### 1.3 多对一（Many-to-One）

多对一是多对一的反面，通常从"多"的一方看问题：

```java
@Entity
public class Order {
    @ManyToOne(fetch = FetchType.LAZY)  // 默认 EAGER 可能带来不必要的关联加载
    @JoinColumn(name = "user_id", nullable = false)
    private User user;
}
```

**fetch 策略的选择**：`@ManyToOne` 默认是 `EAGER`，但实践中建议显式写 `LAZY`。理由是：大多数场景下，你查订单时并不一定需要立即加载用户信息。真正需要时再通过 `JOIN FETCH` 显式加载——它适合在已知要访问关联时一次性取出；若是否访问取决于后续逻辑，更稳妥的做法是在事务内或视图层之前按需访问，而不是为图省事改回 `EAGER`。

### 1.4 多对多（Many-to-Many）

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

```txt
┌──────────┐     ┌────────────────┐     ┌──────────┐
│ students │     │ student_course  │     │ courses  │
├──────────┤     ├────────────────┤     ├──────────┤
│ id  (PK) │←───│ student_id (FK) │     │ id  (PK) │
│ name     │     │ course_id  (FK) │───→│ title    │
└──────────┘     └────────────────┘     └──────────┘
```

**多对多的陷阱**：

1. **中间表额外字段**：如果关系本身有属性（如选课时间、成绩），你需要把中间表提升为独立实体，改用两个 `@ManyToOne`。
2. **Cascade 谨慎使用**：多对多上慎用 `CascadeType.ALL`，尤其是其中的 `REMOVE`——删除一端会级联删除中间表记录甚至另一端实体，这通常不是预期行为。只在确实需要级联语义时，按需指定具体项（如 `PERSIST`、`MERGE`）。
3. **Set vs List**：多对多关联的普通映射建议用 `Set` 而非 `List`，因为 `List` 需要借助索引列或排序来保持顺序，Hibernate 更新集合时还可能产生额外的删除+重插操作；若业务确实需要保留顺序或允许重复元素，用 `List` 并配置 `@OrderColumn` 更合适。

### 1.5 继承映射

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

> 下面的代码只演示 `SINGLE_TABLE` 的实体声明；`TABLE_PER_CLASS` 与 `JOINED` 的存储差异见下表，且 `TABLE_PER_CLASS` 在 JPA 规范中属于可选支持，可移植性弱于前两者。

| 策略 | 表结构 | 优点 | 缺点 |
| :-- | :-- | :-- | :-- |
| `SINGLE_TABLE` | 一张表，用鉴别列区分 | 通常避免继承层内的 JOIN，适合频繁多态查询 | 宽表、可空列多 |
| `TABLE_PER_CLASS` | 每个子类一张表 | 子类结构独立清晰 | 多态查询需合并各子类表（常涉及 UNION）；规范中属可选支持，可移植性弱 |
| `JOINED` | 父类和子类各一张表，用 JOIN 关联 | 无冗余，结构规范 | 读取子类对象需 JOIN 父子表，相对单表开销更大 |

**实践建议**：结合表宽、子类数量、查询按子类过滤或聚合的需求以及写放大来选择，不按固定字段数决定。单表便于全局查询但列多；类表更聚焦但读取子类对象通常需要 JOIN。

## 2. 本页小结

ORM 用映射层替代了重复的 JDBC 样板代码，但也引入了新的复杂性：

```txt
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
3. **延迟加载**是性能优化利器，但脱离持久化上下文后访问未加载的关联会抛出 `LazyInitializationException`；用 `@Transactional` 或在事务内通过 `JOIN FETCH` 完成访问来避免。
4. **N+1 问题**是 ORM 最常见的性能陷阱，表现为一次查询触发大量逐行查询。识别并用 `JOIN FETCH`、批量抓取或 `@BatchSize` 解决，是性能调优的常规动作。
5. **映射策略**的选择影响数据库结构。`mappedBy`、`CascadeType`、`FetchType` 这三个注解属性值值得反复推敲。

> ORM 负责把对象操作转换为 SQL，但最终性能仍取决于 SQL、执行计划和连接管理。下一章从数据访问性能入手，讨论连接池、SQL 执行、索引与事务等取舍。
