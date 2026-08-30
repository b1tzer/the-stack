# 第 08 章：测试

> 不写测试的代码就像不系安全带开车——平时没事，出事就是大事。

---

## 8.1 测试策略

### 8.1.1 测试金字塔

**痛点**：项目赶进度，测试要么不写，要么全写成 E2E——跑一次要半小时，改一行代码全红。

测试金字塔是指导测试比例的经典模型：

```
        /\
       /  \        E2E 测试（5-10%）
      /    \       慢、脆弱、但覆盖面广
     /------\
    /        \     集成测试（15-25%）
   /          \    验证组件协作
  /------------\
 /              \  单元测试（70-80%）
/                \ 快、稳定、成本低
```

| 维度 | 单元测试 | 集成测试 | E2E 测试 |
|------|---------|---------|---------|
| 速度 | 毫秒级 | 秒级 | 分钟级 |
| 成本 | 极低 | 中等 | 高 |
| 覆盖范围 | 单个类/方法 | 多个组件协作 | 整个系统 |
| 维护成本 | 低 | 中 | 高（UI 变动就挂） |
| 定位问题 | 精确 | 较精确 | 模糊 |
| 依赖 | 无/少量 Mock | 真实组件/测试容器 | 完整环境 |
| 占比建议 | 70-80% | 15-25% | 5-10% |

> **经验法则**：先写单元测试保证核心逻辑正确，再用集成测试验证组件协作，最后用 E2E 测试覆盖关键业务流程。别反过来。

### 8.1.2 测试什么、不测什么

**痛点**：每个方法都写测试，代码量翻倍，维护成本爆炸，但覆盖率还是上不去。

不是所有代码都值得测试。关键是**投入产出比**。

**值得测试的**：

```java
// ✅ 业务逻辑（核心价值）
public BigDecimal calculateDiscount(BigDecimal price, int level) {
    if (level >= 3) return price.multiply(BigDecimal.valueOf(0.8));
    if (level >= 1) return price.multiply(BigDecimal.valueOf(0.95));
    return price;
}

// ✅ 边界条件（最容易出 Bug）
public void transfer(Long from, Long to, BigDecimal amount) {
    if (amount.compareTo(BigDecimal.ZERO) <= 0) {
        throw new IllegalArgumentException("转账金额必须大于 0");
    }
    if (from.equals(to)) {
        throw new IllegalArgumentException("不能给自己转账");
    }
    // ...
}

// ✅ 异常路径（不测就埋雷）
public Order getOrder(Long id) {
    return orderRepository.findById(id)
            .orElseThrow(() -> new OrderNotFoundException(id));
}
```

**不值得测试的**：

```java
// ❌ 纯 getter/setter（没有逻辑）
public class User {
    private String name;
    public String getName() { return name; }
    public void setName(String name) { this.name = name; }
}

// ❌ 框架代码（Spring 已经测过了）
@Repository
public interface UserRepository extends JpaRepository<User, Long> {
    // 不需要测试 findById 是否能查到数据
}

// ❌ 简单的委托调用
public void save(User user) {
    userRepository.save(user);  // 直接委托，没有逻辑
}
```

测试决策表：

| 代码类型 | 测不测 | 理由 |
|---------|--------|------|
| 复杂业务逻辑 | ✅ 必测 | 核心价值，出错代价大 |
| 边界条件/异常处理 | ✅ 必测 | Bug 高发区 |
| 算法/计算 | ✅ 必测 | 结果可验证 |
| Getter/Setter | ❌ 不测 | 没有逻辑 |
| 框架代码 | ❌ 不测 | 框架自己负责 |
| 简单委托调用 | ❌ 不测 | 没有价值 |
| 第三方库调用 | ❌ 不测 | 信任库的质量 |

> **经验法则**：问自己——"如果这段代码改坏了，我能发现吗？"如果答案是"能靠肉眼发现"，就不需要测试。如果答案是"可能要上线才知道"，就必须测。

### 8.1.3 Mock vs Stub vs Spy

**痛点**：测试 Service 层要依赖数据库、外部 API，跑一次测试要连真实环境，又慢又不稳定。

测试替身（Test Double）让你隔离依赖，只测目标代码：

```java
// Stub（桩）—— 返回固定值，不关心调用过程
public class StubUserService implements UserService {
    @Override
    public User findById(Long id) {
        return new User(id, "testUser", "test@email.com");  // 永远返回这个
    }
}

// Mock（模拟）—— 验证调用行为
@Test
void shouldCallRepositoryWhenFindById() {
    UserRepository mockRepo = mock(UserRepository.class);
    when(mockRepo.findById(1L)).thenReturn(Optional.of(new User(1L, "test", "test@email.com")));

    UserService service = new UserServiceImpl(mockRepo);
    service.findById(1L);

    verify(mockRepo).findById(1L);  // 验证方法是否被调用
}

// Spy（间谍）—— 包装真实对象，可以部分 Mock
@Test
void shouldSpyOnRealObject() {
    List<String> realList = new ArrayList<>();
    List<String> spyList = spy(realList);

    spyList.add("test");
    spyList.add("hello");

    verify(spyList).add("test");      // 验证调用
    assertEquals(2, spyList.size());   // 真实行为
    doReturn("mocked").when(spyList).get(0);  // 部分 Mock
    assertEquals("mocked", spyList.get(0));
}
```

三种替身对比：

| 类型 | 行为来源 | 是否验证调用 | 适用场景 |
|------|---------|-------------|---------|
| Stub | 预设固定返回值 | ❌ 不验证 | 只需要返回值 |
| Mock | 预设返回值 + 验证调用 | ✅ 验证交互 | 需要验证方法是否被调用 |
| Spy | 真实行为 + 可部分覆盖 | ✅ 可验证 | 只想 Mock 部分方法 |

> **经验法则**：优先用 Mock（Mockito），只在必须保留真实行为时用 Spy。Stub 太简单，Mock 能做 Stub 能做的一切。

---

## 8.2 单元测试

### 8.2.1 JUnit 5 核心

**痛点**：测试类写了一堆 `@Test` 方法，但不知道在测什么，出了 Bug 也看不懂哪个用例失败了。

JUnit 5 是 Java 测试的事实标准：

```java
import org.junit.jupiter.api.*;

import static org.junit.jupiter.api.Assertions.*;

@DisplayName("用户服务测试")  // 类级别显示名
class UserServiceTest {

    private UserService userService;

    @BeforeEach  // 每个测试方法前执行
    void setUp() {
        System.out.println("初始化测试环境...");
        userService = new UserService();
    }

    @AfterEach  // 每个测试方法后执行
    void tearDown() {
        System.out.println("清理测试环境...");
    }

    @BeforeAll  // 所有测试前执行一次（static）
    static void beforeAll() {
        System.out.println("整个测试类开始...");
    }

    @AfterAll  // 所有测试后执行一次（static）
    static void afterAll() {
        System.out.println("整个测试类结束...");
    }

    @Test
    @DisplayName("正常注册 - 应该成功")
    void shouldRegisterSuccessfully() {
        User user = userService.register("alice", "alice@email.com");
        assertNotNull(user);
        assertEquals("alice", user.getUsername());
    }

    @Test
    @DisplayName("用户名为空 - 应该抛异常")
    void shouldThrowWhenUsernameIsBlank() {
        assertThrows(IllegalArgumentException.class, () -> {
            userService.register("", "alice@email.com");
        });
    }

    @Test
    @DisplayName("参数化测试 - 多种输入验证")
    @ParameterizedTest(name = "用户名 \"{0}\" 应该是 {1}")
    @ValueSource(strings = {"alice", "bob", "charlie"})
    void shouldBeValidUsername(String username) {
        assertTrue(username.length() >= 3);
    }

    @ParameterizedTest(name = "{0} + {1} = {2}")
    @CsvSource({
        "1, 2, 3",
        "10, 20, 30",
        "0, 0, 0"
    })
    void shouldAddCorrectly(int a, int b, int expected) {
        assertEquals(expected, a + b);
    }

    @Test
    @Disabled("暂未实现")  // 跳过此测试
    void notYetImplemented() {
        // ...
    }
}
```

JUnit 5 常用注解速查：

| 注解 | 作用 | 执行时机 |
|------|------|---------|
| `@Test` | 标记测试方法 | — |
| `@BeforeEach` | 每个测试前执行 | 每个 @Test 前 |
| `@AfterEach` | 每个测试后执行 | 每个 @Test 后 |
| `@BeforeAll` | 所有测试前执行（static） | 整个类开始时 |
| `@AfterAll` | 所有测试后执行（static） | 整个类结束时 |
| `@DisplayName` | 自定义显示名 | — |
| `@ParameterizedTest` | 参数化测试 | — |
| `@Disabled` | 跳过测试 | — |
| `@Nested` | 嵌套测试类 | — |
| `@Tag` | 分组标签 | — |

> **踩坑提醒**：`@BeforeAll` 和 `@AfterAll` 方法必须是 `static`。非 static 会编译报错。

### 8.2.2 Mockito 实战

**痛点**：Service 依赖 Repository、外部 API、消息队列……跑个测试要把整套环境都起来，太重了。

Mockito 让你轻松隔离依赖：

```java
// 方式一：注解模式（推荐）
@ExtendWith(MockitoExtension.class)
class OrderServiceTest {

    @Mock  // 创建 Mock 对象
    private OrderRepository orderRepository;

    @Mock
    private PaymentClient paymentClient;

    @InjectMocks  // 自动注入 Mock 到目标对象
    private OrderService orderService;

    @Test
    void shouldCreateOrderSuccessfully() {
        // Arrange（准备）
        Order order = new Order(1L, "alice", BigDecimal.valueOf(100));
        when(orderRepository.save(any(Order.class))).thenReturn(order);
        when(paymentClient.charge(any())).thenReturn(new PaymentResult(true));

        // Act（执行）
        Order result = orderService.createOrder("alice", BigDecimal.valueOf(100));

        // Assert（验证）
        assertNotNull(result);
        assertEquals("alice", result.getUsername());
        verify(orderRepository).save(any(Order.class));  // 验证 save 被调用
        verify(paymentClient).charge(any());             // 验证支付被调用
        verifyNoMoreInteractions(orderRepository);       // 没有其他调用
    }

    @Test
    void shouldThrowWhenPaymentFails() {
        when(orderRepository.save(any())).thenReturn(new Order());
        when(paymentClient.charge(any())).thenReturn(new PaymentResult(false));

        assertThrows(PaymentException.class, () -> {
            orderService.createOrder("alice", BigDecimal.valueOf(100));
        });
    }
}

// 方式二：手动创建（适合简单场景）
@Test
void manualMock() {
    OrderRepository mockRepo = mock(OrderRepository.class);
    when(mockRepo.findById(1L)).thenReturn(Optional.of(new Order(1L)));

    OrderService service = new OrderService(mockRepo);
    Order order = service.findById(1L);

    assertEquals(1L, order.getId());
}
```

Mockito 常用 API：

| API | 作用 | 示例 |
|-----|------|------|
| `when().thenReturn()` | 设置返回值 | `when(repo.findById(1L)).thenReturn(...)` |
| `when().thenThrow()` | 设置抛异常 | `when(repo.save(null)).thenThrow(...)` |
| `verify()` | 验证方法被调用 | `verify(repo).save(any())` |
| `verify(times(2))` | 验证调用次数 | `verify(repo, times(2)).save(any())` |
| `verifyNever()` | 验证未被调用 | `verify(repo, never()).delete(any())` |
| `any()` | 匹配任意参数 | `when(repo.save(any())).thenReturn(...)` |
| `eq()` | 精确匹配参数 | `when(repo.findById(eq(1L))).thenReturn(...)` |
| `ArgumentCaptor` | 捕获参数 | 见下文 |

**ArgumentCaptor 捕获参数**：

```java
@Test
void shouldCaptureSavedOrder() {
    ArgumentCaptor<Order> captor = ArgumentCaptor.forClass(Order.class);
    when(orderRepository.save(captor.capture())).thenReturn(new Order());

    orderService.createOrder("alice", BigDecimal.valueOf(100));

    Order captured = captor.getValue();
    assertEquals("alice", captured.getUsername());
    assertEquals(0, BigDecimal.valueOf(100).compareTo(captured.getAmount()));
}
```

> **踩坑提醒**：Mockito 不能 Mock `final` 类、`private` 方法、`static` 方法（除非用 mockito-inline 或 PowerMock）。遇到这些场景，考虑重构代码或用 Spy。

### 8.2.3 测试 Service 层

**痛点**：只测了"正常路径"，上线后各种边界情况炸了——空指针、并发重复、余额不足……

一个完整的 Service 测试应该覆盖四种路径：

```java
@ExtendWith(MockitoExtension.class)
class TransferServiceTest {

    @Mock
    private AccountRepository accountRepository;

    @Mock
    private TransactionRepository transactionRepository;

    @InjectMocks
    private TransferService transferService;

    // ① 正常路径
    @Test
    @DisplayName("正常转账 - 余额充足")
    void shouldTransferSuccessfully() {
        Account from = new Account(1L, BigDecimal.valueOf(1000));
        Account to = new Account(2L, BigDecimal.valueOf(500));
        when(accountRepository.findById(1L)).thenReturn(Optional.of(from));
        when(accountRepository.findById(2L)).thenReturn(Optional.of(to));

        transferService.transfer(1L, 2L, BigDecimal.valueOf(200));

        assertEquals(0, BigDecimal.valueOf(800).compareTo(from.getBalance()));
        assertEquals(0, BigDecimal.valueOf(700).compareTo(to.getBalance()));
        verify(transactionRepository).save(any(Transaction.class));
    }

    // ② 边界条件
    @Test
    @DisplayName("转账金额为 0 - 应该拒绝")
    void shouldRejectZeroAmount() {
        assertThrows(IllegalArgumentException.class, () -> {
            transferService.transfer(1L, 2L, BigDecimal.ZERO);
        });
    }

    @Test
    @DisplayName("转账给自己 - 应该拒绝")
    void shouldRejectSelfTransfer() {
        assertThrows(IllegalArgumentException.class, () -> {
            transferService.transfer(1L, 1L, BigDecimal.valueOf(100));
        });
    }

    // ③ 异常路径
    @Test
    @DisplayName("余额不足 - 应该抛异常")
    void shouldThrowWhenInsufficientBalance() {
        Account from = new Account(1L, BigDecimal.valueOf(100));
        Account to = new Account(2L, BigDecimal.valueOf(500));
        when(accountRepository.findById(1L)).thenReturn(Optional.of(from));
        when(accountRepository.findById(2L)).thenReturn(Optional.of(to));

        assertThrows(InsufficientBalanceException.class, () -> {
            transferService.transfer(1L, 2L, BigDecimal.valueOf(200));
        });
    }

    @Test
    @DisplayName("账户不存在 - 应该抛异常")
    void shouldThrowWhenAccountNotFound() {
        when(accountRepository.findById(999L)).thenReturn(Optional.empty());

        assertThrows(AccountNotFoundException.class, () -> {
            transferService.transfer(999L, 2L, BigDecimal.valueOf(100));
        });
    }

    // ④ 依赖交互验证
    @Test
    @DisplayName("转账成功 - 应该记录交易日志")
    void shouldLogTransaction() {
        Account from = new Account(1L, BigDecimal.valueOf(1000));
        Account to = new Account(2L, BigDecimal.valueOf(500));
        when(accountRepository.findById(1L)).thenReturn(Optional.of(from));
        when(accountRepository.findById(2L)).thenReturn(Optional.of(to));

        transferService.transfer(1L, 2L, BigDecimal.valueOf(200));

        ArgumentCaptor<Transaction> captor = ArgumentCaptor.forClass(Transaction.class);
        verify(transactionRepository).save(captor.capture());
        Transaction tx = captor.getValue();
        assertEquals(1L, tx.getFromAccountId());
        assertEquals(2L, tx.getToAccountId());
        assertEquals(0, BigDecimal.valueOf(200).compareTo(tx.getAmount()));
    }
}
```

测试覆盖矩阵：

| 路径 | 测什么 | 为什么重要 |
|------|--------|-----------|
| 正常路径 | 业务流程正确性 | 基本功能保障 |
| 边界条件 | 0、负数、空值、最大值 | Bug 高发区 |
| 异常路径 | 异常是否正确抛出 | 系统健壮性 |
| 交互验证 | 依赖是否被正确调用 | 集成正确性 |

> **经验法则**：每个 Service 方法至少写 3 个测试——一个正常路径、一个边界条件、一个异常路径。复杂的加交互验证。

---

## 8.3 集成测试

### 8.3.1 @SpringBootTest 配置

**痛点**：单元测试验证了逻辑正确，但组件之间组装起来能不能跑通？需要集成测试来验证。

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
|------|------|---------|
| `MOCK` | Mock Servlet 环境（默认） | 不启动真实服务器 |
| `RANDOM_PORT` | 启动真实服务器，随机端口 | 需要真实 HTTP 调用 |
| `DEFINED_PORT` | 使用配置的端口 | 特定端口需求 |
| `NONE` | 不启动 Web 环境 | 非 Web 应用 |

> **踩坑提醒**：`RANDOM_PORT` 会启动真实的嵌入式服务器，比 `MOCK` 慢很多。如果只是测试 Controller 逻辑，用 `@WebMvcTest` + `MockMvc` 更快。

### 8.3.2 MockMvc 实战

**痛点**：想测试 HTTP 接口，但不想启动真实的服务器，又想验证请求和响应的每个细节。

MockMvc 在模拟的 Servlet 环境中测试 Controller：

```java
@WebMvcTest(UserController.class)  // 只加载 UserController 相关的组件
class UserControllerMockMvcTest {

    @Autowired
    private MockMvc mockMvc;

    @MockBean  // Mock 掉 Controller 依赖的 Service
    private UserService userService;

    // GET 请求
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

    // POST 请求
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

    // PUT 请求
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

    // DELETE 请求
    @Test
    @DisplayName("DELETE /api/users/1 - 应该返回 204")
    void shouldDeleteUser() throws Exception {
        doNothing().when(userService).delete(1L);

        mockMvc.perform(delete("/api/users/1"))
                .andExpect(status().isNoContent());
    }

    // 验证 Header
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

    // 验证异常处理
    @Test
    @DisplayName("GET /api/users/999 - 应该返回 404")
    void shouldReturn404WhenNotFound() throws Exception {
        when(userService.findById(999L)).thenThrow(new UserNotFoundException(999L));

        mockMvc.perform(get("/api/users/999"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.message").value("用户不存在"));
    }
}
```

MockMvc 常用断言：

| 断言 | 验证内容 |
|------|---------|
| `status().isOk()` | 状态码 200 |
| `status().isCreated()` | 状态码 201 |
| `status().isBadRequest()` | 状态码 400 |
| `jsonPath("$.field").value(x)` | JSON 字段值 |
| `jsonPath("$.list").isArray()` | JSON 数组 |
| `header().exists("X-Token")` | Header 存在 |
| `header().string("X-Token", "abc")` | Header 值 |
| `content().json("{...}")` | 完整 JSON |
| `content().string("hello")` | 响应体字符串 |

> **踩坑提醒**：`@WebMvcTest` 只加载 Controller 层的 Bean，Service、Repository 等不会被加载。如果 Controller 直接注入了 Repository（没有 Service 层），需要用 `@MockBean` Mock 掉。

### 8.3.3 测试切片

**痛点**：`@SpringBootTest` 加载整个应用上下文，跑一个测试要 10 秒，只想测个 Controller 有必要这么重吗？

测试切片（Test Slice）只加载你需要的那部分组件：

```java
// @WebMvcTest —— 只加载 Web 层（Controller、Filter、ControllerAdvice）
@WebMvcTest(UserController.class)
class UserControllerSliceTest {
    @Autowired private MockMvc mockMvc;
    @MockBean private UserService userService;  // 手动 Mock

    @Test
    void testControllerOnly() throws Exception {
        when(userService.findById(1L)).thenReturn(new User(1L, "alice", "a@b.com"));
        mockMvc.perform(get("/api/users/1"))
                .andExpect(status().isOk());
    }
}

// @DataJpaTest —— 只加载 JPA 相关组件（Repository、DataSource、EntityManager）
@DataJpaTest
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
}

// @JsonTest —— 只加载 JSON 序列化组件
@JsonTest
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

测试切片对比：

| 切片注解 | 加载范围 | 启动速度 | 适用场景 |
|---------|---------|---------|--------|
| `@SpringBootTest` | 整个应用上下文 | 慢（5-15s） | 完整集成测试 |
| `@WebMvcTest` | Controller + Web 层 | 快（1-3s） | 测试 HTTP 接口 |
| `@DataJpaTest` | JPA + DataSource | 快（1-3s） | 测试 Repository |
| `@JsonTest` | JSON 序列化组件 | 极快（<1s） | 测试 JSON 转换 |
| `@RestClientTest` | RestTemplate/WebClient | 快 | 测试 HTTP 客户端 |
| `@WebFluxTest` | WebFlux Controller | 快 | 测试响应式接口 |

> **经验法则**：优先用测试切片，只在真正需要验证多组件协作时才用 `@SpringBootTest`。切片测试快 10 倍，反馈循环短得多。

---

## 8.4 数据库测试

### 8.4.1 @DataJpaTest 与嵌入式数据库

**痛点**：想测试 Repository 层的查询方法，但跑测试要连真实数据库，CI 环境没有数据库怎么办？

`@DataJpaTest` 默认使用内存数据库（H2），自动回滚事务：

```java
@DataJpaTest  // 自动配置 H2 内存数据库 + 事务回滚
class UserRepositoryTest {

    @Autowired
    private UserRepository userRepository;

    @Autowired
    private TestEntityManager entityManager;

    @BeforeEach
    void setUp() {
        // 使用 @Sql 初始化数据
    }

    @Test
    @DisplayName("按用户名查询 - 应该返回用户")
    void shouldFindByUsername() {
        // TestEntityManager 直接操作数据库
        User saved = entityManager.persistAndFlush(new User(null, "alice", "a@b.com"));

        Optional<User> found = userRepository.findByUsername("alice");

        assertTrue(found.isPresent());
        assertEquals(saved.getId(), found.get().getId());
    }

    @Test
    @DisplayName("按邮箱查询 - 不存在时返回空")
    void shouldReturnEmptyForNonExistentEmail() {
        Optional<User> found = userRepository.findByEmail("nonexistent@email.com");

        assertTrue(found.isEmpty());
    }

    // 使用 @Sql 注入测试数据
    @Test
    @Sql(scripts = "/test-data/users.sql")
    @DisplayName("查询活跃用户 - 应该过滤非活跃")
    void shouldFindActiveUsers() {
        List<User> activeUsers = userRepository.findByStatus("ACTIVE");

        assertFalse(activeUsers.isEmpty());
        activeUsers.forEach(u -> assertEquals("ACTIVE", u.getStatus()));
    }
}
```

测试数据初始化 SQL（`src/test/resources/test-data/users.sql`）：

```sql
INSERT INTO users (username, email, status) VALUES ('alice', 'alice@test.com', 'ACTIVE');
INSERT INTO users (username, email, status) VALUES ('bob', 'bob@test.com', 'INACTIVE');
INSERT INTO users (username, email, status) VALUES ('charlie', 'charlie@test.com', 'ACTIVE');
```

`@Sql` 注解配置：

```java
// 基本用法
@Sql("/test-data/init.sql")

// 多个脚本
@SqlGroup({
    @Sql(value = "/schema.sql", executionPhase = Sql.ExecutionPhase.BEFORE_TEST_METHOD),
    @Sql(value = "/cleanup.sql", executionPhase = Sql.ExecutionPhase.AFTER_TEST_METHOD)
})

// 用类级别注解，所有方法都生效
@DataJpaTest
@Sql("/test-data/base-data.sql")
class OrderRepositoryTest {
    // ... 所有测试方法都会先执行 base-data.sql
}
```

> **踩坑提醒**：H2 的 SQL 方言和 MySQL 不完全兼容。`AUTO_INCREMENT`、`JSON` 类型、`GROUP_CONCAT` 等函数在 H2 中语法不同。如果项目用了 MySQL 特有语法，考虑用 Testcontainers。

### 8.4.2 Testcontainers

**痛点**：H2 和 MySQL 的行为差异让测试通过但生产报错，比如 `GROUP_CONCAT` 分隔符默认不同、`JSON` 类型支持不同。

Testcontainers 在测试时启动真实的 Docker 容器：

```java
// 1. 依赖
// testcontainers: mysql, junit-jupiter

@SpringBootTest
class UserRepositoryContainerTest {

    @Container
    static MySQLContainer<?> mysql = new MySQLContainer<>("mysql:8.0")
            .withDatabaseName("testdb")
            .withUsername("test")
            .withPassword("test")
            .withInitScript("schema.sql");  // 启动时执行建表脚本

    @DynamicPropertySource
    static void configureProperties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", mysql::getJdbcUrl);
        registry.add("spring.datasource.username", mysql::getUsername);
        registry.add("spring.datasource.password", mysql::getPassword);
    }

    @Autowired
    private UserRepository userRepository;

    @Test
    @DisplayName("原生 JSON 查询 - 在真实 MySQL 上测试")
    void shouldQueryByJsonField() {
        User user = new User();
        user.setUsername("alice");
        user.setMetadata("{\"level\": 3, \"vip\": true}");
        userRepository.save(user);

        // 这个查询用了 MySQL 的 JSON 函数，H2 不支持
        List<User> result = userRepository.findByMetadataLevel(3);
        assertFalse(result.isEmpty());
    }
}
```

Testcontainers 支持多种容器：

```java
// Redis
@Container
static GenericContainer<?> redis = new GenericContainer<>("redis:7")
        .withExposedPorts(6379);

// PostgreSQL
@Container
static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:16")
        .withDatabaseName("testdb");

// MongoDB
@Container
static MongoDBContainer mongo = new MongoDBContainer("mongo:7");

// Kafka
@Container
static KafkaContainer kafka = new KafkaContainer(
        DockerImageName.parse("confluentinc/cp-kafka:7.5.0"));
```

H2 vs Testcontainers 对比：

| 维度 | H2 内存数据库 | Testcontainers |
|------|-------------|----------------|
| 启动速度 | 极快（毫秒） | 慢（5-30 秒） |
| 方言兼容 | ❌ 不完全兼容 | ✅ 完全一致 |
| CI 依赖 | 无 | 需要 Docker |
| 测试可信度 | 中（可能误通过） | 高（和生产一致） |
| 适用场景 | 简单 CRUD | 复杂 SQL、JSON、存储过程 |

> **经验法则**：简单项目用 H2 够了。如果用了 MySQL/PostgreSQL 特有功能（JSON 类型、全文索引、存储过程），必须用 Testcontainers。

### 8.4.3 测试数据管理

**痛点**：测试之间数据互相污染，测试 A 插入的数据影响了测试 B 的结果，测试顺序不同结果不同。

三种测试数据管理策略：

```java
// 策略一：@Transactional + 自动回滚（最常用）
@DataJpaTest
class UserRepositoryTest {

    @Autowired
    private UserRepository userRepository;

    @Test
    @Transactional  // 测试结束后自动回滚，不会污染其他测试
    void shouldSaveAndRollback() {
        userRepository.save(new User(null, "alice", "a@b.com"));
        assertEquals(1, userRepository.count());
        // 方法结束后事务回滚，数据库恢复原状
    }

    @Test
    @Transactional
    @Rollback(false)  // 特殊情况：不回滚（调试用）
    void shouldPersistPermanently() {
        userRepository.save(new User(null, "bob", "b@b.com"));
    }
}

// 策略二：@Sql 复杂数据场景
@DataJpaTest
class OrderQueryTest {

    @Test
    @SqlGroup({
        @Sql(value = "/test-data/users.sql", executionPhase = BEFORE_TEST_METHOD),
        @Sql(value = "/test-data/products.sql", executionPhase = BEFORE_TEST_METHOD),
        @Sql(value = "/test-data/orders.sql", executionPhase = BEFORE_TEST_METHOD),
        @Sql(value = "/test-data/cleanup.sql", executionPhase = AFTER_TEST_METHOD)
    })
    void shouldQueryComplexOrders() {
        // users.sql + products.sql + orders.sql 都已执行
        List<Order> orders = orderRepository.findByDateRange(...);
        assertFalse(orders.isEmpty());
    }
}

// 策略三：@SqlConfig 控制行为
@Sql(
    scripts = "/test-data/init.sql",
    config = @SqlConfig(
        encoding = "UTF-8",
        separator = ";",
        transactionMode = SqlConfig.TransactionMode.ISOLATED  // 独立事务执行
    )
)
```

三种策略对比：

| 策略 | 优点 | 缺点 | 适用场景 |
|------|------|------|--------|
| `@Transactional` 自动回滚 | 简单，无副作用 | 无法测试事务行为 | 简单 CRUD 测试 |
| `@Sql` 脚本 | 可复用，数据可控 | SQL 文件多，维护成本 | 复杂查询、报表 |
| `@SqlConfig` | 精细控制 | 配置复杂 | 特殊数据需求 |

> **踩坑提醒**：`@DataJpaTest` 默认带 `@Transactional` 且自动回滚。如果测试方法中调用了 `entityManager.flush()`，数据会写入数据库但最终回滚。如果同时用了 `@Sql`，SQL 在事务外执行，不会回滚。

---

## 8.5 契约测试与 API 测试

### 8.5.1 REST Assured

**痛点**：MockMvc 的断言语法太啰嗦，一个接口测试写 20 行，可读性差。

REST Assured 提供类 BDD 风格的 API 测试：

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

    // 验证 JSON Schema
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

    // 验证响应时间
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

    // 验证集合
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

REST Assured vs MockMvc 对比：

| 维度 | REST Assured | MockMvc |
|------|-------------|--------|
| 风格 | BDD（given/when/then） | 链式 API |
| 可读性 | ⭐⭐⭐⭐⭐ 接近自然语言 | ⭐⭐⭐ 较啰嗦 |
| 环境 | 需要真实/随机端口 | Mock Servlet |
| 速度 | 较慢（真实 HTTP） | 快（无网络） |
| 适用 | API 集成测试 | Controller 单元测试 |
| Schema 验证 | ✅ 原生支持 | ❌ 需手动 |
| 响应时间验证 | ✅ 原生支持 | ❌ 不支持 |

> **经验法则**：Controller 逻辑测试用 MockMvc（快），API 完整性测试用 REST Assured（可读性好、能测真实 HTTP）。

### 8.5.2 Spring Cloud Contract（概览）

**痛点**：微服务 A 修改了接口返回值，微服务 B 不知道，上线后才发现接口不兼容。消费者驱动契约测试（CDC）解决这个问题。

核心思想：**消费者定义期望的接口格式（契约），提供者验证自己满足所有消费者的契约**。

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

// 提供者侧：自动生成测试验证契约
// Spring Cloud Contract 会根据契约自动生成 JUnit 测试
// 提供者运行这些测试来验证自己满足契约
```

Spring Cloud Contract 工作流：

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

| 特性 | Spring Cloud Contract | 传统集成测试 |
|------|---------------------|-------------|
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
|---------|---------|------|--------|
| 单元测试 | JUnit 5 + Mockito | ⚡ 极快 | 业务逻辑验证 |
| 集成测试 | @SpringBootTest | 🐢 慢 | 多组件协作 |
| Web 测试 | @WebMvcTest + MockMvc | ⚡ 快 | Controller 层 |
| 数据库测试 | @DataJpaTest / Testcontainers | ⚡/🐢 | Repository 层 |
| API 测试 | REST Assured | 🐢 中等 | 接口完整性 |
| 契约测试 | Spring Cloud Contract | 🐢 中等 | 微服务兼容性 |

> **一句话总结**：单元测试保逻辑，切片测试提速度，集成测试验协作，Testcontainers 兜底真实性——分层测试，各司其职。