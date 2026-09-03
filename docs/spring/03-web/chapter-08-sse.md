# Server-Sent Events (SSE)

> 很多场景只需要服务端单向推送：进度条、通知、实时日志流。SSE 基于 HTTP 长连接，比 WebSocket 轻量，浏览器原生支持自动重连。类比：广播电台——电台单向发射信号，你打开收音机就能听。你不能通过收音机跟电台说话，想说话得打电话（HTTP 请求）。

## 1. SSE 是什么

写代码之前，先回答四个问题：SSE 是什么、哪一步让它被识别成 SSE、数据长什么样、后文用到的抽象是什么。

### 1.1 它是一个标准，不是新协议

SSE（Server-Sent Events）是 WHATWG 在 HTML 标准里定义的一套规范。它没有发明新的传输层，而是规定「怎样用普通 HTTP 响应，实现服务端到客户端的单向持续推送」。它由三个约定拼成：

1. **响应头**：服务端声明 `Content-Type: text/event-stream`
2. **数据格式**：响应体按固定文本格式书写（见 §1.3）
3. **浏览器 API**：`EventSource` 负责发起请求、解析格式、断线自动重连

对照 WebSocket：WebSocket 是独立协议（`ws://`），需要 TCP 升级握手；SSE 全程就是 HTTP，只是把一次响应「拉长」成一条持续输出的流。

### 1.2 哪一步让它被识别成 SSE

识别只发生在一个地方——响应头 `Content-Type: text/event-stream`。

对应后文每一段代码里的这一行：

```java
produces = MediaType.TEXT_EVENT_STREAM_VALUE
```

`MediaType.TEXT_EVENT_STREAM_VALUE` 的字符串值就是 `text/event-stream`。这一行让 Spring 把 `Content-Type` 响应头写成 `text/event-stream`，浏览器据此知道「这条响应不是一次性返回完，而是一条事件流」。

完整链路：

1. 控制器声明 `produces = text/event-stream`，Spring 把该值写入响应头
2. 服务端不关闭连接（普通响应返回完就 close，SSE 响应保持打开）
3. 浏览器读到 `Content-Type: text/event-stream`，把后续 body 当作流式事件逐条解析，而不是一次性读完

没有这个响应头，body 就只是普通文本，浏览器不会按 SSE 解析，也不会自动重连。

### 1.3 数据长什么样

响应体是纯 UTF-8 文本。每个事件由若干字段行 + 一个空行组成：

```text
id: 1
event: heartbeat
data: ping 1

id: 2
event: heartbeat
data: ping 2
```

| 字段 | 含义 |
| :-- | :-- |
| `data:` | 消息内容，可多行 |
| `event:` | 事件名，前端据此分发监听器 |
| `id:` | 事件 ID，用于断线续传（§3.3） |
| `:` 开头 | 注释行，客户端忽略，用于心跳（§6.1） |

后文 `emitter.send(...)` 底层最终都会变成上面这种 `data: xxx` 加空行的文本，通过响应流发给浏览器。

### 1.4 后文的两个抽象

全文出现两个抽象，分别属于两套框架：

| 抽象 | 所属框架 | 本质 | 展开章节 |
| :-- | :-- | :-- | :-- |
| `SseEmitter` | Spring MVC（Servlet） | 对「异步 `HttpServletResponse` 持续写 SSE 文本」的封装 | §3 |
| `Flux<ServerSentEvent<T>>` | WebFlux（Reactor） | 用响应式流表达一条 SSE 数据流 | §4 |

`SseEmitter` 不是 SSE 协议本身，只是一个 Java 对象：你调 `emitter.send(...)`，框架负责把它序列化成 §1.3 的格式再写进响应。`Flux<ServerSentEvent>` 是 WebFlux 侧的等价物，框架把这条流映射成 SSE 响应。

## 2. SSE vs WebSocket

SSE 和 WebSocket 都能实现服务端推送，差异如下表：

| 维度 | SSE | WebSocket |
| :-- | :-- | :-- |
| 通信方向 | 服务端→客户端单向 | 双向 |
| 协议 | HTTP | 独立协议（ws://） |
| 自动重连 | 浏览器原生支持 | 需手动实现 |
| 消息回溯 | `Last-Event-ID` 原生支持 | 需自己实现 |
| 数据格式 | UTF-8 文本 | 文本或二进制 |
| 二进制数据 | 不支持（仅 UTF-8） | 原生支持 |
| 防火墙 | 通 HTTP 代理 | 可能被拦截 |
| 连接数限制 | HTTP/1.1 下浏览器 6 个 | 无限制 |
| 负载均衡 | 标准 HTTP 负载均衡 | 需会话粘滞 |
| 线程模型 | MVC 占线程 / WebFlux 非阻塞 | 非阻塞 |
| 适用场景 | 通知、进度、日志流 | 聊天、游戏、协同编辑 |

**一句话决策**：单向推送用 SSE，双向通信用 WebSocket。两者不互斥，可在同一项目中共存。

WebSocket 的完整用法参见 [WebSocket 实时通信](/spring/03-web/chapter-07-websocket)。认证方案参见 [安全架构](/spring/05-security/chapter-01-security-architecture)。下面从 Spring MVC 的 `SseEmitter` 开始。

## 3. Spring MVC 实现（SseEmitter）

**依赖：** Spring Boot Starter Web（已包含，无需额外依赖）。

MVC 下写 SSE，核心是 `SseEmitter`。它是 Spring MVC 对「异步写 SSE 流」的封装：Controller 方法返回 `SseEmitter` 后立即返回，连接保持打开，之后在任意线程调用 `emitter.send(...)` 推送事件，框架负责把事件序列化成 §1.3 的文本写进响应。

为什么需要它：HTTP 原生是「一次请求一次响应」，服务端不能主动开口。`SseEmitter` 利用 Servlet 3.0 的异步能力，把这次请求「挂起」成一条长连接，让服务端能在任意时刻往里写数据。这正是「SSE 单向推送」在 Servlet 栈里的落点。

::: info 📖 Flux 属于 WebFlux
`Flux<ServerSentEvent>` 是响应式（WebFlux）的写法，不放在本节，见 §4。
:::

### 3.1 最小示例

Controller 创建并返回 `SseEmitter`，同时注册三个生命周期回调。浏览器打开 `http://localhost:8080/notifications` 即可建立连接。

```java
@RestController
public class NotificationController {

    @Autowired
    private NotificationService notificationService;

    @GetMapping(value = "/notifications", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public SseEmitter stream() {
        // 超时 0 表示不超时，生产环境建议设一个较长值配合心跳
        SseEmitter emitter = new SseEmitter(0L);

        emitter.onCompletion(() -> log.info("SSE 连接完成"));
        emitter.onTimeout(() -> log.info("SSE 连接超时"));
        emitter.onError(e -> log.error("SSE 错误", e));

        notificationService.register(emitter);
        return emitter;
    }
}
```

### 3.2 消息推送服务

```java
@Service
public class NotificationService {

    // userId → emitter
    private final ConcurrentHashMap<String, SseEmitter> emitters = new ConcurrentHashMap<>();

    public void register(String userId, SseEmitter emitter) {
        emitters.put(userId, emitter);

        // 三种情况都要移除，防止内存泄漏
        Runnable cleanup = () -> emitters.remove(userId);
        emitter.onCompletion(cleanup);
        emitter.onTimeout(cleanup);
        emitter.onError(e -> cleanup.run());
    }

    // 广播
    public void broadcast(String eventName, Object data) {
        emitters.forEach((userId, emitter) -> {
            try {
                emitter.send(SseEmitter.event()
                        .name(eventName)
                        .data(data, MediaType.APPLICATION_JSON));
            } catch (IOException e) {
                emitters.remove(userId);  // 发送失败，移除死连接
            }
        });
    }

    // 推送给特定用户
    public void sendToUser(String userId, String eventName, Object data) {
        SseEmitter emitter = emitters.get(userId);
        if (emitter == null) return;
        try {
            emitter.send(SseEmitter.event()
                    .name(eventName)
                    .data(data, MediaType.APPLICATION_JSON));
        } catch (IOException e) {
            emitters.remove(userId);
        }
    }
}
```

### 3.3 带重连 ID 的实现

`EventSource` 断线后会自动重连，但重连后从哪继续？这靠 `id` 字段：服务端为每条消息标一个递增的 `id`，浏览器记住最后收到的 `id`；重连时自动在请求头带上 `Last-Event-ID`，服务端据此从断点处补推消息：

```java
@GetMapping(value = "/events", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
public SseEmitter streamEvents(HttpServletRequest request) {
    SseEmitter emitter = new SseEmitter(0L);

    String lastId = request.getHeader("Last-Event-ID");
    if (lastId != null) {
        // 补推断连期间的消息
        List<Event> missed = eventService.getAfter(lastId);
        missed.forEach(event -> {
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

    notificationService.register(emitter);
    return emitter;
}
```

这是 SSE 相比 WebSocket 的核心优势之一——浏览器原生支持断线重连 + `Last-Event-ID`，无需自己实现重连逻辑。

## 4. WebFlux 响应式实现

`Flux` 是 Reactor 的响应式类型，表示「0 到 N 个元素、随时间陆续发出的异步序列」。它天然适合 SSE 流：你声明好这条流，WebFlux 订阅它、把每个元素写成一条 SSE 事件，无需像 §3 那样手动调用 `send()`。这是 `SseEmitter` 与 `Flux` 的核心区别——前者你主动 `send()`，后者你声明数据来源、框架自动写。

线程模型也不同：MVC 下每个 SSE 连接占一个线程，1000 个连接需要 1000 个线程；WebFlux 非阻塞 I/O，1000 个连接可能只需要几十个线程。

```java
@RestController
public class ReactiveSseController {

    // 心跳流
    @GetMapping(value = "/flux/heartbeat", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public Flux<ServerSentEvent<String>> heartbeat() {
        return Flux.interval(Duration.ofSeconds(10))
                .map(seq -> ServerSentEvent.<String>builder()
                        .id(String.valueOf(seq))
                        .event("heartbeat")
                        .data("ping")
                        .build());
    }

    // 数据库变更流（MongoDB Tailable Cursor）
    @GetMapping(value = "/flux/users", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public Flux<ServerSentEvent<User>> streamUsers() {
        return userRepository.findWithTailableCursorBy()
                .map(user -> ServerSentEvent.builder()
                        .id(user.getId().toString())
                        .event("user-update")
                        .data(user)
                        .build());
    }
}
```

## 5. 前端对接

### 5.1 EventSource（不需要认证时）

`EventSource` API 简单，自动重连，但**不支持自定义 Header**（浏览器安全规范故意限制，防止通过 SSE 绕过 CORS 预检）。

```javascript
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

// 错误处理
source.onerror = () => {
    if (source.readyState === EventSource.CLOSED) {
        console.log('连接已关闭');
    } else {
        console.log('连接异常，浏览器会自动重连...');
    }
};

// 手动关闭
source.close();
```

### 5.2 fetch + ReadableStream（需要认证时）

`EventSource` 不支持自定义 Header，无法携带 Token。需要用 `fetch` 手动读取 SSE 流：

```javascript
async function streamWithAuth(url, token) {
    const response = await fetch(url, {
        headers: { 'Authorization': 'Bearer ' + token }
    });
    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        const text = decoder.decode(value);
        // 解析 SSE 格式
        text.split('\n\n').filter(Boolean).forEach(chunk => {
            const lines = chunk.split('\n');
            const dataLine = lines.find(l => l.startsWith('data:'));
            if (dataLine) {
                console.log(JSON.parse(dataLine.slice(5)));
            }
        });
    }
}
```

**选择标准**：不需要认证 → `EventSource`（自动重连更简单）。需要认证 → `fetch + ReadableStream`。

## 6. 生产环境要点

长连接在开发环境能跑通，生产环境还需解决四个问题：代理空闲断开、连接数失控、HTTP/1.1 连接上限、多实例消息丢失。

### 6.1 心跳保活

代理服务器（Nginx、云 SLB）有空闲超时（通常 60s）。SSE 连接长时间没有数据推送，代理会把它当成死连接断开。

解决方案：定期发送 SSE 注释行（以 `:` 开头，客户端不会收到事件）。注释行不产生任何事件，却能让连接上持续有字节流动，代理因此认为连接仍活跃、不主动断开：

```java
// MVC 心跳
@GetMapping(value = "/stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
public SseEmitter stream() {
    SseEmitter emitter = new SseEmitter(0L);

    // 每 30 秒发一次心跳
    ScheduledFuture<?> heartbeat = taskScheduler.scheduleAtFixedRate(() -> {
        try {
            emitter.send(SseEmitter.event().comment("keepalive"));
        } catch (IOException e) {
            // 连接已断开，取消心跳
        }
    }, Duration.ofSeconds(30));

    emitter.onCompletion(() -> heartbeat.cancel(false));
    emitter.onTimeout(() -> heartbeat.cancel(false));
    emitter.onError(e -> heartbeat.cancel(false));

    return emitter;
}
```

```java
// WebFlux 心跳
@GetMapping(value = "/flux/stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
public Flux<ServerSentEvent<String>> stream() {
    Flux<ServerSentEvent<String>> heartbeat = Flux.interval(Duration.ofSeconds(30))
            .map(seq -> ServerSentEvent.<String>builder().comment("keepalive").build());

    Flux<ServerSentEvent<String>> data = getDataStream();

    return Flux.merge(heartbeat, data);
}
```

### 6.2 连接数管理

每个 SSE 连接占用资源：MVC 下是一个线程，WebFlux 下是一个连接。不控制连接数会导致 OOM 或线程池耗尽。

```java
@Component
public class SseConnectionManager {

    private final AtomicInteger activeConnections = new AtomicInteger(0);
    private static final int MAX_CONNECTIONS = 10000;

    public SseEmitter createEmitter() {
        if (activeConnections.get() >= MAX_CONNECTIONS) {
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE,
                    "SSE 连接数已达上限");
        }
        activeConnections.incrementAndGet();

        SseEmitter emitter = new SseEmitter(0L);
        Runnable cleanup = activeConnections::decrementAndGet;
        emitter.onCompletion(cleanup);
        emitter.onTimeout(cleanup);
        emitter.onError(e -> cleanup.run());

        return emitter;
    }
}
```

监控连接数：

```java
@Scheduled(fixedRate = 60000)
public void logConnectionCount() {
    log.info("SSE 活跃连接数: {}", activeConnections.get());
}
Metrics.gauge("sse.connections.active", activeConnections);
```

### 6.3 HTTP/2 优势

HTTP/1.1 下浏览器对同一域名限制 6 个 TCP 连接。如果页面同时开了 6 个 SSE 流，后续的 HTTP 请求会被阻塞。

HTTP/2 的多路复用解决了这个问题——多个 SSE 流共享一个 TCP 连接，不再受 6 连接限制：

```yaml
server:
  http2:
    enabled: true
```

**生产环境强烈建议开启 HTTP/2**，尤其是 SSE 连接数较多的场景。

### 6.4 多实例扩展

和 WebSocket 一样，SSE 连接是有状态的。用户 A 连接实例 1，消息从实例 2 推送，A 收不到。

解决方案：

| 方案 | 原理 | 适用场景 |
|------|------|---------|
| Sticky Sessions | Nginx 根据 Cookie 将同一用户路由到同一实例 | 简单，但实例重启会丢连接 |
| Redis Pub/Sub | 所有实例订阅 Redis 频道，消息广播到所有实例 | 可靠，但增加 Redis 依赖 |
| 消息队列 | Kafka/RabbitMQ 广播事件 | 大规模场景 |

Redis Pub/Sub 方案：

```java
@Service
public class SseBroadcastService {

    @Autowired
    private RedisTemplate<String, String> redisTemplate;

    @Autowired
    private NotificationService notificationService;

    // 发布消息到 Redis
    public void publish(String channel, String message) {
        redisTemplate.convertAndSend(channel, message);
    }

    // 订阅 Redis 频道，推送给本实例的 SSE 客户端
    @Bean
    public RedisMessageListenerContainer container(RedisConnectionFactory factory) {
        RedisMessageListenerContainer container = new RedisMessageListenerContainer();
        container.setConnectionFactory(factory);
        container.addMessageListener((message, pattern) -> {
            String channel = new String(message.getChannel());
            String body = new String(message.getBody());
            // 推送给本实例的所有 SSE 客户端
            notificationService.broadcast(channel, body);
        }, new PatternTopic("sse:*"));
        return container;
    }
}
```

## 7. 常见错误

### ❌ 不设超时，默认 30 秒断开

`new SseEmitter()` 不传超时参数时，超时时间由 Servlet 容器决定，Tomcat 默认是 30 秒。连接闲置超过 30 秒，容器会强制结束这次异步请求。

```java
// ❌ 默认超时 30 秒，连接自动断开
SseEmitter emitter = new SseEmitter();

// ✅ 设为 0（不超时）或较长值，配合心跳保活
SseEmitter emitter = new SseEmitter(0L);
```

### ❌ send() 失败但没有移除 emitter

```java
// ❌ IOException 后 emitter 仍在 map 中，后续 send 继续失败，内存泄漏
try {
    emitter.send(data);
} catch (IOException e) {
    log.error("发送失败", e);
    // 没有移除！
}

// ✅ 发送失败立即移除
try {
    emitter.send(data);
} catch (IOException e) {
    emitters.remove(userId);
}
```

### ❌ 用 EventSource 发送带认证的请求

```javascript
// ❌ EventSource 不支持自定义 Header
const source = new EventSource('/notifications', {
    headers: { 'Authorization': 'Bearer xxx' }  // 无效，会被忽略
});

// ✅ 用 fetch 替代
const response = await fetch('/notifications', {
    headers: { 'Authorization': 'Bearer xxx' }
});
```

### ❌ 通过 SSE 发送二进制数据

```java
// ❌ SSE 只支持 UTF-8 文本，不能发二进制
emitter.send(imageBytes);  // 会抛异常

// ✅ 先 Base64 编码
emitter.send(Base64.getEncoder().encodeToString(imageBytes));
// 或者用 WebSocket 传输二进制
```

