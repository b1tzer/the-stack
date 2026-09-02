# 性能优化

> Redis 性能优化不是玄学，而是围绕几个核心维度：慢命令、内存、网络、持久化。本章先建立指标体系，再逐维度讲解优化手段，最后给出生产环境的调优清单。

## 1. 指标体系

评估 Redis 性能，先看这几个关键指标：

| 指标 | 含义 | 获取方式 |
| :-- | :-- | :-- |
| QPS | 每秒处理请求数 | `INFO stats` 的 `instantaneous_ops_per_sec` |
| 延迟 | 单命令响应时间 | `redis-cli --latency` |
| 内存 | 内存使用与碎片 | `INFO memory` |
| 命中率 | 缓存命中比例 | `keyspace_hits / (hits+misses)` |
| 连接数 | 客户端连接数 | `INFO clients` |
| fork 耗时 | BGSAVE/AOF 重写 fork 耗时 | `INFO stats` 的 `latest_fork_usec` |
| 复制延迟 | 主从偏移量差 | `INFO replication` |

```bash
redis-cli --latency          # 测试延迟
redis-cli --latency-history  # 延迟历史趋势
redis-cli --stat             # 实时统计 QPS
INFO stats                   # 查看累计统计
INFO memory                  # 查看内存
```

> 优化的第一步是「测量」，先量化当前基线（延迟、QPS、内存），优化后再对比，避免凭感觉优化。

## 2. 慢查询优化

慢命令是 Redis 单线程模型的头号杀手——一个慢命令会阻塞所有其他请求。

### 2.1 定位慢查询

```bash
SLOWLOG GET 10              # 查看最近 10 条慢查询
SLOWLOG LEN                 # 慢查询总数
CONFIG SET slowlog-log-slower-than 10000   # 超过 10ms 记为慢查询
```

### 2.2 常见慢命令与替代

| 慢命令 | 问题 | 替代方案 |
| :-- | :-- | :-- |
| `KEYS *` | 全量遍历，O(n)，阻塞 | `SCAN` 游标分批遍历 |
| `HGETALL` 大 Hash | 返回全部字段 | `HSCAN` 分批获取 |
| `SMEMBERS` 大 Set | 返回全部元素 | `SSCAN` 分批获取 |
| `DEL` 大 Key | 同步删除阻塞 | `UNLINK` 异步删除 |
| `SORT` | 排序开销大 | 业务层排序或用有序集合 |
| `FLUSHALL` | 清空全部数据 | 生产环境禁用或异步执行 |

### 2.3 SCAN 的用法

```bash
SCAN 0 MATCH user:* COUNT 100
# 返回：cursor + 一批匹配的 key
# 用返回的 cursor 继续扫描，直到 cursor=0
```

| 参数 | 含义 |
| :-- | :-- |
| `cursor` | 游标，0 表示开始 |
| `MATCH` | 过滤模式 |
| `COUNT` | 每次返回的元素数（参考值，非精确） |

> SCAN 不保证一次返回所有结果，需要循环调用直到 cursor 归零。COUNT 是「建议数量」，实际返回可能多于或少于 COUNT。

## 3. 内存优化

### 3.1 选对结构

| 场景 | 错误做法 | 正确做法 |
| :-- | :-- | :-- |
| 存对象 | `SET user:1001 "{name:'张三',age:25}"` | `HSET user:1001 name "张三" age 25` |
| 存集合 | `SET tags "java,python,go"` | `SADD tags java python go` |
| 存列表 | `LPUSH` 大量元素 | 分多个 key 或用 listpack 节点 |

### 3.2 控制编码

小数据用紧凑编码，避免触发升级：

```bash
# 查看 key 的编码
OBJECT ENCODING key

# 配置编码阈值
hash-max-listpack-entries 512
hash-max-listpack-value 64
set-max-intset-entries 512
zset-max-listpack-entries 128
```

### 3.3 设置 TTL

```bash
# 批量设置 TTL（扫描 + 设置）
SCAN 0 MATCH cache:* COUNT 1000
# 对每个 key 执行 EXPIRE

# TTL 随机化防雪崩
EXPIRE key (300 + random(60))
```

### 3.4 maxmemory 配置

```bash
maxmemory 4gb                    # 设为物理内存的 60%~80%
maxmemory-policy allkeys-lfu     # 淘汰策略
maxmemory-samples 10             # 采样数
```

## 4. 网络优化

| 手段 | 说明 | 适用场景 |
| :-- | :-- | :-- |
| Pipeline | 批量命令，减少 RTT | 批量读写 |
| 连接池 | 复用连接，避免建连开销 | 所有场景 |
| 长连接 | 避免短连接反复握手 | 所有场景 |
| 避免大 Key | 大 Key 占带宽 | 所有场景 |
| Lua 脚本 | 逻辑在服务端执行，减少交互 | 复合操作 |

## 5. 持久化调优

| 配置 | 影响 | 建议 |
| :-- | :-- | :-- |
| `appendfsync always` | 每条命令刷盘 | 除非强一致，否则不用 |
| `appendfsync everysec` | 每秒刷盘 | 生产推荐 |
| `save 900 1` | BGSAVE 频率 | 根据数据重要程度调整 |
| `rdb-save-incremental-fsync` | 增量 fsync | 大 RDB 文件时开启 |
| `no-appendfsync-on-rewrite` | 重写时不 fsync | 可开启，减少重写期间 IO |

## 6. 大 Key 治理

大 Key 是性能问题的常见根因：

```bash
# 发现大 Key
redis-cli --bigkeys

# 拆分大 Hash
HGETALL user:1001:profile  # 100 个 field
# 拆为：user:1001:basic、user:1001:extra、...

# 异步删除大 Key
UNLINK bigkey   # 而非 DEL
```

## 7. 生产调优清单

| 类别 | 检查项 | 建议值 |
| :-- | :-- | :-- |
| 内存 | `maxmemory` | 物理内存的 60%~80% |
| 内存 | `maxmemory-policy` | `allkeys-lfu` |
| 持久化 | `appendfsync` | `everysec` |
| 持久化 | 主节点持久化 | 必须开启 |
| 慢查询 | `slowlog-log-slower-than` | 10000（10ms） |
| 连接 | 连接池 | 必须使用 |
| 命令 | 无 KEYS/大 DEL | SCAN/UNLINK 替代 |
| 监控 | 内存/延迟/命中率 | 已接入告警 |
