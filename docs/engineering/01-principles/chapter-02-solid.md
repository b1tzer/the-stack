# SOLID 原则

> 本页从设计原则解释如何组织类和依赖。Java 的封装、继承、多态与接口语义见 [面向对象](../../java/01-java-language/chapter-04-oop.md)。

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

判断一个类是否承担了多个职责，看它是否会因多种不同的原因而被修改：当一个类同时因数据库变化、邮件规则变化等互不相干的原因需要改动时，就应当拆分。判断与重构信号见 [代码坏味道](./chapter-04-code-smells.md) 中的「发散式变化」与「霰弹式修改」。

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

扩展点不是越多越好。当新支付渠道持续出现、各渠道行为存在稳定差异时，策略接口有助于隔离变化；若只有两个固定分支且没有扩展需求，直接使用条件分支反而更简单。抽象的价值取决于变化发生的概率与隔离变化的收益，而非是否使用了接口。策略模式的具体实现见 [设计模式专题](/design-pattern/03-behavioral/chapter-01-strategy)。

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
```

问题不在几何上「正方形是不是长方形」，而在可变的 `Rectangle` 提供了独立设置宽、高的行为契约。`Square` 重写 `setWidth`、`setHeight` 后把两个维度绑在一起，破坏了下述依赖独立设置的调用方预期：

```java
// 调用方依赖 Rectangle 可独立设置宽、高
static void resize(Rectangle rectangle) {
    rectangle.setWidth(10);
    rectangle.setHeight(5);
    if (rectangle.area() != 50) {   // 预期 10 * 5
        throw new IllegalStateException("行为契约被破坏");
    }
}
// 将 Square 传入后面积变为 25，调用方预期被破坏
```

```java
// 好：改用共同接口表达所需能力，避免不必要的继承
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

// 好：依赖抽象，由业务核心定义持久化端口
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

`OrderRepository` 是业务核心定义的持久化端口，MySQL 等基础设施负责实现它，业务层不依赖具体数据库类型。接口本身不能保证可替换性，实现仍需满足相同的业务契约（事务、一致性等）；构造器注入只是把具体实现的选择与组装移到外部，DIP 的核心是依赖方向而非注入方式。依赖方向的更多讨论见 [软件架构演进](../03-architecture/chapter-01-architecture-styles.md)。

## 6. SOLID 原则的权衡与实践

| 原则 | 过度使用的风险 | 实践建议 |
| :-- | :-- | :-- |
| SRP | 类爆炸，过度拆分 | 只在职责确实不同时才拆分 |
| OCP | 过度抽象，创建大量接口 | 不要仅因预期扩展就提前抽象，等变化呈现出稳定共同结构再提取扩展点 |
| LSP | 设计约束过多 | 明确子类的行为契约 |
| ISP | 接口过多，管理困难 | 按客户端需求分组，而非按实现分组 |
| DIP | 抽象层过多，代码晦涩 | 需要隔离业务策略与基础设施细节时，明确依赖抽象的边界 |

> **总结**：SOLID 不是教条，而是指导原则。在实际项目中，需要根据团队规模、业务复杂度和交付压力做权衡。过度设计和设计不足同样有害。
