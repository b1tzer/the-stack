# 长连接与实时通信

> 你用了三年 WebSocket 做推送通知——每次上线都写一套断线重连逻辑，心跳自己管，连接状态自己维护。直到有一天同事问："你这个场景为什么不用 SSE？"你才发现 WebSocket 的双向通道 90% 的时间只用了服务端→客户端这一个方向，半闲置的通道换来的是多一倍的代码量和排查难度。一个通知推送场景，三年前选了 WebSocket，三年后有人把它迁回了 SSE——不是 WebSocket 不好，是你选错了场景。

## 1. 为什么需要长连接

### 1.1 短连接的局限

在传统的 HTTP 短连接模型中，每一次数据交换都需要经历完整的 TCP 三次握手 → 数据传输 → 四次挥手过程。对于偶尔请求的场景（如浏览网页），这是合理的；但对于以下场景，短连接的开销就变得不可接受：

| 维度 | 短连接（HTTP/1.0 默认） | 长连接（HTTP/1.1 Keep-Alive / WebSocket） |
| :-- | :-- | :-- |
| 连接建立 | 每次请求都要握手，RTT 开销大 | 一次握手，后续复用 |
| 服务端推送 | 不支持，只能客户端轮询 | 原生支持双向通信 |
| 实时性 | 轮询间隔决定延迟，通常秒级 | 事件驱动，毫秒级延迟 |
| 资源消耗 | 大量 TIME_WAIT，端口耗尽 | 少量连接承载大量消息 |
| 适用场景 | REST API、网页浏览 | 聊天、实时行情、协同编辑、游戏 |

### 1.2 轮询 vs 长连接

在没有长连接的年代，开发者用各种轮询策略模拟实时通信：

```txt
┌─────────────────────────────────────────────────────────┐
│                    轮询策略对比                           │
├──────────────┬──────────────────────────────────────────┤
│  短轮询       │  客户端每隔 N 秒发一次请求                │
│              │  → 大量无效请求，浪费带宽                   │
├──────────────┼──────────────────────────────────────────┤
│  长轮询       │  客户端发请求，服务端 hold 住直到有数据    │
│              │  → 有数据或超时才返回，然后立即再发          │
│              │  → 比短轮询高效，但仍是"伪推送"            │
├──────────────┼──────────────────────────────────────────┤
│  长连接       │  一次连接建立后保持不断开                  │
│              │  → 服务端随时推送，客户端随时发送            │
│              │  → 真正的全双工实时通信                     │
└──────────────┴──────────────────────────────────────────┘
```

```java
// 短轮询示例 —— 简单但低效
@Scheduled(fixedDelay = 3000) // 每3秒轮询一次
public void pollMessages() {
    List<Message> msgs = messageService.getUnread(userId);
    if (!msgs.isEmpty()) {
        sendToClient(msgs);
    }
}
```

短轮询的问题很明显：大部分请求返回空结果，白白消耗服务端和网络资源。

## 2. WebSocket

### 2.1 协议握手过程

WebSocket 通过 HTTP Upgrade 机制升级连接，从 HTTP 协议切换到 WebSocket 协议：

```txt
客户端                                              服务端
  │                                                    │
  │  ── HTTP GET /chat ─────────────────────────────→  │
  │     Upgrade: websocket                             │
  │     Connection: Upgrade                            │
  │     Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==    │
  │                                                    │
  │  ←── 101 Switching Protocols ───────────────────── │
  │      Upgrade: websocket                            │
  │      Connection: Upgrade                           │
  │      Sec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzh...  │
  │                                                    │
  │  ═══ WebSocket 全双工帧通信 ════════════════════════ │
  │  ←── Frame (text) ───→                             │
  │  ←── Frame (binary) ──→                            │
  │  ←── Frame (ping/pong) →                           │
  │                                                    │
  │  ── Close Frame ────────────────────────────────→  │
  │  ←── Close Frame ───────────────────────────────── │
```

关键点：

- **101 状态码**表示协议切换成功
- `Sec-WebSocket-Key` + 魔术字符串经 SHA-1 哈希后回传，防止缓存代理误处理
- 握手完成后，HTTP 协议退场，后续通信使用 WebSocket 二进制帧

### 2.2 Java 实现 WebSocket

**服务端（JSR 356 / Jakarta WebSocket）：**

```java
import javax.websocket.*;
import javax.websocket.server.ServerEndpoint;
import java.io.IOException;
import java.util.concurrent.CopyOnWriteArraySet;

@ServerEndpoint("/ws/chat")
public class ChatEndpoint {

    // 线程安全的会话集合
    private static final CopyOnWriteArraySet<Session> sessions =
            new CopyOnWriteArraySet<>();

    @OnOpen
    public void onOpen(Session session) {
        sessions.add(session);
        System.out.println("连接建立: " + session.getId() +
                ", 当前在线: " + sessions.size());
    }

    @OnMessage
    public void onMessage(String message, Session sender) {
        // 广播给所有连接
        for (Session s : sessions) {
            if (s.isOpen()) {
                try {
                    s.getBasicRemote().sendText(
                        "[" + sender.getId() + "]: " + message);
                } catch (IOException e) {
                    e.printStackTrace();
                }
            }
        }
    }

    @OnClose
    public void onClose(Session session, CloseReason reason) {
        sessions.remove(session);
        System.out.println("连接关闭: " + session.getId() +
                ", 原因: " + reason.getCloseCode());
    }

    @OnError
    public void onError(Session session, Throwable error) {
        System.err.println("WebSocket 错误: " + error.getMessage());
    }
}
```

**客户端（Java WebSocket Client API）：**

```java
import javax.websocket.*;
import java.net.URI;

@ClientEndpoint
public class ChatClient {

    private Session session;

    @OnOpen
    public void onOpen(Session session) {
        this.session = session;
        System.out.println("已连接到服务端");
    }

    @OnMessage
    public void onMessage(String message) {
        System.out.println("收到: " + message);
    }

    public void send(String message) throws IOException {
        session.getBasicRemote().sendText(message);
    }

    public static void main(String[] args) throws Exception {
        WebSocketContainer container =
                ContainerProvider.getWebSocketContainer();
        ChatClient client = new ChatClient();
        container.connectToServer(client,
                new URI("ws://localhost:8080/ws/chat"));
        client.send("Hello WebSocket!");
    }
}
```

### 2.3 Spring WebSocket + STOMP

在实际项目中，通常使用 Spring 封装的 WebSocket + STOMP 协议，支持消息代理、订阅模式：

```java
@Configuration
@EnableWebSocketMessageBroker
public class WebSocketConfig implements WebSocketMessageBrokerConfigurer {

    @Override
    public void configureMessageBroker(MessageBrokerRegistry config) {
        // 客户端订阅地址前缀
        config.enableSimpleBroker("/topic", "/queue");
        // 客户端发送地址前缀
        config.setApplicationDestinationPrefixes("/app");
    }

    @Override
    public void registerStompEndpoints(StompEndpointRegistry registry) {
        registry.addEndpoint("/ws")
                .setAllowedOriginPatterns("*")
                .withSockJS(); // 降级支持
    }
}

@Controller
public class ChatController {

    @MessageMapping("/chat.send")    // 客户端发送到 /app/chat.send
    @SendTo("/topic/messages")       // 广播到订阅 /topic/messages 的客户端
    public ChatMessage send(ChatMessage message) {
        message.setTimestamp(LocalDateTime.now());
        return message;
    }
}
```

### 2.4 WebSocket 帧格式

WebSocket 以帧（Frame）为单位传输数据，帧结构如下：

```txt
 0                   1                   2                   3
 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
+-+-+-+-+-------+-+-------------+-------------------------------+
|F|R|R|R| opcode|M| Payload len |    Extended payload length    |
|I|S|S|S|  (4)  |A|     (7)     |           (16/64)             |
|N|V|V|V|       |S|             |   (if payload len==126/127)   |
| |1|2|3|       |K|             |                               |
+-+-+-+-+-------+-+-------------+-------------------------------+
|     Extended payload length continued, if payload len == 127  |
+-------------------------------+-------------------------------+
|                               |Masking-key, if MASK set to 1  |
+-------------------------------+-------------------------------+
| Masking-key (continued)       |          Payload Data         |
+-------------------------------+-------------------------------+
```

| Opcode | 含义 |
| :-- | :-- |
| 0x0 | Continuation Frame（延续帧） |
| 0x1 | Text Frame（文本帧） |
| 0x2 | Binary Frame（二进制帧） |
| 0x8 | Connection Close（关闭帧） |
| 0x9 | Ping |
| 0xA | Pong |

## 3. SSE（Server-Sent Events）

### 3.1 SSE 原理

SSE 是 HTML5 规范的一部分，基于 HTTP 协议实现服务端到客户端的单向推送。它的核心特点是：**简单、基于 HTTP、自动重连**。

```txt
客户端                                              服务端
  │                                                    │
  │  ── GET /events ────────────────────────────────→  │
  │     Accept: text/event-stream                      │
  │     Cache-Control: no-cache                        │
  │                                                    │
  │  ←── 200 OK ─────────────────────────────────────  │
  │      Content-Type: text/event-stream               │
  │      Transfer-Encoding: chunked                    │
  │                                                    │
  │  ←── data: {"type":"price","value":100.5} ────────  │
  │                                                    │
  │  ←── data: {"type":"price","value":101.2} ────────  │
  │                                                    │
  │  ←── event: alert                                  │
  │  ←── data: {"msg":"涨停！"} ────────────────────  │
  │                                                    │
  │  ... 连接保持，服务端随时推送 ...                    │
```

SSE 数据格式：

```txt
event: message          ← 事件类型（可选，默认 "message"）
id: 12345               ← 事件ID，用于断线重连（可选）
retry: 5000             ← 重连间隔，毫秒（可选）
data: {"key":"value"}   ← 数据体（必须）
                        ← 空行表示一条消息结束
```

### 3.2 Java 实现 SSE

```java
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.io.IOException;
import java.util.concurrent.*;

@RestController
public class SseController {

    // 保存所有客户端连接
    private final ConcurrentHashMap<String, SseEmitter> emitters =
            new ConcurrentHashMap<>();

    @GetMapping(value = "/subscribe", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public SseEmitter subscribe(@RequestParam String userId) {
        // 设置超时为0表示不超时（或设一个很大的值）
        SseEmitter emitter = new SseEmitter(0L);
        emitters.put(userId, emitter);

        emitter.onCompletion(() -> emitters.remove(userId));
        emitter.onTimeout(() -> emitters.remove(userId));
        emitter.onError(e -> emitters.remove(userId));

        // 发送初始连接确认
        try {
            emitter.send(SseEmitter.event()
                    .name("connected")
                    .data("连接成功"));
        } catch (IOException e) {
            emitters.remove(userId);
        }

        return emitter;
    }

    @PostMapping("/push/{userId}")
    public void push(@PathVariable String userId, @RequestBody String data) {
        SseEmitter emitter = emitters.get(userId);
        if (emitter != null) {
            try {
                emitter.send(SseEmitter.event()
                        .name("notification")
                        .data(data));
            } catch (IOException e) {
                emitters.remove(userId);
            }
        }
    }
}
```

### 3.3 WebSocket vs SSE 对比

| 特性 | WebSocket | SSE |
| :-- | :-- | :-- |
| 通信方向 | 全双工（双向） | 单向（服务端 → 客户端） |
| 协议 | ws:// / wss://（独立协议） | 基于 HTTP |
| 自动重连 | 需手动实现 | 浏览器原生支持 |
| 二进制数据 | 原生支持 | 仅文本（Base64 编码二进制） |
| 负载均衡 | 需要 sticky session | 标准 HTTP，天然兼容 |
| 防火墙/代理兼容 | 可能被拦截 | 好，标准 HTTP 流量 |
| 复杂度 | 较高 | 低 |
| 典型场景 | 聊天、游戏、协同编辑 | 通知推送、实时行情、日志流 |

**选型建议：**
- 需要双向通信 → WebSocket
- 只需服务端推送，客户端偶尔发请求（可用普通 HTTP POST） → SSE
- 需要最大兼容性和最简实现 → SSE
- 高频双向数据交换 → WebSocket

## 4. 长连接保活

长连接最大的生产问题是：连接会"悄无声息"地断开。原因包括 NAT 超时、防火墙空闲连接清理、ISP 中间设备重置等。保活机制是长连接稳定运行的生命线。

### 4.1 双层保活策略

```txt
┌─────────────────────────────────────────────────────────┐
│                    长连接保活架构                         │
│                                                         │
│  ┌───────────────────────────────────────────────────┐  │
│  │  应用层心跳（必须）                                 │  │
│  │  - 定时发送 Ping/Pong 帧                           │  │
│  │  - 通常 30s ~ 60s 一次                             │  │
│  │  - 超时未收到 Pong → 判定断线 → 触发重连            │  │
│  └───────────────────────────────────────────────────┘  │
│                                                         │
│  ┌───────────────────────────────────────────────────┐  │
│  │  TCP KeepAlive（辅助）                              │  │
│  │  - 操作系统层面的探活                               │  │
│  │  - 默认 2 小时发一次（太慢，不能依赖）              │  │
│  │  - 可调整参数：tcp_keepalive_time=60s               │  │
│  │  - 仅检测 TCP 连接是否存活，不保证应用层可达        │  │
│  └───────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

### 4.2 应用层心跳实现

```java
import javax.websocket.Session;
import java.util.concurrent.*;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

public class HeartbeatManager {

    private final ScheduledExecutorService scheduler =
            Executors.newSingleThreadScheduledExecutor(r -> {
                Thread t = new Thread(r, "heartbeat-checker");
                t.setDaemon(true);
                return t;
            });

    // 记录每个连接的最后活跃时间
    private final ConcurrentHashMap<String, Long> lastActiveMap =
            new ConcurrentHashMap<>();

    private static final long HEARTBEAT_INTERVAL = 30; // 秒
    private static final long TIMEOUT = 90; // 3次心跳未响应判定断线

    public void start() {
        scheduler.scheduleAtFixedRate(() -> {
            long now = System.currentTimeMillis();
            for (Map.Entry<String, Long> entry : lastActiveMap.entrySet()) {
                long elapsed = (now - entry.getValue()) / 1000;
                if (elapsed > TIMEOUT) {
                    System.out.println("连接超时: " + entry.getKey()
                            + ", 已 " + elapsed + " 秒未响应");
                    closeConnection(entry.getKey());
                    lastActiveMap.remove(entry.getKey());
                }
            }
        }, HEARTBEAT_INTERVAL, HEARTBEAT_INTERVAL, TimeUnit.SECONDS);
    }

    // 收到客户端心跳时调用
    public void onHeartbeat(String sessionId) {
        lastActiveMap.put(sessionId, System.currentTimeMillis());
    }

    // WebSocket Pong 帧回调
    public void onPong(String sessionId) {
        lastActiveMap.put(sessionId, System.currentTimeMillis());
    }

    public void register(String sessionId) {
        lastActiveMap.put(sessionId, System.currentTimeMillis());
    }

    public void unregister(String sessionId) {
        lastActiveMap.remove(sessionId);
    }

    private void closeConnection(String sessionId) {
        // 关闭连接的逻辑
    }
}
```

### 4.3 TCP KeepAlive 参数调优

```bash
# Linux 系统级 TCP KeepAlive 参数
# 默认值（太保守）
net.ipv4.tcp_keepalive_time = 7200    # 2小时才开始探测
net.ipv4.tcp_keepalive_intvl = 75     # 每次探测间隔 75 秒
net.ipv4.tcp_keepalive_probes = 9     # 探测 9 次失败才断开

# 生产环境推荐值
net.ipv4.tcp_keepalive_time = 60      # 60 秒无数据就开始探测
net.ipv4.tcp_keepalive_intvl = 10     # 每 10 秒探测一次
net.ipv4.tcp_keepalive_probes = 3     # 3 次失败断开
```

```java
// Java 中设置 TCP KeepAlive
ServerSocket serverSocket = new ServerSocket(8080);
serverSocket.setSoTimeout(30000); // accept 超时

Socket socket = serverSocket.accept();
socket.setKeepAlive(true); // 启用 TCP KeepAlive
socket.setSoTimeout(60000); // 读超时
socket.setTcpNoDelay(true); // 禁用 Nagle 算法，减少延迟

// NIO 方式
ServerSocketChannel channel = ServerSocketChannel.open();
channel.setOption(StandardSocketOptions.SO_KEEPALIVE, true);
channel.setOption(StandardSocketOptions.TCP_NODELAY, true);
```

### 4.4 重连策略

客户端断线后不应立即重连（可能服务端正在重启），推荐指数退避 + 抖动策略：

```java
public class ReconnectStrategy {

    private int attempt = 0;
    private final int maxAttempt = 10;
    private final long baseDelay = 1000;     // 1 秒
    private final long maxDelay = 30000;      // 30 秒
    private final Random random = new Random();

    public long nextDelay() {
        if (attempt >= maxAttempt) {
            return -1; // 放弃重连
        }
        // 指数退避：1s, 2s, 4s, 8s, 16s, 30s(封顶)
        long delay = Math.min(
                baseDelay * (1L << attempt),
                maxDelay
        );
        // 加入 ±20% 抖动，防止惊群效应
        long jitter = (long) (delay * 0.2 * (random.nextDouble() * 2 - 1));
        attempt++;
        return delay + jitter;
    }

    public void reset() {
        attempt = 0;
    }
}
```

## 5. IM 系统设计

一个生产级的即时通讯系统是长连接技术的集大成者。本节从四个核心维度拆解 IM 系统设计。

### 5.1 在线状态管理

```txt
┌─────────────────────────────────────────────────────────┐
│                    在线状态机                             │
│                                                         │
│   ┌──────────┐    登录     ┌──────────┐                 │
│   │  离线     │ ─────────→ │  在线     │                 │
│   │ OFFLINE  │            │  ONLINE  │                 │
│   └──────────┘            └────┬─────┘                 │
│        ↑                       │                        │
│        │                   心跳超时                       │
│        │                       ↓                        │
│        │               ┌──────────┐                     │
│        │    超时/主动   │  隐身     │                     │
│        └────────────── │ HIDDEN  │  (可选)              │
│          离线           └──────────┘                     │
└─────────────────────────────────────────────────────────┘
```

**状态存储方案对比：**

| 方案 | 优点 | 缺点 | 适用规模 |
| :-- | :-- | :-- | :-- |
| 数据库轮询 | 实现简单 | 延迟高，数据库压力大 | < 1万 |
| Redis Bitmap | O(1) 查询，内存高效 | 仅支持在线/离线二态 | 百万级 |
| Redis Hash + TTL | 支持多状态，自动过期 | 内存占用稍大 | 百万级 |
| 独立状态服务 | 可扩展，支持自定义状态 | 架构复杂 | 千万级 |

```java
// Redis 存储在线状态
@Component
public class PresenceService {

    @Autowired
    private StringRedisTemplate redis;

    private static final String PRESENCE_KEY = "im:presence:";
    private static final long ONLINE_TTL = 120; // 2 分钟 TTL

    public void online(String userId, String serverId) {
        String key = PRESENCE_KEY + userId;
        redis.opsForHash().put(key, "status", "ONLINE");
        redis.opsForHash().put(key, "server", serverId);
        redis.expire(key, ONLINE_TTL, TimeUnit.SECONDS);
    }

    public void heartbeat(String userId) {
        redis.expire(PRESENCE_KEY + userId, ONLINE_TTL, TimeUnit.SECONDS);
    }

    public void offline(String userId) {
        redis.delete(PRESENCE_KEY + userId);
    }

    public boolean isOnline(String userId) {
        return redis.hasKey(PRESENCE_KEY + userId);
    }

    // 查询用户在哪台服务器上（用于消息路由）
    public String getServerId(String userId) {
        return (String) redis.opsForHash()
                .get(PRESENCE_KEY + userId, "server");
    }
}
```

### 5.2 消息路由

当系统有多台消息服务器时，如何把消息投递到正确的服务器是核心问题：

```txt
                  ┌──────────────────────────────────────┐
                  │          消息路由架构                  │
                  └──────────────────────────────────────┘

    用户A ──→ ┌──────────┐         ┌──────────┐ ←── 用户B
              │ Server-1 │         │ Server-2 │
              └────┬─────┘         └────┬─────┘
                   │                     │
                   ↓                     ↓
              ┌──────────────────────────────────┐
              │       消息路由层（Message Router）  │
              │                                  │
              │  1. 查 Redis: 用户B在哪台服务器？  │
              │  2. 如果在本机 → 直接投递          │
              │  3. 如果在远端 → 通过 MQ 转发      │
              └──────────┬───────────────────────┘
                         │
                         ↓
              ┌──────────────────────┐
              │  消息队列 (Kafka/RMQ) │
              └──────────────────────┘
```

```java
@Service
public class MessageRouter {

    @Autowired
    private PresenceService presenceService;

    @Autowired
    private LocalSessionManager localSessions;

    @Autowired
    private KafkaTemplate<String, String> kafka;

    private final String currentServerId = "server-1"; // 当前服务器ID

    public void route(Message message) {
        String targetUserId = message.getTo();
        String targetServer = presenceService.getServerId(targetUserId);

        if (targetServer == null) {
            // 用户离线，存入离线消息
            saveOfflineMessage(message);
            return;
        }

        if (currentServerId.equals(targetServer)) {
            // 用户在本机，直接投递
            Session session = localSessions.get(targetUserId);
            if (session != null && session.isOpen()) {
                session.getBasicRemote().sendText(
                        JsonUtil.toJson(message));
            }
        } else {
            // 用户在其他服务器，通过 MQ 转发
            kafka.send("im.message.transfer." + targetServer,
                    JsonUtil.toJson(message));
        }
    }

    private void saveOfflineMessage(Message message) {
        // 存入数据库或 Redis List，用户上线后拉取
    }
}
```

### 5.3 消息可靠性

IM 系统中消息不能丢，也不能重复。需要多层保障：

```txt
┌─────────────────────────────────────────────────────────┐
│                 消息可靠投递流程                           │
│                                                         │
│  发送方                                                 │
│    │                                                    │
│    ├── 1. 客户端发送消息（带 clientMsgId）               │
│    │                                                    │
│    ↓                                                    │
│  服务端                                                 │
│    │                                                    │
│    ├── 2. 服务端收到，持久化到 DB                        │
│    │                                                    │
│    ├── 3. 服务端返回 ACK（带 serverMsgId + 序列号）      │
│    │                                                    │
│    ├── 4. 投递给接收方                                   │
│    │                                                    │
│    ├── 5. 接收方 ACK 确认                               │
│    │                                                    │
│    ├── 6. 如果 3s 未收到 ACK → 重试（最多 3 次）        │
│    │                                                    │
│    ↓                                                    │
│  接收方                                                 │
│    │                                                    │
│    ├── 7. 收到消息，写入本地 DB                         │
│    │                                                    │
│    ├── 8. 向服务端发送 ACK                              │
│    │                                                    │
│    └── 9. 上层展示消息                                   │
└─────────────────────────────────────────────────────────┘
```

```java
// 消息去重 —— 基于 clientMsgId
@Component
public class MessageDeduplicator {

    @Autowired
    private StringRedisTemplate redis;

    private static final String DEDUP_KEY = "im:msg:dedup:";
    private static final long DEDUP_TTL = 86400; // 24 小时去重窗口

    /**
     * @return true 如果是新消息，false 如果是重复消息
     */
    public boolean tryAcquire(String clientMsgId) {
        Boolean result = redis.opsForValue()
                .setIfAbsent(DEDUP_KEY + clientMsgId, "1",
                        DEDUP_TTL, TimeUnit.SECONDS);
        return Boolean.TRUE.equals(result);
    }
}

// 消息 ACK 机制
@Data
public class MessageAck {
    private String clientMsgId;   // 客户端消息ID（幂等键）
    private String serverMsgId;   // 服务端消息ID
    private long sequenceNo;      // 消息序列号（保证顺序）
    private long timestamp;
}
```

### 5.4 消息顺序保证

消息顺序是 IM 系统的经典难题。严格全局有序代价太高，通常保证**单聊有序**和**群聊分区有序**：

```java
/**
 * 基于 Redis 的自增序列号生成器
 * 保证同一会话内的消息有序
 */
@Component
public class SequenceGenerator {

    @Autowired
    private StringRedisTemplate redis;

    /**
     * 生成会话级别的自增序列号
     * @param conversationId 会话ID（单聊：uid1_uid2，群聊：groupId）
     */
    public long nextSequence(String conversationId) {
        String key = "im:seq:" + conversationId;
        Long seq = redis.opsForValue().increment(key);
        return seq != null ? seq : 0;
    }
}
```

**排序方案对比：**

| 方案 | 原理 | 优缺点 |
| :-- | :-- | :-- |
| 数据库自增 ID | 递增天然有序 | 集中瓶颈，分库后失效 |
| Redis INCR | 同上，但更快 | 单点瓶颈，需持久化 |
| Snowflake ID | 时间戳 + 机器 + 序列号 | 分布式，大致有序，偶尔需客户端修正 |
| 会话内序列号 | 每个会话独立自增 | 精确有序，会话间无序（可接受） |

**客户端修正策略：** 当客户端收到乱序消息时，按 `sequenceNo` 排序后再展示。通常配合一个滑动窗口（如缓存 5 条消息），等待缺失消息到达后一起展示。

### 5.5 IM 系统架构总览

```txt
┌─────────────────────────────────────────────────────────────────────┐
│                         IM 系统整体架构                              │
│                                                                     │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐                            │
│  │ 客户端A  │  │ 客户端B  │  │ 客户端C  │                            │
│  └────┬────┘  └────┬────┘  └────┬────┘                            │
│       │            │            │                                    │
│       ↓            ↓            ↓                                    │
│  ┌──────────────────────────────────────┐                          │
│  │        接入层 (Gateway)               │                          │
│  │  WebSocket 长连接管理 / 鉴权 / 协议解析  │                          │
│  └──────────────────┬───────────────────┘                          │
│                     │                                                │
│       ┌─────────────┼─────────────┐                                │
│       ↓             ↓             ↓                                │
│  ┌─────────┐  ┌──────────┐  ┌──────────┐                          │
│  │ 消息服务  │  │ 状态服务  │  │ 用户服务  │                          │
│  │ Message  │  │ Presence │  │  User    │                          │
│  └────┬────┘  └────┬─────┘  └────┬─────┘                          │
│       │             │             │                                  │
│       ↓             ↓             ↓                                  │
│  ┌─────────┐  ┌──────────┐  ┌──────────┐                          │
│  │  Kafka   │  │  Redis   │  │  MySQL   │                          │
│  │ (消息)   │  │ (状态)   │  │ (持久)   │                          │
│  └─────────┘  └──────────┘  └──────────┘                          │
│                                                                     │
│  ┌──────────────────────────────────────┐                          │
│  │         离线推送服务                   │                          │
│  │  APNs / FCM / 厂商推送通道            │                          │
│  └──────────────────────────────────────┘                          │
└─────────────────────────────────────────────────────────────────────┘
```

> **本章与其他章节的联系：**
>
> - **纵向（本卷内）：** 第 5-6 章介绍了 HTTP 协议和 TCP 通信基础，本章的 WebSocket 和 SSE 都建立在这些基础之上。第 7-8 章的 RPC 框架中也大量使用了长连接和心跳机制。第 10 章的网络诊断技术则用于排查长连接运行中的各种问题。
>
> - **横向（跨卷）：** 本章的 IM 系统设计与第二卷《Java 并发编程》中的线程池、并发集合密切相关（如 `CopyOnWriteArraySet` 管理会话）；消息队列的使用涉及第三卷《分布式架构》中的消息中间件选型；Redis 在线状态存储则与缓存设计一脉相承。
