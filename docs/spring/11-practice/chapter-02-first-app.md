# 第一个 Spring Boot 应用

> 从零创建一个 Spring Boot REST API 项目。
>
> **版本提示（2026-11）**：本页示例使用 Spring Boot 3.3.0。该版本已结束开源支持，`start.spring.io` 也不再提供 3.x 选项（当前默认为 4.1.2），第 1 节的生成命令会失败。页面尚未按当前版本重写，跟随前请先按目标版本调整 `bootVersion` 或改用其他章节，其余内容以官方文档为准。

## 1. 创建项目

```bash
curl https://start.spring.io/starter.zip \
  -d type=maven-project \
  -d language=java \
  -d bootVersion=3.3.0 \
  -d baseDir=demo \
  -d groupId=com.example \
  -d artifactId=demo \
  -d name=demo \
  -d dependencies=web,data-jpa,mysql,actuator \
  -o demo.zip

unzip demo.zip && cd demo
```

## 2. 项目结构

```txt
demo/
├── src/main/java/com/example/demo/
│   ├── DemoApplication.java
│   ├── controller/
│   ├── service/
│   ├── repository/
│   ├── entity/
│   └── config/
├── src/main/resources/
│   ├── application.yml
│   └── db/migration/
└── pom.xml
```

## 3. 编写 REST API

```java
// Entity
@Entity
@Table(name = "users")
public class User {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;
    private String name;
    private String email;
    // getters/setters
}

// Repository
public interface UserRepository extends JpaRepository<User, Long> {
    List<User> findByNameContaining(String name);
}

// Service
@Service
@Transactional
public class UserService {
    private final UserRepository repo;
    public UserService(UserRepository repo) { this.repo = repo; }

    public List<User> findAll() { return repo.findAll(); }
    public User save(User user) { return repo.save(user); }
}

// Controller
@RestController
@RequestMapping("/api/users")
public class UserController {
    private final UserService service;
    public UserController(UserService service) { this.service = service; }

    @GetMapping
    public List<User> list() { return service.findAll(); }

    @PostMapping
    public User create(@RequestBody User user) { return service.save(user); }
}
```

## 4. 配置

```yaml
# application.yml
spring:
  datasource:
    url: jdbc:mysql://localhost:3306/demo
    username: root
    password: root
  jpa:
    hibernate:
      ddl-auto: update
    show-sql: true

server:
  port: 8080
```

## 5. 运行

```bash
mvn spring-boot:run

# 测试
curl http://localhost:8080/api/users
curl -X POST http://localhost:8080/api/users \
  -H "Content-Type: application/json" \
  -d '{"name":"alice","email":"alice@example.com"}'
```
