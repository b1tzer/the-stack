# 其他设计原则

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
// 差：链式调用
order.getCustomer().getAddress().getCity();

// 好：封装
order.getShippingCity();
```

## 5. 组合优于继承

```java
// 差：继承
class ArrayList<E> extends AbstractList<E> { /* ... */ }

// 好：组合
class OrderService {
    private final Validator validator;
    private final Repository repository;
}
```

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

```java
// 框架通过回调/钩子调用应用代码
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
        if (amount.compareTo(BigDecimal.ZERO) <= 0) {
            throw new IllegalArgumentException("金额必须大于0");
        }
        
        // 业务逻辑
        Order order = new Order(userId, amount);
        Long orderId = save(order);
        
        // 后置条件校验
        assert orderId != null : "订单ID不能为空";
        return orderId;
    }
    
    private Long save(Order order) {
        return order.getId();
    }
}
```

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
