# 测试策略

> 测试 RabbitMQ 应用需要覆盖单元测试、集成测试和端到端测试。

## 1. 单元测试

### 1.1 测试消息序列化

```java
@Test
void testMessageSerialization() {
    Order order = new Order("123", "created");
    Message message = new Jackson2JsonMessageConverter()
        .toMessage(order, new MessageProperties());

    Order deserialized = (Order) new Jackson2JsonMessageConverter()
        .fromMessage(message);

    assertEquals("123", deserialized.getId());
}
```

### 1.2 测试业务逻辑

```java
@Test
void testProcessOrder() {
    Order order = new Order("123", "created");
    orderService.process(order);
    assertEquals("processed", order.getStatus());
}
```

## 2. 集成测试

### 2.1 使用 Testcontainers

```java
@SpringBootTest
@Testcontainers
class RabbitMQIntegrationTest {

    @Container
    static RabbitMQContainer rabbit = new RabbitMQContainer("rabbitmq:3-management");

    @DynamicPropertySource
    static void configure(DynamicPropertyRegistry registry) {
        registry.add("spring.rabbitmq.host", rabbit::getHost);
        registry.add("spring.rabbitmq.port", rabbit::getAmqpPort);
    }

    @Autowired
    private RabbitTemplate rabbitTemplate;

    @Test
    void testSendMessage() {
        rabbitTemplate.convertAndSend("test.exchange", "test.key", "hello");

        // 验证消息被消费
        Message received = rabbitTemplate.receive("test.queue", 5000);
        assertNotNull(received);
        assertEquals("hello", new String(received.getBody()));
    }
}
```

### 2.2 使用 @RabbitTest

```java
@SpringBootTest
@RabbitTest(queues = "test.queue")
class RabbitListenerTest {

    @Autowired
    private RabbitTemplate rabbitTemplate;

    @Test
    void testListener() {
        rabbitTemplate.convertAndSend("test.queue", "test message");

        // 验证消费者处理
        verify(orderService, timeout(5000)).process(any());
    }
}
```

## 3. 端到端测试

```java
@SpringBootTest
class E2ETest {

    @Autowired
    private RabbitTemplate rabbitTemplate;

    @Autowired
    private OrderRepository orderRepository;

    @Test
    void testOrderFlow() {
        // 1. 发送订单创建消息
        Order order = new Order("123", "new");
        rabbitTemplate.convertAndSend("order.exchange", "order.created", order);

        // 2. 等待处理完成
        await().atMost(10, SECONDS).until(() ->
            orderRepository.findById("123").isPresent()
        );

        // 3. 验证结果
        Order saved = orderRepository.findById("123").get();
        assertEquals("created", saved.getStatus());
    }
}
```

## 4. Mock 测试

```java
@ExtendWith(MockitoExtension.class)
class OrderServiceTest {

    @Mock
    private RabbitTemplate rabbitTemplate;

    @InjectMocks
    private OrderService orderService;

    @Test
    void testCreateOrder() {
        Order order = new Order("123", "new");
        orderService.create(order);

        verify(rabbitTemplate).convertAndSend(
            eq("order.exchange"),
            eq("order.created"),
            argThat(o -> ((Order) o).getId().equals("123"))
        );
    }
}
```

## 5. 测试最佳实践

| 层级 | 工具 | 覆盖范围 |
| :-- | :-- | :-- |
| 单元测试 | JUnit + Mockito | 业务逻辑 |
| 集成测试 | Testcontainers | 消息收发 |
| 端到端测试 | Spring Boot Test | 完整流程 |
