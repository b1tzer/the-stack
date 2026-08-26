# WebSocket 实时通信

> HTTP 是请求-响应模型，服务端无法主动向客户端推送消息。聊天、实时通知、股票行情这些场景需要双向通信。WebSocket 在单个 TCP 连接上提供全双工通信，Spring 通过 STOMP 协议把它从原始字节流提升为应用级消息通信。

## 1. 最小可运行示例

先跑通一个 WebSocket 聊天室，再解释原理。

**依赖：**

```xml
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-websocket</artifactId>
</dependency>
```

**配置：**

```java
@Configuration
@EnableWebSocketMessageBroker
public class WebSocketConfig implements WebSocketMessageBrokerConfigurer {

    @Override
    public void configureMessageBroker(MessageBrokerRegistry config) {
        config.enableSimpleBroker("/topic");              // 订阅前缀
        config.setApplicationDestinationPrefixes("/app"); // 发送前缀
    }

    @Override
    public void registerStompEndpoints(StompEndpointRegistry registry) {
        registry.addEndpoint("/ws").setAllowedOriginPatterns("*").withSockJS();
    }
}
```

**Controller：**

```java
@Controller
public class ChatController {

    @MessageMapping("/chat.send")           // 客户端发送到 /app/chat.send
    @SendTo("/topic/chat")                  // 广播到 /topic/chat
    public ChatMessage send(ChatMessage message) {
        message.setTimestamp(LocalDateTime.now());
        return message;
    }
}
```

**前端（5 行核心）：**

```javascript
const stompClient = Stomp.over(new SockJS('/ws'));
stompClient.connect({}, () => {
    stompClient.subscribe('/topic/chat', (msg) => {
        console.log(JSON.parse(msg.body));
    });
    stompClient.send('/app/chat.send', {}, JSON.stringify({ content: 'hello' }));
});
```

跑起来后，打开两个浏览器窗口，在一个窗口发送消息，另一个窗口立即收到。这就是 WebSocket 的核心价值：**服务端主动推送，无需客户端轮询**。

## 2. 为什么需要 WebSocket

HTTP 轮询的代价：

| 方案 | 原理 | 问题 |
| :-- | :-- | :-- |
| 短轮询 | 客户端定时发请求 | 大量无效请求，延迟等于轮询间隔 |
| 长轮询 | 服务端 hold 住请求直到有数据 | 占用线程，连接频繁建立销毁 |
| SSE | 服务端单向推送 | 只能服务端→客户端，不能反向 |
| WebSocket | 全双工，单连接 | 需要协议升级，但一次握手后持续通信 |

WebSocket 握手过程：

```text
客户端 → 服务端: HTTP GET /ws (Upgrade: websocket)
服务端 → 客户端: HTTP 101 Switching Protocols
─── 协议升级完成，WebSocket 连接建立 ───
客户端 ↔ 服务端: 双向帧通信 (Text/Binary/Ping/Pong)
```

**什么时候用 WebSocket，什么时候用 SSE？**

需要双向通信（聊天、协作编辑、游戏）→ WebSocket。只需要服务端单向推送（通知、进度条、日志流）→ SSE 更轻量。参见 [SSE](/spring/02-web/chapter-07-sse)。

## 3. STOMP 协议

### 3.1 为什么不直接用原生 WebSocket

原生 WebSocket 只提供字节流传输，没有消息语义。你需要自己解决：
- 消息格式（JSON？Protobuf？怎么区分一条消息的边界？）
- 消息路由（推给谁？订阅/取消订阅怎么表达？）
- 请求-响应关联（发出去的消息，怎么知道对方收到了？）

STOMP（Simple Text Oriented Messaging Protocol）在 WebSocket 上定义了一层消息协议，类似 HTTP 的帧格式：

```text
SEND
destination:/app/chat.send
content-type:application/json

{"roomId":"1001","content":"hello"}
^@
```

类比：**WebSocket 是 TCP 连接，STOMP 是在 TCP 上跑的 HTTP**。TCP 不知道你要请求什么资源，HTTP 定义了请求方法、路径、头部。同样，WebSocket 不知道你要推给谁，STOMP 定义了目的地、订阅、消息格式。

Spring 推荐 STOMP 的原因：与 Spring 消息生态（`@MessageMapping`、`SimpMessagingTemplate`、消息代理）无缝集成，开发者不需要处理底层帧。

### 3.2 STOMP 核心命令

| 命令 | 方向 | 作用 |
|------|------|------|
| CONNECT | 客户端→服务端 | 建立 STOMP 会话 |
| SUBSCRIBE | 客户端→服务端 | 订阅目的地 |
| UNSUBSCRIBE | 客户端→服务端 | 取消订阅 |
| SEND | 客户端→服务端 | 发送消息到目的地 |
| MESSAGE | 服务端→客户端 | 推送消息到订阅者 |
| DISCONNECT | 客户端→服务端 | 断开会话 |

### 3.3 Spring WebSocket 架构

```text
┌─────────────────────────────────────────────────────────────┐
│                    应用层 (你的代码)                          │
│  @MessageMapping → Service → @SendTo / SimpMessagingTemplate │
├─────────────────────────────────────────────────────────────┤
│                    STOMP 消息协议                             │
│  帧格式: CONNECT / SEND / SUBSCRIBE / MESSAGE / DISCONNECT   │
├─────────────────────────────────────────────────────────────┤
│                    消息代理 (Broker)                          │
│  SimpleBroker / RabbitMQ / Kafka                             │
├─────────────────────────────────────────────────────────────┤
│                    WebSocket 传输层                           │
│  原生 WebSocket / SockJS (降级: xhr-streaming / xhr-polling)  │
└─────────────────────────────────────────────────────────────┘
```

## 4. 消息处理

### 4.1 路径分工

```text
客户端订阅: /topic/chat/1001  →  接收群聊消息
客户端订阅: /user/queue/notify →  接收个人通知
客户端发送: /app/chat.send     →  转发到 @MessageMapping("/chat.send")
```

路径前缀在配置中定义：

```java
config.enableSimpleBroker("/topic", "/queue");       // 订阅前缀
config.setApplicationDestinationPrefixes("/app");    // 发送前缀
config.setUserDestinationPrefix("/user");            // 点对点前缀
```

### 4.2 群聊

```java
@Controller
public class ChatController {

    @Autowired
    private SimpMessagingTemplate messagingTemplate;

    // 方式一：@SendTo 静态目的地
    @MessageMapping("/chat.send")
    @SendTo("/topic/chat/{roomId}")
    public ChatMessage send(ChatMessage message) {
        message.setTimestamp(LocalDateTime.now());
        return message;
    }

    // 方式二：SimpMessagingTemplate 动态目的地
    @MessageMapping("/chat.sendDynamic")
    public void sendDynamic(ChatMessage message) {
        messagingTemplate.convertAndSend(
            "/topic/chat/" + message.getRoomId(),
            message
        );
    }
}
```

`@SendTo` 适合目的地固定场景。`SimpMessagingTemplate` 适合根据消息内容动态决定推送到哪里。

### 4.3 点对点消息

```java
@Controller
public class PrivateMessageController {

    @Autowired
    private SimpMessagingTemplate messagingTemplate;

    @MessageMapping("/private.send")
    public void sendPrivate(PrivateMessage message) {
        // convertAndSendToUser 自动加上 /user/{username} 前缀
        messagingTemplate.convertAndSendToUser(
            message.getTargetUser(),
            "/queue/private",
            message
        );
    }
}
```

客户端订阅个人消息：

```javascript
stompClient.subscribe('/user/queue/private', (msg) => {
    console.log('收到私信:', JSON.parse(msg.body));
});
```

### 4.4 消息模型

```java
@Data
public class ChatMessage {
    public enum Type { CHAT, JOIN, LEAVE }

    private Type type;
    private String roomId;
    private String sender;
    private String content;
    private LocalDateTime timestamp;
}
```

## 5. 认证与安全

### 5.1 为什么不能在 HTTP 握手时认证

WebSocket 握手阶段（HTTP 101 切换协议之前），Spring Security 的 `SecurityContext` 还没有建立。即使你在 HTTP 层拦截了握手请求，认证信息也不会自动传递到后续的 STOMP 消息处理中。

正确做法：在 STOMP CONNECT 帧中携带 token，服务端在 CONNECT 阶段验证并绑定到会话。

### 5.2 STOMP CONNECT 帧认证

```java
@Configuration
public class WebSocketConfig implements WebSocketMessageBrokerConfigurer {

    @Override
    public void configureClientInboundChannel(ChannelRegistration registration) {
        registration.interceptors(new ChannelInterceptor() {
            @Override
            public Message<?> preSend(Message<?> message, MessageChannel channel) {
                StompHeaderAccessor accessor =
                    MessageHeaderAccessor.getAccessor(message, StompHeaderAccessor.class);

                if (StompCommand.CONNECT.equals(accessor.getCommand())) {
                    String token = accessor.getFirstNativeHeader("Authorization");
                    if (token != null && token.startsWith("Bearer ")) {
                        Authentication auth = jwtTokenProvider.validate(token.substring(7));
                        accessor.setUser(auth);
                    }
                }
                return message;
            }
        });
    }
}
```

### 5.3 消息级授权

```java
@Configuration
@EnableWebSocketSecurity
public class WebSocketSecurityConfig {

    @Bean
    public SecurityFilterChain webSocketSecurityFilterChain(
            MessageMatcherDelegatingAuthorizationManager messages) {
        messages
            .nullDestMatcher().authenticated()
            .simpSubscribeDestMatchers("/topic/admin/**").hasRole("ADMIN")
            .simpSubscribeDestMatchers("/user/queue/**").authenticated()
            .anyMessage().authenticated();
        return ...;
    }
}
```

## 6. 集群

### 6.1 SimpleBroker 的问题

`SimpleBroker` 只在当前 JVM 进程内有效。集群环境下：

```text
用户 A 连接实例 1，订阅 /topic/chat
用户 B 连接实例 2，发送消息到 /topic/chat
实例 2 的 SimpleBroker 只推给本实例的订阅者
用户 A 收不到消息 ❌
```

这是最隐蔽的 bug——单机测试完全正常，上线后集群环境消息丢失。

### 6.2 外部消息代理

用 RabbitMQ 或 Kafka 作为 STOMP 中继，所有实例的消息都经过同一个代理：

```java
@Configuration
public class WebSocketClusterConfig implements WebSocketMessageBrokerConfigurer {

    @Override
    public void configureMessageBroker(MessageBrokerRegistry config) {
        config.enableStompBrokerRelay("/topic", "/queue")
              .setRelayHost("rabbitmq-host")
              .setRelayPort(61613)
              .setClientLogin("guest")
              .setClientPasscode("guest");
        config.setApplicationDestinationPrefixes("/app");
    }
}
```

```text
┌──────────┐     ┌──────────┐     ┌──────────┐
│  实例 A   │     │  实例 B   │     │  实例 C   │
│  用户1    │     │  用户2    │     │  用户3    │
└────┬─────┘     └────┬─────┘     └────┬─────┘
     │                │                │
     └────────────────┼────────────────┘
                      │
              ┌───────┴───────┐
              │  RabbitMQ      │
              │  STOMP Broker  │
              └───────────────┘
```

RabbitMQ 需要启用 STOMP 插件：`rabbitmq-plugins enable rabbitmq_stomp`。

## 7. 断连与重连

WebSocket 长连接随时可能断开：网络闪断、服务重启、客户端切后台。不处理断连，用户会静默丢失消息。

### 7.1 心跳保活

配置心跳检测死连接：

```java
@Override
public void configureMessageBroker(MessageBrokerRegistry config) {
    config.enableSimpleBroker("/topic")
          .setHeartbeatValue(new long[]{10000, 10000}); // 发送/接收心跳间隔 (ms)
}
```

服务端每 10 秒发一次心跳，期望每 10 秒收到一次客户端心跳。超时未收到则断开连接。

### 7.2 客户端重连策略

```javascript
function connect() {
    const stompClient = Stomp.over(new SockJS('/ws'));
    stompClient.connect({}, () => {
        // 连接成功，订阅消息
        stompClient.subscribe('/topic/chat', onMessage);
        // 重连后拉取未读消息
        stompClient.send('/app/chat.sync', {}, JSON.stringify({ lastSync: lastTimestamp }));
    }, (error) => {
        // 连接失败，指数退避重连
        setTimeout(connect, Math.min(30000, 1000 * Math.pow(2, retryCount++)));
    });
}
```

指数退避：1s → 2s → 4s → 8s → ... → 30s（上限）。避免服务重启时所有客户端同时重连造成「惊群效应」。

### 7.3 服务端推送未读消息

客户端重连后，需要拉取断连期间的消息。常见做法：

```java
@MessageMapping("/chat.sync")
public List<ChatMessage> sync(SyncRequest request) {
    // 从数据库或 Redis 拉取 lastSync 之后的消息
    return messageService.getAfter(request.getLastSync());
}
```

## 8. 生产配置

### 8.1 消息大小限制

防止客户端发送超大消息撑爆内存：

```java
@Override
public void configureWebSocketTransport(WebSocketTransportRegistration registry) {
    registry.setMessageSizeLimit(64 * 1024)      // 单条消息最大 64KB
            .setSendBufferSizeLimit(512 * 1024)   // 发送缓冲区 512KB
            .setSendTimeLimit(10 * 1000);          // 发送超时 10s
}
```

### 8.2 连接数监控

WebSocket 长连接占用内存，每个连接约 50-100KB。监控连接数防止 OOM：

```java
@Component
public class WebSocketMetrics {

    private final AtomicInteger activeSessions = new AtomicInteger(0);

    @EventListener
    public void onSessionConnect(SessionConnectEvent event) {
        activeSessions.incrementAndGet();
        Metrics.gauge("ws.sessions.active", activeSessions);
    }

    @EventListener
    public void onSessionDisconnect(SessionDisconnectEvent event) {
        activeSessions.decrementAndGet();
        Metrics.gauge("ws.sessions.active", activeSessions);
    }
}
```

### 8.3 优雅关闭

服务重启时通知客户端主动断开，而不是等超时：

```java
@Component
public class GracefulShutdown {

    @Autowired
    private SimpMessagingTemplate messagingTemplate;

    @PreDestroy
    public void onShutdown() {
        // 通知所有在线客户端服务即将关闭
        messagingTemplate.convertAndSend("/topic/system/shutdown",
            "服务即将重启，请稍后重连");
    }
}
```

## 9. SockJS 降级

WebSocket 不是所有环境都支持——企业防火墙、代理服务器可能拦截 `Upgrade` 头。SockJS 提供自动降级：WebSocket → xhr-streaming → xhr-polling。

现代浏览器已全面支持 WebSocket，**仅在需要兼容旧环境或企业网络时启用 SockJS**。服务端已通过 `.withSockJS()` 启用，客户端：

```javascript
const socket = new SockJS('/ws');
const stompClient = Stomp.over(socket);
stompClient.connect({ 'Authorization': 'Bearer ' + token }, onConnect);
```

## 10. WebSocket vs SSE

| 维度 | WebSocket | SSE |
|------|-----------|-----|
| 通信方向 | 双向 | 服务端→客户端单向 |
| 协议 | 独立协议（ws://） | 基于 HTTP |
| 自动重连 | 需手动实现 | 浏览器原生支持 |
| 二进制数据 | 原生支持 | 只支持文本 |
| 负载均衡 | 需要会话粘滞 | 标准 HTTP 负载均衡 |
| 适用场景 | 聊天、协作编辑、游戏 | 通知、进度条、日志流 |

**决策依据**：只需要服务端推送 → 用 SSE（更简单、自动重连、标准 HTTP）。需要双向通信 → 用 WebSocket。两者不互斥，可以在同一个项目中共存。

> SSE 的完整用法参见 [Server-Sent Events](/spring/02-web/chapter-07-sse)。认证与安全的通用方案参见 [安全架构](/spring/05-security/chapter-01-security-architecture)。
