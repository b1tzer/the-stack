# Java NIO：高性能网络模型

> 你的Tomcat服务线上跑了三个月，一直很稳。这周做活动，QPS翻了十倍，问题来了——`ss -tln` 看端口队列暴涨，jstack 看 Tomcat 的 Poller 线程池只有一个人在工作，另一个线程池却全满了，CPU 反而只有 15%。你不理解问题出在哪，因为你从没关心过 Tomcat 的 NIO 是什么、怎么工作的。这一章回答：你每天依赖的 NIO，到底在底层干了什么。

## 1. 从一次线上故障开始

### 1.1 你的Tomcat线程池爆了，但CPU没满

故障现象：压测 500 并发，`server.tomcat.threads.max=200`。200 个请求进来，剩下 300 个全排在 accept 队列里，用户侧超时。CPU 只有 15%。

为什么线程满了，CPU 却不忙？jstack 拉一把看看线程都在干什么：

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

200 个线程，大部分在 `socketRead0`——等客户端发数据。线程是活的（RUNNABLE），但不干活。这就是 BIO 的终极代价：**用线程做等待，内存扛不住，CPU却闲着。**

但 Tomcat 8.5+ 默认不是 NIO 吗？为什么还会有这个问题？因为 NIO 只解决了一大半——Tomcat 的 Acceptor 和 Poller 用了 NIO Selector 来等连接和等数据，但实际处理请求的工作线程仍然在 `read()` 上阻塞。**NIO 做的不是消除阻塞，而是把阻塞从「每个连接都要占一个工作线程」变成「一个 Poller 线程替所有人等」。**

### 1.2 BIO 把线程当「等待工」用

上一章 §3.5 的 Echo Server 用的就是最原始的 BIO：每 `accept` 一个连接，分配一个线程处理。线程 90% 的时间都阻塞在 `read()` 上。

```txt
┌─────────────────────────────────────────┐
│              Main Thread                 │
│   serverSocket.accept()  ◄── 阻塞等待   │
└──────────────┬──────────────────────────┘
               │ 新连接到达
       ┌───────▼───────┐
       │  Thread Pool   │
       ├───────┬───────┤
       │ T1    │ T2    │  T3 ...
       │       │       │
       │ read()│ read()│ read()
       │ 阻塞  │ 阻塞  │ 阻塞
       │ write()│write()│write()
       │ 阻塞  │ 阻塞  │ 阻塞
       └───────┴───────┘
```

![bio-thread-timeline](/java/bio-thread-timeline.svg)

每个 Java 线程需要独立的栈空间（~1MB）。10000 个连接 = 10000 个线程 = ~10GB 内存。你花 10GB 内存雇了一万个「等待工」，让他们 70% 的时间在工位上睡觉。

```txt
线程状态分布（典型 Web 服务器）:
┌──────────────────────────────────────────────┐
│ ████████ 10%  计算（业务逻辑）                 │
│ ████████████████████████████████████ 70% 阻塞等待 I/O │
│ ██████ 10%  等待调度                          │
│ ██████ 10%  其他（GC 等）                      │
└──────────────────────────────────────────────┘
```

BIO 仍有适用场景——连接数 < 100、短生命周期请求、原型开发——但这些场景下增加复杂度的代价大于收益。Tomcat 7 以前默认 BIO，Tomcat 8.5 起全面转向 NIO，因为现代 Web 应用面对的并发量和这个模型已经水火不容了。

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
| 万连接内存 | ~10 GB | ~数百 MB |
| 编程复杂度 | 低 | 高 |

NIO 依赖三个核心组件——Channel、Buffer、Selector。

![nio-components](/java/nio-components.svg)

这三个组件的设计是一环扣一环的：Channel 是双向数据通道，Buffer 是 Channel 读写的容器，Selector 在一个线程里同时监听多个 Channel 的事件。下面从你线上遇到的问题挨个往回拆。

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

```java
// 第一步：创建 Selector
Selector selector = Selector.open();

// 第二步：将 Channel 注册到 Selector，指定关注的事件
ServerSocketChannel ssc = ServerSocketChannel.open();
ssc.configureBlocking(false);
ssc.register(selector, SelectionKey.OP_ACCEPT);

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
                client.write(buffer);  // Echo 回写
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
FileChannel fileChannel = FileChannel.open(Paths.of("data.txt"), StandardOpenOption.READ);

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
| `FileChannel` | 文件读写（仅阻塞模式） | `FileInputStream/OutputStream` |

### 3.3 非阻塞：让 Selector 能用上 Channel

Channel 默认是阻塞的，必须手动切：

```java
ServerSocketChannel ssc = ServerSocketChannel.open();
ssc.configureBlocking(false);    // 非阻塞模式

SocketChannel sc = ssc.accept(); // 无连接时返回 null，不阻塞
```

只有非阻塞的 Channel 才能注册到 Selector。这就是 Selector 和 Channel 的耦合点——它们两个谁离了谁都成不了「一个线程管 N 个连接」。

## 4. Buffer：你线上见过的 DirectByteBuffer OOM

### 4.1 为什么 Channel 不能直接读写字节

在 BIO 中，`read(byte[] buf)` 直接把数据读到字节数组里。NIO 的 Channel 不能直接读写字节——**所有数据必须经过 Buffer**。

```txt
BIO:   Stream  ──read──►  byte[]
NIO:   Channel ──read──►  Buffer ──get()──►  byte[]
```

为什么？因为 Channel 是非阻塞的——一次 `read()` 可能只读到半个消息。Channel 需要一个「暂存区」来缓存读到的东西，还要支持「我还有数据没读完，下次接着读」的语义。byte[] 做不到，Buffer 可以。

### 4.2 你线上的 DirectByteBuffer OOM

你见过这个报错吗？

```txt
java.lang.OutOfMemoryError: Direct buffer memory
```

这大概率是用 Netty 的服务没正确释放 `ByteBuf`——Netty 的 `ByteBuf` 底层是 NIO 的 `DirectByteBuffer`，分配在堆外，不受 JVM 堆 GC 管理。堆上还有 2GB 空闲，堆外却被你的 Channel 读写吃掉了几百 MB，JVM 也发现不了。

理解这个 Bug，必须理解 Buffer 的内部机制。

### 4.3 Buffer 的三个内部指针

每个 Buffer 维护三个属性：

![buffer-ops](/java/buffer-ops.svg)

| 属性 | 含义 | 取值范围 |
| :--- | :--- | :--- |
| **capacity** | Buffer 的总容量，创建后不可变 | 固定 |
| **limit** | 第一个不可读/写的索引 | 0 ≤ limit ≤ capacity |
| **position** | 下一个要读/写的位置 | 0 ≤ position ≤ limit |

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

`flip()` 只做了两件事：`limit = position; position = 0`。但这意味着你**写完了数据之后不调 flip() 就读，读出来的永远是 position 后面的空字节**。写 100 字节进 Buffer，不 flip 直接 `get()`——你读到的是 Buffer 里 capacity - 100 的空白区域。

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

长期存活的 Buffer（连接池中的读写缓冲区）用 `allocateDirect()`；短期临时 Buffer 用 `allocate()`。用错了不会报错——只是 GC 曲线更陡，或者堆外内存悄悄涨到你怀疑人生。

## 5. 零拷贝：NIO 的性能杀手锏

传统 I/O 把一份数据从文件发到网络，要拷贝 4 次：

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

// 零拷贝：数据不经过用户空间
fileChannel.transferTo(0, fileChannel.size(), socketChannel);
// 底层调用 sendfile() → 磁盘 → 内核缓冲区 → 网卡（2 次拷贝）
```

| 场景 | 是否适合 | 原因 |
| :--- | :--- | :--- |
| 文件服务器（Nginx、静态资源） | ✅ 非常适合 | 大文件传输，数据不需要修改 |
| 消息队列（Kafka） | ✅ 非常适合 | 消息从磁盘直接发到网络 |
| 数据压缩/加密 | ❌ 不适合 | 数据需要在用户空间处理 |
| 小文件传输 | ⚠️ 收益有限 | 系统调用开销可能抵消零拷贝收益 |

`ByteBuffer.allocateDirect()` 也和零拷贝有关——堆内存 Buffer 在 I/O 时需要额外拷一次到直接内存（操作系统不能直接访问 Java 堆），`allocateDirect()` 跳过了这一步：

```txt
allocate()：       堆内存 → 临时直接内存 → 内核缓冲区 → 网卡
allocateDirect()： 直接内存 → 内核缓冲区 → 网卡
```

## 6. NIO Reactor 模式：Tomcat 的 Boss-Worker 就长这样

### 6.1 单线程 NIO Echo

把 Channel + Buffer + Selector 组合在一起的最简示例——你可以对照着看它和后面 Tomcat 的 Acceptor/Poller/Worker 是怎么对应的：

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

### 6.2 单线程 Reactor 的瓶颈

上面这个 Echo 能跑，但有一个隐蔽问题：如果 `handleRead()` 里的业务逻辑跑了 500ms（比如查了个慢 SQL），Selector 线程会被卡住 500ms。这 500ms 内所有其他连接的 I/O 事件——新连接到达、已有连接发数据——全部得不到处理。**I/O 处理不能阻塞 Selector 线程。**

### 6.3 主从多 Reactor：Tomcat 的三线程模型

这正是 Tomcat NioEndpoint 的三线程设计要解决的问题：

![reactor-master-slave](/java/reactor-master-slave.svg)

| 角色 | 对应 Tomcat | 职责 | 线程数 |
| :--- | :--- | :--- | :--- |
| Boss Reactor | **Acceptor** | accept() 新连接，注册到 Poller | 1 |
| Worker Reactor | **Poller** | Selector.select() 等待 I/O 事件 | CPU 核心数 × 2 |
| Worker Pool | **Exec** | 实际处理请求（读数据、调 Servlet、写响应） | 可配置（maxThreads） |

这就是开头故障里你看到的三类线程：一个 Acceptor 接新连接，几个 Poller 用 epoll 等数据，200 个 Exec 线程做实际工作。

## 7. 不直接用 NIO 的原因

原生 NIO 能工作，但写生产代码需要一个人搞定下面这张清单：

```txt
├── Buffer 的 flip / clear / compact 切换（☠️ 翻车之王）
├── 半包 / 粘包问题（TCP 是字节流，没有消息边界）
├── SelectionKey 的 attach / detach 生命周期
├── Channel 的非阻塞写（一次 write 可能没写完，要注册 OP_WRITE 接着写）
├── 空闲连接检测与超时关闭
├── 线程安全（多线程操作同一个 Channel）
└── 异常处理（连接重置、管道破裂）
```

一个简单的 NIO 服务器轻松超过 500 行，等价 BIO 版本只要 50 行。

### 7.1 epoll 空轮询 Bug（JDK-6670302）

`Selector.select()` 在 Linux 上偶发**立即返回 0**（应该阻塞），导致 CPU 空转到 100%：

```java
// 正常：select() 阻塞直到有事件
int ready = selector.select(timeout);

// Bug：select() 立即返回 0，循环空转 → CPU 100%
while (true) {
    int ready = selector.select(timeout);  // 应该阻塞，但立刻返回 0！
}
```

Netty 的解决办法：检测到连续 512 次空返回后重建 Selector。

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
