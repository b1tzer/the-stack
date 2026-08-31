# 锁选型：悲观锁 vs 乐观锁

## 1. 核心区别

| 特性 | 悲观锁 | 乐观锁 |
|------|--------|--------|
| 加锁时机 | 操作前加锁 | 提交时检查 |
| 实现方式 | SELECT ... FOR UPDATE | 版本号/时间戳 |
| 并发性能 | 低（阻塞其他事务） | 高（不阻塞） |
| 冲突处理 | 等待锁释放 | 重试业务逻辑 |
| 适用场景 | 写多读少、冲突频繁 | 读多写少、冲突较少 |

## 2. 悲观锁实现

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

### 2.1 悲观锁的粒度

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

### 2.2 悲观锁超时

```sql
-- 设置锁等待超时
SET innodb_lock_wait_timeout = 5;  -- 默认 50 秒

-- 超时后报错
-- ERROR 1205 (HY000): Lock wait timeout exceeded
```

## 3. 乐观锁实现

### 3.1 版本号机制

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

### 3.2 时间戳机制

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

### 3.3 CAS（Compare And Swap）

```sql
-- 直接比较原值
UPDATE accounts
SET balance = 900
WHERE id = 1 AND balance = 1000;

-- 如果 affected_rows = 0，说明余额已被修改
```

## 4. 选型决策树

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

## 5. 典型场景选型

### 5.1 适合悲观锁的场景

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

### 5.2 适合乐观锁的场景

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

## 6. 乐观锁重试策略

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

### 6.1 Java 实现：JPA 与手动版

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

## 7. 混合方案

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

## 8. 性能对比测试

| 方案 | QPS (低冲突) | QPS (高冲突) | 死锁风险 |
|------|-------------|-------------|---------|
| 悲观锁 | 5,000 | 2,000 | 有 |
| 乐观锁 | 15,000 | 8,000 (含重试) | 无 |
| 乐观锁+悲观锁降级 | 14,000 | 3,000 | 低 |

## 9. 最佳实践总结

| 场景 | 推荐方案 | 理由 |
|------|---------|------|
| 转账/支付 | 悲观锁 | 数据一致性要求极高 |
| 秒杀/抢购 | 悲观锁 或 Redis 原子操作 | 高并发写入 |
| 用户资料修改 | 乐观锁（版本号） | 冲突少，性能好 |
| 后台配置 | 乐观锁（版本号） | 几乎无冲突 |
| 订单状态 | 悲观锁 | 状态机需严格控制 |
| 购物车 | 乐观锁 | 可接受最终一致性 |
