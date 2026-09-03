# RPC 模式

> RabbitMQ 原生支持 RPC（Remote Procedure Call）模式：客户端发请求，服务端处理后返回结果。

## 1. RPC 的实现原理

```txt
Client                          Server
  │                               │
  ├─ basicPublish(request.queue) ──▶ │
  │   correlationId = "abc123"    │
  │   replyTo = "callback.queue"  │
  │                               ├─ 处理请求
  │                               │
  │ ◀── basicPublish(callback.queue) ──┤
  │   correlationId = "abc123"    │
  │   result = "..."              │
  │                               │
  ├─ 匹配 correlationId           │
  │   返回结果给调用方              │
```

关键属性：
- `replyTo`：客户端告诉服务端"结果发到哪个 Queue"
- `correlationId`：匹配请求和响应的唯一标识

## 2. 实现代码

### 客户端

```java
// 声明回调 Queue（排他，连接断开自动删除）
String callbackQueue = channel.queueDeclare().getQueue();

// 发送请求
String correlationId = UUID.randomUUID().toString();
AMQP.BasicProperties props = new AMQP.BasicProperties.Builder()
    .correlationId(correlationId)
    .replyTo(callbackQueue)
    .build();

channel.basicPublish("", "rpc.request.queue", props, requestBody);

// 等待响应
GetResponse response = channel.basicGet(callbackQueue, true);
while (response == null) {
    Thread.sleep(10);
    response = channel.basicGet(callbackQueue, true);
}
String result = new String(response.getBody());
```

### 服务端

```java
channel.basicConsume("rpc.request.queue", false, new DefaultConsumer(channel) {
    @Override
    public void handleDelivery(String tag, Envelope envelope,
                               AMQP.BasicProperties props, byte[] body) {
        // 处理请求
        String result = processRequest(new String(body));
        
        // 返回结果
        AMQP.BasicProperties replyProps = new AMQP.BasicProperties.Builder()
            .correlationId(props.getCorrelationId())
            .build();
        
        channel.basicPublish("", props.getReplyTo(), replyProps, result.getBytes());
        channel.basicAck(envelope.getDeliveryTag(), false);
    }
});
```

## 3. 注意事项

1. **回调 Queue 用排他**：每个客户端一个临时 Queue，断开自动清理
2. **correlationId 必须唯一**：用于匹配请求和响应
3. **设置超时**：客户端等待响应要设超时，避免无限等待
4. **服务端异常处理**：处理失败时返回错误信息，不要让客户端一直等
5. **并发请求**：多个请求并发时，用 correlationId 区分不同响应

## 4. RPC vs 直接 HTTP 调用

| 维度 | RabbitMQ RPC | HTTP/RPC |
| :-- | :-- | :-- |
| 异步 | 天然异步 | 需要额外实现 |
| 解耦 | 通过 Queue 解耦 | 直接依赖 |
| 负载均衡 | 多个 Server 竞争消费 | 需要负载均衡器 |
| 延迟 | 较高（经过 Broker） | 低 |
| 复杂度 | 较高（correlationId 匹配） | 低 |

**建议**：如果只是简单的同步调用，用 HTTP/gRPC。如果需要异步、解耦、或已有 RabbitMQ 基础设施，用 RPC 模式。
