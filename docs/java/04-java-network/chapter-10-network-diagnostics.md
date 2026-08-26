# 网络性能分析与故障排查

> 网络问题是后端开发中最棘手的一类故障——症状相似但根因各异，超时可能是网络不通、对端处理慢、连接池耗尽，也可能是 GC 停顿。本章要回答的核心问题：常见网络异常分别意味着什么？如何用抓包和诊断工具定位根因？Java 应用有哪些特有的网络陷阱？高并发场景下如何系统性地优化网络性能？

## 1. 常见网络问题速查

### 1.1 异常类型与根因对照表

| 错误现象 | 含义 | 常见根因 | 排查方向 |
|----------|------|----------|----------|
| `ConnectException: Connection refused` | 目标端口没有进程监听 | 服务未启动 / 端口配错 / 防火墙 DROP | 检查服务状态、端口、iptables |
| `SocketTimeoutException: connect timed out` | 连接建立超时 | 网络不可达 / 防火墙静默丢包 / SYN 队列满 | ping / telnet / ss -s |
| `SocketTimeoutException: read timed out` | 读数据超时 | 对端处理慢 / 网络拥塞 / 对端 GC | 抓包分析 RTT / 查对端日志 |
| `Connection reset by peer` | 对端强制关闭连接（RST） | 对端进程崩溃 / 负载均衡器超时 / 半开连接 | 查对端状态 / 抓包看 RST |
| `Broken pipe` | 写入已关闭的 socket | 对端已关闭但本端不知道 | 检查连接复用逻辑 |
| `No route to host` | 路由不可达 | 路由配置错误 / 网络断开 | traceroute / ip route |
| `Address already in use` | 端口被占用（TIME-WAIT 堆积） | 短连接高频创建 | 调整 TIME-WAIT 参数 |

### 1.2 TCP 连接状态问题

TCP 连接状态是网络排查的第一手信息。两个最容易出问题的状态：

**TIME-WAIT 过多：**

```text
主动关闭方在发送最后一个 ACK 后进入 TIME-WAIT，等待 2MSL（通常 60s）。
高并发短连接场景下，大量 TIME-WAIT 会耗尽端口。

$ ss -s
TCP:   28469 (estab 1204, closed 25000, orphaned 0, timewait 24800)
                  ↑ closed 大部分是 TIME-WAIT

根因：HTTP 短连接、RPC 短连接频繁创建关闭
```

```bash
# 解决方案
# 1. 启用 TIME-WAIT 快速回收（Linux 内核参数）
net.ipv4.tcp_tw_reuse = 1          # 允许复用 TIME-WAIT 连接
net.ipv4.tcp_fin_timeout = 30      # 缩短 FIN-WAIT-2 超时

# 2. 连接池化（根本解决）
# 将短连接改为长连接 + 连接池，避免频繁建连/断连
```

**CLOSE-WAIT 过多：**

```text
被动关闭方收到 FIN 后进入 CLOSE-WAIT，等待应用层调用 close()。
如果 CLOSE-WAIT 堆积，说明应用代码有 bug —— 没有正确关闭连接。

$ ss -s
TCP:   500 (estab 200, closed 50, timewait 10, closewait 250)
                                                ↑ 异常！

根因：代码中 read() 返回 -1/EOF 后没有 close() 连接
```

```java
// 错误示例 —— 导致 CLOSE-WAIT
public void handleRequest(Socket socket) {
    try {
        InputStream in = socket.getInputStream();
        byte[] buf = new byte[1024];
        int n = in.read(buf);
        // 处理数据...
        // ❌ 忘记 close，连接进入 CLOSE-WAIT
    } catch (IOException e) {
        // ❌ 异常时也没 close
    }
}

// 正确示例 —— try-with-resources
public void handleRequest(Socket socket) {
    try (socket; // Java 9+ 支持
         InputStream in = socket.getInputStream()) {
        byte[] buf = new byte[1024];
        int n = in.read(buf);
        if (n == -1) return; // 对端关闭
        // 处理数据...
    } catch (IOException e) {
        // 连接自动关闭
    }
}
```

### 1.3 连接状态全景图

```text
                               主动打开
                                  │
                                  ↓
                            ┌───────────┐
                  ┌────────→│   CLOSED  │←────────┐
                  │         └─────┬─────┘         │
                  │               │               │
           四次挥手完成       主动打开/发送SYN    被动打开
                  │               ↓               │
                  │         ┌───────────┐         │
                  └─────────│ SYN_SENT  │         │
                            └─────┬─────┘         │
                       收到SYN+ACK│               │
                                  ↓               │
                            ┌───────────┐         │
                            │ESTABLISHED│←────────┘
                            └─────┬─────┘    收到SYN,发送SYN+ACK
                                  │
                    ┌─────────────┼─────────────┐
              主动关闭│             │         被动关闭│
              发送FIN │             │         收到FIN │
                    ↓             │             ↓
              ┌───────────┐       │       ┌───────────┐
              │ FIN_WAIT_1│       │       │CLOSE_WAIT │ ← 等待应用close()
              └─────┬─────┘       │       └─────┬─────┘
           收到ACK  │              │       发送FIN│
                    ↓              │             ↓
              ┌───────────┐       │       ┌───────────┐
              │ FIN_WAIT_2│       │       │ LAST_ACK  │
              └─────┬─────┘       │       └─────┬─────┘
           收到FIN  │              │        收到ACK│
                    ↓              │             ↓
              ┌───────────┐       │         (CLOSED)
              │ TIME_WAIT │       │
              └─────┬─────┘       │
           2MSL后   │              │
                    ↓              │
                  (CLOSED)─────────┘
```

## 2. 网络抓包分析

抓包是网络排查的终极手段。当日志和监控无法定位问题时，抓包能看到"线上到底发生了什么"。

### 2.1 tcpdump 常用命令

```bash
# 1. 抓取特定端口的 TCP 流量
tcpdump -i eth0 port 8080 -w /tmp/capture.pcap

# 2. 抓取特定源/目标 IP 的流量
tcpdump -i eth0 src 10.0.1.100 and dst port 3306

# 3. 只抓 SYN/FIN/RST 包（看连接建立/关闭）
tcpdump -i eth0 'tcp[tcpflags] & (tcp-syn|tcp-fin|tcp-rst) != 0'

# 4. 抓取 HTTP GET 请求
tcpdump -i eth0 -A 'tcp port 80 and tcp[((tcp[12:1] & 0xf0) >> 2):4] = 0x47455420'

# 5. 限制抓包数量
tcpdump -i eth0 port 8080 -c 1000

# 6. 实时查看（不写文件）
tcpdump -i eth0 port 8080 -nn -X

# 7. 抓取 DNS 查询
tcpdump -i eth0 port 53
```

**tcpdump 输出解读：**

```text
# 正常的 TCP 三次握手
22:01:01.100 IP 10.0.1.1.54321 > 10.0.1.2.8080: Flags [S], seq 1000
22:01:01.101 IP 10.0.1.2.8080 > 10.0.1.1.54321: Flags [S.], seq 2000, ack 1001
22:01:01.101 IP 10.0.1.1.54321 > 10.0.1.2.8080: Flags [.], ack 2001

# Flags 含义：
# [S]   = SYN（发起连接）
# [S.]  = SYN+ACK（接受连接）
# [.]   = ACK（确认）
# [P.]  = PSH+ACK（推送数据）
# [F.]  = FIN+ACK（关闭连接）
# [R]   = RST（强制重置）
```

### 2.2 Wireshark 分析技巧

当 tcpdump 保存了 pcap 文件后，可以用 Wireshark 做深度分析：

**常用过滤器：**

```text
# 按 IP 过滤
ip.addr == 10.0.1.100
ip.src == 10.0.1.100 && ip.dst == 10.0.1.200

# 按端口过滤
tcp.port == 8080
tcp.dstport == 3306

# 按 TCP 标志过滤
tcp.flags.syn == 1          # 只看 SYN
tcp.flags.rst == 1          # 只看 RST（异常重置）
tcp.flags.fin == 1          # 只看 FIN（关闭）

# 按 HTTP 过滤
http.request.method == "GET"
http.response.code >= 400

# 按序列号追踪特定流
tcp.stream eq 42

# 查找重传
tcp.analysis.retransmission

# 查找窗口为零（流控）
tcp.analysis.zero_window
```

**关键分析场景：**

| 场景 | Wireshark 过滤器/操作 | 说明 |
|------|----------------------|------|
| 连接慢 | 统计 → Conversations → 看 TCP 建连时间 | 对比 SYN→SYN+ACK 的时间差 |
| 数据丢失 | `tcp.analysis.retransmission` | 重传多说明网络丢包 |
| 服务端处理慢 | 追踪流，看 Request→Response 的时间差 | 排除网络因素后查服务端 |
| 连接被重置 | `tcp.flags.rst == 1` | 查看谁发的 RST |
| 流控停顿 | `tcp.analysis.zero_window` | 接收方缓冲区满 |

### 2.3 实战：排查超时问题

```bash
# 场景：Java 应用调用外部 API 超时
# Step 1: 在应用服务器上抓包
tcpdump -i eth0 host api.example.com and port 443 -w /tmp/api_timeout.pcap

# Step 2: 触发一次超时请求
curl -v --connect-timeout 5 --max-time 10 https://api.example.com/health

# Step 3: 用 Wireshark 打开分析
# 如果看到：
# - SYN 发出但没有 SYN+ACK → 网络不通或对端端口未监听
# - SYN+ACK 正常但后续数据包慢 → 对端处理慢
# - 大量 TCP 重传 → 网络质量差
# - RST 被发出 → 对端主动拒绝
```

## 3. Java 网络诊断

### 3.1 netstat / ss 命令

```bash
# 查看所有 TCP 连接状态统计
ss -s

# 查看特定端口的连接
ss -tnp | grep 8080

# 查看连接状态分布
ss -tn | awk '{print $1}' | sort | uniq -c | sort -rn

# 查看 ESTABLISHED 连接数（按远程 IP 统计）
ss -tn state established | awk '{print $5}' | cut -d: -f1 | sort | uniq -c | sort -rn

# 查看哪些进程在监听端口
ss -tlnp

# 查看 socket 缓冲区使用情况
ss -tmp

# 查看连接的拥塞窗口和 RTT
ss -tni
```

**输出解读：**

```text
$ ss -tni
State   Recv-Q  Send-Q  Local Address:Port  Peer Address:Port
ESTAB   0       0       10.0.1.1:8080       10.0.1.2:54321
         cubic wscale:7,7 rto:204 rtt:1.5/0.75 ato:40
         mss:1448 pmtu:1500 rcvmss:1448 advmss:1448
         cwnd:10 ssthresh:7 bytes_sent:1234 bytes_acked:1235

# 关键字段：
# rto:204     — 重传超时 204ms
# rtt:1.5/0.75 — RTT 1.5ms，抖动 0.75ms
# cwnd:10     — 拥塞窗口 10 个 MSS
# ssthresh:7  — 慢启动阈值 7
# Recv-Q      — 接收队列（> 0 说明应用读取慢）
# Send-Q      — 发送队列（> 0 说明网络发送慢）
```

### 3.2 jstack 分析线程状态

当 Java 应用网络请求卡住时，jstack 能看到线程在做什么：

```bash
# 找到 Java 进程 PID
jps -l

# 生成线程 dump
jstack -l <pid> > /tmp/thread_dump.txt

# 查找 BLOCKED / WAITING 的网络相关线程
grep -A 5 "BLOCKED\|WAITING\|TIMED_WAITING" /tmp/thread_dump.txt | grep -i "socket\|nio\|channel\|http"
```

**典型的网络相关线程栈：**

```text
# 1. 正常的 NIO 线程（Selector 等待事件）
"NIO-Selector-1" #15 daemon prio=5
   java.lang.Thread.State: RUNNABLE
        at sun.nio.ch.EPollArrayWrapper.epollWait(Native Method)
        at sun.nio.ch.EPollArrayWrapper.poll(EPollArrayWrapper.java:269)
        at sun.nio.ch.EPollSelectorImpl.doSelect(EPollSelectorImpl.java:93)

# 2. 阻塞在 socket read（可能是超时设置过长或对端无响应）
"http-nio-8080-exec-1" #20 daemon prio=5
   java.lang.Thread.State: RUNNABLE
        at java.net.SocketInputStream.socketRead0(Native Method)
        at java.net.SocketInputStream.socketRead(SocketInputStream.java:116)
        at java.net.SocketInputStream.read(SocketInputStream.java:171)

# 3. 等待连接池（连接耗尽！）
"http-nio-8080-exec-5" #24 daemon prio=5
   java.lang.Thread.State: TIMED_WAITING
        at java.lang.Object.wait(Native Method)
        at org.apache.commons.pool2.impl.GenericObjectPool.borrowObject(GenericObjectPool.java:449)

# 4. SSL 握手阻塞
"https-jsse-nio-8443-exec-1" #30 daemon prio=5
   java.lang.Thread.State: RUNNABLE
        at sun.security.ssl.SSLEngineImpl.wrap(SSLEngineImpl.java:122)
```

### 3.3 Arthas 在线诊断

Arthas 是阿里巴巴开源的 Java 诊断工具，无需重启应用即可在线排查问题：

```bash
# 启动 Arthas
java -jar arthas-boot.jar

# 1. 查看网络相关的线程
thread -n 5           # CPU 占用最高的 5 个线程
thread --state RUNNABLE  # 只看 RUNNABLE 状态的线程

# 2. 监控方法调用耗时（排查慢调用）
# watch 观察 HttpClient.execute 的返回值和耗时
watch org.apache.http.impl.client.CloseableHttpClient execute '{params, returnObj, #cost}' -x 3

# trace 追踪方法内部调用链耗时
trace org.apache.http.impl.client.CloseableHttpClient execute

# 3. 监控连接池状态
# 查看 Druid 连接池的活跃连接数
ognl '@com.alibaba.druid.stat.DruidStatManagerFacade@getInstance().getDataSourceStatDataList().{#this["ActiveCount"]}'

# 4. 查看 JVM 网络相关的系统属性
sysprop | grep -i "socket\|nio\|ssl\|timeout"

# 5. 反编译线上代码（确认是否有 bug）
jad com.example.MyHttpClient

# 6. 查看堆中的连接对象
vmtool --action getInstances \
  --className java.net.Socket \
  --express 'instances.{? #this.isConnected()}.size()'
```

**Arthas 诊断流程：**

```text
┌─────────────────────────────────────────────────────────┐
│               Arthas 网络问题诊断流程                     │
│                                                         │
│  Step 1: thread -n 5                                    │
│    → 找到 CPU 高的线程，看是否在网络 I/O                   │
│                                                         │
│  Step 2: thread --state TIMED_WAITING                   │
│    → 找到等待中的线程，看是否在等连接/响应                  │
│                                                         │
│  Step 3: watch / trace 慢方法                            │
│    → 定位具体哪个外部调用慢                               │
│                                                         │
│  Step 4: ognl 查看连接池/线程池状态                       │
│    → 确认是否资源耗尽                                    │
│                                                         │
│  Step 5: jad 反编译确认代码逻辑                          │
│    → 排除代码 bug（如忘记 close 连接）                    │
└─────────────────────────────────────────────────────────┘
```

## 4. 高并发网络优化

### 4.1 连接池优化

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

### 4.2 NIO vs BIO 选择

| 特性 | BIO（阻塞 I/O） | NIO（非阻塞 I/O） | AIO（异步 I/O） |
|------|-----------------|-------------------|-----------------|
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

### 4.3 TCP 参数调优

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

### 4.4 KeepAlive 与连接复用

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

### 4.5 限流与熔断

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

```text
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

## 5. 最佳实践总结

### 5.1 网络编程检查清单

| 类别 | 检查项 | 说明 |
|------|--------|------|
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

### 5.2 常见陷阱与解决方案

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
// Java 默认永久缓存 DNS（受 security 管理器影响）

// ✅ 正确做法: 设置合理的 DNS 缓存时间
// 方式一: JVM 参数
// -Dnetworkaddress.cache.ttl=60       # 成功解析缓存 60s
// -Dnetworkaddress.cache.negative.ttl=10  # 失败缓存 10s

// 方式二: 代码设置
java.security.Security.setProperty("networkaddress.cache.ttl", "60");
java.security.Security.setProperty("networkaddress.cache.negative.ttl", "10");
```

### 5.3 监控指标体系

一个完善的网络监控应覆盖以下指标：

```text
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
│  告警阈值建议：                                          │
│  - CLOSE-WAIT > 100 → 告警（可能有连接泄漏）            │
│  - TIME-WAIT > 10000 → 关注（可能需要优化连接池）       │
│  - 连接池使用率 > 80% → 告警                            │
│  - P99 延迟 > 超时时间的 50% → 告警                     │
│  - TCP 重传率 > 1% → 告警                               │
└─────────────────────────────────────────────────────────┘
```

> **本章与其他章节的联系：**
>
> - **纵向（本卷内）：** 第 1-4 章介绍了 Java 网络编程的基础（Socket、NIO、HTTP），本章的诊断和优化技术是对这些基础知识的实践运用。第 5-6 章的 HTTP/HTTPS 调优、第 7-8 章的 RPC 性能优化、第 9 章的长连接保活，都需要本章的排查能力作为支撑。
>
> - **横向（跨卷）：** 本章涉及的连接池、线程池监控与第二卷《Java 并发编程》中的线程管理和资源调优直接相关；Arthas 诊断工具在全卷各章中都可使用；TCP 参数调优和拥塞控制的知识也适用于第三卷《分布式架构》中的跨机房通信场景。限流熔断机制则是构建高可用分布式系统的通用基础设施。
