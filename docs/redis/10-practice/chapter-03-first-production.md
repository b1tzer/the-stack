# 首次生产部署

## 硬件规划

| 组件 | 建议 |
| :-- | :-- |
| 内存 | ≥ 16G，预留 20% 给系统和 fork |
| 磁盘 | SSD，AOF 刷盘对 IO 敏感 |
| CPU | ≥ 4 核 |
| 网络 | 千兆网卡，主从同机房 |

## 必改配置

```conf
# 绑定与安全
bind 0.0.0.0
protected-mode yes
requirepass strong_password
rename-command FLUSHALL ""
rename-command FLUSHDB ""

# 内存
maxmemory 12gb
maxmemory-policy allkeys-lru
maxmemory-samples 10

# 持久化
appendonly yes
appendfsync everysec
auto-aof-rewrite-percentage 100
auto-aof-rewrite-min-size 256mb
save 3600 1 300 100 60 10000

# 连接
timeout 300
tcp-keepalive 60

# 慢日志
slowlog-log-slower-than 10000
slowlog-max-len 128
```

## 部署架构选择

| 场景 | 架构 | 说明 |
| :-- | :-- | :-- |
| 缓存（可丢数据） | 主从 + Sentinel | 简单，自动故障转移 |
| 缓存（不可丢） | Cluster | 分片 + 副本 |
| 分布式锁 | Cluster 或 Sentinel | 看数据量 |
| 排行榜/计数 | Cluster | 数据量大时需要分片 |

## 监控

- 内存使用率（`INFO memory`）
- 命中率（`INFO stats`：keyspace_hits / keyspace_misses）
- 连接数（`INFO clients`）
- 慢查询（`SLOWLOG GET`）
- 主从延迟（`INFO replication`）
- 碎片率（`INFO memory`：mem_fragmentation_ratio）
