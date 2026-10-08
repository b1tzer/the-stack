# 网络诊断：高并发优化与最佳实践

> 本页与 [网络性能分析与故障排查](./chapter-01-network-diagnostics.md) 配套，重点说明高并发网络优化、连接参数和诊断实践。

## 1. 高并发网络优化

### 1.1 连接池优化

连接池是高并发网络调用的基础设施。配置不当会导致连接耗尽或性能低下。

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
    log.info("连接池状态: 活跃={}, 空闲={}, 最大={}",
            stats.getAvailable(), stats.getLeased(), stats.getMax());
    // 活跃连接数持续接近最大值 → 连接池可能不够用
    // 空闲连接数持续为 0 → 连接全部被占用，新请求在排队
}
```

### 1.2 NIO vs BIO 选择

| 特性 | BIO（阻塞 I/O） | NIO（非阻塞 I/O） | AIO（异步 I/O） |
| :-- | :-- | :-- | :-- |
| 线程模型 | 1 连接 = 1 线程 | 1 线程管理多连接 | 回调通知 |
| 阻塞点 | read/write 阻塞 | Selector 轮询 | 无阻塞 |
| 适用场景 | 连接数少，每个连接数据量大 | 连接数多，每个连接数据量小 | 极端高并发 |
| 复杂度 | 低 | 中 | 高 |
| Java 生态 | Tomcat BIO | Netty / Tomcat NIO | 不成熟，少用 |

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
            // 新连接接入
            SocketChannel client = serverChannel.accept();
            client.configureBlocking(false);
            client.register(selector, SelectionKey.OP_READ);
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

### 1.3 TCP 参数调优

```bash
# ====== 内核网络参数调优（/etc/sysctl.conf） ======

# --- 连接管理 ---
net.core.somaxconn = 65535           # SYN 队列 + Accept 队列最大长度
net.ipv4.tcp_max_syn_backlog = 65535 # SYN 半连接队列大小
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
// Java 应用层面的 Socket 参数设置
ServerSocketChannel serverChannel = ServerSocketChannel.open();
serverChannel.setOption(StandardSocketOptions.SO_REUSEADDR, true);
serverChannel.setOption(StandardSocketOptions.SO_RCVBUF, 256 * 1024);
serverChannel.setOption(StandardSocketOptions.SO_BACKLOG, 1024);

SocketChannel clientChannel = serverChannel.accept();
clientChannel.setOption(StandardSocketOptions.TCP_NODELAY, true);    // 禁用 Nagle
clientChannel.setOption(StandardSocketOptions.SO_KEEPALIVE, true);
clientChannel.setOption(StandardSocketOptions.SO_SNDBUF, 256 * 1024);
clientChannel.setOption(StandardSocketOptions.SO_RCVBUF, 256 * 1024);
```

### 1.4 KeepAlive 与连接复用

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

### 1.5 限流与熔断

高并发场景下，网络调用必须有保护机制：

```java
// 基于 Resilience4j 的熔断 + 限流配置
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
            } catch (Exception e) {
                throw new RuntimeException(e);
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
| 安全 | 使用 TLS 加密 | 生产环境必须 HTTPS/WSS |
| 安全 | 验证服务端证书 | 避免 MITM 攻击 |

### 2.2 常见陷阱与解决方案

```java
// ❌ 陷阱 1: 没有设置超时 → 线程永久阻塞
URL url = new URL("http://slow-service/api");
HttpURLConnection conn = (HttpURLConnection) url.openConnection();
// conn.getInputStream() 可能永远不返回

// ✅ 正确做法
HttpURLConnection conn = (HttpURLConnection) url.openConnection();
conn.setConnectTimeout(3000);   // 连接超时 3s
conn.setReadTimeout(5000);      // 读超时 5s


// ❌ 陷阱 2: 忘记读取响应体 → 连接无法归还池
HttpResponse response = client.execute(request);
int statusCode = response.getStatusLine().getStatusCode();
// 只看了状态码，没读 body，连接一直被占用

// ✅ 正确做法: 确保响应体被读取或关闭
try (CloseableHttpResponse response = client.execute(request)) {
    int statusCode = response.getStatusLine().getStatusCode();
    EntityUtils.consume(response.getEntity()); // 消费/丢弃响应体
}


// ❌ 陷阱 3: 在 finally 中创建新连接去关闭 → 又泄漏一个
public void doRequest() {
    HttpURLConnection conn = null;
    try {
        conn = (HttpURLConnection) new URL("http://service/api").openConnection();
        // ...
    } finally {
        if (conn != null) {
            conn.disconnect();
        }
    }
}
// 如果 openConnection() 本身抛异常，conn 为 null 但可能底层连接已创建

// ✅ 正确做法: 使用 try-with-resources
try (InputStream is = conn.getInputStream()) {
    // 读取数据
} // 自动关闭


// ❌ 陷阱 4: DNS 缓存导致故障期间无法切换
// Java 的 DNS 缓存默认值随 JDK 版本和 Security Manager 状态变化，不能假定为永久缓存

// ✅ 正确做法: 设置合理的 DNS 缓存时间
// 方式一: JVM 参数
// -Dnetworkaddress.cache.ttl=60       # 成功解析缓存 60s
// -Dnetworkaddress.cache.negative.ttl=10  # 失败缓存 10s

// 方式二: 代码设置
java.security.Security.setProperty("networkaddress.cache.ttl", "60");
java.security.Security.setProperty("networkaddress.cache.negative.ttl", "10");
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
│  │  - HTTP 请求延迟（P50 / P99 / P999）             │    │
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
> - **纵向（本卷内）：** 第 1-4 章介绍了 Java 网络编程的基础（Socket、NIO、HTTP），本章的诊断和优化技术是对这些基础知识的实践运用。第 5-6 章的 HTTP/HTTPS 调优、第 7-8 章的 RPC 性能优化、第 9 章的长连接保活，都需要本章的排查能力作为支撑。
>
> - **横向（跨专题）：** 本章涉及的连接池、线程池监控与 [Java 并发诊断](../02-concurrency/chapter-01-concurrency-diagnostics.md)中的线程管理和资源调优直接相关；Arthas 诊断工具在 Java 各专题中都可使用；TCP 参数调优和拥塞控制的知识也适用于跨机房通信场景。限流熔断机制则是构建高可用分布式系统的通用基础设施。
