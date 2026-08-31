# 哨兵

> Sentinel（哨兵）自动监控 Redis 主从节点，主节点故障时自动故障转移。

## 1. Sentinel 的职责

```text
┌──────────────────────────────────────────┐
│              Sentinel 集群               │
│  Sentinel 1   Sentinel 2   Sentinel 3   │
└──────────────────────────────────────────┘
         │            │            │
    ┌────▼────────────▼────────────▼────┐
    │         Redis 主从集群             │
    │  Master ──▶ Slave1 ──▶ Slave2    │
    └───────────────────────────────────┘

监控：持续检查 Master/Slave 是否正常
通知：故障时通知客户端
自动故障转移：Master 故障时提升 Slave 为新 Master
配置中心：客户端通过 Sentinel 获取当前 Master 地址
```

## 2. 故障检测

### 主观下线（SDOWN）

单个 Sentinel 认为节点不可达（down-after-milliseconds 超时）。

### 客观下线（ODOWN）

quorum 个 Sentinel 都认为 Master 主观下线 → 客观下线 → 触发故障转移。

```bash
sentinel monitor mymaster 127.0.0.1 6379 2  # quorum=2
sentinel down-after-milliseconds mymaster 5000
```

## 3. 故障转移流程

```text
1. Sentinel 检测到 Master 客观下线
2. Sentinel 选举 Leader（Raft 协议）
3. Leader Sentinel 选择最优 Slave 提升为新 Master
   - 优先级（replica-priority）
   - 复制偏移量（数据最新）
   - runid（最小的）
4. 通知其他 Slave 指向新 Master
5. 旧 Master 恢复后自动成为新 Master 的 Slave
```

## 4. 客户端连接

```java
// Jedis 连接 Sentinel
Set<String> sentinels = new HashSet<>();
sentinels.add("sentinel1:26379");
sentinels.add("sentinel2:26379");
sentinels.add("sentinel3:26379");

JedisSentinelPool pool = new JedisSentinelPool("mymaster", sentinels);
Jedis jedis = pool.getResource();
```

## 5. 部署建议

- 至少 3 个 Sentinel（奇数个，便于选举）
- Sentinel 分布在不同机器
- quorum 设为 2（3 个 Sentinel 中 2 个同意）
- 不要将 Sentinel 和 Redis 放在同一进程

## 6. Sentinel 的局限

- 只有一个 Master 可写（不能水平扩展写入）
- 数据量受限于单机内存
- 故障转移期间有短暂不可用（秒级）

→ 数据量大时使用 Redis Cluster。
