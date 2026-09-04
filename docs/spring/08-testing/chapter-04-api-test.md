# API 测试与契约测试

> MockMvc 的断言语法太啰嗦，一个接口测试写 20 行，可读性差。REST Assured 提供类 BDD 风格的 API 测试。

---

## 1. REST Assured

### 1.1 Maven 依赖

```xml
<dependency>
    <groupId>io.rest-assured</groupId>
    <artifactId>rest-assured</artifactId>
    <scope>test</scope>
</dependency>
```

### 1.2 基本用法

```java
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class UserApiTest {

    @LocalServerPort
    private int port;

    @BeforeEach
    void setUp() {
        RestAssured.baseURI = "http://localhost";
        RestAssured.port = port;
    }

    // GET 请求
    @Test
    @DisplayName("GET /api/users/1 - 应该返回用户详情")
    void shouldGetUser() {
        given()
            .contentType(ContentType.JSON)
        .when()
            .get("/api/users/1")
        .then()
            .statusCode(200)
            .body("username", equalTo("alice"))
            .body("email", equalTo("alice@email.com"))
            .body("id", notNullValue())
            .header("Content-Type", containsString("application/json"));
    }

    // POST 请求
    @Test
    @DisplayName("POST /api/users - 应该创建用户并返回 201")
    void shouldCreateUser() {
        String requestBody = "{\"username\":\"bob\",\"email\":\"bob@email.com\"}";

        given()
            .contentType(ContentType.JSON)
            .body(requestBody)
        .when()
            .post("/api/users")
        .then()
            .statusCode(201)
            .body("username", equalTo("bob"))
            .header("Location", containsString("/api/users/"));
    }

    // 验证错误响应
    @Test
    @DisplayName("GET /api/users/999 - 应该返回 404")
    void shouldReturn404() {
        given()
        .when()
            .get("/api/users/999")
        .then()
            .statusCode(404)
            .body("message", equalTo("用户不存在"))
            .body("timestamp", notNullValue());
    }
}
```

### 1.3 JSON Schema 验证

```java
@Test
@DisplayName("GET /api/users - 响应应该符合 Schema")
void shouldMatchSchema() {
    given()
    .when()
        .get("/api/users")
    .then()
        .statusCode(200)
        .body(matchesJsonSchemaInClasspath("schemas/user-list-schema.json"));
}
```

JSON Schema 文件（`src/test/resources/schemas/user-list-schema.json`）：

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "array",
  "items": {
    "type": "object",
    "required": ["id", "username", "email"],
    "properties": {
      "id": { "type": "number" },
      "username": { "type": "string", "minLength": 1 },
      "email": { "type": "string", "format": "email" }
    }
  }
}
```

### 1.4 响应时间与集合验证

```java
@Test
@DisplayName("GET /api/users - 响应时间应该小于 2 秒")
void shouldRespondWithin2Seconds() {
    given()
    .when()
        .get("/api/users")
    .then()
        .statusCode(200)
        .time(lessThan(2000L), TimeUnit.MILLISECONDS);
}

@Test
@DisplayName("GET /api/users - 应该返回用户列表")
void shouldReturnUserList() {
    given()
    .when()
        .get("/api/users")
    .then()
        .statusCode(200)
        .body("size()", greaterThan(0))
        .body("username", hasItems("alice", "bob"))
        .body("findAll { it.status == 'ACTIVE' }.size()", greaterThan(0));
}
```

### 1.5 REST Assured vs MockMvc 对比

| 维度 | REST Assured | MockMvc |
| :-- | :-- | :-- |
| 风格 | BDD（given/when/then） | 链式 API |
| 可读性 | ⭐⭐⭐⭐⭐ 接近自然语言 | ⭐⭐⭐ 较啰嗦 |
| 环境 | 需要真实/随机端口 | Mock Servlet |
| 速度 | 较慢（真实 HTTP） | 快（无网络） |
| 适用 | API 集成测试 | Controller 单元测试 |
| Schema 验证 | ✅ 原生支持 | ❌ 需手动 |
| 响应时间验证 | ✅ 原生支持 | ❌ 不支持 |

> **经验法则**：Controller 逻辑测试用 MockMvc（快），API 完整性测试用 REST Assured（可读性好、能测真实 HTTP）。

---

## 2. Spring Cloud Contract（概览）

### 2.1 核心思想

微服务 A 修改了接口返回值，微服务 B 不知道，上线后才发现接口不兼容。消费者驱动契约测试（CDC）解决这个问题。

**消费者定义期望的接口格式（契约），提供者验证自己满足所有消费者的契约**。

```groovy
// 消费者侧：定义契约（src/test/resources/contracts/shouldReturnUser.groovy）
Contract.make {
    description "should return user by id"
    request {
        method GET()
        url "/api/users/1"
        headers {
            contentType(applicationJson())
        }
    }
    response {
        status 200
        body([
            id: 1,
            username: "alice",
            email: "alice@email.com"
        ])
        headers {
            contentType(applicationJson())
        }
    }
}
```

### 2.2 工作流

```
┌─────────────┐    定义契约     ┌──────────────────┐
│   消费者      │──────────────►│  契约存入仓库      │
│  (Consumer)  │               │ (Git/Maven Repo) │
└─────────────┘               └────────┬─────────┘
                                       │
                                       ▼
┌─────────────┐    验证契约     ┌──────────────────┐
│   提供者      │◄──────────────│  自动生成 Stub 测试 │
│  (Provider)  │               │                  │
└─────────────┘               └──────────────────┘
```

### 2.3 Spring Cloud Contract vs 传统集成测试

| 特性 | Spring Cloud Contract | 传统集成测试 |
| :-- | :-- | :-- |
| 契约定义 | 消费者定义（Groovy/YAML） | 无明确契约 |
| 测试方向 | 消费者驱动 | 提供者自测 |
| 接口兼容性 | ✅ 自动验证 | ❌ 手动保证 |
| 微服务适配 | ✅ 原生支持 | 需要完整环境 |
| 学习成本 | 中高 | 低 |
| 适用场景 | 多团队微服务协作 | 单体/小团队 |

> **经验法则**：3 个以上微服务互相调用时引入 Spring Cloud Contract。小团队直接写集成测试更实际。CDC 的核心价值不是技术，而是**迫使团队在开发前对齐接口约定**。

---

## 本章总结

| 测试类型 | 工具/注解 | 速度 | 适用场景 |
| :-- | :-- | :-- | :-- |
| 单元测试 | JUnit 5 + Mockito | ⚡ 极快 | 业务逻辑验证 |
| 集成测试 | @SpringBootTest | 🐢 慢 | 多组件协作 |
| Web 测试 | @WebMvcTest + MockMvc | ⚡ 快 | Controller 层 |
| 数据库测试 | @DataJpaTest / Testcontainers | ⚡/🐢 | Repository 层 |
| API 测试 | REST Assured | 🐢 中等 | 接口完整性 |
| 契约测试 | Spring Cloud Contract | 🐢 中等 | 微服务兼容性 |

> **一句话总结**：单元测试保逻辑，切片测试提速度，集成测试验协作，Testcontainers 兜底真实性——分层测试，各司其职。
