# TCP/IP：性能参数与 Java 实践

> 本页与 [TCP/IP：可靠通信的基础](./chapter-02-tcp-ip.md) 配套，重点说明 TCP 性能参数以及用 Java 验证通信行为。

## 1. TCP 性能参数

### 1.1 Nagle 算法与 TCP_NODELAY

> **你的 Dubbo 接口 P99 延迟突然从 20ms 涨到 60ms。你没改任何代码。** 排查发现：压测脚本每次 `write()` 一小段数据后没调 `flush()`——数据被 Nagle 算法按住，等上一个 ACK 回来才放行，硬生生等了一个 RTT。一行 `socket.setTcpNoDelay(true)`，P99 回到 20ms。

**Nagle 算法**的设计初衷是减少网络中小包的数量。它的规则是：

- 如果发送缓冲区中的数据 >= MSS，立即发送
- 如果没有未确认的数据（in-flight），立即发送
- 否则，等收到 ACK 或者攒够 MSS 再发送

```txt
没有 Nagle:                         有 Nagle:
发送 "H" → 立即发送                  发送 "H" → 等待
发送 "e" → 立即发送                  发送 "e" → 等待（还有未确认数据）
发送 "l" → 立即发送                  收到 ACK → 发送 "Hel"
发送 "l" → 立即发送
发送 "o" → 立即发送

4 个包 → 1 个包（节省带宽，但增加延迟）
```

**Nagle 算法在交互式场景中是个灾难。** 假设你在玩在线游戏，每次按键都要等一个 RTT 才能发送——体感延迟直接翻倍。

**解决方案：** 设置 `TCP_NODELAY` 选项禁用 Nagle 算法：

```java
Socket socket = new Socket();
socket.setTcpNoDelay(true); // 禁用 Nagle 算法
```

**什么时候该禁用 Nagle？**

| 场景 | Nagle | TCP_NODELAY |
| :-- | :-- | :-- |
| 文件传输 | ✅ 保留（减少小包） | ❌ 不需要 |
| HTTP API 请求 | ❌ 禁用 | ✅ 启用 |
| 在线游戏 | ❌ 禁用 | ✅ 启用 |
| SSH 远程终端 | ❌ 禁用 | ✅ 启用 |
| 日志批量上报 | ✅ 保留 | ❌ 不需要 |

### 1.2 KeepAlive

TCP KeepAlive 是操作系统层面的机制，用于检测连接是否仍然存活：

```txt
默认参数（Linux）:
  tcp_keepalive_time   = 7200  (2小时无数据后开始探测)
  tcp_keepalive_intvl  = 75    (每隔75秒探测一次)
  tcp_keepalive_probes = 9     (连续9次无响应则断开)
```

```java
Socket socket = new Socket();
socket.setKeepAlive(true); // 启用 TCP KeepAlive
```

**但 2 小时太长了！** 在实际应用中，我们通常使用**应用层心跳**来更快地检测连接断开：

```java
// 应用层心跳（比 TCP KeepAlive 更灵活）
ScheduledExecutorService scheduler = Executors.newSingleThreadScheduledExecutor();
scheduler.scheduleAtFixedRate(() -> {
    try {
        outputStream.writeInt(0x01); // 心跳包
        outputStream.flush();
    } catch (IOException e) {
        // 连接已断开
        reconnect();
    }
}, 30, 30, TimeUnit.SECONDS); // 每 30 秒一次
```

**TCP KeepAlive vs 应用层心跳：**

| 维度 | TCP KeepAlive | 应用层心跳 |
| :-- | :-- | :-- |
| 粒度 | 粗（默认 2 小时） | 细（可自定义秒级） |
| 灵活性 | 低（只能检测连接存活） | 高（可携带业务数据） |
| 开销 | 极低（内核实现） | 稍高（应用层处理） |
| 推荐 | 作为兜底机制 | 作为主要心跳机制 |

### 1.3 Socket Buffer 调优

TCP 的发送和接收缓冲区大小直接影响吞吐量：

```java
Socket socket = new Socket();
socket.setSendBufferSize(256 * 1024);    // 发送缓冲区 256KB
socket.setReceiveBufferSize(256 * 1024); // 接收缓冲区 256KB
```

**带宽-延迟积（BDP, Bandwidth-Delay Product）：**

最佳的缓冲区大小 = 带宽 × 延迟（RTT）：

```txt
例如：带宽 1Gbps，RTT 10ms
BDP = 1,000,000,000 × 0.01 / 8 = 1.25 MB

→ 缓冲区至少设为 1.25MB，才能充分利用带宽
```

如果缓冲区太小，发送方会频繁等待 ACK（窗口被填满），带宽利用率下降。如果太大，浪费内存且可能增加延迟。

**Linux 内核参数调优：**

```bash
# 最大 TCP 缓冲区大小
net.core.rmem_max = 16777216        # 接收缓冲区最大 16MB
net.core.wmem_max = 16777216        # 发送缓冲区最大 16MB

# TCP 自动调优
net.ipv4.tcp_rmem = 4096 131072 16777216  # 最小 默认 最大
net.ipv4.tcp_wmem = 4096 65536 16777216

# 启用窗口缩放（支持大于 64KB 的窗口）
net.ipv4.tcp_window_scaling = 1
```

### 1.4 其他值得关注的 TCP 参数

| 参数 | 说明 | 推荐设置 |
| :-- | :-- | :-- |
| `SO_REUSEADDR` | 允许重用处于 TIME_WAIT 的地址 | 服务器端通常启用 |
| `SO_REUSEPORT` | 允许多个 Socket 绑定同一端口（Linux 3.9+） | 高并发服务器启用 |
| `SO_LINGER` | close() 时的行为（立即返回 or 等待数据发完） | 根据场景设置 |
| `SO_BACKLOG` | 连接等待队列长度 | 高并发场景增大 |
| `TCP_QUICKACK` | 禁用延迟 ACK（Linux） | 交互式场景启用 |

```java
ServerSocket serverSocket = new ServerSocket();
serverSocket.setReuseAddress(true);
serverSocket.bind(new InetSocketAddress(8080), 1024); // backlog = 1024
```

## 2. 用 Java 体验 TCP 通信

### 2.1 最简单的 TCP 示例

```java
// 服务端
public class SimpleTcpServer {
    public static void main(String[] args) throws IOException {
        try (ServerSocket serverSocket = new ServerSocket(8080)) {
            System.out.println("Server listening on port 8080...");
            try (Socket socket = serverSocket.accept();
                 BufferedReader in = new BufferedReader(
                     new InputStreamReader(socket.getInputStream()));
                 PrintWriter out = new PrintWriter(socket.getOutputStream(), true)) {
                
                String line;
                while ((line = in.readLine()) != null) {
                    System.out.println("Received: " + line);
                    out.println("Echo: " + line);
                }
            }
        }
    }
}

// 客户端
public class SimpleTcpClient {
    public static void main(String[] args) throws IOException {
        try (Socket socket = new Socket("localhost", 8080);
             PrintWriter out = new PrintWriter(socket.getOutputStream(), true);
             BufferedReader in = new BufferedReader(
                 new InputStreamReader(socket.getInputStream()));
             BufferedReader console = new BufferedReader(
                 new InputStreamReader(System.in))) {
            
            String input;
            while ((input = console.readLine()) != null) {
                out.println(input);
                System.out.println(in.readLine());
            }
        }
    }
}
```

这段代码展示了 TCP 通信的基本模式：**Socket 是连接的抽象，InputStream/OutputStream 是数据流的抽象。** 但这是阻塞式 I/O——每个连接占用一个线程，无法支撑高并发。这个痛点将驱动我们在后续章节引入 NIO 和 Netty。

### 2.2 用 Wireshark 观察 TCP 行为

理论不如实践。强烈建议你用 Wireshark 抓包，亲眼看到三次握手、数据传输、四次挥手的全过程：

```bash
# 启动抓包
sudo tcpdump -i lo -w /tmp/tcp_capture.pcap port 8080

# 运行上面的 Java 程序，发送几条消息

# 用 Wireshark 打开
wireshark /tmp/tcp_capture.pcap
```

在 Wireshark 中，你可以看到：

- SYN、SYN+ACK、ACK 的三次握手
- 每个 TCP 段的序列号和确认号
- Nagle 算法是否在起作用（观察小包是否被延迟）
- 窗口大小的变化
- 是否有重传
