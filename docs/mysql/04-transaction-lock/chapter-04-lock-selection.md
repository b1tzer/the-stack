# 锁选型：悲观锁 vs 乐观锁

## 1. 两种锁的本质区别

[锁机制](./chapter-02-lock.md) 回答了 InnoDB「有哪些锁、怎么加锁」。本文回答的是另一层问题：**你的业务场景，该不该主动去拿这把锁。** 悲观锁与乐观锁给出了两种相反的答案——前者先加锁再操作，后者先操作、提交时再校验冲突。

### 1.1 核心区别

| 特性 | 悲观锁 | 乐观锁 |
| :-- | :-- | :-- |
| 加锁时机 | 操作前加锁 | 提交时检查 |
| 实现方式 | `SELECT ... FOR UPDATE` | 版本号 / 时间戳 |
| 并发性能 | 低（阻塞其他事务） | 高（不阻塞） |
| 冲突处理 | 等待锁释放 | 重试业务逻辑 |
| 适用场景 | 写多读少、冲突频繁 | 读多写少、冲突较少 |

「悲观」与「乐观」指的是对并发冲突的预期：悲观锁假设冲突必然发生，所以提前加锁；乐观锁假设冲突很少发生，所以先不加锁，提交时才检测。理解这一层，后面所有实现细节都只是它的延伸。

## 2. 悲观锁

悲观锁假设并发冲突必然发生，于是在读取数据的瞬间就加锁，把冲突挡在操作之前。落地上，悲观锁几乎全部复用 [锁机制](./chapter-02-lock.md) 里的行锁：`FOR UPDATE` 加排他锁，`LOCK IN SHARE MODE` 加共享锁。

### 2.1 悲观锁实现

```sql
-- SELECT ... FOR UPDATE：对选中行加排他锁
START TRANSACTION;
SELECT * FROM accounts WHERE id = 1 FOR UPDATE;
-- 此时其他事务对该行的读写都会等待
UPDATE accounts SET balance = balance - 100 WHERE id = 1;
COMMIT;

-- SELECT ... LOCK IN SHARE MODE：加共享锁
START TRANSACTION;
SELECT * FROM products WHERE id = 1 LOCK IN SHARE MODE;
-- 其他事务可以读，但不能写
COMMIT;
```

### 2.2 悲观锁的粒度

```sql
-- 行锁（推荐）
SELECT * FROM orders WHERE id = 100 FOR UPDATE;

-- 表锁（谨慎使用）
LOCK TABLES orders WRITE;
-- ... 操作
UNLOCK TABLES;

-- 间隙锁（防止幻读）
-- 范围查询会锁住间隙
SELECT * FROM orders WHERE user_id BETWEEN 100 AND 200 FOR UPDATE;
```

### 2.3 悲观锁超时

```sql
-- 设置锁等待超时
SET innodb_lock_wait_timeout = 5;  -- 默认 50 秒

-- 超时后报错
-- ERROR 1205 (HY000): Lock wait timeout exceeded
```

## 3. 乐观锁

### 3.1 乐观锁实现

乐观锁的思路与悲观锁相反：读取时不加锁，更新时通过「比对某个字段是否还是当初读到的值」来发现冲突。它不阻塞其他事务，靠的是单条 `UPDATE` 的原子性。

落地上有三种等价写法，核心都是同一条 `WHERE` 条件：

- **版本号**：每次更新把 `version + 1`，`WHERE version = 旧值`
- **时间戳**：比对 `updated_at` 是否还是读到的值
- **CAS**：直接比对被修改字段的原值

三者判定冲突的方式一致：**更新影响行数为 0，就说明数据已被别人改过，需要重试。**

### 3.2 版本号机制

```sql
-- 表结构
CREATE TABLE products (
    id INT PRIMARY KEY,
    name VARCHAR(100),
    stock INT,
    version INT DEFAULT 0  -- 版本号
);

-- 更新时检查版本号
UPDATE products
SET stock = stock - 1, version = version + 1
WHERE id = 1 AND version = 0;

-- 检查影响行数
-- 如果 affected_rows = 0，说明被其他事务修改，需要重试
```

### 3.3 时间戳机制

```sql
-- 表结构
CREATE TABLE products (
    id INT PRIMARY KEY,
    name VARCHAR(100),
    stock INT,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- 更新时检查时间戳
UPDATE products
SET stock = stock - 1
WHERE id = 1 AND updated_at = '2024-01-01 10:00:00';
```

### 3.4 CAS（Compare And Swap）

```sql
-- 直接比较原值
UPDATE accounts
SET balance = 900
WHERE id = 1 AND balance = 1000;

-- 如果 affected_rows = 0，说明余额已被修改
```

## 4. 选型与实战

### 4.1 选型决策树

```
冲突频率如何？
├── 高冲突（写多读少）
│   ├── 数据重要性高 → 悲观锁
│   └── 可接受重试 → 乐观锁 + 有限重试
│
└── 低冲突（读多写少）
    ├── 简单更新 → 乐观锁（版本号）
    └── 复杂业务 → 乐观锁 + 业务校验
```

### 4.2 典型场景选型

把决策树落到具体业务，常见场景的选型如下：

| 场景 | 推荐方案 | 关键理由 |
| :-- | :-- | :-- |
| 转账 / 支付 | 悲观锁 | 一致性要求极高，冲突大概率发生 |
| 秒杀 / 抢购 | 悲观锁 或 Redis 原子操作 | 单热点行写冲突集中 |
| 订单状态流转 | 悲观锁 | 状态机需严格串行，防重复操作 |
| 用户资料修改 | 乐观锁（版本号） | 冲突少，阻塞等待不划算 |
| 文章 / 配置编辑 | 乐观锁（版本号） | 并发极低，几乎不会冲突 |
| 购物车 | 乐观锁 | 可接受最终一致性 |

选型只需回答一个问题：**这个数据被并发修改的概率高不高？** 高就用悲观锁挡住冲突，低就用乐观锁换取不阻塞的并发性能。下面 4.3、4.4 分别展开两类场景的可运行写法。

### 4.3 适合悲观锁的场景

```sql
-- 1. 金融转账（数据一致性要求极高）
START TRANSACTION;
SELECT balance FROM accounts WHERE id = 1 FOR UPDATE;
UPDATE accounts SET balance = balance - 100 WHERE id = 1;
UPDATE accounts SET balance = balance + 100 WHERE id = 2;
COMMIT;

-- 2. 库存扣减（高并发秒杀）
START TRANSACTION;
SELECT stock FROM products WHERE id = 1 FOR UPDATE;
IF stock > 0 THEN
    UPDATE products SET stock = stock - 1 WHERE id = 1;
END IF;
COMMIT;

-- 3. 订单状态流转（防止重复操作）
START TRANSACTION;
SELECT status FROM orders WHERE id = 100 FOR UPDATE;
-- 检查状态后更新
UPDATE orders SET status = 'paid' WHERE id = 100 AND status = 'pending';
COMMIT;
```

### 4.4 适合乐观锁的场景

```sql
-- 1. 用户信息更新（冲突少）
UPDATE users
SET nickname = 'new_name', version = version + 1
WHERE id = 1 AND version = 5;

-- 2. 文章编辑（并发低）
UPDATE articles
SET content = 'new content', updated_at = NOW()
WHERE id = 1 AND updated_at = '2024-01-01 10:00:00';

-- 3. 配置修改（冲突极少）
UPDATE configs
SET value = 'new_value', version = version + 1
WHERE key = 'site_name' AND version = 1;
```

### 4.5 乐观锁重试策略

```python
# Python 伪代码
def update_with_retry(table, id, max_retries=3):
    for attempt in range(max_retries):
        # 读取当前版本
        row = SELECT version, data FROM table WHERE id = id
        version = row['version']
        
        # 尝试更新
        affected = UPDATE table 
                   SET data = new_data, version = version + 1 
                   WHERE id = id AND version = version
        
        if affected > 0:
            return True  # 成功
        
        # 重试前等待随机时间（避免惊群效应）
        time.sleep(random.uniform(0.01, 0.1))
    
    return False  # 重试耗尽
```

### 4.6 Java 实现：JPA 与手动版

乐观锁的 Java 落地有两种方式：JPA 内置的 `@Version` 注解，以及手写 SQL 的版本号比对。

**JPA 内置 `@Version`：**

```java
@Entity
@Table(name = "products")
public class Product {
    @Id
    private Long id;
    private String name;
    private Integer stock;

    @Version  // JPA 内置乐观锁支持
    private Integer version;
}
```

```java
@Service
public class ProductService {
    @Autowired
    private ProductRepository productRepository;

    @Transactional
    public void deductStock(Long productId, int quantity) {
        int maxRetries = 3;
        for (int i = 0; i < maxRetries; i++) {
            try {
                Product product = productRepository.findById(productId).orElseThrow();
                if (product.getStock() < quantity) {
                    throw new RuntimeException("库存不足");
                }
                product.setStock(product.getStock() - quantity);
                productRepository.save(product);  // JPA 自动检查 version
                return;
            } catch (ObjectOptimisticLockingFailureException e) {
                if (i == maxRetries - 1) throw e;
                // 等待随机时间后重试
                try { Thread.sleep(100 + (long)(Math.random() * 200)); } catch (InterruptedException ignored) {}
            }
        }
    }
}
```

`@Version` 的语义：每次 `save` 时，JPA 自动在 `UPDATE` 的 `WHERE` 里追加 `version = ?`，并把 `version` 加一。若影响行数为 0，抛 `ObjectOptimisticLockingFailureException`。

**手动 SQL 版本号比对：**

```java
@Service
public class ManualOptimisticLockService {
    @Autowired
    private JdbcTemplate jdbcTemplate;

    public boolean deductStock(Long productId, int quantity) {
        // 1. 读取当前版本号
        Map<String, Object> row = jdbcTemplate.queryForMap(
            "SELECT stock, version FROM products WHERE id = ?", productId);
        int stock = (int) row.get("stock");
        int version = (int) row.get("version");

        if (stock < quantity) {
            throw new RuntimeException("库存不足");
        }

        // 2. 带版本号更新
        int affected = jdbcTemplate.update(
            "UPDATE products SET stock = stock - ?, version = version + 1 WHERE id = ? AND version = ?",
            quantity, productId, version);

        // 3. 检查更新结果，0 表示版本号已变化，需重试
        return affected != 0;
    }
}
```

两者本质相同：都靠「更新时比对版本号、影响行数为 0 判定冲突」实现乐观锁。

### 4.7 混合方案

```sql
-- 读多写少 + 偶尔高并发
-- 先乐观锁，失败后降级为悲观锁

-- 第一次尝试：乐观锁
UPDATE products SET stock = stock - 1, version = version + 1
WHERE id = 1 AND version = 5 AND stock > 0;

-- 如果失败，使用悲观锁
START TRANSACTION;
SELECT * FROM products WHERE id = 1 FOR UPDATE;
UPDATE products SET stock = stock - 1, version = version + 1 WHERE id = 1;
COMMIT;
```

### 4.8 性能对比

| 方案 | 低冲突 | 高冲突 | 死锁风险 |
| :-- | :-- | :-- | :-- |
| 悲观锁 | 一般（每次加锁有开销） | 差（大量等待） | 有 |
| 乐观锁 | 好（几乎无等待） | 中（重试带来额外写） | 无 |
| 乐观锁 + 悲观锁降级 | 好 | 优于纯乐观锁 | 低 |

::: warning 性能数字需实测
QPS 受表结构、索引、事务长度、机器配置影响，脱离环境的绝对值没有参考意义。上表只给方向性结论，落地前用 `sysbench` 或自建压测脚本在目标环境实测。
:::

## 5. 最佳实践总结

1. **先判断冲突频率**：并发修改概率高 → 悲观锁；低 → 乐观锁。
2. **悲观锁必须走索引**：无索引等于锁全表，见 [锁机制](./chapter-02-lock.md) §1.3。
3. **乐观锁必须配重试**：影响行数为 0 时重试，重试前加随机退避，避免惊群。
4. **事务尽量短**：锁在提交时才释放，事务内的 RPC、慢计算越少越好。
5. **固定加锁顺序**：多表 / 多行操作保持相同顺序，降低死锁概率。
