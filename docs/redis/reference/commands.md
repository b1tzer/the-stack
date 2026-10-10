# Redis 常用命令速查

本页列出五种基础类型和常用通用命令，适用于 Redis 7.4.11。它是任务速查，不是完整命令手册；执行前请结合[官方命令参考](https://redis.io/docs/latest/commands/)核对参数、复杂度和适用版本。

命令说明中的“阻塞”表示命令可能占用主线程到操作完成，实际耗时取决于 Key 大小和数据量。

## String

| 命令 | 说明 |
| :-- | :-- |
| `SET key value [EX seconds] [NX\|XX]` | 设置值，EX=过期秒数，NX=不存在才设置 |
| `GET key` | 获取值 |
| `MSET k1 v1 k2 v2` | 批量设置 |
| `MGET k1 k2` | 批量获取 |
| `INCR key` / `INCRBY key n` | 自增 |
| `APPEND key value` | 追加 |
| `STRLEN key` | 长度 |

## Hash

| 命令 | 说明 |
| :-- | :-- |
| `HSET key field value [field value ...]` | 设置一个或多个字段 |
| `HGET key field` | 获取字段 |
| `HGETALL key` | 获取所有字段和值 |
| `HINCRBY key field n` | 字段自增 |
| `HDEL key field` | 删除字段 |
| `HKEYS key` / `HVALS key` | 所有字段名 / 所有值 |

## List

| 命令 | 说明 |
| :-- | :-- |
| `LPUSH key value` | 左端插入 |
| `RPUSH key value` | 右端插入 |
| `LPOP key` | 左端弹出 |
| `RPOP key` | 右端弹出 |
| `LRANGE key start stop` | 范围查询 |
| `LLEN key` | 长度 |
| `BLPOP key timeout` | 阻塞弹出 |

## Set

| 命令 | 说明 |
| :-- | :-- |
| `SADD key member` | 添加成员 |
| `SREM key member` | 删除成员 |
| `SMEMBERS key` | 所有成员 |
| `SISMEMBER key member` | 是否存在 |
| `SINTER k1 k2` | 交集 |
| `SUNION k1 k2` | 并集 |
| `SDIFF k1 k2` | 差集 |
| `SRANDMEMBER key n` | 随机取 n 个 |

## Sorted Set

| 命令 | 说明 |
| :-- | :-- |
| `ZADD key score member` | 添加带分数的成员 |
| `ZSCORE key member` | 获取分数 |
| `ZRANGE key start stop [WITHSCORES]` | 按分数升序 |
| `ZREVRANGE key start stop` | 按分数降序 |
| `ZRANGEBYSCORE key min max` | 分数范围查询 |
| `ZINCRBY key n member` | 分数自增 |
| `ZREM key member` | 删除成员 |
| `ZCARD key` | 成员数量 |
| `ZRANK key member` | 排名（升序） |

## 通用

| 命令 | 说明 |
| :-- | :-- |
| `DEL key` | 同步删除；大值可能阻塞主线程 |
| `UNLINK key` | 先解除 Key，再由后台线程回收内存 |
| `EXISTS key` | 是否存在 |
| `EXPIRE key seconds` | 设置过期时间 |
| `TTL key` | 剩余过期时间 |
| `TYPE key` | 数据类型 |
| `SCAN cursor [MATCH pattern] [COUNT n]` | 游标迭代（不阻塞） |
| `KEYS pattern` | 匹配 key（阻塞，仅调试用） |

## 阻塞与复杂度边界

| 命令 | 复杂度或执行特征 | 使用边界 |
| :-- | :-- | :-- |
| `HGETALL` / `HKEYS` / `HVALS` | O(N)，返回整个 Hash | 大 Hash 可能长时间占用执行线程和输出带宽，改用 `HSCAN` 或按字段读取 |
| `SMEMBERS` | O(N)，返回整个 Set | 大 Set 改用 `SSCAN` |
| `SINTER` / `SUNION` / `SDIFF` | 与输入集合规模相关，可能 O(N+M) | 先评估集合大小和结果规模 |
| `ZRANGEBYSCORE` / `ZREVRANGE` | O(log(N)+M) | 用 `LIMIT` 控制返回数量 |
| `DEL` | 按删除的对象结构增长，可能长时间同步回收 | 大值优先评估 `UNLINK` 的后台回收行为 |
| `KEYS` | O(N) 遍历整个键空间 | 生产环境使用 `SCAN` 迭代 |

`SCAN`、`HSCAN`、`SSCAN` 和 `ZSCAN` 每次调用的游标推进是有界的，但迭代期间发生增删时可能重复或遗漏元素，不能当作一致性快照。
