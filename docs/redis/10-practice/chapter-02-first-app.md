# 第一个 Redis 应用

> 打开 `redis-cli`，把五种基础类型各跑一个真实场景，再补上分布式锁——这是 Redis 最常用的几个套路。命令后带 `#` 的注释是「你预期会看到的返回」，边敲边对照。

## 1. String：计数器

String 最典型的用法是原子计数。单线程保证 `INCR` 原子，100 个请求同时点进来也不会算错。

```bash
# 页面访问计数
INCR page:home:views           # (integer) 1
GET page:home:views            # "1"

# 每日计数（用日期做 key）
INCR counter:2026-08-31:login  # (integer) 1
EXPIRE counter:2026-08-31:login 86400

# 文章阅读量
SET article:1001:views 0       # OK
INCR article:1001:views        # (integer) 1
INCRBY article:1001:views 10   # (integer) 11  一次加 10
GET article:1001:views         # "11"
```

## 2. String：缓存层

读多写少的数据用缓存层扛住流量，遵循 Cache-Aside 模式。

```bash
# 查询时先查缓存
GET user:1001

# 缓存未命中，查数据库后写入
SET user:1001 '{"id":1001,"name":"alice"}' EX 3600

# 更新时删除缓存
DEL user:1001
```

## 3. Hash：购物车

购物车是典型的「一个对象多个字段」，用 Hash 存，商品 ID 做 field、数量做 value。

```bash
HSET cart:u001 p001 2 p002 1   # (integer) 2  加入两件商品
HINCRBY cart:u001 p001 1       # (integer) 3  p001 数量 +1
HGET cart:u001 p001            # "3"
HGETALL cart:u001              # 1) "p001" 2) "3" 3) "p002" 4) "1"
HDEL cart:u001 p002            # (integer) 1  删除商品
```

## 4. List：消息队列

List 两端操作 + `BLPOP` 阻塞弹出，是做简单任务队列的经典用法。

两个终端配合：终端 A 作为消费者阻塞等待，终端 B 作为生产者入队。

```bash
# 终端 A（消费者）：阻塞等待，最多等 30 秒
BLPOP task:queue 30
```

```bash
# 终端 B（生产者）：入队一条任务
RPUSH task:queue "send_email:user123"   # (integer) 1
```

终端 A 立即弹出结果：

```bash
1) "task:queue"
2) "send_email:user123"
(12.03s)
```

> `BLPOP` 的妙处：队列为空时消费者不会空转轮询，而是挂起等待，省 CPU。

## 5. Set：共同好友

Set 自动去重 + 集合运算，算共同好友、做推荐一条命令搞定。

```bash
SADD friend:u1 u2 u3 u4      # (integer) 3
SADD friend:u2 u1 u3 u5      # (integer) 3
SINTER friend:u1 friend:u2   # 1) "u3"  共同好友
SDIFF friend:u1 friend:u2    # 1) "u4"  我关注了但对方没有（可做推荐）
SISMEMBER friend:u1 u2       # (integer) 1  判断是否已关注
```

## 6. ZSet：排行榜

ZSet 按 score 自动排序，`ZADD` 写分、`ZINCRBY` 改分、`ZREVRANGE` 取 TopN，一条命令搞定排序 + 范围查询。

```bash
# 添加分数
ZADD leaderboard 100 "alice" 85 "bob" 92 "charlie"   # (integer) 3

# Top 3（降序）
ZREVRANGE leaderboard 0 2 WITHSCORES
# 1) "alice"  2) "100"
# 3) "charlie" 4) "92"
# 5) "bob"     6) "85"

# 查询排名
ZREVRANK leaderboard "alice"   # (integer) 0  排名从 0 起

# 加分后名次上升
ZINCRBY leaderboard 50 "alice" # (integer) 150
ZRANK leaderboard "alice"      # (integer) 0  仍是第 1 名
```

## 7. 分布式锁

并发下「读-改-写」操作会互相覆盖，用 `SET NX EX` 原子加锁，Lua 保证解锁安全。

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

> 锁必须带过期时间（防死锁），解锁必须校验归属（防误删别人的锁）。
