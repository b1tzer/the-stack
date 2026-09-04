# 窗口操作

## 1. 翻转窗口

```java
KTable<Windowed<String>, Long> counts = stream
    .groupBy((key, value) -> value)
    .windowedBy(TimeWindows.of(Duration.ofMinutes(5)))
    .count();
```

## 2. 跳跃窗口

```java
KTable<Windowed<String>, Long> counts = stream
    .groupBy((key, value) -> value)
    .windowedBy(TimeWindows.of(Duration.ofMinutes(5)).advanceBy(Duration.ofMinutes(1)))
    .count();
```

## 3. 会话窗口

```java
KTable<Windowed<String>, Long> counts = stream
    .groupBy((key, value) -> value)
    .windowedBy(SessionWindows.with(Duration.ofMinutes(30)))
    .count();
```

## 4. 滑动窗口

```java
// 用于连接操作
JoinWindows.of(Duration.ofMinutes(5))
```

## 5. 窗口类型详解

### 5.1 翻转窗口（Tumbling Window）

```
时间:  0    5    10   15   20   25   30
       │────│────│────│────│────│────│
       │ W1 │ W2 │ W3 │ W4 │ W5 │ W6 │
       │────│────│────│────│────│────│
```

- 固定大小，不重叠。
- 每条消息只属于一个窗口。
- 适用场景：每 5 分钟的统计。

### 5.2 跳跃窗口（Hopping Window）

```
时间:  0    1    2    3    4    5    6
       │─────────────│
       │    W1 (5分钟) │
            │─────────────│
            │    W2 (5分钟) │
                 │─────────────│
                 │    W3 (5分钟) │
```

- 固定大小，可能重叠。
- 每条消息可能属于多个窗口。
- 适用场景：滑动平均。

### 5.3 会话窗口（Session Window）

```
用户活动:  ●  ●    ● ● ●      ●
时间:     0  2    8 10 12     30
           │──│   │─────│     │
           Session1  Session2  Session3
           (gap=5分钟)
```

- 动态大小，根据活动间隔聚合。
- 间隔超过 `gap` 时，分为不同 Session。
- 适用场景：用户行为分析。

## 6. 窗口保留时间

```java
// 设置窗口保留时间
TimeWindows.of(Duration.ofMinutes(5)).grace(Duration.ofMinutes(1));

// 晚到的消息（超过窗口关闭时间但仍在 grace 期内）会被处理
// 超过 grace 期的消息会被丢弃
```

```properties
# 全局窗口保留时间
windowstore.changelog.additional.retention.ms=86400000  # 1 天
```

## 7. 窗口聚合示例

```java
// 每 5 分钟统计一次订单金额
KStream<String, Order> orders = builder.stream("orders");

KTable<Windowed<String>, BigDecimal> windowedSum = orders
    .groupBy((key, order) -> order.getCategory())
    .windowedBy(TimeWindows.of(Duration.ofMinutes(5)))
    .aggregate(
        () -> BigDecimal.ZERO,
        (key, order, sum) -> sum.add(order.getAmount()),
        Materialized.<String, BigDecimal, WindowStore<Bytes, byte[]>>as("order-sum-store")
            .withKeySerde(Serdes.String())
            .withValueSerde(new BigDecimalSerde())
    );

// 输出到 Topic
windowedSum.toStream().to("order-sums", 
    Produced.with(new WindowedSerde<>(Serdes.String()), new BigDecimalSerde()));
```

## 8. 窗口查询

```java
// 查询窗口存储
ReadOnlyWindowStore<String, BigDecimal> windowStore = streams.store(
    StoreQueryParameters.fromNameAndType("order-sums", QueryableStoreTypes.windowStore())
);

// 查询特定时间范围
Instant from = Instant.now().minus(Duration.ofMinutes(10));
Instant to = Instant.now();
WindowStoreIterator<BigDecimal> results = windowStore.fetch("electronics", from, to);

while (results.hasNext()) {
    KeyValue<Long, BigDecimal> entry = results.next();
    System.out.println("Window: " + entry.key + ", Sum: " + entry.value);
}
```

