# 整洁架构

## 1. 核心思想

> 本文聚焦整洁架构的依赖规则、Java 实现与工程约束。架构演进、各风格对比与选型决策见 [软件架构演进](chapter-01-architecture-styles.md)。

依赖方向向内，外层依赖内层，内层不知道外层。

```txt
┌─────────────────────────────────┐
│         框架与驱动                │  外层
│  ┌───────────────────────────┐  │
│  │       接口适配器           │  │
│  │  ┌─────────────────────┐  │  │
│  │  │     用例层           │  │  │
│  │  │  ┌───────────────┐  │  │  │
│  │  │  │   实体层       │  │  │  │  内层
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

六边形架构的核心是端口与适配器：应用核心（内层）定义端口接口，外部适配器（数据库、Web、消息队列等）实现这些接口，核心域因此不依赖任何外部技术。图示与演进背景见 [软件架构演进](chapter-01-architecture-styles.md)。

## 4. 洋葱架构

洋葱架构与六边形、整洁架构同源，同样强调依赖方向向内、核心域不依赖外部框架，区别在分层粒度与命名方式。三者并非互斥选项，实际项目常组合体现，不必二选一。

## 5. 整洁架构的 Java 实现

```java
// 本示例聚焦依赖方向，省略了 OrderStatus、CreateOrderCommand、PaymentResult、
// OrderJpaEntityRepository、OrderMapper 等无关类型与 import，不代表可直接编译运行。
// 实体层：核心业务规则，不依赖任何框架
public class Order {
    private Long id;
    private String userId;
    private BigDecimal amount;
    private OrderStatus status;
    
    public Order(String userId, BigDecimal amount) {
        if (userId == null || userId.isBlank()) {
            throw new IllegalArgumentException("userId 不能为空");
        }
        if (amount == null || amount.signum() <= 0) {
            throw new IllegalArgumentException("金额必须大于 0");
        }
        this.userId = userId;
        this.amount = amount;
        this.status = OrderStatus.CREATED;
    }
    
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
    
    public BigDecimal getAmount() {
        return amount;
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
        // 注意：此处先扣款再持久化的顺序仅为展示依赖方向，简化了跨系统一致性处理，不能直接用于生产。
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

示例中的三个要点：

1. **端口由内层定义**：`OrderRepository`、`PaymentGateway`、`OrderPresenter` 是内层定义的接口，外层适配器实现它们。控制流向外（用例调用网关、仓库），源码依赖始终向内（用例只依赖接口，不依赖具体实现），这就是依赖倒置。

2. **用例定义事务边界，机制由外层提供**：用例定义需要保持原子性的业务操作边界，具体事务机制由外层基础设施提供。Spring 项目通常在用例入口用 `@Transactional` 声明事务，但跨支付网关的调用不能因此被视为与数据库操作处于同一个原子事务中。

3. **支付与持久化是独立失败边界**：`paymentGateway.charge()` 与 `orderRepository.save()` 之间存在跨系统的一致性缺口。支付成功而本地持久化失败、支付超时但实际已扣款，都需要额外的幂等键、结果核实或补偿机制，依赖倒置本身不能解决分布式一致性问题。示例省略这些机制，仅为展示依赖方向，不代表可直接用于生产。

## 6. 三种架构模式的对比

| 特性 | 传统三层 | 六边形架构 | 整洁架构 |
| :-- | :-- | :-- | :-- |
| 依赖方向 | 自顶向下 | 核心定义端口，适配器实现，源码依赖指向抽象 | 由外向内（严格分层） |
| 可测试性 | 依赖数据库，集成测试为主 | 核心域可独立单测 | 分层边界清晰，各层可单测 |
| 框架依赖 | Service 依赖 DAO | 核心域不依赖框架 | 实体层零框架依赖 |
| 学习成本 | 低 | 中 | 高 |
| 适用场景 | 简单 CRUD | 中等复杂度业务 | 复杂业务，长期维护 |

三者并非互斥选项，也不在同一维度竞争。传统三层描述分层组织方式，六边形强调核心通过端口与适配器隔离外部技术，整洁架构强调依赖规则与实体层、用例层的组织。三层同样可以通过依赖倒置引入端口与适配器，整洁架构只是更明确地组织用例层与实体层之间的依赖边界。选择依据是依赖约束、测试边界与演进成本，而非架构名称的优劣排序。

## 7. 架构选型建议

选型不是按业务规模套架构名称，而是判断是否值得付出额外的抽象成本：

- 简单 CRUD 不必为了形式引入多层抽象，三层 + 模块化足够。
- 当核心业务规则需要独立测试、外部依赖（数据库、第三方服务）需要可替换，或业务变更频繁时，再引入端口与适配器、依赖倒置等边界。
- 整洁架构适合复杂业务与长期维护，但每多一层抽象都对应实现与理解成本，需要团队具备相应能力。

> **Robert C. Martin 的观点**：架构的目标是降低系统长期开发与维护的总成本。好的架构应当让系统更容易适应需求变化，而不是为了体现架构形式而增加不必要的复杂度。
