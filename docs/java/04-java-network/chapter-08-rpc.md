# RPC 与微服务通信

> 你的 Dubbo 接口报了 `TimeoutException`。监控显示 P99 延迟从 20ms 飙到了 3500ms。你打开链路追踪，只看到一个巨大的耗时条挂在「Dubbo Invoke」上——但它背后到底卡在序列化、网络传输、服务端处理、还是 GC 停顿？这一章从你每次 RPC 超时都要拆的这个黑盒开始，一层层拆回去。

> **📖 阅读建议**：如果你正盯着 Dubbo 超时告警排障，直接从 §8.3 开始。只想理解 RPC 基本原理的，§8.1-§8.2 已足够。§8.4 序列化、§8.5 服务发现和负载均衡在选型和调优时回头查。

## 1. 一次 Dubbo 调用超时，到底卡在哪一层

你在代码里写了 `@DubboReference(timeout=1000) private UserService userService`。某个深夜，告警响了——这个接口大量超时。你在 ELK 里看日志，所有报错都是同一句话：`TimeoutException: Waiting server-side response timeout`。

但这句话什么也没告诉你。你需要拆的是：**这 1000ms 里，每 1ms 花在哪了。**

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

**这告诉你什么**：

| 阶段 | 耗时 | 含义 |
| :-- | :-- | :-- |
| Consumer Filter + Cluster | ~8ms | Dubbo 框架开销，通常可忽略 |
| 网络传输 (Consumer → Provider) | ~153ms | `(990-811) - 8 - 1.5` ≈ 153ms，数据在网线上 |
| Provider Filter | ~1.5ms | Dubbo 框架开销 |
| **Provider 业务逻辑** | **~804ms** | 这就是你的 Controller/Service 代码 |

**结论**：810ms 花在 Provider 业务逻辑上，153ms 花在网络上。不是你 client 设的 timeout 太小，是 Provider 处理真的有 800ms 的慢调用。

但如果 Consumer 侧显示 990ms、Provider 侧却只有 50ms 呢？这就是**网络传输吃掉 940ms**——不是你代码慢，是链路有问题。内网 RTT 通常在 1-5ms，超过 10ms 就要查交换机、防火墙、对端负载。

### 1.2 GC 导致的「静默超时」——RPC 超时排查最隐蔽的坑

上面那个案例是「服务端确实慢」。但还有一种超时，日志里**什么线索都没有**：

```txt
Provider 日志：
12:00:00.100 收到请求 → 12:00:03.200 开始执行业务逻辑
↑ 中间 3 秒没有任何日志
```

请求进了 Provider，但 3 秒后才开始处理。所有监控指标（CPU、内存、磁盘）都是正常的。这种「静默超时」几乎只有一个原因：**GC STW（Stop-The-World）**。

一个真实案例（Dubbo Issue #15043）：Dubbo Provider 用 JDK 11 + G1，偶尔大面积超时，日志显示「请求已进入 provider 但 3 秒后才执行下一步」。最终确认是 G1 的 mixed GC 耗时过长——不是 Full GC，是 mixed GC 的 ref-proc 阶段单线程处理 PhantomReference 卡了 4 秒。

排查这类问题的方法：

```bash
# 1. 加上 GC 日志
-XX:+PrintGCDetails -XX:+PrintGCDateStamps -Xloggc:gc.log

# 2. 对比 RPC 超时时间点和 GC 日志中的停顿时间
grep "2026-08-09 12:00" gc.log | grep "pause"

# 3. 如果 ref-proc 阶段长，加多线程处理
-XX:+ParallelRefProcEnabled
```

## 2. RPC 到底做了什么：一次远程调用的完整旅程

从 §8.1 你已经知道超时可以拆成多个环节了。现在把镜头拉远，看一次 RPC 调用从 `userService.findById(1)` 到 `return User{...}` 经过的全部流程。

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
  ├─ ⑤ Provider 反序列化 (bytes → Java对象)          │
  ├─ ⑥ 反射调用真实方法 → 拿到返回值                   │
  ├─ ⑦ 序列化返回值 → 写回                            │
  │                                                    │
  ◀─────────────── 返回值 bytes ───────────────────────
```

和你写本地方法 `userService.findById(1)` 的区别只在于：这 7 步中间插了一个网络。

### 2.2 各环节在你线上能表现出什么问题

| 环节 | 正常表现 | 线上出问题的表现 |
| :-- | :-- | :-- |
| ① Proxy | 无感 | `@DubboReference` 配置错误 → Bean 创建失败 |
| ② 序列化 | 1-5ms | 参数对象巨大（几 MB）→ 序列化吞吐不足 → CPU 飙升 |
| ③ 协议封装 | < 1ms | 协议版本不匹配 → `DecodeException` |
| ④ 网络传输 | 内网 1-5ms | RTT 突然飙升 → 跨机房 / 交换机问题 / accept 队列满 |
| ⑤ 反序列化 | 1-5ms | 同② |
| ⑥ 反射调用 | < 1ms | 业务代码慢（慢 SQL / 外部依赖） |
| ⑦ 写回 | 1-5ms | 客户端已超时断开 → 写入 `Broken pipe` |

### 2.3 HTTP vs RPC：你该用哪个

| 维度 | HTTP REST | RPC (Dubbo/gRPC) |
| :-- | :-- | :-- |
| 语义 | 面向资源 | 面向方法 |
| 性能 | JSON 文本 → 体积大、解析慢 | 二进制 → 体积小、解析快 |
| 服务治理 | ❌ 需自建 | ✅ 内置（路由/限流/熔断/降级） |
| 跨语言 | ✅ | ⚠️ Protobuf 方案跨语言，Hessian 仅 Java |
| 适用 | 对外 API、浏览器可调 | 内部服务间高频调用 |

**选择很简单**：对外用 HTTP REST，对内用 RPC。

## 3. RPC 超时排查三板斧

从 §8.1 你已经知道 Dubbo Profiler 能告诉你耗时在哪个阶段。但在没装上 Profiler 之前（或你用的不是 Dubbo），你需要这三步：

### 3.1 第一板斧：确定超时发生在 Consumer 还是 Provider

```bash
# Consumer 侧 filter 日志（Dubbo 默认打印的 ElapsedFilter）
grep "cost .* ms, this invocation almost (maybe already) timeout" consumer.log

# Provider 侧 filter 日志
grep "cost .* ms, this invocation almost (maybe already) timeout" provider.log
```

如果两边都有 900ms+ 的耗时 → Provider 业务慢（80% 的情况）。
如果 Consumer 有 900ms+、Provider 只有 50ms → 网络问题或 Consumer GC。
如果两边都没有明显耗时但 Consumer 报超时 → **timeout 设得太短**（默认 1s）。

### 3.2 第二板斧：GC 日志

```bash
# 拿 GC 日志，找 STW 时间 > 500ms 的
grep "Total time for which application threads were stopped" gc.log | awk '{if ($NF > 0.5) print}'
```

如果 RPC 超时时间点恰好处于一次长 GC pause 内 → STW 是根因。

### 3.3 第三板斧：网络抓包

```bash
# Provider 侧抓 Dubbo 端口
tcpdump -i eth0 port 20880 -w rpc_capture.pcap

# 在 Wireshark 中过滤超时连接
# 关注 TCP Out_of_Order、TCP Retransmission、TCP Dup ACK
```

如果同一个 TCP stream 里有大量重传 → 网络丢包。丢包原因可能是交换机过载、网卡 ring buffer 小、或宿主机 CPU 争用。

## 4. 序列化：你的对象为什么传得比想象的慢

RPC 框架不管内部逻辑多复杂，最终要做的就是从 bytes 到对象、再从对象到 bytes。不同的序列化方案差异可达 10 倍。

### 4.1 性能对比

```txt
序列化速度 (ops/s，越高越好):
Kryo     ████████████████████████████████████  1,200,000
Protobuf ██████████████████████████            850,000
Hessian  ████████████████████                  650,000
JSON     ██████████████                        450,000
```

| 方案 | 体积 | 跨语言 | 典型场景 |
| :-- | :-- | :--: | :-- |
| Protobuf | 最小 | ✅ | gRPC、Kafka |
| Kryo | 很小 | ❌ Java-only | Java 内部高性能 |
| Hessian | 中等 | ✅ | Dubbo 默认 |
| JSON | 最大 | ✅ | REST API |

### 4.2 典型踩坑：Protobuf 默认值陷阱

```protobuf
message User {
    int64 id = 1;
    string name = 2;
    int32 age = 3;
}
```

Protobuf 不会序列化默认值：`age=0` 和 `name=""` 在字节流中不存在。这导致 Java 端 `Integer age` 可能被反序列化为 `null` 而非 `0`——你的业务代码对 null 做 `autoboxing` 直接 NPE。

```java
// ❌ Protobuf int32 默认值 0 不序列化 → Java 反序列化后 age 为 null → NPE
int age = user.getAge();  // user.getAge() 返回 Integer null

// ✅ 用基本类型包装或设默认值
int age = Optional.ofNullable(user.getAge()).orElse(0);
```

## 5. 服务发现：「该调谁」的问题

前面讨论的都是「怎么调」。但在有多副本的环境里，首先要解决「调哪个」。

### 5.1 注册中心的本质

```txt
Provider 集群                       注册中心                      Consumer
┌─────────┐                    ┌─────────────┐              ┌─────────┐
│ 实例1   │──注册──▶           │ user-service │  ◀──订阅──    │ @Ref    │
│ 10.0.1.1│                    │ → 10.0.1.1  │              │         │
│ 实例2   │──注册──▶           │ → 10.0.1.2  │              │         │
│ 10.0.1.2│                    │ → 10.0.1.3  │              └─────────┘
│ 实例3   │──注册──▶           └─────────────┘
│ 10.0.1.3│
└─────────┘
```

Consumer 启动 → 拉取 `user-service` 的所有实例 → 本地缓存 → 按负载均衡策略选一个 → 发起调用。实例上线/下线 → 注册中心推送变更 → Consumer 更新缓存。

注册中心挂了？Consumer 用本地缓存继续调用已缓存的实例。但新实例加不进来、下线实例不会被感知。

### 5.2 负载均衡策略

| 策略 | 算法 | 什么时候用 |
| :-- | :-- | :-- |
| Random | 随机 | 通用，实例性能相近 |
| RoundRobin | 轮询 | 实例性能相同 |
| LeastActive | 选当前负载最轻的 | 请求耗时差异大 |
| ConsistentHash | 相同参数 → 同一实例 | 有状态服务、本地缓存 |
