# 整洁架构

## 1. 核心思想

依赖方向向内，外层依赖内层，内层不知道外层。

```txt
┌─────────────────────────────────┐
│         框架与驱动              │  外层
│  ┌───────────────────────────┐  │
│  │       接口适配器          │  │
│  │  ┌─────────────────────┐  │  │
│  │  │     用例层          │  │  │
│  │  │  ┌───────────────┐  │  │  │
│  │  │  │   实体层      │  │  │  │  内层
│  │  │  └───────────────┘  │  │  │
│  │  └─────────────────────┘  │  │
│  └───────────────────────────┘  │
└─────────────────────────────────┘
```

## 2. 各层职责

| 层 | 职责 |
| :-- | :-- |
| 实体层 | 业务规则、领域对象 |
| 用例层 | 应用业务规则、编排 |
| 接口适配器 | 控制器、网关、Presenter |
| 框架与驱动 | Web框架、数据库、外部服务 |

## 3. 六边形架构

```txt
        ┌─────────────┐
        │   应用核心   │
        │  ┌───────┐  │
Port ←──┤  │ 业务  │  ├──→ Port
        │  └───────┘  │
        └─────────────┘
Adapter ←──            ──→ Adapter
```

## 4. 洋葱架构

与整洁架构类似，强调依赖方向向内。

## 5. 整洁架构的 Java 实现

```java
// 实体层：核心业务规则，不依赖任何框架
public class Order {
    private Long id;
    private String userId;
    private BigDecimal amount;
    private OrderStatus status;
    
    // 业务规则在实体中
    public void confirm() {
        if (status != OrderStatus.CREATED) {
            throw new IllegalStateException("只有已创建的订单才能确认");
        }
        this.status = OrderStatus.CONFIRMED;
    }
    
    public boolean canCancel() {
        return status == OrderStatus.CREATED || status == OrderStatus.CONFIRMED;
    }
}

// 用例层：编排领域对象
public class CreateOrderUseCase {
    private final OrderRepository orderRepository;   // 端口（出站）
    private final PaymentGateway paymentGateway;     // 端口（出站）
    private final OrderPresenter presenter;          // 端口（出站）
    
    public CreateOrderUseCase(OrderRepository repo, PaymentGateway gw, OrderPresenter p) {
        this.orderRepository = repo;
        this.paymentGateway = gw;
        this.presenter = p;
    }
    
    public OrderResponse execute(CreateOrderCommand command) {
        // 1. 创建领域对象
        Order order = new Order(command.getUserId(), command.getAmount());
        
        // 2. 调用支付网关
        PaymentResult result = paymentGateway.charge(order.getAmount());
        if (!result.isSuccess()) {
            return presenter.presentError("支付失败");
        }
        
        // 3. 持久化
        order.confirm();
        orderRepository.save(order);
        
        // 4. 输出
        return presenter.presentSuccess(order);
    }
}

// 端口（接口）
public interface OrderRepository {
    void save(Order order);
    Order findById(Long id);
}

public interface PaymentGateway {
    PaymentResult charge(BigDecimal amount);
}

public interface OrderPresenter {
    OrderResponse presentSuccess(Order order);
    OrderResponse presentError(String message);
}

// 适配器层：实现端口
@Repository
public class JpaOrderRepository implements OrderRepository {
    private final OrderJpaEntityRepository jpaRepo;
    
    JpaOrderRepository(OrderJpaEntityRepository jpaRepo) { this.jpaRepo = jpaRepo; }
    
    @Override
    public void save(Order order) {
        jpaRepo.save(OrderMapper.toEntity(order));
    }
    
    @Override
    public Order findById(Long id) {
        return jpaRepo.findById(id).map(OrderMapper::toDomain).orElse(null);
    }
}

// 框架层：依赖装配
// 由框架在启动时把外层适配器（OrderRepository、PaymentGateway、Presenter）注入用例，
@Configuration
public class OrderConfig {
    @Bean
    public CreateOrderUseCase createOrderUseCase(
            OrderRepository repo,
            PaymentGateway gw,
            OrderPresenter presenter) {
        return new CreateOrderUseCase(repo, gw, presenter);
    }
}
```

## 6. 三种架构模式的对比

| 特性 | 传统三层 | 六边形架构 | 整洁架构 |
| :-- | :-- | :-- | :-- |
| 依赖方向 | 自顶向下 | 由外向内（通过端口） | 由外向内（严格分层） |
| 领域模型 | 贫血模型 | 领域模型 | 领域模型 + 用例 |
| 可测试性 | 较差 | 好 | 最好 |
| 框架依赖 | Service 依赖 DAO | 核心域不依赖框架 | 实体层零框架依赖 |
| 学习成本 | 低 | 中 | 高 |
| 适用场景 | 简单 CRUD | 中等复杂度业务 | 复杂业务，长期维护 |

## 7. 架构选型建议

```java
/**
 * 架构选型不是技术问题，而是业务复杂度问题。
 * 
 * 决策参考：
 * 1. 业务简单、团队小 → 三层架构足够
 * 2. 业务中等、需要可测试性 → 六边形架构
 * 3. 业务复杂、长期维护、多团队 → 整洁架构
 * 
 * 核心原则：依赖方向向内，业务逻辑不依赖框架。
 */
```

> **Robert C. Martin 的忠告**："架构的终极目标是最小化人力成本。好的架构让你能轻松应对需求变化，而不是让代码看起来很'架构'。"
