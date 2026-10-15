# JVM 案例：TCP 层与堆外内存

> **案例说明：** 本页日期、业务背景、指标和工具输出均为构造或匿名化教学数据；除引用一手资料外，不应视为可核验的真实事件。排查方法与命令仍需结合目标 JDK、系统和生产变更流程验证。

> 本页用两个构造场景说明：堆和 GC 正常时，连接数上限与堆外内存仍可能限制服务。前一个场景检查 Tomcat `LimitLatch` 和 accept 队列，后一个场景检查 Netty 引用计数与 Native Memory Tracking（NMT）。

## Tomcat LimitLatch —— 一条陈年配置让服务间歇性假死

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

输出显示与 8080 端口的 `ESTABLISHED` 连接恰好 10 个。`ss -lnt` 下 8080 监听 socket 的 `Recv-Q` 持续 > 0——说明操作系统监听队列中有连接在等待 `accept()` 取走，与「已建立连接恰好 10 个」相互印证：连接数已贴近上限，同时仍有连接在队列中等待被接收。

### 1.5 第四步：翻出罪魁祸首

在 `application.yml` 的一个不起眼的角落里：

```yaml
server:
  tomcat:
    max-connections: 10   # ← 谁加的？为什么是 10？
```

本案例使用 Tomcat 8.5，NIO 模式下 `max-connections` 默认值是 10000；Tomcat 9.0.122、10.0.27 和 10.1.59 的默认值则是 8192。无论采用哪个默认值，这里被显式改成了 10。前方的 Nginx 配置了 `worker_processes 16`——worker 进程数不等于后端 TCP 连接数，实际连接数取决于上游 keep-alive 配置、并发请求量和连接复用情况；本案例把 `max-connections` 设为 10，构造出一个连接容量明显偏小的场景。

但正常运行时为什么没有立即出问题？因为 keep-alive 连接在两次请求之间空闲时，TCP 连接本身仍存在，Tomcat 的连接计数并不会因单次请求处理完毕而扣减；真正让连接数回落的是连接被关闭或回收，而空闲连接不会一直占满。所以不是所有请求都超时，而是间歇性的：当并发请求数暂超过 10、第 11 个连接到来时，Acceptor 被阻塞，新连接只能在 `backlog` 队列里等，等的时间取决于某个已有连接何时释放——最多可达 keep-alive timeout（默认 20 秒）。

这组证据（已建立连接数恰好等于上限、Acceptor 卡在 `LimitLatch`、监听队列持续积压）共同支持「连接上限触发新连接等待」的判断，是本例间歇性假死的成因。

### 1.6 Tomcat 线程模型补充说明

理解这个问题需要知道 Tomcat 的一条连接是怎么被交给 worker 线程处理的：

```txt
客户端发起 TCP 连接 → OS 监听队列暂存连接请求
  → Acceptor 接收连接（受 maxConnections 限制）→ 连接计数 +1
  → Poller 注册到 Selector → 有可读事件时交给 Worker 线程池（http-nio-8080-exec-*）
  → 一次请求处理完毕，连接仍可能保持 keep-alive
  → TCP 连接关闭后，连接计数才相应 -1
```

Acceptor 线程**只负责 `accept()` 新连接**。它不处理请求，不解包 HTTP，不执行业务逻辑。它只做一件事：收到新连接，转交给 Poller，然后立刻去接下一个。如果 Acceptor 被 `LimitLatch` 卡住——整个服务就停止接收新连接，但已经在处理中的请求完全不受影响。

这解释了为什么 `http-nio-8080-exec-*` 线程在 `jstack` 里全是 `WAITING`——它们确实在等活干，因为根本没有新连接进来。

### 1.7 第五步：修复

最简单的修复就是删掉那条配置：

```yaml
# 删除 server.tomcat.max-connections: 10
# 删除后使用部署版本的默认值；Tomcat 8.5 NIO 为 10000，
# Tomcat 9.0.122、10.0.27、10.1.59 为 8192
```

或者，如果确实有连接数管控需求，至少要知道基准：

```yaml
server:
  tomcat:
    max-connections: 8192      # 连接数上限；默认值随 Tomcat 版本变化
    accept-count: 200           # backlog 队列长度（默认 100）
    max-threads: 200            # worker 线程数（默认 200）
```

三个参数分别控制不同的环节：

```txt
操作系统 TCP backlog（由 acceptCount 控制）
  └→ Acceptor 线程 accept() 后进入 maxConnections 计数的连接池
       └→ Poller 检测到可读数据后交给 maxThreads 个 worker 线程处理
```

`maxConnections`、`acceptCount`、`maxThreads` 职责不同：前者限制同时接收的连接数，后者是连接满了之后操作系统用于排队等待的队列长度，再后者是请求处理线程的并发上限，三者之间不存在必须满足的加法关系。`maxConnections` 过小会让连接容量成为瓶颈，`maxThreads` 过小会让已接收的连接在等待处理，而 `acceptCount` 之外的操作系统队列填满则可能导致新连接被拒或超时。

### 1.8 总结

| 信号 | 含义 | 工具 |
| :-- | :-- | :-- |
| 工作线程全部 `WAITING`，CPU 低 | 没有新请求进来——问题可能在 Acceptor | `jstack` |
| Acceptor 线程停在 `LimitLatch.countUpOrAwait` | maxConnections 已打满 | `jstack` |
| `ss -tnp` 显示连接数恰好 = 某整数 | 确认上限值 | `ss` |
| `Recv-Q` > 0 | 有连接在等待被 accept | `ss` |

**教训：** `jstack` 不是跑一遍就够的。排查者第一反应是看 worker 线程有没有卡在业务代码里，发现没有就转向 GC / 数据库 / 网络——全程忽略了 Acceptor 线程。线程名上的 `Acceptor` 字眼本身就暗示了它的角色，但排查时被选择性跳过。排障没有捷径：每条线程都要读，每个你不认识的类名都要追。

此外：任何环境里的任何配置，你都必须知道它是怎么来的、为什么是这个值。`max-connections=10` 可能是一次压测时的临时调整、某个"最佳实践"博客里的推荐值、或者某个前辈留下的"为了防止连接数打满"的保护措施——但无论哪种，在大批量 Nginx worker 的长连接面前都是灾难。

## Netty 直接内存泄漏 —— 堆正常但容器被 OOMKilled

### 2.1 事故背景

2025 年某 API 网关服务（基于 Spring Cloud Gateway + Netty），部署在 Kubernetes 上，4C8G，`-Xmx4g`。上线一段时间后，Pod 开始出现规律性 OOMKilled——每 2~3 小时重启一次，但监控显示 JVM 堆使用率从未超过 45%，GC 次数和耗时均在正常范围。没有 `OutOfMemoryError` 日志，没有 heap dump 文件，Pod 直接消失。

类似事件在开发者社区并不罕见。亚马逊 Corretto 的 GitHub Issue #225 记录了一个几乎完全一致的故障：Spring Boot 3.1.3 + Corretto 17.0.6，RSS 持续增长直到触发容器 OOM，但堆使用率正常——最终定位到内存分配器的碎片化问题。Michal Drozd 的博客 "Java OOMKilled With Stable Heap" 也详细分析了这类故障的排查方法论：堆外内存（Direct Memory）、线程栈、glibc arena 三者构成了堆之外常被忽视的内存开销，在容器环境下尤其致命。

### 2.2 第一步：确认是 K8s OOMKilled，不是 JVM OOM

```bash
kubectl describe pod <pod-name>
```

```txt
State:          Terminated
  Reason:       OOMKilled
  Exit Code:    137
```

Exit Code 137 = `128 + 9`（SIGKILL）。`describe pod` 同时显示 `Reason: OOMKilled`，这是更直接的证据：容器因内存相关的终止条件被杀。但 Exit Code 137 本身只表示进程收到 SIGKILL，并不能单独确认是 OOM Killer——`kubectl describe pod` 的 `Reason` 字段才是判定 OOMKilled 的依据。需要注意，cgroup 的内存统计口径与单个进程的 RSS 并不相同，不能简单把「容器内存超限」表述为「总 RSS 超过 limit」。

用 `kubectl top pod` 看容器内存使用趋势（Metrics API 指标，不一定等同于进程 RSS）：

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

-       NIO/Direct (reserved=1842MB, committed=1842MB)  ← NIO/Direct 约 1.8GB
```

`NIO/Direct` 项显示约 1.8GB 的提交内存，量级接近堆的提交量。需要注意：NMT 主要跟踪 HotSpot 自身管理的内存，不覆盖第三方 native 分配（例如 Netty native allocator 之外的部分），也不能直接把这一项等同于全部 Netty 直接内存。将上述各区域的 committed 相加（约 4.7GB）再加上 glibc `malloc` 的 arena 估算（每个 arena 预分配 64MB，在 8G 容器中默认 8 个 arena = 512MB），仍只是对物理内存的部分解释——`reserved` 是虚拟地址预留，`committed` 是已提交可供使用，二者都不等同于当前驻留的 RSS。NMT 总量与进程 RSS 不匹配时，差额应作为继续排查的线索，而非直接归因于 Netty。

### 2.5 第四步：定位泄漏的 ByteBuf

开启 Netty 资源泄漏检测：

```bash
-Dio.netty.leakDetectionLevel=paranoid
```

注意：`paranoid` 级别会追踪每一次 ByteBuf 相关的分配与回收，开销明显高于 `simple`（后者默认只采样约 1%），具体影响取决于分配频率、负载与 Netty 版本，建议在测试或受控排查窗口使用，排查完立即关闭或降为 `simple`。参数名需与目标 Netty 版本对应：旧版为 `-Dio.netty.leakDetectionLevel=paranoid`，较新 Netty 改为 `-Dio.netty.leakDetection.level=paranoid`；本文以 Spring Cloud Gateway 为例，应写明实际依赖的 Netty 版本，避免照抄后参数失效。

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

在 Netty 中，`DataBuffer` 底层是 Netty 的 `ByteBuf`，属于引用计数对象。本例中回调读取原始 `dataBuffer` 的内容后构造了新的响应 buffer，且不再把原始 buffer 向下游传递——此时原始 buffer 的释放责任在回调代码中。如果回调只消费了它的内容却没有调用 `release()`，这个 buffer 就无法归还内存池，对应的堆外内存可能一直不被回收。

需要明确：释放责任取决于缓冲区的所有权是否转移、是否继续向下游传递，以及所用 Spring / Reactor 操作符的语义，不能一概说「消费方必须释放」。而且 `dataBuffer.read(content)` 只是把数据拷贝到字节数组——并不隐含 release。`release()` 必须显式调用。`try-finally` 能覆盖当前映射函数内的异常路径，但无法自动处理 Reactor 链中因取消或丢弃而未被消费的 buffer。

按每秒 3000 请求、每响应体 1~5KB 估算，这条路径每小时涉及的响应体数据量约为 10~50GB。这是累计经过该路径的数据量，不等于每小时新增的物理内存：对池化 buffer，遗漏释放会让 buffer 无法归还内存池，导致池外内存逐渐膨胀；实际 RSS 增长还需结合 Netty allocator 指标、direct buffer 使用量与进程 RSS 的时间序列来确认。

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

`DataBufferUtils.release()` 是 Spring 提供的统一释放入口：对 `PooledDataBuffer` 会调用相应的 `release()`，对 `CloseableDataBuffer` 则执行关闭操作，具体底层实现取决于实际缓冲区类型。`try-finally` 保证即使 `modifyBody()` 抛异常，buffer 也能被释放。

### 2.8 防止再次发生的防御措施

```bash
# 1. 约束 JVM NIO 直接缓冲区上限（注意：仅覆盖 JVM NIO 直接内存，不等同于约束全部 Netty native 分配）
-XX:MaxDirectMemorySize=1g

# 2. 容器环境确保 JVM 感知 cgroup 限制（UseContainerSupport 在现代 JDK 通常默认开启）
-XX:+UseContainerSupport
# 注意：若已显式设置 -Xmx4g，MaxRAMPercentage 不会再把最大堆改为容器内存的 60%；二者不应同时保留为矛盾配置
# -XX:MaxRAMPercentage=60.0

# 3. 保留泄漏检测（simple 级别为采样，开销低；具体比例随版本与负载变化）
-Dio.netty.leakDetectionLevel=simple

# 4. 开启 NMT 用于事后分析
-XX:NativeMemoryTracking=summary
```

容器内存需要预算的项目（占比应结合目标 JDK、Netty 版本、容器 limit 与压测结果确定，不宜套用固定比例）：

| 组件 | 预算依据 |
| :-- | :-- |
| Java Heap | `-Xmx`、实际存活集、GC 情况 |
| Direct Buffer / Netty Pool | 峰值并发、buffer 大小、池化指标 |
| Thread Stacks | 线程数、`-Xss`、线程增长趋势 |
| Metaspace / Code Cache / GC | 运行时指标与 NMT |
| 其他 native memory | JNI、native 库、分配器、进程映射 |
| 容器余量 | 压测峰值、RSS 与 cgroup 内存指标 |

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
| 容器内存使用接近 limit、堆明显偏低 | 提示问题在堆外，需逐区域排查 | `kubectl top pod` / `container_memory_rss` - `jstat` 堆使用量 |

**教训：** 堆内存只是 Java 进程总内存的一部分。在容器环境下，K8s 的 `limits.memory` 限制的是整个进程的 RSS——包括堆、直接内存、线程栈、元空间、Code Cache、glibc arena 碎片、JNI 本地内存等。只看 JVM 堆是远远不够的。Michal Drozd 在博客中总结了一个经验法则：**永远给容器预留 40%~50% 的内存给堆外区域**。`-Xmx` 只限制 Java 堆，不代表整个 JVM 进程的内存上限。容器内存预算还应覆盖直接缓冲区、线程栈、元空间和其他 native 分配；是否需要设置 `MaxDirectMemorySize`，应结合具体分配器行为与监控数据判断，而不是默认套用。

> **上一篇：** [GC 延迟与分配异常案例](./chapter-04-cases-gc-latency.md)
>
> **回到诊断入口：** [JVM 线上诊断](./chapter-01-jvm-diagnostics.md)
