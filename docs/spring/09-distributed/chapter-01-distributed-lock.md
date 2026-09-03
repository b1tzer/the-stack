# 分布式锁

> 单机 `synchronized` 或 `ReentrantLock` 只在 JVM 内有效。集群环境下多个实例同时执行同一段逻辑——重复扣款、重复派单、缓存并发重建——需要跨 JVM 的互斥机制。分布式锁的核心是：在多个进程之间，同一时刻只有一个能持有锁。

## 1. 分布式锁的三个要素

| 要素 | 说明 | 反例 |
| :-- | :-- | :-- |
| **互斥** | 同一时刻只有一个客户端持有锁 | Redis `SETNX` 未设过期时间，进程崩溃后锁永远不释放 |
| **防死锁** | 持锁客户端崩溃后锁能自动释放 | 忘了设 TTL，或者 TTL 到了但业务还没执行完 |
| **可重入** | 同一客户端可以多次加锁 | 简单的 `SETNX` 实现不记录持有者，重入时自己把自己锁死 |

> **踩坑提醒：** 千万不要自己用 `SETNX + EXPIRE` 写分布式锁。这两步不是原子操作，进程可能在 `SETNX` 之后、`EXPIRE` 之前崩溃，留下一个永远不过期的幽灵锁。

## 2. Redis 分布式锁（Redisson）

Redisson 是 Java 生态中最成熟的 Redis 分布式锁实现。底层用 **Lua 脚本** 保证加锁/解锁的原子性，通过 **Watch Dog 机制** 自动续期。

### 2.1 依赖配置

```xml
<dependency>
    <groupId>org.redisson</groupId>
    <artifactId>redisson-spring-boot-starter</artifactId>
    <version>3.27.0</version>
</dependency>
```

```yaml
spring:
  data:
    redis:
      host: 127.0.0.1
      port: 6379
      password: your_password
```

### 2.2 基础用法

```java
@Service
@Slf4j
public class InventoryService {

    private final RedissonClient redissonClient;
    private final InventoryMapper inventoryMapper;

    public InventoryService(RedissonClient redissonClient, InventoryMapper inventoryMapper) {
        this.redissonClient = redissonClient;
        this.inventoryMapper = inventoryMapper;
    }

    public boolean deductStock(Long productId, int quantity) {
        String lockKey = "lock:inventory:" + productId;
        RLock lock = redissonClient.getLock(lockKey);

        try {
            boolean acquired = lock.tryLock(5, 30, TimeUnit.SECONDS);
            if (!acquired) {
                log.warn("获取锁失败，productId={}", productId);
                return false;
            }

            Inventory inventory = inventoryMapper.selectByProductId(productId);
            if (inventory == null || inventory.getStock() < quantity) {
                log.warn("库存不足，productId={}, 剩余={}", productId,
                        inventory != null ? inventory.getStock() : 0);
                return false;
            }

            int rows = inventoryMapper.deductStock(productId, quantity);
            return rows > 0;

        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            log.error("获取锁被中断", e);
            return false;
        } finally {
            if (lock.isHeldByCurrentThread()) {
                lock.unlock();
            }
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
@Target(ElementType.METHOD)
@Retention(RetentionPolicy.RUNTIME)
public @interface DistributedLock {
    String key();                    // SpEL 表达式
    long waitTime() default 3;
    long leaseTime() default 10;
    TimeUnit unit() default TimeUnit.SECONDS;
}

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
        // 领券逻辑
    }
}
```

## 3. Redisson 高级特性

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
multiLock.tryLock(3, 10, TimeUnit.SECONDS);

// 红锁（RedLock）：跨多个 Redis 实例，防止单点故障
RLock lock1 = redisson.getLock("lock1");
RLock lock2 = redisson.getLock("lock2");
RLock lock3 = redisson.getLock("lock3");
RedissonRedLock redLock = new RedissonRedLock(lock1, lock2, lock3);
```

## 4. ZooKeeper 分布式锁

ZooKeeper 分布式锁基于 **临时顺序节点** 实现，优势是 **强一致性**（ZAB 协议保证），缺点是 **性能较低**。

```xml
<dependency>
    <groupId>org.apache.curator</groupId>
    <artifactId>curator-recipes</artifactId>
    <version>5.5.0</version>
</dependency>
```

```java
@Configuration
public class ZookeeperConfig {

    @Bean
    public CuratorFramework curatorFramework() {
        CuratorFramework client = CuratorFrameworkFactory.builder()
                .connectString("127.0.0.1:2181")
                .sessionTimeoutMs(30000)
                .connectionTimeoutMs(15000)
                .retryPolicy(new ExponentialBackoffRetry(1000, 3))
                .build();
        client.start();
        return client;
    }
}

@Service
@Slf4j
public class ZkLockService {

    private final CuratorFramework curatorClient;

    public ZkLockService(CuratorFramework curatorClient) {
        this.curatorClient = curatorClient;
    }

    public void doWithLock(String lockPath, Runnable task) throws Exception {
        InterProcessMutex lock = new InterProcessMutex(curatorClient, lockPath);

        try {
            if (lock.acquire(10, TimeUnit.SECONDS)) {
                log.info("获取 ZooKeeper 锁成功: {}", lockPath);
                task.run();
            } else {
                throw new RuntimeException("获取 ZooKeeper 锁超时: " + lockPath);
            }
        } finally {
            if (lock.isAcquiredInThisProcess()) {
                lock.release();
                log.info("释放 ZooKeeper 锁: {}", lockPath);
            }
        }
    }
}
```

## 5. 方案对比

| 维度 | Redis（Redisson） | ZooKeeper（Curator） |
| :-- | :-- | :-- |
| 一致性模型 | AP（最终一致性） | CP（强一致性） |
| 性能 | 极高（~10 万 ops/s） | 中等（~1 万 ops/s） |
| 防死锁机制 | TTL + Watch Dog | 临时节点自动删除 |
| 可重入 | 支持（Lua 脚本） | 支持（记录线程） |
| 主从切换风险 | 可能丢锁 | 不会丢锁（ZAB 协议） |
| 运维复杂度 | 低 | 高（需维护 ZK 集群） |
| 适用场景 | 高并发、允许极端情况丢锁 | 对一致性要求极高的场景 |

> **踩坑提醒：** Redis 主从架构下，锁写入 master 后 master 宕机，slave 提升为 master 但锁未同步——此时另一个客户端能获取到同一把锁。如果对一致性要求极高，应使用 RedLock 算法（但有争议，Martin Kleppmann 曾发文质疑）。

## 6. 最佳实践

1. **锁粒度要细**——`lock:order:1001` 而非 `lock:order`，减少锁竞争
2. **超时时间要合理**——太短业务没执行完就释放了，太长崩溃后等太久
3. **finally 必须解锁**——检查 `isHeldByCurrentThread()` 再解锁，防止误删
4. **加锁失败要优雅处理**——重试、排队或返回友好提示
5. **避免锁内耗时操作**——RPC、HTTP 调用不要放在锁内
