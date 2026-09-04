# 流操作

## 1. 过滤

```java
KStream<String, String> filtered = stream.filter((key, value) -> value.length() > 5);
```

## 2. 映射

```java
KStream<String, Integer> mapped = stream.mapValues(value -> value.length());
```

`mapValues` 只改 value，Key 不变，因此消息仍留在原分区，不触发重新分区。`map` 可以改 Key：

```java
// ❌ 改 Key 会触发重新分区，消息需要跨节点搬移
KStream<String, Integer> remapped = stream.map(
    (key, value) -> new KeyValue<>(value, value.length())
);
```

两者的分水岭在 Key：Key 不变用 `mapValues`（零网络开销）；Key 变了用 `map`（代价是一次 re-partition）。

## 3. 聚合

```java
KTable<String, Long> counts = stream
    .groupBy((key, value) -> value)
    .count();
```

## 4. 连接

```java
// KStream-KStream 连接
KStream<String, String> joined = stream1.join(
    stream2,
    (value1, value2) -> value1 + "-" + value2,
    JoinWindows.of(Duration.ofMinutes(5))
);

// KStream-KTable 连接
KStream<String, String> joined = stream.join(
    table,
    (streamValue, tableValue) -> streamValue + "-" + tableValue
);
```

## 5. 平坦化（FlatMap / FlatMapValues）

```java
// FlatMapValues：将一条消息展开为多条
KStream<String, String> words = stream.flatMapValues(
    value -> Arrays.asList(value.split(" "))
);

// FlatMap：可以改变 Key
KStream<String, WordWithCount> wordCounts = stream.flatMap(
    (key, value) -> {
        String[] words = value.split(" ");
        List<KeyValue<String, WordWithCount>> result = new ArrayList<>();
        for (String word : words) {
            result.add(new KeyValue<>(word, new WordWithCount(word, 1)));
        }
        return result;
    }
);
```

## 6. 分组与聚合

```java
// GroupBy：按 Key 分组
KGroupedStream<String, String> grouped = stream.groupBy(
    (key, value) -> value.substring(0, 3)  // 自定义分组 Key
);

// GroupByKey：按原 Key 分组
KGroupedStream<String, String> groupedByKey = stream.groupByKey();
```

`groupBy` 与 `groupByKey` 的区别不在语法，在是否触发重新分区：

- `groupByKey` 沿用消息原 Key，Key 没变，同 Key 的消息本就在同一分区，聚合可以原地完成，零网络开销。
- `groupBy` 用新 Key（这里是 value 的前 3 个字符），新 Key 与原分区不再对应，Kafka Streams 必须把消息按新 Key 重新路由到对应分区，这就是 re-partition。

所以能 `groupByKey` 就不要 `groupBy`：`groupBy` 的 re-partition 会产生一张中间 Topic，并带来一次额外的网络往返。
// 聚合操作
KTable<String, Long> count = grouped.count();

KTable<String, Long> aggregate = grouped.aggregate(
    () -> 0L,  // 初始值
    (key, value, aggregate) -> aggregate + 1,  // 聚合函数
    Materialized.<String, Long, KeyValueStore<Bytes, byte[]>>as("count-store")
        .withKeySerde(Serdes.String())
        .withValueSerde(Serdes.Long())
);

// Reduce
KTable<String, String> reduced = grouped.reduce(
    (value1, value2) -> value1 + "," + value2  // 合并函数
);
```

## 7. KTable 操作

```java
// KTable 转 KStream
KStream<String, String> stream = table.toStream();

// KTable 过滤
KTable<String, String> filtered = table.filter(
    (key, value) -> value.length() > 5
);

// KTable 连接
KTable<String, String> joined = table1.join(
    table2,
    (value1, value2) -> value1 + "-" + value2
);

// KTable 左连接（右侧可能为 null）
KTable<String, String> leftJoined = table1.leftJoin(
    table2,
    (value1, value2) -> value1 + "-" + (value2 != null ? value2 : "N/A")
);
```

## 8. 连接操作详解

```java
// KStream-KStream 连接（需要时间窗口）
KStream<String, String> joined = stream1.join(
    stream2,
    (value1, value2) -> value1 + "-" + value2,
    JoinWindows.of(Duration.ofMinutes(5)),  // 5 分钟窗口
    StreamJoined.with(Serdes.String(), Serdes.String(), Serdes.String())
);
```

KStream 是无界流，两条流各自无限推进。join 要回答的问题是：`stream1` 的这条消息，该和 `stream2` 的哪条消息配对？没有边界，配对范围就是「从开天辟地到永远」，状态永远无法释放。所以 KStream-KStream 的 join 必须带时间窗口，用它把配对范围框定在「时间戳相差 5 分钟内」这一有限区间——窗口一过，配不上的消息就能丢弃，状态存储才有回收的时机。

KTable 则相反，它是「每个 Key 的最新值」，天然是一个有界的快照，所以 KStream-KTable 连接不需要窗口，也不存在状态无限膨胀的问题。
// KStream-KTable 连接（不需要窗口）
KStream<String, String> enriched = stream.join(
    table,
    (streamValue, tableValue) -> streamValue + "-" + tableValue
);

// KStream-GlobalKTable 连接（无需 Co-partition）
KStream<String, String> enriched = stream.join(
    globalTable,
    (key, value) -> key,  // Key 映射
    (streamValue, globalValue) -> streamValue + "-" + globalValue
);
```

## 9. 分支（Branch）

```java
// 按条件分流
KStream<String, String>[] branches = stream.branch(
    (key, value) -> value.startsWith("ERROR"),  // 分支 0：错误日志
    (key, value) -> value.startsWith("WARN"),   // 分支 1：警告日志
    (key, value) -> true                          // 分支 2：其他
);

KStream<String, String> errors = branches[0];
KStream<String, String> warnings = branches[1];
KStream<String, String> others = branches[2];
```

