# 熔断与降级

> 一个依赖变慢，会拖着调用方一起变慢，再向上传导拖垮整条链路。本章回答一个问题，怎么在依赖故障时快速失败、返回兜底结果，而不是陪着一起等超时。它和 [限流器](./chapter-02-rate-limiting.md) 一起，构成服务容错的入口。

## 1. 级联故障是怎么发生的

服务 A 调用服务 B。B 变慢，A 的请求线程被占住等待 B 返回，A 的连接池和线程池逐渐耗尽，A 自己也变慢，调用 A 的上游跟着变慢。故障从 B 传导到 A，再传导到整个链路。

```txt
上游 ──▶ A ──▶ B（变慢）
              │
    A 的线程被占住等 B
              │
    A 的连接池耗尽，A 变慢
              │
    上游跟着变慢，链路崩溃
```

根因在于，同步调用没有「快速失败」的开关。B 只是变慢，没有报错，A 就只能等，等到自己的资源被拖垮。要拦住这个传导，得在 A 这一侧装一个开关，B 出问题时直接短路，不再把请求发过去。

## 2. 熔断器状态机

熔断器（Circuit Breaker）就是那个开关。它有三种状态。

```txt
        ┌──────────────┐
        │    CLOSED    │ 正常放行，统计错误率
        └──────┬───────┘
               │ 错误率超过阈值
               ▼
        ┌──────────────┐
        │     OPEN     │ 直接拒绝，快速失败
        └──────┬───────┘
               │ 熔断窗口结束
               ▼
        ┌──────────────┐
        │   HALF-OPEN  │ 放少量探测请求
        └──────┬───────┘
         成功   │   失败
      ┌────────┴────────┐
      ▼                 ▼
   CLOSED            OPEN
```

`CLOSED` 是正常状态，请求照常放行，同时统计错误率。错误率超过阈值，熔断器切到 `OPEN`，之后一段时间内所有请求直接拒绝，不再发给依赖。`OPEN` 持续一个固定窗口后切到 `HALF-OPEN`，放少量探测请求试水，探测成功切回 `CLOSED`，失败重新回到 `OPEN`。

关键在 `OPEN` 期间「直接拒绝」。它让依赖有喘息的时间，也让调用方快速拿到失败结果，不再堆线程等超时。

## 3. 熔断、降级、限流是三个动作

三个词常被连在一起说，但它们是三个独立的动作，解决三个不同的问题。

熔断是开关，在依赖故障时自动打开，停止向它发请求。它保护的是下游，也保护调用方自己不被拖垮。

降级是返回兜底结果。熔断打开后，请求被拒绝，调用方不能什么都不返回，得给一个降级结果，比如返回缓存、返回默认值、返回友好提示。降级也可以不依赖熔断，大促时主动关掉非核心功能，也是一种降级。

限流是控制进入的请求量，超出容量的直接拒绝。它保护的是自身。

三者的关系是，限流和熔断都是「拒绝」，降级是「拒绝之后给什么」。熔断触发后通常走降级，但降级不一定由熔断触发。把这三个动作分清，才不会在配置里互相打架。

## 4. Resilience4j 落地

Resilience4j 是 Java 里做熔断的成熟组件。先引依赖，再用注解把熔断和降级挂在方法上。

```xml
<dependency>
    <groupId>org.springframework.cloud</groupId>
    <artifactId>spring-cloud-starter-circuitbreaker-resilience4j</artifactId>
</dependency>
```

```java
@Service
public class OrderService {

    @CircuitBreaker(name = "orderService", fallbackMethod = "queryOrderFallback")
    public Order queryOrder(String orderId) {
        return orderClient.query(orderId);
    }

    // 降级方法，签名和原方法一致，多一个 Throwable 参数
    public Order queryOrderFallback(String orderId, Throwable t) {
        return Order.fallback(orderId);  // 返回兜底结果
    }
}
```

熔断的行为由配置决定。

```yaml
resilience4j:
  circuitbreaker:
    instances:
      orderService:
        sliding-window-type: COUNT_BASED   # 按调用次数统计
        sliding-window-size: 10            # 统计最近 10 次调用
        minimum-number-of-calls: 5         # 至少 5 次调用才开始计算错误率
        failure-rate-threshold: 50         # 错误率达到 50% 触发熔断
        wait-duration-in-open-state: 10s   # 熔断 10 秒后进入半开状态
```

几个参数的含义串起来是这样。`sliding-window-size` 是统计窗口，`failure-rate-threshold` 是触发线，`minimum-number-of-calls` 是统计生效的门槛，`wait-duration-in-open-state` 是熔断的冷却时间。只有调用次数达到 `minimum-number-of-calls`，错误率才算数，否则头几次调用失败就把错误率顶到 100%，熔断被过早触发。

## 5. 阈值怎么定

熔断配置的难点在 `failure-rate-threshold` 和 `wait-duration-in-open-state` 这两个值，它们决定熔断是「该开就开」还是「动不动就开」。

错误率阈值设太低，偶发抖动就触发熔断，服务来回切换状态，反而更不稳。设太高，真故障时迟迟不熔断，起不到保护作用。一般从 50% 起步，配合「最小调用数」过滤掉小样本抖动。

熔断窗口设太短，依赖还没恢复就又放请求进去，刚探通又被失败打回 `OPEN`，反复横跳。设太长，故障恢复后迟迟不放行，白白损失可用性。一般从 10 秒起步，按依赖的恢复速度调整。

这里没有标准答案，只有一条判断依据，熔断的目标是「快速失败、快速恢复」，阈值和窗口都要围绕「多久能恢复」来定。依赖重启要 30 秒，窗口就别设 5 秒。

## 6. 相关章节

限流的算法与选型见 [限流器](./chapter-02-rate-limiting.md)。降级作为高可用的一种手段，其方法论见 [高可用](../../engineering/05-system-design/chapter-03-high-availability.md)。缓存场景里 Redis 宕机时的降级查询，见 [多级缓存与纵深防御](../01-cache/chapter-03-multi-level-defense.md)。
