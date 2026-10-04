# 高并发计数

> 点赞数、浏览量、库存数，这类计数器有一个共同点，读多写多，且写是高频的加一操作。直接每次加一都落数据库，数据库扛不住。本章只回答一个问题，高频计数怎么扛住并发，又不丢数。

## 1. 直接落库的问题

最直观的写法是每次点赞都更新数据库。

```sql
UPDATE t_article SET like_count = like_count + 1 WHERE id = ?;
```

问题不在正确性，在压力。一条热点内容的点赞是每秒上千上万次，每次都打数据库，热点行的行锁会成为瓶颈，其他事务排队等这一行。计数器是典型的「写热点」，所有写都命中同一行。

## 2. Redis 原子计数

把计数放进 Redis，用单条 `INCRBY` 原子加一。

```java
redis.opsForValue().increment("like:article:" + articleId);
```

Redis 单线程处理命令，`INCRBY` 天然原子，没有行锁排队的问题，性能比数据库高出几个数量级。读计数用 `GET` 或 `DECRBY`，也全在 Redis 里完成。

到这里解决了性能，但引入了一个新问题，Redis 是内存，重启或宕机可能丢数据，而数据库才是最终归宿。计数不能只存在 Redis 里。

## 3. 异步落库

折中方案是计数先写 Redis，异步刷回数据库。请求只碰 Redis，落库交给后台。

```java
@Scheduled(fixedRate = 5000)
public void flush() {
    // 每 5 秒把 Redis 里的增量刷回数据库
    Long delta = redis.opsForValue().getAndSet("like:article:" + articleId, "0");
    if (delta != null && delta != 0) {
        articleMapper.incrementLikeCount(articleId, delta);
    }
}
```

这个写法有个隐蔽的坑。`getAndSet` 取走增量并归零，如果取走之后、写库之前进程崩溃，这一段增量就永久丢了。Redis 里归零了，数据库里也没加上。

要缓解丢失，要么把「取增量」和「落库」放进同一条流水，落库成功才允许清 Redis；要么接受计数有极小概率少算几个，用定时对账兜底。多数点赞、浏览量场景，少算几个的代价远低于引入复杂的一致机制，值得接受。

## 4. 丢数据与精确性的取舍

计数场景要分清两个问题，性能是第一位，精确性是第二位，且两者常常冲突。

要绝对精确，就得每次加一都同步落库，回到热点行锁的老问题。要性能，就得接受 Redis 到数据库这段异步窗口里可能丢增量。

判断依据是这个计数参与不参与核心业务。点赞数、浏览量，少算几个没人发现，用 Redis 计数加异步落库，丢了也能接受。库存数、余额，少算一个都是事故，不能走异步，得回到 [库存扣减并发控制](./chapter-01-inventory-deduction.md) 里那些强一致方案。

一句话，计数分两类，展示用的可以异步丢一点，交易用的必须同步精确。

## 5. 相关章节

计数器的异步落库本质是一致性问题，和缓存的 [Cache Aside 写路径](../01-cache/chapter-02-cache-write-patterns.md) 面临同一类「内存先写、存储后到」的窗口。Redis 的持久化与数据丢失风险见 [Redis 持久化](../../redis/02-standalone-core/chapter-05-persistence.md)。
