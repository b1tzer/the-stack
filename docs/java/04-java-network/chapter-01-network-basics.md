# 网络通信基础：程序如何跨越机器边界

> 本地调用 `userService.findById(1)` 和把它拆成独立服务后的远程调用，表面都是「调用一个方法」，成本却差了几个数量级：前者主要消耗在方法调用和业务执行，后者还要经过网络传输、请求排队、服务端处理和响应返回。远程调用变慢，不一定是 SQL 或业务代码的问题。只有把 DNS 解析、连接建立、网络传输和服务端处理分开测量，才能定位时间到底消耗在哪。本章从这些基础机制讲起。

## 1. 为什么程序需要网络

### 1.1 从单机到分布式的范式转变

在计算机发展的早期，一台大型机就能满足所有计算需求。程序之间的通信通过共享内存、管道、消息队列等本地机制完成。但随着业务规模增长，单机的算力、存储和可靠性都遇到了天花板。

我们来看一个典型的演进路径：

```txt
单机应用
  → 数据库分离（应用服务器 + 数据库服务器）
    → 应用集群（多台应用服务器 + 负载均衡）
      → 微服务架构（数十个独立服务，各司其职）
        → 云原生与边缘计算（服务遍布全球）
```

每一次演进，都意味着程序之间需要跨越更远的物理距离、更多的网络节点来完成通信。**网络不再是可选项，而是程序运行的基本前提。**

### 1.2 网络成为基础设施

今天，几乎没有一个有意义的程序是完全孤立运行的。一个简单的"用户下单"操作，背后可能涉及：

- 前端调用 API 网关
- 网关路由到订单服务
- 订单服务调用库存服务、支付服务、通知服务
- 每个服务访问各自的数据库
- 异步消息发送到消息队列

这些服务可能分布在不同的机器、不同的机房、甚至不同的国家。网络就是连接这一切的"血管"。

### 1.3 分布式系统的代价

网络不是免费的午餐。引入分布式后，你必须面对一系列单机时代不存在的问题：

| 问题 | 单机 | 分布式 |
| :-- | :-- | :-- |
| **延迟** | 内存访问 ~100ns | 网络往返 ~0.5-100ms（差 5-6 个数量级） |
| **可靠性** | 单机故障即整体不可用 | 部分节点故障仍可继续服务，但需冗余与故障处理机制 |
| **一致性** | 进程内共享状态，可由同步机制协调 | 跨节点状态需明确一致性模型，靠复制、协调或共识实现 |
| **安全性** | 本地通信，无需加密 | 网络窃听、中间人攻击 |
| **调试** | 单进程栈追踪 | 分布式链路追踪（Jaeger/Zipkin） |

Jeff Dean 的经典延迟数字（数量级参考，具体值随硬件与网络环境变化）：

```txt
L1 cache reference               0.5 ns
L2 cache reference               7   ns
Main memory reference            100 ns
Read 1 MB from memory            0.25 ms
Round trip within same datacenter 0.5 ms
Read 1 MB from SSD               1   ms
Disk seek                        10  ms
Read 1 MB from network           10  ms
Read 1 MB from disk              20  ms
Send packet CA→Netherlands→CA     150 ms
```

**网络往返（0.5ms）比内存访问（100ns）慢 5000 倍。** 远程调用的成本不只包括传输时延，还可能包括排队、协议处理和服务端执行。因此分布式系统设计要同时考虑延迟、故障和跨节点协调，而不能只盯着单次调用的网络耗时。

## 2. 网络通信的本质

### 2.1 本质：发送 bytes，接收 bytes

剥离所有协议、框架和抽象，网络通信做的事情只有一件：**把一串字节从机器 A 的进程送到机器 B 的进程**。

```txt
机器 A 的进程                          机器 B 的进程
┌──────────────┐                     ┌──────────────┐
│  application │                     │  application │
│   buffer     │                     │   buffer     │
│ [0x48,0x65,  │  ──── 网络 ────▶     │ [0x48,0x65,  │
│  0x6C,0x6C,  │                     │  0x6C,0x6C,  │
│  0x6F]       │                     │  0x6F]       │
└──────────────┘                     └──────────────┘
        "Hello"                              "Hello"
```

不管上层用的是 HTTP、gRPC、WebSocket 还是自定义协议，最终落到网线/光纤上传输的都是字节。应用层要处理的是协议定义的数据，底层网络负责传递这些数据的字节表示。

### 2.2 协议是对字节流的抽象封装

既然本质是字节流，为什么我们需要 HTTP、RPC 这些协议？因为裸字节流解决不了以下问题：

| 问题 | 裸字节流 | 协议的作用 |
| :-- | :-- | :-- |
| 对方怎么知道一条消息结束了？ | 不知道 | 消息边界（长度字段、分隔符等） |
| 数据格式是什么？ | 不知道 | 序列化格式（JSON、Protobuf 等） |
| 请求和响应怎么对应？ | 不知道 | 请求 ID、会话标识 |
| 对方挂了怎么办？ | 不知道 | 超时、重试、心跳 |
| 大文件怎么传？ | 一次性发送可能失败 | 分块传输、流控 |

**协议就是在字节流上附加的"约定"——通信双方共同遵守的规则。** 不同的协议在不同的维度上做了取舍：

- **HTTP**：简单、通用、无状态，适合请求-响应模式
- **WebSocket**：全双工、持久连接，适合实时推送
- **gRPC**：基于 HTTP/2 + Protobuf，高性能、强类型，适合微服务间通信
- **TCP**：可靠、有序的字节流传输，是 HTTP/1.1、HTTP/2 等许多应用层协议的传输基础

### 2.3 一个思想实验：如果让你设计协议

假设你要在两个 Java 程序之间传输数据，你会怎么做？

最简单的方案：直接发字节。

```java
// 发送方
outputStream.write("Hello".getBytes());

// 接收方
byte[] buf = new byte[1024];
int n = inputStream.read(buf);
```

但这立刻就会遇到问题：

1. **消息边界**：如果发送方连续发了 "Hello" 和 "World"，接收方可能一次读到 "HelloWorld"，也可能分两次读到 "Hel" 和 "loWorld"——你无法知道原始消息的边界在哪里。
2. **编码**：`"Hello".getBytes()` 用的是什么字符集？UTF-8？GBK？如果不约定，接收方解码就会乱码。正确做法是显式指定字符集，如 `getBytes(StandardCharsets.UTF_8)`。
3. **大消息**：如果消息有 10MB，一次 `write()` 可能成功，但接收方的 `read()` 每次返回的是实际读到的字节数，可能远小于 10MB——你需要循环读取，但怎么知道什么时候读完了？
4. **错误处理**：如果网络断了，`read()` 会怎样？阻塞？抛异常？返回 -1？

这些问题，就是协议要解决的。**每一层协议都是对下层的一次"标准化"**——它规定了数据格式、交互时序和错误处理方式，让通信双方有共同的语言。

## 3. 网络分层模型

### 3.1 OSI 七层 vs TCP/IP 四层

网络通信涉及太多问题：物理信号、帧同步、路由寻址、可靠传输、数据格式……如果把所有逻辑写在一个巨大的模块里，复杂度会让人崩溃。分层是人类管理复杂度的经典手段——每一层只管自己的事，向上提供抽象，向下调用服务。

两种经典的分层模型：

```txt
OSI 七层模型              TCP/IP 四层模型
┌───────────────┐        ┌───────────────┐
│  7. 应用层     │        │               │
├───────────────┤        │  应用层        │
│  6. 表示层     │        │  (HTTP/FTP/   │
├───────────────┤        │   DNS/SMTP)   │
│  5. 会话层     │        │               │
├───────────────┤        ├───────────────┤
│  4. 传输层     │        │  传输层        │
├───────────────┤        │  (TCP/UDP)    │
│  3. 网络层     │        ├───────────────┤
├───────────────┤        │  网际层        │
│  2. 数据链路层  │        │  (IP/ICMP)    │
├───────────────┤        ├───────────────┤
│  1. 物理层     │        │  网络接口层    │
└───────────────┘        └───────────────┘
```

TCP/IP 四层模型是互联网实际运行的模型。OSI 七层是理论参考模型。**作为 Java 开发者，你主要关心的是应用层和传输层。**

### 3.2 每层的职责与 Java 开发者的关注点

| 层级 | 职责 | 典型协议/技术 | Java 开发者需要关心吗？ |
| :-- | :-- | :-- | :-- |
| **应用层** | 定义业务数据格式和交互语义 | HTTP, gRPC, WebSocket, DNS, SMTP | ⭐⭐⭐ 核心战场 |
| **传输层** | 提供端到端的可靠（或不可靠）传输 | TCP, UDP, QUIC | ⭐⭐ 需要理解原理 |
| **网际层** | 路由寻址，把数据包从源送到目标 | IP, ICMP, ARP | ⭐ 了解即可 |
| **网络接口层** | 物理信号传输，帧的封装与解析 | Ethernet, Wi-Fi, PPP | 几乎不关心 |

从 API 的职责看，`java.net.Socket` 提供 TCP 连接与字节流读写能力，`HttpURLConnection` 和 Spring 的 `RestTemplate` 提供 HTTP 请求与响应的操作接口。它们处于不同的抽象层次，并非与协议层一一对应；调用 HTTP 客户端时，底层仍要经过 TCP 建连、报文发送与响应读取。理解分层的目的，是弄清每个 API 替调用方承担了哪些工作，而不是给每个类贴唯一的协议层标签。

### 3.3 分层的代价

分层不是没有代价的。每一层都要加自己的头部，带来了额外的开销：

```txt
以太网帧有效载荷：1500 字节
- IP 头部：20 字节
- TCP 头部：20 字节
= 应用层可用：1460 字节

头部开销占比：40 / 1500 ≈ 2.7%
```

对于大文件传输，这个开销可以忽略。对小消息而言，固定的协议与处理开销可能更显著，但实际瓶颈还受系统调用、网络往返、加密和排队等因素影响，需要测量后才能下结论。QUIC（HTTP/3 的传输基础）选择在 UDP 之上重新实现传输层：它在 UDP 上补齐可靠传输、拥塞控制和多路复用，并集成 TLS 1.3，价值在于缩短连接建立、避免一个流丢包阻塞其他独立流，以及更灵活地演进传输机制，而不只是把头部做得更紧凑。

## 4. 数据如何从一台机器到另一台机器

### 4.1 数据封装过程

当你调用 `socket.getOutputStream().write("Hello".getBytes())` 时，数据并不会直接飞到目标机器。它要经过层层封装，每一层加上自己的"信封"：

```txt
应用层数据 (Application Data)
┌─────────────────────────────┐
│ "Hello" (5 bytes)           │
└─────────────────────────────┘
            │
            ▼  传输层加上 TCP 头（源端口、目标端口、序列号、校验和等）
┌─────────────────────────────────────────┐
│ TCP Header (20+ bytes) │ "Hello"        │
└─────────────────────────────────────────┘
            │
            ▼  网际层加上 IP 头（源IP、目标IP、TTL等）
┌──────────────────────────────────────────────────────┐
│ IP Header (20+ bytes) │ TCP Header │ "Hello"         │
└──────────────────────────────────────────────────────┘
            │
            ▼  链路层加上帧头帧尾（源MAC、目标MAC、CRC校验等）
┌──────────────────────────────────────────────────────────────────┐
│ Ethernet Header │ IP Header │ TCP Header │ "Hello"  │ FCS Trailer│
└──────────────────────────────────────────────────────────────────┘
```

这个过程叫做**封装（Encapsulation）**。接收端收到数据后，执行相反的过程——**解封装（Decapsulation）**，逐层剥离头部，最终把 "Hello" 交给目标应用。

### 4.2 一次完整的 HTTP 请求之旅

以你在浏览器输入 `http://example.com/index.html` 为例。下面展示的是首次通过 HTTP/1.1 建立新 TCP 连接时的简化流程；实际请求可能复用已有连接，HTTPS 还需 TLS 握手，HTTP/3 则走 QUIC：

```txt
1. DNS 解析：example.com → 93.184.216.34
2. TCP 三次握手：与 93.184.216.34:80 建立连接
3. 发送 HTTP 请求：
   GET /index.html HTTP/1.1\r\n
   Host: example.com\r\n
   \r\n
4. 服务器处理请求，返回 HTTP 响应
5. 浏览器解析 HTML，渲染页面
6. TCP 四次挥手（或保持连接复用）
```

**每一步都涉及数据的封装与解封装。** 对 Java 开发者来说，你通常只关心第 3 步和第 4 步——但当网络出问题时（连接超时、数据丢失、性能瓶颈），理解底层过程能帮你快速定位问题。

### 4.3 MTU、MSS 与分片

以太网链路层的 MTU（最大传输单元）通常是 1500 字节，它限制的是一个 IP 数据包的总长度。若一个 IP 数据包超过 MTU 且沿途设备允许，它会被**分片（Fragmentation）**：

```txt
原始 IP 数据包：总长 3000 字节 = 20 字节 IP 头 + 2980 字节 payload
┌──────────────────────────────────────────────┐
│ IP 头(20B) │         payload(2980B)          │
└──────────────────────────────────────────────┘
                    │
                    ▼ 分片（每片带各自的 20 字节 IP 头）
┌───────────────┐ ┌───────────────┐ ┌───────────────┐
│ 分片 1        │ │ 分片 2         │ │ 分片 3         │
│ IP头+payload  │ │ IP头+payload  │ │ IP头+payload   │
│  20+1480B     │ │  20+1480B     │ │  20+20B       │
│ offset=0      │ │ offset=185    │ │ offset=370    │
│ MF=1          │ │ MF=1          │ │ MF=0          │
└───────────────┘ └───────────────┘ └───────────────┘
```

分片会降低网络效率。IP 层本身不提供可靠传输：任何一个分片丢失，接收端都无法重组出完整的数据报，但 IP 层不会重传。对 TCP 流量，丢失最终表现为某个 TCP 段未被确认，由 TCP 层的确认与重传机制处理，代价是额外的延迟。因此工程上应尽量避免依赖 IP 分片，TCP 会通过 **MSS（Maximum Segment Size）** 协商把段大小压在 MTU 之内，从源头减少分片。MSS 通常 = MTU - IP 头(20) - TCP 头(20) = 1460 字节。图中 offset 是 IPv4 头 Fragment Offset 字段的值，以 8 字节为单位，185 对应字节偏移 1480。

### 4.4 IP 地址与端口号：通信的地址体系

网络通信需要两个"地址"才能定位到具体的进程：

- **IP 地址**：定位到哪台机器（网络层）
- **端口号**：定位到机器上的哪个进程（传输层）

```txt
192.168.1.100:8080
│              │
│              └── 端口号（16 位，0-65535）
└───────────────── IP 地址（32 位 IPv4 / 128 位 IPv6）
```

端口号由 IANA 划分为三段：

| 范围 | 类别 | 示例 |
| :-- | :-- | :-- |
| 0-1023 | 系统端口 | HTTP=80, HTTPS=443, SSH=22 |
| 1024-49151 | 用户端口 | MySQL=3306, Redis=6379, Tomcat=8080 |
| 49152-65535 | 动态/私有端口 | 客户端临时端口 |

在 Linux 等系统中，绑定 1024 以下的端口通常需要相应权限，但具体限制随操作系统与配置而异，并非跨平台统一规则。

**在 Java 中，ServerSocket 绑定的就是端口号：**

```java
// 监听 8080 端口
ServerSocket serverSocket = new ServerSocket(8080);

// 客户端连接 localhost:8080
Socket socket = new Socket("localhost", 8080);
```

## 5. UDP 与 DNS：连接建立之前的两个边界

TCP 并不是所有网络通信的前提。UDP 在发送前不建立连接，DNS 则负责在 TCP 连接之前把主机名解析成地址。两者都容易被上层框架隐藏，却会直接影响延迟和故障判断。

### 5.1 UDP 提供数据报，不提供可靠传输

UDP 把应用数据封装成独立数据报发送。它没有连接状态，也不保证数据到达、按序到达或只到达一次。Java 的传统 API 是 `DatagramSocket` 与 `DatagramPacket`，NIO API 是 [`DatagramChannel`](./chapter-05-nio.md)。

```java
try (DatagramChannel channel = DatagramChannel.open()) {
    channel.configureBlocking(false);
    channel.bind(new InetSocketAddress(9000));
    ByteBuffer buffer = ByteBuffer.allocate(1500);
    SocketAddress sender = channel.receive(buffer);
    if (sender != null) {
        buffer.flip();
        // 按应用协议解析这一份数据报
    }
}
```

这段代码只说明数据报的接收边界，不提供业务协议。若需要确认、重传、顺序、流控或拥塞控制，必须在应用层补齐，或者改用提供这些语义的协议。典型选择如下：

| 需求 | 为什么可能选 UDP | 需要补充的机制 |
| :-- | :-- | :-- |
| 实时音视频、遥测 | 控制延迟优先，部分过期数据价值下降 | 丢包恢复、拥塞控制，必要时重传 |
| DNS | 小型请求-响应，常用 UDP 传输 | 超时、重试，必要时回退 TCP |
| RPC、文件传输、命令下发 | 需要可靠和有序 | 改用 TCP、QUIC 或应用层确认机制 |
| 大量并发小消息 | 数据报独立、无连接握手 | 仍需自行设计重试、幂等和限流 |

UDP 报文还受 MTU、网络分片和中间设备策略影响。应用必须定义最大消息大小、解析失败策略和重复消息的幂等性；“收到了发送成功”不等于对端已经处理。

### 5.2 DNS 决定连接会去哪里

访问 `https://api.example.com/orders` 时，通常先解析 `api.example.com`，再向得到的 IP 地址建立 TCP 连接。Java 可以显式查看解析结果：

```java
import java.io.UncheckedIOException;

try {
    InetAddress[] addresses = InetAddress.getAllByName("api.example.com");
    for (InetAddress address : addresses) {
        System.out.println(address.getHostAddress());
    }
} catch (UnknownHostException ex) {
    throw new UncheckedIOException("无法解析 api.example.com", ex);
}
```

JDK 会对成功和失败结果进行缓存，具体策略受 JDK 版本、安全配置和网络环境影响。因此，一次 Java 查询返回同一地址不能证明 DNS 刚刚重新解析。排查时应同时观察应用侧结果、系统解析器和权威/递归 DNS：

```text
应用 URL
  → JDK/系统 DNS 解析
  → IP 地址
  → TCP 建连
  → TLS 握手
  → HTTP 响应
```

这条链上的错误要分开判断：抛出 UnknownHostException 表示本次主机名解析失败，应检查域名是否正确、解析器配置以及 DNS 服务可用性；拿到地址后连接超时更可能是路由、端口或防火墙问题；TCP 成功但 TLS 失败则要检查证书链和主机名匹配。`curl -w` 的 `time_namelookup`、`time_connect` 和 `time_appconnect` 可以辅助观察这些阶段的耗时，详见 [HTTP 协议、Java 客户端与 TLS/HTTPS](./chapter-07-http.md)。

## 6. Java 网络编程全景

### 6.1 Java 网络编程的演进路线

Java 的网络编程经历了几个明显的阶段，每个阶段都是对前一阶段痛点的回应：

```txt
JDK 1.0 (1996)          JDK 1.4 (2002)         JDK 7 (2011)
┌─────────────┐         ┌─────────────┐         ┌─────────────┐
│  java.net    │        │  java.nio    │        │  NIO.2      │
│  Socket      │        │  Channel     │        │  Asynchronous│
│  ServerSocket│        │  Buffer      │        │  Channel    │
│  BIO 阻塞 I/O│         │  Selector    │        │  FileSystem │
└─────────────┘         └─────────────┘         └─────────────┘
     ▲                       ▲                       ▲
     │                       │                       │
  一个连接               多路复用                异步非阻塞
  一个线程               少量线程                回调/CompletableFuture
```

| 阶段 | API | 模型 | 优点 | 缺点 |
| :-- | :-- | :-- | :-- | :-- |
| **BIO** | `java.net.Socket` | 阻塞式 I/O | 简单直观 | 一个连接占一个线程，连接数增长时线程栈内存与调度开销随之上升 |
| **NIO** | `java.nio.channels` | 非阻塞 + 多路复用 | 少量线程管理大量连接 | 编程模型复杂，Buffer 操作反直觉 |
| **NIO.2** | `java.nio.channels.AsynchronousSocketChannel` | 异步 I/O | 通过回调或 Future 表达完成结果 | 生态不如 NIO 成熟 |
| **Netty** | 第三方框架 | Reactor 模式 | 高性能、易用、生态丰富 | 额外依赖，学习曲线 |

### 6.2 从 Socket 到框架的抽象层次

```txt
┌─────────────────────────────────────────────────────────┐
│                    业务框架层                             │
│   Spring MVC / Spring WebFlux / Dubbo / gRPC-Java       │
├─────────────────────────────────────────────────────────┤
│                    Web 容器层                            │
│   Tomcat / Jetty / Undertow                             │
├─────────────────────────────────────────────────────────┤
│                    通信框架层                             │
│   Netty / Mina                                          │
├─────────────────────────────────────────────────────────┤
│                    JDK 标准库                            │
│   java.net.Socket / java.nio.channels / HttpClient      │
├─────────────────────────────────────────────────────────┤
│                    操作系统内核                           │
│   TCP/IP 协议栈 / Socket API / epoll / kqueue            │
├─────────────────────────────────────────────────────────┤
│                    硬件层                                │
│   网卡 / 交换机 / 路由器 / 光纤                            │
└─────────────────────────────────────────────────────────┘
```

**你日常开发中用到的框架，都是在底层 Socket API 之上层层封装的结果。** 理解底层，不是为了让你每次都手写 Socket，而是当框架行为不符合预期时，你能穿透抽象层去排查问题。

### 6.3 Java 网络编程的核心类库

以下是 Java 网络编程中最常用的类，按层次组织：

| 层次 | 核心类 | 用途 |
| :-- | :-- | :-- |
| **传统 Socket** | `java.net.Socket`, `ServerSocket` | 阻塞式 TCP 通信 |
| **传统 UDP** | `java.net.DatagramSocket`, `DatagramPacket` | UDP 数据报通信 |
| **传统 HTTP** | `java.net.URL`, `HttpURLConnection` | 传统 HTTP 请求，维护旧代码时仍会遇到 |
| **NIO 核心** | `java.nio.channels.SocketChannel`, `ServerSocketChannel` | 非阻塞 TCP 通信 |
| **NIO 多路复用** | `java.nio.channels.Selector` | 单线程管理多连接 |
| **NIO 缓冲区** | `java.nio.ByteBuffer` | 高效数据读写 |
| **NIO.2 异步** | `java.nio.channels.AsynchronousSocketChannel` | 异步非阻塞通信 |
| **现代 HTTP** | `java.net.http.HttpClient` (JDK 11+) | 支持 HTTP/1.1 与 HTTP/2，同步与异步调用 |

```java
// 传统 Socket（阻塞）
Socket socket = new Socket("localhost", 8080);
OutputStream out = socket.getOutputStream();
out.write("Hello".getBytes());

// NIO Channel（非阻塞）
SocketChannel channel = SocketChannel.open();
channel.configureBlocking(false);
channel.connect(new InetSocketAddress("localhost", 8080));
// 非阻塞模式下 connect() 返回 false 表示连接尚未完成，
// 需配合 Selector 关注 OP_CONNECT，就绪后调用 finishConnect()
ByteBuffer buffer = ByteBuffer.wrap("Hello".getBytes());
channel.write(buffer);
// write() 可能只写入部分数据，需检查返回值

// HttpClient（JDK 11+，推荐）
HttpClient client = HttpClient.newHttpClient();
HttpRequest request = HttpRequest.newBuilder()
    .uri(URI.create("http://localhost:8080/api/hello"))
    .build();
HttpResponse<String> response = client.send(request,
    HttpResponse.BodyHandlers.ofString());
```

三种 API 的演进反映了 Java 网络编程的进化：从"一个连接一个线程"到"一个线程管理多个连接"，再到"声明式异步"。

### 6.4 选择合适的 API

面对这么多选择，实际开发中应该怎么选？

```txt
你的需求是什么？
│
├── 简单的 HTTP 调用？
│   └── JDK 11+ HttpClient 或 OkHttp / Apache HttpClient
│
├── Web 服务器？
│   └── 直接用 Spring Boot + Tomcat/Jetty/Undertow
│
├── 高性能网络框架？
│   └── Netty
│
├── 微服务间 RPC？
│   └── gRPC-Java / Dubbo
│
├── 学习原理？
│   └── 从 java.net.Socket 开始，逐步理解 NIO
│
└── 特殊协议（自定义二进制协议）？
    └── Netty + 自定义编解码器
```

大多数 Java 开发者不需要直接操作 Socket。但理解连接、字节流、超时和关闭语义，有助于排查 HTTP 客户端、RPC 和服务容器中的网络问题。

### 6.5 本专题后续章节导读

本章建立了网络通信的基础认知。后续章节将沿着这条路线深入：

侧边栏按“协议、Java I/O、Web/RPC”主题分组，分组顺序和章号顺序不是同一个概念。系统学习时按下表从第 2 章依次到第 12 章；按问题查阅时可以直接进入对应主题组。

| 章节 | 主题 | 核心问题 |
| :-- | :-- | :-- |
| [第2章](./chapter-02-tcp-ip) | TCP/IP | TCP 如何保证可靠传输？三次握手和四次挥手的细节？ |
| [第3章](./chapter-03-tcp-performance-java.md) | TCP 性能参数与 Java 实践 | 如何权衡 Nagle、KeepAlive 和缓冲区配置？ |
| [第4章](./chapter-04-socket.md) | Java Socket 编程 | Socket 在进程与内核之间抽象了什么？ |
| [第5章](./chapter-05-nio.md) | Java NIO | Channel、Buffer、Selector 如何支撑非阻塞 I/O？ |
| [第6章](./chapter-06-netty.md) | Netty 框架 | Java 网络程序为什么通常建立在 Netty 之上？ |
| [第7章](./chapter-07-http.md) | HTTP 协议、Java 客户端与 TLS/HTTPS | 如何发起、验证和排查一次 HTTPS 请求？ |
| [第8章](./chapter-08-servlet-tomcat-request-chain.md) | Servlet 与 Tomcat 请求链 | HTTP 请求如何从字节流进入应用代码？ |
| [第9章](./chapter-09-rpc.md) | RPC 与微服务通信 | 一次远程调用经过哪些层次？ |
| [第10章](./chapter-10-long-connection-protocols.md) | 长连接协议与保活 | WebSocket、SSE 和心跳如何维持通信？ |
| [第11章](./chapter-11-im-system-design.md) | IM 系统设计 | 在线状态、消息路由和顺序如何保证？ |
| [第12章](./chapter-12-network-optimization.md) | 高并发网络优化 | 高并发下如何配置连接并持续验证性能？ |
| [网络诊断](../06-diagnostics/03-network/chapter-01-network-diagnostics.md) | 网络排查 | 如何用抓包、线程和连接状态定位故障？ |
