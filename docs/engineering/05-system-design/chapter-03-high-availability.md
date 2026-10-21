# 高可用设计

> 系统能用 ≠ 系统好用。当你的服务每秒处理十万请求时，一次 10 秒的故障意味着什么？本章从可用性的量化定义出发，分析单点消除、冗余设计、故障隔离与优雅降级。高可用不是一句口号，而是一套可计算、可验证、可演练的工程体系。

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

这个乘法成立有一个前提：各组件可用性按统一的服务判定口径计算，且故障相互独立。实际系统中这条前提经常被打破——两个应用实例可能共用同一个数据库、交换机或配置中心，即使实例自身故障相互独立，系统也可能因共享依赖同时不可用。

**单点越少、链路越短，可用性通常越高，但这不是无条件成立的结论**。减少串联依赖确实有利于提高可用性，同时还要考虑各依赖的可靠性、共同故障域与实际服务能力。

并联（冗余）模型下，两个独立组件同时故障的概率是乘积。这个公式同样有前提：两个节点故障相互独立，且任意一个存活即可提供合格服务。

```txt
并联可用性 = 1 - (1 - A₁) × (1 - A₂)
```

例如两个 99.9% 的节点并联：

```txt
可用性 = 1 - 0.001 × 0.001 = 99.9999%（6 个 9！）
```

这就是冗余的力量，但它只在独立性成立时兑现。一个反例：应用层部署了两个实例，可它们共用同一个单主数据库，那么数据库依然是系统级单点，应用实例的冗余并不能提高数据库的可用性。

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

这个公式适用于基于运行与修复时间统计的稳态可用性估算，前提是 MTBF 与 MTTR 的定义和统计口径一致。实际服务可用性还可能按请求成功率、SLO 时间窗口或业务探测结果统计，落地 SLA/SLO 时还需明确服务判定口径和统计窗口。

## 2. 消除单点故障

### 2.1 什么是单点

> **判断标准：这个组件挂了，系统是否整体不可用？如果是，它就是单点。**

单点故障（Single Point of Failure, SPOF）可能存在于系统的任何层次：

![ha-degradation](/java/ha-degradation.svg)

### 2.2 逐层消除单点

| 层次 | 单点风险 | 常见冗余方案 |
| :-- | :-- | :-- |
| DNS | 单一 DNS 服务商 | 多 DNS 服务商 + GSLB |
| 接入层 | 单台 LB | LVS + Keepalived 双主 / 云 SLB |
| 应用层 | 单实例部署 | 多实例 + 注册中心（Nacos/Consul） |
| 缓存层 | 单 Redis 节点 | Redis Sentinel / Cluster |
| 数据库 | 单主库 | 主从复制 + 自动切换（MHA/Orchestrator） |
| 消息队列 | 单 Broker | Kafka 多副本 / RocketMQ 主从同步 |
| 存储 | 单磁盘/单机器 | 分布式存储（Ceph/HDFS） |

列出这些方案不等于单点已经消除。部署多个实例后，冗余组件本身仍需检查故障域、控制面和切换路径，例如域名注册、流量入口、复制拓扑、选主仲裁和网络故障域都可能影响实际可用性。

### 2.3 关键设计原则

1. **无状态服务优先**：应用层不存储会话状态，实例更容易横向扩展。但这不意味着整个服务没有单点，负载均衡器、服务发现、共享存储仍可能成为单点
2. **有状态服务按需复制**：数据库通常需要多副本，缓存若数据可可靠重建则单节点也可能是可接受的选择。是否复制取决于可用性目标、数据恢复成本与故障恢复要求
3. **故障自动转移**：人工切换太慢，必须自动化（Failover）
4. **定期演练**：故障切换方案必须通过演练验证，不能只凭设计文档判断其有效性

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

    public static void setReadWrite() {
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

> 上面是概念性的局部片段，省略了数据源注册、默认数据源和路由上下文的清理时机。落地时路由上下文必须在请求或事务边界内可靠清理，且事务绑定连接后不能靠切换 ThreadLocal 就期待同一事务自动改用另一个数据源。多数据源完整落地见 [Spring 多数据源](../../spring/04-data-access/chapter-06-multi-datasource)。

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

冷、温、热备描述的是备机准备程度，并不能单独决定切换耗时和数据丢失量。下表只做入门对比，不把备机类型与具体指标硬性绑定：

| 备机状态 | 典型准备方式 | 主要代价 |
| :-- | :-- | :-- |
| 冷备 | 定期备份，故障时手动恢复 | 典型情况下数据滞后最大、恢复耗时最长 |
| 温备 | 备机持续运行、异步同步 | 可能丢失少量已确认数据 |
| 热备 | 备机持续运行，关键服务和接管条件已准备就绪；数据同步方式取决于具体系统 | 写入延迟增加，成本最高 |

热备描述的是备机准备状态，不必然采用同步复制，热备也可能使用异步复制；同步复制直接影响的是写入确认与数据丢失风险，不能作为热备的定义。冷备那列的"数据滞后最大、恢复耗时最长"也应理解为典型情况，而非必然结论。

切换耗时与数据丢失量应由两个独立指标分别定义：

- **RTO（Recovery Time Objective）**：恢复服务的目标时间，取决于故障检测、故障判定、切换、路由收敛及服务恢复各环节。
- **RPO（Recovery Point Objective）**：可接受的数据丢失量，取决于复制语义、已确认数据的持久性、故障类型及提升新主节点的规则。

对要求 RPO=0 的系统，应明确在哪些故障模型下承诺零数据丢失，并通过故障注入与切换演练验证，而不是只依赖"同步复制"这一标签。

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

> 服务集群与负载均衡落地见 [Spring 服务调用](../../spring/09-distributed/chapter-04-service-call)。

### 3.3 多副本一致性

副本越多，可用性越高，但一致性维护越复杂：

| 复制策略 | 确认条件 | 故障时数据风险 | 性能代价 | 典型场景 |
| :-- | :-- | :-- | :-- | :-- |
| 同步复制 | 提交前等待指定副本确认，确认范围由产品定义 | 低，取决于确认范围 | 写入延迟高 | 金融核心、强一致业务 |
| 半同步复制 | 等待至少一个副本满足产品定义的确认条件（如 MySQL 半同步等待副本接收并写入 relay log） | 取决于确认条件、超时退化策略及故障切换规则 | 延迟略增 | 对可靠性有要求但可容忍少量丢失 |
| 异步复制 | 主库提交后异步同步，返回时机取决于提交与持久化配置 | 高，取决于复制延迟 | 低 | 日志、非关键数据 |

不同产品对"同步"的确认口径并不相同，可能只等待法定数量副本，也可能等待所有副本持久化。上表的归类只是入门参照，落地时要看具体数据库的复制语义。半同步复制里的"确认收到事务"不等于副本已经执行或持久化到数据文件，也不自动保证故障切换时零数据丢失，风险还取决于半同步等待策略、超时后是否退化为异步以及故障时如何选主。MySQL Group Replication 使用组通信与成员间协调完成提交，其一致性和提交机制不能简单归入半同步主从复制。

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

上面这段写法有一个执行模型的隐患：`supplyAsync` 未指定执行器时会落到 `ForkJoinPool.commonPool()`，业务任务实际上在公共线程池里执行，而不是在舱壁配置的线程池里执行，隔离形同虚设。这里要区分两个层次：`@ThreadPoolBulkhead` 注解包装的是方法调用本身，方法内部的 `supplyAsync` 派发的异步任务则可能转移到舱壁之外的执行器。线程池舱壁与信号量舱壁的执行模型并不相同：

- **线程池舱壁**：通过核心线程数、最大线程数、队列容量限制并发与排队，隔离的是执行线程本身。
- **信号量舱壁**（下一节）：不创建额外线程，只用信号量限制同时进入的调用数，隔离的是并发调用次数。

落地线程池舱壁时，不要在受保护方法内部无意间把实际工作派发到舱壁之外的执行器；若确实需要二次异步调度，必须明确其执行器和隔离边界。

> 线程池舱壁的正确用法与熔断降级落地见 [Spring 熔断降级](../../spring/09-distributed/chapter-05-circuit-breaker)。

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
| **熔断（Circuit Breaker）** | 错误率超过阈值 | 短时间内直接跳过调用 | 支付通道错误率 > 50% 时熔断，阻止请求继续打到故障通道 |
| **限流降级** | QPS 超过系统容量 | 拒绝多余请求 | 秒杀场景限制每秒 1000 请求 |

熔断器的职责是阻止或限制对故障依赖的调用，它本身不做通道选择。切换备用支付通道需要额外的路由或降级逻辑，还涉及请求是否已被对端受理、重复支付防护等业务约束。不要误以为配置了熔断器就自然具备通道切换能力。

### 5.3 熔断器状态机

```txt
                失败率达到阈值
   ┌───────────────────────────────┐
   │                               ▼
┌──┴─────┐                    ┌────────┐
│ CLOSED │                    │  OPEN  │
│ (正常) │                    │ (熔断) │
└──▲─────┘                    └───┬────┘
   │                             │ 熔断等待时间超时
   │                             ▼
   │                        ┌────────┐
   │  探测调用达到关闭条件    │ HALF-  │
   └─────────────────────────│ OPEN   │
                             └───┬────┘
                                 │
                           探测调用失败
                                 │
                                 ▼
                             回到 OPEN
```

半开状态下会放行少量探测调用，是否回到 CLOSED 依据这些探测调用的结果及熔断器配置综合判定（涉及失败率、慢调用率、最小调用数等），而不是单次调用成功就立即关闭；探测失败则重新打开熔断，探测调用尚未达到判定所需数量时保持半开状态。

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

> 熔断器落地见 [Spring 熔断降级](../../spring/09-distributed/chapter-05-circuit-breaker)。

### 5.4 降级策略对比总览

| 维度 | Fallback | 熔断 | 限流 |
| :-- | :-- | :-- | :-- |
| 触发方式 | 调用失败时 | 错误率超阈值 | 流量超阈值 |
| 作用范围 | 单次调用 | 时间窗口内的所有调用 | 按策略覆盖指定入口、接口或资源 |
| 返回内容 | 预设默认值 | 快速失败/备用逻辑 | 拒绝请求（429） |
| 恢复方式 | 由后续调用及相应重试、恢复策略决定 | 半开状态探测恢复 | 流量下降自动恢复 |
| 典型工具 | try-catch + 默认逻辑 | Resilience4j / Sentinel | Sentinel / Nginx limit_req |

### 5.5 优雅停机（Graceful Shutdown）

高可用系统讨论了"故障发生后如何恢复"，但有一个高频的"人为故障"常被忽略：**发布部署**。

**为什么发布会导致 5xx？** 滚动发布时，旧实例被 kill 的瞬间可能有数百个请求正在处理。如果直接 `kill -9`，这些请求全部失败。在高可用系统中，发布频率远高于故障频率，把发布期间的中断窗口压缩到最小、让错误率尽量接近零，是高可用落地的关键一环。

Spring Boot 的优雅停机配置：

```yaml
server:
  shutdown: graceful

spring:
  lifecycle:
    timeout-per-shutdown-phase: 30s
```

流程：收到 SIGTERM → 停止接收新请求 → 等待正在处理的请求完成（最多 30 秒）→ 强制关闭。

Kubernetes 中通常配合 `preStop` hook 和 `terminationGracePeriodSeconds` 使用，目标是让负载均衡器先摘除实例再停机。但"先摘流再停机"不是加了两个参数就自动保证的结果，而是多个环节协同的时序问题：

1. Pod 进入终止流程，执行 `preStop`（若已配置）。
2. 流量入口观察到实例退出，停止转发新请求，这一步存在传播延迟。
3. 应用收到 SIGTERM 后停止接收新请求，排空在途请求。
4. 在终止宽限期内完成退出，超时仍可能被强制终止。

`preStop` 与应用停机不是两个可以独立配置、自动保证先后关系的开关。落地时要按实际入口实现验证摘流时序，并确认 `terminationGracePeriodSeconds` 能覆盖 `preStop` 耗时与应用排空时间。应用外部的长连接、异步任务和数据库操作还有各自的生命周期，不一定都受 Spring Boot 停机机制约束。

### 5.6 降级演练：Chaos Engineering

> **如果你从没演练过降级，那你的降级方案大概率是不能用的。**

```java
@Component
@ConditionalOnProperty(name = "chaos.enabled", havingValue = "true")
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

`@ConditionalOnProperty` 让故障注入默认关闭，只有显式配置 `chaos.enabled=true` 时才生效。这段示例只是入口层演示，有两处运行边界需要留意：`Thread.sleep(2000)` 会占住处理请求的 Servlet 工作线程，注入延迟可能迅速耗尽线程池，让实验扩大成整个服务的线程耗尽；`preHandle` 直接返回 false 并写 503 属于请求入口的粗粒度注入，并不等同于模拟下游依赖超时、连接失败或线程池饱和。真正落地时还要做到三点：限定注入对象，只对指定测试接口或指定实验请求触发，而不是拦截所有匹配请求；限定实验流量、范围与持续时间；监控实验期间的错误率与延迟，并准备可立即终止实验的开关。否则故障注入本身就会变成生产事故的来源。

Netflix 的 Chaos Monkey、阿里集团的 MonkeyKing、美团的 FailFast 都是类似理念：**有计划地制造故障，验证系统的容错能力**。实验可以在测试、预生产或经过严格控制的生产环境中开展，环境选择取决于风险评估与隔离能力，而不是默认直接在业务环境里随机注入故障。
