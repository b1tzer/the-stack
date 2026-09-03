# 监控告警

> 监控是运维的「眼睛」。完善的监控体系能在故障发生前预警，在故障发生后提供定位依据。本章讲解监控维度、关键指标与告警阈值。

## 1. 监控架构

Redis 监控从三个维度构建：

| 维度 | 内容 | 工具 |
| :-- | :-- | :-- |
| 服务端 | CPU、内存、网络、磁盘 | 系统监控（Prometheus node_exporter） |
| 应用端 | QPS、延迟、内存、连接、命中率 | redis_exporter / INFO 采集 |
| 联合分析 | 服务端与应用端数据交叉定位 | Grafana 看板 |

```txt
服务端（OS）     应用端（Redis）      联合分析
CPU / 内存    →  QPS / 延迟      →  定位根因
网络 / 磁盘   →  内存 / 命中率    →  关联证据
```

## 2. 关键指标详解

### 2.1 吞吐量

```bash
INFO stats
# instantaneous_ops_per_sec:15000   # 当前 QPS
# total_commands_processed:123456789 # 累计处理命令数
```

### 2.2 延迟

```bash
# 基础延迟测试
redis-cli --latency
# min: 0, max: 3, avg: 1 (milliseconds)

# 延迟历史
redis-cli --latency-history
# 1712500000 0 2 1  ← 时间戳 min max avg

# 百分位延迟（需要 redis-cli 6.0+）
redis-cli --latency-dist
```

### 2.3 内存

```bash
INFO memory
# used_memory:1073741824          # Redis 分配的内存
# used_memory_rss:1288490188      # 操作系统分配的物理内存
# used_memory_peak:2147483648     # 内存峰值
# used_memory_peak_perc:50.00%   # 当前占峰值的比例
# used_memory_overhead:104857600  # 管理开销（元数据、缓冲区等）
# used_memory_dataset:968884224   # 数据实际占用
# mem_fragmentation_ratio:1.20    # 碎片率
# mem_allocator:jemalloc-5.3.0    # 内存分配器
```

### 2.4 命中率

```bash
INFO stats
# keyspace_hits:800000
# keyspace_misses:200000
# 命中率 = 800000 / (800000 + 200000) = 80%
```

| 命中率 | 评估 | 可能原因 |
| :-- | :-- | :-- |
| > 90% | 良好 | — |
| 70%~90% | 一般 | TTL 过短、缓存预热不足 |
| < 70% | 差 | 穿透严重、需要布隆过滤器 |

### 2.5 连接数

```bash
INFO clients
# connected_clients:500          # 当前连接数
# blocked_clients:10             # 阻塞的客户端（BLPOP 等）
# tracking_clients:0             # 使用 tracking 的客户端
# maxclients:10000               # 最大连接数
```

### 2.6 复制延迟

```bash
INFO replication
# role:master
# slave0:ip=10.0.0.2,port=6379,state=online,offset=123456789,lag=0
# slave1:ip=10.0.0.3,port=6379,state=online,offset=123456000,lag=1

# lag=1 表示延迟 1 秒
```

### 2.7 持久化状态

```bash
INFO persistence
# rdb_last_save_time:1712500000       # 上次 RDB 时间
# rdb_last_bgsave_status:ok           # 上次 BGSAVE 状态
# rdb_last_bgsave_time_sec:2          # 上次 BGSAVE 耗时
# aof_current_size:104857600          # 当前 AOF 大小
# aof_rewrite_in_progress:0           # 是否正在重写
# aof_last_bgrewrite_status:ok        # 上次重写状态
```

## 3. 告警阈值

| 指标 | 告警阈值（参考） | 说明 |
| :-- | :-- | :-- |
| 内存使用率 | > 80% | 接近上限，需扩容或淘汰 |
| 碎片率 | > 1.5 | 碎片较多，考虑整理 |
| 慢查询数量 | 持续增长 | 存在慢命令 |
| fork 耗时 | > 1s | fork 停顿明显 |
| 连接数 | > 80% maxclients | 连接接近上限 |
| 命中率 | < 70% | 缓存效果差 |
| 复制延迟 | > 5s | 数据严重不一致 |
| QPS | > 80% 理论上限 | 接近瓶颈 |

> 阈值需结合业务实际情况调整。告警的黄金法则是「宁可在故障前预警，不要在故障后才知道」。

## 4. 监控方案选型

| 方案 | 优势 | 劣势 | 适用场景 |
| :-- | :-- | :-- | :-- |
| Prometheus + Grafana | 开源、灵活、社区丰富 | 需要部署维护 | 中小团队首选 |
| 云厂商监控 | 开箱即用、无需运维 | 定制性差 | 使用云 Redis |
| CacheCloud | 一站式管理、多实例 | 搜狐开源，社区较小 | 大规模私有部署 |
| 自建采集 | 完全定制 | 开发成本高 | 有特殊需求 |

### 4.1 Prometheus + Grafana 快速搭建

```yaml
# docker-compose.yml
services:
  redis-exporter:
    image: oliver006/redis_exporter
    environment:
      REDIS_ADDR: redis://10.0.0.1:6379
    ports:
      - "9121:9121"

  prometheus:
    image: prom/prometheus
    volumes:
      - ./prometheus.yml:/etc/prometheus/prometheus.yml
    ports:
      - "9090:9090"

  grafana:
    image: grafana/grafana
    ports:
      - "3000:3000"
```

```yaml
# prometheus.yml
scrape_configs:
  - job_name: 'redis'
    static_configs:
      - targets: ['redis-exporter:9121']
```

Grafana 导入 Redis Dashboard（ID: 763），即可获得开箱即用的 Redis 监控看板。

## 5. 日常巡检

建议每天执行一次巡检：

```bash
# 1. 内存状态
INFO memory | grep -E "used_memory|fragmentation|swap"

# 2. 慢查询
SLOWLOG GET 5

# 3. 连接数
INFO clients | grep connected_clients

# 4. 命中率
INFO stats | grep keyspace

# 5. 复制状态
INFO replication | grep -E "role|slave|lag"

# 6. 持久化状态
INFO persistence | grep -E "rdb_last|aof_current"
```
