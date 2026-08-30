# 队列参数（x-arguments）

> RabbitMQ 通过 `x-` 前缀的参数实现队列的高级特性：TTL、长度限制、死信、优先级等。

## 1. 参数一览

| 参数 | 类型 | 说明 |
| :-- | :-- | :-- |
| x-message-ttl | int | 消息 TTL（毫秒） |
| x-expires | int | 队列空闲超时自动删除（毫秒） |
| x-max-length | int | 队列最大消息数 |
| x-max-length-bytes | long | 队列最大字节数 |
| x-overflow | string | 溢出策略：drop-head / reject-publish / reject-publish-dlx |
| x-dead-letter-exchange | string | 死信交换器 |
| x-dead-letter-routing-key | string | 死信路由 key |
| x-max-priority | int | 最大优先级（0-255） |
| x-queue-mode | string | 队列模式：default / lazy |
| x-queue-type | string | 队列类型：classic / quorum / stream |
| x-delivery-limit | int | 消息重投次数限制（quorum） |
| x-quorum-initial-group-size | int | 仲裁队列初始组大小 |

## 2. 队列 TTL

队列级别 TTL，所有消息统一过期时间：

```java
Map<String, Object> args = new HashMap<>();
args.put("x-message-ttl", 60000); // 60 秒
channel.queueDeclare("temp.queue", true, false, false, args);
```

## 3. 队列长度限制

```java
Map<String, Object> args = new HashMap<>();
args.put("x-max-length", 10000);           // 最多 10000 条消息
args.put("x-max-length-bytes", 104857600); // 最多 100MB
args.put("x-overflow", "reject-publish");  // 超出时拒绝发布
channel.queueDeclare("bounded.queue", true, false, false, args);
```

溢出策略：

| 策略 | 说明 |
| :-- | :-- |
| drop-head | 丢弃队头消息（默认） |
| reject-publish | 拒绝最新消息，Publisher 收到 nack |
| reject-publish-dlx | 拒绝最新消息并路由到死信 |

## 4. 队列过期

空闲队列自动删除：

```java
Map<String, Object> args = new HashMap<>();
args.put("x-expires", 300000); // 5 分钟无操作自动删除
channel.queueDeclare("temp.callback", true, false, false, args);
```

## 5. 参数不可变

大部分队列参数在声明后不可修改：

- 需要修改参数 → 删除队列 → 重新声明
- 推荐使用 Policy 覆盖部分参数（可动态修改）
- Policy 优先级高于 x-arguments
