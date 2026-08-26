# TCP/IP：可靠通信的基础

> TCP 是互联网上使用最广泛的传输层协议。它承诺"可靠、有序、不重复"的字节流传输——但这个承诺是怎么兑现的？三次握手为什么是三次而不是两次？四次挥手中 TIME-WAIT 等待 2MSL 有什么用？粘包问题的根因是什么？本章深入 TCP 的核心机制，帮你建立扎实的传输层认知。

> **先看一个线上故障。**
>
> 你在公司上线了一个 HTTP 服务，部署在云服务器上，跑了两周一切正常。第三周，运维突然通知你：「服务假死了——端口开着，但新请求全部超时。」
>
> 你登上服务器，`netstat -ant | grep 8080` 一看，几千条连接全部卡在 `TIME_WAIT` 状态。再看 `dmesg`：`nf_conntrack: table full, dropping packet`。连接跟踪表被打满了，新包直接被内核丢弃。
>
> 根因是什么？不是你代码有 bug。是你的短连接 HTTP 客户端每请求一次就建一个新 TCP 连接、用完就关——主动关闭方进入 `TIME_WAIT` 等 2MSL（60 秒），加上每秒几百个请求，TIME_WAIT 连接越积越多。端口没耗尽先不说，conntrack 表先爆了。
>
> 如果你不懂 TCP 为什么有 TIME_WAIT、不懂四次挥手的方向性、不懂 `tcp_tw_reuse` 和连接池的关系，你能做的只有重启服务器——然后问题还会回来。
>
> 这一章讲的就是这些「看起来是网络问题、实际上是你不懂 TCP」的真实场景。

## 1. TCP 为什么存在

### 1.1 传输层要解决的问题

应用层产生数据，网际层（IP）负责路由寻址——但 IP 层只管"把数据包送出去"，不保证：

- 数据包是否到达（可能丢包）
- 到达顺序是否正确（可能乱序）
- 是否有重复数据包（可能重复）
- 是否有数据损坏（校验有限）

传输层的任务就是**在不可靠的 IP 层之上，构建可靠（或不可靠）的通信通道**。

### 1.2 UDP vs TCP

TCP 和 UDP 是传输层的两个核心协议，它们的设计哲学截然不同：

| 特性 | TCP | UDP |
|------|-----|-----|
| 连接方式 | 面向连接（三次握手） | 无连接 |
| 可靠性 | 可靠（确认应答、重传） | 不可靠（尽最大努力交付） |
| 数据顺序 | 保证有序 | 不保证 |
| 流量控制 | 有（滑动窗口） | 无 |
| 拥塞控制 | 有（慢启动、拥塞避免） | 无 |
| 首部开销 | 20 字节起 | 8 字节 |
| 传输模式 | 字节流 | 数据报 |
| 典型场景 | Web、文件传输、邮件 | DNS、视频直播、游戏 |

**没有"更好"的协议，只有"更适合"的协议。** TCP 用性能换可靠性，UDP 用可靠性换实时性。选择哪个，取决于你的业务能容忍什么。

### 1.3 为什么 HTTP 选择 TCP

HTTP 是万维网的基础协议，它要求：请求必须到达、响应不能丢失、页面内容不能乱序。这些需求天然匹配 TCP 的特性。

但 HTTP/3（基于 QUIC 协议）开始使用 UDP 作为传输层，在 UDP 之上自己实现了可靠传输和流控——因为 TCP 的某些设计（如队头阻塞）在现代网络环境下反而成了瓶颈。这个故事我们留到第 6 章再讲。

## 2. TCP 三次握手与四次挥手

### 2.1 三次握手：建立连接

TCP 连接的建立需要三次数据交互，这就是著名的"三次握手"：

![tcp-handshake](/java/tcp-handshake.svg)

> **这跟你的代码有什么关系？** 每次建一个新的 TCP 连接，在你的第一个字节数据发出去之前，客户端和服务器已经来回飞了三趟（SYN→SYN-ACK→ACK）。如果 RTT 是 40ms，这 40ms 是纯等待——你的代码还没开始跑。这就是连接池（HTTP Keep-Alive、数据库连接池、Dubbo 长连接）存在的根本原因：复用已有连接，省掉这个 1-RTT 的握手代价。TLS 握手还要再花 1-RTT——所以首次访问 HTTPS 总比 HTTP 慢一拍，不是网络问题，是协议设计决定的。

**为什么是三次而不是两次？**

这是面试经典题，但很多人只记住了答案，没有真正理解原因。核心原因是：**TCP 需要双方都确认对方的初始序列号（ISN）。**

假设只有两次握手：

```text
客户端 ── SYN, seq=x ──▶ 服务端
客户端 ◀── SYN+ACK, seq=y, ack=x+1 ── 服务端
// 连接建立？不行！
```

问题在于：客户端知道服务端收到了自己的 SYN（因为 ack=x+1），但**服务端不知道客户端是否收到了自己的 SYN+ACK**。如果 SYN+ACK 在网络中丢失，服务端以为连接建立了，客户端却不知道——这就是**半开连接**。

更深层的原因是：两次握手无法防止**历史重复连接**的初始化。如果一个延迟到达的旧 SYN 报文触发了服务端的连接建立，服务端会白白分配资源。第三次握手让客户端有机会说"这是过期的连接，我不认"。

**序列号（Sequence Number）的作用：**

序列号不仅仅是为了确认"收到了"，更重要的是：
- 保证数据的**有序性**（接收端按序列号重组）
- 实现**可靠重传**（通过 ACK 确认哪些数据已送达）
- 防止**历史报文干扰**（通过序列号识别过期数据）

### 2.2 四次挥手：关闭连接

建立连接需要三次握手，关闭连接却需要四次挥手：

```text
    客户端 (Client)                          服务端 (Server)
        │                                        │
        │  ──── FIN, seq=u ──────────────────▶   │  ① 客户端发送 FIN
        │                                        │     (我没有数据要发了)
        │                                        │
        │  ◀── ACK, ack=u+1 ─────────────────    │  ② 服务端确认 FIN
        │                                        │     (知道了，但我可能还有数据要发)
        │                                        │
        │        ... 服务端可能继续发送数据 ...    │
        │                                        │
        │  ◀── FIN, seq=w ───────────────────    │  ③ 服务端发送 FIN
        │                                        │     (我也没有数据要发了)
        │                                        │
        │  ──── ACK, ack=w+1 ────────────────▶   │  ④ 客户端确认 FIN
        │                                        │
        │     等待 2MSL (TIME_WAIT)              │     连接 CLOSED
        │     然后 CLOSED                        │
```

**为什么是四次而不是三次？**

因为 TCP 是**全双工**的——两个方向的数据流是独立的。当客户端说"我没有数据要发了"（发送 FIN），服务端可能还有数据在发送中。所以服务端的 ACK 和 FIN 不能合并成一次——ACK 是立即回复的，FIN 要等服务端把数据发完才能发。

**为什么需要 2MSL（Maximum Segment Lifetime）？**

客户端在发送最后一个 ACK 后，进入 `TIME_WAIT` 状态，等待 2MSL（通常是 60 秒）。原因有两个：

1. **确保最后一个 ACK 到达服务端。** 如果 ACK 丢失，服务端会重发 FIN。如果客户端直接关闭了，就收不到重发的 FIN，服务端永远收不到最终确认。
2. **让旧连接的报文在网络中自然消亡。** 等待 2MSL 确保属于这个连接的所有报文都从网络中消失，不会干扰后续的新连接。

**生产中的 TIME_WAIT 问题：**

在高并发短连接场景（如 HTTP 短连接），大量 TIME_WAIT 状态的连接会占用端口资源：

```bash
# 查看 TIME_WAIT 连接数
netstat -ant | grep TIME_WAIT | wc -l

# Linux 内核参数调优
net.ipv4.tcp_tw_reuse = 1      # 允许复用 TIME_WAIT 连接
net.ipv4.tcp_fin_timeout = 30   # 缩短 FIN 超时时间
```

### 2.3 TCP 状态机

TCP 连接的生命周期可以用一个状态机来描述：

![tcp-segment](/java/tcp-segment.svg)

**对 Java 开发者的意义：** 当你在代码中调用 `socket.close()` 时，操作系统并不一定立即关闭连接——它可能进入 FIN_WAIT_1、FIN_WAIT_2、TIME_WAIT 等状态。理解这些状态，能帮你解释为什么 `close()` 后端口还被占用、为什么连接池中的连接"看起来还活着"。

## 3. TCP 数据传输机制

### 3.1 序列号与确认应答

TCP 为每个字节都分配了一个序列号。发送方和接收方各自维护一个序列号计数器：

> **序列号不只是一个教材概念。** 当你在 Wireshark 里看到同一个 seq 号出现了两次——那是重传，TCP 没能按时收到对方的 ACK。当你在 APM 里看到某个 RPC 调用的延迟突然翻倍——那可能就是这个连接在等 RTO 超时、或者丢包触发了快速重传。序列号是你看懂 TCP 在做什么的第一个抓手。

```text
发送方                                    接收方
│                                         │
│  seq=1000, len=100 ─────────────────▶   │  发送 100 字节，序列号从 1000 开始
│                                         │
│  ◀──── ACK=1100 ────────────────────    │  确认：已收到序列号 1100 之前的所有数据
│                                         │
│  seq=1100, len=200 ─────────────────▶   │  发送 200 字节
│                                         │
│  ◀──── ACK=1300 ────────────────────    │  确认：已收到 1300 之前的所有数据
```

**累积确认（Cumulative ACK）：** ACK=N 表示"序列号 N 之前的所有数据我都收到了"。这是一种简洁但有缺陷的设计——如果中间某个包丢失了，后续的 ACK 都无法确认新数据。

### 3.2 超时重传

TCP 为每个已发送但未确认的报文段设置一个**重传定时器（RTO, Retransmission Timeout）**。如果在 RTO 时间内没有收到 ACK，就重传该报文段。

```text
发送方                                    接收方
│                                         │
│  seq=1000, len=100 ──── ✖ (丢失) ──▶   │
│                                         │
│  ... 等待 RTO ...                       │
│                                         │
│  seq=1000, len=100 ──── (重传) ────▶   │
│                                         │
│  ◀──── ACK=1100 ────────────────────    │
```

**RTO 的计算：** 不是固定值，而是根据网络往返时间（RTT）动态调整的：

```text
SRTT = (1 - α) × SRTT + α × RTT       (平滑往返时间，α = 0.125)
RTTVAR = (1 - β) × RTTVAR + β × |SRTT - RTT|  (往返时间偏差，β = 0.25)
RTO = SRTT + 4 × RTTVAR
```

这个公式的核心思想是：**RTO 要比平均 RTT 大一些，但不能太大**——太大了重传慢，太小了会产生不必要的重传。

> **在继续往下读之前，建议你先亲眼看一下 TCP 的实际行为。**
>
> 在你电脑上启动第 2.6 节的 Java 示例，用 Wireshark 抓包。然后在客户端发送几条消息后，**直接拔掉网线（或用 `iptables` 断连）**，等 5 秒再插回去。
>
> 你会看到：TCP 发送方在 RTO 时间内没有收到 ACK → 重传 → 再等（RTO 翻倍）→ 再重传 → 直到达到重试上限才放弃。这就是超时重传的完整过程——不是你想象中"立刻重传"，而是有严格的时间间隔和退避策略。亲眼看到这个行为，比读一百行公式都管用。

### 3.3 滑动窗口：发送方不能发太快

如果每发一个包就等一个 ACK，效率太低（尤其是高延迟网络）。滑动窗口允许发送方在等待 ACK 的同时继续发送后续数据：

![tcp-window](/java/tcp-window.svg)

**窗口大小由接收方通告（Window Advertisement）：** 接收方在 ACK 中告诉发送方"我的接收缓冲区还有多少空间"，发送方据此控制发送速率。这就是**流量控制（Flow Control）**。

> **为什么你的千兆网卡只跑到 80Mbps？**
>
> 假设你的服务器在日本，客户端在北京，RTT 约 40ms。TCP 的默认接收缓冲区是 128KB。
>
> 最大吞吐 = 窗口大小 / RTT = 128KB / 0.04s = 3.2MB/s ≈ 25Mbps。
>
> 千兆网卡、万兆交换机，实际吞吐不到 30Mbps——不是你带宽不够，是 TCP 窗口被 RTT 卡死了。增大接收缓冲区到 1.25MB，同样链路立刻跑到 250Mbps。这就是下一节要讲的拥塞控制的"另一面"——发得太快会堵，发得太慢浪费带宽。TCP 要在两者之间找到一个平衡点。

### 3.4 拥塞控制：发多快才不堵路

流量控制解决的是"接收方处理不过来"的问题，但网络中还有另一个问题：**中间链路（路由器）可能拥塞**。如果所有发送方都不控制速率，网络会越来越堵，最终大量丢包。

TCP 的拥塞控制包含四个阶段：

![tcp-congestion](/java/tcp-congestion.svg)

| 阶段 | 策略 | 说明 |
|------|------|------|
| **慢启动（Slow Start）** | 指数增长 | cwnd 从 1 MSS 开始，每收到一个 ACK 就翻倍 |
| **拥塞避免（Congestion Avoidance）** | 线性增长 | cwnd 达到 ssthresh 后，每 RTT 增加 1 MSS |
| **快速重传（Fast Retransmit）** | 收到 3 个重复 ACK 立即重传 | 不等超时，更快恢复 |
| **快速恢复（Fast Recovery）** | ssthresh = cwnd/2，cwnd = ssthresh + 3 | 避免回到慢启动 |

**对 Java 开发者的意义：** 你不能直接控制 TCP 的拥塞控制算法（这是内核的事），但理解它能帮你解释"为什么网络变慢了"——不是你的代码有问题，而是网络在拥塞。

## 4. TCP 粘包与拆包

### 4.1 根因：TCP 是字节流，没有消息边界

这是 TCP 网络编程中最常见的"坑"。很多初学者不理解为什么发送了两条消息，接收端却收到一条"粘在一起"的数据。

**根因很简单：TCP 是字节流协议，不保证消息边界。**

![tcp-sticky-packet](/java/tcp-sticky-packet.svg)

**为什么 UDP 没有这个问题？** 因为 UDP 是数据报协议——每次 `sendto()` 对应一次 `recvfrom()`，操作系统保留了消息边界。

### 4.2 三种解决方案

#### 4.2.1 方案一：固定长度

每条消息固定为 N 字节，不足的补零。

```java
// 发送方
byte[] message = new byte[64]; // 固定 64 字节
System.arraycopy("Hello".getBytes(), 0, message, 0, 5);
out.write(message);

// 接收方
byte[] buffer = new byte[64];
in.read(buffer); // 每次精确读 64 字节
```

| 优点 | 缺点 |
|------|------|
| 实现最简单 | 浪费带宽（短消息要补零） |
| 无状态 | 不适合变长消息 |

#### 4.2.2 方案二：分隔符

用特殊字符（如 `\n`、`\r\n`）作为消息边界。

```java
// 发送方
out.write("Hello\n".getBytes());
out.write("World\n".getBytes());

// 接收方 - 逐行读取
BufferedReader reader = new BufferedReader(new InputStreamReader(in));
String line = reader.readLine(); // "Hello"
line = reader.readLine();       // "World"
```

| 优点 | 缺点 |
|------|------|
| 简单直观 | 消息内容不能包含分隔符（或需要转义） |
| 适合文本协议（HTTP、SMTP） | 二进制数据不方便 |

#### 4.2.3 方案三：Length Field（长度字段）

在消息头部用固定字节数表示消息体长度。这是最通用的方案。

```text
┌──────────────┬─────────────────────┐
│ Length (4B)  │     Payload         │
│  0x00000005  │  "Hello" (5 bytes)  │
└──────────────┴─────────────────────┘
```

```java
// 发送方
byte[] data = "Hello".getBytes();
DataOutputStream out = new DataOutputStream(socket.getOutputStream());
out.writeInt(data.length);  // 写入 4 字节长度
out.write(data);            // 写入数据体

// 接收方
DataInputStream in = new DataInputStream(socket.getInputStream());
int length = in.readInt();  // 读取 4 字节长度
byte[] data = new byte[length];
in.readFully(data);         // 确保读取完整
```

| 优点 | 缺点 |
|------|------|
| 通用，适合任何数据类型 | 需要预先知道最大长度 |
| 无转义问题 | 头部有固定开销 |
| 大多数二进制协议的选择 | 实现稍复杂 |

**Netty 中的内置解码器：**

Netty 提供了开箱即用的解决方案：

```java
// 固定长度
pipeline.addLast(new FixedLengthFrameDecoder(64));

// 分隔符
pipeline.addLast(new DelimiterBasedFrameDecoder(1024, 
    Delimiters.lineDelimiter()));

// 长度字段（最常用）
pipeline.addLast(new LengthFieldBasedFrameDecoder(
    65535,    // maxFrameLength
    0,        // lengthFieldOffset
    4,        // lengthFieldLength
    0,        // lengthAdjustment
    4         // initialBytesToStrip
));
```

### 4.3 生产环境的经验法则

1. **优先使用 Length Field 方案**——它是绝大多数自定义二进制协议的选择
2. **读取时一定要循环读取**——一次 `read()` 不保证返回请求的全部字节数
3. **消息边界问题只在 TCP 中存在**——如果你用 UDP，不需要处理粘包
4. **使用成熟的框架（Netty）**——自己处理粘包容易出错

## 5. TCP 性能参数

### 5.1 Nagle 算法与 TCP_NODELAY

> **你的 Dubbo 接口 P99 延迟突然从 20ms 涨到 60ms。你没改任何代码。** 排查发现：压测脚本每次 `write()` 一小段数据后没调 `flush()`——数据被 Nagle 算法按住，等上一个 ACK 回来才放行，硬生生等了一个 RTT。一行 `socket.setTcpNoDelay(true)`，P99 回到 20ms。

**Nagle 算法**的设计初衷是减少网络中小包的数量。它的规则是：

- 如果发送缓冲区中的数据 >= MSS，立即发送
- 如果没有未确认的数据（in-flight），立即发送
- 否则，等收到 ACK 或者攒够 MSS 再发送

```text
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
|------|-------|-------------|
| 文件传输 | ✅ 保留（减少小包） | ❌ 不需要 |
| HTTP API 请求 | ❌ 禁用 | ✅ 启用 |
| 在线游戏 | ❌ 禁用 | ✅ 启用 |
| SSH 远程终端 | ❌ 禁用 | ✅ 启用 |
| 日志批量上报 | ✅ 保留 | ❌ 不需要 |

### 5.2 KeepAlive

TCP KeepAlive 是操作系统层面的机制，用于检测连接是否仍然存活：

```text
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
|------|--------------|-----------|
| 粒度 | 粗（默认 2 小时） | 细（可自定义秒级） |
| 灵活性 | 低（只能检测连接存活） | 高（可携带业务数据） |
| 开销 | 极低（内核实现） | 稍高（应用层处理） |
| 推荐 | 作为兜底机制 | 作为主要心跳机制 |

### 5.3 Socket Buffer 调优

TCP 的发送和接收缓冲区大小直接影响吞吐量：

```java
Socket socket = new Socket();
socket.setSendBufferSize(256 * 1024);    // 发送缓冲区 256KB
socket.setReceiveBufferSize(256 * 1024); // 接收缓冲区 256KB
```

**带宽-延迟积（BDP, Bandwidth-Delay Product）：**

最佳的缓冲区大小 = 带宽 × 延迟（RTT）：

```text
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

### 5.4 其他值得关注的 TCP 参数

| 参数 | 说明 | 推荐设置 |
|------|------|---------|
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

## 6. 用 Java 体验 TCP 通信

### 6.1 最简单的 TCP 示例

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

### 6.2 用 Wireshark 观察 TCP 行为

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

**这是理解 TCP 最有效的方式——比读十遍书都管用。**

> **纵横联系**
>
> - **与第 1 卷《Java 语言基础》的联系**：本章的 Socket 示例使用了 InputStream/OutputStream，这些 I/O 流的概念在第 1 卷中有详细讲解。`BufferedReader`、`DataInputStream` 等装饰器模式也是第 1 卷的重点。
> - **与第 3 卷《并发编程》的联系**：本章展示了阻塞式 I/O 的局限性——一个连接一个线程。第 3 卷讨论的线程池、Reactor 模式、CompletableFuture 将成为解决这个瓶颈的关键。
> - **与第 3 章（UDP）的联系**：本章讨论了 TCP 的可靠性保证，第 3 章将展示 UDP 如何在"不可靠"的基础上实现高效通信，以及 Java NIO 的非阻塞模型。
> - **与第 5 章（Netty）的联系**：本章末尾的 Java 代码展示了原生 Socket API 的笨拙——Netty 将在第 5 章提供优雅的替代方案，包括内置的编解码器、连接管理和性能调优。
> - **与第 9 章（网络安全）的联系**：本章讨论的 TCP 连接是明文传输的。第 9 章将在 TCP 之上叠加 TLS，实现加密通信。
