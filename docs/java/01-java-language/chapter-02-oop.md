# 面向对象

> 你写了三年 Spring——Controller、Service、Repository 泾渭分明。但你最后一次按业务场景选抽象类还是接口，是哪一年？"接口定义契约，抽象类复用代码"——你背过面试答案，但当 `PaymentService` 既要校验参数又要记账时，该抽出一个接口还是加上一个 `abstract` 基类？"组合优于继承"不是教条，是同行们用无数次深夜事故换来的教训。

## 1. 为什么需要面向对象

### 1.1 过程式编程的困境

早期的 C 语言采用过程式编程——数据和操作数据的函数是分离的：

```c
// 数据
struct Account {
    char name[50];
    double balance;
};

// 操作数据的函数
void deposit(struct Account* acc, double amount) {
    acc->balance += amount;
}

void withdraw(struct Account* acc, double amount) {
    acc->balance -= amount;
}
```

这种模式在小程序中没问题。但当系统规模增长到几十万行代码时，问题开始暴露：

**1. 数据和行为分离，规则散落各处。** `balance` 可以被任何函数直接修改。`withdraw` 里有余额检查，但某个其他函数可能直接 `acc->balance -= amount` 绕过了检查。

**2. 全局状态泛滥。** 多个函数共享全局变量，修改一个变量可能影响看似无关的功能。

**3. 修改牵动全身。** 如果 `Account` 结构体加了一个字段，所有操作 `Account` 的函数都可能需要修改。

核心问题：**如何让软件的结构更接近现实世界？**

### 1.2 面向对象的核心思想

现实世界是由对象组成的：一个订单、一个用户、一辆汽车。每个对象有自己的**状态**（数据）和**行为**（操作）。

面向对象编程把数据和操作数据的方法组合成一个整体——对象：

```java
public class Account {
    private String name;
    private BigDecimal balance;

    public void deposit(BigDecimal amount) {
        this.balance = this.balance.add(amount);
    }

    public void withdraw(BigDecimal amount) {
        if (this.balance.compareTo(amount) < 0) {
            throw new InsufficientBalanceException();
        }
        this.balance = this.balance.subtract(amount);
    }
}
```

`Account` 对象**自己管理自己的状态**。外部代码不能直接修改 `balance`，必须通过 `deposit()` 和 `withdraw()` 方法。对象自己保证：余额不能小于 0、操作会记录日志、任何状态变化都经过验证。

这就是面向对象的核心：**让对象负责自己的状态和行为**。

## 2. 封装：控制状态与行为边界

封装是面向对象最核心的思想，也是最容易被误解的思想。

### 2.1 封装不是隐藏变量

很多教程把封装简化为"用 private 修饰字段，提供 getter/setter"。这不是封装，这只是换了一种写法：

```java
// ❌ 这不是封装，只是语法糖
public class Account {
    private double balance;

    public double getBalance() { return balance; }
    public void setBalance(double balance) { this.balance = balance; }
}
```

`setBalance()` 暴露了内部状态——外部代码可以随意设置余额为负数，和直接 `public double balance` 没有本质区别。

### 2.2 封装真正的含义

封装是**控制对象状态变化的入口**。对象自己决定什么操作是合法的：

```java
// ✅ 真正的封装
public class Account {
    private BigDecimal balance;
    private List<Transaction> history = new ArrayList<>();

    public void withdraw(BigDecimal amount) {
        if (amount.compareTo(BigDecimal.ZERO) <= 0) {
            throw new IllegalArgumentException("金额必须大于 0");
        }
        if (this.balance.compareTo(amount) < 0) {
            throw new InsufficientBalanceException();
        }
        this.balance = this.balance.subtract(amount);
        this.history.add(new Transaction(Type.WITHDRAW, amount));
    }
}
```

外部代码只需要调用 `account.withdraw(amount)`，不需要知道：
- 余额存在哪里
- 如何校验余额是否充足
- 如何记录交易流水
- 用什么数据结构存储历史

对象自己保证了所有不变量（invariant）：余额不能为负、金额必须大于 0、每笔操作都有记录。这就是封装的价值——**把复杂性封装在对象内部，对外暴露简洁可靠的接口**。

### 2.3 封装与信息隐藏

封装的另一个层面是**信息隐藏**——外部代码不应该知道对象内部的实现细节。这样当内部实现改变时，外部代码不需要修改。

```java
// 版本 1：内部用 List 存储
public class ShoppingCart {
    private List<Item> items = new ArrayList<>();

    public void addItem(Item item) { items.add(item); }
    public int getItemCount() { return items.size(); }
}

// 版本 2：内部改为 Map 存储（按类别分组）
public class ShoppingCart {
    private Map<String, List<Item>> itemsByCategory = new HashMap<>();

    public void addItem(Item item) {
        itemsByCategory.computeIfAbsent(item.getCategory(), k -> new ArrayList<>()).add(item);
    }
    public int getItemCount() {
        return itemsByCategory.values().stream().mapToInt(List::size).sum();
    }
}
```

内部实现从 `List` 变成了 `Map`，但对外接口 `addItem()` 和 `getItemCount()` 没变。外部代码完全不受影响。这就是信息隐藏的力量。

## 3. 继承：代码复用还是类型关系？

### 3.1 继承为什么出现

继承最初的动机是**代码复用**——父类定义通用行为，子类自动继承，不需要重复编写。

```java
public class Animal {
    protected String name;

    public void eat() {
        System.out.println(name + " is eating");
    }
}

public class Dog extends Animal {
    public void bark() {
        System.out.println(name + " is barking");
    }
}

// Dog 自动拥有 name 字段和 eat() 方法，不需要重写
```

### 3.2 继承真正表达什么

继承不是"拥有相同代码"，而是 **is-a relationship**——子类是父类的一种特殊类型。

```java
Dog is-a Animal       ✅ 合理的继承
Dog is-a Vehicle      ❌ 荒谬的继承
```

判断是否应该用继承，问自己一个问题：**子类对象能不能被当作父类对象使用？** 即里氏替换原则（LSP）。

```java
Animal animal = new Dog();  // Dog 可以当作 Animal 使用
animal.eat();               // 正常工作
```

### 3.3 继承的问题

继承在简单场景下很好用，但在复杂系统中会带来严重问题：

**1. 强耦合。** 子类依赖父类的实现细节。如果父类修改了某个方法的实现，所有子类的行为都可能变化——即使子类没有做任何修改。

**2. 层次结构僵化。** Java 只支持单继承。如果 `Dog` 想继承 `Animal`，又想继承 `Pet`，做不到。

**3. 脆弱基类问题。** 父类添加一个新方法，可能意外地与子类的某个方法冲突（方法签名相同但语义不同）。

```java
// JDK 的经典案例
// Java 1.2 之前，HashSet 的 addAll() 内部调用了 add()
// 某个子类覆盖了 add() 来计数
// 当调用 addAll() 时，计数结果是预期的两倍
// 因为 addAll() 调用了 add()，而子类的 add() 会多计数一次
```

### 3.4 Java 对继承的限制

Java 通过一些设计来限制继承的滥用：

- **单继承**：一个类只能继承一个父类，避免菱形继承问题
- **`final` 关键字**：`final class` 不能被继承，`final method` 不能被覆盖
- **`Object` 根类**：所有类最终都继承 `Object`，提供统一的基础方法

## 4. Object：所有对象的公共契约

所有类最终都继承 `Object`——这不是选择，是 Java 的设计。`Object` 定义了一套"公共契约"：每个对象都能告诉你它是什么（`getClass`）、长什么样（`toString`）、能不能复制（`clone`）。[第一章](./chapter-01-type-system)已经讲了 `equals` 和 `hashCode`，这里把剩下的几个关键方法走一遍。

### 4.1 toString()

默认实现是 `类名@哈希值`（如 `User@1a2b3c`），几乎没有信息量：

```java
User user = new User("Tom", 25);
System.out.println(user);  // com.example.User@1a2b3c4d
```

**应该重写 `toString()`**，返回对调试有用的描述：

```java
@Override
public String toString() {
    return "User{name='" + name + "', age=" + age + "}";
}
```

IDE 可以一键生成。`toString()` 的输出会出现在日志、调试器、异常堆栈中——不重写就是在给未来的自己挖坑。

### 4.2 clone()：一个被广泛认为是设计失误的 API

`clone()` 的意图是"复制对象"，但它的默认行为是**浅拷贝**——只复制字段值，不复制字段指向的对象：

```java
public class User {
    private String name;
    private String[] hobbies;
}

User original = new User("Tom", new String[]{"reading", "gaming"});
User copy = original.clone();

copy.getHobbies()[0] = "cooking";
System.out.println(original.getHobbies()[0]);  // "cooking"！原对象也被改了
```

因为 `hobbies` 是数组（引用类型），浅拷贝只复制了引用，两个对象共享同一个数组。

`Cloneable` 接口是一个标记接口（没有方法），但不实现它就调用 `clone()` 会抛 `CloneNotSupportedException`。这个设计违反了接口隔离原则——一个空接口只用来触发异常。

**实际建议**：不要用 `clone()`。用拷贝构造方法或工厂方法代替：

```java
public User(User other) {
    this.name = other.name;
    this.hobbies = Arrays.copyOf(other.hobbies, other.hobbies.length);
}
```

### 4.3 finalize()：已废弃的对象回收钩子

`finalize()` 在对象被 GC 回收前调用，原本设计用来释放非堆资源（如文件句柄、网络连接）。但它已被 **Java 9 废弃**，原因是：

1. **执行时机不确定**：GC 何时回收对象是不可预测的，`finalize()` 可能在对象不可达后很久才执行
2. **性能差**：有 `finalize()` 的对象需要额外的 GC 处理，回收更慢
3. **可能导致对象复活**：`finalize()` 中可以把 `this` 赋给一个全局变量，使对象重新可达——这是灾难

**替代方案**：用 `try-with-resources` 或 `Cleaner`（Java 9+）。

### 4.4 getClass()

返回对象的运行时类型信息，是反射的入口：

```java
User user = new User("Tom", 25);
Class<?> clazz = user.getClass();
clazz.getName();      // "com.example.User"
clazz.getDeclaredFields();  // 获取所有字段
```

这是反射的起点——第六卷 Spring 会大量用到它。

## 5. 多态：面向对象扩展性的核心

多态是面向对象最重要、最有价值的特性。

### 5.1 什么是多态

多态（Polymorphism）的意思是"同一个接口，不同的实现"：

```java
public interface Payment {
    void pay(BigDecimal amount);
}

public class AlipayPayment implements Payment {
    public void pay(BigDecimal amount) {
        // 调用支付宝 SDK
    }
}

public class WechatPayment implements Payment {
    public void pay(BigDecimal amount) {
        // 调用微信支付 SDK
    }
}

public class BankPayment implements Payment {
    public void pay(BigDecimal amount) {
        // 调用银行网关
    }
}
```

调用方不需要知道具体是哪种支付方式：

```java
Payment payment = createPayment(method);  // 可能是 Alipay、Wechat 或 Bank
payment.pay(amount);                       // 同一个接口，不同的实现
```

### 5.2 多态的核心价值：消除条件分支

没有多态时，代码充满了条件判断：

```java
// ❌ 每增加一种支付方式，都要修改这个方法
public void processPayment(String type, BigDecimal amount) {
    if ("alipay".equals(type)) {
        // 调用支付宝
    } else if ("wechat".equals(type)) {
        // 调用微信
    } else if ("bank".equals(type)) {
        // 调用银行
    } else {
        throw new IllegalArgumentException("未知支付方式");
    }
}
```

有了多态：

```java
// ✅ 新增支付方式？只需加一个实现类，这个方法完全不用改
public void processPayment(Payment payment, BigDecimal amount) {
    payment.pay(amount);
}
```

这就是**开闭原则（OCP）**的体现：对扩展开放（可以新增 `Payment` 实现），对修改关闭（`processPayment` 方法不需要改）。

### 5.3 多态的实现机制

Java 的多态通过**动态绑定（Dynamic Binding）**实现。编译时，编译器只知道变量的声明类型（`Payment`）；运行时，JVM 根据对象的实际类型（`AlipayPayment`）决定调用哪个方法。

在字节码层面，这对应 `invokevirtual` 指令——JVM 在运行时查找对象的实际类，找到正确的方法实现。第二卷会详细展开方法表和动态绑定的机制。

## 6. 接口 vs 抽象类

Java 没有多继承，接口承担了类型抽象、能力定义和解耦的职责。

### 6.1 接口：纯粹的能力契约

接口不是"没有实现的方法集合"，而是一种**能力契约**——它定义了"你能做什么"：

```java
public interface Comparable<T> {
    int compareTo(T o);  // 能力：可以比较大小
}

public interface Serializable {
    // 标记接口，没有方法——能力：可以被序列化
}

public interface Runnable {
    void run();  // 能力：可以被线程执行
}
```

接口回答的是 **can-do** 问题：`Comparable` 说"我能比较大小"，`Serializable` 说"我能被序列化"。

### 6.2 抽象类：类型抽象

抽象类回答的是 **is-a** 问题——它定义了一类对象的通用特征：

```java
public abstract class AbstractList<E> implements List<E> {
    // 提供了 List 的部分通用实现
    // 子类只需要实现 get(index) 和 size() 等核心方法
}
```

### 6.3 何时用接口，何时用抽象类

| 场景 | 选择 | 原因 |
|------|------|------|
| 定义能力契约 | 接口 | 任何类都可以实现，不受继承限制 |
| 提供通用实现 | 抽象类 | 子类继承后自动获得默认行为 |
| 需要多继承 | 接口 | Java 类只能继承一个父类，但可以实现多个接口 |
| 需要状态（字段） | 抽象类 | 接口不能有实例字段（Java 8 之前） |

### 6.4 Java 接口的演进

Java 8 之前，接口只能有抽象方法。Java 8 引入了 `default` method，让接口可以提供默认实现：

```java
public interface List<E> {
    // 抽象方法
    int size();

    // default 方法：提供默认实现，实现类可以选择覆盖
    default boolean isEmpty() {
        return size() == 0;
    }
}
```

这让接口在保持抽象能力的同时，也能提供通用实现，减少了抽象类的使用场景。

## 7. SOLID 原则

SOLID 是五个面向对象设计原则的首字母缩写，由 Robert C. Martin（Uncle Bob）总结。它们不是教条，而是解决大型系统可维护性问题的经验总结。

### 7.1 S — 单一职责原则（SRP）

**一个类应该只有一个引起它变化的原因。**

```java
// ❌ 违反 SRP：一个类做了太多事
public class UserService {
    public User findUser(Long id) { ... }
    public void sendEmail(User user, String content) { ... }
    public String generateReport(List<User> users) { ... }
}

// ✅ 遵循 SRP：每个类只负责一件事
public class UserRepository {
    public User findUser(Long id) { ... }
}

public class EmailService {
    public void sendEmail(User user, String content) { ... }
}

public class ReportGenerator {
    public String generateReport(List<User> users) { ... }
}
```

当邮件发送逻辑变化时，只需要修改 `EmailService`，不影响用户查询和报表生成。

### 7.2 O — 开闭原则（OCP）

**对扩展开放，对修改关闭。**

新增功能时，应该通过新增代码（新类、新实现）来实现，而不是修改已有的代码。

```java
// 通过接口 + 多态实现开闭原则
public interface DiscountStrategy {
    BigDecimal calculate(BigDecimal price);
}

public class VipDiscount implements DiscountStrategy { ... }
public class HolidayDiscount implements DiscountStrategy { ... }
// 新增折扣策略？加一个实现类就行，OrderService 不用改
```

### 7.3 L — 里氏替换原则（LSP）

**子类必须能够替换父类出现的地方，而程序行为不变。**

经典的违反案例：正方形是长方形的子类吗？

```java
public class Rectangle {
    protected int width, height;
    public void setWidth(int w) { this.width = w; }
    public void setHeight(int h) { this.height = h; }
    public int getArea() { return width * height; }
}

public class Square extends Rectangle {
    @Override
    public void setWidth(int w) { this.width = w; this.height = w; }
    @Override
    public void setHeight(int h) { this.width = h; this.height = h; }
}

// 使用
Rectangle r = new Square();
r.setWidth(5);
r.setHeight(3);
r.getArea();  // 期望 15，实际 9！
```

`Square` 替换 `Rectangle` 后，程序行为变了——违反了 LSP。这说明"正方形 is-a 长方形"在数学上成立，但在面向对象设计中不成立。

### 7.4 I — 接口隔离原则（ISP）

**不应该强迫客户端依赖它不使用的接口。**

```java
// ❌ 胖接口
public interface Animal {
    void eat();
    void fly();
    void swim();
}

// 鱼不会飞，但被迫实现 fly()——空实现或抛异常
public class Fish implements Animal {
    public void eat() { ... }
    public void fly() { throw new UnsupportedOperationException(); }
    public void swim() { ... }
}

// ✅ 接口隔离
public interface Eatable { void eat(); }
public interface Flyable { void fly(); }
public interface Swimmable { void swim(); }

public class Fish implements Eatable, Swimmable { ... }
```

### 7.5 D — 依赖倒置原则（DIP）

**高层模块不应该依赖低层模块，两者都应该依赖抽象。**

```java
// ❌ 高层依赖低层
public class OrderService {
    private MySQLDatabase database = new MySQLDatabase();  // 直接依赖具体实现
}

// ✅ 依赖倒置
public class OrderService {
    private Database database;  // 依赖抽象接口

    public OrderService(Database database) {
        this.database = database;  // 通过构造器注入
    }
}
```

`OrderService`（高层）不再依赖 `MySQLDatabase`（低层），而是依赖 `Database` 接口。要换成 PostgreSQL？只需注入不同的实现，`OrderService` 一行代码都不用改。

这就是 Spring IoC 的设计基础——第六卷会详细展开。

## 8. 组合优于继承

"组合优于继承"（Composition Over Inheritance）是 GoF 在《设计模式》中提出的建议，也是现代面向对象设计的共识。

### 8.1 继承的问题回顾

继承导致强耦合——子类依赖父类的实现细节，父类变化直接影响子类。而且 Java 单继承限制了灵活性。

### 8.2 组合的方式

组合通过**持有接口引用来解耦**：

```java
// 继承方式：Dog is-a Animal
public class Dog extends Animal {
    public void makeSound() {
        System.out.println("Woof");
    }
}

// 组合方式：Dog has-a SoundBehavior
public class Dog {
    private SoundBehavior soundBehavior;  // 接口引用

    public Dog(SoundBehavior soundBehavior) {
        this.soundBehavior = soundBehavior;
    }

    public void makeSound() {
        soundBehavior.perform();  // 委托给行为对象
    }
}
```

组合的优势：
- **运行时可切换**：`Dog` 的叫声行为可以在运行时改变
- **更灵活的复用**：同一个 `SoundBehavior` 实现可以被不同的动物复用
- **没有继承层次的限制**：可以组合多个行为，不受单继承限制

### 8.3 什么时候用继承

继承并非一无是处。在以下场景，继承是合理的：

1. **真正的 is-a 关系**：`Dog` is-a `Animal`，`ArrayList` is-a `List`
2. **需要多态**：父类引用指向子类对象
3. **子类是父类的特化**：子类扩展而非修改父类的行为
4. **继承层次浅**：不超过 2-3 层

经验法则：**如果你不确定该用继承还是组合，用组合。**

> 本章从"为什么需要面向对象"出发，逐层展开了封装、继承、多态、接口、SOLID 原则和组合思想。这些不是语法知识，而是软件工程的核心方法论。下一章《泛型》将回答：当类型本身也需要参与抽象时，Java 如何做到类型安全的代码复用？
