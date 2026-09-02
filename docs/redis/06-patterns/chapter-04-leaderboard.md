# 排行榜

> 排行榜按分数排序，返回 Top N 或某个成员的排名。ZSet 是它的天然载体，但真正的难点不在「排序」，而在复合分数、同分并列、分段榜单这些工程细节。本章从基础用法讲起，逐个拆解这些坑。

## 1. ZSet 为什么适配排行榜

ZSet 的 member 唯一、score 是 64 位浮点数，内部由跳表（skiplist）+ 哈希表实现，排序、范围查询、按成员查分数都是 O(log N)。排行榜的每个需求都能对应到一条命令：

| 需求 | 命令 | 说明 |
| :-- | :-- | :-- |
| 更新分数 | `ZINCRBY` | 原子递增，天然支持「加分」 |
| 取 Top N | `ZREVRANGE` | 按 score 降序 |
| 查某成员排名 | `ZREVRANK` | 返回 0 起的降序排名 |
| 查某成员分数 | `ZSCORE` | 单点查询 |
| 分数区间 | `ZRANGEBYSCORE` | 按分数段过滤 |

## 2. 基础用法

```java
private final StringRedisTemplate redis;

/** 加分（不存在则创建） */
public void addScore(String playerId, int delta) {
    redis.opsForZSet().incrementScore("rank:game", playerId, delta);
}

/** 取 Top 10 及分数 */
public List<PlayerScore> topN(int n) {
    Set<ZSetOperations.TypedTuple<String>> set =
        redis.opsForZSet().reverseRangeWithScores("rank:game", 0, n - 1);
    List<PlayerScore> result = new ArrayList<>();
    for (ZSetOperations.TypedTuple<String> t : set) {
        result.add(new PlayerScore(t.getValue(), t.getScore()));
    }
    return result;
}

/** 查某玩家排名（0 起，不存在返回 null） */
public Long rankOf(String playerId) {
    return redis.opsForZSet().reverseRank("rank:game", playerId);
}
```

`ZREVRANK` 返回的是 0 起的排名，第 1 名返回 0。业务上需要显示「第 N 名」时 +1 即可。

## 3. 复合分数：多维度排序

真实排行榜很少只按单一分数排序，常见「先按积分，积分相同按先达成者靠前」。ZSet 只有一个 score，只能把多个维度编码进这一个数字里。

### 3.1 位数的坑

score 是 IEEE 754 双精度浮点数，整数能精确表示到 `2^53 - 1 ≈ 9.007 × 10^15`，即最多约 16 位十进制数。复合编码的本质是把高位留给主维度、低位留给次维度：

```text
score = 主分数 × 10^K + 次维度（占 K 位）
```

`K` 的取值必须让两部分都不溢出，否则主分数增长后会「吃掉」次维度的位。举例：

- 积分预留 6 位（最大 999999）
- 次维度预留 9 位（最大 999999999，约 31 年秒级）
- 总共 15 位，最大 `999999 × 10^9 + 999999999 ≈ 9.999 × 10^14`，安全

若次维度用毫秒时间戳（13 位），主分数就只剩 3 位，积分超过 999 就溢出。所以实战中常用**秒级时间戳**作为次维度，而不是毫秒。

### 3.2 积分 + 先到先得

「同分先达成者靠前」可以用「当前时间 - 达成时间」作为次维度：达成越早，差值越大，越靠前。

```java
private static final long MAX_TS = 4_000_000_000L;  // 2106 年左右的秒级上限

/** 计算复合分数：主维度积分，次维度先到先得 */
public double compositeScore(int points, long achieveAtSec) {
    // 积分占高位（× 10^10），次维度占 10 位（秒级时间差）
    return points * 10_000_000_000L + (MAX_TS - achieveAtSec);
}
```

写入时用 `ZADD`（不能用 `ZINCRBY`，因为复合分数不可直接相加）：

```java
public void updateComposite(String playerId, int points, long achieveAtSec) {
    redis.opsForZSet().add("rank:game:composite", playerId, compositeScore(points, achieveAtSec));
}
```

取 Top N 时先取出复合分数，再解码回积分的整数部分：

```java
public int decodePoints(double composite) {
    return (int) (composite / 10_000_000_000L);
}
```

::: warning 复合分数的代价
一旦编码成复合分数，`ZINCRBY` 就不可用了——加分必须「取出旧分数 → 解码 → 重新编码 → 写回」，且中间需要 Lua 保证原子。简单榜单优先用 `ZINCRBY`，只有明确多维度需求时才上复合编码。
:::

### 3.3 时间衰减

按时间衰减的榜单（热度榜）有两种做法：

| 做法 | 原理 | 适用 |
| :-- | :-- | :-- |
| 分数定期衰减 | 定时把全部分数乘以衰减因子 | 简单，但全量遍历成本高 |
| 时间窗口分段 | 只统计最近一段窗口（如近 24 小时） | 更符合「热度」语义 |

时间窗口分段配合 §5 的 `ZUNIONSTORE` 合并，能灵活拼出「近 24 小时」「近 7 天」榜单，不必维护一个会持续膨胀的单一 key。

## 4. 同分并列的两种语义

`ZREVRANK` 返回的是「比赛排名」：三个同分成员分别返回 0、1、2，对应名次 1、2、3。但竞赛榜单常要求「密集排名」：三个并列第一，下一个是第二名（1、1、1、2）。

```text
score：100  100  100  90
比赛排名：1   2    3    4     ← ZREVRANK 语义
密集排名：1   1    1    2     ← 业务常需要
```

密集排名不能靠单条命令得到，需要业务层转换：取出 Top N 后，遍历分数，分数与前一个相同时沿用上一个名次，否则用下标 + 1。

```java
public List<RankItem> denseRank(int n) {
    Set<ZSetOperations.TypedTuple<String>> set =
        redis.opsForZSet().reverseRangeWithScores("rank:game", 0, n - 1);
    List<RankItem> result = new ArrayList<>();
    double lastScore = Double.NaN;
    int dense = 0;
    for (ZSetOperations.TypedTuple<String> t : set) {
        if (t.getScore() != lastScore) {
            dense++;
            lastScore = t.getScore();
        }
        result.add(new RankItem(t.getValue(), dense));
    }
    return result;
}
```

::: tip 利用 member 字典序做次排序
ZSet 在 score 相同时按 member 字典序排序。若「先到先得」恰好能对应字典序（如 member 编码为 `时间戳:用户ID`），可以省去复合分数，让同分时时间戳小的自然靠前。但要注意 `ZREVRANGE` 降序时 member 字典序也会倒序，方向需要验证。
:::

## 5. 分段榜单与合并

按时间分 key（日榜），再按需合并成周榜、月榜，避免单一 key 无限膨胀：

```bash
# 每日榜
ZINCRBY rank:day:20260901 10 player:1001
ZINCRBY rank:day:20260902 20 player:1001

# 合并近 7 天为周榜（SUM 聚合）
ZUNIONSTORE rank:week 7 rank:day:20260901 rank:day:20260902 rank:day:20260903 rank:day:20260904 rank:day:20260905 rank:day:20260906 rank:day:20260907
```

`ZUNIONSTORE` 会把多个 ZSet 的 score 按聚合方式（默认 SUM）合并到目标 key。合并结果是静态快照，适合「昨天之前的数据」，今天的实时数据仍需单独查再拼接。

## 6. 大榜的性能与内存

ZSet 每个成员占用约 64 字节（member + score + 跳表指针）。百万级成员约 100 MB，千万级约 1 GB。大榜需要主动控制：

| 手段 | 做法 |
| :-- | :-- |
| 裁剪 | 只保留 Top N，`ZREMRANGEBYRANK rank 0 -(N+1)` 删掉 N 名之后 |
| 分段 | 按天/周分 key，历史榜下沉到数据库 |
| 冷热分离 | 实时榜在 Redis，全量榜在数据库离线计算 |

高并发写入的另一个问题是单 key 热点：所有玩家都往同一个 ZSet 写，这个 key 成为瓶颈。做法是分片——按 `playerId % 分片数` 落到不同 ZSet，读取时用 `ZUNIONSTORE` 合并。分片数一般取 2 的幂，便于一致性哈希扩展。

## 7. 最佳实践

| 实践 | 说明 |
| :-- | :-- |
| 简单榜单用 `ZINCRBY` | 单维度加分不要上复合分数 |
| 复合分数算清位数 | 总位数不超过 16，主维度溢出会串位 |
| 次维度用秒不用毫秒 | 毫秒占 13 位，挤占主维度空间 |
| 明确并列语义 | 比赛排名 vs 密集排名，业务上先对齐 |
| 按时间分段 | 日榜周榜月榜分开，别堆一个 key |
| 大榜主动裁剪 | 只留 Top N，历史数据下沉数据库 |
| 热 key 分片 | 高并发写入按成员哈希分片，读时合并 |
