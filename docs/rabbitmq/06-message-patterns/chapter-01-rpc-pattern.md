# RPC 模式

> RabbitMQ 原生支持请求-应答（RPC）模式，通过 `replyTo` 和 `correlationId` 实现异步远程调用。

## 1. RPC 架构

```text
Client                         Server
  │                               │
  │── basicPublish ──────────────▶│  请求
  │   (replyTo=rpc.queue,        │
  │    correlationId=abc-123)    │
  │                               │
  │                               │── 处理请求
  │                               │
  │◀── basicPublish ──────────────│  响应
  │   (routingKey=rpc.queue,     │
  │    correlationId=abc-123)    │
  │                               │
```

## 2. 客户端实现

```java
// 1. 声明回调队列
String replyQueue = channel.queueDeclare().getQueue();

// 2. 注册消费者
Map<String, Object> pendingRequests = new ConcurrentHashMap<>();

channel.basicConsume(replyQueue, true, (tag, delivery) -> {
    String correlationId = delivery.getProperties().getCorrelationId();
    CompletableFuture<String> future = pendingRequests.remove(correlationId);
    if (future != null) {
        future.complete(new String(delivery.getBody()));
    }
}, tag -> {});

// 3. 发送 RPC 请求
String correlationId = UUID.randomUUID().toString();
AMQP.BasicProperties props = new AMQP.BasicProperties.Builder()
    .correlationId(correlationId)
    .replyTo(replyQueue)
    .build();

CompletableFuture<String> future = new CompletableFuture<>();
pendingRequests.put(correlationId, future);

channel.basicPublish("", "rpc.queue", props, requestBody);

// 4. 等待响应
String response = future.get(10, TimeUnit.SECONDS);
```

## 3. 服务端实现

```java
channel.basicQos(1); // 一次处理一个请求

channel.basicConsume("rpc.queue", false, (tag, delivery) -> {
    String request = new String(delivery.getBody());
    String correlationId = delivery.getProperties().getCorrelationId();
    String replyTo = delivery.getProperties().getReplyTo();

    // 处理请求
    String response = processRequest(request);

    // 发送响应
    AMQP.BasicProperties replyProps = new AMQP.BasicProperties.Builder()
        .correlationId(correlationId)
        .build();
    channel.basicPublish("", replyTo, replyProps, response.getBytes());

    channel.basicAck(delivery.getEnvelope().getDeliveryTag(), false);
}, tag -> {});
```

## 4. 超时处理

```java
// 设置消息 TTL
AMQP.BasicProperties props = new AMQP.BasicProperties.Builder()
    .correlationId(correlationId)
    .replyTo(replyQueue)
    .expiration("10000") // 10 秒超时
    .build();

// 客户端超时
try {
    String response = future.get(10, TimeUnit.SECONDS);
} catch (TimeoutException e) {
    pendingRequests.remove(correlationId);
    log.error("RPC 超时");
}
```

## 5. 与 gRPC/HTTP 的对比

| 特性 | RabbitMQ RPC | gRPC | HTTP/REST |
| :-- | :-- | :-- | :-- |
| 通信模式 | 异步 | 同步/流式 | 同步 |
| 协议 | AMQP | HTTP/2 | HTTP/1.1 |
| 序列化 | 自定义 | Protobuf | JSON |
| 服务发现 | 队列名 | DNS/注册中心 | DNS/网关 |
| 负载均衡 | 队列内竞争 | 客户端/服务端 | 网关 |
| 适用场景 | 内部异步调用 | 微服务间 | 外部 API |

## 6. 最佳实践

- 为每个 RPC 请求设置唯一 correlationId
- 回复队列使用 exclusive 临时队列
- 设置合理的超时时间
- 服务端 prefetch=1，避免请求堆积
- 考虑使用 gRPC 替代同步 RPC 场景
