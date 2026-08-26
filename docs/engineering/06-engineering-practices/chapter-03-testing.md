# 测试

> **核心问题**：如何写好单元测试？测试金字塔是什么？如何提高测试覆盖率？

## 1. 测试金字塔

```
         /  E2E  \          少量：端到端测试
        /----------\
       / Integration \      适量：集成测试
      /----------------\
     /    Unit Tests    \   大量：单元测试
    /____________________\
```

| 层次 | 数量 | 速度 | 成本 | 工具 |
|------|------|------|------|------|
| 单元测试 | 多 | 毫秒 | 低 | JUnit + Mockito |
| 集成测试 | 中 | 秒 | 中 | Spring Boot Test |
| 端到端测试 | 少 | 分钟 | 高 | Selenium / Playwright |

## 2. 单元测试最佳实践

```java
// 测试类命名：被测类 + Test
class OrderServiceTest {
    
    private OrderService orderService;
    private OrderRepository orderRepository;
    private PaymentGateway paymentGateway;
    
    @BeforeEach
    void setUp() {
        orderRepository = mock(OrderRepository.class);
        paymentGateway = mock(PaymentGateway.class);
        orderService = new OrderService(orderRepository, paymentGateway);
    }
    
    // 测试方法命名：should_预期行为_when_条件
    @Test
    void should_create_order_when_valid_command() {
        // Given - 准备
        CreateOrderCommand cmd = new CreateOrderCommand(1L, BigDecimal.valueOf(99.9));
        when(paymentGateway.charge(any())).thenReturn(PaymentResult.success("TX001"));
        
        // When - 执行
        Long orderId = orderService.createOrder(cmd);
        
        // Then - 验证
        assertNotNull(orderId);
        verify(orderRepository).save(any(Order.class));
        verify(paymentGateway).charge(BigDecimal.valueOf(99.9));
    }
    
    @Test
    void should_throw_exception_when_amount_is_zero() {
        // Given
        CreateOrderCommand cmd = new CreateOrderCommand(1L, BigDecimal.ZERO);
        
        // When & Then
        assertThrows(IllegalArgumentException.class, 
            () -> orderService.createOrder(cmd));
        
        // 验证不会调用支付网关
        verifyNoInteractions(paymentGateway);
    }
    
    @Test
    void should_throw_exception_when_payment_fails() {
        // Given
        CreateOrderCommand cmd = new CreateOrderCommand(1L, BigDecimal.valueOf(99.9));
        when(paymentGateway.charge(any())).thenThrow(new PaymentException("余额不足"));
        
        // When & Then
        assertThrows(OrderCreationException.class,
            () -> orderService.createOrder(cmd));
        
        // 验证订单不会被保存
        verify(orderRepository, never()).save(any());
    }
}
```

## 3. 集成测试

```java
// Spring Boot 集成测试
@SpringBootTest
@Transactional  // 测试后自动回滚
class OrderRepositoryTest {
    
    @Autowired
    private OrderRepository orderRepository;
    
    @Autowired
    private TestEntityManager entityManager;
    
    @Test
    void should_save_and_find_order() {
        // Given
        Order order = new Order(1L, BigDecimal.valueOf(99.9));
        
        // When
        Order saved = orderRepository.save(order);
        entityManager.flush();
        entityManager.clear();
        
        // Then
        Order found = orderRepository.findById(saved.getId()).orElseThrow();
        assertEquals(1L, found.getUserId());
        assertEquals(BigDecimal.valueOf(99.9), found.getAmount());
    }
}
```

## 4. 测试覆盖率

```java
// JaCoCo 配置（pom.xml）
// <plugin>
//   <groupId>org.jacoco</groupId>
//   <artifactId>jacoco-maven-plugin</artifactId>
//   <executions>
//     <execution>
//       <goals><goal>prepare-agent</goal></goals>
//     </execution>
//     <execution>
//       <id>report</id>
//       <phase>test</phase>
//       <goals><goal>report</goal></goals>
//     </execution>
//   </executions>
// </plugin>

// 覆盖率目标
// - 行覆盖率 > 80%
// - 分支覆盖率 > 70%
// - 核心业务逻辑 > 90%
```

## 5. 测试策略

| 模块 | 测试策略 | 覆盖率目标 |
|------|---------|-----------|\
| 领域层 | 充分单元测试 | > 90% |
| 应用层 | 单元测试 + 集成测试 | > 80% |
| 基础设施层 | 集成测试 | > 60% |
| 接口层 | 集成测试 | > 70% |

> **核心原则**：测试不是为了覆盖率数字，而是为了信心。好的测试让你敢改代码、敢重构、敢发布。
