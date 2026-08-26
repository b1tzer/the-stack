# 第 9 章 架构案例分析

> 前八卷我们学习了语言基础、运行时、并发、网络、数据访问、企业架构和性能工程。本章的核心问题是：**面对真实的高并发场景，如何将这些技术组合运用，设计出可用、可靠、可扩展的系统？** 本章通过三个经典案例，展示架构设计的综合实践。

## 1. 案例一：高并发秒杀系统

### 1.1 业务特征分析

秒杀系统的本质矛盾：**有限库存，无限流量**。

| 维度 | 特征 | 挑战 |
|------|------|------|
| 流量 | 瞬时 QPS 是平时的 100-1000 倍 | 系统不能被压垮 |
| 库存 | 100 件商品，100 万人抢 | 不能超卖 |
| 体验 | 用户期望即时反馈 | 不能让用户等太久 |
| 公平 | 先到先得 | 不能被脚本刷走 |

### 1.2 整体架构

![seckill-arch](/java/seckill-arch.svg)

### 1.3 四层流量削减

**第一层：网关限流 + 验证码**

```java
// 网关层：Sentinel 限流
@Configuration
public class GatewayConfig {
    @Bean
    public SentinelGatewayFilter sentinelFilter() {
        return new SentinelGatewayFilter();
    }
}

// 限流规则：秒杀接口 QPS 上限 5000
@PostConstruct
public void initRules() {
    FlowRule rule = new FlowRule();
    rule.setResource("seckill-api");
    rule.setGrade(RuleConstant.FLOW_GRADE_QPS);
    rule.setCount(5000);  // 超过 5000 直接拒绝
    FlowRuleManager.loadRules(List.of(rule));
}
```

验证码的作用不仅是防机器人，更重要的是**错峰**——用户输入验证码的 2-3 秒自然将流量拉平。

**第二层：Redis 预减库存**

```lua
-- seckill.lua：原子操作，不存在并发问题
-- KEYS[1] = stock:{itemId}
-- ARGV[1] = 购买数量

local stock = tonumber(redis.call('GET', KEYS[1]))
if stock == nil then
    return -1  -- 商品不存在
end
if stock < tonumber(ARGV[1]) then
    return 0   -- 库存不足
end
redis.call('DECRBY', KEYS[1], ARGV[1])
return 1       -- 扣减成功
```

```java
@Service
public class SeckillService {

    @Autowired
    private StringRedisTemplate redis;

    @Autowired
    private RocketMQTemplate mq;

    public SeckillResult trySeckill(String userId, String itemId) {
        // 1. 已购买检查（Set 判断）
        Boolean bought = redis.opsForValue()
            .getBit("bought:" + itemId, Long.parseLong(userId));
        if (Boolean.TRUE.equals(bought)) {
            return SeckillResult.fail("已购买");
        }

        // 2. Redis Lua 原子扣减
        Long result = redis.execute(seckillScript,
            List.of("stock:" + itemId), "1");

        if (result == null || result == 0) {
            return SeckillResult.fail("已售罄");
        }

        // 3. 发送 MQ 消息，异步创建订单
        String orderId = generateOrderId();
        mq.asyncSend("seckill-orders",
            new SeckillMessage(orderId, userId, itemId));

        // 4. 标记已购买
        redis.opsForValue().setBit("bought:" + itemId,
            Long.parseLong(userId), true);

        return SeckillResult.success(orderId);
    }
}
```

**第三层：MQ 异步订单**

```java
@Component
@RocketMQListener(topic = "seckill-orders")
public class SeckillOrderConsumer {

    @Transactional
    public void onMessage(SeckillMessage msg) {
        // 检查订单是否已存在（幂等）
        if (orderRepo.exists(msg.getOrderId())) {
            return;
        }

        // 创建订单
        Order order = new Order(msg.getOrderId(), msg.getUserId(),
            msg.getItemId(), OrderStatus.PENDING);
        orderRepo.save(order);

        // 发送延迟消息：30 分钟未支付自动取消
        mq.sendDelayedMessage("order-timeout",
            new OrderTimeoutMessage(msg.getOrderId()), 30);
    }
}
```

**第四层：本地事务表 + 消息重试**

参考第 7 章 7.4.4 节的 Outbox 模式，确保数据库写入和消息发送的原子性。

### 1.4 架构权衡：为什么选这个方案？

没有完美的架构，只有权衡后的选择。秒杀系统看起来很“标准”——Redis 预减、MQ 削峰、异步下单——但每一个决策背后都有代价。理解这些代价，比记住方案本身更重要。

**为什么用 Redis 预减库存而不是数据库乐观锁？**

Redis Lua 脚本的吞吐量是数据库乐观锁的 100 倍以上。但代价是：Redis 是内存数据库，如果 Redis 宕机且未持久化，库存数据会丢失。解决方案是 Redis 持久化（AOF + RDB）+ 数据库异步对账。用"可能丢失几秒的数据"换"100 倍吞吐量"，对秒杀场景是值得的。

**为什么用 MQ 异步下单而不是同步创建订单？**

同步创建订单意味着每个请求都走数据库写入，数据库 QPS 上限约 5000，根本扛不住秒杀的瞬时流量。MQ 的作用是**削峰**——将瞬时流量转化为匀速的消费流量。代价是：用户下单后不能立即看到订单，需要轮询或 WebSocket 通知。对秒杀场景，用户已经习惯了"抢到再说"，这个代价可以接受。

**为什么需要验证码？**

验证码不仅防机器人，更重要的是**错峰**。用户输入验证码的 2-3 秒将瞬时流量拉平为一段斜率更缓的曲线，降低了系统的峰值压力。代价是用户体验略有下降，但换来的是系统稳定性。

**这些权衡的核心原则：牺牲非核心体验，保障核心链路。** 秒杀的核心是"不超卖、不宕机"，订单延迟可见、验证码干扰都是可接受的代价。

### 1.5 防超卖的三重保障

```text
         Redis 预减（第一道）
              │ 扣减成功
              ▼
     数据库乐观锁（第二道）
   UPDATE stock SET count = count - 1
   WHERE item_id = ? AND count > 0
              │ 更新成功
              ▼
     消费者幂等（第三道）
   INSERT ... ON DUPLICATE KEY UPDATE
```

## 2. 案例二：社交 Feed 流系统

### 2.1 核心问题

用户打开微博/Twitter，需要看到所有关注人的最新动态。核心挑战：**一个用户关注了 500 人，如何快速拉取聚合后的时间线？**

### 2.2 推模型 vs 拉模型

| 维度 | 推模型（Push） | 拉模型（Pull） | 推拉结合 |
|------|--------------|---------------|---------|
| 写入 | 发布时写入所有粉丝的收件箱 | 只写发布者自己的发件箱 | 普通用户推，大V拉 |
| 读取 | 直接读自己的收件箱 | 实时聚合关注人的发件箱 | 读取时合并 |
| 延迟 | 写入慢（扇出大） | 读取慢（实时聚合） | 平衡 |
| 存储 | 大（粉丝数 × 消息数） | 小（只存原始消息） | 中等 |
| 适用 | 粉丝少的普通用户 | 粉丝多的大V | 混合场景 |

```text
推模型：
  用户A 发布 → 写入粉丝B的收件箱
            → 写入粉丝C的收件箱
            → 写入粉丝D的收件箱
            → ...（扇出到所有粉丝）

拉模型：
  用户B 请求时间线 → 查A的发件箱
                   → 查E的发件箱
                   → 合并排序返回

推拉结合：
  普通用户A 发布 → 推送到粉丝收件箱（A的粉丝<5000）
  大V用户B 发布 → 只写自己的发件箱
  粉丝C 请求 → 读自己的收件箱 + 拉取关注的大V发件箱 → 合并
```

### 2.3 存储设计

```java
// 发布者的发件箱：Sorted Set，score 为时间戳
// key: outbox:{userId}
// value: feedId
// score: timestamp

public void publishFeed(String userId, String feedId) {
    double score = System.currentTimeMillis();
    redis.opsForZSet().add("outbox:" + userId, feedId, score);

    // 推送到粉丝收件箱（异步，通过 MQ）
    List<String> followers = followerService.getFollowers(userId);
    mq.send("feed-push", new FeedPushMessage(userId, feedId, followers));
}
```

```java
// 读取时间线：取收件箱最新 20 条
public List<Feed> getTimeline(String userId, int page) {
    int offset = page * 20;
    Set<String> feedIds = redis.opsForZSet().reverseRange(
        "inbox:" + userId, offset, offset + 19);

    if (feedIds == null || feedIds.isEmpty()) {
        return Collections.emptyList();
    }

    // 批量获取 Feed 内容（Pipeline）
    return feedIds.stream()
        .map(id -> feedRepository.findById(id))
        .filter(Optional::isPresent)
        .map(Optional::get)
        .collect(Collectors.toList());
}
```

### 2.4 热点缓存策略

大V 发布的内容被海量用户读取，需要特殊处理：

```text
普通 Feed：Redis 缓存 1 小时
热点 Feed：本地缓存（Caffeine）+ Redis + DB 三级
          Caffeine 10s → Redis 1h → DB
```

```java
// 本地缓存 + 分布式缓存
@Cacheable(value = "feed", key = "#feedId")
public Feed getFeed(String feedId) {
    return feedRepository.findById(feedId).orElse(null);
}

// 热点探测：用 Redis 计数
public Feed getFeedWithHotDetection(String feedId) {
    Long count = redis.opsForValue().increment("feed:hot:" + feedId);
    redis.expire("feed:hot:" + feedId, 1, TimeUnit.MINUTES);

    if (count > 1000) {
        // 热点 Feed，加载到本地缓存
        return localCache.get(feedId, id -> loadFromDB(id));
    }
    return getFeed(feedId);
}
```

### 2.5 分片与冷热分离

```text
按 user_id 分片：
  ┌───────────────────┐  ┌───────────────────┐
  │  Shard 0           │  │  Shard 1           │
  │  user_id % 2 == 0  │  │  user_id % 2 == 1  │
  │  热数据：近 7 天    │  │  热数据：近 7 天    │
  │  冷数据：HBase/OSS  │  │  冷数据：HBase/OSS  │
  └───────────────────┘  └───────────────────┘

冷热分离：
  - 热数据（7天内）：MySQL + Redis
  - 温数据（7-90天）：HBase / TiDB
  - 冷数据（90天+）：归档到 OSS / HDFS
```

### 2.6 架构权衡：推拉结合的阈值为什么是 5000？

推拉结合模型中，5000 粉丝是推和拉的分界线。这个数字怎么来的？

**推模型的成本**：每次发布需要写入所有粉丝的收件箱。如果一个用户有 100 万粉丝，每次发布需要 100 万次写入。写入延迟 = 粉丝数 × 单次写入耗时。

**拉模型的成本**：每次读取需要聚合所有关注人的发件箱。如果一个用户关注了 500 人，每次读取需要 500 次查询。读取延迟 = 关注数 × 单次查询耗时。

5000 是一个经验值：当粉丝数 < 5000 时，推模型的写入延迟在可接受范围内（5000 × 0.1ms = 500ms）；当粉丝数 > 5000 时，写入延迟开始影响发布体验，拉模型更合适。

**代价是什么？** 推拉结合增加了系统复杂度——需要维护两套存储（收件箱 + 发件箱），读取时需要合并去重，大 V 的发件箱需要特殊的缓存策略。但这个复杂度换来的是：普通用户的读取体验极快（直接读收件箱），大 V 的发布体验不受影响（只写发件箱）。

## 3. 案例三：支付系统

### 3.1 支付系统的核心挑战

支付系统是金融级应用，必须保证**资金安全**和**数据一致**：

| 要求 | 含义 | 后果 |
|------|------|------|
| **资金安全** | 一分钱都不能差 | 对账不平就是事故 |
| **幂等性** | 同一笔支付不能重复扣款 | 直接经济损失 |
| **一致性** | 账户余额、订单状态、支付记录必须一致 | 资金错乱 |
| **可追溯** | 每一笔交易都要有完整日志 | 审计和纠纷处理 |
| **安全性** | 防篡改、防重放、防抵赖 | 欺诈和法律风险 |

### 3.2 TCC 两阶段提交

TCC（Try-Confirm-Cancel）是分布式事务的常用方案：

![tcc-flow](/java/tcc-flow.svg)

```java
@Service
public class PaymentTccService {

    // Try：冻结金额
    @Transactional
    public boolean tryFreeze(String accountId, String txId, BigDecimal amount) {
        Account account = accountRepo.findById(accountId).orElseThrow();
        if (account.getAvailable().compareTo(amount) < 0) {
            return false;  // 余额不足，Try 失败
        }
        // 冻结：available -= amount, frozen += amount
        account.setAvailable(account.getAvailable().subtract(amount));
        account.setFrozen(account.getFrozen().add(amount));
        accountRepo.save(account);

        // 记录事务日志
        tccLogRepo.save(new TccLog(txId, "TRY", accountId, amount));
        return true;
    }

    // Confirm：确认扣减
    @Transactional
    public void confirm(String txId) {
        TccLog log = tccLogRepo.findByTxId(txId);
        Account account = accountRepo.findById(log.getAccountId()).orElseThrow();
        // 冻结金额转为已扣减：frozen -= amount
        account.setFrozen(account.getFrozen().subtract(log.getAmount()));
        accountRepo.save(account);

        log.setStatus("CONFIRMED");
        tccLogRepo.save(log);
    }

    // Cancel：解冻
    @Transactional
    public void cancel(String txId) {
        TccLog log = tccLogRepo.findByTxId(txId);
        Account account = accountRepo.findById(log.getAccountId()).orElseThrow();
        // 解冻：frozen -= amount, available += amount
        account.setFrozen(account.getFrozen().subtract(log.getAmount()));
        account.setAvailable(account.getAvailable().add(log.getAmount()));
        accountRepo.save(account);

        log.setStatus("CANCELLED");
        tccLogRepo.save(log);
    }
}
```

### 3.3 全局唯一交易号与幂等

```java
// 全局唯一交易号：业务前缀 + 时间戳 + 机器ID + 序列号
public class TradeNoGenerator {

    private final SnowflakeIdGenerator snowflake;

    public String generate(String bizType) {
        // 示例：PAY20260804224700-001-0001
        return bizType
            + DateTimeFormatter.ofPattern("yyyyMMddHHmmss").format(LocalDateTime.now())
            + "-" + String.format("%03d", machineId)
            + "-" + snowflake.nextId();
    }
}

// 幂等拦截器
@Aspect
@Component
public class IdempotentAspect {

    @Around("@annotation(idempotent)")
    public Object around(ProceedingJoinPoint pjp, Idempotent idempotent) {
        String tradeNo = extractTradeNo(pjp.getArgs());
        String key = "idempotent:" + tradeNo;

        // SETNX：如果已存在说明是重复请求
        Boolean success = redis.opsForValue()
            .setIfAbsent(key, "PROCESSING", 10, TimeUnit.MINUTES);

        if (Boolean.FALSE.equals(success)) {
            // 查询之前的结果
            return redis.opsForValue().get(key + ":result");
        }

        try {
            Object result = pjp.proceed();
            redis.opsForValue().set(key + ":result", result, 24, TimeUnit.HOURS);
            redis.opsForValue().set(key, "DONE", 24, TimeUnit.HOURS);
            return result;
        } catch (Exception e) {
            redis.delete(key);  // 失败时删除，允许重试
            throw e;
        }
    }
}
```

### 3.4 定时对账

对账是支付系统的最后防线，确保内部账目和外部渠道（银行、支付宝、微信）一致：

```text
对账流程：

  T+1 凌晨 2:00
       │
       ▼
  下载渠道对账文件（银行/支付宝/微信）
       │
       ▼
  逐笔比对：
    ┌──────────────────────────────────────────┐
    │  内部流水号  │ 金额  │ 状态  │ 渠道记录    │
    ├─────────────┼───────┼──────┼────────────┤
    │  PAY001     │ 100   │ 成功  │ 成功 ✓     │
    │  PAY002     │ 50    │ 成功  │ 无记录 ⚠️  │  ← 长款
    │  PAY003     │ 200   │ 失败  │ 成功 ⚠️    │  ← 短款
    └──────────────────────────────────────────┘
       │
       ▼
  差异记录 → 人工审核 / 自动补偿
```

```java
@Scheduled(cron = "0 0 2 * * ?")  // 每天凌晨 2 点
public void reconcile() {
    // 1. 下载渠道对账文件
    List<ChannelRecord> channelRecords = channelClient.downloadReconciliation(LocalDate.now().minusDays(1));

    // 2. 查询内部流水
    List<InternalRecord> internalRecords = paymentRepo.findByDate(LocalDate.now().minusDays(1));

    // 3. 按交易号匹配
    Map<String, ChannelRecord> channelMap = channelRecords.stream()
        .collect(Collectors.toMap(ChannelRecord::getTradeNo, r -> r));

    for (InternalRecord internal : internalRecords) {
        ChannelRecord channel = channelMap.get(internal.getTradeNo());

        if (channel == null) {
            // 内部有，渠道无 → 记录差异，可能需要退款
            diffRepo.save(new ReconcileDiff(internal, "MISSING_IN_CHANNEL"));
        } else if (!internal.getAmount().equals(channel.getAmount())) {
            // 金额不一致 → 严重异常，立即告警
            alertService.critical("金额不一致: " + internal.getTradeNo());
        } else if (!internal.getStatus().equals(channel.getStatus())) {
            // 状态不一致 → 以渠道为准，调整内部状态
            adjustStatus(internal, channel);
        }
    }
}
```

### 3.5 安全四要素

| 要素 | 机制 | 实现 |
|------|------|------|
| **鉴权** | 身份验证 | OAuth2 + JWT + 短信验证码 |
| **签名** | 防篡改 | HMAC-SHA256，用密钥对请求参数签名 |
| **加密** | 防窃听 | TLS 传输加密 + 敏感字段 AES 加密 |
| **审计** | 可追溯 | 每笔交易全链路日志，保留 5 年 |

```java
// 请求签名示例
public class PaymentSigner {

    public String sign(Map<String, String> params, String secretKey) {
        // 1. 参数按字母排序
        String sorted = params.entrySet().stream()
            .sorted(Map.Entry.comparingByKey())
            .map(e -> e.getKey() + "=" + e.getValue())
            .collect(Collectors.joining("&"));

        // 2. 拼接密钥
        String toSign = sorted + "&key=" + secretKey;

        // 3. HMAC-SHA256 签名
        return Hex.encodeHexString(
            new HmacUtils(HmacAlgorithms.HMAC_SHA_256, secretKey).hmac(toSign));
    }

    public boolean verify(Map<String, String> params, String signature, String secretKey) {
        return MessageDigest.isEqual(
            sign(params, secretKey).getBytes(),
            signature.getBytes()
        );
    }
}
```

### 3.6 架构权衡：为什么选 TCC 而不是 Saga？

分布式事务有多种方案，为什么支付系统选择 TCC？

**TCC vs Saga 的核心区别**：

| 维度 | TCC | Saga |
|------|-----|------|
| 资源预留 | Try 阶段冻结资源 | 无预留，直接执行 |
| 回滚方式 | Cancel 解冻 | 执行补偿操作 |
| 一致性 | 更强（资源已预留） | 最终一致（补偿可能失败） |
| 适用场景 | 资金、库存（需要预留） | 长流程、跨系统（不需要预留） |

支付场景选择 TCC 的原因：资金必须在 Try 阶段被冻结，否则可能出现"钱不够但已经扣了"的情况。Saga 没有预留机制，如果中间步骤失败，补偿操作（退款）可能因为余额不足而失败。

**TCC 的 Cancel 失败了怎么办？**

这是 TCC 最棘手的问题。Cancel 失败意味着资源既没有被确认，也没有被解冻。解决方案是**定时重试 + 人工兜底**：后台任务定期重试 Cancel 操作，如果多次失败则告警，人工介入处理。这就是为什么支付系统需要完善的监控和告警体系。

**为什么不用 2PC（两阶段提交）？**

2PC 需要数据库层面的 XA 协议支持，性能差（全局锁），且协调者是单点故障。TCC 在应用层实现，不需要数据库支持，性能更好，但实现复杂度更高。对互联网支付场景，性能和可用性比"强一致性"更重要，TCC 是更务实的选择。

## 4. 全书总结

### 4.1 七卷闭环

```text
┌─────────────────────────────────────────────────────────────┐
│                    Java 技术体系全景                          │
│                                                              │
│  第一卷        第二卷        第三卷        第四卷              │
│  语言基础  →   运行时    →   并发编程  →   网络与通信          │
│  (砖块)        (地基)        (骨架)        (管道)              │
│    │            │             │             │                 │
│    └────────────┴─────────────┴─────────────┘                │
│                         │                                    │
│                    第五卷  数据访问                            │
│                    (仓库)                                     │
│                         │                                    │
│                    第六卷  企业架构                            │
│                    (大楼)                                     │
│                         │                                    │
│                    第七卷  性能与架构                          │
│                    (装修 + 质检)                               │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### 4.2 每一卷的核心问题

| 卷 | 核心问题 | 一句话回答 |
|----|---------|-----------|
| 1. 语言基础 | Java 程序怎么写？ | 用面向对象思想，写出清晰、可维护的代码 |
| 2. JVM 运行时 | 代码怎么跑的？ | JVM 通过类加载、字节码执行、GC 自动管理内存 |
| 3. 并发编程 | 多线程怎么协作？ | 用锁、CAS、线程池安全地共享可变状态 |
| 4. 网络与通信 | 数据怎么传输？ | 用 NIO、Netty 构建高性能网络应用 |
| 5. 数据访问 | 数据怎么存取？ | 用连接池、ORM、缓存、分库分表管理数据 |
| 6. 企业架构 | 系统怎么组织？ | 用微服务、服务治理、容器化构建企业级应用 |
| 7. 性能与架构 | 系统怎么设计？ | 用消息驱动、性能工程、架构模式构建可靠系统 |

### 4.3 技术演进的路线图

```text
初级工程师：
  写出能跑的代码 ──→ 第一卷
      │
中级工程师：
  理解运行原理 ──→ 第二卷 + 第三卷
      │
高级工程师：
  构建网络应用 ──→ 第四卷 + 第五卷
      │
架构师：
  设计分布式系统 ──→ 第六卷 + 第七卷
      │
技术专家：
  性能调优 + 架构决策 ──→ 第七卷的深度实践
```

### 4.4 最后的话

技术书籍只能给你地图，真正的学习在路上。每一章的代码示例，都值得你亲手敲一遍、跑一次、改一改、踩踩坑。Java 生态博大精深，七卷内容不过是冰山一角，但它们构成了一个**完整的知识骨架**——有了骨架，血肉可以慢慢填充。

记住三句话：

1. **先让它工作，再让它正确，最后让它快**（Make it work, make it right, make it fast）
2. **没有银弹**——每种架构选择都是权衡（Trade-off），没有完美的方案
3. **持续学习**——Java 生态每年都在进化，保持好奇心比掌握任何单一技术都重要
