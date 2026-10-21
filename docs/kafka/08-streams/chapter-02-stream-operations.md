# 流操作

> 本章汇总 Streams DSL 的常用操作：无状态转换、分组聚合、连接与分支。选择 API 时需要关注三点：Key 是否改变（是否引入重新分区需求）、操作是否引入状态，以及连接双方的类型与分区条件。

## 1. 过滤

```java
KStream<String, String> filtered = stream.filter((key, value) -> value.length() > 5);
```

## 2. 映射

```java
KStream<String, Integer> mapped = stream.mapValues(value -> value.length());
```

`mapValues` 只改 Value，Key 不变，因此不会仅因这次转换而触发重新分区。`map` 可以同时改 Key 和 Value：

```java
// 修改 Key；后续按新 Key 分组或连接时，才可能需要重新分区
KStream<String, Integer> remapped = stream.map(
    (key, value) -> new KeyValue<>(value, value.length())
);
```

两者的分水岭在 Key。改 Key 不等于立即重新分区：`map` 在拓扑层面被视为可能改变 Key 的操作，当下游操作（如分组、连接）依赖按新 Key 的分区布局时，Kafka Streams 才可能通过内部 repartition topic 重新分配记录。Key 不变用 `mapValues`，可以避免引入不必要的重新分区需求。

## 3. 平坦化（FlatMap / FlatMapValues）

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

两者的区别在 Key：`flatMapValues` 展开 Value 同时保留原 Key；`flatMap` 可以为每条输入记录生成零条或多条不同 Key 的输出。

## 4. 分组与聚合

```java
// GroupBy：按自定义 Key 分组
KGroupedStream<String, String> grouped = stream.groupBy(
    (key, value) -> value.substring(0, 3)
);

// GroupByKey：按原 Key 分组
KGroupedStream<String, String> groupedByKey = stream.groupByKey();

// Count
KTable<String, Long> count = groupedByKey.count();

// Aggregate：自定义初始值与聚合逻辑，与 count 区分（示例按数值累加）
KTable<String, Long> total = grouped.aggregate(
    () -> 0L,  // 初始值
    (key, value, aggregate) -> aggregate + Long.parseLong(value),  // 聚合函数
    Materialized.<String, Long, KeyValueStore<Bytes, byte[]>>as("sum-store")
        .withKeySerde(Serdes.String())
        .withValueSerde(Serdes.Long())
);

// Reduce：仅演示合并函数，字符串持续拼接会让聚合结果无限膨胀
KTable<String, String> reduced = grouped.reduce(
    (value1, value2) -> value1 + "," + value2  // 合并函数
);
```

`groupBy` 与 `groupByKey` 的区别在分组依据，以及在是否需要重新分区上的通常表现：

- `groupByKey` 按现有 Key 分组，适用于原 Key 就是目标分组依据的场景。若上游没有改变 Key、也没有引入重新分区需求，它通常能复用现有分区布局。
- `groupBy` 根据 Key 和 Value 计算新的分组 Key。Kafka Streams 通常需要按新 Key 建立满足后续操作要求的分区布局，这一步通过内部 repartition topic 完成。

选择时应先确定分组语义，再考虑成本。原 Key 已满足分组要求时，优先用 `groupByKey`；但若业务确实需要按新 Key 分组，就不能为了省一次重新分区而改用 `groupByKey` 牺牲语义。

## 5. 连接（Join）

```java
// KStream-KStream 连接：必须带时间窗口
KStream<String, String> joined = stream1.join(
    stream2,
    (value1, value2) -> value1 + "-" + value2,
    JoinWindows.ofTimeDifferenceWithNoGrace(Duration.ofMinutes(5)),
    StreamJoined.with(Serdes.String(), Serdes.String(), Serdes.String())
);

// KStream-KTable 连接：不需要窗口
KStream<String, String> enriched = stream.join(
    table,
    (streamValue, tableValue) -> streamValue + "-" + tableValue
);

// KStream-GlobalKTable 连接：无需 Co-partition
KStream<String, String> enrichedGlobal = stream.join(
    globalTable,
    (key, value) -> key,  // Key 映射
    (streamValue, globalValue) -> streamValue + "-" + globalValue
);
```

KStream 是无界流。join 要回答的问题是：`stream1` 的这条消息，该和 `stream2` 的哪条消息配对？如果不限制匹配范围，两条流都可能持续产生新记录，连接状态就会持续增长。所以 KStream-KStream 的 join 必须带时间窗口：Kafka Streams 按 Key 匹配记录，再根据两条记录的时间戳是否满足 `JoinWindows` 定义的时间差约束来判断是否连接。

窗口决定匹配范围，但不等于记录到达后固定等待 5 分钟，也不意味着状态会在某条记录产生 5 分钟后立即删除。状态清理还与窗口边界、流时间推进及宽限期有关，迟到记录能否参与连接也取决于窗口的具体配置。示例中的 `ofTimeDifferenceWithNoGrace` 显式关闭宽限期，窗口关闭后不再接收迟到记录；生产环境若需处理乱序到达的记录，改用 `ofTimeDifferenceAndGrace` 显式设置宽限期。

KStream-KTable 连接则不需要时间窗口。流中的每条记录按 Key 查找 `KTable` 中对应的当前值，两者交给连接函数处理，这是查表语义，不是等待另一条流中的匹配事件。`KTable` 代表以 Key 为主键的变更流，底层状态会随更新而变化，Key 的数量不保证有界，不能据此断言状态不会增长。普通 KStream-KTable 连接在流记录到达时查表的当前值，后续表值变化不会自动重算此前的流记录。

`KStream` 与 `KTable` 连接还要求 Co-partition（见 [Streams 概览 §3](./chapter-01-streams-basics.md)）；`GlobalKTable` 在每个实例都有全量数据，因此不受该约束。

## 6. KTable 操作

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

`KTable` 的 Value 为 `null` 的记录是删除语义（tombstone）。内置的 `filter`、`mapValues` 等操作会专门处理 tombstone，把删除语义向下游传播；但自定义处理逻辑必须显式保留删除语义，不能把删除记录当作普通空值吞掉，否则下游表无法感知删除。`KTable` 转成 `KStream` 后，记录被当作普通事件解释，不再按表更新的方式处理，因此 `KTable` 与 `KStream` 的 `filter`、`mapValues` 语义并不完全相同。

## 7. 分支（Branch）

```java
// 按条件分流（split 命名式分支，替代旧 branch 数组写法）
Map<String, KStream<String, String>> branches = stream
    .split(Named.as("log-"))
    .branch((key, value) -> value.startsWith("ERROR"), Branched.as("errors"))
    .branch((key, value) -> value.startsWith("WARN"), Branched.as("warnings"))
    .defaultBranch(Branched.as("others"));

KStream<String, String> errors = branches.get("log-errors");
KStream<String, String> warnings = branches.get("log-warnings");
KStream<String, String> others = branches.get("log-others");
```
