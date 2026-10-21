# 状态存储

> Streams 的状态默认落在本地 RocksDB；启用了变更日志（Changelog）的状态存储会把状态更新写入 Kafka，实例重启或 Rebalance 后通过重放 changelog 重建本地状态。本章讲存储类型、恢复机制，以及如何通过交互式查询读取状态。

## 1. 存储类型与 RocksDB

Kafka Streams 默认使用 RocksDB 存储状态。

| 存储类型 | 创建方式 | 适用场景 |
| :-- | :-- | :-- |
| 持久化键值存储 | Stores.persistentKeyValueStore() | 需要持久化及故障恢复的键值状态 |
| 内存键值存储 | Stores.inMemoryKeyValueStore() | 数据规模可控、希望避免 RocksDB 磁盘访问的状态 |
| 窗口存储 | Stores.persistentWindowStore() | 按时间窗口保存和查询状态 |
| 会话存储 | Stores.persistentSessionStore() | 按会话间隔组织状态 |

```java
// 自定义持久化键值存储（默认走 RocksDB）
StoreBuilder<KeyValueStore<String, Long>> persistentBuilder =
    Stores.keyValueStoreBuilder(
        Stores.persistentKeyValueStore("persistent-store"),
        Serdes.String(),
        Serdes.Long()
    ).withCachingEnabled().withLoggingEnabled(Collections.emptyMap());

// 内存存储
StoreBuilder<KeyValueStore<String, Long>> inMemoryBuilder =
    Stores.keyValueStoreBuilder(
        Stores.inMemoryKeyValueStore("in-memory-store"),
        Serdes.String(),
        Serdes.Long()
    );

// 两种存储按需注册到拓扑（可只注册其中一种）
builder.addStateStore(persistentBuilder);
builder.addStateStore(inMemoryBuilder);
```

以上代码只演示状态存储的创建与注册方式，实际使用时还需在处理器中通过 `storeName` 关联对应存储。

## 2. 状态恢复与 Changelog Topic

状态存储是**本地**的：RocksDB 的数据写在当前实例的磁盘上。问题在于，Rebalance 或实例重启后，一个分区的处理权可能从机器 A 转移到机器 B，而 B 的本地 RocksDB 里没有这个分区的任何历史状态。

解决方式是把「状态变更」同时写进 Kafka：对启用了变更日志（Changelog）的状态存储，Kafka Streams 会把状态更新写入对应的 Changelog Topic。当新实例接管分区时，根据 Changelog 恢复进度重建本地状态。注意，开启缓存（caching）后，同一 Key 的多次更新可能先合并再写入，实际写入 Changelog 的记录数不一定等于状态更新的次数；也可以通过 `withLoggingDisabled()` 关闭变更日志，但关闭后该存储不再具备基于 Changelog 的故障恢复能力。

```txt
假设这是普通键值存储，且没有删除操作：

实例 A 处理分区 0：
  更新 k1 → 1
  更新 k2 → 2
  更新 k1 → 3
  Changelog 记录这些状态更新

实例 A 宕机，实例 B 接管分区 0：
  B 的本地没有可复用状态
  B 从 Changelog 恢复状态
  → 最终状态为 {k1=3, k2=2}
  → 恢复完成后继续处理输入数据
```

**Changelog Topic 特点**：

- 使用 Compact 策略，减少历史更新记录占用的空间（窗口存储还需结合保留时间清理过期记录）。
- 自动创建，命名格式：`{application-id}-{store-name}-changelog`。
- 恢复时根据 Changelog 恢复进度重建状态。

为什么用 Compact 而不是按时间删除？同一个 Key 在 Changelog 里会被写很多次（每次更新一条）。对没有删除操作的普通键值存储，同一个 Kafka Key 的多次更新在压缩后只保留最新的非空值，从而减少恢复时需要读取的历史记录；如果 Key 被删除，Changelog 会写入 tombstone 记录，其清理还受删除保留时间影响。压缩本身是异步进行的，旧记录不会在每次更新后立即消失。

窗口存储的情况不同：Changelog 的消息 Key 包含窗口信息，同一业务 Key 在不同窗口中的状态需要分别保留，因此窗口 Changelog 通常同时配置压缩和按时间删除，不能简单理解为「每个业务 Key 只保留一条记录」。

所以「状态能恢复」不是免费的——它要求状态更新被持久化到 Kafka，并带来额外的存储、重放和恢复开销。这解释了为什么 Kafka Streams 的内建状态存储依赖 Kafka 本身来提供容错；外部数据库仍可用于保存业务数据，但不能直接替代这套状态恢复机制。

## 3. 交互式查询

应用运行期间，可以通过交互式查询 API 读取本地状态存储，本地查询无须额外部署服务。以下代码假定拓扑中已注册名为 persistent-store 的键值存储，以及名为 window-store 的窗口存储：

```java
ReadOnlyKeyValueStore<String, Long> store = streams.store(
    StoreQueryParameters.fromNameAndType("persistent-store", QueryableStoreTypes.keyValueStore())
);

// 查询单个 Key
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
Instant end = Instant.now();
Instant start = end.minus(Duration.ofHours(1));
try (WindowStoreIterator<Long> windowResults = windowStore.fetch("key", start, end)) {
    while (windowResults.hasNext()) {
        KeyValue<Long, Long> entry = windowResults.next();
        System.out.println(entry.key + ": " + entry.value);
    }
}
```

注意：交互式查询拿到的是**本实例**持有的 store。若目标 key 所在分区不在当前实例，需要先定位持有该分区的实例，再向它发起查询；跨实例查询还涉及实例发现、路由以及目标实例不可用时的处理，常见做法是包一层 REST 层完成转发。

## 4. 通过 REST API 暴露查询

下面的接口只演示如何通过 REST 查询当前实例本地持有的键值存储。接口固定查询名为 persistent-store 的键值存储，且只支持 String 键、Long 值的约定；若状态分布在多个实例上，还需要结合 Kafka Streams 的实例元数据定位目标实例，并把请求转发到对应实例。

```java
@RestController
public class StreamsQueryController {
    @Autowired
    private KafkaStreams streams;

    @GetMapping("/store/{key}")
    public ResponseEntity<Long> getValue(@PathVariable String key) {
        try {
            ReadOnlyKeyValueStore<String, Long> store = streams.store(
                StoreQueryParameters.fromNameAndType("persistent-store", QueryableStoreTypes.keyValueStore())
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

`get(key)` 返回 null 时映射为 404，表示当前实例本地状态中没有该 Key，而不是整个应用都不存在该 Key。`InvalidStateStoreException` 出现在状态存储尚未就绪或任务迁移、恢复期间，返回 503 是合理的；生产环境还应根据实际异常类型记录原因，避免把所有查询错误都当作状态暂不可用。
