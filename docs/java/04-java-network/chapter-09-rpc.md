# RPC 与微服务通信

> 你的 Dubbo 接口报了 `TimeoutException`。监控显示 P99 延迟从 20ms 飙到了 3500ms。你打开链路追踪，只看到一个巨大的耗时条挂在「Dubbo Invoke」上——但它背后到底卡在序列化、网络传输、服务端处理、还是 GC 停顿？这一章从你每次 RPC 超时都要拆的这个黑盒开始，一层层拆回去。

> **📖 阅读建议**：如果你正盯着 Dubbo 超时告警排障，直接从 §3 开始。只想理解 RPC 基本原理的，§1-§2 已足够。§4 序列化、§5 服务发现和负载均衡在选型和调优时回头查。

## 1. 一次 Dubbo 调用超时，到底卡在哪一层

你在代码里写了 `@DubboReference(timeout=1000) private UserService userService`。某个深夜，告警响了——这个接口大量超时。你在 ELK 里看日志，所有报错都是同一句话：`TimeoutException: Waiting server-side response timeout`。

但这句话什么也没告诉你。你需要确定这段调用时间主要消耗在哪些阶段：客户端处理、网络等待、服务端排队，还是业务执行。

### 1.1 Dubbo Profiler 拆解——6 个环节的耗时

Dubbo 3.x 内置了请求耗时采样（simple profiler 和 detail profiler）。一次超时请求会被打上完整的时间轴：

```txt
Consumer 侧：
Start time: 285965458479241
+-[ Offset: 0.000ms; Usage: 990.828ms, 100% ] Client invoke begin.
  +-[ Offset: 0.852ms; Usage: 989.899ms, 99% ] Filter链
    +-[ Offset: 8.125ms; Usage: 981.748ms, 99% ] Cluster/Failover
       +-[ Offset: 8.258ms; Usage: 981.612ms, 99% ] Invoker → 目标: 10.0.1.10:20880

Provider 侧：
Start time: 285965612316294
+-[ Offset: 0.000ms; Usage: 811.017ms, 100% ] Server invoke begin.
  +-[ Offset: 1.030ms; Usage: 804.236ms, 99% ] Filter链
    +-[ Offset: 1.558ms; Usage: 804.276ms, 99% ] Biz impl begin.
```

**如何解读这组数据**：

| 阶段 | 耗时 | 含义 |
| :-- | :-- | :-- |
| Consumer Filter + Cluster | ~8ms | Dubbo 框架开销，通常可忽略 |
| Provider Filter | ~1.5ms | Dubbo 框架开销 |
| **Provider 侧采样到的调用链路耗时** | **~811ms** | 包含业务执行与框架阶段，需结合节点语义解释 |

表中 ~811ms 是 Provider 侧从 `Server invoke begin` 到调用结束的整条采样链路耗时，而 804.276ms 是其中 `Biz impl begin`（业务实现）子节点的耗时；二者计时范围不同，差值约 6.7ms 来自 Filter 链等框架阶段，与网络传输无关。

Consumer 侧调用耗时约 991ms，Provider 侧采样到的调用耗时约 811ms，两者相差约 180ms。这个差值不能直接视为网络传输耗时：Consumer 和 Provider 的采样边界可能不同，Consumer 侧还可能包含请求编码、连接获取、响应解码和重试等开销。目前能确认的是 Provider 侧记录的业务与框架链路耗时较长，要进一步区分业务处理、框架开销和网络等待，需要结合 Profiler 的阶段明细、两端日志中的请求标识，以及必要时的网络抓包继续定位。

如果 Consumer 侧显示约 990ms、Provider 侧却只有约 50ms，说明大部分时间消耗在未被 Provider 采样覆盖的阶段，可能是网络等待，也可能是 Consumer 侧排队、连接获取或序列化。要判断网络是否异常，应先建立该调用路径的正常延迟基线，再对比故障时的 RTT、连接状态和 RPC 阶段耗时；如果 RTT 明显偏离基线，再检查跨机房路径、丢包、重传和网络设备负载。不要仅凭一次 RTT 超过某个固定值就判定网络故障。

### 1.2 请求到达后迟迟没有执行：检查 GC 与线程调度

上面那个案例是「服务端确实慢」。但还有一种超时，日志里**什么线索都没有**：

```txt
Provider 日志：
12:00:00.100 收到请求 → 12:00:03.200 开始执行业务逻辑
↑ 中间 3 秒没有任何日志
```

请求进了 Provider，但 3 秒后才开始处理，所有监控指标（CPU、内存、磁盘）都是正常的。GC STW（Stop-The-World）是这类现象的可能原因之一，但不是唯一原因：请求可能还在执行器队列中等待工作线程、工作线程池已满、I/O 线程或业务线程发生阻塞、锁竞争或 CPU 饥饿，都可能让任务迟迟没有运行。日志记录的位置也不一定准确代表业务方法的开始时间。

一个真实案例（Dubbo Issue #15043）：Dubbo Provider 用 JDK 11 + G1，偶尔大面积超时，日志显示「请求已进入 provider 但 3 秒后才执行下一步」。最终确认是 G1 的 mixed GC 耗时过长——不是 Full GC，是 mixed GC 的 ref-proc 阶段单线程处理 PhantomReference 卡了 4 秒。

排查这类问题的方法：

```bash
# JDK 8：旧式 GC 日志参数
-XX:+PrintGCDetails -XX:+PrintGCDateStamps -Xloggc:gc.log

# JDK 9+：统一日志（推荐）
-Xlog:gc*:file=gc.log:time,uptime,level,tags

# 对比 RPC 超时时间点和 GC 日志中的停顿时间
grep "2026-08-09 12:00" gc.log | grep "pause"
```

如果长 GC Pause 与延迟区间吻合，再结合 GC 日志中的阶段耗时判断是否由 GC 导致。`-XX:+ParallelRefProcEnabled` 可以改变引用处理的并行行为，但不能保证所有引用处理阶段都会缩短，也不能替代对实际 GC 日志的分析。只有证据能够对应上，才能把根因归结为 GC，否则应继续排查线程调度与执行器排队。

## 2. RPC 到底做了什么：一次远程调用的完整旅程

前面分析了调用耗时如何分布，本节说明一次 RPC 请求从 Consumer 发出、到 Provider 执行业务并返回结果经过哪些环节。

### 2.1 一句话总览

```txt
Consumer 端                                       Provider 端
userService.findById(1)
  │
  ├─ ① Proxy 拦截 → 提取方法名+参数
  ├─ ② 序列化 (Java对象 → bytes)
  ├─ ③ 封装协议帧 (魔数+长度+bytes)
  ├─ ④ Socket 发出去
  │
  │              ════════ 网络 ════════
  │
  ├─ ⑤ Provider 反序列化 (bytes → Java对象)           │
  ├─ ⑥ 反射调用真实方法 → 拿到返回值                    │
  ├─ ⑦ 序列化返回值 → 写回                             │
  │                                                  │
  ◀─────────────── 返回值 bytes ───────────────────────
```

与本地方法调用相比，RPC 不仅需要跨进程传输，还要处理编码解码、远程执行失败、超时与响应关联。因此，远程调用不能简单地按本地方法调用的失败语义来理解。上面的图是概念性流程，未展开 Provider 收到请求后的协议解码、请求分发以及返回结果的编码与传输。

### 2.2 各环节在你线上能表现出什么问题

| 环节 | 常见影响因素 | 线上出问题的表现 |
| :-- | :-- | :-- |
| ① Proxy | 框架代理开销 | `@DubboReference` 配置错误 → Bean 创建失败 |
| ② 序列化 | 对象大小、序列化实现 | 参数对象巨大（几 MB）→ 序列化吞吐不足 → CPU 飙升 |
| ③ 协议封装 | 协议版本 | 协议版本不匹配 → `DecodeException` |
| ④ 网络传输 | RTT、连接复用、跨机房 | RTT 突然飙升 → 跨机房 / 交换机问题 / accept 队列满 |
| ⑤ 反序列化 | 对象大小、序列化实现 | 同② |
| ⑥ 反射调用 | 业务逻辑 | 业务代码慢（慢 SQL / 外部依赖） |
| ⑦ 写回 | 客户端超时状态 | 客户端已超时断开 → 写入 `Broken pipe` |

表中的耗时没有固定基准，各环节开销取决于对象大小、硬件、并发度和连接状态，不应被当成标准预算。

### 2.3 HTTP API 与 RPC 怎么选

| 维度 | HTTP REST | RPC (Dubbo/gRPC) |
| :-- | :-- | :-- |
| 语义 | 面向资源 | 面向方法 |
| 编码 | 常用 JSON，体积与解析开销取决于消息 | 常用二进制，体积与解析开销取决于方案 |
| 服务治理 | 需自建或借助网关 | 框架内置（路由/限流/熔断/降级） |
| 跨语言 | 通用 | Protobuf 方案跨语言，Hessian 仅 Java |
| 适用 | 对外 API、浏览器可调 | 内部服务间高频调用 |

不要仅凭"对外"或"对内"决定通信方式，更有效的判断依据是调用双方、接口契约、工具链和运行要求。如果接口主要面向浏览器、第三方开发者或异构系统，HTTP API 通常更容易接入；如果服务之间需要强类型接口、代码生成、统一的超时与治理能力，可以考虑 gRPC 或 Dubbo 等 RPC 框架。这不是绝对分界：HTTP API 也可以用于内部服务，RPC 也可以通过网关向外提供。HTTP 与 RPC 也不是互斥关系，gRPC 本身可以运行在 HTTP/2 之上。性能差异应在相同业务负载、连接条件和数据规模下实测，而不是仅凭"JSON"或"二进制"判断。

## 3. RPC 超时排查流程

装了 Dubbo Profiler 时，它能告诉你耗时在哪个阶段。没装 Profiler 之前（或你用的不是 Dubbo），按下面三步验证：

### 3.1 检查两端日志与请求关联

```bash
# Consumer 侧 filter 日志（Dubbo 默认打印的 ElapsedFilter）
grep "cost .* ms, this invocation almost (maybe already) timeout" consumer.log

# Provider 侧 filter 日志
grep "cost .* ms, this invocation almost (maybe already) timeout" provider.log
```

不要直接把两侧耗时差当成结论，按排查顺序验证：

- Consumer 有耗时、Provider 没有对应记录：先确认请求是否到达 Provider，再检查客户端排队、连接、网络和日志覆盖。
- Provider 有对应请求，但业务开始很晚：检查执行器排队、线程池、GC 和线程状态。
- Provider 业务执行时间确实很长：进一步检查数据库、外部依赖、锁竞争和 CPU 消耗。
- 两端都没有足够证据：检查请求关联 ID、Profiler 是否启用、日志采样条件和超时配置。

超时时间应与接口的延迟分布和业务 SLA 对齐，而不是一律以默认 1 秒为准；Consumer 和 Provider 的计时边界也不一定一致，Dubbo Profiler 本身有采样阈值和不同采样模式，不能假设所有请求都有完整的阶段明细。

### 3.2 检查 GC 与线程调度

```bash
# JDK 8：旧式 GC 日志；JDK 9+ 改用 -Xlog:gc*:file=gc.log:time,uptime,level,tags
grep "Total time for which application threads were stopped" gc.log | awk '{if ($NF > 0.5) print}'
```

筛选出长 GC Pause 只说明发生了长停顿，要认定它是 RPC 超时的根因，还要确认暂停区间与受影响请求的延迟区间吻合，并排除线程池排队等其他因素。

### 3.3 使用 TCP 抓包验证网络假设

```bash
# Provider 侧抓 Dubbo 端口
tcpdump -i eth0 port 20880 -w rpc_capture.pcap

# 在 Wireshark 中过滤超时连接
# 关注 TCP Out_of_Order、TCP Retransmission、TCP Dup ACK
```

如果抓包显示同一 TCP 连接存在明显重传，应进一步对比通信两端的抓包结果、TCP 统计和接口丢包计数，再检查链路拥塞、网卡队列和宿主机资源。单端抓包中的重传现象只能提供线索，不能直接定位到交换机或网卡。

> **超时不等于没执行**：RPC 超时只表示调用方在规定时间内没有收到可接受的响应，不代表服务端没有执行请求。服务端可能尚未收到请求、正在处理，也可能已经完成业务但响应尚未到达。因此，重试不能仅靠延长超时时间解决；对于有副作用的操作，需要结合业务幂等键、去重记录或其他一致性机制设计重试行为，否则可能产生重复执行（例如重复扣款）。

## 4. 序列化：你的对象为什么传得比想象的慢

RPC 框架不管内部逻辑多复杂，最终要做的就是从 bytes 到对象、再从对象到 bytes。不同序列化方案的编码体积和处理开销可能存在明显差异，但具体结果取决于消息结构、实现版本和测试负载，选型时应同时测量序列化、反序列化和网络传输成本。

### 4.1 选型维度

| 方案 | 跨语言 | 选型时需要考虑的因素 |
| :-- | :--: | :-- |
| Protobuf | ✅ | 跨语言、代码生成、字段兼容与演进 |
| Kryo | ❌ Java-only | Java 对象序列化、类型注册与版本兼容 |
| Hessian | ✅ | 现有 Dubbo 配置、数据类型支持与兼容性 |
| JSON | ✅ | 可读性、调试便利性、数据体积和解析开销 |

这些维度服务于选型，不构成固定的性能排名。具体开销取决于消息结构、对象大小、序列化与反序列化是否分开计时、并发度和实现版本，应在目标负载下实测。

### 4.2 典型问题：Protobuf 默认值与字段存在性

```protobuf
syntax = "proto3";

message User {
    int64 id = 1;
    string name = 2;
    int32 age = 3;
}
```

在 proto3 中，普通标量字段使用隐式字段存在性语义。如果发送方没有设置 `age`，序列化结果通常不包含该字段，接收方通过生成的 Java getter 读取时会得到默认值 `0`，而不是 `null`。标准 Protobuf Java 代码生成器为 `int32` 生成的 getter 返回基本类型 `int`。

这里容易忽略的区别是：`age` 未设置与 `age` 显式设置为 `0`，通过普通 getter 无法区分。如果业务需要区分「没有提供年龄」和「年龄为 0」，应把字段声明为 `optional`：

```protobuf
syntax = "proto3";

message User {
    int64 id = 1;
    string name = 2;
    optional int32 age = 3;
}
```

生成的 Java API 可以通过 `hasAge()` 判断字段是否存在，再通过 `getAge()` 读取数值。字段存在性语义与 Java 的基本类型、包装类型不是同一回事，不要把 Protobuf 未发送默认值直接解释为 Java getter 返回 `null`。

## 5. 服务发现：先解决「调哪个」

前面的内容围绕「怎么调」。在有多副本的环境里，还要先解决「调哪个」实例。

### 5.1 注册中心的本质

```txt
Provider 集群                       注册中心                      Consumer
┌─────────┐                    ┌─────────────┐              ┌─────────┐
│ 实例1    │──注册──▶           │ user-service │  ◀──订阅──   │ @Ref    │
│ 10.0.1.1│                    │ → 10.0.1.1  │              │         │
│ 实例2    │──注册──▶           │ → 10.0.1.2  │              │         │
│ 10.0.1.2│                    │ → 10.0.1.3  │              └─────────┘
│ 实例3    │──注册──▶           └─────────────┘
│ 10.0.1.3│
└─────────┘
```

Consumer 启动 → 拉取 `user-service` 的所有实例 → 本地缓存 → 按负载均衡策略选一个 → 发起调用。实例上线/下线 → 注册中心推送变更 → Consumer 更新缓存。

注册中心不可用时，如果客户端保留了已发现的实例列表，并且框架允许暂时继续使用这份列表，已有调用可能在一定时间内继续工作，但注册信息无法及时更新，实例上下线也无法及时反映。具体行为应以所用框架和注册中心的配置为准，不能一概而论，也不能把"注册中心不可用"等同于"所有现有调用立即失败"或"所有客户端都能继续调用"。

### 5.2 负载均衡策略

| 策略 | 算法 | 适用前提与限制 |
| :-- | :-- | :-- |
| Random | 随机 | 通用，实例性能相近 |
| RoundRobin | 轮询 | 实例性能相同 |
| LeastActive | 选当前活跃调用较少的实例 | 活跃请求数不等于 CPU、队列长度或剩余容量 |
| ConsistentHash | 相同参数映射到同一实例 | 节点上下线时映射可能变化，不能替代状态管理 |

## 6. 下一步

RPC 在 TCP 和序列化之上组织远程调用。理解一次请求如何进入应用代码，可继续阅读 [Servlet 与 Tomcat 请求链](./chapter-08-servlet-tomcat-request-chain.md)；连接、DNS、TLS 或超时异常从[网络性能分析与故障排查](../06-diagnostics/03-network/chapter-01-network-diagnostics.md)进入。
