# 长连接协议与保活

> 长连接常用于通知推送、实时行情、聊天和协同编辑等场景。但「保持连接」并不能直接解决实时通信问题，开发者还需要选择合适的应用协议，处理连接空闲超时、网络中断、心跳检测和断线恢复。本章比较 HTTP 持久连接、WebSocket 与 SSE 的适用边界，再说明如何设计保活和重连策略。

## 1. 为什么需要长连接

### 1.1 短连接的局限

HTTP 请求不一定对应一条新建的 TCP 连接。如果客户端每次请求后都关闭连接，那么下一次请求通常需要重新建立 TCP 连接；如果使用 HTTP/1.1 持久连接，多个请求可以复用同一条连接。对于偶尔请求的场景（如浏览网页），反复建连的开销尚可接受；对于频繁请求的场景，反复建连带来的 RTT 和资源成本会明显上升。

| 维度 | 短连接（每请求新建连接） | 持久连接（连接复用） |
| :-- | :-- | :-- |
| 连接建立 | 每次请求都要握手，RTT 开销大 | 一次握手，后续复用 |
| 实时性 | 取决于轮询间隔和网络 RTT | 连接保持，但延迟仍受调度与网络影响 |
| 资源消耗 | 主动关闭方可能积累 TIME_WAIT | 持续占用 fd、内存、连接跟踪表 |

这里比较的是连接管理方式，不是应用通信协议。HTTP/1.1 持久连接本身不等于服务端可以随时主动推送应用数据，WebSocket 和 SSE 才分别提供双向通信和服务端事件流机制。不能把 WebSocket 当成 HTTP 持久连接的直接替代方案。

### 1.2 轮询 vs 长连接

在没有长连接的年代，开发者用各种轮询策略模拟实时通信：

```txt
┌─────────────────────────────────────────────────────────┐
│                    轮询策略对比                           │
├──────────────┬──────────────────────────────────────────┤
│  短轮询       │  客户端每隔 N 秒发一次请求                  │
│              │  → 大量无效请求，浪费带宽                   │
├──────────────┼──────────────────────────────────────────┤
│  长轮询       │  客户端发请求，服务端 hold 住直到有数据       │
│              │  → 有数据或超时才返回，然后立即再发           │
│              │  → 减少无数据请求，但每次响应后仍需重发       │
├──────────────┼──────────────────────────────────────────┤
│  长连接       │  一次连接建立后保持不断开                   │
│              │  → 服务端随时推送，客户端随时发送            │
│              │  → 一条连接上持续交换双向消息                │
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
- 服务端根据客户端提供的 `Sec-WebSocket-Key` 和协议规定的 GUID 计算 `Sec-WebSocket-Accept`，用于完成 WebSocket 握手校验；该过程不提供用户身份认证，应用仍需校验登录状态、权限和连接来源
- 握手成功后，双方按 WebSocket 协议交换帧，应用数据可以是文本帧或二进制帧，Ping、Pong 和 Close 用于控制连接状态

### 2.2 Java 实现 WebSocket

JDK 本身不提供完整的 WebSocket 服务端 API，具体实现通常由 Servlet 容器或其他 WebSocket 实现提供。下面的示例使用 `javax.websocket`（Java EE 时代的 JSR 356）；如果使用 Jakarta EE 9 及之后的容器，应改用 `jakarta.websocket` 命名空间。示例为教学简化，省略了会话生命周期管理、慢客户端和广播并发策略。

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
import java.io.IOException;
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

Spring 项目通常在 Spring WebSocket 中配置 STOMP、消息代理和订阅模型。这些框架配置与生产用法见 [Spring WebSocket 实时通信](../../spring/03-web/chapter-07-websocket.md)。

### 2.3 WebSocket 帧格式

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

两条协议约束值得单独记住：客户端发往服务端的帧必须使用掩码，服务端发往客户端的帧不使用掩码；一条逻辑消息可以由多个数据帧组成，`Continuation Frame` 用于承接分片，控制帧有独立的长度和分片限制。

## 3. SSE（Server-Sent Events）

### 3.1 SSE 原理

SSE 基于 HTTP 协议实现服务端到客户端的单向推送，浏览器 `EventSource` 原生支持自动重连。这里的自动重连只针对连接断开后重新建立连接，不包含业务状态恢复。自动重连也不等于事件自动补齐：浏览器会按协议处理重连，并在适用时通过 `Last-Event-ID` 告知服务端，但服务端是否保存事件、是否识别该请求头、能否重放遗漏事件，都属于服务端实现职责，与客户端重连是两回事。

```txt
客户端                                              服务端
  │                                                    │
  │  ── GET /events ────────────────────────────────→  │
  │     Accept: text/event-stream                      │
  │     Cache-Control: no-cache                        │
  │                                                    │
  │  ←── 200 OK ─────────────────────────────────────  │
  │      Content-Type: text/event-stream               │
  │      （HTTP/1.1 下可能用 chunked 传输，HTTP/2 用自身数据帧）│
  │                                                    │
  │  ←── data: {"type":"price","value":100.5} ──────── │
  │                                                    │
  │  ←── data: {"type":"price","value":101.2} ──────── │
  │                                                    │
  │  ←── event: alert                                  │
  │  ←── data: {"msg":"涨停！"} ────────────────────    │
  │                                                    │
  │  ... 连接保持，服务端随时推送 ...                      │
```

SSE 数据格式：

```txt
event: message          ← 事件类型（可选，默认 "message"）
id: 12345               ← 事件ID，用于断线重连（可选）
retry: 5000             ← 重连间隔，毫秒（可选）
data: {"key":"value"}   ← 数据体（必须）
                        ← 空行表示一条消息结束
```

`data:` 可以出现多次，客户端会按规范把这些行组合成事件数据，不是只有单独一行。`id:`、`event:` 和 `retry:` 各有解析规则，`id:` 用于断线重连时通过 `Last-Event-ID` 告知服务端从哪条事件继续。

### 3.2 Java 实现 SSE

Spring 项目中的 `SseEmitter`、WebFlux 实现和生产配置见 [Server-Sent Events](../../spring/03-web/chapter-08-sse.md)。

```java
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.io.IOException;
import java.util.concurrent.*;

@RestController
public class SseController {

    // 按 userId 保存连接，一个用户只保留一个连接；同一用户多标签页/多设备同时连接时，
    // 新连接会覆盖旧连接，需要改用 Map<String, Set<SseEmitter>> 等结构才能同时推送
    private final ConcurrentHashMap<String, SseEmitter> emitters =
            new ConcurrentHashMap<>();

    @GetMapping(value = "/subscribe", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public SseEmitter subscribe(@RequestParam String userId) {
        // 0L 表示不设置该 emitter 的超时时间，不等于连接永远不会被代理、容器或网络设备关闭
        SseEmitter emitter = new SseEmitter(0L);
        emitters.put(userId, emitter);

        emitter.onCompletion(() -> emitters.remove(userId, emitter));
        emitter.onTimeout(() -> emitters.remove(userId, emitter));
        emitter.onError(e -> emitters.remove(userId, emitter));

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
                emitters.remove(userId, emitter);
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
| 负载均衡 | 需处理长连接路由、超时和故障恢复；是否需会话亲和性取决于服务端架构 | 同样需管理长连接生命周期；HTTP 协议本身不保证后端状态共享 |
| 防火墙/代理兼容 | 可能被拦截 | 好，标准 HTTP 流量 |
| 复杂度 | 较高 | 低 |
| 典型场景 | 聊天、游戏、协同编辑 | 通知推送、实时行情、日志流 |

**选型建议：**
- 需要双向通信，客户端和服务端都要频繁发送消息 → WebSocket
- 主要服务端推送文本事件，客户端可用普通 HTTP 请求提交命令 → SSE
- 浏览器环境下的单向文本推送，实现更简单 → SSE，但仍需处理代理缓冲、网关超时和连接数限制
- 高频双向数据交换或原生二进制消息 → WebSocket

## 4. 长连接保活

长连接最大的生产问题是：连接会"悄无声息"地断开。原因包括 NAT 超时、防火墙空闲连接清理、ISP 中间设备重置等。保活机制是长连接稳定运行的生命线。

### 4.1 双层保活策略

```txt
┌─────────────────────────────────────────────────────────┐
│                    长连接保活架构                         │
│                                                         │
│  ┌───────────────────────────────────────────────────┐  │
│  │  应用层心跳（按业务与网络环境配置）                    │  │
│  │  - 定时发送 Ping/Pong 帧                           │  │
│  │  - 周期结合空闲超时与故障发现时间确定                  │  │
│  │  - 超时未收到 Pong → 判定断线 → 触发重连              │  │
│  └───────────────────────────────────────────────────┘  │
│                                                         │
│  ┌───────────────────────────────────────────────────┐  │
│  │  TCP KeepAlive（辅助）                             │  │
│  │  - 操作系统层面的探活                                │  │
│  │  - Linux 默认约 2 小时才探测，通常需要调小             │  │
│  │  - 可调整参数：tcp_keepalive_time 等                │  │
│  │  - 仅检测 TCP 连接是否存活，不保证应用层可达           │  │
│  └───────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

### 4.2 心跳超时检测示例

心跳要完成三个动作：按周期发送探测（如 Ping），收到响应后更新状态，超时未响应则判定断线并触发重连。下面的示例只实现了第三部分（超时扫描），没有真正发送 Ping 或关联 Pong，不能作为完整的心跳管理器。发送协议级 Ping 需调用 `RemoteEndpoint` 的 Ping API，接收 Pong 需注册 `PongMessage` 处理器，具体导入与所选的 javax/jakarta 命名空间保持一致。

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

以下参数以 Linux 常见配置为例，实际默认值应以目标系统为准。系统级参数决定启用 TCP KeepAlive 的 socket 使用的默认探测行为，应用还需要为相应连接启用 `SO_KEEPALIVE`。这些设置不会自动等价于应用层心跳，也不能保证业务请求可以成功处理。

```bash
# Linux 系统级 TCP KeepAlive 参数
# 默认值
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
socket.setKeepAlive(true); // 启用 TCP 层探测，具体探测参数由操作系统决定
socket.setSoTimeout(60000); // 阻塞读超时，不检测对端是否存活
socket.setTcpNoDelay(true); // 禁用 Nagle 算法，属于延迟优化，与保活无关

// NIO 方式
ServerSocketChannel serverChannel = ServerSocketChannel.open();
serverChannel.bind(new InetSocketAddress(8080));

SocketChannel socketChannel = serverChannel.accept();
socketChannel.setOption(StandardSocketOptions.SO_KEEPALIVE, true);
socketChannel.setOption(StandardSocketOptions.TCP_NODELAY, true);
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

这里 `maxAttempt = 10` 表示最多退避 10 次，初次连接不计入重试次数；抖动使用对称抖动（约基准延迟的 80%~120%），生产系统也常用 Full Jitter（零到退避上限之间随机），选择哪一种应依据重试同步程度和服务恢复时的负载情况，而不是把一种算法当成唯一正确方案。连接恢复成功后应调用 `reset()` 重置退避状态。

重连成功不等于业务恢复：客户端可能仍需重新认证、恢复订阅、补拉断线期间的消息，或使用 SSE 的 `Last-Event-ID` 机制请求服务端恢复事件流。是否能补回消息取决于服务端是否保存事件及其重放策略。
