# 其他设计原则

> 本页讨论组合、解耦和通用设计取舍。Java 中接口、抽象类与继承的表达方式见 [面向对象](../../java/01-java-language/chapter-04-oop.md)。

## 1. DRY (Don't Repeat Yourself)

避免重复代码。

```java
// 差：重复逻辑
void processOrder(Order order) {
    validate(order);
    // ... 处理逻辑
}
void processRefund(Refund refund) {
    validate(refund);
    // ... 处理逻辑
}

// 好：提取公共方法
void validate(Object entity) { /* 通用校验 */ }
```

## 2. KISS (Keep It Simple, Stupid)

保持简单。

## 3. YAGNI (You Aren't Gonna Need It)

不要过度设计。

## 4. 迪米特法则 (LoD)

最少知识原则，只与直接朋友通信。

```java
// 差：调用方被迫穿透多个内部对象
order.getCustomer().getAddress().getCity();

// 好：由拥有该行为的对象直接提供
order.getShippingCity();
```

链式调用本身并不违反迪米特法则。判断的关键是调用方是否被迫理解并组合多个内部对象的结构才能完成业务操作，以及这些结构变化是否会向上游传播。若 `getShippingCity()` 只是把底层导航搬进另一个方法，并没有消除耦合，反而可能制造大量转发方法、扩大类的接口。当调用链只是稳定的数据读取路径时，不必为缩短链条而增加包装方法。

## 5. 组合优于继承

```java
// 继承：复用基类的通用校验逻辑
abstract class BaseOrderService {
    protected void validate(Order order) { /* 通用校验 */ }
}

class InheritedOrderService extends BaseOrderService {
    public void placeOrder(Order order) {
        validate(order);  // 复用基类实现
        // 订单处理
    }
}

// 组合：校验策略可独立替换、单独测试
class OrderService {
    private final Validator validator;

    OrderService(Validator validator) { this.validator = validator; }

    public void placeOrder(Order order) {
        validator.validate(order);
        // 订单处理
    }
}
```

继承与组合各有适用场景，并非继承本身是反模式。当类型之间存在稳定的行为契约、需要复用通用实现时，继承合理；当行为需要独立替换、组合或单独测试时，组合更灵活。满足里氏替换原则（见 [SOLID 的里氏替换原则](./chapter-02-solid.md)）只是采用继承的必要条件，而非充分条件；即使继承语义成立，若调用方需要在运行时替换行为或独立测试，组合仍可能更合适。

## 6. 关注点分离 (SoC)

将程序分离为不同部分，每部分处理不同的关注点。

```java
// 差：业务逻辑和数据访问混在一起
class UserService {
    public User getUser(Long id) {
        String sql = "SELECT * FROM users WHERE id = ?";
        // JDBC 查询逻辑直接混在业务方法中
        try (Connection conn = DriverManager.getConnection(url);
             PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setLong(1, id);
            ResultSet rs = ps.executeQuery();
            if (rs.next()) {
                return new User(rs.getLong("id"), rs.getString("name"));
            }
        } catch (SQLException e) { /* ... */ }
        return null;
    }
}

// 好：分离数据访问和业务逻辑
interface UserRepository {
    User findById(Long id);
}

class JdbcUserRepository implements UserRepository {
    private final DataSource dataSource;
    JdbcUserRepository(DataSource ds) { this.dataSource = ds; }
    
    @Override
    public User findById(Long id) {
        // 纯数据访问逻辑
        return null;
    }
}

class UserService {
    private final UserRepository repository;
    UserService(UserRepository repo) { this.repository = repo; }
    
    public User getUser(Long id) {
        // 纯业务逻辑
        User user = repository.findById(id);
        if (user == null) throw new UserNotFoundException(id);
        return user;
    }
}
```

## 7. 好莱坞原则 (Hollywood Principle)

"Don't call us, we'll call you." —— 框架调用你的代码，而不是你调用框架。

模板方法只是实现这种控制反转的一种方式，并非好莱坞原则的全部；事件监听、回调注册、生命周期回调同样体现这一控制关系。下面用模板方法示例说明：

```java
// 模板方法：父类控制流程，调用子类实现的钩子
abstract class DataProcessor {
    // 模板方法：框架控制流程
    public final void process() {
        open();
        parse();
        transform();
        close();
    }
    
    protected abstract void parse();    // 由子类实现
    protected abstract void transform();
    
    private void open()  { /* 框架提供 */ }
    private void close() { /* 框架提供 */ }
}

class CSVProcessor extends DataProcessor {
    @Override
    protected void parse() { /* CSV 解析逻辑 */ }
    @Override
    protected void transform() { /* CSV 转换逻辑 */ }
}
```

## 8. 契约式设计 (DbC)

方法通过前置条件、后置条件和不变量定义契约。

```java
/**
 * 订单服务 - 契约式设计示例
 * 前置条件：amount > 0, userId 非空
 * 后置条件：返回的订单 ID 非空
 */
public class OrderService {
    
    public Long createOrder(Long userId, BigDecimal amount) {
        // 前置条件校验
        Objects.requireNonNull(userId, "用户ID不能为空");
        Objects.requireNonNull(amount, "金额不能为空");
        if (amount.compareTo(BigDecimal.ZERO) <= 0) {
            throw new IllegalArgumentException("金额必须大于0");
        }
        
        // 业务逻辑
        Order order = new Order(userId, amount);
        Long orderId = save(order);
        
        // 后置条件校验：必须显式检查，不能依赖 assert（Java 默认关闭断言）
        if (orderId == null) {
            throw new IllegalStateException("保存订单后未生成订单 ID");
        }
        return orderId;
    }
    
    private Long save(Order order) {
        return order.getId();
    }
}
```

前置条件、后置条件和不变量是契约式设计的核心概念，但并非每项契约都必须通过运行时检查实现；持久化事务、并发操作及外部依赖也可能影响实际结果。执行了校验不等于系统已经保证契约。

## 9. 控制反转 (IoC)

将控制权从应用代码转移到框架/容器。

```java
// 差：应用代码自己创建依赖
class OrderController {
    private OrderService service = new OrderService(
        new OrderRepository(new DataSource())
    );
}

// 好：容器管理对象的创建和生命周期
// 应用启动时，容器按声明创建 DataSource → OrderRepository → OrderService 的依赖链，
// 需要哪个就注入哪个，应用代码不再自己 new。
@Configuration
public class AppConfig {
    @Bean
    public DataSource dataSource() {
        return new HikariDataSource();
    }
    
    @Bean
    public OrderRepository orderRepository(DataSource ds) {
        return new JdbcOrderRepository(ds);
    }
    
    @Bean
    public OrderService orderService(OrderRepository repo) {
        return new OrderService(repo);
    }
}
```

> **核心理念**：这些原则的共同目标是降低耦合、提高内聚。好的设计让代码易于理解、测试和修改。
