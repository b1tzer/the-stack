# WebSocket 实时通信

> HTTP 是请求-响应模型，服务端无法主动向客户端推送消息。聊天、实时通知、股票行情这些场景需要双向通信。WebSocket 在单个 TCP 连接上提供全双工通信，Spring 通过 STOMP 协议和 SockJS 降级方案，把 WebSocket 从原始的字节流提升为应用级消息通信。

## 1. 为什么需要 WebSocket

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

## 2. Spring WebSocket 架构

Spring 对 WebSocket 的支持分两层：

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

STOMP（Simple Text Oriented Messaging Protocol）是 WebSocket 上的消息协议，类似 HTTP 的帧格式：

```text
SEND
destination:/app/chat.send
content-type:application/json

{"roomId":"1001","content":"hello"}
^@
```

## 3. 基础配置

### 3.1 依赖

```xml
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-websocket</artifactId>
</dependency>
```

### 3.2 WebSocket 配置

```java
@Configuration
@EnableWebSocketMessageBroker  // 启用 STOMP 消息代理
public class WebSocketConfig implements WebSocketMessageBrokerConfigurer {

    @Override
    public void configureMessageBroker(MessageBrokerRegistry config) {
        // 客户端订阅路径前缀（服务端推送给客户端的目的地）
        config.enableSimpleBroker("/topic", "/queue");
        // 客户端发送消息的路径前缀（@MessageMapping 映射）
        config.setApplicationDestinationPrefixes("/app");
        // 用户目标前缀（点对点消息）
        config.setUserDestinationPrefix("/user");
    }

    @Override
    public void registerStompEndpoints(StompEndpointRegistry registry) {
        // WebSocket 连接端点，withSockJS 提供降级支持
        registry.addEndpoint("/ws")
                .setAllowedOriginPatterns("*")
                .withSockJS();
    }
}
```

路径分工：

```text
客户端订阅: /topic/chat/1001  →  接收群聊消息
客户端订阅: /user/queue/notify →  接收个人通知
客户端发送: /app/chat.send     →  转发到 @MessageMapping("/chat.send")
```

## 4. 消息处理

### 4.1 群聊场景

```java
@Controller
public class ChatController {

    @Autowired
    private SimpMessagingTemplate messagingTemplate;

    // 客户端发送到 /app/chat.send，转发到 /topic/chat/{roomId}
    @MessageMapping("/chat.send")
    @SendTo("/topic/chat/{roomId}")  // 静态目的地
    public ChatMessage sendMessage(ChatMessage message) {
        message.setTimestamp(LocalDateTime.now());
        message.setSender(SecurityContextHolder.getContext().getName());
        return message;
    }

    // 动态目的地：根据消息内容决定推送到哪个房间
    @MessageMapping("/chat.sendDynamic")
    public void sendDynamicMessage(ChatMessage message) {
        message.setTimestamp(LocalDateTime.now());
        // SimpMessagingTemplate 可以动态指定目的地
        messagingTemplate.convertAndSend(
            "/topic/chat/" + message.getRoomId(),
            message
        );
    }

    // 用户加入通知
    @MessageMapping("/chat.join/{roomId}")
    @SendTo("/topic/chat/{roomId}")
    public ChatMessage join(@DestinationVariable String roomId,
                            Principal principal) {
        return new ChatMessage("SYSTEM", principal.getName() + " 加入了聊天室", LocalDateTime.now());
    }
}
```

### 4.2 点对点消息

```java
@Controller
public class PrivateMessageController {

    @Autowired
    private SimpMessagingTemplate messagingTemplate;

    // 发送私信：推送到 /user/{targetUser}/queue/private
    @MessageMapping("/private.send")
    public void sendPrivateMessage(PrivateMessage message) {
        message.setTimestamp(LocalDateTime.now());
        // convertAndSendToUser 自动加上 /user/{username} 前缀
        messagingTemplate.convertAndSendToUser(
            message.getTargetUser(),  // 目标用户名
            "/queue/private",         // 目标路径
            message
        );
    }
}
```

客户端订阅个人消息：

```javascript
// 订阅个人队列（SockJS + Stomp.js）
stompClient.subscribe('/user/queue/private', (msg) => {
    console.log('收到私信:', JSON.parse(msg.body));
});
```

### 4.3 消息模型

```java
@Data
public class ChatMessage {
    public enum Type { CHAT, JOIN, LEAVE }

    private Type type;
    private String roomId;
    private String sender;
    private String content;
    private LocalDateTime timestamp;

    // 构造器...
}
```

## 5. 认证与安全

### 5.1 WebSocket 握手时认证

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
                    // 从 STOMP CONNECT 帧的 header 中提取 token
                    String token = accessor.getFirstNativeHeader("Authorization");
                    if (token != null && token.startsWith("Bearer ")) {
                        // 验证 JWT，构建 Authentication
                        Authentication auth = jwtTokenProvider.validate(token.substring(7));
                        accessor.setUser(auth);  // 绑定到 WebSocket 会话
                    }
                }
                return message;
            }
        });
    }
}
```

### 5.2 消息级授权

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

## 6. SockJS 降级

WebSocket 不是所有环境都支持（企业防火墙、代理服务器可能拦截）。SockJS 提供自动降级：

```text
优先级: WebSocket → xhr-streaming → xhr-polling → iframe → jsonp
```

服务端已通过 `.withSockJS()` 启用，客户端：

```javascript
// 使用 SockJS 客户端
const socket = new SockJS('/ws');
const stompClient = Stomp.over(socket);

stompClient.connect({'Authorization': 'Bearer ' + token}, (frame) => {
    stompClient.subscribe('/topic/chat/1001', (msg) => {
        console.log(JSON.parse(msg.body));
    });
});
```

## 7. 集群方案

单机 `SimpleBroker` 只在本进程内有效。集群环境需要外部消息代理：

```java
// 使用 RabbitMQ 作为 STOMP 代理
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

**最佳实践：**

1. **生产环境用外部代理**——SimpleBroker 只适合开发，集群用 RabbitMQ/Kafka
2. **连接数监控**——WebSocket 长连接占用内存，监控连接数防止 OOM
3. **心跳保活**——配置心跳间隔检测死连接
4. **消息大小限制**——防止客户端发送超大消息
5. **优雅关闭**——服务重启时通知客户端重连
