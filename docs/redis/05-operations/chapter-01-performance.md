# 性能优化

> Redis 性能优化不是玄学，而是围绕几个核心维度：慢命令、内存、网络、持久化。本章先建立指标体系，再逐维度讲解优化手段。

## 1. 指标体系

评估 Redis 性能，先看这几个关键指标：

| 指标 | 含义 | 获取方式 |
| :-- | :-- | :-- |
| QPS | 每秒处理请求数 | `INFO stats` |
| 延迟 | 单命令响应时间 | `redis-cli --latency` |
| 内存 | 内存使用与碎片 | `INFO memory` |
| 命中率 | 缓存命中比例 | 计算 keyspace_hits / (hits+misses) |
| 连接数 | 客户端连接数 | `INFO clients` |

```bash
redis-cli --latency          # 测试延迟
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
CONFIG SET slowlog-log-slower-than 10000   # 超过 10ms 记为慢查询
```

### 2.2 常见慢命令与替代

| 慢命令 | 问题 | 替代方案 |
| :-- | :-- | :-- |
| `KEYS *` | 全量遍历，O(n)，阻塞 | `SCAN` 游标分批遍历 |
| `HGETALL` 大 Hash | 返回全部字段 | `HSCAN` 分批获取 |
| `SMEMBERS` 大 Set | 返回全部元素 | `SSCAN` 分批获取 |
| `DEL` 大 Key | 同步删除阻塞 | `UNLINK` 异步删除 |
| `FLUSHALL` | 清空全部数据 | 避免在生产环境使用 |

> `SCAN` 系列基于游标分批遍历，不会一次性阻塞主线程，是 `KEYS`、`HGETALL` 等全量命令的安全替代。

## 3. 内存优化

内存优化从「选对结构」「控制规模」「合理过期」三方面入手。

| 手段 | 说明 |
| :-- | :-- |
| 选对结构 | 对象用 Hash 而非 String 存 JSON（见第一卷） |
| 控制编码 | 小数据用紧凑编码，避免触发升级 |
| 设置 TTL | 无过期时间的 key 会永久占内存 |
| TTL 随机 | 避免同时过期引发雪崩（见第三卷） |
| 淘汰策略 | 设置 maxmemory + 合适淘汰策略 |

```bash
CONFIG SET maxmemory 4gb
CONFIG SET maxmemory-policy allkeys-lru
```

## 4. 网络优化

| 手段 | 说明 |
| :-- | :-- |
| Pipeline | 批量命令，减少网络往返（见第四卷） |
| 避免大 Key | 大 Key 占用带宽，拖慢传输 |
| 连接池 | 复用连接，避免频繁建连/断连 |
| 长连接 | 避免短连接反复 TCP 握手 |

## 5. 持久化对性能的影响

持久化会消耗 CPU 和磁盘 IO，需要合理配置：

| 配置 | 影响 | 建议 |
| :-- | :-- | :-- |
| `appendfsync always` | 每条命令刷盘，性能最差 | 除非强一致，否则不用 |
| `appendfsync everysec` | 每秒刷盘，性能较好 | 生产推荐 |
| 频繁 BGSAVE | fork 停顿 | 控制 save 触发频率 |
| 大内存 fork | fork 耗时增加 | 大内存实例关注 fork 停顿 |

> 持久化的性能影响主要来自两个点：fsync 刷盘的磁盘 IO，以及 fork 子进程的 CPU 与内存开销。性能敏感场景要重点评估这两点。
