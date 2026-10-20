# 窗口操作

> 窗口把无界流切成可聚合的有限区间。Kafka Streams 提供三类聚合窗口：翻转窗口不重叠，跳跃窗口按固定步长推进、可重叠，会话窗口按活动间隔定边界。选型先定窗口边界与重叠方式，再设晚到数据的宽限期（grace）。KStream-KStream 连接另有 JoinWindows（必须带时间窗口），见 [流操作 §5](./chapter-02-stream-operations.md)。

## 1. 翻转窗口（Tumbling Window）

```text
时间:  0    5    10   15   20   25   30
       │────│────│────│────│────│────│
       │ W1 │ W2 │ W3 │ W4 │ W5 │ W6 │
       │────│────│────│────│────│────│
```

- 固定大小，不重叠，边界左闭右开 `[start, end)`。
- 每条消息只属于一个窗口。
- 适用场景：每 5 分钟的统计。

```java
KTable<Windowed<String>, Long> counts = stream
    .groupBy((key, value) -> value)
    .windowedBy(TimeWindows.ofSizeWithNoGrace(Duration.ofMinutes(5)))
    .count();
```

## 2. 跳跃窗口（Hopping Window）

```text
时间:  0    1    2    3    4    5    6
       │─────────────│
       │    W1 (5分钟) │
            │─────────────│
            │    W2 (5分钟) │
                 │─────────────│
                 │    W3 (5分钟) │
```

- 固定大小，按步长（advance）推进。上图窗口大小 5 分钟、步长 1 分钟，步长小于窗口大小时重叠。
- 每条消息会进入所有覆盖它时间戳的窗口，可能参与多次聚合。
- 适用场景：滑动平均。

```java
KTable<Windowed<String>, Long> counts = stream
    .groupBy((key, value) -> value)
    .windowedBy(TimeWindows.ofSizeWithNoGrace(Duration.ofMinutes(5)).advanceBy(Duration.ofMinutes(1)))
    .count();
```

## 3. 会话窗口（Session Window）

```text
用户活动:  ●  ●    ● ● ●      ●
时间:     0  2    8 10 12     30
           │──│   │─────│     │
           Session1  Session2  Session3
           (gap=5分钟)
```

- 动态大小，根据活动间隔聚合。
- 相邻活动间隔超过 `gap` 时，通常形成不同 Session；后续记录也可能延长会话，或把原本分开的会话合并。`gap` 是会话间隔参数，不是会话的固定长度。
- 适用场景：用户行为分析。

```java
KTable<Windowed<String>, Long> counts = stream
    .groupBy((key, value) -> value)
    .windowedBy(SessionWindows.ofInactivityGapWithNoGrace(Duration.ofMinutes(30)))
    .count();
```

## 4. 窗口保留与晚到数据

前三节示例统一使用 WithNoGrace（零宽限期），便于入门；零宽限期意味着窗口结束后才到达的乱序记录会被判定为迟到并丢弃。本节说明如何用 grace 容忍迟到数据。

窗口关闭时间 = 窗口结束时间 + `grace`。关闭前，晚到记录仍会进入对应窗口；关闭判断依据 stream-time（处理任务内已推进的流时间，即该任务已处理记录的最大时间戳），而非系统当前时间。

```java
// 窗口结束时间加 grace 之后关闭；关闭前晚到记录仍会进入对应窗口
TimeWindows.ofSizeAndGrace(Duration.ofMinutes(5), Duration.ofMinutes(1));
```

这里容易混淆三个概念：

- `grace`：决定窗口何时停止接收迟到记录。
- 窗口状态保留时间：决定窗口聚合结果在状态存储中保留多久（通过 `Materialized` 或存储配置设置）。未显式指定时，Kafka Streams 按窗口长度与 grace 期确定默认保留时间。
- `windowstore.changelog.additional.retention.ms`：为窗口存储对应的 changelog 主题增加额外保留时间，降低时钟偏差导致日志过早删除的风险；它不是业务窗口的宽限期。

```properties
# 窗口存储 changelog 的额外保留时间，默认 1 天；仅在需要调整时修改
windowstore.changelog.additional.retention.ms=86400000
```

## 5. 窗口聚合示例

窗口聚合随输入记录实时更新对应窗口的结果，`KTable` 表示不断更新的聚合结果，不是每五分钟定时触发一次任务。

```java
// 按商品类别统计每个 5 分钟窗口内的订单金额
KStream<String, Order> orders = builder.stream("orders");

KTable<Windowed<String>, BigDecimal> windowedSum = orders
    .groupBy((key, order) -> order.getCategory())
    .windowedBy(TimeWindows.ofSizeAndGrace(Duration.ofMinutes(5), Duration.ofMinutes(1)))
    .aggregate(
        () -> BigDecimal.ZERO,
        (key, order, sum) -> sum.add(order.getAmount()),
        Materialized.<String, BigDecimal, WindowStore<Bytes, byte[]>>as("order-sum-store")
            .withKeySerde(Serdes.String())
            .withValueSerde(new BigDecimalSerde()) // BigDecimalSerde 为自定义序列化器，非内置
    );

// 输出到 Topic
windowedSum.toStream().to("order-sums",
    Produced.with(new WindowedSerde<>(Serdes.String()), new BigDecimalSerde()));
```

## 6. 窗口查询

```java
// 查询窗口存储，名称必须与第 5 节 Materialized.as 的命名一致
ReadOnlyWindowStore<String, BigDecimal> windowStore = streams.store(
    StoreQueryParameters.fromNameAndType("order-sum-store", QueryableStoreTypes.windowStore())
);

// from/to 筛选的是窗口起始时间戳，而不是窗口内每条记录的时间戳；Instant.now() 是查询方当前时间，不等于 stream-time
Instant from = Instant.now().minus(Duration.ofMinutes(10));
Instant to = Instant.now();
try (WindowStoreIterator<BigDecimal> results = windowStore.fetch("electronics", from, to)) {
    while (results.hasNext()) {
        KeyValue<Long, BigDecimal> entry = results.next();
        System.out.println("Window start: " + entry.key + ", Sum: " + entry.value);
    }
}
```

窗口存储是本地状态。多实例部署时，`streams.store` 只返回当前实例持有的本地状态，不汇总其他实例；需要全局结果时，要按 key 的分区归属路由请求，或另行设计汇总机制。
