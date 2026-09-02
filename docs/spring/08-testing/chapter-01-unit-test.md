# 单元测试

> 不写测试的代码就像不系安全带开车——平时没事，出事就是大事。

---

## 1. 测试策略

### 1.1 测试金字塔

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

### 1.2 测试什么、不测什么

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

---

## 2. JUnit 5 核心

```java
import org.junit.jupiter.api.*;

import static org.junit.jupiter.api.Assertions.*;

@DisplayName("用户服务测试")
class UserServiceTest {

    private UserService userService;

    @BeforeEach
    void setUp() {
        System.out.println("初始化测试环境...");
        userService = new UserService();
    }

    @AfterEach
    void tearDown() {
        System.out.println("清理测试环境...");
    }

    @BeforeAll
    static void beforeAll() {
        System.out.println("整个测试类开始...");
    }

    @AfterAll
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
    @Disabled("暂未实现")
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

### 2.1 参数化测试

```java
@ExtendWith(MockitoExtension.class)
class UserServiceTest {

    @Mock
    private UserRepository userRepository;

    @InjectMocks
    private UserService userService;

    // 参数化测试
    @ParameterizedTest
    @CsvSource({
        "1, 张三",
        "2, 李四",
        "3, 王五"
    })
    void testGetUser(Long id, String expectedName) {
        when(userRepository.findById(id))
            .thenReturn(Optional.of(new User(id, expectedName, "email@test.com")));

        User user = userService.getUser(id);
        assertEquals(expectedName, user.getName());
    }

    // 方法源
    @ParameterizedTest
    @MethodSource("invalidEmails")
    void testInvalidEmail(String email) {
        assertThrows(IllegalArgumentException.class,
            () -> userService.createUser(new UserDTO("张三", email)));
    }

    static Stream<String> invalidEmails() {
        return Stream.of("", "abc", "@test.com", "test@", "test @test.com");
    }
}
```

### 2.2 测试异常与超时

```java
class UserServiceExceptionTest {

    @Test
    void testExceptionMessage() {
        IllegalArgumentException ex = assertThrows(
            IllegalArgumentException.class,
            () -> userService.createUser(new UserDTO("", "email@test.com")));
        assertEquals("用户名不能为空", ex.getMessage());
    }

    @Test
    void testTimeout() {
        assertTimeout(Duration.ofSeconds(2), () -> {
            userService.batchProcess(List.of(1L, 2L, 3L));
        });
    }

    @Test
    void testTimeoutPreemptively() {
        assertTimeoutPreemptively(Duration.ofSeconds(1), () -> {
            userService.callExternalService();
        });
    }
}
```

### 2.3 嵌套测试

```java
class OrderServiceTest {

    @Nested
    @DisplayName("创建订单")
    class CreateOrder {

        @Test
        @DisplayName("正常创建")
        void shouldCreateOrder() {
            // ...
        }

        @Test
        @DisplayName("库存不足时抛异常")
        void shouldThrowWhenInsufficientStock() {
            // ...
        }
    }

    @Nested
    @DisplayName("取消订单")
    class CancelOrder {

        @Test
        @DisplayName("正常取消")
        void shouldCancelOrder() {
            // ...
        }

        @Test
        @DisplayName("已发货的订单不能取消")
        void shouldNotCancelShippedOrder() {
            // ...
        }
    }
}
```

---

## 3. Mock vs Stub vs Spy

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

## 4. Mockito 完整实战

### 4.1 注解模式（推荐）

```java
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
```

### 4.2 手动创建

```java
@Test
void manualMock() {
    OrderRepository mockRepo = mock(OrderRepository.class);
    when(mockRepo.findById(1L)).thenReturn(Optional.of(new Order(1L)));

    OrderService service = new OrderService(mockRepo);
    Order order = service.findById(1L);

    assertEquals(1L, order.getId());
}
```

### 4.3 Mockito 常用 API

| API | 作用 | 示例 |
|-----|------|------|
| `when().thenReturn()` | 设置返回值 | `when(repo.findById(1L)).thenReturn(...)` |
| `when().thenThrow()` | 设置抛异常 | `when(repo.save(null)).thenThrow(...)` |
| `verify()` | 验证方法被调用 | `verify(repo).save(any())` |
| `verify(times(2))` | 验证调用次数 | `verify(repo, times(2)).save(any())` |
| `verify(never())` | 验证未被调用 | `verify(repo, never()).delete(any())` |
| `any()` | 匹配任意参数 | `when(repo.save(any())).thenReturn(...)` |
| `eq()` | 精确匹配参数 | `when(repo.findById(eq(1L))).thenReturn(...)` |
| `ArgumentCaptor` | 捕获参数 | 见下文 |

### 4.4 ArgumentCaptor 捕获参数

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

### 4.5 验证调用顺序

```java
@Test
void shouldVerifyCallOrder() {
    InOrder inOrder = inOrder(orderRepository, paymentClient);

    orderService.createOrder("alice", BigDecimal.valueOf(100));

    inOrder.verify(orderRepository).save(any(Order.class));
    inOrder.verify(paymentClient).charge(any());
}
```

> **踩坑提醒**：Mockito 不能 Mock `final` 类、`private` 方法、`static` 方法（除非用 mockito-inline 或 PowerMock）。遇到这些场景，考虑重构代码或用 Spy。

---

## 5. Service 层完整测试用例设计

一个完整的 Service 测试应该覆盖四种路径：正常路径、边界条件、异常路径、依赖交互验证。

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

## 最佳实践

1. **测试命名清晰**——`should_预期行为_when_条件` 或 `test_方法_场景_预期`
2. **AAA 模式**——Arrange（准备）、Act（执行）、Assert（断言）
3. **一个测试只验证一个行为**——不要在一个测试中验证多个不相关的逻辑
4. **Mock 外部依赖，不 Mock 被测类**——只 Mock 你的类调用的外部依赖
5. **测试覆盖率不是唯一指标**——关键路径 100% 覆盖，边界条件重点测试
