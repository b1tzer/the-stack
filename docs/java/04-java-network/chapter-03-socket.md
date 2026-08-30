# Java Socket 编程：网络抽象的起点

> **核心问题：** 你线上报过 `Too many open files`，调过 `ulimit -n 65535`，配过连接池的 `maxConnections`——但你有没有想过，fd 到底是什么？一个 `new Socket()` 在内核里到底分配了什么？`read()` 卡住的时候，线程去哪了？一台机器到底能撑多少连接？本章从 OS 内核视角出发，把 Socket 从"一个 Java 对象"拆回它的本质：一个文件描述符、两块内核缓冲区、两对队列。

## 1. Socket 的本质：OS 如何抽象网络通信

### 1.1 从网卡到进程：数据的旅程

当一台机器的网线收到一个 TCP 包，数据要经过层层处理才能到达应用程序：

![data-journey](/java/data-journey.svg)

关键一步在**传输层**：内核根据报文的**目标 IP + 目标端口**（以及源 IP + 源端口）找到对应的 Socket，把数据塞进它的**接收缓冲区**。应用程序调用 `read()` 时，读的就是这个缓冲区——它不需要知道网卡型号、TCP 校验和、路由表，内核把这些全部处理好了。

Socket 的价值就在这里：**它把复杂的网络协议栈封装成了一个"读写缓冲区"**。对应用程序而言，网络通信和读写文件在接口层面几乎没有区别。

### 1.2 Socket = 文件描述符 + 协议栈

在 Unix/Linux 中，Socket 本质上是一个**文件描述符（File Descriptor, fd）**。操作系统把一切 I/O 资源都抽象为 fd——普通文件、管道、设备、网络连接，对应用来说都是一个 `int` 数字。

![fd-table](/java/fd-table.svg)

创建一个 Socket 时，内核做的事情：

1. 分配一个 **`struct socket`**（内核中的 Socket 对象）
2. 在进程的**文件描述符表**中找一个空位，填入指向该 Socket 的指针
3. 返回这个 fd 的编号给应用

后续所有操作——`read`、`write`、`close`——都通过这个 fd 编号进行。这就是为什么 `socket()` 系统调用的返回值是一个 `int`，而不是一个"连接对象"。

> **Java 层面的映射**：Java 的 `Socket` 和 `ServerSocket` 对象内部持有一个 OS fd。`socket.close()` 最终调用的就是 OS 的 `close(fd)`。如果 Java 对象被 GC 回收但没有显式 `close()`，fd 的释放要等 `finalize()`（JDK 9+ 改为 `Cleaner`），期间 fd 一直被占着——这就是为什么必须用 try-with-resources 显式关闭 Socket。

### 1.3 五元组与连接标识

一个 TCP 连接由**五元组**唯一标识：

| 字段 | 含义 | 示例 |
| :-- | :-- | :-- |
| 源 IP | 发送方的 IP 地址 | `10.0.0.5` |
| 源端口 | 发送方的临时端口 | `43210` |
| 目标 IP | 接收方的 IP 地址 | `192.168.1.1` |
| 目标端口 | 接收方的监听端口 | `8080` |
| 协议 | TCP 或 UDP | `TCP` |

五元组相同的两个包属于同一条连接，五元组不同则属于不同连接。

**服务端一个监听端口能接受多少连接？**

很多初学者以为"一个端口只能一个连接"，这是误解。服务端监听 `8080` 端口后，每 `accept()` 一个新连接，内核就创建一个新的 Socket（新的 fd），这个 Socket 的五元组中**目标 IP:端口**相同（都是 `192.168.1.1:8080`），但**源 IP:端口**不同。只要来源不同，就是不同的连接。

```text
Server: listen(:8080)

Client A (10.0.0.5:43210) ──连接──► Server:8080  → accept() → fd=4
Client B (10.0.0.5:43211) ──连接──► Server:8080  → accept() → fd=5
Client C (10.0.0.6:51782) ──连接──► Server:8080  → accept() → fd=6
```

三个连接共享同一个监听端口，但五元组各不相同。

**理论容量分析：**

| 维度 | 上限 | 制约因素 |
| :-- | :-- | :-- |
| 单个客户端 → 单个服务端端口 | ~65,535 条 | 客户端临时端口范围（`/proc/sys/net/ipv4/ip_local_port_range`，默认 32768~60999） |
| 单个服务端 IP 的所有端口 | ~65,535 × 65,535 条（理论） | 实际受 fd 限制和内存限制 |
| 多网卡多 IP 的服务端 | IP 数 × 65,535 × 客户端数 | 网卡带宽、内存、fd 上限 |

实际生产中，连接数的瓶颈**从来不是端口数**，而是下一节要讲的 fd 限制和内核资源。

### 1.4 Socket 的两种类型

| 类型 | 协议 | 特点 | 典型场景 |
| :-- | :-- | :-- | :-- |
| **Stream Socket** | TCP | 面向连接、可靠、有序、字节流 | HTTP、数据库连接、RPC |
| **Datagram Socket** | UDP | 无连接、不可靠、低延迟、数据报 | DNS、视频流、游戏状态同步 |

本书以 TCP Stream Socket 为主线，因为 Java 企业级开发中绝大多数网络通信基于 TCP。

## 2. Socket 系统调用与 Java 映射

Socket 编程的本质就是按顺序调用一组**系统调用**。每一步都对应一个 OS 内核操作，Java 对这些操作做了面向对象封装。

### 2.1 `socket()`：创建端点

```c
// OS 层
int fd = socket(AF_INET, SOCK_STREAM, 0);
```

内核分配一个 `struct socket` 对象，绑定到进程的 fd 表中。此时还没有连接，只是一个"插座"。

```java
// Java 层
ServerSocket serverSocket = new ServerSocket();   // 内部调用 socket()
Socket clientSocket = new Socket();               // 内部调用 socket()
```

Java 的 `new ServerSocket()` 在构造时就调用了 OS 的 `socket()`，拿到一个 fd。

### 2.2 `bind()` + `listen()`：绑定端口、开始监听

```c
// OS 层
struct sockaddr_in addr = { .sin_port = htons(8080), .sin_addr.s_addr = INADDR_ANY };
bind(fd, (struct sockaddr*)&addr, sizeof(addr));   // 绑定 IP:Port
listen(fd, 128);                                    // 开始监听，backlog=128
```

`bind()` 把 Socket 和一个 **IP:Port** 绑定。绑定后，操作系统知道"目标端口是 8080 的 TCP 包应该送给这个 Socket"。

`listen()` 把 Socket 从"主动连接"模式切换为"被动监听"模式，并告诉内核：**为这个 Socket 创建两个队列**——半连接队列（SYN queue）和全连接队列（accept queue）。`backlog` 参数控制全连接队列的大小。

```java
// Java 层
ServerSocket serverSocket = new ServerSocket();
serverSocket.bind(new InetSocketAddress(8080), 128);  // bind() + listen()
// 或者一行搞定：
ServerSocket serverSocket = new ServerSocket(8080);    // 内部自动 bind + listen，backlog 默认 50
```

### 2.3 `accept()`：从全连接队列取出连接

```c
// OS 层（阻塞）
int connFd = accept(fd, NULL, NULL);
```

`accept()` 从全连接队列中取出**一个已完成三次握手的连接**，为它创建一个新的 fd。原来的监听 fd 继续监听，不受影响。

```text
listen fd (fd=3, port 8080)
  │
  │  accept()
  │
  ▼
conn fd (fd=4, 10.0.0.5:43210 → 192.168.1.1:8080)  ← 新的 fd，独立的连接
conn fd (fd=5, 10.0.0.6:51782 → 192.168.1.1:8080)  ← 又一个
```

```java
// Java 层
Socket client = serverSocket.accept();  // 阻塞，直到有新连接
// client 内部持有一个新的 fd
```

> `accept()` 返回的是一个**新的 Socket**，和原来的 `ServerSocket` 完全独立。`ServerSocket` 只负责监听，不负责数据传输。数据传输由 `accept()` 返回的 `Socket` 完成。

### 2.4 `connect()`：客户端发起三次握手

```c
// OS 层
struct sockaddr_in serverAddr = { .sin_port = htons(8080), .sin_addr.s_addr = inet_addr("192.168.1.1") };
connect(fd, (struct sockaddr*)&serverAddr, sizeof(serverAddr));
```

`connect()` 触发 TCP 三次握手。握手完成后，客户端的 Socket 进入 `ESTABLISHED` 状态，可以开始读写。

```java
// Java 层
Socket socket = new Socket("192.168.1.1", 8080);  // 内部调用 socket() + connect()
```

### 2.5 `read()` / `write()`：数据在内核缓冲区的流转

连接建立后，数据的读写路径：

```text
发送方:  应用 write(buf) → 用户缓冲区 → 内核发送缓冲区 → TCP 分段 → 网卡发出
接收方:  网卡收到 → 内核接收缓冲区 → 应用 read(buf) → 用户缓冲区
```

关键理解：**`write()` 不等于"数据已发出"，`read()` 不等于"数据来自网络"**。`write()` 只是把数据从用户空间拷贝到内核的发送缓冲区，真正的发送由内核的 TCP 协议栈异步完成。`read()` 只是从内核的接收缓冲区拷贝数据到用户空间。

```java
// Java 层
OutputStream out = socket.getOutputStream();
out.write("hello".getBytes());   // 数据进入内核发送缓冲区
out.flush();                     // 强制刷新（见 §3.4）

InputStream in = socket.getInputStream();
byte[] buf = new byte[1024];
int len = in.read(buf);          // 从内核接收缓冲区读取
```

### 2.6 `close()`：四次挥手与 fd 释放

```c
// OS 层
close(fd);
```

`close()` 做两件事：

1. **TCP 层**：发起四次挥手，关闭连接（主动关闭方进入 `FIN_WAIT` 状态）
2. **OS 层**：释放 fd 编号，回收内核中的 Socket 对象

```java
// Java 层
socket.close();  // 内部调用 close(fd)
```

> 同一个服务跑到线上，偶尔看 `netstat -ant | grep 8080` 会发现十几个 `CLOSE_WAIT` 状态的连接越积越多。`CLOSE_WAIT` 的意思是"对端发了 FIN，但本端还没调 `close()`"——大概率是你代码里某个异常分支没走到 `socket.close()`，或者连接池回收逻辑有漏，fd 一直被占着。不处理的话，CLOSE_WAIT 会一直积压到 fd 耗尽，新连接再也建不起来。

> **`close()` vs `shutdown()`**：`close()` 同时关闭读和写两个方向。`shutdown()` 可以只关闭一个方向（`shutdownOutput()` 关写，`shutdownInput()` 关读），另一个方向继续使用。典型场景：客户端发完请求后 `shutdownOutput()`，告诉服务端"我发完了"，但仍继续读取响应。

**完整的系统调用链总结：**

```text
服务端                           客户端
──────                           ──────
socket()  → fd                   socket()  → fd
bind(:8080)                       connect(192.168.1.1:8080)
listen(128)                        │  三次握手
    │                              │
accept() → connFd ◄───────────────┘
    │                              │
read(connFd) ◄──── write(fd) ────►│
write(connFd) ────► read(fd) ────►│
    │                              │
close(connFd)  ◄── 四次挥手 ──── close(fd)
```

## 3. 内核视角：Socket 背后的数据结构

### 3.1 发送缓冲区与接收缓冲区

每个 TCP Socket 在内核中有两块缓冲区：

```text
┌────────────────────────────────────────────────┐
│                   进程用户空间                   │
│                                                │
│   write(buf) ──► 用户数据                      │
│                   │                            │
└───────────────────┼────────────────────────────┘
                    │ 拷贝（CPU 参与）
┌───────────────────▼────────────────────────────┐
│                   内核空间                       │
│                                                │
│   ┌──────────────────────────┐                 │
│   │   发送缓冲区（sndbuf）    │ → TCP 协议栈 → 网卡 │
│   └──────────────────────────┘                 │
│                                                │
│   ┌──────────────────────────┐                 │
│   │   接收缓冲区（rcvbuf）    │ ← 网卡 ← TCP 协议栈│
│   └──────────────────────────┘                 │
│                   │                            │
└───────────────────┼────────────────────────────┘
                    │ 拷贝（CPU 参与）
┌───────────────────▼────────────────────────────┐
│   read(buf) ◀── 用户数据                       │
└────────────────────────────────────────────────┘
```

缓冲区大小由 Socket 选项 `SO_SNDBUF` 和 `SO_RCVBUF` 控制（详见 §3.4）。默认值因 OS 而异，Linux 通常为 **128KB ~ 256KB**，并会根据内存压力自动调整（`tcp_rmem` / `tcp_wmem` 内核参数）。

**发送缓冲区满会怎样？** `write()` 会**阻塞**，直到内核发出了一些数据腾出空间。这就是"写阻塞"——它不是因为网络慢，而是因为发送缓冲区满了。

**接收缓冲区空会怎样？** `read()` 会**阻塞**，直到有数据到达。这就是"读阻塞"——它不是因为没有连接，而是因为对方还没发数据。

### 3.2 全连接队列与半连接队列

> **活动期间，你发现新连接全部超时，但服务端 CPU 和内存都正常。** 同事怀疑是网络设备问题，你用 `ss -tln | grep 8080` 看了一眼—— `Recv-Q` 已经超过了 `Send-Q`。请求不慢，是它们根本没进到应用层。accept queue 满了，内核已经在悄悄丢包了。

`listen()` 之后，内核为这个监听 Socket 维护两个队列：

![kernel-queues](/java/kernel-queues.svg)

**全连接队列满（accept queue full）时：**

- 默认行为（`tcp_abort_on_overflow=0`）：内核**丢弃**新的 ACK，客户端以为连接成功了，服务端却不知道——客户端发数据会超时重传，最终可能收到 RST
- 设置 `tcp_abort_on_overflow=1`：内核直接发 RST，客户端立刻收到 `Connection reset`

**如何判断队列溢出？**

```bash
# 查看监听端口的队列状态
$ ss -ltn | grep 8080
State   Recv-Q  Send-Q  Local Address:Port
LISTEN  129     128     0.0.0.0:8080
#        ↑       ↑
#   当前排队数  backlog 上限
# Recv-Q > Send-Q 时，说明全连接队列溢出
```

**排查时关注的内核计数器：**

```bash
$ netstat -s | grep "listen"
    12345 times the listen queue of a socket overflowed
```

这个数字持续增长，说明应用的 `accept()` 速度跟不上连接到达速度——要么加快 accept（多线程 accept），要么增大 backlog。

### 3.3 阻塞的本质：线程在内核的哪里等

当应用调用 `read()` 但接收缓冲区为空时，线程到底发生了什么？

```text
线程调用 read(fd, buf, len)
      │
      ▼
内核检查接收缓冲区 → 空
      │
      ▼
线程状态: RUNNING → TASK_INTERRUPTIBLE（睡眠）
线程从 CPU 运行队列中移除
线程被挂到 Socket 的"等待队列"上
      │
      │  ... 数据到达 ...
      │
      ▼
内核中断处理 → 数据写入接收缓冲区 → 唤醒等待队列上的线程
线程状态: TASK_INTERRUPTIBLE → RUNNING
线程从 read() 处返回
```

**阻塞不是"线程在忙等/自旋"**，而是**线程被操作系统挂起了**——它不占 CPU 时间片，不消耗 CPU 资源。代价是占用了一块线程栈内存（~1MB）和一个内核调度实体。

这就是 BIO 的核心代价：**线程不消耗 CPU，但消耗内存和调度资源**。一个阻塞在 `read()` 上的线程，CPU 利用率为 0，但内存和 fd 一直被占着。

### 3.4 一台机器能承载多少 Socket

这是一个工程问题，瓶颈在多个层次：

| 层次 | 限制 | 默认值 | 调整方式 |
| :-- | :-- | :-- | :-- |
| **fd 上限（单进程）** | 每个 Socket 占一个 fd | 1024 | `ulimit -n 65535` |
| **fd 上限（系统级）** | 所有进程的 fd 总和 | ~100 万 | `/proc/sys/fs/file-max` |
| **端口范围（客户端）** | 临时端口数量 | 32768~60999（~28000） | `/proc/sys/net/ipv4/ip_local_port_range` |
| **内核内存** | 每个 Socket 约 3~10KB | — | 取决于缓冲区配置 |
| **全连接队列** | listen backlog | 128（取 min(backlog, somaxconn)） | `listen(backlog)` + `/proc/sys/net/core/somaxconn` |
| **半连接队列** | SYN queue 大小 | 256~1024 | `/proc/sys/net/ipv4/tcp_max_syn_backlog` |

**实际瓶颈通常在 fd 和内存：**

```text
一台 16GB 内存的服务器：
  fd 上限设为 65535 → 理论最多 65535 个 Socket
  每个 Socket 内核开销 5KB → 65535 × 5KB ≈ 320MB（可接受）
  每个连接的业务线程栈 1MB → 65535 × 1MB ≈ 64GB（BIO 模型下不可能）

如果用 NIO（无线程阻塞）：
  一个线程管理 10000 个连接 → 65535 个连接只需要 ~6 个线程
  内存开销 ≈ 320MB（Socket 内核对象） + 6MB（线程栈） → 完全可行
```

这就是为什么高并发场景必须用 NIO——不是因为 BIO "慢"，而是因为 BIO 用线程做等待，内存扛不住。

## 4. Socket 选项：生产中真正要调的参数

Socket 选项通过 `setsockopt()` 系统调用设置，Java 中通过 `ServerSocket.setOption()` / `Socket.setOption()` 或 `ServerSocketChannel` 设置。

### 4.1 `SO_REUSEADDR` 与 `SO_REUSEPORT`

**`SO_REUSEADDR`**：允许绑定处于 `TIME_WAIT` 状态的地址。

> 你重启了服务，结果报了一个 `BindException: Address already in use`。端口还在用？明明上一个进程已经 kill 了。这是因为旧连接还卡在 `TIME_WAIT`（见第 2 章四次挥手），要等 60 秒端口才能释放。`SO_REUSEADDR` 就是让你跳过这个等待。

```java
ServerSocket ss = new ServerSocket();
ss.setReuseAddress(true);          // SO_REUSEADDR
ss.bind(new InetSocketAddress(8080));
```

**`SO_REUSEPORT`**（Linux 3.9+）：允许多个进程/线程绑定同一个端口，内核在它们之间做负载均衡。适用于多线程 accept 的场景，避免单一 accept 线程成为瓶颈。

```java
// Java 11+ 通过 ServerSocketChannel 设置
ServerSocketChannel ssc = ServerSocketChannel.open();
ssc.setOption(StandardSocketOptions.SO_REUSEPORT, true);
ssc.bind(new InetSocketAddress(8080));
```

### 4.2 `TCP_NODELAY`：禁用 Nagle 算法

Nagle 算法会把小包合并后再发送，以提高网络利用率。但对延迟敏感的场景（游戏、实时通信、RPC），这个合并会引入额外延迟。

```java
socket.setTcpNoDelay(true);  // TCP_NODELAY = true，禁用 Nagle
```

**经验法则**：RPC 框架（Dubbo、gRPC）默认开启 `TCP_NODELAY`；HTTP 服务器通常不开。

### 4.3 `SO_KEEPALIVE`：TCP 层保活

TCP KeepAlive 在空闲连接上定期发送探测包，检测对端是否存活。

```java
socket.setKeepAlive(true);  // SO_KEEPALIVE = true
```

TCP KeepAlive 的默认参数（Linux）：

| 参数 | 默认值 | 含义 |
| :-- | :-- | :-- |
| `tcp_keepalive_time` | 7200 秒 | 空闲多久后开始探测 |
| `tcp_keepalive_intvl` | 75 秒 | 探测间隔 |
| `tcp_keepalive_probes` | 9 次 | 多少次无响应判定断开 |

> **注意**：默认 2 小时才开始探测，对于长连接服务来说太慢了。生产中通常结合**应用层心跳**（如每 30 秒发一次 ping/pong），TCP KeepAlive 只作为兜底。

### 4.4 `SO_RCVBUF` / `SO_SNDBUF`：缓冲区大小

控制内核为每个 Socket 分配的收发缓冲区大小。

```java
socket.setReceiveBufferSize(256 * 1024);   // SO_RCVBUF = 256KB
socket.setSendBufferSize(256 * 1024);      // SO_SNDBUF = 256KB
```

| 场景 | 建议 |
| :-- | :-- |
| 低延迟、小数据量 | 默认即可（128KB） |
| 高吞吐、大数据量（文件传输） | 适当增大（512KB ~ 1MB） |
| 内存紧张、连接数极多 | 适当减小（64KB） |

Linux 内核会自动在 `tcp_rmem` / `tcp_wmem` 范围内调整缓冲区大小（自动调优），通常不需要手动设置。

### 4.5 在 Java 中设置 Socket 选项

| 选项 | ServerSocket | Socket | Channel |
| :-- | :-- | :-- | :-- |
| `SO_REUSEADDR` | `setReuseAddress(true)` | `setReuseAddress(true)` | `setOption(SO_REUSEADDR, true)` |
| `SO_REUSEPORT` | — | — | `setOption(SO_REUSEPORT, true)` |
| `TCP_NODELAY` | — | `setTcpNoDelay(true)` | `setOption(TCP_NODELAY, true)` |
| `SO_KEEPALIVE` | — | `setKeepAlive(true)` | `setOption(SO_KEEPALIVE, true)` |
| `SO_RCVBUF` | `setReceiveBufferSize(n)` | `setReceiveBufferSize(n)` | `setOption(SO_RCVBUF, n)` |
| `SO_SNDBUF` | — | `setSendBufferSize(n)` | `setOption(SO_SNDBUF, n)` |

> **注意**：Socket 选项必须在 `connect()` / `bind()` **之前**设置，部分选项在连接建立后修改不生效。

## 5. 动手：用 Java Socket 跑通一个 Echo

前面四节讲的是 Socket 的"是什么"和"怎么工作"。这一节用最小的代码示例把理论变成可运行的程序。

### 5.1 Echo Server

```java
import java.io.*;
import java.net.*;
import java.util.concurrent.*;

public class EchoServer {
    public static void main(String[] args) throws IOException {
        ServerSocket serverSocket = new ServerSocket(8080);
        ExecutorService pool = Executors.newFixedThreadPool(100);
        System.out.println("Echo Server started on port 8080");

        while (true) {
            Socket client = serverSocket.accept();            // 阻塞等待连接
            pool.submit(() -> {
                try (client) {
                    InputStream in = client.getInputStream();
                    OutputStream out = client.getOutputStream();
                    byte[] buf = new byte[1024];
                    int len;
                    while ((len = in.read(buf)) != -1) {     // 阻塞读取
                        out.write(buf, 0, len);                // Echo 回写
                        out.flush();
                    }
                } catch (IOException e) {
                    // 客户端断开
                }
            });
        }
    }
}
```

### 5.2 Echo Client

```java
import java.io.*;
import java.net.*;

public class EchoClient {
    public static void main(String[] args) throws IOException {
        Socket socket = new Socket("localhost", 8080);
        OutputStream out = socket.getOutputStream();
        InputStream in = socket.getInputStream();

        out.write("hello\n".getBytes());
        out.flush();

        byte[] buf = new byte[1024];
        int len = in.read(buf);
        System.out.println("Server replied: " + new String(buf, 0, len));

        socket.close();
    }
}
```

### 5.3 代码剖析

**为什么 `out.flush()` 是必要的？**

`OutputStream.write()` 默认使用缓冲区，数据不会立即进入内核发送缓冲区。`flush()` 强制把应用层缓冲区的数据写入内核。不调 `flush()`，对方可能一直收不到数据。

**为什么用 `FixedThreadPool` 而不是 `CachedThreadPool`？**

`CachedThreadPool` 无上限，连接暴涨时会创建过多线程。`FixedThreadPool` 限制并发线程数，超出的任务在队列中等待——这是保护服务端的基本手段。

### 5.4 一连接一线程的局限

上面的 Echo Server 是经典的 BIO 模型：**每个连接占一个线程**。线程大部分时间阻塞在 `read()` 上，不消耗 CPU，但消耗内存和调度资源。

```text
1000 个连接 → 1000 个线程 → ~1GB 栈内存 → 勉强可行
10000 个连接 → 10000 个线程 → ~10GB 栈内存 → 不可行
```

这个局限不是 Socket 的问题，而是 **BIO 线程模型**的问题。解决方案是 NIO——用一个线程通过 **Selector** 监听多个 Channel 的事件，线程只在"有数据可读"时才被唤醒，不需要为每个连接阻塞一个线程。这是下一章的内容。

## 6. 本章小结

| 概念 | 要点 |
| :-- | :-- |
| Socket 的本质 | OS 提供的网络编程抽象，本质是 fd + 协议栈 |
| 五元组 | `{源IP, 源端口, 目标IP, 目标端口, 协议}` 唯一标识一条连接 |
| 一个端口多条连接 | 服务端一个监听端口可以 accept 出成千上万条连接 |
| 系统调用链 | `socket()` → `bind()` → `listen()` → `accept()` → `read()`/`write()` → `close()` |
| 内核缓冲区 | 每个 Socket 有收发两块缓冲区，read/write 操作的是缓冲区而非网络 |
| 全连接队列 | accept queue 溢出时连接被丢弃，需关注 `ss -ltn` 中的 Recv-Q |
| fd 限制 | 单进程默认 1024，高并发需调 `ulimit -n` |
| Socket 选项 | `SO_REUSEADDR`、`TCP_NODELAY`、`SO_KEEPALIVE` 等是生产必调项 |
| BIO 的局限 | 一连接一线程，内存扛不住 → 需要 NIO |
