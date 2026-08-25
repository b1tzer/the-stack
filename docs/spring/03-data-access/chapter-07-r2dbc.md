# 响应式数据访问 (R2DBC)

> WebFlux 是非阻塞的，但如果数据库访问还是阻塞的 JDBC，整个调用链就退化成阻塞了。R2DBC（Reactive Relational Database Connectivity）是响应式关系数据库访问规范，让数据库操作也变成非阻塞的。Spring Data R2DBC 提供了 Repository 抽象，和 JPA 用法类似。

## 1. 为什么需要 R2DBC

传统 JDBC 的阻塞模型：

```text
请求 → Tomcat 线程 → JDBC 查询（线程挂起等待数据库响应）→ 返回
                     ↑ 这段时间线程被占用，无法处理其他请求
```

R2DBC 的非阻塞模型：

```text
请求 → Event Loop 线程 → 发送 SQL → 立即释放线程
                          ↓ 数据库响应回来
                     回调通知 → 继续处理
```

| 维度 | JDBC | R2DBC |
| :-- | :-- | :-- |
| 线程模型 | 一请求一线程 | 事件驱动，少量线程处理大量请求 |
| 连接池效率 | 连接数 = 并发数 | 连接数远小于并发数 |
| 适用场景 | 传统 MVC | WebFlux、高并发 |
| ORM 支持 | JPA/MyBatis | Spring Data R2DBC（无 JPA） |

## 2. 依赖与配置

```xml
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-data-r2dbc</artifactId>
</dependency>
<dependency>
    <groupId>io.r2dbc</groupId>
    <artifactId>r2dbc-pool</artifactId>
</dependency>
<dependency>
    <groupId>io.r2dbc</groupId>
    <artifactId>r2dbc-mysql</artifactId>  <!-- 或 r2dbc-postgresql -->
</dependency>
```

```yaml
spring:
  r2dbc:
    url: r2dbc:mysql://localhost:3306/mydb
    username: root
    password: secret
    pool:
      initial-size: 5
      max-size: 20
      max-idle-time: 30m
```

## 3. Repository 模式

### 3.1 实体定义

```java
@Table("user")
@Data
public class User {
    @Id
    private Long id;
    private String username;
    private String email;
    private LocalDateTime createdAt;
}
```

### 3.2 Repository 接口

```java
public interface UserRepository extends ReactiveCrudRepository<User, Long> {

    // 方法名派生查询
    Mono<User> findByUsername(String username);

    Flux<User> findByEmailContaining(String keyword);

    // @Query 注解
    @Query("SELECT * FROM user WHERE created_at > :since ORDER BY id DESC LIMIT :limit")
    Flux<User> findRecentUsers(LocalDateTime since, int limit);

    // 响应式返回类型
    Mono<Long> countByEmailContaining(String keyword);
    Mono<Boolean> existsByUsername(String username);
}
```

### 3.3 响应式返回类型

| 返回类型 | 含义 |
| :-- | :-- |
| `Mono<T>` | 0 或 1 个元素的异步序列 |
| `Flux<T>` | 0 到 N 个元素的异步序列 |
| `Mono<Void>` | 只关心完成信号，不关心结果 |

## 4. ReactiveDatabaseClient

比 Repository 更灵活的查询客户端：

```java
@Component
public class UserDA {

    @Autowired
    private DatabaseClient client;

    // 查询
    public Flux<User> findActiveUsers() {
        return client.sql("SELECT * FROM user WHERE status = :status")
                .bind("status", "ACTIVE")
                .map((row, metadata) -> {
                    User user = new User();
                    user.setId(row.get("id", Long.class));
                    user.setUsername(row.get("username", String.class));
                    user.setEmail(row.get("email", String.class));
                    return user;
                })
                .all();
    }

    // 插入
    public Mono<Integer> insertUser(User user) {
        return client.sql("INSERT INTO user (username, email) VALUES (:username, :email)")
                .bind("username", user.getUsername())
                .bind("email", user.getEmail())
                .fetch()
                .rowsUpdated();
    }

    // 事务
    @Transactional
    public Mono<Void> transfer(Long fromId, Long toId, BigDecimal amount) {
        return client.sql("UPDATE account SET balance = balance - :amount WHERE id = :id")
                .bind("amount", amount)
                .bind("id", fromId)
                .fetch()
                .rowsUpdated()
                .then(client.sql("UPDATE account SET balance = balance + :amount WHERE id = :id")
                        .bind("amount", amount)
                        .bind("id", toId)
                        .fetch()
                        .rowsUpdated())
                .then();
    }
}
```

## 5. 事务管理

```java
@Service
public class UserService {

    @Autowired
    private UserRepository userRepository;

    // 声明式事务
    @Transactional
    public Mono<User> createUser(CreateUserDTO dto) {
        return userRepository.existsByUsername(dto.getUsername())
                .flatMap(exists -> {
                    if (exists) {
                        return Mono.error(new DuplicateUsernameException(dto.getUsername()));
                    }
                    User user = new User();
                    user.setUsername(dto.getUsername());
                    user.setEmail(dto.getEmail());
                    return userRepository.save(user);
                });
    }

    // 编程式事务
    @Autowired
    private ReactiveTransactionManager transactionManager;

    public Mono<User> createUserProgrammatic(CreateUserDTO dto) {
        return Mono.usingWhen(
            transactionManager.getTransaction(TransactionDefinition.withDefaults()),
            tx -> userRepository.save(mapToUser(dto)),
            ReactiveTransactionManager::commit,
            (tx, err) -> ReactiveTransactionManager.rollback(tx),
            ReactiveTransactionManager::commit
        );
    }
}
```

## 6. R2DBC + WebFlux 完整示例

```java
@RestController
@RequestMapping("/api/users")
public class UserController {

    @Autowired
    private UserRepository userRepository;

    @GetMapping
    public Flux<User> listUsers(@RequestParam(defaultValue = "0") int page,
                                @RequestParam(defaultValue = "20") int size) {
        return userRepository.findAll()
                .skip((long) page * size)
                .take(size);
    }

    @GetMapping("/{id}")
    public Mono<ResponseEntity<User>> getUser(@PathVariable Long id) {
        return userRepository.findById(id)
                .map(ResponseEntity::ok)
                .defaultIfEmpty(ResponseEntity.notFound().build());
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public Mono<User> createUser(@Valid @RequestBody User user) {
        return userRepository.save(user);
    }

    // SSE 流式返回
    @GetMapping(value = "/stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public Flux<ServerSentEvent<User>> streamUsers() {
        return userRepository.findAll()
                .map(user -> ServerSentEvent.<User>builder()
                        .id(user.getId().toString())
                        .event("user")
                        .data(user)
                        .build());
    }
}
```

## 7. 限制与注意事项

| 限制 | 说明 |
| :-- | :-- |
| 无延迟加载 | R2DBC 没有 JPA 的懒加载，关联查询需手动处理 |
| 无二级缓存 | 没有 EntityManager 缓存机制 |
| 无 Schema 自动生成 | 需配合 Flyway/Liquibase 管理表结构 |
| 操作符限制 | 不能在响应式链中调用阻塞方法（JDBC、Thread.sleep） |

**最佳实践：**

1. **WebFlux + R2DBC 配套使用**——不要在 MVC 中用 R2DBC，也不要在 WebFlux 中用 JDBC
2. **避免阻塞操作**——响应式链中绝对不能调用阻塞 API
3. **合理使用背压**——大数据量查询用 `take()` 限制，防止内存溢出
4. **事务范围最小化**——响应式事务只包含必要的数据库操作
5. **连接池调优**——R2DBC 连接池大小通常比 JDBC 小得多（5-20 vs 50-100）
