# Redis 命令速查

## String

| 命令 | 说明 |
|------|------|
| `SET key value [EX seconds] [NX\|XX]` | 设置值，EX=过期秒数，NX=不存在才设置 |
| `GET key` | 获取值 |
| `MSET k1 v1 k2 v2` | 批量设置 |
| `MGET k1 k2` | 批量获取 |
| `INCR key` / `INCRBY key n` | 自增 |
| `APPEND key value` | 追加 |
| `STRLEN key` | 长度 |

## Hash

| 命令 | 说明 |
|------|------|
| `HSET key field value` | 设置字段 |
| `HGET key field` | 获取字段 |
| `HMSET key f1 v1 f2 v2` | 批量设置 |
| `HGETALL key` | 获取所有字段和值 |
| `HINCRBY key field n` | 字段自增 |
| `HDEL key field` | 删除字段 |
| `HKEYS key` / `HVALS key` | 所有字段名 / 所有值 |

## List

| 命令 | 说明 |
|------|------|
| `LPUSH key value` | 左端插入 |
| `RPUSH key value` | 右端插入 |
| `LPOP key` | 左端弹出 |
| `RPOP key` | 右端弹出 |
| `LRANGE key start stop` | 范围查询 |
| `LLEN key` | 长度 |
| `BLPOP key timeout` | 阻塞弹出 |

## Set

| 命令 | 说明 |
|------|------|
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
|------|------|
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
|------|------|
| `DEL key` | 删除（阻塞） |
| `UNLINK key` | 异步删除（非阻塞） |
| `EXISTS key` | 是否存在 |
| `EXPIRE key seconds` | 设置过期时间 |
| `TTL key` | 剩余过期时间 |
| `TYPE key` | 数据类型 |
| `SCAN cursor [MATCH pattern] [COUNT n]` | 游标迭代（不阻塞） |
| `KEYS pattern` | 匹配 key（阻塞，仅调试用） |
