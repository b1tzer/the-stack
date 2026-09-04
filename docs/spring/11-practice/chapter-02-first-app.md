# 第一个 Spring Boot 应用

> 从零创建一个 Spring Boot REST API 项目。

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
