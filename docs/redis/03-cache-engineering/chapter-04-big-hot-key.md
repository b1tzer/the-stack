# 大 Key 与热 Key

> 大 Key 与热 Key 是两类容易引发线上故障的 key：大 Key 拖慢命令执行、占用带宽；热 Key 让单点承受全部流量。本章讲解二者的定义、危害、发现与处理，并给出生产环境的排查和治理方案。

## 1. 大 Key

### 1.1 定义

大 Key 指单个 key 的 value 过大。不同场景的判定阈值不同：

| 类型 | 判定标准（参考） |
| :-- | :-- |
| String | value 超过 10KB |
| Hash/List/Set/ZSet | 元素数量超过几万，或整体超过几 MB |

### 1.2 危害

| 危害 | 说明 |
| :-- | :-- |
| 阻塞命令 | 大 Key 的读写耗时长，单线程下阻塞其他请求 |
| 占用带宽 | 大 Key 读写占用大量网络带宽 |
| 拖慢迁移 | 集群迁移时大 Key 迁移慢，影响扩容 |
| 内存碎片 | 大对象反复增删产生碎片 |

### 1.3 发现

```bash
redis-cli --bigkeys
```

实际输出示例：

```text
# Scanning the entire keyspace to find biggest keys as well as
# average sizes per key type.
# [00.00%] Biggest string found so far 'user:profile:10086' with 52428 bytes
# [00.00%] Biggest string found so far 'user:profile:10087' with 68912 bytes
# [25.00%] Biggest hash found so far 'order:items:20240101' with 12857 fields
# [50.00%] Biggest zset found so far 'rank:daily:score' with 500000 members
# [75.00%] Biggest list found so far 'queue:tasks:pending' with 892341 items

-------- summary -------

Sampled 2000000 keys in the keyspace!
Total key length in bytes is 48000000 (avg len 24.00)

Biggest string found 'user:profile:10087' has 68912 bytes
Biggest hash found 'order:items:20240101' has 12857 fields
Biggest list found 'queue:tasks:pending' has 892341 items
Biggest set found 'tag:tech:all' has 23456 members
Biggest zset found 'rank:daily:score' has 500000 members

287961 strings with 15892345 bytes (14.40% of keys, avg size 55.19)
123456 hashs with 3891234 fields (6.17% of keys, avg size 31.52)
98765 lists with 2345678 items (4.94% of keys, avg size 23.75)
45678 sets with 567890 members (2.28% of keys, avg size 12.43)
23456 zsets with 1234567 members (1.17% of keys, avg size 52.63)
```

`--bigkeys` 基于 SCAN 遍历，不会阻塞主线程，适合生产环境排查。

其他排查命令：

```bash
redis-cli --memusage user:profile:10087   # 查看单个 key 的内存占用
redis-cli MEMORY USAGE user:profile:10087  # 精确内存（字节）
redis-cli DEBUG OBJECT user:profile:10087  # 查看对象编码和引用计数
```

### 1.4 处理

| 手段 | 说明 |
| :-- | :-- |
| 拆分 Hash | 大 Hash 按业务维度拆成多个小 Hash |
| 分片存储 | 大 key 拆成多个子 key 分散存储 |
| 异步删除 | 用 `UNLINK` 代替 `DEL`，避免删除阻塞 |
| 选择合适结构 | 大数据量选 List/Set 而非 String 存整块 |

```bash
# 错误：同步删除大 Key，阻塞主线程
DEL queue:tasks:pending

# 正确：异步删除，后台线程回收内存
UNLINK queue:tasks:pending
```

### 1.5 Hash 分片示例

将一个大 Hash 按 ID 取模拆分到多个子 Hash：

```java
public void hsetSharded(String baseKey, String field, String value, int shardCount) {
    // field 的哈希值对分片数取模，决定写入哪个子 Hash
    int shard = Math.abs(field.hashCode()) % shardCount;
    String shardedKey = baseKey + ":shard:" + shard;
    redis.opsForHash().put(shardedKey, field, value);
}

public String hgetSharded(String baseKey, String field, int shardCount) {
    int shard = Math.abs(field.hashCode()) % shardCount;
    String shardedKey = baseKey + ":shard:" + shard;
    Object val = redis.opsForHash().get(shardedKey, field);
    return val != null ? val.toString() : null;
}
```

> 删除大 Key 一定要用 `UNLINK`（异步删除）而非 `DEL`（同步删除），`DEL` 大 Key 会阻塞主线程。

## 2. 热 Key

### 2.1 定义

热 Key 指访问频率极高、被大量请求集中访问的 key，例如秒杀商品、热搜词。

### 2.2 危害

| 危害 | 说明 |
| :-- | :-- |
| 单点压力 | 流量集中在单个 key 所在的节点，成为瓶颈 |
| 集群倾斜 | Cluster 模式下热 key 所在分片负载过高 |
| 击穿风险 | 热 key 过期瞬间引发缓存击穿（见 [缓存失效](./chapter-01-cache-invalidation) §3） |

### 2.3 发现

| 方式 | 说明 |
| :-- | :-- |
| `MONITOR` 命令 | 实时观察命令流，找出高频 key（有性能开销） |
| 客户端埋点 | 在业务代码里统计 key 访问频次 |
| 代理层统计 | 通过 Redis 代理（如 Codis）统计热点 |
| `redis-cli --hotkeys` | Redis 4.0+ 配合 `maxmemory-policy` 为 LFU 时可用 |

#### 客户端埋点

在业务代码中用一个本地计数器统计 key 访问频次，定期上报：

```java
@Component
public class HotKeyDetector {

    // 本地计数器：key → 访问次数
    private final ConcurrentHashMap<String, LongAdder> counter = new ConcurrentHashMap<>();
    // 热 key 阈值：1 分钟内超过 1000 次
    private static final long HOT_THRESHOLD = 1000;

    /**
     * 记录一次 key 访问
     */
    public void record(String key) {
        counter.computeIfAbsent(key, k -> new LongAdder()).increment();
    }

    /**
     * 判断是否为热 key
     */
    public boolean isHot(String key) {
        LongAdder adder = counter.get(key);
        return adder != null && adder.sum() >= HOT_THRESHOLD;
    }

    /**
     * 定时重置计数器（每分钟）
     * 可配合定时任务将热 key 列表上报到监控系统
     */
    @Scheduled(fixedRate = 60000)
    public void resetAndReport() {
        List<String> hotKeys = counter.entrySet().stream()
            .filter(e -> e.getValue().sum() >= HOT_THRESHOLD)
            .map(Map.Entry::getKey)
            .collect(Collectors.toList());

        if (!hotKeys.isEmpty()) {
            log.warn("检测到热 key: {}", hotKeys);
            // 上报到监控系统或自动触发缓存预热
        }
        counter.clear();
    }
}
```

在查询链路中嵌入埋点：

```java
public User getUser(Long userId) {
    String key = "user:" + userId;
    hotKeyDetector.record(key);  // 埋点

    String cached = redis.opsForValue().get(key);
    // ... 后续逻辑
}
```

### 2.4 处理

| 手段 | 说明 |
| :-- | :-- |
| 本地缓存 | 热点数据缓存在应用进程内，减少 Redis 访问 |
| Key 复制分散 | 热 key 复制多份（key1、key2...），分散到不同分片 |
| 读写分离 | 读请求分流到从节点 |
| 缓存预热 | 提前加载热点数据，避免冷启动击穿 |

#### Key 复制分散

将热 key 复制 N 份，读请求随机选择一个，分散单点压力：

```java
public class HotKeyDistributor {

    private static final int REPLICA_COUNT = 5;

    /**
     * 写入时复制 N 份
     */
    public void setWithReplicas(StringRedisTemplate redis,
                                 String key, String value, long ttl) {
        for (int i = 0; i < REPLICA_COUNT; i++) {
            redis.opsForValue().set(key + ":r" + i, value, ttl, TimeUnit.SECONDS);
        }
    }

    /**
     * 读取时随机选择一个副本
     */
    public String getWithReplicas(StringRedisTemplate redis, String key) {
        int replica = ThreadLocalRandom.current().nextInt(REPLICA_COUNT);
        return redis.opsForValue().get(key + ":r" + replica);
    }
}
```

> 在 Cluster 模式下，不同副本 key 会落在不同分片上，从而分散单节点压力。副本数量根据热 key 的 QPS 和分片数来决定。

## 3. 小结对比

| 维度 | 大 Key | 热 Key |
| :-- | :-- | :-- |
| 核心问题 | 体积过大 | 访问过热 |
| 主要危害 | 阻塞、带宽、迁移慢 | 单点压力、集群倾斜 |
| 发现工具 | `--bigkeys`、`--memusage` | MONITOR、客户端埋点、`--hotkeys` |
| 处理思路 | 拆分、异步删除 | 本地缓存、分散、预热 |

判别口诀：**大 Key 拆、热 Key 散**——大 Key 要拆小，热 Key 要分散。
