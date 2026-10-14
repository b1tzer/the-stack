# 高并发网络优化与最佳实践

> 本页与 [网络性能分析与故障排查](../06-diagnostics/03-network/chapter-01-network-diagnostics.md) 配套，重点说明高并发网络优化、连接参数和诊断实践。

## 1. 高并发网络优化

### 1.1 连接池优化

连接池是高并发网络调用的基础设施。配置不当会导致连接耗尽或性能低下。以下示例基于 Apache HttpClient 4.5.x API，HttpClient 5.x 的包名和超时配置 API 存在差异，不能直接混用。连接池容量应根据并发请求数、平均连接占用时间、下游容量和超时预算共同确定，扩大连接池可能增加下游压力，并不必然提高吞吐量。

```java
// Apache HttpClient 连接池配置
PoolingHttpClientConnectionManager cm =
        new PoolingHttpClientConnectionManager();

// 最大连接数（所有目标主机共享）
cm.setMaxTotal(500);

// 每个主机的最大连接数
cm.setDefaultMaxPerRoute(100);

// 针对特定主机设置更大的连接数
cm.setMaxPerRoute(
        new HttpRoute(new HttpHost("api.critical-service.com", 443)),
        200
);

// 连接池配置细节
RequestConfig requestConfig = RequestConfig.custom()
        .setConnectTimeout(3000)        // 连接建立超时 3s
        .setSocketTimeout(5000)         // 数据读取超时 5s
        .setConnectionRequestTimeout(2000) // 从池中获取连接超时 2s
        .build();

CloseableHttpClient httpClient = HttpClients.custom()
        .setConnectionManager(cm)
        .setDefaultRequestConfig(requestConfig)
        .evictExpiredConnections()      // 定期清理过期连接
        .evictIdleConnections(30, TimeUnit.SECONDS) // 清理空闲连接
        .build();
```

**连接池监控：**

```java
// 定期打印连接池状态
@Scheduled(fixedDelay = 30000)
public void logPoolStats() {
    PoolStats stats = cm.getTotalStats();
    log.info("连接池状态: 已租用={}, 空闲={}, 最大={}",
            stats.getLeased(), stats.getAvailable(), stats.getMax());
    // 已租用连接数持续接近最大值，且等待队列增长 → 可能存在池容量不足、请求过慢或连接未及时释放
    // 空闲连接数为零本身不能证明新请求正在排队，应同时检查待租用请求数和获取连接耗时
    // 连接池使用率高也不等于池一定太小，下游响应变慢同样会让连接占用时间变长
}
```

### 1.2 NIO vs BIO 选择

| 特性 | BIO（阻塞 I/O） | NIO（非阻塞 I/O） | AIO（异步 I/O） |
| :-- | :-- | :-- | :-- |
| 编程模型 | 常见阻塞式服务端为每个连接分配工作线程 | 一个线程等待多个通道的就绪事件 | 通过 Future 或 CompletionHandler 获取异步结果 |
| 阻塞点 | read/write 阻塞 | 等待多个通道就绪事件，就绪后由应用读写 | 异步提交，回调或轮询结果 |
| 适用条件 | 连接数少、每连接数据量大时更直观 | 大量连接、多数时间空闲时资源开销更低 | 需评估平台实现与工作负载是否匹配 |
| 复杂度 | 低 | 中 | 高 |
| Java 生态 | 旧版 Tomcat BIO Connector（历史） | Netty / Tomcat NIO | 实现与平台相关，不应仅凭"异步"选择 |

表中是编程模型与资源管理成本的比较，不是固定的性能排名。Tomcat 的连接器实现随版本演进，旧版 BIO Connector 不能作为当前主流部署的默认示例。

```java
// NIO 基本模式 —— Selector 多路复用
Selector selector = Selector.open();
ServerSocketChannel serverChannel = ServerSocketChannel.open();
serverChannel.configureBlocking(false);
serverChannel.bind(new InetSocketAddress(8080));
serverChannel.register(selector, SelectionKey.OP_ACCEPT);

while (true) {
    selector.select(); // 阻塞，直到有事件就绪
    Set<SelectionKey> keys = selector.selectedKeys();
    Iterator<SelectionKey> iter = keys.iterator();

    while (iter.hasNext()) {
        SelectionKey key = iter.next();
        if (key.isAcceptable()) {
            // 新连接接入；非阻塞 accept() 可能返回 null
            SocketChannel client = serverChannel.accept();
            if (client != null) {
                client.configureBlocking(false);
                client.register(selector, SelectionKey.OP_READ);
            }
        } else if (key.isReadable()) {
            // 有数据可读
            SocketChannel client = (SocketChannel) key.channel();
            ByteBuffer buf = ByteBuffer.allocate(1024);
            int bytesRead = client.read(buf);
            if (bytesRead == -1) {
                client.close(); // 对端关闭
            } else {
                buf.flip();
                // 处理数据...
            }
        }
        iter.remove();
    }
}
```

这是 Selector 多路复用的最小演示，省略了异常处理、SelectionKey 有效性检查、对端关闭清理，以及 TCP 字节流的粘包拆包处理。非阻塞 `read()` 返回 0 表示当前没有数据可读，不等于对端关闭；返回 -1 才表示对端已关闭。TCP 不保证一次 `read()` 就返回一条完整业务消息，真实实现还需要协议拆包和业务缓冲区管理，不应把这段代码直接用于生产。

### 1.3 TCP 参数调优

以下是 Linux 内核参数示例，不是通用生产配置。修改前应记录当前值、确认内核版本和网络环境，并通过队列溢出、重传、延迟及资源指标验证效果，不要为追求更高并发一次性套用全部参数。调大缓冲区上限也不意味着所有连接都会立即占用相同大小的内存。

```bash
# ====== 内核网络参数调优（/etc/sysctl.conf） ======

# --- 连接管理 ---
net.core.somaxconn = 65535           # 监听 socket 的 accept 队列上限
net.ipv4.tcp_max_syn_backlog = 65535 # 未完成握手的 SYN 请求队列参数
net.core.netdev_max_backlog = 65535  # 网卡接收队列大小

# --- 缓冲区 ---
net.core.rmem_max = 16777216         # Socket 接收缓冲区最大值
net.core.wmem_max = 16777216         # Socket 发送缓冲区最大值
net.ipv4.tcp_rmem = 4096 87380 16777216  # TCP 接收缓冲区 (min default max)
net.ipv4.tcp_wmem = 4096 65536 16777216  # TCP 发送缓冲区 (min default max)

# --- TIME-WAIT ---
net.ipv4.tcp_tw_reuse = 1            # 允许复用 TIME-WAIT
net.ipv4.tcp_fin_timeout = 30        # FIN-WAIT-2 超时时间
net.ipv4.tcp_max_tw_buckets = 65535  # TIME-WAIT 最大数量

# --- KeepAlive ---
net.ipv4.tcp_keepalive_time = 60
net.ipv4.tcp_keepalive_intvl = 10
net.ipv4.tcp_keepalive_probes = 3

# --- 拥塞控制 ---
net.ipv4.tcp_congestion_control = bbr  # 使用 BBR 拥塞算法
net.core.default_qdisc = fq           # BBR 配套的队列调度
```

```java
// Java 应用层面的 Socket 参数设置（监听端）
ServerSocketChannel serverChannel = ServerSocketChannel.open();
serverChannel.setOption(StandardSocketOptions.SO_REUSEADDR, true);
serverChannel.setOption(StandardSocketOptions.SO_RCVBUF, 256 * 1024);

// backlog 是 bind() 的参数，不是 StandardSocketOptions 的成员
serverChannel.bind(new InetSocketAddress(8080), 1024);

// 已接受连接的参数（在 accept() 拿到非空的 SocketChannel 后设置）
SocketChannel clientChannel = serverChannel.accept();
clientChannel.setOption(StandardSocketOptions.TCP_NODELAY, true);    // 禁用 Nagle
clientChannel.setOption(StandardSocketOptions.SO_KEEPALIVE, true);
clientChannel.setOption(StandardSocketOptions.SO_SNDBUF, 256 * 1024);
clientChannel.setOption(StandardSocketOptions.SO_RCVBUF, 256 * 1024);
```

### 1.4 KeepAlive 与连接复用

这里涉及三个不同机制：HTTP 持久连接允许多个 HTTP 请求复用同一条连接；TCP keepalive 是操作系统对空闲 TCP 连接的探测；gRPC keepalive 是 gRPC 传输层的连接健康探测。三者机制不同，不要混为一谈。

```java
// HTTP 连接复用配置示例（OkHttp）
OkHttpClient client = new OkHttpClient.Builder()
        .connectionPool(new ConnectionPool(
                50,              // 最大空闲连接数
                5, TimeUnit.MINUTES  // 空闲连接存活时间
        ))
        .protocols(Arrays.asList(Protocol.HTTP_2, Protocol.HTTP_1_1))
        .build();

// gRPC 连接管理
ManagedChannel channel = ManagedChannelBuilder
        .forAddress("service.example.com", 443)
        .keepAliveTime(30, TimeUnit.SECONDS)      // 30s 发一次 keepalive
        .keepAliveTimeout(10, TimeUnit.SECONDS)   // 10s 未响应则断开
        .maxInboundMessageSize(4 * 1024 * 1024)   // 最大入站消息 4MB
        .useTransportSecurity()
        .build();
```

`keepAliveTime` 表示配置的探测时间间隔，不等于对端一定允许该频率的探测。应根据 gRPC 客户端与服务端的 keepalive 策略配置，避免过于频繁的探测导致服务端拒绝连接或增加无效流量。OkHttp 的 `ConnectionPool(50, ...)` 中 50 是最大空闲连接数，不是最大总连接数，也不是并发请求的硬上限。

### 1.5 限流与熔断

高并发场景下，网络调用必须有保护机制。示例中的 `java.net.http.HttpClient` 自 JDK 11 起提供，不适用于 JDK 8；Resilience4j 的 API 与依赖版本相关，需按所用版本核对。`timeoutDuration` 是限流器获取许可时的等待上限，`HttpRequest.timeout(3s)` 是单次请求超时，两者都不是整个远程调用的总超时。

```java
// 基于 Resilience4j 的熔断 + 限流配置
// 注意：单独定义 Config Bean 不会自动应用到 registry 创建的实例，
// 需通过 registry.of(name, config) 创建实例，或用 Spring Boot 的
// resilience4j.circuitbreaker.instances.<name>.* 配置绑定
@Configuration
public class ResilienceConfig {

    @Bean
    public CircuitBreakerConfig circuitBreakerConfig() {
        return CircuitBreakerConfig.custom()
                .failureRateThreshold(50)           // 失败率 50% 触发熔断
                .waitDurationInOpenState(Duration.ofSeconds(30))
                .slidingWindowSize(100)              // 统计窗口 100 次调用
                .minimumNumberOfCalls(10)            // 至少 10 次才计算失败率
                .build();
    }

    @Bean
    public RateLimiterConfig rateLimiterConfig() {
        return RateLimiterConfig.custom()
                .limitForPeriod(100)                 // 每秒最多 100 次
                .limitRefreshPeriod(Duration.ofSeconds(1))
                .timeoutDuration(Duration.ofMillis(500)) // 等待超时
                .build();
    }
}

// 使用示例
@Service
public class ExternalApiService {

    private final CircuitBreaker cb;
    private final RateLimiter rateLimiter;
    private final HttpClient httpClient;

    public ExternalApiService(CircuitBreakerRegistry cbRegistry,
                              RateLimiterRegistry rlRegistry,
                              HttpClient httpClient) {
        this.cb = cbRegistry.circuitBreaker("externalApi");
        this.rateLimiter = rlRegistry.rateLimiter("externalApi");
        this.httpClient = httpClient;
    }

    public String callApi(String url) {
        Supplier<String> supplier = () -> {
            HttpRequest request = HttpRequest.newBuilder()
                    .uri(URI.create(url))
                    .timeout(Duration.ofSeconds(3))
                    .build();
            try {
                return httpClient.send(request, HttpResponse.BodyHandlers.ofString())
                        .body();
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                throw new RuntimeException("HTTP 调用被中断", e);
            } catch (IOException e) {
                throw new RuntimeException("HTTP 调用失败", e);
            }
        };

        // 限流 → 熔断 → 实际调用
        Supplier<String> decorated = RateLimiter.decorateSupplier(rateLimiter,
                CircuitBreaker.decorateSupplier(cb, supplier));

        return Try.ofSupplier(decorated)
                .recover(CallNotPermittedException.class, e -> "服务熔断中")
                .recover(RequestNotPermitted.class, e -> "请求被限流")
                .recover(RuntimeException.class, e -> "调用失败: " + e.getMessage())
                .get();
    }
}
```

这里的 `recover` 把调用失败统一转换成字符串，是教学简化写法。生产代码应采用明确的错误类型或结果类型，让调用方能区分真实业务结果和失败结果，不能把「服务熔断中」当作成功业务数据返回。

**限流与熔断的关系：**

```txt
┌─────────────────────────────────────────────────────────┐
│                   流量保护层次                            │
│                                                         │
│  请求 → ┌─────────┐ → ┌─────────┐ → ┌─────────┐ → 实际 │
│         │  限流    │   │  熔断    │   │  超时    │   调用 │
│         │RateLimit│   │ Circuit │   │Timeout  │        │
│         └────┬────┘   └────┬────┘   └────┬────┘        │
│              │             │             │              │
│         超过阈值直接    失败率过高      响应太慢        │
│         返回拒绝       打开开关,      中断等待         │
│                      快速失败                        │
│                                                         │
│  限流: 保护自己不被过多请求压垮                          │
│  熔断: 保护自己不被下游故障拖垮                          │
│  超时: 保护自己不被慢响应阻塞                            │
└─────────────────────────────────────────────────────────┘
```

## 2. 最佳实践总结

### 2.1 网络编程检查清单

| 类别 | 检查项 | 说明 |
| :-- | :-- | :-- |
| 连接管理 | 所有连接都有关闭逻辑 | try-with-resources / finally |
| 连接管理 | 使用连接池，避免频繁建连 | 连接池大小合理配置 |
| 连接管理 | 设置合理的超时时间 | connect timeout / read timeout |
| 连接管理 | 处理连接泄漏 | 监控 CLOSE-WAIT 数量 |
| 异常处理 | 区分瞬时故障和永久故障 | 瞬时重试，永久报错 |
| 异常处理 | 实现指数退避重试 | 避免雪崩效应 |
| 异常处理 | 记录足够的诊断信息 | 远程地址、端口、耗时 |
| 性能优化 | 启用 TCP_NODELAY（低延迟场景） | 禁用 Nagle 算法 |
| 性能优化 | 合适的缓冲区大小 | 避免过大浪费内存，过小影响吞吐 |
| 性能优化 | 监控连接池/线程池使用率 | 提前预警资源耗尽 |
| 安全 | 对外 HTTP/WS 使用 TLS | 生产环境通常应使用 HTTPS/WSS |
| 安全 | RPC/自定义 TCP 协议 | 按协议能力配置 TLS 等传输安全机制 |
| 安全 | 验证对端身份与证书 | 避免 MITM 攻击 |

### 2.2 常见陷阱与解决方案

下面每个陷阱都是独立的代码片段，不要直接拼进同一个方法。真实项目还应根据 HTTP 客户端版本核对 API 归属。

```java
// ❌ 陷阱 1: 没有设置超时 → 线程永久阻塞
URL url = new URL("http://slow-service/api");
HttpURLConnection conn = (HttpURLConnection) url.openConnection();
// conn.getInputStream() 可能永远不返回

// ✅ 正确做法
HttpURLConnection conn = (HttpURLConnection) url.openConnection();
conn.setConnectTimeout(3000);   // 连接超时 3s
conn.setReadTimeout(5000);      // 读超时 5s


// ❌ 陷阱 2: 忘记读取响应体 → 连接可能无法复用
HttpResponse response = client.execute(request);
int statusCode = response.getStatusLine().getStatusCode();
// 只看了状态码，没读 body，响应处理未完成，连接可能无法立即复用

// ✅ 正确做法: 确保响应被读取或关闭（Apache HttpClient 4.x）
try (CloseableHttpResponse response = client.execute(request)) {
    int statusCode = response.getStatusLine().getStatusCode();
    EntityUtils.consume(response.getEntity()); // 消费/丢弃响应体
}
// 连接能否复用取决于响应实体的消费或关闭方式、连接状态以及协议实现


// ❌ 陷阱 3: 只读响应流却忘记断开连接
HttpURLConnection conn =
        (HttpURLConnection) new URL("https://example.com").openConnection();
conn.setConnectTimeout(3000);
conn.setReadTimeout(5000);
// URL.openConnection() 返回连接对象，通常此时还未建立底层 TCP 连接

// ✅ 正确做法: 正确关闭响应流，并在生命周期结束时断开连接
try (InputStream in = conn.getInputStream()) {
    byte[] buffer = new byte[4096];
    while (in.read(buffer) != -1) {
        // 处理响应数据
    }
} finally {
    conn.disconnect();
}
// try-with-resources 管理的是响应流；HttpURLConnection 没有实现 AutoCloseable，
// 不能由 try-with-resources 直接关闭


// ❌ 陷阱 4: DNS 缓存导致故障期间无法切换
// Java 的 DNS 缓存默认值随 JDK 版本和 Security Manager 状态变化，不能假定为永久缓存

// ✅ 正确做法: 通过安全属性设置 DNS 缓存时间
// networkaddress.cache.ttl / networkaddress.cache.negative.ttl 是 Java 安全属性，
// 不要假设 -Dnetworkaddress.cache.ttl 这种系统属性写法一定生效
java.security.Security.setProperty("networkaddress.cache.ttl", "60");
java.security.Security.setProperty("networkaddress.cache.negative.ttl", "10");
// 属性应在 DNS 解析发生前设置；应用启动后修改不代表已有缓存立即失效
// 生产环境应验证实际生效的缓存策略，并确认 DNS 客户端、代理是否有独立缓存
```

### 2.3 监控指标体系

一个完善的网络监控应覆盖以下指标：

```txt
┌─────────────────────────────────────────────────────────┐
│                 网络监控指标体系                          │
│                                                         │
│  ┌─────────────────────────────────────────────────┐    │
│  │  基础层指标                                      │    │
│  │  - TCP 连接数（ESTABLISHED / TIME-WAIT / CLOSE-WAIT）│
│  │  - 网卡流量（入/出）                              │    │
│  │  - TCP 重传率                                    │    │
│  │  - 网络延迟（RTT）                               │    │
│  └─────────────────────────────────────────────────┘    │
│                                                         │
│  ┌─────────────────────────────────────────────────┐    │
│  │  应用层指标                                      │    │
│  │  - HTTP 请求延迟（P50 / P99 / P99.9）           │    │
│  │  - 连接池使用率（活跃 / 空闲 / 最大）             │    │
│  │  - 请求成功率 / 失败率                            │    │
│  │  - 超时次数 / 重试次数                            │    │
│  │  - 熔断器状态（关闭 / 打开 / 半开）               │    │
│  └─────────────────────────────────────────────────┘    │
│                                                         │
│  ┌─────────────────────────────────────────────────┐    │
│  │  JVM 层指标                                      │    │
│  │  - 线程数（RUNNABLE / BLOCKED / WAITING）        │    │
│  │  - GC 暂停时间（影响网络超时判定）                │    │
│  │  - 堆内存使用（影响缓冲区分配）                   │    │
│  │  - 文件描述符使用量                               │    │
│  └─────────────────────────────────────────────────┘    │
│                                                         │
│  告警阈值示例（需按业务基线校准）：                        │
│  - CLOSE-WAIT 持续增长 → 关注连接关闭路径                 │
│  - TIME-WAIT 异常增长 → 关注短连接和端口容量              │
│  - 连接池使用率持续偏高 → 关注池容量和慢请求              │
│  - P99 延迟接近业务超时预算 → 关注应用和网络链路           │
│  - TCP 重传率显著高于基线 → 关注网络质量                  │
└─────────────────────────────────────────────────────────┘
```

> **本章与其他章节的联系：**
>
> 本章的参数和配置示例不能代替性能诊断。遇到请求延迟上升或连接资源耗尽时，应先使用 [网络性能分析与故障排查](../06-diagnostics/03-network/chapter-01-network-diagnostics.md) 定位问题，再回到连接池、线程模型和 TCP 参数中寻找对应的调整点。连接池与线程池的监控和调优与 [Java 并发问题诊断](../06-diagnostics/02-concurrency/chapter-01-concurrency-diagnostics.md) 中的资源管理相关。跨机房通信还需要结合链路 RTT、丢包和带宽时延积评估 TCP 参数，不能直接套用单机房配置。
