# Spring Data JPA

> JPA 把数据库表映射成 Java 对象，你操作对象，框架帮你生成 SQL。不用手写 SELECT/INSERT，方法名就能查询，审计字段自动填充。但 ORM 的「魔法」背后藏着 N+1 陷阱、懒加载异常、持久化上下文脏检查——理解原理才能用好。本章从实体定义到 Repository，从 Specification 动态查询到审计功能，把 JPA 的核心用法和常见坑讲清楚。

## 1. 实体定义与关联映射

### 1.1 基础实体

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

    @PrePersist
    protected void onCreate() {
        this.createTime = LocalDateTime.now();
    }

    // getters & setters
}

public enum UserStatus {
    ACTIVE, INACTIVE, BANNED
}
```

### 1.2 关联映射

数据库表之间的关系（一对一、一对多、多对多）通过 JPA 注解映射到 Java 对象：

```java
@Entity
@Table(name = "users")
public class User {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    private String username;
    private String email;

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
}

@Entity
@Table(name = "orders")
public class Order {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false)
    private String orderNo;

    // 多对一：多个订单属于一个用户
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "user_id", nullable = false)
    private User user;

    // 一对一：一个订单对应一笔支付
    @OneToOne(cascade = CascadeType.ALL, orphanRemoval = true)
    @JoinColumn(name = "payment_id")
    private Payment payment;
}
```

### 1.3 关联映射要点

| 关系 | 注解 | fetch 默认 | 注意事项 |
| :-- | :-- | :-- | :-- |
| `@OneToOne` | `@JoinColumn` | EAGER | 考虑用 `LAZY` 避免 N+1 |
| `@ManyToOne` | `@JoinColumn` | EAGER | 默认 EAGER 通常是性能陷阱 |
| `@OneToMany` | `mappedBy` | LAZY | 用 `orphanRemoval=true` 管理子实体生命周期 |
| `@ManyToMany` | `@JoinTable` | LAZY | 避免用 `CascadeType.ALL`，用单独管理 |

> **踩坑提醒**：`@ManyToOne` 默认是 `FetchType.EAGER`，意味着查询 Order 时会自动 JOIN User。如果一次查 100 个 Order，会发出 100 条查询 User 的 SQL（N+1 问题）。**所有关联都建议用 `LAZY`**，需要时再用 `JOIN FETCH` 显式加载。

---

## 2. Repository 接口

### 2.1 方法命名查询

Spring Data 解析方法名自动生成 SQL，不用写一行查询代码：

```java
public interface UserRepository extends JpaRepository<User, Long> {

    // SELECT * FROM users WHERE username = ?
    Optional<User> findByUsername(String username);

    // SELECT * FROM users WHERE email LIKE '%keyword%'
    List<User> findByEmailContaining(String keyword);

    // SELECT * FROM users WHERE status = ? ORDER BY create_time DESC
    List<User> findByStatusOrderByCreateTimeDesc(UserStatus status);

    // SELECT * FROM users WHERE username LIKE ? AND status = ?
    Page<User> findByUsernameContainingAndStatus(String keyword, UserStatus status,
                                                  Pageable pageable);

    // EXISTS 查询
    boolean existsByEmail(String email);

    // COUNT 查询
    long countByStatus(UserStatus status);

    // DELETE 查询（需要 @Transactional）
    @Transactional
    int deleteByStatus(UserStatus status);
}
```

### 2.2 @Query JPQL

方法名太长或查询太复杂时，用 `@Query` 注解直接写 JPQL：

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

### 2.3 N+1 问题与解决方案

N+1 问题是 JPA 最常见的性能陷阱：

```java
// ❌ N+1 问题：查 100 个 Order，每个 Order 再查一次 User
// 总共 1 + 100 = 101 条 SQL
List<Order> orders = orderRepository.findAll();
for (Order order : orders) {
    System.out.println(order.getUser().getName());  // 触发懒加载
}
```

解决方案：

```java
public interface OrderRepository extends JpaRepository<Order, Long> {

    // 方案一：JOIN FETCH
    @Query("SELECT o FROM Order o JOIN FETCH o.user")
    List<Order> findAllWithUser();

    // 方案二：@EntityGraph
    @EntityGraph(attributePaths = {"user", "items"})
    @Query("SELECT o FROM Order o WHERE o.status = :status")
    List<Order> findByStatusWithDetails(@Param("status") String status);
}
```

---

## 3. Specification 动态查询

搜索功能有多个可选条件，用户可能只填其中几个。Specification 让你动态组合查询条件：

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

> **踩坑提醒**：`Specification` 返回 `null` 表示该条件不参与查询（Spring Data 会忽略 null specification）。但第一个 `where` 不能传 null——用 `where(spec1).and(spec2)` 而不是 `where(null).and(spec1)`。

---

## 4. 审计功能

每张表都有 `created_by`、`created_at`、`updated_by`、`updated_at` 字段，每个实体都要手动赋值？JPA 审计自动填充。

### 4.1 开启审计

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
```

### 4.2 审计基类

```java
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
```

### 4.3 实体继承基类

```java
@Entity
@Table(name = "users")
public class User extends BaseEntity {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;
    private String username;
    private String email;
    // createdAt, updatedAt, createdBy, updatedBy 自动填充
}
```

> **踩坑提醒**：`@CreatedDate` 和 `@LastModifiedDate` 只在 JPA `persist` 和 `merge` 时触发。如果用 `@Query` 的 `@Modifying` 直接写 SQL 更新，审计字段**不会**自动更新——因为绕过了 JPA 的实体生命周期。

---

## 5. 原生 SQL 与 DTO 投影

### 5.1 原生 SQL 查询

```java
public interface UserRepository extends JpaRepository<User, Long> {

    @Query(value = "SELECT u.*, o.order_count " +
                   "FROM users u LEFT JOIN " +
                   "(SELECT user_id, COUNT(*) as order_count FROM orders GROUP BY user_id) o " +
                   "ON u.id = o.user_id WHERE u.status = :status", nativeQuery = true)
    List<UserWithOrderCount> findUsersWithOrderCount(@Param("status") String status);
}
```

### 5.2 DTO 投影

只查需要的字段，减少内存占用：

```java
// DTO
public record UserSummary(Long id, String username, String email) {}

// Repository
public interface UserRepository extends JpaRepository<User, Long> {

    @Query("SELECT new com.example.dto.UserSummary(u.id, u.username, u.email) " +
           "FROM User u WHERE u.status = 'ACTIVE'")
    List<UserSummary> findActiveUserSummaries();
}
```

---

## 6. 最佳实践

1. **关联关系用 `FetchType.LAZY`**——避免 N+1 查询问题
2. **需要时用 `JOIN FETCH` 或 `@EntityGraph`** 一次性加载关联数据
3. **审计字段用 `@CreatedDate` / `@LastModifiedDate`**——无需手动维护
4. **批量操作用 `@Modifying` + `@Query`**——避免逐条查询再更新
5. **DTO 投影优于实体查询**——只查需要的字段，减少内存占用
6. **动态查询用 Specification**——搜索条件不确定时，比拼接 JPQL 更安全
