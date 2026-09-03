# 五种基础数据类型

> Redis 对外暴露五种基础数据类型：String、Hash、List、Set、ZSet。它们是 Redis 一切能力的起点——每种类型对应一套独立的命令集，也对应一类典型的使用场景。本章逐一拆解每种类型的语义、命令与适用场景。

## 1. String：单值存储与原子操作 {#string}

String 是 Redis 最基础的类型，一个 key 对应一个 value，value 可以是字符串、整数或二进制数据。

```txt
key  →  value（单个值）

"user:123:name"  →  "张三"
"article:views"  →  1024
"session:abc"    →  "{...json...}"
```

**核心能力**：除了最基本的 `SET/GET`，String 提供了原子自增（`INCR`）和原子互斥（`SETNX`）两类关键原语。

```bash
SET key value [EX seconds] [NX]   # 设置值，NX=不存在才设置
GET key                            # 获取值
MSET k1 v1 k2 v2                   # 批量设置

INCR key                           # 原子自增（计数器）
INCRBY key 5                       # 原子增加指定值
SETNX key value                    # 不存在才设置（分布式锁基础）
```

**典型场景**：

- **缓存**：`SET user:123 "{name:'张三'}" EX 300`（单值缓存天然匹配）
- **计数器**：`INCR article:123:views`（原子操作，无并发问题）
- **分布式锁**：`SET lock:order uuid NX PX 30000`（NX 确保互斥）

> 不要用 String 存整个 JSON 对象来模拟对象存储——更新时需要全量覆盖，并发场景下会互相覆盖。应该用 Hash 存储对象字段（见 2.2 节）。

底层编码：`int`（整数）、`embstr`（短字符串 ≤ 44 字节）、`raw`（长字符串），详见 [对象编码](./chapter-05-object-encoding.md)。

## 2. Hash：对象的字段集合

Hash 是一个 key 对应一组 field-value，类似 Java 的 `HashMap`，适合存储一个对象的多个属性。

```txt
key  →  { field1: value1, field2: value2, ... }

"user:123"  →  {
    "name":  "张三",
    "age":   "25",
    "email": "zhangsan@qq.com"
}
```

**和 String 存 JSON 的区别**：

| 存储方式 | 更新单个字段 | 内存效率 | 并发安全 |
| :-- | :-- | :-- | :-- |
| String 存 JSON | 需全量覆盖，O(n) | 较差（含 JSON 格式开销） | 有并发覆盖风险 |
| Hash 存字段 | 独立更新，O(1) | 较好（无格式开销） | 原子操作安全 |

**常用命令**：

```bash
HSET user:123 name "张三" age 25   # 设置字段
HGET user:123 name                  # 获取单个字段
HMGET user:123 name age             # 批量获取字段
HGETALL user:123                    # 获取所有字段
HINCRBY user:123 age 1              # 字段自增
HDEL user:123 age                   # 删除字段
```

**典型场景**：

- **用户信息存储**：每个字段独立更新，避免全量覆盖
- **购物车**：`HSET cart:user123 product:456 2`（商品 ID → 数量）

## 3. List：有序的可重复列表

List 是一个 key 对应一组有序、可重复的字符串，底层是双向链表结构，支持从两端插入和弹出。

```txt
key  →  [ v1, v2, v3, ... ]（有序，可重复）

"news:list"  →  ["文章3", "文章2", "文章1"]   ← 左边是最新
"task:queue" →  ["任务A", "任务B", "任务C"]   ← 右边是最早入队
```

**特点**：有序、可重复、两端操作（左进左出 = 栈，右进左出 = 队列）、支持阻塞弹出（`BLPOP`）。

**常用命令**：

```bash
LPUSH list v1 v2 v3    # 从左侧插入（栈）
RPUSH list v1 v2 v3    # 从右侧插入（队列）
LPOP list              # 从左侧弹出
RPOP list              # 从右侧弹出
LRANGE list 0 -1       # 获取所有元素
LLEN list              # 获取长度
BLPOP list 10          # 阻塞弹出，等待最多 10 秒（消息队列）
```

**典型场景**：

- **消息队列**：`RPUSH queue msg` + `BLPOP queue 0`（阻塞消费）
- **最新动态**：`LPUSH news article1`，`LRANGE news 0 9` 取最新 10 条
- **分页列表**：`LRANGE list (page-1)*size page*size-1`

## 4. Set：无序去重集合

Set 是一个 key 对应一组无序、不重复的字符串，核心特性是自动去重，并支持集合间的交、并、差运算。

```txt
key  →  { v1, v2, v3, ... }（无序，不重复）

"user:123:friends" →  {"uid:456", "uid:789", "uid:101"}
"user:456:friends" →  {"uid:123", "uid:789"}

// 共同好友 = SINTER user:123:friends user:456:friends
// 结果: {"uid:789"}
```

**常用命令**：

```bash
SADD tags "Java" "Redis" "MySQL"   # 添加元素
SMEMBERS tags                       # 获取所有元素
SISMEMBER tags "Java"               # 判断是否存在
SINTER tags1 tags2                  # 交集（共同好友）
SUNION tags1 tags2                  # 并集
SDIFF tags1 tags2                   # 差集
SRANDMEMBER tags 3                  # 随机取 3 个（抽奖）
SCARD tags                          # 元素数量
```

**典型场景**：

- **标签系统**：`SADD user:123:tags "Java" "后端"`
- **共同好友**：`SINTER user:123:friends user:456:friends`
- **抽奖**：`SRANDMEMBER lottery 3`（随机不重复抽取）
- **UV 统计**：`SADD uv:20240101 user123`（自动去重）

## 5. ZSet：带分值的有序集合

ZSet（Sorted Set）是一个 key 对应一组有序、不重复的成员，每个成员关联一个浮点数 score，Redis 按 score 自动排序。

```txt
key  →  { member1: score1, member2: score2, ... }（按 score 自动排序）

"leaderboard"  →  {
    "张三": 100,
    "王五": 150,
    "李四": 200     ← score 越大排名越靠前
}

"delay:queue"  →  {
    "task:A": 1712500000,   ← score 是执行时间戳
    "task:B": 1712500060
}
```

**特点**：成员不重复、score 可相同、按 score 自动排序、支持范围查询，同时维护一个哈希表可 O(1) 查某个成员的 score。

**常用命令**：

```bash
ZADD rank 100 "张三" 200 "李四"    # 添加元素（score member）
ZRANGE rank 0 -1 WITHSCORES        # 按 score 升序获取
ZREVRANGE rank 0 9                 # 按 score 降序获取前 10
ZRANGEBYSCORE rank 100 200         # 按 score 范围查询
ZSCORE rank "张三"                 # 获取某成员的 score
ZRANK rank "张三"                  # 获取排名（从 0 开始）
ZINCRBY rank 50 "张三"             # 增加 score
```

**典型场景**：

- **排行榜**：`ZADD leaderboard score userId`，`ZREVRANGE leaderboard 0 9` 取 Top10
- **延迟队列**：score 存执行时间戳，定时 `ZRANGEBYSCORE queue 0 now` 取到期任务
- **热搜词**：`ZINCRBY hot:search 1 "关键词"`，`ZREVRANGE hot:search 0 9` 取 Top10

## 6. 五种类型速查

| 类型 | 命令前缀 | 有序 | 可重复 | 典型场景 |
| :-- | :-- | :-- | :-- | :-- |
| String | `SET/GET/INCR` | — | — | 缓存、计数器、分布式锁 |
| Hash | `HSET/HGET` | 否 | field 不重复 | 对象存储、购物车 |
| List | `LPUSH/RPOP` | 是 | 是 | 消息队列、最新列表 |
| Set | `SADD/SINTER` | 否 | 否 | 标签、共同好友、抽奖 |
| ZSet | `ZADD/ZRANGE` | 是（按 score） | 否 | 排行榜、延迟队列 |

> String 存单值，Hash 存对象，List 做队列，Set 做去重，ZSet 做排行榜。

