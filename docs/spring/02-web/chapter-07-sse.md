# Server-Sent Events (SSE)

> WebSocket 是全双工，但很多场景只需要服务端单向推送：进度条、通知、实时日志流。SSE 基于 HTTP 长连接，比 WebSocket 轻量，浏览器原生支持 `EventSource` API，自动重连。Spring MVC 和 WebFlux 都原生支持。

## 1. SSE vs WebSocket

| 维度 | SSE | WebSocket |
| :-- | :-- | :-- |
| 方向 | 服务端→客户端单向 | 双向 |
| 协议 | HTTP/1.1 或 HTTP/2 | 独立协议（ws://） |
| 重连 | 浏览器自动重连 | 需手动实现 |
| 数据格式 | 纯文本（UTF-8） | 文本或二进制 |
| 防火墙 | 通 HTTP 代理 | 可能被拦截 |
| 适用场景 | 通知、进度、日志流 | 聊天、游戏、协同编辑 |

## 2. Spring MVC 实现

### 2.1 基础用法

```java
@RestController
public class NotificationController {

    // SSE 端点：返回 SseEmitter
    @GetMapping(value = "/notifications", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public SseEmitter streamNotifications() {
        // 超时设为 0 表示不超时（或设一个较长值）
        SseEmitter emitter = new SseEmitter(0L);

        // 注册回调
        emitter.onCompletion(() -> log.info("SSE 连接完成"));
        emitter.onTimeout(() -> log.info("SSE 连接超时"));
        emitter.onError(e -> log.error("SSE 错误", e));

        // 异步推送消息
        notificationService.register(emitter);

        return emitter;
    }
}
```

### 2.2 消息推送服务

```java
@Service
public class NotificationService {

    // 保存所有活跃的 emitter
    private final Map<String, SseEmitter> emitters = new ConcurrentHashMap<>();

    public void register(SseEmitter emitter) {
        String id = UUID.randomUUID().toString();
        emitters.put(id, emitter);

        emitter.onCompletion(() -> emitters.remove(id));
        emitter.onTimeout(() -> emitters.remove(id));
        emitter.onError(e -> emitters.remove(id));
    }

    // 向所有客户端推送
    public void broadcast(String eventName, Object data) {
        emitters.forEach((id, emitter) -> {
            try {
                emitter.send(SseEmitter.event()
                        .name(eventName)
                        .data(data, MediaType.APPLICATION_JSON));
            } catch (IOException e) {
                emitters.remove(id);
            }
        });
    }

    // 向特定用户推送
    public void sendToUser(String userId, String eventName, Object data) {
        SseEmitter emitter = emitters.get(userId);
        if (emitter != null) {
            try {
                emitter.send(SseEmitter.event()
                        .name(eventName)
                        .data(data));
            } catch (IOException e) {
                emitters.remove(userId);
            }
        }
    }
}
```

### 2.3 带重连 ID 的实现

SSE 协议支持 `id` 字段，浏览器重连时会发送 `Last-Event-ID` 头：

```java
@GetMapping(value = "/events", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
public SseEmitter streamEvents(HttpServletRequest request) {
    SseEmitter emitter = new SseEmitter(0L);

    String lastId = request.getHeader("Last-Event-ID");
    if (lastId != null) {
        // 从 lastId 之后重新推送，保证不丢消息
        List<Event> missedEvents = eventService.getAfter(lastId);
        missedEvents.forEach(event -> {
            try {
                emitter.send(SseEmitter.event()
                        .id(event.getId())
                        .name("message")
                        .data(event.getData()));
            } catch (IOException e) {
                // 连接已断开
            }
        });
    }

    // 注册后续推送...
    return emitter;
}
```

## 3. WebFlux 响应式实现

WebFlux 的 `Flux` 天然适合 SSE 流：

```java
@RestController
public class ReactiveNotificationController {

    @GetMapping(value = "/flux/notifications",
                produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public Flux<ServerSentEvent<Object>> streamFlux() {
        return Flux.interval(Duration.ofSeconds(1))
                .map(seq -> ServerSentEvent.builder()
                        .id(String.valueOf(seq))
                        .event("heartbeat")
                        .data("ping " + seq)
                        .build());
    }

    // 数据库变更流
    @GetMapping(value = "/flux/users",
                produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public Flux<ServerSentEvent<User>> streamUsers() {
        return userRepository.findWithTailableCursorBy()  // MongoDB Tailable Cursor
                .map(user -> ServerSentEvent.builder()
                        .id(user.getId().toString())
                        .event("user-update")
                        .data(user)
                        .build());
    }
}
```

## 4. 前端对接

```javascript
// 原生 EventSource API
const source = new EventSource('/notifications');

// 监听默认消息
source.onmessage = (event) => {
    console.log('收到消息:', event.data);
};

// 监听命名事件
source.addEventListener('order-created', (event) => {
    const order = JSON.parse(event.data);
    console.log('新订单:', order);
});

// 带认证的 SSE（EventSource 不支持自定义 header，用 fetch 替代）
const response = await fetch('/notifications', {
    headers: { 'Authorization': 'Bearer ' + token }
});
const reader = response.body.getReader();
const decoder = new TextDecoder();

while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    const text = decoder.decode(value);
    // 解析 SSE 格式: "data: {...}\n\n"
    text.split('\n\n').filter(Boolean).forEach(chunk => {
        const data = chunk.replace('data: ', '');
        console.log(JSON.parse(data));
    });
}

// 错误处理与重连
source.onerror = (event) => {
    if (source.readyState === EventSource.CLOSED) {
        console.log('连接已关闭');
    } else {
        console.log('连接异常，浏览器会自动重连...');
    }
};

// 手动关闭
source.close();
```

## 5. 生产注意事项

### 5.1 连接数管理

```java
@Component
public class SseConnectionManager {

    private final AtomicInteger activeConnections = new AtomicInteger(0);
    private static final int MAX_CONNECTIONS = 10000;

    public SseEmitter createEmitter() {
        if (activeConnections.get() >= MAX_CONNECTIONS) {
            throw new TooManyConnectionsException("SSE 连接数已达上限");
        }
        activeConnections.incrementAndGet();

        SseEmitter emitter = new SseEmitter(0L);
        emitter.onCompletion(activeConnections::decrementAndGet);
        emitter.onTimeout(activeConnections::decrementAndGet);
        emitter.onError(e -> activeConnections.decrementAndGet());

        return emitter;
    }
}
```

### 5.2 HTTP/2 多路复用

HTTP/2 下多个 SSE 流共享一个 TCP 连接，不再受浏览器 6 连接限制：

```yaml
# application.yml
server:
  http2:
    enabled: true
```

**最佳实践：**

1. **SSE 够用就不用 WebSocket**——通知、进度、日志流等单向推送场景，SSE 更简单
2. **设置合理的超时**——0L 不超时适合长连接，但要配合心跳检测
3. **实现 Last-Event-ID**——保证断线重连不丢消息
4. **监控连接数**——每个 SSE 占用一个线程（MVC）或连接（WebFlux），防止资源耗尽
5. **用事件名区分消息类型**——`event: order-created` 比在 data 里加 type 字段更清晰
