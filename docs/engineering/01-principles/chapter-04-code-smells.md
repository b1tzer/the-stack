# 代码坏味道

## 1. 代码坏味道列表

坏味道是待验证的设计假设，而非违规判定。下表是排查线索，用于提示「这里值得检查」，是否重构取决于职责边界、变化原因与维护成本，而非机械匹配症状与动作。

| 坏味道 | 说明 | 重构方法 |
| :-- | :-- | :-- |
| 重复代码 | 多处相同逻辑 | 提取方法/组合 |
| 过长方法 | 职责混杂、认知负担高 | 提取方法 |
| 过大类 | 类承担过多职责 | 提取类 |
| 过长参数列表 | 参数常共同传递、构成整体 | 引入参数对象 |
| 发散式变化 | 一个类因多种原因修改 | 提取类 |
| 霰弹式修改 | 一个修改涉及多个类 | 移动方法/聚合行为 |
| 依恋情结 | 方法过多使用其他类数据 | 移动方法 |
| 数据泥团 | 多个数据项总是一起出现 | 提取类 |
| 基本类型偏执 | 滥用基本类型 | 引入值对象 |
| switch 过多 | 大量 if-else/switch | 多态 |
| 平行继承体系 | 子类数量同步增长 | 合并/减少层次依赖 |
| 冗余类 | 类没有存在的价值 | 内联类 |
| 过度耦合 | 类之间依赖过深 | 提取接口（视边界） |
| 纯数据类 | 只有 getter/setter | 封装行为 |

## 2. 如何识别

- Code Review
- 静态分析工具（SonarQube）
- 代码复杂度指标

## 3. 代码坏味道的实战示例

### 3.1 过长方法示例

```java
// 差：一个方法做太多事情
public void processOrder(String userId, String productId, int quantity,
                         String couponCode, String address, String payType) {
    // 1. 验证用户
    User user = userDao.findById(userId);
    if (user == null) throw new RuntimeException("用户不存在");
    if (!user.isActive()) throw new RuntimeException("用户已禁用");
    
    // 2. 验证商品
    Product product = productDao.findById(productId);
    if (product == null) throw new RuntimeException("商品不存在");
    if (product.getStock() < quantity) throw new RuntimeException("库存不足");
    
    // 3. 计算价格
    BigDecimal price = product.getPrice().multiply(BigDecimal.valueOf(quantity));
    if (couponCode != null) {
        Coupon coupon = couponDao.findByCode(couponCode);
        if (coupon != null && coupon.isValid()) {
            price = price.multiply(BigDecimal.ONE.subtract(coupon.getDiscount()));
        }
    }
    
    // 4. 创建订单
    Order order = new Order();
    order.setUserId(userId);
    order.setProductId(productId);
    order.setQuantity(quantity);
    order.setTotalPrice(price);
    order.setAddress(address);
    orderDao.save(order);
    
    // 5. 扣减库存
    product.setStock(product.getStock() - quantity);
    productDao.update(product);
    
    // 6. 发送通知
    emailService.send(user.getEmail(), "订单创建成功");
    smsService.send(user.getPhone(), "您的订单已创建");
}

// 好：拆分为多个小方法，每个方法职责单一
public class OrderService {
    public Long processOrder(OrderRequest request) {
        User user = validateUser(request.getUserId());
        Product product = validateProduct(request.getProductId(), request.getQuantity());
        BigDecimal price = calculatePrice(product, request.getQuantity(), request.getCouponCode());
        Order order = createOrder(user, product, request, price);
        deductStock(product, request.getQuantity());
        notifyUser(user, order);
        return order.getId();
    }
    
    private User validateUser(String userId) { /* ... */ return null; }
    private Product validateProduct(String productId, int quantity) { /* ... */ return null; }
    private BigDecimal calculatePrice(Product product, int qty, String coupon) { /* ... */ return null; }
    private Order createOrder(User user, Product product, OrderRequest req, BigDecimal price) { /* ... */ return null; }
    private void deductStock(Product product, int quantity) { /* ... */ }
    private void notifyUser(User user, Order order) { /* ... */ }
}
```

> 该示例只演示方法职责拆分，不构成完整的订单实现。真实的订单处理还需处理：库存扣减需结合并发控制（乐观锁/悲观锁）防止超卖；订单写入与库存更新的一致性取决于实际事务边界；通知发送需根据可靠性要求选择事务内发送、事务性发件箱或可靠消息投递。方法拆分改善的是可读性，业务一致性属于另一个维度的问题。拆分后的代码省略了持久化调用细节（如 orderDao.save 的位置），是结构示意，而非可直接对照的完整重构结果。

### 3.2 特性依恋（Feature Envy）示例

```java
// 差：方法过多使用其他类的数据
class OrderProcessor {
    public BigDecimal calculateDiscount(Order order) {
        // 过度使用 Customer 的数据
        int orderCount = order.getCustomer().getOrderCount();
        String level = order.getCustomer().getLevel();
        boolean isVip = order.getCustomer().isVip();
        
        if (isVip) return BigDecimal.valueOf(0.2);
        if (orderCount > 100) return BigDecimal.valueOf(0.1);
        return BigDecimal.ZERO;
    }
}

// 好：如果折扣规则由客户自身状态决定，且属于客户的领域职责，可移入 Customer
class Customer {
    public BigDecimal calculateDiscount() {
        if (isVip()) return BigDecimal.valueOf(0.2);
        if (getOrderCount() > 100) return BigDecimal.valueOf(0.1);
        return BigDecimal.ZERO;
    }
}
```

> 移动行为不是无条件的选择。Feature Envy 只是提示「职责可能放错位置」，并非要求把所有访问外部数据的方法都移过去。若折扣规则由营销策略或多个业务对象共同决定，则更适合放在独立的折扣策略或领域服务中，而非塞进 Customer 实体。

### 3.3 过多注释（Comments）

```java
// 差：注释说明代码意图，但代码本身不清晰
// 检查用户年龄是否大于 18
if (user.getAge() >= 18) { /* ... */ }

// 好：代码自解释
boolean isAdult = user.getAge() >= LEGAL_AGE;
if (isAdult) { /* ... */ }
```

> 提取有意义的命名有助于表达意图，但并非所有解释性注释都应删除。记录业务规则、约束和不易察觉的原因的注释仍然必要，删注释针对的是重复复述代码本身的注释。

## 4. 使用 SonarQube 进行静态分析

```bash
# 启动 SonarQube（建议固定版本，便于复现）
docker run -d --name sonarqube -p 9000:9000 sonarqube:10.7-community

# Maven 集成
mvn sonar:sonar \
  -Dsonar.host.url=http://localhost:9000 \
  -Dsonar.token=your-token

# 常见规则（以下为项目可配置的示例阈值，并非 SonarQube 通用默认规则）
# - 方法行数超过 50 行
# - 圈复杂度 > 15
# - 重复代码 > 3%
# - 类文件行数 > 1000 行
```

> **最佳实践**：在 CI/CD 流水线中配置质量门禁（Quality Gate）检查，并将检查结果接入仓库的合并保护策略，才能阻止不符合要求的变更合并。
