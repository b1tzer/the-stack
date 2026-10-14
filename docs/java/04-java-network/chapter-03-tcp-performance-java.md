# TCP/IP：性能参数与 Java 实践

> 本页与 [TCP/IP：可靠通信的基础](./chapter-02-tcp-ip.md) 配套，重点说明 TCP 性能参数以及用 Java 验证通信行为。

## 1. TCP 性能参数

### 1.1 Nagle 算法与 TCP_NODELAY

> **一个 RPC 客户端把逻辑请求拆成多个小段发送时，P99 延迟明显升高。** 排查时先要分清两层：`write()` 后没调 `flush()`，数据可能还停在 Java 缓冲区；数据真正到达 TCP 层后，如果发送端还有未确认数据，Nagle 算法可能暂缓后续小段，直到收到 ACK 或满足发送条件。前者是应用层缓冲，后者是 TCP 层行为，不能混为一谈。是否禁用 Nagle（`setTcpNoDelay(true)`），应由发送时序、ACK 行为和延迟测试决定，不能只看 P99 上升就下结论。

**Nagle 算法**的设计初衷是减少网络中小包的数量。它的规则是：

- 如果发送缓冲区中的数据 >= MSS，立即发送
- 如果没有未确认的数据（in-flight），立即发送
- 否则，等收到 ACK 或者攒够 MSS 再发送

```txt
发送端                           接收端
  |                                |
  |--- "Hel" ------------------->  |  首段无未确认数据，立即发送
  |                                |
  | 写入 "l"，有未确认数据，暂缓       |
  | 写入 "o"，继续等待               |
  |<------------- ACK -------------|
  |---  "lo" 合并后发送 ----------->|
```

Nagle 算法可能增加交互式请求的延迟，尤其是应用把一个逻辑请求拆成多个小段发送、而接收端暂时没有数据可回送时。但这不意味着所有交互式应用都应禁用 Nagle：是否调整 `TCP_NODELAY`，应由实际的发送时序、ACK 行为和延迟测试决定。

**解决方案：** 设置 `TCP_NODELAY` 选项禁用 Nagle 算法：

```java
Socket socket = new Socket();
socket.setTcpNoDelay(true); // 禁用 Nagle 算法
```

**什么时候该禁用 Nagle？**

表格中的建议是排查方向，不是普遍规则，最终决定应由实测支持：

| 常见场景 | 排查建议 |
| :-- | :-- |
| RPC / 交互式协议 | 先测量小写入是否引入等待，再比较 TCP_NODELAY 开关前后的延迟与报文数量 |
| 大块文件传输 | 优先检查吞吐、窗口、丢包与读写速率，不要默认调整 Nagle |
| 批量日志发送 | 优先通过应用层批量聚合减少写入次数，再测量是否需要禁用 Nagle |

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

对于需要及时感知连接失效的 RPC、长连接协议或经过 NAT 的连接，2 小时才开始的探测太慢，通常改用**应用层心跳**更快检测连接断开：

```java
// 应用层心跳：仅示意，生产需定义完整的请求-响应协议与超时判定
ScheduledExecutorService scheduler = Executors.newSingleThreadScheduledExecutor();
scheduler.scheduleAtFixedRate(() -> {
    try {
        out.write(0x01); // 心跳请求
        out.flush();
        // 还需读取对端的心跳响应，记录最后有效响应时间；
        // 超过期限未收到响应，才判定连接可能失效
    } catch (IOException e) {
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

BDP 用于估算链路在一个 RTT 内需要容纳多少在途数据：

```txt
例如：带宽 1Gbps，RTT 10ms
BDP = 1,000,000,000 bit/s × 0.01s / 8 = 1,250,000 bytes ≈ 1.25 MB
```

BDP 不是 Socket 缓冲区的统一配置下限。如果接收窗口或拥塞窗口长期小于所需的在途数据量，发送端就无法持续以链路允许的速率发送，吞吐量可能因此下降。但瓶颈也可能在应用层处理速度、丢包或拥塞控制，单纯增大缓冲区并不一定提高吞吐。缓冲区过大还会增加内存占用，应结合实际 RTT、吞吐、窗口与丢包情况测量后再调整。

**Linux 缓冲区相关参数示例（sysctl 配置，非直接执行的 shell 命令）：**

以下参数适用于 Linux，具体默认值与行为取决于内核版本。应写入系统配置文件，修改前先检查当前值，并通过吞吐、RTT、窗口与内存使用情况验证收益。

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

### 1.4 端口复用：`SO_REUSEADDR` 与 `SO_REUSEPORT`

这两个选项都影响“绑定”，但解决的问题不同，应在 `bind()` 前设置。

`SO_REUSEADDR` 主要处理流式 Socket 的地址复用。对 TCP 而言，它通常允许程序在涉及同一地址的旧连接处于 `TIME_WAIT` 时继续绑定；精确语义取决于 Socket 类型和操作系统。它不会删除或缩短 `TIME_WAIT`，也没有解决所有 `Address already in use` 的能力。

```java
ServerSocket serverSocket = new ServerSocket();
serverSocket.setReuseAddress(true);
serverSocket.bind(new InetSocketAddress(8080), 1024);
```

`SO_REUSEPORT` 允许多个监听 Socket 绑定同一地址和端口。它适合需要多个监听端点的场景，但负载分发方式、健康检查和连接迁移行为取决于操作系统，不能只凭“高并发”就默认启用。

```java
ServerSocketChannel channel = ServerSocketChannel.open();
if (channel.supportedOptions().contains(StandardSocketOptions.SO_REUSEPORT)) {
    channel.setOption(StandardSocketOptions.SO_REUSEPORT, true);
}
channel.bind(new InetSocketAddress(8080), 1024);
```

`SO_REUSEADDR` 和 `SO_REUSEPORT` 在绑定后修改都不会生效。上线前应在目标操作系统上验证绑定结果与流量分布。

### 1.5 关闭行为与平台特有参数

| 参数/机制 | 说明 | 调优依据 |
| :-- | :-- | :-- |
| `SO_LINGER` | 控制关闭 Socket 时对待发送数据的处理与 close() 的等待行为 | 根据协议关闭语义决定 |
| ServerSocket 的 `backlog` 参数 | 请求操作系统设置监听端连接队列容量 | 结合连接建立速率与队列溢出检查 |
| `TCP_QUICKACK`（Linux 特有） | 控制特定情况下的 ACK 行为 | 仅明确的性能诊断和平台验证后考虑 |

## 2. 用 Java 体验 TCP 通信

### 2.1 阻塞式 Echo 示例

```java
// 服务端
public class SimpleTcpServer {
    public static void main(String[] args) throws IOException {
        try (ServerSocket serverSocket = new ServerSocket(8080)) {
            System.out.println("Server listening on port 8080...");
            try (Socket socket = serverSocket.accept();
                 BufferedReader in = new BufferedReader(
                     new InputStreamReader(socket.getInputStream(), StandardCharsets.UTF_8));
                 PrintWriter out = new PrintWriter(
                     new OutputStreamWriter(socket.getOutputStream(), StandardCharsets.UTF_8), true)) {
                
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
             PrintWriter out = new PrintWriter(
                 new OutputStreamWriter(socket.getOutputStream(), StandardCharsets.UTF_8), true);
             BufferedReader in = new BufferedReader(
                 new InputStreamReader(socket.getInputStream(), StandardCharsets.UTF_8));
             BufferedReader console = new BufferedReader(
                 new InputStreamReader(System.in, StandardCharsets.UTF_8))) {
            
            String input;
            while ((input = console.readLine()) != null) {
                out.println(input);
                System.out.println(in.readLine());
            }
        }
    }
}
```

这段代码展示了 TCP 的字节流通信方式：Socket 表示一条已建立的连接，输入流与输出流分别用于接收和发送字节。示例使用阻塞式 I/O，并且在主线程中串行处理客户端——处理第一个客户端时会一直阻塞在 `readLine()` 上。要同时处理多个客户端，可以为每个连接分配线程或使用线程池，也可以改用 NIO 多路复用；后续章节会进一步比较这些模型。

### 2.2 用 Wireshark 观察 TCP 行为

运行客户端与服务端后，可以用 Wireshark 抓包检查连接建立、数据传输和连接关闭过程。以下命令为 Linux 示例，回环接口是 `lo`；macOS 通常为 `lo0`，需先确认本机接口名称：

```bash
# 启动抓包
sudo tcpdump -i lo -w /tmp/tcp_capture.pcap port 8080
```
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
