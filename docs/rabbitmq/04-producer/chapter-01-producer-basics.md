# 生产者基础

> Producer 是消息的源头。理解消息从应用代码到 Broker 的完整路径，是保证消息可靠性的第一步。

## 1. 发送消息的完整流程

```java
channel.basicPublish(exchange, routingKey, props, body);
```

这一行代码背后发生了什么：

```txt
1. 应用层调用 basicPublish
2. 客户端按 AMQP 0-9-1 协议将消息编码为帧（Basic.Publish Method Frame + Content Header Frame + 一个或多个 Content Body Frame）
3. 通过 Connection 对应的 TCP 连接发送到 Broker
4. Broker 解析帧，根据 Exchange 类型和 Routing Key 路由到 Queue
5. 若开启 Publisher Confirm，Broker 异步返回 Confirm
```

## 2. 同步发送 vs 异步发送

```java
// 同步发送：发布后阻塞等待 Broker 确认
channel.confirmSelect();  // 开启 Confirm 模式
channel.basicPublish("order.exchange", "order.created", props, body);
channel.waitForConfirmsOrDie();  // 阻塞直到消息被确认

// 异步发送：先注册 Confirm 监听器，再发布
channel.confirmSelect();  // 开启 Confirm 模式
channel.addConfirmListener((deliveryTag, multiple) -> {
    // 消息已被 Broker 确认
    log.info("Confirmed: {}", deliveryTag);
}, (deliveryTag, multiple) -> {
    // 消息被 Broker 拒绝（极少见）
    log.error("Nacked: {}", deliveryTag);
});
channel.basicPublish("order.exchange", "order.created", props, body);
```

## 3. 消息属性（BasicProperties）

```java
AMQP.BasicProperties props = new AMQP.BasicProperties.Builder()
    .deliveryMode(2)                    // 持久化
    .contentType("application/json")    // 内容类型
    .correlationId(UUID.randomUUID().toString())  // 关联 ID
    .replyTo("callback.queue")          // 回复队列（RPC）
    .expiration("60000")                // 单条消息 TTL（ms）
    .priority(5)                        // 优先级
    .messageId(UUID.randomUUID().toString())  // 消息 ID
    .timestamp(new Date())              // 时间戳
    .type("order.created")              // 消息类型
    .appId("order-service")             // 应用标识
    .headers(Map.of(                    // 自定义 headers
        "x-trace-id", "abc123",
        "x-retry-count", 0
    ))
    .build();
```

### 3.1 常见属性的使用场景

| 属性 | 使用场景 |
| :-- | :-- |
| deliveryMode = 2 | 需要消息持久化时设置，配合持久队列与 Publisher Confirm |
| correlationId | RPC 或请求响应关联场景 |
| messageId | 需要稳定消息标识时设置，配合消费端幂等处理 |
| priority | 需要按优先级投递时设置，Classic Queue 需声明 x-max-priority 参数，Quorum Queue 自 4.3 起支持 |

### 3.2 不要在 headers 中放大量数据

headers 是消息元数据的一部分，随消息存储和传输。如果放了大量数据（如整个业务对象），会显著增加内存和磁盘 IO 开销。headers 应该只放路由和控制信息。

## 4. Exchange 和 Routing Key

```java
// 发送到指定 Exchange + Routing Key
channel.basicPublish("order.exchange", "order.created", props, body);

// 发送到默认 Exchange（按 Queue 名路由）
channel.basicPublish("", "order.queue", props, body);

// 发送到 Fanout Exchange（routing key 无意义）
channel.basicPublish("notification.fanout", "", props, body);
```

**最佳实践**：显式声明 Exchange + Binding，路由关系更清晰、解耦更彻底。默认 Exchange 按队列名直连，仅适合简单直发场景。

## 5. 发送失败的处理

```txt
消息发送失败或受阻的可能原因：
  ├─ Exchange 不存在 → Channel 异常（404 NOT_FOUND）
  ├─ Routing key 无匹配 Queue → 消息无法路由
  ├─ 消息超过大小限制 → 连接被 Broker 关闭
  ├─ Broker 内存满 → 生产者被阻塞（flow control，非失败）
  └─ 网络中断 → Connection 异常
```

按确认语义分成四类，处理方式不同：

| 类别 | 表现 | 处理方式 |
| :-- | :-- | :-- |
| Channel 级协议错误 | Exchange 不存在（404 NOT_FOUND） | 检查配置，确保 Exchange 已声明 |
| 未路由消息 | Routing key 无匹配 Queue | 用 mandatory + Return 感知，或配置 Alternate Exchange 兜底，见 [Mandatory 与 Return](chapter-03-mandatory-return.md) |
| 连接中断或确认超时 | 网络中断、消息超限被关闭 | 结果不确定，重发可能造成重复消息，配合 [Publisher Confirm](chapter-02-publisher-confirm.md) 与消费端幂等 |
| 背压（flow control） | Broker 内存或磁盘告警 | 不是失败，Broker 降低发布速率或阻塞，解除后恢复 |

需要注意：

- Publisher Confirm 成功只代表 Broker 接收了消息，不代表消息已路由到目标队列。
- 连接中断或确认超时不代表消息一定发送失败，原消息可能已到达 Broker，只是确认没返回。

## 6. 发送前的统一处理

RabbitMQ Java 客户端没有 Kafka 式的 ProducerInterceptor，统一补充 trace ID、记录发送指标或审计日志，需要封装发送方法：

```java
public void publish(String exchange, String routingKey, AMQP.BasicProperties props, byte[] body) throws IOException {
    Map<String, Object> headers = new HashMap<>();
    if (props.getHeaders() != null) {
        headers.putAll(props.getHeaders());
    }
    String traceId = MDC.get("traceId");
    if (traceId != null) {
        headers.put("x-trace-id", traceId);
    }

    AMQP.BasicProperties enriched = props.builder().headers(headers).build();
    channel.basicPublish(exchange, routingKey, enriched, body);
    metrics.increment("producer.publish.attempt");  // 发布尝试次数，不代表 Broker 已确认
}
```

封装点放在业务发布方法这一层，而不是依赖客户端拦截器。

## 7. 最佳实践总结

1. **需要持久化时设置 deliveryMode = 2**
2. **开启 Publisher Confirm**，不要把 basicPublish() 返回当作已确认
3. **优先显式声明 Exchange**，默认 Exchange 仅用于简单直发
4. **消息体保持精简**，大数据走对象存储
5. **在 RPC 场景设置 correlationId** 关联请求与响应
6. **处理 Broker 资源告警**（flow control），不要将阻塞当作发送失败
7. **合理复用 Connection，避免多线程并发共享同一个 Channel**
8. **务必调用 close()** 或用 try-with-resources
