# 集成测试

> 单元测试验证了逻辑正确，但组件之间组装起来能不能跑通？需要集成测试来验证。

---

## 1. @SpringBootTest 配置详解

### 1.1 webEnvironment 选项

```java
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class UserControllerIntegrationTest {

    @Autowired
    private TestRestTemplate restTemplate;

    @Test
    @DisplayName("创建用户 - 应该返回 201")
    void shouldCreateUser() {
        UserRequest request = new UserRequest("alice", "alice@email.com");
        ResponseEntity<UserResponse> response = restTemplate.postForEntity(
                "/api/users", request, UserResponse.class);

        assertEquals(HttpStatus.CREATED, response.getStatusCode());
        assertEquals("alice", response.getBody().getUsername());
    }
}
```

`webEnvironment` 选项：

| 选项 | 说明 | 适用场景 |
| :-- | :-- | :-- |
| `MOCK` | Mock Servlet 环境（默认） | 不启动真实服务器 |
| `RANDOM_PORT` | 启动真实服务器，随机端口 | 需要真实 HTTP 调用 |
| `DEFINED_PORT` | 使用配置的端口 | 特定端口需求 |
| `NONE` | 不启动 Web 环境 | 非 Web 应用 |

> **踩坑提醒**：`RANDOM_PORT` 会启动真实的嵌入式服务器，比 `MOCK` 慢很多。如果只是测试 Controller 逻辑，用 `@WebMvcTest` + `MockMvc` 更快。

### 1.2 配合 Testcontainers

```java
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@Testcontainers
class UserControllerIntegrationTest {

    @Container
    static MySQLContainer<?> mysql = new MySQLContainer<>("mysql:8.0")
            .withDatabaseName("testdb")
            .withUsername("test")
            .withPassword("test");

    @DynamicPropertySource
    static void configureProperties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", mysql::getJdbcUrl);
        registry.add("spring.datasource.username", mysql::getUsername);
        registry.add("spring.datasource.password", mysql::getPassword);
    }

    @Autowired
    private TestRestTemplate restTemplate;

    @Test
    void shouldCreateUser() {
        UserRequest request = new UserRequest("alice", "alice@email.com");
        ResponseEntity<UserResponse> response = restTemplate.postForEntity(
                "/api/users", request, UserResponse.class);
        assertEquals(HttpStatus.CREATED, response.getStatusCode());
    }
}
```

### 1.3 自定义测试配置

```java
// 自定义测试配置
@SpringBootTest
@TestPropertySource(properties = {
    "spring.datasource.url=jdbc:h2:mem:testdb",
    "logging.level.com.example=DEBUG"
})
class CustomPropertyTest {
    // ...
}

// 测试随机端口
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class RandomPortTest {

    @LocalServerPort
    private int port;

    @Autowired
    private TestRestTemplate restTemplate;

    @Test
    void testHello() {
        ResponseEntity<String> response = restTemplate
            .getForEntity("http://localhost:" + port + "/api/hello", String.class);
        assertEquals(200, response.getStatusCode().value());
    }
}
```

---

## 2. MockMvc 完整实战

MockMvc 在模拟的 Servlet 环境中测试 Controller：

### 2.1 GET 请求

```java
@WebMvcTest(UserController.class)
class UserControllerMockMvcTest {

    @Autowired
    private MockMvc mockMvc;

    @MockBean
    private UserService userService;

    @Test
    @DisplayName("GET /api/users/1 - 应该返回用户")
    void shouldGetUser() throws Exception {
        User user = new User(1L, "alice", "alice@email.com");
        when(userService.findById(1L)).thenReturn(user);

        mockMvc.perform(get("/api/users/1")
                        .contentType(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value(1))
                .andExpect(jsonPath("$.username").value("alice"))
                .andExpect(jsonPath("$.email").value("alice@email.com"));
    }

    // 验证分页请求
    @Test
    @DisplayName("GET /api/users - 应该返回分页 Header")
    void shouldReturnPaginationHeaders() throws Exception {
        when(userService.findAll(any(Pageable.class)))
                .thenReturn(new PageImpl<>(List.of(new User())));

        mockMvc.perform(get("/api/users")
                        .param("page", "0")
                        .param("size", "10"))
                .andExpect(status().isOk())
                .andExpect(header().exists("X-Total-Count"));
    }
}
```

### 2.2 POST 请求

```java
@Test
@DisplayName("POST /api/users - 应该创建用户")
void shouldCreateUser() throws Exception {
    UserRequest request = new UserRequest("bob", "bob@email.com");
    User created = new User(2L, "bob", "bob@email.com");
    when(userService.create(any(UserRequest.class))).thenReturn(created);

    mockMvc.perform(post("/api/users")
                    .contentType(MediaType.APPLICATION_JSON)
                    .content(objectMapper.writeValueAsString(request)))
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.id").value(2))
            .andExpect(jsonPath("$.username").value("bob"));
}
```

### 2.3 PUT 请求

```java
@Test
@DisplayName("PUT /api/users/1 - 应该更新用户")
void shouldUpdateUser() throws Exception {
    UserRequest request = new UserRequest("alice_updated", "alice_new@email.com");
    User updated = new User(1L, "alice_updated", "alice_new@email.com");
    when(userService.update(eq(1L), any(UserRequest.class))).thenReturn(updated);

    mockMvc.perform(put("/api/users/1")
                    .contentType(MediaType.APPLICATION_JSON)
                    .content(objectMapper.writeValueAsString(request)))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.username").value("alice_updated"));
}
```

### 2.4 DELETE 请求

```java
@Test
@DisplayName("DELETE /api/users/1 - 应该返回 204")
void shouldDeleteUser() throws Exception {
    doNothing().when(userService).delete(1L);

    mockMvc.perform(delete("/api/users/1"))
            .andExpect(status().isNoContent());
}
```

### 2.5 验证异常处理

```java
@Test
@DisplayName("GET /api/users/999 - 应该返回 404")
void shouldReturn404WhenNotFound() throws Exception {
    when(userService.findById(999L)).thenThrow(new UserNotFoundException(999L));

    mockMvc.perform(get("/api/users/999"))
            .andExpect(status().isNotFound())
            .andExpect(jsonPath("$.message").value("用户不存在"));
}

@Test
@DisplayName("POST /api/users - 参数校验失败返回 400")
void shouldReturn400WhenValidationFails() throws Exception {
    String json = "{\"name\":\"\", \"email\":\"invalid\"}";

    mockMvc.perform(post("/api/users")
                    .contentType(MediaType.APPLICATION_JSON)
                    .content(json))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"))
            .andExpect(jsonPath("$.details").isArray());
}
```

### 2.6 MockMvc 常用断言

| 断言 | 验证内容 |
| :-- | :-- |
| `status().isOk()` | 状态码 200 |
| `status().isCreated()` | 状态码 201 |
| `status().isBadRequest()` | 状态码 400 |
| `status().isNotFound()` | 状态码 404 |
| `jsonPath("$.field").value(x)` | JSON 字段值 |
| `jsonPath("$.list").isArray()` | JSON 数组 |
| `header().exists("X-Token")` | Header 存在 |
| `header().string("X-Token", "abc")` | Header 值 |
| `content().json("{...}")` | 完整 JSON |
| `content().string("hello")` | 响应体字符串 |

> **踩坑提醒**：`@WebMvcTest` 只加载 Controller 层的 Bean，Service、Repository 等不会被加载。如果 Controller 直接注入了 Repository（没有 Service 层），需要用 `@MockBean` Mock 掉。

---

## 3. 测试切片（Test Slice）

测试切片只加载你需要的那部分组件，比 `@SpringBootTest` 快得多。

### 3.1 @WebMvcTest —— Web 层

```java
@WebMvcTest(UserController.class)  // 只加载 Web 层
class UserControllerSliceTest {
    @Autowired private MockMvc mockMvc;
    @MockBean private UserService userService;

    @Test
    void shouldGetUser() throws Exception {
        when(userService.findById(1L)).thenReturn(new User(1L, "alice", "a@b.com"));
        mockMvc.perform(get("/api/users/1"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.username").value("alice"));
    }
}
```

### 3.2 @DataJpaTest —— JPA 层

```java
@DataJpaTest  // 只加载 JPA 相关组件（Repository、DataSource、EntityManager）
class UserRepositorySliceTest {
    @Autowired
    private UserRepository userRepository;

    @Autowired
    private TestEntityManager entityManager;

    @Test
    @DisplayName("按用户名查询 - 应该返回用户")
    void shouldFindByUsername() {
        entityManager.persistAndFlush(new User(null, "alice", "a@b.com"));

        Optional<User> found = userRepository.findByUsername("alice");

        assertTrue(found.isPresent());
        assertEquals("alice", found.get().getUsername());
    }

    @Test
    @DisplayName("按邮箱查询 - 不存在时返回空")
    void shouldReturnEmptyForNonExistentEmail() {
        Optional<User> found = userRepository.findByEmail("nonexistent@email.com");
        assertTrue(found.isEmpty());
    }
}
```

### 3.3 @JsonTest —— JSON 序列化

```java
@JsonTest  // 只加载 JSON 序列化组件
class UserJsonTest {
    @Autowired
    private JacksonTester<User> json;

    @Test
    @DisplayName("序列化 User - 应该包含所有字段")
    void shouldSerialize() throws Exception {
        User user = new User(1L, "alice", "a@b.com");

        JsonContent<User> result = json.write(user);

        assertThat(result).extractingJsonPathNumberValue("$.id").isEqualTo(1);
        assertThat(result).extractingJsonPathStringValue("$.username").isEqualTo("alice");
        assertThat(result).extractingJsonPathStringValue("$.email").isEqualTo("a@b.com");
    }

    @Test
    @DisplayName("反序列化 JSON - 应该正确映射")
    void shouldDeserialize() throws Exception {
        String content = "{\"id\":1,\"username\":\"alice\",\"email\":\"a@b.com\"}";

        User user = json.parseObject(content);

        assertEquals(1L, user.getId());
        assertEquals("alice", user.getUsername());
    }
}
```

### 3.4 测试切片对比

| 切片注解 | 加载范围 | 启动速度 | 适用场景 |
| :-- | :-- | :-- | :-- |
| `@SpringBootTest` | 整个应用上下文 | 慢（5-15s） | 完整集成测试 |
| `@WebMvcTest` | Controller + Web 层 | 快（1-3s） | 测试 HTTP 接口 |
| `@DataJpaTest` | JPA + DataSource | 快（1-3s） | 测试 Repository |
| `@JsonTest` | JSON 序列化组件 | 极快（<1s） | 测试 JSON 转换 |
| `@RestClientTest` | RestTemplate/WebClient | 快 | 测试 HTTP 客户端 |
| `@WebFluxTest` | WebFlux Controller | 快 | 测试响应式接口 |

> **经验法则**：优先用测试切片，只在真正需要验证多组件协作时才用 `@SpringBootTest`。切片测试快 10 倍，反馈循环短得多。

---

## 4. 测试事务回滚

```java
@SpringBootTest
class OrderServiceTransactionTest {

    @Autowired
    private OrderService orderService;

    @Autowired
    private OrderRepository orderRepository;

    @Test
    @Transactional
    @Rollback  // 默认就是回滚
    void testCreateOrderShouldRollback() {
        Order order = orderService.createOrder(new OrderRequest(1L, BigDecimal.TEN));
        assertNotNull(order.getId());

        // 在事务中查询，数据是可见的
        assertTrue(orderRepository.findById(order.getId()).isPresent());
    }
    // 测试结束后事务回滚，数据库中不会有这条数据
}
```

---

## 5. 测试 REST 客户端

```java
@SpringBootTest
@AutoConfigureWireMock(port = 8089)
class UserClientIntegrationTest {

    @Autowired
    private UserClient userClient;

    @Test
    void testGetUser() {
        // 桩 WireMock 响应
        stubFor(get(urlEqualTo("/api/users/1"))
            .willReturn(aResponse()
                .withHeader("Content-Type", "application/json")
                .withBody("{\"id\":1,\"name\":\"张三\"}")));

        User user = userClient.getUser(1L);
        assertEquals("张三", user.getName());

        // 验证请求被发出
        verify(getRequestedFor(urlEqualTo("/api/users/1")));
    }
}
```

---

## 最佳实践

1. **切片测试优先**——`@WebMvcTest` 比 `@SpringBootTest` 快 10 倍
2. **`@DataJpaTest` 自动回滚**——测试数据不会污染数据库
3. **MockMvc 测试覆盖所有 HTTP 方法**——GET、POST、PUT、DELETE、PATCH
4. **WireMock 测试外部服务**——模拟第三方 API 的各种响应
5. **测试配置文件独立**——`application-test.yml` 不要和生产配置混用
