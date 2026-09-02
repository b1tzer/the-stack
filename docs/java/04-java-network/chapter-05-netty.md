# Netty：Java 高性能网络框架

> 面试官问 Netty 的线程模型——你说得出 Boss/Worker，但说不清为什么一个 EventLoop 绑一个 Channel 就不用加锁、dispatcher 决定「在哪跑」和 threadpool 决定「用多大池子接」之间的区别、以及 `§5.3` 那个 `Direct buffer memory` OOM 为什么堆还有空间照样炸。本章拆穿"Netty 就是 NIO 封装"这种半对半错的理解——EventLoop 不是线程池、ByteBuf 不是 Buffer、Pipeline 不是责任链那么简单。

> **📖 阅读建议**：§5.1 是为什么要有 Netty（对比[第4章](./chapter-04-nio) NIO），§5.2 是核心线程模型（你线上排障最需要的部分），§5.3 ByteBuf（`Direct buffer memory` OOM 根因），§5.4 编解码（粘包/拆包解决方案），§5.5 Reactor 模式全景。删除API罗列式讲解，保留原理和排查路径。

## 1. 从 NIO 到 Netty：为什么原生 NIO 没人直接用了

[第4章](./chapter-04-nio)讲了 NIO 的 Channel、Buffer、Selector。你能用 500 行写一个 NIO Echo Server，但[第4章](./chapter-04-nio)也在末尾告诉你：生产代码没人这么写。具体原因一个一个看。

### 1.1 NIO 的三个致命缺陷

| 缺陷 | 后果 |
|------|------|
| **Buffer 的 flip/clear/compact** | 读写模式手动切，忘记一次 flip → 读到错误数据，且不报错 |
| **epoll 空轮询 Bug（JDK-6670302）** | `selector.select()` 偶发立即返回 0 → CPU 空转 100% |
| **缺少编解码、线程模型、连接管理** | 粘包要自己写、半包要自己攒、线程调度要自己管 |

Netty 把这三个坑全部填平了。

### 1.2 Netty 填了什么

```text
┌─────────────────────────────────────┐
│         业务代码 (你的 Dubbo Consumer)│
├─────────────────────────────────────┤
│         Netty 框架层                 │
│  ┌──────────┬──────────┬─────────┐  │
│  │ Pipeline │ ByteBuf  │ Codec   │  │
│  │ EventLoop│ Bootstrap│ Future  │  │
│  └──────────┴──────────┴─────────┘  │
├─────────────────────────────────────┤
│         Java NIO (Channel/Selector) │
├─────────────────────────────────────┤
│         操作系统 (epoll/kqueue)      │
└─────────────────────────────────────┘
```

| NIO 坑 | Netty 对策 |
|---------|-----------|
| Buffer flip 繁琐 | ByteBuf 读写指针分离，自动扩容，不需要 flip |
| epoll 空轮询 Bug | 连续 512 次空返回 → 重建 Selector |
| 缺少协议支持 | 内置 HTTP/WebSocket/SSL 编解码器 |
| 粘包/拆包 | 内置 LengthField / Delimiter / FixedLength 帧解码器 |
| 线程模型缺失 | EventLoopGroup + Pipeline，一行代码绑到线程池 |

Netty 在 Java 生态中是事实标准：Dubbo 的传输层、gRPC 的 Netty Transport、Elasticsearch 节点间通信、RocketMQ 的网络层，全都跑在 Netty 上。

## 2. EventLoop 线程模型：Dubbo「线程池打满」的根

回到开头那个故障。Dubbo Provider 200 个线程全部耗尽，但你的服务一共才 4 个 CPU 核。为什么会有 200 个线程同时在跑？因为 Dubbo 默认用 Netty 的 **EventLoop + 业务线程池** 两层模型——失败不在 Netty 的 IO 层，而在业务线程池层。

### 2.1 Boss 和 Worker：连接和数据分开管

Netty 服务端有两个线程组：

```text
bossGroup (1 个线程)                workerGroup (CPU×2 个线程)
┌────────────────┐                 ┌────────────────────┐
│  NioEventLoop   │                 │  NioEventLoop-1    │
│  Selector       │  ── accept ──→  │  Channel A, B, C   │
│  只做 accept()  │  分配 Channel   │  read/write/decode │
└────────────────┘                 ├────────────────────┤
                                   │  NioEventLoop-2    │
                                   │  Channel D, E      │
                                   │  read/write/decode │
                                   └────────────────────┘
```

**bossGroup 只管 accept**：一条线程收到新连接后，按 Round-Robin 分给 workerGroup 的某个 EventLoop。**workerGroup 负责读数据**：从 Channel 读字节 → 解码 → 触发 Handler。

**关键规则**：一个 Channel 的所有 I/O 事件永远由同一个 EventLoop 线程处理。这意味着你在 I/O Handler 里不需要加锁——天然的线程安全。但也意味着你不能阻塞 EventLoop 线程——一个 Handler 里加了 `sleep`，这个 EventLoop 上所有 Channel 全部罢工。

### 2.2 Dubbo 的 dispatcher 和 threadpool：IO 线程和业务线程的分工

Dubbo 在 Netty workerGroup 之上又加了一层业务线程池。控制「谁出谁进」的是 `dispatcher`：

| dispatcher | 行为 | 代价 |
|---|---|---|
| `all`（默认） | 所有消息都丢给业务线程池 | 多一次线程切换 |
| `direct` | 所有消息都留在 I/O 线程上处理 | Handler 里不能有任何阻塞 |
| `message` | 只有请求进业务线程池，响应留在 I/O 线程 | 折中 |
| `execution` | 只有请求进业务线程池，响应也留在 I/O 线程 | 和 message 类似 |

**dispatcher 和 threadpool 解决的不是一个问题**：
- **dispatcher** 决定「这个 Handler 在哪个线程上跑」——I/O 线程还是业务线程。
- **threadpool** 决定「进了业务线程池后，用多大的池子来接」。

很多线上调参无效就是因为搞混了这两层。你调大 `threads=500`，但如果 dispatcher 选的 `direct`，消息根本没进业务线程池——加再多 threads 也没用。

回到开头那个故障：dispatcher 用的是 `all`，threadpool 用的是 `fixed:200`。一个测试残留的 `sleep(6000)` 把 200 个业务线程全部占满。后续新请求进入业务线程池时被 `AbortPolicyWithReport` 拒绝，Dubbo 会返回 `SERVER_THREADPOOL_EXHAUSTED_ERROR` 给 Consumer。Consumer 如果设了 `retries>0`，重试又会涌进来更多请求→雪崩。

### 2.3 EventLoop 任务队列：别阻塞 I/O 线程

Netty 的 EventLoop 不仅处理 I/O 事件，还执行用户提交的任务：

```java
// ✅ 耗时操作交给独立业务线程池
EventLoopGroup businessGroup = new DefaultEventLoopGroup(8);
ch.pipeline()
 .addLast(workerGroup, "codec", new HttpCodecHandler())   // I/O 线程
 .addLast(businessGroup, "biz", new BusinessHandler());   // 业务线程池

// ❌ 耗时操作直接霸占 I/O 线程
ch.pipeline().addLast(new BusinessHandler());  // 跑在 workerGroup 上
```

## 3. ByteBuf：你线上见过但没看懂的 `Direct buffer memory` OOM

Netty 的 ByteBuf 用一个独立指针 `readerIndex` 和一个独立指针 `writerIndex` 替代了 NIO Buffer 的单一 position。不需要 flip，不需要 compact——读就自动移动 `readerIndex`，写就自动移动 `writerIndex`：

```text
+-------------------+------------------+------------------+
| 已读/可丢弃       |  可读数据         |  可写空间         |
+-------------------+------------------+------------------+
0              readerIndex        writerIndex        capacity
```

ByteBuf 默认使用池化的堆外内存（PooledDirectByteBuf）。堆外内存不受 JVM GC 管理，这意味着：你线上堆还有 2GB 空闲，但 Netty 的 PooledDirectByteBuf 已经把堆外内存吃了几百 MB，JVM 发现不了。

```text
java.lang.OutOfMemoryError: Direct buffer memory
```

这就是那道令无数开发者困惑的 OOM。堆里明明闲着，为什么会 OOM？因为 `-XX:MaxDirectMemorySize` 默认等于 `-Xmx`，而 Netty 的 ByteBuf 全部走堆外。

排查命令：

```bash
# 看堆外内存使用（需要 JDK 9+）
jcmd <pid> VM.native_memory summary | grep -A 5 "Direct"

# 开 Netty 内存泄漏检测
-Dio.netty.leakDetection.level=PARANOID
```

引用计数是 ByteBuf 的另一道防线。每个 ByteBuf 创建后 `refCnt=1`，每 `retain()` 一次 +1，每 `release()` 一次 -1，归零后释放内存。Netty 的 `SimpleChannelInboundHandler` 会自动 `release()`，但自定义 Handler 里如果手动 `retain()` 了却忘记 `release()` → 永久泄漏。

## 4. 编解码：TCP 粘包/拆包的工业化解决方案

TCP 没有消息边界。你发了两条消息，对方可能收到一条「粘在一起」的数据。Netty 内置了三种帧解码器：

| 解码器 | 原理 | 适用协议 |
|--------|------|---------|
| `FixedLengthFrameDecoder` | 每条消息固定 N 字节 | 简单私有协议 |
| `DelimiterBasedFrameDecoder` | 用特殊字符分隔（如 `\r\n`） | 文本协议（Redis） |
| `LengthFieldBasedFrameDecoder` | 消息头 N 字节 = 消息体长度 | 大多数二进制协议（Dubbo） |

`LengthFieldBasedFrameDecoder` 是最常用的，Dubbo 协议帧本身就是这个模式：

```java
// maxFrameLength=65535, offset=0, length=4B, strip=4B
pipeline.addLast(new LengthFieldBasedFrameDecoder(65535, 0, 4, 0, 4));
```

帧解码之后的数据才能交给业务 Handler。如果在帧解码之前解码了 —— 你拿到了半条消息或者两条消息粘在一起的数据，然后你的业务代码按「完整消息」来解析，不是报错就是静默丢数据。

## 5. Reactor 模式全景：从单线程到主从

把 EventLoop、Pipeline、编解码器串起来，一次请求的完整旅程：

```text
bossGroup (accept) → workerGroup (read/decode) → [可选: businessGroup (业务)]
                                                       ↓
                                                    Pipeline:
                                          Head → FrameDecoder → Codec → BizHandler → Tail
```

Netty 的主从 Reactor 模型和 Tomcat 的 Acceptor/Poller/Worker 三线程模型是同一种思想的不同实现。区别在于 Tomcat 是为 HTTP 优化的 Servlet 容器，Netty 是通用网络框架——你可以用它写 HTTP 服务器，也可以写 RPC 框架、消息队列、IM 服务。
