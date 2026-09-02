# 生产者基础

> Producer 是消息的源头。理解消息从应用代码到 Broker 的完整路径，是保证消息可靠性的第一步。

## 1. 发送消息的完整流程

```java
channel.basicPublish(exchange, routingKey, props, body);
```

这一行代码背后发生了什么：

```text
1. 应用层调用 basicPublish
2. 消息经过拦截器链（ProducerInterceptor）
3. 序列化器将 body 转为 byte[]
4. 分区器（对 RabbitMQ 无意义，Kafka 才有）决定路由
5. 消息进入客户端缓冲区
6. AMQP 帧编码（Method Frame + Header Frame + Body Frame）
7. 通过 TCP 发送到 Broker
8. Broker 的 IO 线程接收
9. Broker 路由到 Exchange → Queue
10. 返回（异步）Publisher Confirm
```

## 2. 同步发送 vs 异步发送

```java
// 同步发送：阻塞等待 Broker 确认
channel.basicPublish("order.exchange", "order.created", props, body);
// 注意：basicPublish 本身是异步的，不阻塞
// 要同步等待确认，需要配合 Publisher Confirm

// 异步发送 + Confirm 回调
channel.confirmSelect();  // 开启 Confirm 模式
channel.basicPublish("order.exchange", "order.created", props, body);
// 不阻塞，Confirm 异步回调
channel.addConfirmListener((deliveryTag, multiple) -> {
    // 消息已被 Broker 确认
    log.info("Confirmed: {}", deliveryTag);
}, (deliveryTag, multiple) -> {
    // 消息被 Broker 拒绝（极少见）
    log.error("Nacked: {}", deliveryTag);
});
```

## 3. 消息属性（BasicProperties）

```java
AMQP.BasicProperties props = new AMQP.BasicProperties.Builder()
    .deliveryMode(2)                    // 持久化（必须！）
    .contentType("application/json")    // 内容类型
    .correlationId(UUID.randomUUID().toString())  // 关联 ID
    .replyTo("callback.queue")          // 回复队列（RPC）
    .expiration("60000")                // 单条消息 TTL（ms）
    .priority(5)                        // 优先级
    .messageId(UUID.randomUUID().toString())  // 消息 ID
    .timestamp(new Date())              // 时间戳
    .type("order.created")              // 消息类型
    .userId("guest")                    // 发送用户
    .appId("order-service")             // 应用标识
    .headers(Map.of(                    // 自定义 headers
        "x-trace-id", "abc123",
        "x-retry-count", 0
    ))
    .build();
```

### 3.1 必须设置的属性

| 属性 | 为什么必须设 |
|------|-------------|
| deliveryMode = 2 | 不设的话消息只在内存，Broker 崩溃就丢 |
| correlationId | 用于消息追踪和去重 |
| messageId | 用于幂等消费 |

### 3.2 不要在 headers 中放大量数据

headers 会被持久化，如果放了大量数据（如整个业务对象），会显著增加磁盘 IO 和内存消耗。headers 应该只放路由和控制信息。

## 4. Exchange 和 Routing Key

```java
// 发送到指定 Exchange + Routing Key
channel.basicPublish("order.exchange", "order.created", props, body);

// 发送到默认 Exchange（按 Queue 名路由）
channel.basicPublish("", "order.queue", props, body);

// 发送到 Fanout Exchange（routing key 无意义）
channel.basicPublish("notification.fanout", "", props, body);
```

**最佳实践**：生产环境不要使用默认 Exchange。显式声明 Exchange + Binding，路由关系更清晰。

## 5. 发送失败的处理

```text
消息发送失败的可能原因：
  ├─ Exchange 不存在 → Channel 异常（404 NOT_FOUND）
  ├─ Routing key 无匹配 Queue → 消息被丢弃（或走 Alternate Exchange）
  ├─ Broker 内存满 → 生产者被阻塞（flow control）
  ├─ 消息太大 → Channel 异常（FRAME_ERROR）
  └─ 网络中断 → Connection 异常
```

| 失败场景 | 处理方式 |
|----------|----------|
| Exchange 不存在 | 检查配置，确保 Exchange 已声明 |
| 无匹配 Queue | 配置 Alternate Exchange 记录未路由消息 |
| Broker 内存满 | 等待 flow control 解除，或增大内存 |
| 网络中断 | 重连 + 重发（需要幂等性） |

## 6. 拦截器（ProducerInterceptor）

```java
public class TracingInterceptor implements ProducerInterceptor<String, String> {
    @Override
    public ProducerRecord<String, String> onSend(ProducerRecord<String, String> record) {
        record.headers().add("x-trace-id", MDC.get("traceId").getBytes());
        return record;
    }

    @Override
    public void onAcknowledgement(RecordMetadata metadata, Exception exception) {
        if (exception != null) {
            metrics.increment("producer.send.failed");
        }
    }
}
```

拦截器适用于：添加 trace ID、记录发送指标、审计日志。

## 7. 最佳实践总结

1. **始终设置 deliveryMode = 2**（持久化）
2. **开启 Publisher Confirm**（异步确认）
3. **不要使用默认 Exchange**
4. **消息体保持精简**，大数据走对象存储
5. **设置 correlationId** 用于追踪
6. **处理 Broker 内存满的情况**（flow control 回调）
7. **Producer 是线程安全的**，多线程共享一个实例
8. **务必调用 close()** 或用 try-with-resources
