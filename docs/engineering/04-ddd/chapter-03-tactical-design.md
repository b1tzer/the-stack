# 战术设计

> **核心问题**：实体、值对象、聚合根如何设计？领域服务和应用服务有什么区别？仓储模式如何实现？

## 1. 实体 vs 值对象

| 特性 | 实体（Entity） | 值对象（Value Object） |
| :-- | :-- | :-- |
| 唯一标识 | 有（ID） | 无 |
| 可变性 | 可变 | 不可变 |
| 相等性 | 基于 ID | 基于属性值 |
| 生命周期 | 有明确生命周期 | 无，可随时替换 |
| 示例 | Order、User | Money、Address、DateRange |

```java
// 值对象：不可变，基于值比较
public record Address(
    String province,
    String city,
    String district,
    String street
) {
    // 值对象的相等性由属性值决定（record 自动生成 equals/hashCode）
    
    public Address withCity(String newCity) {
        return new Address(province, newCity, district, street);
    }
}

// 实体：基于 ID 比较
public class User {
    private final Long id;  // 唯一标识
    private String name;
    private Address address;  // 值对象作为属性
    
    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (!(o instanceof User user)) return false;
        return Objects.equals(id, user.id);  // 基于 ID 比较
    }
    
    @Override
    public int hashCode() {
        return Objects.hash(id);
    }
}
```

## 2. 聚合设计原则

| 原则 | 说明 |
| :-- | :-- |
| 聚合边界内强一致性 | 聚合内的修改在同一事务中完成 |
| 聚合间最终一致性 | 聚合之间通过领域事件异步同步 |
| 通过 ID 引用其他聚合 | 不直接持有其他聚合的引用 |
| 小聚合 | 聚合越小越好，只包含必须强一致的元素 |

```java
// 差：大聚合（Order 持有 Product 引用）
class Order {
    private List<Product> products;  // 直接引用 Product 聚合
    // Product 变更会影响 Order，导致聚合过大
}

// 好：小聚合（通过 ID 引用）
class Order {
    private final Long id;
    private final List<OrderLine> lines = new ArrayList<>();
    
    public void addLine(Long productId, String productName, int quantity, Money price) {
        // 通过 productId 引用，不直接持有 Product
        OrderLine line = new OrderLine(productId, productName, quantity, price);
        lines.add(line);
    }
    
    public Money calculateTotal() {
        return lines.stream()
            .map(OrderLine::getSubtotal)
            .reduce(Money::add)
            .orElse(new Money(BigDecimal.ZERO, Currency.CNY));
    }
}

class OrderLine {
    private Long productId;      // ID 引用，非对象引用
    private String productName;  // 冗余数据快照
    private int quantity;
    private Money price;
    
    OrderLine(Long productId, String productName, int quantity, Money price) {
        this.productId = productId;
        this.productName = productName;
        this.quantity = quantity;
        this.price = price;
    }
    
    Money getSubtotal() { return price.multiply(quantity); }
}
```

## 3. 领域服务 vs 应用服务

| 特性 | 领域服务 | 应用服务 |
| :-- | :-- | :-- |
| 位置 | 领域层 | 应用层 |
| 职责 | 不属于实体的业务逻辑 | 编排领域对象，协调基础设施 |
| 依赖 | 只依赖领域对象 | 依赖领域服务和基础设施接口 |
| 示例 | 转账服务、定价服务 | 订单创建流程、支付流程 |

```java
// 领域服务：不属于任何实体的业务逻辑
public class TransferService {
    public void transfer(Account from, Account to, Money amount) {
        if (!from.canTransfer(amount)) {
            throw new InsufficientBalanceException();
        }
        from.debit(amount);
        to.credit(amount);
    }
}

// 应用服务：编排领域对象和基础设施
@Service
public class CreateOrderApplicationService {
    private final OrderRepository orderRepo;
    private final ProductService productService;  // 防腐层，获取商品信息
    private final PaymentGateway paymentGateway;
    private final DomainEventPublisher eventPublisher;
    
    @Transactional
    public OrderResult execute(CreateOrderCommand cmd) {
        // 1. 获取商品信息（跨上下文）
        ProductInfo product = productService.getInfo(cmd.productId());
        
        // 2. 创建订单（领域对象）
        Order order = new Order(generateId(), cmd.userId());
        order.addLine(product.id(), product.name(), cmd.quantity(), product.price());
        order.confirm();
        
        // 3. 持久化
        orderRepo.save(order);
        
        // 4. 发布领域事件
        order.getDomainEvents().forEach(eventPublisher::publish);
        
        return new OrderResult(order.getId(), order.getTotalAmount());
    }
}
```

## 4. 仓储模式

```java
// 仓储接口（领域层定义，不依赖具体实现）
public interface OrderRepository {
    void save(Order order);
    Order findById(Long id);
    List<Order> findByUserId(Long userId);
}

// 仓储实现（基础设施层）
@Repository
public class JpaOrderRepository implements OrderRepository {
    private final OrderJpaRepository jpaRepo;
    private final OrderItemJpaRepository itemRepo;
    
    @Override
    @Transactional
    public void save(Order order) {
        // 聚合根负责整个聚合的持久化
        OrderEntity entity = OrderMapper.toEntity(order);
        jpaRepo.save(entity);
        
        // 保存聚合内的子实体
        List<OrderItemEntity> items = order.getLines().stream()
            .map(line -> OrderMapper.toItemEntity(line, order.getId()))
            .toList();
        itemRepo.saveAll(items);
    }
    
    @Override
    public Order findById(Long id) {
        OrderEntity entity = jpaRepo.findById(id)
            .orElseThrow(() -> new OrderNotFoundException(id));
        List<OrderItemEntity> items = itemRepo.findByOrderId(id);
        return OrderMapper.toDomain(entity, items);
    }
}
```

> **核心原则**：战术设计的目的是让代码反映业务领域。实体封装业务规则，值对象保证数据完整性，聚合维护一致性边界，领域服务处理跨实体的业务逻辑。
