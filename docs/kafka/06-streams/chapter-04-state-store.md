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

- 状态存储在本地 RocksDB
- 通过 Changelog Topic 恢复
- 无需外部数据库

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
