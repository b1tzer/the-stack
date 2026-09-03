# 案例集（四）：堆正常但服务崩了 —— TCP 层与堆外内存的隐形杀手

> 监控全绿：堆 40%、CPU 30%、GC 正常。但接口每隔几秒就有一次 10 秒+ 超时，容器 `livenessProbe` 超时触发重启。`jstack` 跑了三遍——每次 Tomcat 线程都在 `WAITING`，没什么异常。直到开了 Tomcat 的 DEBUG 日志，才发现 `Acceptor` 线程卡在 `LimitLatch.countUpOrAwaitConnection()`——`server.tomcat.max-connections=10`，一条陈年配置把服务逼成了间歇性假死。另一台机器，堆也正常，但容器被 OOMKilled——`jmap -histo` 查不出问题，`-XX:NativeMemoryTracking=summary` 才揭穿：Netty 的 `PooledByteBufAllocator` 吃掉了 1.2GB 直接内存，每个 ByteBuf 的引用计数都停在 `retain() + 1`，永远不归零。这两类问题的共同特点：所有你看得见的指标都正常——真正的问题藏在你看不到的地方。

## 1. 案例 11：Tomcat LimitLatch —— 一条陈年配置让服务间歇性假死

### 1.1 事故背景

2025 年某团队将一个 Spring Boot 服务部署到生产环境后，出现间歇性请求超时——每次卡 10 秒以上，但日志里没有任何业务异常。更诡异的是，容器的 `livenessProbe` 也间歇性超时，触发 K8s 自动重启。重启后恢复，过一段时间又复发。

该团队排查了一圈：
- GC 日志正常，无 Full GC
- CPU / 内存正常
- 数据库连接池正常
- 下游依赖都健康
- `jstack` 跑了三遍，每次 Tomcat 工作线程（`http-nio-8080-exec-*`）都在 `WAITING` 状态等任务——看起来一切正常

这个问题最讽刺的是：真相在第一次 `jstack` 里就已经出现了，但排查者看了三遍都没注意到。详见萧易客的完整复盘：<https://aops.io/article/tomcat-blocking-on-acceptor.html>。

### 1.2 第一步：第一次 jstack —— 错过了真凶

```bash
jstack -l <pid> > thread.dump
```

排查者的注意力全部集中在 Tomcat 工作线程上：

```txt
"http-nio-8080-exec-1" #42 daemon prio=5
   java.lang.Thread.State: WAITING (parking)
    at sun.misc.Unsafe.park(Native Method)
    at java.util.concurrent.locks.LockSupport.park(LockSupport.java:175)
    at java.util.concurrent.LinkedBlockingQueue.take(LinkedBlockingQueue.java:442)
    at org.apache.tomcat.util.threads.TaskQueue.take(TaskQueue.java:98)
    ...
```

"http-nio-8080-exec-2" 到 "http-nio-8080-exec-200"——全部 `WAITING`。排查者得出结论：工作线程都在等活干，不是线程池的问题。方向转向了 GC、网络、数据库——全都没有问题。排查陷入僵局。

### 1.3 第二步：开启 Tomcat DEBUG 日志 —— 发现盲点

排查者决定扩大范围，开启 Tomcat 的内部 DEBUG 日志，追踪每个请求从到达 Tomcat 到完成的全过程时序：

```yaml
logging:
  level:
    org.apache.tomcat: DEBUG
    org.apache.catalina: DEBUG
```

日志中出现了反复出现的一条记录：

```txt
o.apache.tomcat.util.threads.LimitLatch : Counting up[http-nio-8080-Acceptor-0] latch=10
o.apache.tomcat.util.threads.LimitLatch : Counting up[http-nio-8080-Acceptor-0] latch=10
o.apache.tomcat.util.threads.LimitLatch : Counting up[http-nio-8080-Acceptor-0] latch=10
```

`latch=10` —— 当前连接数持续等于最大值 10。这个类名 `LimitLatch` 触发了排查者的记忆：**Tomcat 用 `LimitLatch`（基于 AQS 的共享锁）来限制最大连接数。** 当连接数达到上限时，Acceptor 线程被阻塞，无法 `accept()` 新的 TCP 连接。

他立刻回去翻之前的 `jstack` 输出——Acceptor 线程一直都在那里，但被忽略了：

```txt
"http-nio-8080-Acceptor-0" #19 daemon prio=5
   java.lang.Thread.State: WAITING (parking)
    at sun.misc.Unsafe.park(Native Method)
    at java.util.concurrent.locks.LockSupport.park(LockSupport.java:175)
    at java.util.concurrent.locks.AbstractQueuedSynchronizer.doAcquireSharedInterruptibly(...)
    at java.util.concurrent.locks.AbstractQueuedSynchronizer.acquireSharedInterruptibly(...)
    at org.apache.tomcat.util.threads.LimitLatch.countUpOrAwait(LimitLatch.java:115)
    at org.apache.tomcat.util.net.AbstractEndpoint.countUpOrAwaitConnection(...)
    at org.apache.tomcat.util.net.NioEndpoint$Acceptor.run(NioEndpoint.java:787)
```

Acceptor 线程处于 `WAITING`，卡在 `LimitLatch.countUpOrAwait()`。这意味着：当前 TCP 连接数已达到 `maxConnections` 上限，Acceptor 被 AQS 共享锁阻塞，不再从内核的 `backlog` 队列中取新连接。

### 1.4 第三步：验证连接数上限

用 `ss` 命令查看 TCP 连接队列状态：

```bash
ss -tnp | grep :8080
```

输出显示与 8080 端口的 `ESTABLISHED` 连接恰好 10 个。`Recv-Q` 列的值持续 > 0——说明内核的 `backlog` 队列中有连接在排队，等待 `accept()` 取走。

### 1.5 第四步：翻出罪魁祸首

在 `application.yml` 的一个不起眼的角落里：

```yaml
server:
  tomcat:
    max-connections: 10   # ← 谁加的？为什么是 10？
```

Tomcat NIO 模式下 `max-connections` 默认值是 10000。这里被改成了 10。而前方的 Nginx 配置了 `worker_processes 16`——16 个 worker 每个维护一个到后端的 keep-alive 长连接，理论上 16 个连接就超过了 Tomcat 的上限 10。

但正常运行时为什么没有立即出问题？因为 keep-alive 连接不是始终占满的——有些连接处于空闲状态，Tomcat 的连接计数在请求处理间隙会短暂回落。所以不是所有请求都超时，而是间歇性的：当第 11 个 Nginx worker 恰好发起请求时，Acceptor 被阻塞，新连接只能在 `backlog` 队列里等，等的时间就是某个现有连接释放的间隔——最多可以长达 keep-alive timeout（默认 20 秒）。

这就是"间歇性假死"的完整成因。

### 1.6 Tomcat 线程模型补充说明

理解这个问题需要知道 Tomcat 的一条连接是怎么被交给 worker 线程处理的：

```txt
客户端 → OS TCP backlog 队列 → Acceptor 线程 accept() → 连接计数 +1
  → Poller 线程注册到 Selector → Poller 检测到可读事件
  → 交给 Worker 线程池处理（http-nio-8080-exec-*）
  → 处理完毕 → 连接计数 -1
```

Acceptor 线程**只负责 `accept()` 新连接**。它不处理请求，不解包 HTTP，不执行业务逻辑。它只做一件事：收到新连接，转交给 Poller，然后立刻去接下一个。如果 Acceptor 被 `LimitLatch` 卡住——整个服务就停止接收新连接，但已经在处理中的请求完全不受影响。

这解释了为什么 `http-nio-8080-exec-*` 线程在 `jstack` 里全是 `WAITING`——它们确实在等活干，因为根本没有新连接进来。

### 1.7 第五步：修复

最简单的修复就是删掉那条配置：

```yaml
# 删除 server.tomcat.max-connections: 10
# Tomcat NIO 模式下默认 10000，足够绝大多数场景使用
```

或者，如果确实有连接数管控需求，至少要知道基准：

```yaml
server:
  tomcat:
    max-connections: 10000     # 连接数上限（默认 10000）
    accept-count: 200           # backlog 队列长度（默认 100）
    max-threads: 200            # worker 线程数（默认 200）
```

三个参数的关系：

```txt
操作系统 TCP backlog（由 acceptCount 控制）
  └→ Acceptor 线程 accept() 后进入 maxConnections 计数的连接池
       └→ Poller 检测到可读数据后交给 maxThreads 个 worker 线程处理
```

**黄金比例：`maxConnections` ≥ `maxThreads` + `acceptCount`**。如果 maxConnections 设得太小，连接在内核 backlog 还没满时就被 LimitLatch 拦截，新连接直接卡在 Acceptor 上无人处理。

### 1.8 总结

| 信号 | 含义 | 工具 |
| :-- | :-- | :-- |
| 工作线程全部 `WAITING`，CPU 低 | 没有新请求进来——问题可能在 Acceptor | `jstack` |
| Acceptor 线程停在 `LimitLatch.countUpOrAwait` | maxConnections 已打满 | `jstack` |
| `ss -tnp` 显示连接数恰好 = 某整数 | 确认上限值 | `ss` |
| `Recv-Q` > 0 | 有连接在等待被 accept | `ss` |

**教训：** `jstack` 不是跑一遍就够的。排查者第一反应是看 worker 线程有没有卡在业务代码里，发现没有就转向 GC / 数据库 / 网络——全程忽略了 Acceptor 线程。线程名上的 `Acceptor` 字眼本身就暗示了它的角色，但排查时被选择性跳过。排障没有捷径：每条线程都要读，每个你不认识的类名都要追。

此外：任何环境里的任何配置，你都必须知道它是怎么来的、为什么是这个值。`max-connections=10` 可能是一次压测时的临时调整、某个"最佳实践"博客里的推荐值、或者某个前辈留下的"为了防止连接数打满"的保护措施——但无论哪种，在大批量 Nginx worker 的长连接面前都是灾难。

## 2. 案例 12：Netty 直接内存泄漏 —— 堆正常但容器被 OOMKilled

### 2.1 事故背景

2025 年某 API 网关服务（基于 Spring Cloud Gateway + Netty），部署在 Kubernetes 上，4C8G，`-Xmx4g`。上线一段时间后，Pod 开始出现规律性 OOMKilled——每 2~3 小时重启一次，但监控显示 JVM 堆使用率从未超过 45%，GC 次数和耗时均在正常范围。没有 `OutOfMemoryError` 日志，没有 heap dump 文件，Pod 直接消失。

类似事件在开发者社区并不罕见。亚马逊 Corretto 的 GitHub Issue #225 记录了一个几乎完全一致的故障：Spring Boot 3.1.3 + Corretto 17.0.6，RSS 持续增长直到触发容器 OOM，但堆使用率正常——最终定位到内存分配器的碎片化问题。Michal Drozd 的博客 "Java OOMKilled With Stable Heap" 也详细分析了这类故障的排查方法论：堆外内存（Direct Memory）、线程栈、glibc arena 三者构成了堆之外的"隐形内存消耗"，在容器环境下尤其致命。

### 2.2 第一步：确认是 K8s OOMKilled，不是 JVM OOM

```bash
kubectl describe pod <pod-name>
```

```txt
State:          Terminated
  Reason:       OOMKilled
  Exit Code:    137
```

Exit Code 137 = `128 + 9`（SIGKILL）。这是 Linux OOM Killer 直接杀进程——不是因为 JVM 抛了 `OutOfMemoryError`，而是容器总 RSS 超过 `resources.limits.memory`。

用 `kubectl top pod` 看 RSS：

```txt
NAME                          CPU(cores)   MEMORY(bytes)
gateway-pod-xxx               450m         7850Mi   ← 接近 8G limit
```

### 2.3 第二步：确认堆内存正常

```bash
jstat -gcutil <pid> 1000 5
```

```txt
  S0     S1     E      O      M     YGC     YGCT    FGC    FGCT     GCT
  0.00  42.15  56.23  38.12  72.11  1234   23.456    2    1.234   24.690
  0.00  38.45  78.34  39.01  72.12  1235   23.489    2    1.234   24.723
  0.00  35.12  22.45  40.23  72.13  1236   23.523    2    1.234   24.757
  0.00  44.23  91.34  41.12  72.13  1237   23.556    2    1.234   24.790
```

老年代仅 40%，Full GC 两小时才 2 次。堆确实没有问题。但 `jmap -histo` 也看不出异常——前几名依然是正常的 `char[]`、`String`、`HashMap$Node`。这让人迷惑：RSS 接近 8G，堆只用了不到 2G，剩下的 6G 去哪了？

### 2.4 第三步：开启 NMT 追踪堆外内存

问题的关键是启用 Native Memory Tracking：

```bash
# 重启时加上 NMT 参数（需要重启，NMT 不能动态开启）
-XX:NativeMemoryTracking=detail
```

等待一段时间后，用 `jcmd` 查看 Native Memory 分布：

```bash
jcmd <pid> VM.native_memory summary
```

输出：

```txt
Native Memory Tracking:

Total: reserved=7245MB, committed=6812MB

-    Java Heap (reserved=4096MB, committed=1834MB)  ← 堆不到 2G
          (mmap: reserved=4096MB, committed=1834MB)

-        Thread (reserved=412MB, committed=412MB)    ← 线程栈正常
          (thread #103)

-          Code (reserved=256MB, committed=128MB)    ← JIT 编译缓存正常

-            GC (reserved=384MB, committed=384MB)    ← GC 辅助结构

-     Metaspace (reserved=128MB, committed=120MB)    ← 元空间正常

-       NIO/Direct (reserved=1842MB, committed=1842MB)  ← 这里！！1.8G 直接内存！
```

`NIO/Direct` 占用了 1.8GB——几乎等于堆的大小。这是 Netty 的 `DirectByteBuffer`。加上堆的 1.8G（committed）、线程栈 400M、Metaspace 120M、Code Cache 128M、GC 辅助结构 384M——总计约 6.6G，再加上 glibc `malloc` 的 arena 碎片（每个 arena 预分配 64MB，在 8G 容器中默认 8 个 arena = 512MB），总 RSS 轻松超过 8G limit。

### 2.5 第四步：定位泄漏的 ByteBuf

开启 Netty 资源泄漏检测：

```bash
-Dio.netty.leakDetectionLevel=paranoid
```

注意：`paranoid` 级别会 100% 追踪每个 ByteBuf 的生命周期，性能开销约 20%~30%，仅在排查阶段使用，排查完立即关闭或降为 `simple`。

几分钟后，日志中出现：

```txt
LEAK: ByteBuf.release() was not called before it's garbage-collected.
See https://netty.io/wiki/reference-counted-objects.html for more information.
Recent access records:
#1:
  io.netty.handler.codec.http.HttpObjectDecoder.decode(HttpObjectDecoder.java:234)
  io.netty.handler.codec.http.HttpObjectDecoder.decode(HttpObjectDecoder.java:145)
  io.netty.handler.codec.ByteToMessageDecoder.callDecode(ByteToMessageDecoder.java:480)
  ...
#2:
  com.example.gateway.filter.ResponseModifyFilter.filter(ResponseModifyFilter.java:67)
  ...
Created at:
  io.netty.buffer.PooledByteBufAllocator.newDirectBuffer(PooledByteBufAllocator.java:402)
  io.netty.buffer.AbstractByteBufAllocator.directBuffer(AbstractByteBufAllocator.java:187)
  ...
```

泄漏定位在 `ResponseModifyFilter.filter()`——一个自定义的响应修改过滤器。

### 2.6 第五步：看代码

```java
@Component
public class ResponseModifyFilter implements GlobalFilter {

    @Override
    public Mono<Void> filter(ServerWebExchange exchange, GatewayFilterChain chain) {
        ServerHttpResponseDecorator decoratedResponse =
            new ServerHttpResponseDecorator(exchange.getResponse()) {
                @Override
                public Mono<Void> writeWith(Publisher<? extends DataBuffer> body) {
                    return super.writeWith(Flux.from(body).map(dataBuffer -> {
                        // 读取响应体内容
                        byte[] content = new byte[dataBuffer.readableByteCount()];
                        dataBuffer.read(content);
                        String bodyStr = new String(content, StandardCharsets.UTF_8);

                        // 修改响应体
                        String modified = modifyBody(bodyStr);

                        // 构造新的 DataBuffer 返回
                        // ⚠️ 问题：原 dataBuffer 没有 release()！
                        return exchange.getResponse().bufferFactory()
                            .wrap(modified.getBytes(StandardCharsets.UTF_8));
                    }));
                }
            };
        return chain.filter(exchange.mutate().response(decoratedResponse).build());
    }
}
```

在 Netty 中，`DataBuffer` 底层是 Netty 的 `ByteBuf`，属于引用计数对象。当 `writeWith()` 的回调返回新的 `DataBuffer` 后，Netty 会自动 release 新返回的那个 buffer——**但原始的 `dataBuffer`（从上游传下来的）的 release 责任在回调代码中**。如果回调只消费了它的内容但没有调用 `release()`，`dataBuffer` 对应的堆外内存块就永远不会被释放。

这就是 Netty 引用计数模型的核心陷阱：**消费方必须负责释放**。而且 `dataBuffer.read(content)` 只是把数据拷贝到字节数组——并不隐含 release。`release()` 必须显式调用。

每次请求的响应体大约 1~5KB，请求 QPS 约 3000，每小时约 1000 万次请求——每个都泄漏 1~5KB 的 Direct Buffer → 每小时泄漏约 10~50GB 的堆外内存——虽然 `DirectByteBuffer` 的 Cleaner 在 GC 时会回收一部分，但在高吞吐下包装清理跟不上分配速度，净泄漏速率仍然可观。

### 2.7 第六步：修复

```java
@Override
public Mono<Void> writeWith(Publisher<? extends DataBuffer> body) {
    return super.writeWith(Flux.from(body).map(dataBuffer -> {
        try {
            byte[] content = new byte[dataBuffer.readableByteCount()];
            dataBuffer.read(content);
            String bodyStr = new String(content, StandardCharsets.UTF_8);
            String modified = modifyBody(bodyStr);
            return exchange.getResponse().bufferFactory()
                .wrap(modified.getBytes(StandardCharsets.UTF_8));
        } finally {
            // ✅ 关键：释放原始 buffer
            DataBufferUtils.release(dataBuffer);
        }
    }));
}
```

`DataBufferUtils.release()` 是 Spring 提供的便捷方法，内部调用 Netty 的 `ReferenceCountUtil.release()`。`try-finally` 保证即使 `modifyBody()` 抛异常，buffer 也能被释放。

### 2.8 防止再次发生的防御措施

```bash
# 1. 显式限制直接内存上限（容器 8G，堆 4G，给直接内存 1G）
-XX:MaxDirectMemorySize=1g

# 2. 容器环境确保 JVM 感知 cgroup 限制
-XX:+UseContainerSupport
-XX:MaxRAMPercentage=60.0

# 3. 保留泄漏检测（simple 级别，性能开销 < 1%）
-Dio.netty.leakDetectionLevel=simple

# 4. 开启 NMT 用于事后分析
-XX:NativeMemoryTracking=summary
```

容器内存分配建议：

| 组件 | 占比 | 8G 容器 |
| :-- | :-- | :-- |
| Java Heap | 50~60% | 4G |
| Direct Memory | 10~15% | 1G |
| Thread Stacks | 10~15% | 800M |
| Metaspace / Code Cache / GC | 15~20% | 1G |
| 系统预留 | ~10% | 1G |

### 2.9 排查堆外内存问题的工具链

| 层级 | 工具 | 适用场景 |
| :-- | :-- | :-- |
| 进程级 | `kubectl describe pod` / `dmesg` | 确认 OOMKilled，排除 JVM OOM |
| 堆级 | `jstat -gcutil` / `jmap -histo` | 确认堆内存正常（从而推断问题在堆外） |
| 堆外总览 | `jcmd VM.native_memory summary` | 按区域看内存分布，定位到 Direct / Thread / Metaspace |
| 直接内存 | `-Dio.netty.leakDetectionLevel=paranoid` | 定位 Netty ByteBuf 泄漏的代码位置 |
| 容器级 | `kubectl top pod` / Prometheus `container_memory_rss` | 实时监控 RSS 趋势 |

### 2.10 总结

| 信号 | 含义 | 工具 |
| :-- | :-- | :-- |
| Pod OOMKilled、堆正常 | 问题不在堆——在堆外内存 | `kubectl describe pod` + `jstat` |
| NMT 中 `NIO/Direct` 持续增长 | 直接内存泄漏 | `jcmd VM.native_memory summary` |
| `LEAK: ByteBuf.release() was not called` | Netty 引用计数泄漏 | `-Dio.netty.leakDetectionLevel=paranoid` |
| RSS - Heap >> 1G | 堆外内存占据大头，需逐区域排查 | `kubectl top pod` - `jstat` 堆使用量 |

**教训：** 堆内存只是 Java 进程总内存的一部分。在容器环境下，K8s 的 `limits.memory` 限制的是整个进程的 RSS——包括堆、直接内存、线程栈、元空间、Code Cache、glibc arena 碎片、JNI 本地内存等。只看 JVM 堆是远远不够的。Michal Drozd 在博客中总结了一个经验法则：**永远给容器预留 40%~50% 的内存给堆外区域**。只设 `-Xmx` 不设 `-XX:MaxDirectMemorySize`，等于把直接内存的上限交给了物理内存——而在容器里，"物理内存"就是 limit 值，超了就杀。

> **上一篇：** [第六章案例集（三）：低内存低 CPU 下的 GC 疑难杂症](./chapter-06-diagnostics-cases-part3)
>
> **回到[第六章](./chapter-06-diagnostics)正文：** [线上排查与诊断](./chapter-06-diagnostics)
