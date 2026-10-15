# Java NIO：高性能网络模型

> 高并发下线程池耗尽但 CPU 仍较空闲，通常说明大量工作线程正在等待网络或其他慢资源。要判断原因，需要同时确认连接器模式、线程栈、请求体读取方式和外部依赖，不能只凭线程名推断 I/O 模型。本章解释 Java NIO 的 Selector、Channel、Buffer 如何让少量线程管理多个连接。

## 1. 从阻塞式 I/O 的等待成本开始

### 1.1 线程池耗尽但 CPU 未饱和

构造场景：压测 500 并发，`server.tomcat.threads.max=200`。200 个请求进入工作线程，其余等待排队；CPU 使用率为 15%。

先用 `jstack` 观察线程在做什么。下面的阻塞式读栈用于展示等待特征，不能仅凭名为 `http-nio` 的线程名判断连接器实际使用的 I/O 实现：

```txt
"http-nio-8080-exec-127" #127 daemon prio=5 os_prio=0 tid=... nid=... 
   java.lang.Thread.State: RUNNABLE
        at java.net.SocketInputStream.socketRead0(Native Method)
        at java.net.SocketInputStream.socketRead(SocketInputStream.java:116)
        ...
"http-nio-8080-exec-128" #128 daemon prio=5
   java.lang.Thread.State: RUNNABLE
        at java.net.SocketInputStream.socketRead0(Native Method)
        ...
```

如果大量线程停留在 `socketRead0`，它们正在等待套接字读取完成。线程状态可能显示为 `RUNNABLE`，但线程并没有持续计算。阻塞式模型可能因此占用大量线程，而 CPU 不一定饱和。还应检查具体 Tomcat 版本、`<Connector>` 配置、请求读取位置以及是否在等待下游服务。

Tomcat 的 Acceptor 和 Poller 可以使用 Selector 管理就绪事件，但业务处理、下游调用或阻塞式流读取仍可能占用工作线程。NIO 优化的是连接就绪通知与多路复用，不会自动让所有业务操作变成非阻塞。

### 1.2 BIO 把线程当「等待工」用

[第 4 章 §5.1 的 Echo Server](./chapter-04-socket.md#echo-server) 用的就是最原始的 BIO：每 `accept` 一个连接，分配一个线程处理。线程大部分时间都阻塞在 `read()` 上。

```txt
┌─────────────────────────────────────────┐
│              Main Thread                │
│   serverSocket.accept()  ◄── 阻塞等待    │
└──────────────┬──────────────────────────┘
               │ 新连接到达
       ┌───────▼───────┐
       │  Thread Pool  │
       ├───────┬───────┤
       │ T1    │ T2    │  T3 ...
       │       │       │
       │ read()│ read()│ read()
       │ 阻塞   │ 阻塞  │ 阻塞
       │ write()│write()│write()
       │ 阻塞   │ 阻塞  │ 阻塞
       └───────┴───────┘
```

![bio-thread-timeline](/java/bio-thread-timeline.svg)

每个 Java 线程通常需要独立的栈空间（默认约 1MB，取决于 JVM 参数和平台，虚拟线程则不同）。以 10000 个平台线程粗略估算，栈内存约 10GB。花 10GB 内存雇一万个「等待工」，大部分时间在工位上睡觉。

```txt
线程状态分布（典型 Web 服务器）:
┌──────────────────────────────────────────────────────┐
│ ████████ 10%  计算（业务逻辑）                         │
│ ████████████████████████████████████ 70% 阻塞等待 I/O │
│ ██████ 10%  等待调度                                  │
│ ██████ 10%  其他（GC 等）                             │
└──────────────────────────────────────────────────────┘
```

BIO 仍有适用场景——并发量有限、实现简单性更重要的场合（如连接数少、短生命周期请求、原型开发）。Tomcat 7 以前默认 BIO，Tomcat 8.5 起移除 BIO 连接器，因为现代 Web 应用面对的并发量需要更高效的事件驱动模型。但阻塞式 I/O 的主要成本不是某个固定的连接数，而是每个等待中的任务是否需要长期占用一个平台线程；不存在适用于所有 JVM 和服务的统一连接数分界线。

### 1.3 NIO 的核心思想：换一种「等」的方式

BIO 的根因是：线程被用来「等数据来」。NIO 换了一个思路：**让操作系统在「有数据可读」时通知我，线程只负责处理。**

```txt
BIO:  线程 → read() → 阻塞等数据 → 数据到了 → 处理 → read() → 阻塞等 ...
NIO:  线程 → 注册关心 READ 事件 → 做其他事 → Selector 通知「可读」→ 处理 → 继续等通知
```

| 对比维度 | BIO | NIO |
| :-- | :-- | :-- |
| I/O 模型 | 阻塞 | 非阻塞 |
| 线程与连接 | 1 : 1 | 1 : N |
| 等待方式 | 线程挂起 | 事件通知（多路复用） |
| 大量连接的线程占用 | 每连接可能需要工作线程 | 少量 I/O 线程可管理多个连接 |
| 编程复杂度 | 低 | 高 |

NIO 依赖三个核心组件——Channel、Buffer、Selector。

![nio-components](/java/nio-components.svg)

这三个组件共同工作：Channel 表示 I/O 连接，Buffer 是读写数据的容器，Selector 让一个线程同时检查多个 Channel 的就绪事件。下面按这三个组件说明阻塞等待与事件通知的差异。

## 2. Selector 是核心：一个线程凭什么管几千连接

先讲 Selector，因为它回答了本章最核心的问题——开头故障里 Tomcat 的 Poller 线程在干什么。

### 2.1 Poller 线程到底在干什么

回到那个故障。你 jstack 里除了 200 个卡在 `socketRead0` 的工作线程，还看到了这个：

```txt
"http-nio-8080-Poller" #30 daemon prio=5 os_prio=0 tid=... nid=... runnable
   java.lang.Thread.State: RUNNABLE
        at sun.nio.ch.EPollArrayWrapper.epollWait(Native Method)
        at sun.nio.ch.EPollArrayWrapper.poll(EPollArrayWrapper.java:269)
        at sun.nio.ch.EPollSelectorImpl.doSelect(EPollSelectorImpl.java:93)
        at sun.nio.ch.SelectorImpl.lockAndDoSelect(SelectorImpl.java:86)
        at sun.nio.ch.SelectorImpl.select(SelectorImpl.java:97)
```

这一行 `epollWait`，就是 Tomcat 的 Poller 线程。它不处理任何请求，它只做一件事：**跟操作系统说「帮我盯着这 500 个连接，哪个有数据来了叫我」。** 这就是 Selector。

### 2.2 Selector 的工作方式

下面的示例只展示事件分发的核心结构：`buffer` 是共享示意，未处理非阻塞写入的部分写入、连接状态隔离和异常，不能直接作为生产实现。

```java
// 第一步：创建 Selector
Selector selector = Selector.open();

// 第二步：将 Channel 注册到 Selector，指定关注的事件
ServerSocketChannel ssc = ServerSocketChannel.open();
ssc.configureBlocking(false);
ssc.register(selector, SelectionKey.OP_ACCEPT);

ByteBuffer buffer = ByteBuffer.allocate(1024);  // 读缓冲（教学示例用共享 buffer，真实实现每个连接应独立）

// 第三步：循环等待事件
while (true) {
    int readyCount = selector.select();  // 阻塞，直到至少一个事件就绪
    if (readyCount == 0) continue;

    // 第四步：遍历就绪事件
    Set<SelectionKey> keys = selector.selectedKeys();
    Iterator<SelectionKey> iter = keys.iterator();

    while (iter.hasNext()) {
        SelectionKey key = iter.next();

        if (key.isAcceptable()) {
            // 处理新连接
            ServerSocketChannel server = (ServerSocketChannel) key.channel();
            SocketChannel client = server.accept();
            client.configureBlocking(false);
            client.register(selector, SelectionKey.OP_READ);
            System.out.println("New connection: " + client.getRemoteAddress());

        } else if (key.isReadable()) {
            // 处理可读事件
            SocketChannel client = (SocketChannel) key.channel();
            buffer.clear();
            int bytesRead = client.read(buffer);

            if (bytesRead == -1) {
                System.out.println("Client disconnected");
                client.close();
            } else {
                buffer.flip();
                client.write(buffer);  // 非阻塞写可能只写部分，需注册 OP_WRITE 继续写（见 §6 说明）
            }
        }

        iter.remove();  // 必须手动移除，否则下次还会被处理
    }
}
```

四个关键事件：

| 事件 | 常量 | 含义 |
| :--- | :--- | :--- |
| 连接就绪 | `SelectionKey.OP_CONNECT` | 客户端连接建立完成 |
| 接受就绪 | `SelectionKey.OP_ACCEPT` | 有新连接到达（ServerSocketChannel） |
| 读就绪 | `SelectionKey.OP_READ` | Channel 有数据可读 |
| 写就绪 | `SelectionKey.OP_WRITE` | Channel 可以写入数据 |

`SelectionKey` 是 Channel 和 Selector 之间的「注册凭证」：

```java
SelectionKey key = channel.register(selector, SelectionKey.OP_READ);
key.attach(new ClientState());  // 附加一个状态对象

ClientState state = (ClientState) key.attachment();
```

`select()` 有三种变体：

```java
selector.select();              // 阻塞，直到有事件就绪
selector.select(1000);          // 阻塞最多 1000ms，超时返回 0
selector.selectNow();           // 非阻塞，立即返回当前就绪数
```

**Selector 做的事情，说白了就是：替你用 epoll（Linux）/ kqueue（macOS）/ IOCP（Windows）跟内核打交道。** 你不用关心每个平台上怎么实现多路复用的，Selector 统一了接口。但代价是你得理解它的事件模型——它只告诉你「有数据了」，不负责帮你读、帮你写、帮你拼数据。

## 3. Channel：BIO 的 Stream 为什么不够用

### 3.1 一个连接 = 一个 Channel

写完 Selector，回到 Tomcat。Tomcat 不用 `InputStream.read()` 来等数据——它用的是 `SocketChannel`。你线上看到的每个 Socket 连接，在 NIO 里对应一个 Channel。

BIO 的 Stream 是单向的：`InputStream` 只读，`OutputStream` 只写。你需要同时持有两个对象才能完成一次双向通信。NIO 的 Channel 把这两个合并成一个：

```java
// BIO：需要两个 Stream
InputStream in = socket.getInputStream();    // 只读
OutputStream out = socket.getOutputStream(); // 只写

// NIO：一个 Channel 搞定双向
SocketChannel sc = SocketChannel.open();
sc.read(buffer);   // 从 Channel 读入 Buffer
sc.write(buffer);  // 从 Buffer 写入 Channel
```

| 特性 | Stream | Channel |
| :--- | :--- | :--- |
| 方向 | 单向（in 或 out） | 双向（可读可写） |
| 阻塞 | 默认阻塞 | 默认阻塞，可配为非阻塞 |
| 数据操作 | 直接读写字节 | 必须通过 Buffer |
| 注册到 Selector | 不支持 | 非阻塞模式下支持 |

### 3.2 四种 Channel 类型

```java
// 文件通道
FileChannel fileChannel = FileChannel.open(Paths.get("data.txt"), StandardOpenOption.READ); // JDK 8 起可用；JDK 11+ 也可用 Path.of()

// TCP 网络通道
SocketChannel clientChannel = SocketChannel.open(new InetSocketAddress("localhost", 8080));
ServerSocketChannel serverChannel = ServerSocketChannel.open();
serverChannel.bind(new InetSocketAddress(8080));

// UDP 网络通道
DatagramChannel udpChannel = DatagramChannel.open();
```

| Channel 类型 | 用途 | 对应 BIO 类 |
| :--- | :--- | :--- |
| `ServerSocketChannel` | 监听 TCP 连接 | `ServerSocket` |
| `SocketChannel` | TCP 双向读写 | `Socket` |
| `DatagramChannel` | UDP 读写 | `DatagramSocket` |
| `FileChannel` | 文件读写（不支持非阻塞模式和 Selector 注册） | `FileInputStream/OutputStream` |

### 3.3 非阻塞：让 Selector 能用上 Channel

Channel 默认是阻塞的，必须手动切：

```java
ServerSocketChannel ssc = ServerSocketChannel.open();
ssc.configureBlocking(false);    // 非阻塞模式

SocketChannel sc = ssc.accept(); // 无连接时返回 null，不阻塞
```

只有非阻塞的 Channel 才能注册到 Selector。这就是 Selector 和 Channel 的耦合点——它们两个谁离了谁都成不了「一个线程管 N 个连接」。

## 4. Buffer：你线上见过的 DirectByteBuffer OOM

### 4.1 为什么 Channel 要经过 Buffer 读写

在 BIO 中，`read(byte[] buf)` 直接把数据读到字节数组里。NIO 的 Channel 则通过 Buffer 读写数据——`read(ByteBuffer)`、`write(ByteBuffer)`。

```txt
BIO:   Stream  ──read──►  byte[]
NIO:   Channel ──read──►  Buffer ──get()──►  byte[]
```

为什么多这一层？非阻塞 I/O 的一次 `read()` 可能只读到部分数据，一次 `write()` 也可能只写出部分字节，调用方需要在多次 I/O 之间保留未处理的数据。`byte[]` 本身也能存数据，但需要自己维护偏移量和长度；`ByteBuffer` 的价值在于把 `position`、`limit`、`capacity` 这些读写状态封装在一起，提供统一的读写接口，让"上次读到哪、这次接着读"不用手动管理。

另外，Channel 并不都工作在非阻塞模式：`SocketChannel`、`DatagramChannel` 可以配置为非阻塞，`FileChannel` 则始终是阻塞式，也不能注册到 Selector。

### 4.2 你线上的 DirectByteBuffer OOM

你见过这个报错吗？

```txt
java.lang.OutOfMemoryError: Direct buffer memory
```

`Direct buffer memory` 表示 JVM 无法满足一次直接缓冲区分配请求，它不一定意味着 Java 堆已耗尽，也不能仅凭这个错误断定 Netty 的 `ByteBuf` 没有释放。

`ByteBuffer.allocateDirect()` 返回的 Java 对象仍在堆上，只是数据存放在堆外内存，底层内存通常由 JVM 的清理机制释放（具体实现属于 JDK 细节，应用不应依赖某个 Cleaner 类的内部行为）；Netty 的 `ByteBuf` 则可能使用堆内存、直接内存或池化内存，并通过引用计数管理生命周期，两者不能划等号。排查时应结合直接内存上限（如 `-XX:MaxDirectMemorySize`）、缓冲区分配与释放情况，以及 Netty 的泄漏检测结果判断。

理解这个 Bug，必须理解 Buffer 的内部机制。

### 4.3 Buffer 的三个状态属性

每个 Buffer 维护三个状态属性：

![buffer-ops](/java/buffer-ops.svg)

| 属性 | 含义 | 取值范围 |
| :--- | :--- | :--- |
| **capacity** | Buffer 的总容量，创建后不可变 | 固定 |
| **limit** | 当前读写操作允许到达的边界（不包含该索引） | 0 ≤ limit ≤ capacity |
| **position** | 下一次读或写的起始位置 | 0 ≤ position ≤ limit |

### 4.4 Buffer 的核心操作——flip 是最高频的坑

```java
// 1. 写入数据
buffer.put((byte) 'A');    // position: 0 → 1

// 2. flip()：从写模式切换到读模式
buffer.flip();             // limit = position; position = 0
// 现在可以从头开始读

// 3. 读取数据
byte b = buffer.get();     // position: 0 → 1

// 4. clear()：清空，准备重新写入
buffer.clear();            // position = 0; limit = capacity

// 5. compact()：保留未读数据，准备继续写入
buffer.compact();          // 把 [position, limit) 的数据复制到开头
```

`flip()` 设置 `limit = position`，再把 `position` 设为 0，把写模式切换为读模式。写完后若不切换读模式，后续读取位置仍取决于当前位置和上限，可能读到此前未写入的区域，或读不到刚写入的数据。读取前应按读写模式维护 `position`、`limit` 和 `capacity`。

这正是 Netty 用 `ByteBuf` 替代 `ByteBuffer` 的核心原因：ByteBuf 把读指针和写指针分开，不需要你手动 flip。

### 4.5 堆内存 vs 堆外内存

```java
ByteBuffer buf = ByteBuffer.allocate(1024);           // 堆内存，受 GC 管理
ByteBuffer directBuf = ByteBuffer.allocateDirect(1024); // 堆外内存
```

| 分配方式 | 优点 | 缺点 |
| :--- | :--- | :--- |
| `allocate()` | 分配快，受 GC 管理 | I/O 时可能需要额外拷贝 |
| `allocateDirect()` | 减少内核态/用户态拷贝 | 分配慢，不在 GC 范围内，必须手动或通过 Cleaner 释放 |

长期存活的 Buffer（连接池中的读写缓冲区）可考虑 `allocateDirect()`；短期临时 Buffer 用 `allocate()`。但这不是放之四海皆准的规则：直接内存分配较慢、且受直接内存上限约束，是否划算要看 I/O 路径、缓冲区复用率和实测结果。用错了不会报错——只是 GC 曲线更陡，或者堆外内存悄悄涨上来。

## 5. 文件传输优化：transferTo 与零拷贝

把一份数据从文件发到网络，常见的教学模型描述为 4 次拷贝（实际次数取决于操作系统、JDK 实现与硬件，并非固定）：

```txt
传统 I/O（4 次拷贝 + 4 次上下文切换）：
  磁盘 → 内核缓冲区 → 用户缓冲区 → Socket 缓冲区 → 网卡
         read()         用户态        write()
         (内核→用户)    处理数据       (用户→内核)
```

用户空间只是「过了一下手」，什么都没做，却引发了两次 CPU 拷贝。零拷贝的思想很直接：**让数据留在内核空间。**

```java
// 传统方式：数据经过用户空间
fileChannel.read(buffer);    // 内核 → 用户
socketChannel.write(buffer); // 用户 → 内核

// 零拷贝：数据尽量不经过用户空间
fileChannel.transferTo(0, fileChannel.size(), socketChannel);
// 在适用平台和条件下可能走 sendfile 等高效传输；具体系统调用与拷贝次数取决于实现，一次也可能只传部分，需按返回值继续
```

| 场景 | 是否适合 | 原因 |
| :--- | :--- | :--- |
| 文件服务器（Nginx、静态资源） | ✅ 非常适合 | 大文件传输，数据不需要修改 |
| 消息队列（Kafka） | ✅ 非常适合 | 消息从磁盘直接发到网络 |
| 数据压缩/加密 | ❌ 不适合 | 数据需要在用户空间处理 |
| 小文件传输 | ⚠️ 收益有限 | 系统调用开销可能抵消零拷贝收益 |

`ByteBuffer.allocateDirect()` 也能减少部分拷贝——堆内存 Buffer 在 I/O 时可能需要额外拷贝到直接内存（操作系统通常不能直接访问 Java 堆），直接 Buffer 则可能省掉这一步。但它不等于零拷贝，也不等于 `transferTo()` 的文件到通道优化。

```txt
allocate()：       堆内存 → 临时直接内存 → 内核缓冲区 → 网卡
allocateDirect()： 直接内存 → 内核缓冲区 → 网卡
```

## 6. NIO Reactor 模式：Tomcat 的 Boss-Worker 就长这样

### 6.1 单线程 NIO Echo

把 Channel + Buffer + Selector 组合在一起的最简骨架——你可以对照着看它和后面 Tomcat 的 Acceptor/Poller/Worker 是怎么对应的。注意这是教学简化版：所有连接共享一个 `buffer`、非阻塞写入不处理部分写入，真实实现见 §6.2 的说明。

```java
public class NioEchoServer {
    public static void main(String[] args) throws IOException {
        Selector selector = Selector.open();
        ServerSocketChannel ssc = ServerSocketChannel.open();
        ssc.configureBlocking(false);
        ssc.bind(new InetSocketAddress(8080));
        ssc.register(selector, SelectionKey.OP_ACCEPT);

        System.out.println("NIO Echo Server started on port 8080");
        ByteBuffer buffer = ByteBuffer.allocate(1024);

        while (true) {
            selector.select();

            Set<SelectionKey> keys = selector.selectedKeys();
            Iterator<SelectionKey> iter = keys.iterator();

            while (iter.hasNext()) {
                SelectionKey key = iter.next();
                iter.remove();

                if (key.isAcceptable()) {
                    ServerSocketChannel server = (ServerSocketChannel) key.channel();
                    SocketChannel client = server.accept();
                    client.configureBlocking(false);
                    client.register(selector, SelectionKey.OP_READ);

                } else if (key.isReadable()) {
                    SocketChannel client = (SocketChannel) key.channel();
                    buffer.clear();
                    int bytesRead = client.read(buffer);
                    if (bytesRead == -1) {
                        client.close();
                    } else {
                        buffer.flip();
                        client.write(buffer);
                    }
                }
            }
        }
    }
}
```

**示例边界**：上面这段代码用于展示 Channel、Buffer 与 Selector 的基本协作流程，不是可直接用于多客户端通信的完整 Echo Server。为突出事件循环骨架，示例简化了连接状态管理，未处理非阻塞写入的部分写入问题；多个连接共用缓冲区也可能导致数据相互覆盖。实际实现必须为每个连接维护独立状态，并在数据未写完时通过 `OP_WRITE` 继续发送。相关工程复杂度见 §6.2。

### 6.2 单线程 Reactor 的瓶颈

上面这个 Echo 能跑，但有几个隐蔽问题。

第一，如果读取事件的处理逻辑里跑了慢业务（比如查了个慢 SQL），Selector 线程会被卡住。这期间所有其他连接的 I/O 事件——新连接到达、已有连接发数据——全部得不到处理。**I/O 处理不能阻塞 Selector 线程。**

第二，这个示例是教学简化，离生产实现还有距离：所有连接共用一个 `buffer`，客户端 A 读入的数据还没回写完，客户端 B 的可读事件就可能 `buffer.clear()` 覆盖它；非阻塞的 `client.write(buffer)` 也可能只写出部分数据。真实实现需要为每个连接维护独立的读缓冲区和待写状态，写不完整时注册 `OP_WRITE`，等可写后继续发送。

### 6.3 主从多 Reactor：Tomcat 的三线程模型

这正是 Tomcat NioEndpoint 的三线程设计要解决的问题：

![reactor-master-slave](/java/reactor-master-slave.svg)

| 角色 | 对应 Tomcat | 职责 | 线程数 |
| :--- | :--- | :--- | :--- |
| Boss Reactor | **Acceptor** | accept() 新连接，注册到 Poller | 1 |
| Worker Reactor | **Poller** | Selector.select() 等待 I/O 事件 | 默认与 CPU 核数相关（具体以版本与配置为准） |
| Worker Pool | **Exec** | 实际处理请求（读数据、调 Servlet、写响应） | 可配置（maxThreads） |

这就是开头故障里你看到的三类线程：一个 Acceptor 接新连接，几个 Poller 用 epoll 等数据，200 个 Exec 线程做实际工作。表中线程数是概念示意，Tomcat 实际的线程数量与连接器实现、版本和配置有关，不应把某个默认值当成固定架构。

## 7. 不直接用 NIO 的原因

原生 NIO 能工作，但写生产代码需要一个人搞定下面这张清单：

```txt
├── Buffer 的 flip / clear / compact 切换（容易混淆状态含义）
├── 半包 / 粘包问题（TCP 是字节流，没有消息边界）
├── SelectionKey 的 attach / detach 生命周期
├── Channel 的非阻塞写（一次 write 可能没写完，要注册 OP_WRITE 接着写）
├── 空闲连接检测与超时关闭
├── 线程安全（多线程操作同一个 Channel）
└── 异常处理（连接重置、管道破裂）
```

一个需要处理完整连接生命周期、协议边界和异常情况的原生 NIO 服务端，工程代码可能增长到数百行，而等价的 BIO 版本往往只要几十行。这是经验性描述，不是固定要求。

### 7.1 epoll 空轮询问题（JDK-6670302）

部分 JDK 版本的 Linux Selector 实现曾出现空轮询问题：在没有新 I/O 事件时，`select()` 仍反复立即返回，事件循环因此持续消耗 CPU：

```java
// 正常：select() 阻塞直到有事件
int ready = selector.select(timeout);

// 异常：select() 反复立即返回，循环空转 → CPU 100%
while (true) {
    int ready = selector.select(timeout);  // 本应阻塞，却持续立刻返回
}
```

注意，`select()` 返回 0 不一定是这个 Bug：超时、`wakeup()` 也会让它返回 0。排查时应观察一段时间内的返回行为、线程 CPU 使用率，而不是凭一两次零返回下结论。

Netty 对这类问题提供了检测和 Selector 重建机制，具体触发条件应以所用 Netty 版本为准，不能把某个实现里的计数阈值当成所有版本的固定规则。

### 7.2 所以有了 Netty

```txt
原生 NIO 的痛点              Netty 的解决方案
─────────────────           ─────────────────
Buffer flip/clear 繁琐 ──►  ByteBuf（读写指针分开，自动扩容）
epoll 空轮询 Bug       ──►  自动检测 + 重建 Selector
缺少协议支持           ──►  内置 HTTP/HTTPS/WebSocket/SSL 编解码
手动管理线程模型       ──►  EventLoopGroup 抽象
半包粘包               ──►  内置拆包器（LengthField, Delimiter, ...）
```

> 学原生 NIO 不是为了手写 NIO 服务器。是为了当你线上看到 `Direct buffer memory` OOM、Tomcat Poller 线程池打满、Netty 的 `IllegalReferenceCountException` 时，你知道问题在哪一层、该翻哪行源码——而不是只能重启试试。

## 8. 本章小结

| 概念 | 你什么时候会用到它 |
| :--- | :--- |
| **Selector** | 你看 Tomcat Poller 线程卡在 `epollWait`，想知道它到底在等什么 |
| **Channel** | 你看 Netty 日志说 `Channel closed`，想知道 Channel 对应你代码里的哪个对象 |
| **Buffer / flip** | 你看 `Direct buffer memory` OOM，想搞明白堆外内存是怎么被吃掉的 |
| **Reactor** | 你想看懂 Tomcat NioEndpoint 的 Acceptor/Poller/Worker 怎么协作 |
| **零拷贝** | 你想知道 Kafka 为什么吞吐那么高，自己的文件下载服务为什么跑不满网卡 |
