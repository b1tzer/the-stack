# Netty：Java 高性能网络框架

> Netty 不只是 NIO API 的封装。本章解释 EventLoop 如何绑定 Channel、异步任务如何分配执行线程、Pipeline 的职责边界，以及堆外内存不足为何可能在堆仍可用时失败。阅读时需要区分 NIO 核心类型与 Netty 自己的抽象。

> **📖 阅读建议**：§1 是为什么要有 Netty（对比[第 5 章](./chapter-05-nio) NIO），§2 是核心线程模型（你线上排障最需要的部分），§3 讲 ByteBuf（`Direct buffer memory` OOM 根因），§4 讲编解码（粘包/拆包解决方案），§5 给出 Reactor 模式全景。

## 1. 从 NIO 到 Netty：为什么很多项目选择网络框架

[第 5 章](./chapter-05-nio)讲了 NIO 的 Channel、Buffer、Selector。用这些 API 可以实现 TCP 服务，但工程代码还需要处理部分读写、连接状态、协议拆帧、超时、资源释放和线程调度。Netty 把这些常见任务封装成统一的事件模型、Pipeline 和编解码组件。是否直接用 NIO，应由协议复杂度、维护成本和运行约束决定，而不是简单地按生产或非生产划分。

### 1.1 原生 NIO 需要自行处理的工程问题

| 问题 | 后果 |
| :-- | :-- |
| **Buffer 的 flip/clear/compact** | 读写模式手动切，忘记一次 flip → 读到错误数据，且不报错 |
| **Selector 空轮询（部分 JDK/平台组合）** | `selector.select()` 偶发立即返回 0 → CPU 空转 100% |
| **缺少编解码、线程模型、连接管理** | 粘包要自己写、半包要自己攒、线程调度要自己管 |

Netty 为这些问题提供了统一的处理机制，但并未消除所有工程成本：协议边界、Handler 阻塞、引用计数和过载控制仍需开发者负责。

### 1.2 Netty 填了什么

```txt
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
| :-- | :-- |
| Buffer flip 繁琐 | ByteBuf 读写指针分离，自动扩容，不需要 flip |
| Selector 空轮询 | 检测到持续异常空返回后重建 Selector（阈值随版本变化） |
| 缺少协议支持 | 内置 HTTP/WebSocket/SSL 编解码器 |
| 粘包/拆包 | 内置 LengthField / Delimiter / FixedLength 帧解码器 |
| 线程模型缺失 | EventLoopGroup + Pipeline，一行代码绑到线程池 |

Netty 被多个 Java 网络框架和中间件广泛采用：Dubbo 的传输层、gRPC 的 Netty Transport、Elasticsearch 节点间通信、RocketMQ 的网络层都使用 Netty。

## 2. EventLoop 线程模型：从 Dubbo 线程池耗尽看事件派发

回到开头那个故障。Dubbo Provider 200 个线程全部耗尽，但你的服务一共才 4 个 CPU 核。为什么会有 200 个线程同时在跑？因为 Dubbo 默认用 Netty 的 **EventLoop + 业务线程池** 两层模型——失败不在 Netty 的 IO 层，而在业务线程池层。

### 2.1 Boss 和 Worker：连接和数据分开管

Netty 服务端有两个线程组：

```txt
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

**关键规则**：在常规注册与事件派发模型下，一个 Channel 的所有 I/O 事件由同一个 EventLoop 线程处理。这让同一 Channel 的 I/O 回调通常串行执行，减少了同一 Channel 状态管理的并发访问。但这不是无条件线程安全：多个 Channel 共用同一个 Handler 实例、业务线程池并发访问共享状态时，仍需考虑并发。同样，阻塞 EventLoop 线程会延迟它负责的其他 Channel 的 I/O 事件和任务处理——一个 Handler 里加了 `sleep`，这个 EventLoop 上所有 Channel 都会受影响。

### 2.2 Dubbo 的 dispatcher 和 threadpool：IO 线程和业务线程的分工

Dubbo 在 Netty workerGroup 之上又加了一层业务线程池。控制「谁出谁进」的是 `dispatcher`：

| dispatcher | 行为（以 Dubbo 2.7 为准） | 代价 |
| :-- | :-- | :-- |
| `all`（默认） | 所有消息事件都派发到业务线程池 | 多一次线程切换 |
| `direct` | 消息直接在 I/O 线程处理，不经过业务线程池 | Handler 里不能有任何阻塞 |
| `message` | 请求、响应消息都进业务线程池；连接等其他事件留在 I/O 线程 | 折中 |
| `execution` | 只有请求消息进业务线程池；响应及其他事件由 I/O 线程处理 | 与 message 类似 |

**dispatcher 和 threadpool 解决的不是一个问题**：
- **dispatcher** 决定「这个 Handler 在哪个线程上跑」——I/O 线程还是业务线程。
- **threadpool** 决定「进了业务线程池后，用多大的池子来接」。

很多线上调参无效就是因为搞混了这两层。你调大 `threads=500`，但如果 dispatcher 选的 `direct`，消息根本没进业务线程池——加再多 threads 也没用。

回到开头那个故障：dispatcher 用的是 `all`，threadpool 用的是 `fixed:200`。一个测试残留的 `sleep(6000)` 把 200 个业务线程全部占满，后续新请求进入业务线程池时被 `AbortPolicyWithReport` 拒绝。在对应 Dubbo 版本和配置下，这个拒绝会通过框架的异常处理路径反馈给 Consumer（如 `SERVER_THREADPOOL_EXHAUSTED_ERROR`）。如果 Consumer 同时启用了 `retries>0`，重试会进一步增加 Provider 的负载；是否演变成雪崩，还取决于重试次数、超时设置和流量大小。

### 2.3 EventLoop 任务队列：别阻塞 I/O 线程

Netty 的 EventLoop 不仅处理 I/O 事件，还执行用户提交的任务：

```java
// ✅ 耗时操作交给独立业务线程池
EventLoopGroup businessGroup = new DefaultEventLoopGroup(8);
ch.pipeline()
 .addLast("codec", new HttpCodecHandler())                  // 不指定执行器组：通常在 Channel 所属 EventLoop 上执行
 .addLast(businessGroup, "biz", new BusinessHandler());     // 业务线程池

// ❌ 耗时操作直接霸占 I/O 线程
ch.pipeline().addLast(new BusinessHandler());  // 通常运行在该 Channel 所属的 EventLoop 上
```

## 3. ByteBuf 与直接内存 OOM

Netty 的 ByteBuf 用一个独立指针 `readerIndex` 和一个独立指针 `writerIndex` 替代了 NIO Buffer 的单一 position。不需要 flip，不需要 compact——读就自动移动 `readerIndex`，写就自动移动 `writerIndex`：

```txt
+-------------------+------------------+------------------+
| 已读/可丢弃       |  可读数据         |  可写空间         |
+-------------------+------------------+------------------+
0              readerIndex        writerIndex        capacity
```

Netty 的默认分配器通常会使用池化内存；具体是堆内还是堆外，取决于 Netty 版本、分配器配置和调用方选择。堆外 ByteBuf 不由 Java 堆 GC 直接管理，因此线上可能出现堆仍有空闲、但进程本地内存已经很高的情况。

```txt
java.lang.OutOfMemoryError: Direct buffer memory
```

这就是 `Direct buffer memory` OOM 的常见来源。堆里明明闲着，为什么还会 OOM？因为直接缓冲区限额独立于 Java 堆；未显式设置 `-XX:MaxDirectMemorySize` 时，其默认值通常与最大 Java 堆相同，但实际限额仍应以运行的 JDK 版本和启动参数为准。注意 `-XX:MaxDirectMemorySize` 约束的是直接缓冲区分配路径，不是整个进程本地内存的统一上限——线程栈、Metaspace、JNI 分配也会增加进程内存占用。排查时应把 ByteBuf 泄漏、直接内存限额耗尽和进程整体本地内存压力区分开。

排查命令：

```bash
# 查看本地内存分类（需要 JVM 启动时开启 NMT）
jcmd <pid> VM.native_memory summary
# 直接缓冲区通常归入本地内存分类，具体名称以当前 JDK 输出为准

# 开 Netty 内存泄漏检测
-Dio.netty.leakDetection.level=PARANOID
# PARANOID 会增加引用检查开销，建议用于问题复现或短时诊断，不宜长期默认开启
```

引用计数是 ByteBuf 的另一道防线。每个 ByteBuf 创建后通常 `refCnt=1`，每 `retain()` 一次 +1，每 `release()` 一次 -1，归零后释放内存。Netty 的 `SimpleChannelInboundHandler` 在默认 `autoRelease=true` 时会释放入站消息；自定义 Handler 如果手动 `retain()`，就必须在对应的生命周期内 `release()`，否则可能造成泄漏。

## 4. 帧解码：从 TCP 字节流到应用消息

TCP 没有消息边界。你发了两条消息，对方可能收到一条「粘在一起」的数据。Netty 内置了三种帧解码器：

| 解码器 | 原理 | 适用协议 |
| :-- | :-- | :-- |
| `FixedLengthFrameDecoder` | 每条消息固定 N 字节 | 简单私有协议 |
| `DelimiterBasedFrameDecoder` | 用特殊字符分隔（如 `\r\n`） | 文本协议（Redis） |
| `LengthFieldBasedFrameDecoder` | 消息头 N 字节 = 消息体长度 | 大多数二进制协议（Dubbo） |

`LengthFieldBasedFrameDecoder` 是最常用的，它假定消息头里有一个长度字段指明消息体长度。下面示例对应"长度字段 4 字节、位于帧头起始、只表示 body 长度、解码后剥离长度字段"这种协议格式：

```java
// maxFrameLength=65535, offset=0, length=4B, lengthAdjustment=0, strip=4B
pipeline.addLast(new LengthFieldBasedFrameDecoder(65535, 0, 4, 0, 4));
```

这组参数不能套用到所有协议：如果长度字段记录的是整个帧长度、或帧头还有其他字段，`lengthAdjustment` 和 `initialBytesToStrip` 都要相应调整。Dubbo 协议也有自己的固定头部和长度字段布局，具体配置应针对相应协议版本核对，不能直接把通用示例当成 Dubbo 协议实现。

帧解码之后的数据才能交给业务 Handler。如果在帧解码之前解码了 —— 你拿到了半条消息或者两条消息粘在一起的数据，然后你的业务代码按「完整消息」来解析，不是报错就是静默丢数据。

## 5. Reactor 模式全景：从单线程到主从

把 EventLoop、Pipeline、编解码器串起来，一次请求的完整旅程：

```txt
bossGroup (accept) → workerGroup (read/decode) → [可选: businessGroup (业务)]
                                                       ↓
                                                    Pipeline:
                                          Head → FrameDecoder → Codec → BizHandler → Tail
```

Netty 与 Tomcat 都把连接接入、I/O 事件处理和应用逻辑执行划分成不同职责，是同一思想的两种实现。区别在于 Tomcat 是为 HTTP 优化的 Servlet 容器，围绕连接器、Poller 和请求处理线程组织；Netty 是通用网络框架，通过 EventLoop、ChannelPipeline 和可选的业务执行器组织事件处理。两者的具体线程模型应以版本和配置为准，不宜简化成固定的"三线程模型"。
