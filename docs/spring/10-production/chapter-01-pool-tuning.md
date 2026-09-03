# 连接池与容器调优

> 一个 Web 应用吞吐量的两个瓶颈，分别藏在「数据库连接池」和「内嵌容器线程池」里。两者共享同一套逻辑：池子太小，请求排队；池子太大，资源耗尽。

---

## 1. 两个池子，一个问法

请求进来后，先由 Tomcat 的工作线程接手，线程再向连接池借一条连接去查数据库：

```txt
请求 → Tomcat 工作线程（threads.max 个） → HikariCP 连接池（maximum-pool-size 条） → 数据库
```

两个池子任一个成为短板，吞吐量就被它卡住。调优前先问同一个问题：**这个池子的上限，够不够承载预期的并发？**

---

## 2. HikariCP 参数调优

Spring Boot 2.x 起默认连接池就是 HikariCP，配置前缀 `spring.datasource.hikari.*`。

### 2.1 核心参数

```yaml
# application-prod.yml
spring:
  datasource:
    url: jdbc:mysql://10.0.1.100:3306/order_db?useSSL=false&serverTimezone=Asia/Shanghai
    username: ${DB_USERNAME}
    password: ${DB_PASSWORD}
    hikari:
      # 核心参数
      maximum-pool-size: 20               # 最大连接数（不是越大越好）
      minimum-idle: 5                     # 最小空闲连接（建议 = maximum-pool-size / 4）
      connection-timeout: 3000            # 获取连接超时时间（ms）
      max-lifetime: 1800000               # 连接最大存活时间（30 分钟，必须 < MySQL wait_timeout）
      idle-timeout: 600000                # 空闲连接超时（10 分钟）
      keepalive-time: 300000              # 连接保活间隔（5 分钟）

      # 性能优化
      pool-name: OrderHikariPool          # 连接池名称（方便日志识别）
      auto-commit: true                   # 自动提交
      validation-timeout: 1000            # 连接验证超时
      leak-detection-threshold: 60000     # 连接泄漏检测阈值（60 秒未归还则告警）
```

**HikariCP 关键参数速查表：**

| 参数 | 默认值 | 推荐值 | 说明 |
| :-- | :-- | :-- | :-- |
| maximum-pool-size | 10 | 20 | 最大连接数 |
| minimum-idle | = maximum-pool-size | 5 | 最小空闲连接 |
| connection-timeout | 30000ms | 3000ms | 获取连接等待超时 |
| max-lifetime | 1800000ms | 1800000ms | 连接最大存活时间 |
| idle-timeout | 600000ms | 600000ms | 空闲连接回收时间 |
| leak-detection-threshold | 0（禁用） | 60000ms | 连接泄漏检测 |

### 2.2 maximum-pool-size 计算方法

不要拍脑袋设 100、200。两条依据，从粗到细：

**公式一（PostgreSQL 官方推荐）：**

```
maximum-pool-size = (CPU 核心数 * 2) + 有效磁盘数
```

对于 8 核 SSD 服务器：`(8 * 2) + 1 = 17`，一般设 **20** 左右。

**公式二（按并发算）：**

```
池大小 ≥ 同时访问数据库的线程数
并发连接数 = QPS × 平均响应时间（秒）
```

示例：QPS 500、SQL 平均 20ms，则同时在跑的 SQL 约 10 条，池设 20 就够。池过大不会提速，反而让数据库背上更多空闲连接的维护成本。

### 2.3 连接池耗尽排查

池耗尽时，线程在 `connection-timeout` 内拿不到连接，抛 `SQLTransientConnectionException`：

```txt
HikariPool-1 - Connection is not available, request timed out after 5000ms.
```

这通常不是「池太小」这么简单，更常见的根因是**连接泄漏**——借了连接没还。

### 2.4 连接池监控

```java
@Component
@Slf4j
public class HikariPoolMonitor {

    private final DataSource dataSource;

    public HikariPoolMonitor(DataSource dataSource) {
        this.dataSource = dataSource;
    }

    @Scheduled(fixedRate = 30000)  // 每 30 秒采集一次
    public void monitor() {
        if (dataSource instanceof HikariDataSource hikari) {
            HikariPoolMXBean pool = hikari.getHikariPoolMXBean();
            if (pool != null) {
                log.info("HikariCP Pool [{}] - Active: {}, Idle: {}, Waiting: {}, Total: {}",
                        hikari.getPoolName(),
                        pool.getActiveConnections(),
                        pool.getIdleConnections(),
                        pool.getThreadsAwaitingConnection(),
                        pool.getTotalConnections());
            }
        }
    }
}
```

**踩坑提醒：**
- `max-lifetime` 必须小于数据库的 `wait_timeout`（MySQL 默认 8 小时），否则数据库端已关闭连接，HikariCP 还在使用，导致 `Communications link failure`
- `minimum-idle` 和 `maximum-pool-size` 设成一样可以避免连接数频繁伸缩（高并发场景推荐）
- `connection-timeout` 不要设太长——获取不到连接时快速失败比让用户等 30 秒体验好得多

---

## 3. Tomcat 线程池调优

### 3.1 核心参数

```yaml
server:
  tomcat:
    threads:
      max: 200                        # 最大工作线程数（默认 200）
      min-spare: 10                   # 最小空闲线程（默认 10）
    accept-count: 100                 # 等待队列长度
    max-connections: 10000            # 最大连接数（NIO 默认 10000）
    connection-timeout: 5000          # 连接超时（ms）

    # 访问日志
    accesslog:
      enabled: true
      directory: /var/log/app
      pattern: "%h %l %u %t \"%r\" %s %b %D"  # %D = 请求处理时间（ms）
      prefix: access
      suffix: .log
      rotate: true
      max-days: 30
```

| 参数 | 默认值 | 作用 |
| :-- | :-- | :-- |
| `threads.max` | 200 | 最大工作线程数，同时处理请求的上限 |
| `threads.min-spare` | 10 | 最小空闲线程，避免流量突增时现建线程 |
| `accept-count` | 100 | 连接队列长度，线程满了先进队列，队列也满才拒绝 |
| `max-connections` | 10000 | 最大连接数（含排队和已处理的），一般不用动 |

### 3.2 线程数计算模型（Little's Law）

```
最优线程数 = QPS × 平均响应时间（秒）

示例：QPS = 500，平均 RT = 200ms
最优线程数 = 500 × 0.2 = 100
```

如果 RT 主要来自 DB 查询：
- DB 连接数 = 20（HikariCP）
- 每个连接平均占用时间 = 50ms
- DB 瓶颈 QPS = 20 / 0.05 = 400
- 应用 QPS 不能超过 400，增加线程数没用

### 3.3 线程池与连接池配合

两个池子要一起看，否则调了白调：

- Tomcat `threads.max=200`，连接池 `maximum-pool-size=10`：200 个线程抢 10 条连接，绝大多数在排队等连接，连接池是瓶颈。
- 连接池 `maximum-pool-size=100`，Tomcat `threads.max=50`：最多 50 个线程并发，连接池用不满，线程是瓶颈。

经验法则：**连接池大小 ≤ 真正会访问数据库的线程数，而不是 ≤ Tomcat 全部线程数**。

```java
@Configuration
public class TomcatConfig {

    @Bean
    public WebServerFactoryCustomizer<TomcatServletWebServerFactory> tomcatCustomizer() {
        return factory -> {
            factory.addConnectorCustomizers(connector -> {
                ProtocolHandler handler = connector.getProtocolHandler();
                if (handler instanceof AbstractProtocol<?> protocol) {
                    protocol.setMaxThreads(200);
                    protocol.setMinSpareThreads(10);
                    protocol.setAcceptCount(100);
                    protocol.setConnectionTimeout(5000);
                }
            });
        };
    }
}
```

**踩坑提醒：**
- `threads.max` 不是越大越好——超过 200 个线程时，上下文切换成本可能超过并发收益
- `accept-count` 是 Tomcat 的"缓冲区"，满了之后新连接直接被拒绝（`Connection refused`）
- 如果你的服务是 **CPU 密集型**（如图片处理），线程数应该接近 CPU 核心数

---

## 4. 调优 Checklist

- [ ] `max-lifetime` 小于数据库 `wait_timeout`
- [ ] `maximum-pool-size` 按 `2*CPU+1` 起步，压测后调整
- [ ] `connection-timeout` 设一个能容忍的值（如 3~5s），不要用默认 30s 掩盖泄漏
- [ ] 确认连接池和 Tomcat 线程池谁才是瓶颈，避免只调一个
- [ ] 线上观察 `hikaricp_connections_active` 指标，贴近 `maximum-pool-size` 时就要扩容或优化 SQL
