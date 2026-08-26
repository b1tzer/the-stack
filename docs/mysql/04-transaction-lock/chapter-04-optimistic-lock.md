# 乐观锁

## 1. 实现方式

### 1.1 版本号机制
```sql
-- 表结构
ALTER TABLE products ADD COLUMN version INT DEFAULT 0;

-- 更新
UPDATE products 
SET stock = stock - 1, version = version + 1 
WHERE id = 1 AND version = 5;

-- 检查影响行数，0 表示冲突
```

### 1.2 时间戳机制
```sql
UPDATE products 
SET stock = stock - 1, updated_at = NOW() 
WHERE id = 1 AND updated_at = '2024-01-01 12:00:00';
```

## 2. 适用场景

- 读多写少
- 冲突概率低
- 不需要阻塞等待

## 3. 与悲观锁对比

| 特性 | 乐观锁 | 悲观锁 |
|------|--------|--------|
| 实现 | 版本号/时间戳 | SELECT FOR UPDATE |
| 冲突处理 | 重试 | 阻塞等待 |
| 适用场景 | 读多写少 | 写多冲突多 |

## 4. Java 实现乐观锁

```java
// Spring Boot + JPA 实现
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

// Repository
public interface ProductRepository extends JpaRepository<Product, Long> {
}

// Service - 乐观锁扣减库存
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

## 5. 手动实现乐观锁

```java
// 手动版本号检查
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
        
        // 3. 检查更新结果
        if (affected == 0) {
            // 版本号已变化，重试
            return false;
        }
        return true;
    }
}
```

## 6. 乐观锁 vs 悲观锁选择指南

```java
// 场景 1：库存扣减（高并发）→ 乐观锁 + 重试
// 场景 2：转账（强一致性）→ 悲观锁

// 悲观锁实现
@Transactional
public void transfer(Long fromId, Long toId, BigDecimal amount) {
    // 固定顺序加锁，避免死锁
    Long first = Math.min(fromId, toId);
    Long second = Math.max(fromId, toId);
    
    Account firstAcc = accountRepository.findById(first).orElseThrow();
    Account secondAcc = accountRepository.findById(second).orElseThrow();
    // ... 业务逻辑
}
```

## 7. 最佳实践

| 场景 | 推荐方案 | 原因 |
|------|---------|------|
| 库存扣减 | 乐观锁 + 重试 | 冲突概率低，性能好 |
| 秒杀抢购 | 悲观锁或 Redis | 冲突概率高，乐观锁重试频繁 |
| 转账 | 悲观锁 | 强一致性要求 |
| 用户信息更新 | 乐观锁 | 冲突概率极低 |
| 订单状态流转 | 乐观锁 | 状态有限，冲突少 |
| 抢红包 | Redis + Lua | 超高并发，MySQL 不适合 |

