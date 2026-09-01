# 状态存储

## 1. RocksDB

Kafka Streams 默认使用 RocksDB 存储状态。

```java
// 自定义状态存储
StoreBuilder<KeyValueStore<String, Long>> storeBuilder =
    Stores.keyValueStoreBuilder(
        Stores.persistentKeyValueStore("my-store"),
        Serdes.String(),
        Serdes.Long()
);

builder.addStateStore(storeBuilder);
```

## 2. 交互式查询

```java
ReadOnlyKeyValueStore<String, Long> store = streams.store(
    StoreQueryParameters.fromNameAndType("my-store", QueryableStoreTypes.keyStore())
);

// 查询单个 Key
Long value = store.get("key");

// 查询所有
KeyValueIterator<String, Long> all = store.all();
```

## 3. 状态恢复

状态存储是**本地**的：RocksDB 的数据写在当前实例的磁盘上。问题在于，Rebalance 或实例重启后，一个分区的处理权可能从机器 A 转移到机器 B，而 B 的本地 RocksDB 里没有这个分区的任何历史状态。

解决方式是把「状态变更」同时写进 Kafka：每次 `put` 都会追加一条记录到一个 Changelog Topic。当新实例接管分区时，从头消费这个 Changelog Topic，重放全部变更，就能在本地重建出完整状态。

```text
实例 A 处理分区 0：
  put("k1", 1) → Changelog 追加 [k1=1]
  put("k2", 2) → Changelog 追加 [k2=2]
  put("k1", 3) → Changelog 追加 [k1=3]

实例 A 宕机，实例 B 接管分区 0：
  B 的本地 RocksDB 是空的
  B 从头消费 Changelog → 重放 [k1=1] [k2=2] [k1=3]
  → 重建出 {k1=3, k2=2}
```

所以「状态能恢复」不是免费的——它要求每次状态更新都被写进 Kafka。这解释了为什么 Kafka Streams 的状态存储天然依赖 Kafka 本身，而不是外部数据库。

## 4. 状态存储类型

| 类型 | 存储方式 | 适用场景 |
|------|----------|----------|
| PersistentKeyValueStore | RocksDB | 大容量键值存储 |
| InMemoryKeyValueStore | 内存 | 小容量、高性能 |
| PersistentWindowStore | RocksDB | 窗口聚合 |
| PersistentSessionStore | RocksDB | 会话窗口 |

```java
// 内存存储
StoreBuilder<KeyValueStore<String, Long>> storeBuilder =
    Stores.keyValueStoreBuilder(
        Stores.inMemoryKeyValueStore("in-memory-store"),
        Serdes.String(),
        Serdes.Long()
    );

// 带缓存的持久化存储
StoreBuilder<KeyValueStore<String, Long>> storeBuilder =
    Stores.keyValueStoreBuilder(
        Stores.persistentKeyValueStore("persistent-store"),
        Serdes.String(),
        Serdes.Long()
    ).withCachingEnabled().withLoggingEnabled(Collections.emptyMap());
```

## 5. Changelog Topic

```
状态存储操作:
put(key1, value1) → Changelog: [key1=value1]
put(key2, value2) → Changelog: [key1=value1, key2=value2]
put(key1, value3) → Changelog: [key1=value1, key2=value2, key1=value3]

状态恢复:
读取 Changelog Topic → 重放所有操作 → 恢复到最新状态
```

**Changelog Topic 特点**：
- 使用 Compact 策略，保留每个 Key 的最新值。
- 自动创建，命名格式：`{application-id}-{store-name}-changelog`。
- 恢复时从头消费 Changelog Topic。

为什么用 Compact 而不是按时间删除？同一个 Key 在 Changelog 里会被写很多次（每次更新一条）。如果全部保留，恢复时就要重放大量早已被覆盖的旧值。Compact 只保留每个 Key 的最新一条，恰好匹配状态恢复的语义——恢复只需要「每个 Key 的最终值」，不需要中间历史。这样既压缩了存储，也缩短了恢复时的重放时间。

## 6. 交互式查询详解

```java
// 查询单个 Key
ReadOnlyKeyValueStore<String, Long> store = streams.store(
    StoreQueryParameters.fromNameAndType("my-store", QueryableStoreTypes.keyStore())
);
Long value = store.get("key");

// 范围查询
KeyValueIterator<String, Long> range = store.range("a", "z");
while (range.hasNext()) {
    KeyValue<String, Long> entry = range.next();
    System.out.println(entry.key + ": " + entry.value);
}
range.close();

// 全量查询
KeyValueIterator<String, Long> all = store.all();
while (all.hasNext()) {
    KeyValue<String, Long> entry = all.next();
    System.out.println(entry.key + ": " + entry.value);
}
all.close();

// 窗口查询
ReadOnlyWindowStore<String, Long> windowStore = streams.store(
    StoreQueryParameters.fromNameAndType("window-store", QueryableStoreTypes.windowStore())
);
WindowStoreIterator<Long> windowResults = windowStore.fetch(
    "key", Instant.now().minus(Duration.ofHours(1)), Instant.now());
```

## 7. 通过 REST API 暴露查询

```java
@RestController
public class StreamsQueryController {
    @Autowired
    private KafkaStreams streams;

    @GetMapping("/store/{storeName}/{key}")
    public ResponseEntity<Long> getValue(@PathVariable String storeName, @PathVariable String key) {
        try {
            ReadOnlyKeyValueStore<String, Long> store = streams.store(
                StoreQueryParameters.fromNameAndType(storeName, QueryableStoreTypes.keyStore())
            );
            Long value = store.get(key);
            if (value != null) {
                return ResponseEntity.ok(value);
            }
            return ResponseEntity.notFound().build();
        } catch (InvalidStateStoreException e) {
            return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE).build();
        }
    }
}
```

## 8. 最佳实践

1. **为状态存储指定有意义的名称**：便于调试和交互式查询。
2. **合理使用缓存**：`withCachingEnabled()` 可以减少 Changelog Topic 的写入频率。
3. **监控状态存储大小**：使用 JMX 指标 `store-size-bytes` 监控存储占用。
4. **使用 Standby Replica 加速恢复**：配置 `num.standby.replicas=1`，让其他实例也维护状态副本。
