# 高可用设计

> 系统能用 ≠ 系统好用。当你的服务每秒处理十万请求时，一次 10 秒的故障意味着什么？本章从可用性的量化定义出发，逐步拆解单点消除、冗余设计、故障隔离与优雅降级，让你理解"高可用"不是一句口号，而是一套可计算、可验证、可演练的工程体系。

## 1. 可用性量化

### 1.1 从"几个 9"说起

可用性（Availability）通常用"几个 9"来衡量。公式很简单：

$$
\text{可用性} = \frac{\text{正常运行时间}}{\text{总时间}} \times 100\%
$$

但不同等级的"9"，对应的年不可用时间差距是惊人的：

| 可用性等级 | 年不可用时间 | 月不可用时间 | 典型场景 |
| :-- | :-- | :-- | :-- |
| 99%（2 个 9） | 3 天 15 小时 36 分 | 7 小时 18 分 | 内部管理系统 |
| 99.9%（3 个 9） | 8 小时 45 分 36 秒 | 43 分 48 秒 | 普通商业应用 |
| 99.99%（4 个 9） | 52 分 33 秒 | 4 分 22 秒 | 电商平台、支付系统 |
| 99.999%（5 个 9） | 5 分 15 秒 | 26 秒 | 电信核心网、金融交易 |

```txt
99%  ████████████████████████████████████████░░░░░░░░░░  → 年停 3.65 天
99.9% █████████████████████████████████████████████░░░░  → 年停 8.76 小时
99.99% ████████████████████████████████████████████████░  → 年停 52.6 分钟
99.999% ██████████████████████████████████████████████████ → 年停 5.26 分钟
```

### 1.2 计算公式：串联与并联

一个请求经过多个组件时，整体可用性是各组件可用性的**乘积**（串联模型）：

```txt
整体可用性 = A₁ × A₂ × A₃ × ... × Aₙ
```

例如：前端（99.9%）→ 网关（99.95%）→ 应用（99.9%）→ 数据库（99.9%）

```txt
整体 = 0.999 × 0.9995 × 0.999 × 0.999 ≈ 99.65%
```

这就是为什么**单点越少、链路越短、可用性越高**。

并联（冗余）模型下，两个独立组件同时故障的概率是乘积：

```txt
并联可用性 = 1 - (1 - A₁) × (1 - A₂)
```

例如两个 99.9% 的节点并联：

```txt
可用性 = 1 - 0.001 × 0.001 = 99.9999%（6 个 9！）
```

这就是冗余的力量。

### 1.3 可用性 ≠ 可靠性

| 维度 | 可用性（Availability） | 可靠性（Reliability） |
| :-- | :-- | :-- |
| 定义 | 任意时刻能否正常响应 | 持续无故障运行的能力 |
| 衡量指标 | SLA（几个 9） | MTBF（平均故障间隔） |
| 关注点 | 服务在不在 | 服务稳不稳 |
| 故障处理 | 快速恢复即可 | 需要根因分析、防止复发 |

高可用系统允许偶尔出问题，但要求**恢复速度极快**（MTTR 越小越好）：

$$
\text{可用性} = \frac{\text{MTBF}}{\text{MTBF} + \text{MTTR}}
$$

## 2. 消除单点故障

### 2.1 什么是单点

> **判断标准：这个组件挂了，系统是否整体不可用？如果是，它就是单点。**

单点故障（Single Point of Failure, SPOF）可能存在于系统的任何层次：

![ha-degradation](/java/ha-degradation.svg)

### 2.2 逐层消除单点

| 层次 | 单点风险 | 消除方案 |
| :-- | :-- | :-- |
| DNS | 单一 DNS 服务商 | 多 DNS 服务商 + GSLB |
| 接入层 | 单台 LB | LVS + Keepalived 双主 / 云 SLB |
| 应用层 | 单实例部署 | 多实例 + 注册中心（Nacos/Consul） |
| 缓存层 | 单 Redis 节点 | Redis Sentinel / Cluster |
| 数据库 | 单主库 | 主从复制 + 自动切换（MHA/Orchestrator） |
| 消息队列 | 单 Broker | Kafka 多副本 / RocketMQ 主从同步 |
| 存储 | 单磁盘/单机器 | 分布式存储（Ceph/HDFS） |

### 2.3 关键设计原则

1. **无状态服务优先**：应用层不存储会话状态，天然无单点
2. **有状态服务需复制**：数据库、缓存等必须有多副本
3. **故障自动转移**：人工切换太慢，必须自动化（Failover）
4. **定期演练**：不演练的高可用方案 = 没有方案

```yaml
spring:
  datasource:
    master:
      url: jdbc:mysql://master:3306/order_db
      username: root
      password: root
    slave:
      url: jdbc:mysql://slave:3306/order_db
      username: root
      password: root
```

```java
public class RoutingDataSource extends AbstractRoutingDataSource {

    @Override
    protected Object determineCurrentLookupKey() {
        return DataSourceContextHolder.get();
    }
}

public class DataSourceContextHolder {

    private static final ThreadLocal<String> HOLDER = new ThreadLocal<>();

    public static void setRead() {
        HOLDER.set("master");
    }

    public static void setReadOnly() {
        HOLDER.set("slave");
    }

    public static String get() {
        return HOLDER.get();
    }

    public static void clear() {
        HOLDER.remove();
    }
}
```

> 多数据源落地见 [Spring 多数据源](../../spring/04-data-access/chapter-06-multi-datasource)。

## 3. 冗余设计

### 3.1 主备模式（Active-Standby）

最简单的冗余：一个干活，一个待命。

```txt
         ┌───────────┐
         │  VIP/探活  │
         └─────┬─────┘
        ┌──────┴──────┐
   ┌────┴────┐   ┌────┴────┐
   │ Master  │   │ Standby │
   │ (Active)│   │ (Passive)│
   └────┬────┘   └────┬────┘
        │             │
   ┌────┴─────────────┴────┐
   │     共享存储 / 数据复制  │
   └────────────────────────┘
```

**优点**：简单，资源浪费（备机通常闲置）
**缺点**：切换有短暂中断，备机可能数据滞后

| 主备类型 | 数据同步方式 | 切换时间 | 数据丢失风险 |
| :-- | :-- | :-- | :-- |
| 冷备 | 定期备份 | 分钟级 | 取决于备份频率 |
| 温备 | 异步复制 | 秒级 | 可能丢失少量数据 |
| 热备 | 同步复制 | 毫秒级 | 零丢失（RPO=0） |

### 3.2 集群模式（Active-Active）

多个节点同时提供服务，通过负载均衡分发请求。

```java
@Bean
@LoadBalanced
public RestTemplate restTemplate() {
    return new RestTemplate();
}

// 调用时只需指定服务名，负载均衡器自动选择实例
@Service
public class OrderService {

    private final RestTemplate restTemplate;

    public OrderService(RestTemplate restTemplate) {
        this.restTemplate = restTemplate;
    }

    public User getUser(Long userId) {
        return restTemplate.getForObject(
            "http://user-service/api/users/{id}", User.class, userId);
    }
}
```

> 服务集群与负载均衡落地见 [Spring 服务调用](../../spring/09-distributed/chapter-03-service-call)。

### 3.3 多副本一致性

副本越多，可用性越高，但一致性维护越复杂：

| 复制策略 | 原理 | 一致性 | 性能 | 适用场景 |
| :-- | :-- | :-- | :-- | :-- |
| 同步复制 | 所有副本写入成功才返回 | 强一致 | 慢 | 金融核心 |
| 半同步复制 | 多数副本写入即返回 | 较强 | 中 | MySQL Group Replication |
| 异步复制 | 主库写入即返回 | 最终一致 | 快 | 日志、非关键数据 |

## 4. 故障隔离

### 4.1 隔离的核心思想

> **一个服务出问题，不应该拖垮整个系统。**

故障隔离（Bulkhead Pattern，舱壁模式）的灵感来自轮船的水密隔舱——一个舱进水不会导致整船沉没。

![ha-degradation](/java/ha-degradation.svg)

### 4.2 服务级隔离

通过微服务拆分，将不同业务部署在独立的进程/容器中：

```yaml
# docker-compose.yml - 服务级隔离
services:
  order-service:
    image: order-service:1.0
    deploy:
      resources:
        limits:
          cpus: '2'
          memory: 2G
    restart: always

  payment-service:
    image: payment-service:1.0
    deploy:
      resources:
        limits:
          cpus: '1'
          memory: 1G
    restart: always

  inventory-service:
    image: inventory-service:1.0
    deploy:
      resources:
        limits:
          cpus: '1.5'
          memory: 1.5G
    restart: always
```

### 4.3 线程池隔离

在同一进程内，为不同服务调用分配独立线程池（Resilience4j 实现）：

```yaml
resilience4j:
  thread-pool-bulkhead:
    instances:
      orderService:
        core-thread-pool-size: 10
        max-thread-pool-size: 20
        queue-capacity: 100
        keep-alive-duration: 1m
      paymentService:
        core-thread-pool-size: 5
        max-thread-pool-size: 10
        queue-capacity: 50
```

```java
@ThreadPoolBulkhead(name = "orderService", fallbackMethod = "orderFallback")
public CompletableFuture<Order> createOrder(OrderRequest request) {
    return CompletableFuture.supplyAsync(() -> orderService.create(request));
}

private CompletableFuture<Order> orderFallback(OrderRequest request, Throwable t) {
    return CompletableFuture.completedFuture(Order.pending());
}
```

### 4.4 信号量隔离

比线程池隔离更轻量，不创建额外线程，适合高频调用：

```yaml
resilience4j:
  bulkhead:
    instances:
      inventoryService:
        max-concurrent-calls: 20
        max-wait-duration: 500ms
```

```java
@Bulkhead(name = "inventoryService", fallbackMethod = "inventoryFallback")
public InventoryVO checkInventory(Long productId) {
    return inventoryClient.getStock(productId);
}

private InventoryVO inventoryFallback(Long productId, Throwable t) {
    return InventoryVO.unavailable();
}
```

### 4.5 数据隔离

| 隔离维度 | 方案 | 说明 |
| :-- | :-- | :-- |
| 连接池隔离 | 每个服务独立 DataSource | 避免慢 SQL 耗尽连接池 |
| 数据库隔离 | 核心库与非核心库分开 | 订单库和日志库物理隔离 |
| 缓存隔离 | 热点 Key 独立 Redis 实例 | 避免大 Key 影响正常业务 |
| 消息队列隔离 | 不同业务使用独立 Topic/Group | 避免消费积压相互影响 |

## 5. 优雅降级

### 5.1 降级的本质

> **当系统压力过大时，主动放弃非核心功能，保障核心链路可用。**

降级不是"挂了"，而是"有策略地降低服务质量"：

```txt
正常状态：  用户浏览 → 推荐引擎 → 个性化推荐 → 精美 UI
                      ↓ 降级
降级状态：  用户浏览 → 推荐引擎(超时) → 热门商品兜底 → 简化 UI
```

### 5.2 三种降级策略

| 策略 | 触发条件 | 行为 | 示例 |
| :-- | :-- | :-- | :-- |
| **Fallback（兜底）** | 调用失败/异常 | 返回预设默认值 | 推荐服务不可用时返回热门榜单 |
| **熔断（Circuit Breaker）** | 错误率超过阈值 | 短时间内直接跳过调用 | 支付通道错误率 > 50%，自动切换备用通道 |
| **限流降级** | QPS 超过系统容量 | 拒绝多余请求 | 秒杀场景限制每秒 1000 请求 |

### 5.3 熔断器状态机

```txt
        失败率超过阈值
    ┌──────────────────────┐
    │                      ▼
┌───┴───┐  成功   ┌───────┐  超时后   ┌───────┐
│ CLOSED │──────→│  OPEN  │────────→│ HALF  │
│ (正常) │       │ (熔断) │         │ OPEN  │
└───┬───┘       └───────┘         └───┬───┘
    │                                  │
    │         失败率仍高                │ 探测成功
    │    ┌────────────────────────────┘
    │    ▼
    │  回到 OPEN
    └── 恢复正常 ←── 探测成功 → 回到 CLOSED
```

```yaml
resilience4j:
  circuitbreaker:
    instances:
      paymentService:
        failure-rate-threshold: 50          # 失败率 50% 触发熔断
        slow-call-duration-threshold: 2s    # 超过 2 秒算慢调用
        sliding-window-size: 20             # 统计最近 20 次调用
        wait-duration-in-open-state: 30s    # 熔断 30 秒后进入半开状态探测
        permitted-number-of-calls-in-half-open-state: 3
        automatic-transition-from-open-to-half-open-enabled: true
```

> 熔断器落地见 [Spring 熔断降级](../../spring/09-distributed/chapter-04-circuit-breaker)。

### 5.4 降级策略对比总览

| 维度 | Fallback | 熔断 | 限流 |
| :-- | :-- | :-- | :-- |
| 触发方式 | 调用失败时 | 错误率超阈值 | 流量超阈值 |
| 作用范围 | 单次调用 | 时间窗口内的所有调用 | 所有入口请求 |
| 返回内容 | 预设默认值 | 快速失败/备用逻辑 | 拒绝请求（429） |
| 恢复方式 | 下次调用自动重试 | 半开状态探测恢复 | 流量下降自动恢复 |
| 典型工具 | try-catch + 默认逻辑 | Resilience4j / Sentinel | Sentinel / Nginx limit_req |

### 5.5 优雅停机（Graceful Shutdown）

高可用系统讨论了"故障发生后如何恢复"，但有一个高频的"人为故障"常被忽略：**发布部署**。

**为什么发布会导致 5xx？** 滚动发布时，旧实例被 kill 的瞬间可能有数百个请求正在处理。如果直接 `kill -9`，这些请求全部失败。在高可用系统中，发布频率远高于故障频率——每次发布零 5xx，是高可用的"最后一公里"。

Spring Boot 的优雅停机配置：

```yaml
server:
  shutdown: graceful

spring:
  lifecycle:
    timeout-per-shutdown-phase: 30s
```

流程：收到 SIGTERM → 停止接收新请求 → 等待正在处理的请求完成（最多 30 秒）→ 强制关闭。Kubernetes 中配合 `preStop` hook 和 `terminationGracePeriodSeconds` 使用，确保负载均衡器先摘除实例再停机。

### 5.6 降级演练：Chaos Engineering

> **如果你从没演练过降级，那你的降级方案大概率是不能用的。**

```java
@Component
public class ChaosInterceptor implements HandlerInterceptor {

    private final Random random = new Random();

    @Override
    public boolean preHandle(HttpServletRequest request,
                             HttpServletResponse response,
                             Object handler) throws Exception {
        int r = random.nextInt(100);
        if (r < 10) {                    // 10% 概率注入 2 秒延迟
            Thread.sleep(2000);
        } else if (r < 15) {             // 5% 概率返回 503
            response.setStatus(503);
            response.getWriter().write("chaos: injected failure");
            return false;
        }
        return true;
    }
}
```

Netflix 的 Chaos Monkey、阿里集团的 MonkeyKing、美团的 FailFast 都是类似理念：**在生产环境中有计划地制造故障，验证系统的容错能力**。
