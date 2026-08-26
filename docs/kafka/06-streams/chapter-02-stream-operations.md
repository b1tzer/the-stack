# 流操作

## 1. 过滤

```java
KStream<String, String> filtered = stream.filter((key, value) -> value.length() > 5);
```

## 2. 映射

```java
KStream<String, Integer> mapped = stream.mapValues(value -> value.length());
```

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

## 10. 最佳实践

1. **优先使用 MapValues**：不改变 Key 的操作性能更好，避免数据重新分区。
2. **合理使用 GroupBy**：GroupBy 会导致数据重新分区，增加网络开销。
3. **连接操作注意 Co-partition**：KStream-KStream 和 KStream-KTable 连接要求两个流具有相同的分区数和 Key 类型。
4. **使用 Materialized 指定状态存储**：为聚合操作指定名称，便于调试和交互式查询。
