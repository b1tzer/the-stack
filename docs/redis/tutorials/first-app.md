# 第一个 Redis 应用

> 用 Redis 实现一个简单的计数器和缓存层。

## 1. 计数器

```bash
# 页面访问计数
INCR page:home:views
GET page:home:views

# 每日计数（用日期做 key）
INCR counter:2026-08-31:login
EXPIRE counter:2026-08-31:login 86400
```

## 2. 缓存层

```bash
# 查询时先查缓存
GET user:1001

# 缓存未命中，查数据库后写入
SET user:1001 '{"id":1001,"name":"alice"}' EX 3600

# 更新时删除缓存
DEL user:1001
```

## 3. 分布式锁

```bash
# 加锁（NX=不存在才设置，EX=过期时间）
SET lock:order:1001 $request_id NX EX 30

# 解锁（Lua 脚本保证原子性）
EVAL "
  if redis.call('get', KEYS[1]) == ARGV[1] then
    return redis.call('del', KEYS[1])
  else
    return 0
  end
" 1 lock:order:1001 $request_id
```

## 4. 排行榜

```bash
# 添加分数
ZADD leaderboard 100 "alice"
ZADD leaderboard 85 "bob"
ZADD leaderboard 92 "charlie"

# Top 3（降序）
ZREVRANGE leaderboard 0 2 WITHSCORES

# 查询排名
ZREVRANK leaderboard "alice"
```
