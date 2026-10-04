# 库存扣减的并发控制

> 多个请求同时扣减同一个商品的库存，怎么保证不超卖。这是电商里最经典的并发问题，也是分布式锁和幂等设计绕不开的起点。

## 1. 超卖是怎么发生的

扣库存的朴素写法是「先查后扣」，先读出剩余库存，判断是否够，够了再减。这两步不是原子操作，并发下就会出问题。

```java
// 有问题的写法
int stock = skuMapper.selectStock(skuId);   // 读到 10
if (stock >= quantity) {                     // 两个线程都通过了判断
    skuMapper.deduct(skuId, quantity);       // 各扣 1，最终 9，而不是 8
}
```

两个请求同时读到 `stock = 10`，都判断够，各自扣减后写回 9。实际卖了两件，库存却只少了 1。超卖的本质是「判断」和「扣减」之间插入了另一个请求的写。

修这个问题只有一条思路，让「判断够不够」和「扣减」变成一个不可分割的动作。下面三种方案用不同的方式实现这个原子性。

## 2. 悲观锁

`SELECT ... FOR UPDATE` 在事务里把目标行锁住，其他事务要动这行就得排队。锁住之后，读、判断、扣减都在排他的前提下完成，不会被打断。

```sql
BEGIN;
SELECT stock FROM t_sku WHERE sku_id = 1001 FOR UPDATE;  -- 锁行
-- 应用层判断 stock >= quantity
UPDATE t_sku SET stock = stock - quantity WHERE sku_id = 1001;
COMMIT;
```

它的代价是吞吐。同一行同一时刻只有一个事务在操作，其余都在等锁，商品越热排队越长。悲观锁只适合并发不高、库存行数少的场景，一般说 500 TPS 以内。

## 3. 乐观锁

乐观锁不锁行，改用在 UPDATE 里带条件。只有「库存没被别的请求改过」这个前提成立时扣减才生效，前提不成立就失败重试。

```java
int updated = skuMapper.deductIfEnough(skuId, quantity, version);
// SQL: UPDATE t_sku SET stock = stock - quantity, version = version + 1
//      WHERE sku_id = ? AND stock >= quantity AND version = ?
if (updated == 0) {
    // 有人先扣了，或库存不够，重试或返回失败
}
```

乐观锁的代价是重试。并发越高冲突越多，重试越频繁，但好处是没有锁等待，请求不会因排队卡住。高并发下多数请求一次成功，少数重试一两次，整体吞吐远高于悲观锁。

这里有个隐蔽的坑，重试必须设上限，并且区分「库存不足」和「版本冲突」两种失败。库存不足该直接返回，不能再重试；版本冲突才值得重试。混在一起重试，会把「真没货了」变成死循环。

乐观锁版本号防并发覆盖、防重复生效的通用原理，见 [幂等性设计](../02-concurrency/chapter-03-idempotency.md)。

## 4. Redis 预扣

前两种方案扣的都是数据库行，瓶颈在数据库。Redis 单线程，`DECRBY` 天然原子，扣减速度比数据库快上百倍。极端高并发时把库存提前放进 Redis，请求先在 Redis 里扣，数据库只做异步落库。

```java
String key = "stock:sku:" + skuId;
Long remain = redis.opsForValue().decrement(key, quantity);
if (remain < 0) {
    redis.opsForValue().increment(key, quantity);  // 回滚
    throw new BizException("库存不足");
}
// 发送 MQ 消息，异步写入数据库
```

代价是引入了两份库存，Redis 一份、数据库一份，两者要保证一致。Redis 扣了、数据库还没落，这中间崩溃了怎么办。所以 Redis 预扣必须配一套补偿机制，消息消费失败的补偿和定期对账。这是它和前两种方案最本质的区别，前两种只跟数据库打交道，没有两份数据的一致性问题。

## 5. 怎么选

| 方案 | 原子性来源 | 代价 | 适用 |
| :-- | :-- | :-- | :-- |
| 悲观锁 | 数据库行锁 | 排队，吞吐低 | 并发低、行数少 |
| 乐观锁 | 条件更新 | 冲突重试 | 高并发、库存充足 |
| Redis 预扣 | Redis 单线程 | 双份库存一致性 | 极端高并发、秒杀 |

判断的依据是并发量级。日活在十万以内悲观锁够用；十万到百万乐观锁是性价比最高的选择；超过百万且有秒杀这种瞬时洪峰才需要上 Redis 预扣。大部分项目停在乐观锁就够了，不要一上来就 Redis 预扣，它的一致性成本不是每个业务都扛得住。

## 6. 相关章节

库存扣减只是下单链路里的一个点，它和几个相邻的问题紧密相关。扣减的原子性需要 [分布式锁](../02-concurrency/chapter-01-distributed-lock.md) 兜底；异步落库的消息可能重复，需要 [幂等设计](../02-concurrency/chapter-03-idempotency.md) 保证只扣一次；超时未支付的订单要回补库存，见 [延迟队列](../03-messaging/chapter-01-delayed-task.md)。
