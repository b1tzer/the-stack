# DDD 概览

## 1. 什么是 DDD

领域驱动设计，以业务领域为核心驱动力的软件设计方法。

## 2. 战略设计

- 统一语言（Ubiquitous Language）
- 限界上下文（Bounded Context）
- 上下文映射（Context Map）

## 3. 战术设计

| 概念 | 说明 |
| :-- | :-- |
| 实体 | 有唯一标识的领域对象 |
| 值对象 | 无唯一标识，不可变 |
| 聚合 | 一组相关对象的集合 |
| 聚合根 | 聚合的入口点 |
| 领域服务 | 不属于实体的业务逻辑 |
| 领域事件 | 领域中发生的事件 |
| 仓储 | 聚合的持久化接口 |

## 4. 分层架构

```
用户接口层 → 应用层 → 领域层 → 基础设施层
```

## 5. DDD vs 传统架构

| 特性 | DDD | 传统 |
| :-- | :-- | :-- |
| 核心 | 业务领域 | 数据模型 |
| 设计 | 自顶向下 | 自底向上 |
| 复杂度 | 适合复杂业务 | 简单业务 |

## 6. DDD 的核心优势

| 优势 | 说明 |
| :-- | :-- |
| 业务对齐 | 代码结构反映业务领域，非技术细节 |
| 统一语言 | 开发和业务使用同一套术语，减少沟通成本 |
| 可维护性 | 领域逻辑集中在领域层，易于理解和修改 |
| 可测试性 | 领域模型不依赖框架，可以纯单元测试 |
| 可扩展性 | 限界上下文清晰，模块边界明确 |

## 7. DDD 战术设计代码示例

```java
// 值对象：无唯一标识，不可变
public record Money(BigDecimal amount, Currency currency) {
    public Money {
        if (amount.compareTo(BigDecimal.ZERO) < 0) {
            throw new IllegalArgumentException("金额不能为负");
        }
    }
    
    public Money add(Money other) {
        if (!currency.equals(other.currency)) {
            throw new IllegalArgumentException("货币类型不同");
        }
        return new Money(amount.add(other.amount), currency);
    }
    
    public Money multiply(int factor) {
        return new Money(amount.multiply(BigDecimal.valueOf(factor)), currency);
    }
}

// 实体：有唯一标识
public class Order {
    private final Long id;          // 唯一标识
    private Long userId;
    private OrderStatus status;
    private Money totalAmount;
    private final List<OrderItem> items = new ArrayList<>();
    private final List<DomainEvent> events = new ArrayList<>();
    
    public Order(Long id, Long userId) {
        this.id = id;
        this.userId = userId;
        this.status = OrderStatus.CREATED;
        this.totalAmount = new Money(BigDecimal.ZERO, Currency.CNY);
    }
    
    // 业务方法：状态变更
    public void addItem(String productId, int quantity, Money price) {
        if (status != OrderStatus.CREATED) {
            throw new IllegalStateException("只有已创建的订单才能添加商品");
        }
        OrderItem item = new OrderItem(productId, quantity, price);
        items.add(item);
        recalculateTotal();
    }
    
    public void confirm() {
        if (items.isEmpty()) {
            throw new IllegalStateException("空订单不能确认");
        }
        this.status = OrderStatus.CONFIRMED;
        events.add(new OrderConfirmedEvent(this.id, LocalDateTime.now()));
    }
    
    private void recalculateTotal() {
        this.totalAmount = items.stream()
            .map(OrderItem::getSubtotal)
            .reduce(new Money(BigDecimal.ZERO, Currency.CNY), Money::add);
    }
    
    public Long getId() { return id; }
    public OrderStatus getStatus() { return status; }
    public Money getTotalAmount() { return totalAmount; }
    public List<DomainEvent> getDomainEvents() { return List.copyOf(events); }
}

// 聚合根：聚合的入口点，负责维护聚合内的一致性
class OrderItem {
    private String productId;
    private int quantity;
    private Money price;
    
    OrderItem(String productId, int quantity, Money price) {
        this.productId = productId;
        this.quantity = quantity;
        this.price = price;
    }
    
    Money getSubtotal() { return price.multiply(quantity); }
}
```

## 8. DDD 的适用场景

| 场景 | 是否适合 DDD | 原因 |
| :-- | :-- | :-- |
| 复杂业务逻辑 | ✅ 适合 | DDD 的领域模型能有效管理复杂度 |
| 简单 CRUD | ❌ 不适合 | 过度设计，增加不必要的复杂度 |
| 多团队协作 | ✅ 适合 | 限界上下文明确团队边界 |
| 业务频繁变化 | ✅ 适合 | 领域模型更贴近业务，易于调整 |
| 技术驱动项目 | ❌ 不适合 | 如编解码器、算法库，业务逻辑简单 |

> **DDD 不是银弹**：Eric Evans 说过，DDD 适合复杂领域。如果你的业务逻辑简单到用 CRUD 就能解决，那就用 CRUD。不要为了 DDD 而 DDD。
