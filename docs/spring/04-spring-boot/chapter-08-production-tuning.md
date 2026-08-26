# 生产化配置：连接池与容器调优

> 一个 Web 应用吞吐量的两个瓶颈，分别藏在「数据库连接池」和「内嵌容器线程池」里。两者共享同一套逻辑：池子太小，请求排队；池子太大，资源耗尽。这一章讲清楚每个池子的关键参数怎么设。

## 1. 两个池子，一个问法

请求进来后，先由 Tomcat 的工作线程接手，线程再向连接池借一条连接去查数据库：

```text
请求 → Tomcat 工作线程（threads.max 个） → HikariCP 连接池（maximum-pool-size 条） → 数据库
```

两个池子任一个成为短板，吞吐量就被它卡住。调优前先问同一个问题：**这个池子的上限，够不够承载预期的并发？** 下面分别回答。

## 2. 连接池：HikariCP

Spring Boot 2.x 起默认连接池就是 HikariCP，配置前缀 `spring.datasource.hikari.*`。

### 2.1 核心参数

| 参数 | 默认值 | 作用 |
| :-- | :-- | :-- |
| `maximum-pool-size` | 10 | 池中最大连接数，吞吐量的硬上限 |
| `minimum-idle` | 等于 maximum-pool-size | 最小空闲连接，避免突发流量时现建连接 |
| `connection-timeout` | 30000ms | 拿不到连接的等待上限，超时抛异常 |
| `idle-timeout` | 600000ms | 空闲连接存活时间 |
| `max-lifetime` | 1800000ms | 连接最大生命周期，应小于数据库的 wait_timeout |

```yaml
spring:
  datasource:
    hikari:
      maximum-pool-size: 20
      minimum-idle: 10
      connection-timeout: 5000
      max-lifetime: 1500000
```

`max-lifetime` 要设得比数据库侧的 `wait_timeout` 小，否则连接在数据库那边已经被回收，池里还留着一条「死连接」，借出去才会报错。

### 2.2 maximum-pool-size 怎么算

不要拍脑袋设 100、200。两条依据，从粗到细：

1. **经验起点**：`2 * CPU 核数 + 1`。8 核机器，起步设 17，压测后再调。
2. **按并发算**：`池大小 ≥ 同时访问数据库的线程数`。Tomcat `threads.max` 是 200，但通常不是每个请求都查库，真正需要连接的线程数是「QPS × 单条 SQL 平均耗时」。

第二个公式的来源：`并发连接数 = QPS × 平均响应时间`。QPS 500、SQL 平均 20ms，则同时在跑的 SQL 约 10 条，池设 20 就够。池过大不会提速，反而让数据库背上更多空闲连接的维护成本。

### 2.3 连接池耗尽时长什么样

池耗尽时，线程在 `connection-timeout` 内拿不到连接，抛 `SQLTransientConnectionException`：

```text
HikariPool-1 - Connection is not available, request timed out after 5000ms.
```

这通常不是「池太小」这么简单，更常见的根因是**连接泄漏**——借了连接没还。排查路径见 [Actuator 监控](./chapter-04-actuator.md) 里的连接池耗尽案例。

## 3. 内嵌 Tomcat

配置前缀 `server.tomcat.*`，四个参数决定并发能力：

| 参数 | 默认值 | 作用 |
| :-- | :-- | :-- |
| `threads.max` | 200 | 最大工作线程数，同时处理请求的上限 |
| `threads.min-spare` | 10 | 最小空闲线程，避免流量突增时现建线程 |
| `accept-count` | 100 | 连接队列长度，线程满了先进队列，队列也满才拒绝 |
| `max-connections` | 8192 | 最大连接数（含排队和已处理的），一般不用动 |

```yaml
server:
  tomcat:
    threads:
      max: 300
      min-spare: 20
    accept-count: 200
```

线程不是越多越好：每个线程占 1MB 栈内存，200 线程就是 200MB。线程数远超 CPU 核数时，大部分时间花在上下文切换上，吞吐反而下降。

### 3.1 线程池和连接池怎么配合

两个池子要一起看，否则调了白调：

- Tomcat `threads.max=200`，连接池 `maximum-pool-size=10`：200 个线程抢 10 条连接，绝大多数在排队等连接，连接池是瓶颈。
- 连接池 `maximum-pool-size=100`，Tomcat `threads.max=50`：最多 50 个线程并发，连接池用不满，线程是瓶颈。

经验法则：**连接池大小 ≤ 真正会访问数据库的线程数，而不是 ≤ Tomcat 全部线程数**。先测出「数据库请求占比」，再据此定池大小。

## 4. 调优 checklist

- [ ] `max-lifetime` 小于数据库 `wait_timeout`
- [ ] `maximum-pool-size` 按 `2*CPU+1` 起步，压测后调整，不拍脑袋设大
- [ ] `connection-timeout` 设一个能容忍的值（如 3~5s），不要用默认 30s 掩盖泄漏
- [ ] 确认连接池和 Tomcat 线程池谁才是瓶颈，避免只调一个
- [ ] 线上观察 `hikaricp_connections_active` 指标，贴近 `maximum-pool-size` 时就要扩容或优化 SQL
