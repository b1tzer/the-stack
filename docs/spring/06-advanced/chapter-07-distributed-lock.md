# 分布式锁

> 单机 `synchronized` 或 `ReentrantLock` 只在 JVM 内有效。集群环境下多个实例同时执行同一段逻辑——重复扣款、重复派单、缓存并发重建——需要跨 JVM 的互斥机制。分布式锁的核心是：在多个进程之间，同一时刻只有一个能持有锁。Spring 生态下主流方案是 Redis 和 ZooKeeper。

## 1. 分布式锁的三个要素

| 要素 | 说明 |
| :-- | :-- |
| 互斥 | 同一时刻只有一个客户端持有锁 |
| 防死锁 | 持锁客户端崩溃后锁能自动释放（超时机制） |
| 可重入 | 同一客户端可以多次加锁（嵌套调用场景） |

## 2. Redis 分布式锁 (Redisson)

Redisson 是 Redis 官方推荐的 Java 客户端，内置分布式锁实现。

### 2.1 依赖

```xml
<dependency>
    <groupId>org.redisson</groupId>
    <artifactId>redisson-spring-boot-starter</artifactId>
    <version>3.25.2</version>
</dependency>
```

### 2.2 基础用法

```java
@Service
public class OrderService {

    @Autowired
    private RedissonClient redisson;

    public void createOrder(CreateOrderDTO dto) {
        // 加锁：库存ID 作为锁的 key
        RLock lock = redisson.getLock("lock:stock:" + dto.getSkuId());

        try {
            // 尝试加锁，最多等待 3 秒，持有锁 10 秒自动释放
            if (lock.tryLock(3, 10, TimeUnit.SECONDS)) {
                try {
                    // 检查库存
                    int stock = stockMapper.getStock(dto.getSkuId());
                    if (stock <= 0) {
                        throw new BusinessException("库存不足");
                    }
                    // 扣减库存 + 创建订单
                    stockMapper.deduct(dto.getSkuId(), 1);
                    orderMapper.insert(buildOrder(dto));
                } finally {
                    lock.unlock();
                }
            } else {
                throw new BusinessException("系统繁忙，请稍后重试");
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new BusinessException("加锁被中断");
        }
    }
}
```

### 2.3 注解方式（Spring Integration）

```java
@Configuration
@EnableIntegration
public class DistributedLockConfig {

    @Bean
    public LockRegistry lockRegistry(RedisConnectionFactory connectionFactory) {
        return new RedisLockRegistry(connectionFactory, "locks", 60000);
    }
}

// 使用
@Service
public class UserService {

    @Autowired
    private LockRegistry lockRegistry;

    public void updateUser(Long id, UserUpdateDTO dto) {
        Lock lock = lockRegistry.obtain("user:" + id);
        try {
            if (lock.tryLock(3, TimeUnit.SECONDS)) {
                // 更新逻辑
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        } finally {
            lock.unlock();
        }
    }
}
```

### 2.4 自定义注解 + AOP

```java
// 注解定义
@Target(ElementType.METHOD)
@Retention(RetentionPolicy.RUNTIME)
public @interface DistributedLock {
    String key();                    // SpEL 表达式
    long waitTime() default 3;       // 等待时间
    long leaseTime() default 10;     // 持有时间
    TimeUnit unit() default TimeUnit.SECONDS;
}

// AOP 切面
@Aspect
@Component
public class DistributedLockAspect {

    @Autowired
    private RedissonClient redisson;

    @Around("@annotation(lock)")
    public Object around(ProceedingJoinPoint pjp, DistributedLock lock) throws Throwable {
        String key = parseKey(pjp, lock.key());
        RLock rLock = redisson.getLock(key);

        if (!rLock.tryLock(lock.waitTime(), lock.leaseTime(), lock.unit())) {
            throw new LockAcquireException("获取锁失败: " + key);
        }

        try {
            return pjp.proceed();
        } finally {
            if (rLock.isHeldByCurrentThread()) {
                rLock.unlock();
            }
        }
    }

    private String parseKey(ProceedingJoinPoint pjp, String spel) {
        // SpEL 解析逻辑
        StandardEvaluationContext context = new StandardEvaluationContext();
        MethodSignature ms = (MethodSignature) pjp.getSignature();
        String[] paramNames = ms.getParameterNames();
        Object[] args = pjp.getArgs();
        for (int i = 0; i < paramNames.length; i++) {
            context.setVariable(paramNames[i], args[i]);
        }
        return new SpelExpressionParser().parseExpression(spel)
                .getValue(context, String.class);
    }
}

// 使用
@Service
public class CouponService {

    @DistributedLock(key = "'coupon:' + #userId + ':' + #couponId")
    public void claimCoupon(Long userId, Long couponId) {
        // 领券逻辑，同一用户同一券不能重复领取
    }
}
```

## 3. Redis 锁原理

### 3.1 加锁脚本（Lua 原子操作）

```lua
-- 加锁：SET key value NX PX milliseconds
if redis.call('SET', KEYS[1], ARGV[1], 'NX', 'PX', ARGV[2]) then
    return 1
else
    -- 可重入：判断是否是当前线程持有
    if redis.call('GET', KEYS[1]) == ARGV[1] then
        redis.call('INCR', KEYS[1] .. ':count')
        return 1
    end
    return 0
end
```

### 3.2 解锁脚本

```lua
-- 解锁：先判断是否是自己的锁，再删除（防止误删别人的锁）
if redis.call('GET', KEYS[1]) == ARGV[1] then
    local count = redis.call('DECR', KEYS[1] .. ':count')
    if count <= 0 then
        redis.call('DEL', KEYS[1])
        redis.call('DEL', KEYS[1] .. ':count')
    end
    return 1
else
    return 0
end
```

## 4. Redisson 高级特性

```java
// 读写锁：读共享，写独占
RReadWriteLock rwLock = redisson.getReadWriteLock("rwLock");
rwLock.readLock().lock();    // 多个读可以并发
rwLock.writeLock().lock();   // 写独占

// 公平锁：按请求顺序获取锁
RLock fairLock = redisson.getFairLock("fairLock");
fairLock.tryLock(3, 10, TimeUnit.SECONDS);

// 联锁：同时获取多个锁
RLock lock1 = redisson.getLock("lock1");
RLock lock2 = redisson.getLock("lock2");
RedissonMultiLock multiLock = new RedissonMultiLock(lock1, lock2);
multiLock.tryLock(3, 10, TimeUnit.SECONDS);  // 同时获取两个锁

// 红锁（RedLock）：跨多个 Redis 实例，防止单点故障
RLock lock1 = redisson.getLock("lock1");
RLock lock2 = redisson.getLock("lock2");
RLock lock3 = redisson.getLock("lock3");
RedissonRedLock redLock = new RedissonRedLock(lock1, lock2, lock3);
```

## 5. 方案对比

| 方案 | 性能 | 可靠性 | 复杂度 | 适用场景 |
| :-- | :-- | :-- | :-- | :-- |
| Redis (Redisson) | 高 | 中（主从切换可能丢锁） | 低 | 大多数场景 |
| ZooKeeper | 中 | 高（临时节点 + Watch） | 中 | 对可靠性要求极高 |
| 数据库（SELECT FOR UPDATE） | 低 | 高 | 低 | 并发量不大、已有数据库 |

**最佳实践：**

1. **锁粒度要细**——`lock:order:1001` 而非 `lock:order`，减少锁竞争
2. **超时时间要合理**——太短业务没执行完就释放了，太长崩溃后等太久
3. **finally 必须解锁**——检查 `isHeldByCurrentThread()` 再解锁，防止误删
4. **加锁失败要优雅处理**——重试、排队或返回友好提示
5. **避免锁内耗时操作**——RPC、HTTP 调用不要放在锁内
