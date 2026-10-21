# DDD 概览

## 1. 什么是 DDD

领域驱动设计，以业务领域为核心驱动力的软件设计方法。

## 2. 战略设计

- 统一语言（Ubiquitous Language）
- 限界上下文（Bounded Context）
- 上下文映射（Context Map）

战略设计划定模型的边界、语言与上下文之间的协作关系，详见[限界上下文与上下文映射](./chapter-02-bounded-context.md)。

## 3. 战术设计

| 概念 | 说明 |
| :-- | :-- |
| 实体 | 有唯一标识的领域对象 |
| 值对象 | 无唯一标识，按值比较，设计上不可变 |
| 聚合 | 维护一致性边界的对象集合 |
| 聚合根 | 聚合的入口点 |
| 领域服务 | 表达无法归属单一实体的领域操作 |
| 领域事件 | 领域中发生的事件 |
| 仓储 | 聚合的获取与持久化接口 |

战术设计在限界上下文内部表达领域规则，通过聚合约束一致性边界。实体、值对象与聚合见[战术设计](./chapter-03-tactical-design.md)，领域事件见[领域事件](./chapter-04-domain-events.md)，落地实践见[DDD 实践](./chapter-05-ddd-practice.md)。

## 4. 分层架构

```txt
用户接口层 → 应用层 → 领域层
                        ↑ 依赖端口/接口
                    基础设施层（实现端口）
```

箭头表示源码依赖方向：用户接口层依赖应用层，应用层依赖领域层；基础设施层实现领域层定义的端口，源码依赖该接口定义。领域层只依赖自身端口，不依赖基础设施的具体实现。

## 5. DDD vs 传统架构

DDD 与非 DDD 的关键区别不在于固定的设计顺序或存储模型，而在于是否持续围绕领域知识建模，并采用统一语言、限界上下文等战略设计方法。DDD 同样可以结合关系数据库、ORM 与模块化单体使用；非 DDD 系统也可以从业务需求出发设计。

## 6. DDD 的核心优势

| 优势 | 说明 |
| :-- | :-- |
| 业务对齐 | 代码结构反映业务领域，非技术细节 |
| 统一语言 | 开发和业务使用同一套术语，减少沟通成本 |
| 可维护性 | 领域逻辑集中在领域层，易于理解和修改 |
| 可测试性 | 领域模型不依赖框架，可以纯单元测试 |
| 可扩展性 | 限界上下文清晰，模块边界明确 |

## 7. DDD 战术设计代码示例

以下代码用于说明值对象、聚合根及其业务约束，省略了部分参数校验和生产级实现细节。

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
        if (factor < 0) {
            throw new IllegalArgumentException("倍数不能为负");
        }
        return new Money(amount.multiply(BigDecimal.valueOf(factor)), currency);
    }
}

// 聚合根：有唯一标识，聚合的入口点
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
        if (quantity <= 0) {
            throw new IllegalArgumentException("数量必须为正数");
        }
        if (!totalAmount.currency().equals(price.currency())) {
            throw new IllegalArgumentException("商品币种与订单不一致");
        }
        OrderItem item = new OrderItem(productId, quantity, price);
        items.add(item);
        recalculateTotal();
    }
    
    public void confirm() {
        if (status != OrderStatus.CREATED) {
            throw new IllegalStateException("只有已创建的订单才能确认");
        }
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

// 聚合内实体
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
