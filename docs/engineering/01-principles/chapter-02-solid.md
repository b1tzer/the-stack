# SOLID 原则

## 1. S - 单一职责原则 (SRP)

一个类只有一个职责。

```java
// 差：一个类做多件事
class User {
    void save() { /* 数据库操作 */ }
    void sendEmail() { /* 邮件发送 */ }
}

// 好：职责分离
class UserRepository {
    void save(User user) { /* 数据库操作 */ }
}
class EmailService {
    void sendEmail(User user) { /* 邮件发送 */ }
}
```

## 2. O - 开闭原则 (OCP)

对扩展开放，对修改关闭。

```java
// 通过接口扩展，而非修改现有代码
interface Payment {
    void pay(BigDecimal amount);
}
class Alipay implements Payment { /* ... */ }
class WechatPay implements Payment { /* ... */ }
```

## 3. L - 里氏替换原则 (LSP)

子类必须能够替换父类而不影响程序的正确性。

```java
// 违反 LSP 的经典案例：正方形不是长方形的子类
abstract class Shape {
    abstract double area();
}

class Rectangle extends Shape {
    protected int width, height;
    
    void setWidth(int w) { this.width = w; }
    void setHeight(int h) { this.height = h; }
    
    @Override
    double area() { return width * height; }
}

class Square extends Rectangle {
    @Override
    void setWidth(int w) { this.width = w; this.height = w; }
    @Override
    void setHeight(int h) { this.width = h; this.height = h; }
}

// 好：使用接口约束行为，避免违反 LSP
interface AreaCalculable {
    double area();
}

class Rectangle2 implements AreaCalculable {
    private final int width, height;
    Rectangle2(int w, int h) { this.width = w; this.height = h; }
    @Override
    public double area() { return width * height; }
}

class Square2 implements AreaCalculable {
    private final int side;
    Square2(int side) { this.side = side; }
    @Override
    public double area() { return side * side; }
}
```

## 4. I - 接口隔离原则 (ISP)

客户端不应被迫依赖它不使用的接口。

```java
// 差：胖接口
interface Worker {
    void work();
    void eat();
    void sleep();
}

// 好：拆分为更小的接口
interface Workable { void work(); }
interface Eatable { void eat(); }
interface Sleepable { void sleep(); }

// Robot 只实现它需要的接口
class Robot implements Workable {
    @Override
    public void work() { System.out.println("机器人工作"); }
}

class HumanWorker implements Workable, Eatable, Sleepable {
    @Override
    public void work() { System.out.println("工作"); }
    @Override
    public void eat() { System.out.println("吃饭"); }
    @Override
    public void sleep() { System.out.println("睡觉"); }
}
```

## 5. D - 依赖倒置原则 (DIP)

高层模块不应依赖低层模块，两者都应依赖抽象。

```java
// 差：高层直接依赖低层实现
class OrderService {
    private MySQLOrderDao dao = new MySQLOrderDao(); // 硬编码依赖
    public void save(Order order) { dao.insert(order); }
}

// 好：依赖抽象，通过构造器注入
interface OrderRepository {
    void save(Order order);
    Order findById(Long id);
}

class MySQLOrderRepository implements OrderRepository {
    @Override
    public void save(Order order) { /* MySQL 保存 */ }
    @Override
    public Order findById(Long id) { /* MySQL 查询 */ return null; }
}

class RedisOrderRepository implements OrderRepository {
    @Override
    public void save(Order order) { /* Redis 保存 */ }
    @Override
    public Order findById(Long id) { /* Redis 查询 */ return null; }
}

// 高层模块依赖接口，具体实现由外部注入
class OrderService {
    private final OrderRepository repository;
    
    OrderService(OrderRepository repository) {
        this.repository = repository;
    }
    
    public void placeOrder(Order order) {
        // 业务逻辑
        repository.save(order);
    }
}
```

## 6. SOLID 原则的权衡与实践

| 原则 | 过度使用的风险 | 实践建议 |
| :-- | :-- | :-- |
| SRP | 类爆炸，过度拆分 | 只在职责确实不同时才拆分 |
| OCP | 过度抽象，创建大量接口 | 遵循 Rule of Three：第三次变化时再抽象 |
| LSP | 设计约束过多 | 明确子类的行为契约 |
| ISP | 接口过多，管理困难 | 按客户端需求分组，而非按实现分组 |
| DIP | 抽象层过多，代码晦涩 | 对变化频繁的依赖使用 DIP |

> **总结**：SOLID 不是教条，而是指导原则。在实际项目中，需要根据团队规模、业务复杂度和交付压力做权衡。过度设计和设计不足同样有害。
