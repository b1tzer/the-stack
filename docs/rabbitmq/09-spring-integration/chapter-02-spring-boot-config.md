# Spring Boot 自动配置

> Spring Boot 对 RabbitMQ 提供了完整的自动配置，涵盖连接、序列化、监听器、重试等。

## 1. 自动配置原理

```text
spring-boot-starter-amqp
  → RabbitAutoConfiguration
    → RabbitConnectionFactoryCreator（连接工厂）
    → RabbitTemplate（发送模板）
    → AmqpAdmin（管理工具）
    → RabbitAnnotationDrivenConfiguration（注解支持）
```

## 2. 配置项详解

```yaml
spring:
  rabbitmq:
    # 连接配置
    host: localhost
    port: 5672
    username: admin
    password: admin
    virtual-host: /
    addresses: host1:5672,host2:5672  # 集群地址
    connection-timeout: 5000

    # 生产者
    publisher-confirm-type: correlated  # none/simple/correlated
    publisher-returns: true
    template:
      mandatory: true
      retry:
        enabled: true
        initial-interval: 1000
        max-attempts: 3

    # 消费者
    listener:
      type: simple  # simple/direct
      simple:
        acknowledge-mode: manual  # auto/manual
        concurrency: 5
        max-concurrency: 20
        prefetch: 10
        retry:
          enabled: true
          initial-interval: 1000
          max-attempts: 3
          multiplier: 2.0
      direct:
        consumers-per-queue: 5
```

## 3. AmqpAdmin

```java
@Autowired
private AmqpAdmin amqpAdmin;

// 声明交换器
amqpAdmin.declareExchange(new TopicExchange("order.exchange"));

// 声明队列
amqpAdmin.declareQueue(new Queue("order.queue", true));

// 声明绑定
amqpAdmin.declareBinding(
    new Binding("order.queue", DestinationType.QUEUE,
        "order.exchange", "order.created", null)
);
```

## 4. 连接工厂配置

```java
@Bean
public ConnectionFactory connectionFactory() {
    CachingConnectionFactory factory = new CachingConnectionFactory();
    factory.setHost("localhost");
    factory.setPort(5672);
    factory.setUsername("admin");
    factory.setPassword("admin");

    // 连接池配置
    factory.setChannelCacheSize(25);
    factory.setChannelCheckoutTimeout(5000);

    // 集群配置
    factory.setAddresses("host1:5672,host2:5672,host3:5672");

    return factory;
}
```

## 5. 自定义序列化

```java
@Bean
public MessageConverter messageConverter() {
    Jackson2JsonMessageConverter converter = new Jackson2JsonMessageConverter();
    converter.setCreateMessageIds(true); // 自动创建消息 ID
    return converter;
}
```

## 6. 多数据源配置

```java
@Bean
public ConnectionFactory orderConnectionFactory() {
    // 订单服务专用连接
}

@Bean
public ConnectionFactory logConnectionFactory() {
    // 日志服务专用连接
}

@Bean
@Primary
public RabbitTemplate orderRabbitTemplate() {
    return new RabbitTemplate(orderConnectionFactory());
}
```
