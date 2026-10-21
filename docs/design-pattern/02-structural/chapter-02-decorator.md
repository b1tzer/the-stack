---
doc_id: dp-装饰器模式
title: 装饰器模式（Decorator Pattern）
---

# 装饰器模式（Decorator Pattern）

> **一句话记忆口诀**：装饰器动态叠加功能，`BufferedInputStream` 套 `FileInputStream` 是最经典的例子，比继承更灵活。

## 1. 引入：它解决了什么问题？

### 1.1 没有装饰器模式时的问题

当需要为一个类动态添加功能时，继承会导致类爆炸：

```java
// ❌ 反例：用继承扩展功能，导致类爆炸
// 基础咖啡
class Coffee { double cost() { return 5.0; } }

// 加奶的咖啡
class MilkCoffee extends Coffee { double cost() { return 6.0; } }

// 加糖的咖啡
class SugarCoffee extends Coffee { double cost() { return 5.5; } }

// 加奶又加糖的咖啡
class MilkSugarCoffee extends Coffee { double cost() { return 6.5; } }

// 加奶又加糖又加香草的咖啡
class MilkSugarVanillaCoffee extends Coffee { double cost() { return 8.5; } }

// N 种配料的组合 = 2^N 个子类！完全不可维护
```

**问题根因**：继承是静态的，编译期确定，无法在运行期动态组合功能。N 种配料的组合需要 2^N 个子类，类数量指数级增长。

### 1.2 工作中的典型应用场景

| 场景 | Spring/JDK 中的例子 |
| :-- | :-- |
| IO 流包装 | `BufferedInputStream(new FileInputStream(...))` |
| 线程安全包装 | `Collections.synchronizedList(list)` |
| 不可修改视图 | `Collections.unmodifiableList(list)` |
| MyBatis 插件 | `Plugin.wrap()` 动态代理包装 Executor |

## 2. 类比：用生活模型建立直觉

### 2.1 生活类比：咖啡加配料

星巴克点咖啡时，基础咖啡（美式、拿铁）是核心，配料（牛奶、糖、香草、焦糖）是可以自由叠加的装饰。每加一种配料，价格就增加一点。

- **接口/抽象角色**：饮品（`Beverage` 接口），定义 `cost()` 和 `description()` 方法
- **具体实现角色**：美式咖啡、拿铁（`Americano`、`Latte`），基础饮品
- **装饰器角色**：牛奶装饰器、糖装饰器（`MilkDecorator`、`SugarDecorator`），包装饮品并增加功能
- **调用方**：收银员（`Client`），计算最终价格

关键点：装饰器和被装饰对象实现**同一接口**，装饰器持有被装饰对象的引用，可以按需叠加。

### 2.2 抽象定义

> 装饰器模式动态地给一个对象添加一些额外的职责，就增加功能来说，装饰器模式比生成子类更为灵活。

## 3. 原理：逐步拆解核心机制

### 3.1 UML 类图

```mermaid
classDiagram
    class Beverage {
        <<interface>>
        +cost() double
        +description() String
    }
    class Americano {
        +cost() double
        +description() String
    }
    class BeverageDecorator {
        <<abstract>>
        #beverage Beverage
        +BeverageDecorator(Beverage)
        +cost() double
        +description() String
    }
    class MilkDecorator {
        +cost() double
        +description() String
    }
    class SugarDecorator {
        +cost() double
        +description() String
    }
    class Client

    Beverage <|.. Americano
    Beverage <|.. BeverageDecorator
    BeverageDecorator <|-- MilkDecorator
    BeverageDecorator <|-- SugarDecorator
    BeverageDecorator --> Beverage : wraps
    Client --> Beverage
    note for BeverageDecorator "装饰器抽象类<br/>持有被装饰对象引用<br/>实现同一接口"
```

### 3.2 Java 代码示例

```java
// ===== 组件接口 =====
public interface Beverage {
    double cost();
    String description();
}

// ===== 具体组件（被装饰的基础对象）=====
public class Americano implements Beverage {
    @Override
    public double cost() { return 5.0; }

    @Override
    public String description() { return "美式咖啡"; }
}

public class Latte implements Beverage {
    @Override
    public double cost() { return 8.0; }

    @Override
    public String description() { return "拿铁"; }
}

// ===== 抽象装饰器（核心：实现同一接口，持有被装饰对象）=====
// 设计原因：抽象装饰器实现接口，保证装饰器和组件对调用方透明
// 持有 Beverage 引用，可以装饰任何 Beverage 实现（包括其他装饰器！）
public abstract class BeverageDecorator implements Beverage {
    protected final Beverage beverage; // 被装饰的对象

    public BeverageDecorator(Beverage beverage) {
        this.beverage = beverage;
    }

    // 默认委托给被装饰对象，子类可以选择性覆盖
    @Override
    public double cost() { return beverage.cost(); }

    @Override
    public String description() { return beverage.description(); }
}

// ===== 具体装饰器（添加具体功能）=====
public class MilkDecorator extends BeverageDecorator {
    public MilkDecorator(Beverage beverage) {
        super(beverage);
    }

    @Override
    public double cost() {
        return beverage.cost() + 1.0; // 在原有基础上增加价格
    }

    @Override
    public String description() {
        return beverage.description() + " + 牛奶";
    }
}

public class SugarDecorator extends BeverageDecorator {
    public SugarDecorator(Beverage beverage) {
        super(beverage);
    }

    @Override
    public double cost() {
        return beverage.cost() + 0.5;
    }

    @Override
    public String description() {
        return beverage.description() + " + 糖";
    }
}

public class VanillaDecorator extends BeverageDecorator {
    public VanillaDecorator(Beverage beverage) {
        super(beverage);
    }

    @Override
    public double cost() {
        return beverage.cost() + 2.0;
    }

    @Override
    public String description() {
        return beverage.description() + " + 香草";
    }
}

// ===== 使用示例（动态叠加装饰）=====
public class Main {
    public static void main(String[] args) {
        // 基础美式咖啡
        Beverage coffee = new Americano();
        System.out.println(coffee.description() + " = ¥" + coffee.cost());
        // 输出：美式咖啡 = ¥5.0

        // 加牛奶
        coffee = new MilkDecorator(coffee);
        System.out.println(coffee.description() + " = ¥" + coffee.cost());
        // 输出：美式咖啡 + 牛奶 = ¥6.0

        // 再加糖
        coffee = new SugarDecorator(coffee);
        System.out.println(coffee.description() + " = ¥" + coffee.cost());
        // 输出：美式咖啡 + 牛奶 + 糖 = ¥6.5

        // 再加香草
        coffee = new VanillaDecorator(coffee);
        System.out.println(coffee.description() + " = ¥" + coffee.cost());
        // 输出：美式咖啡 + 牛奶 + 糖 + 香草 = ¥8.5

        // JDK IO 流的经典用法（同样的装饰器模式）
        // GZIPInputStream 装饰 FileInputStream，添加解压功能
        // BufferedInputStream 装饰 GZIPInputStream，缓冲解压后的数据
        InputStream is = new java.io.BufferedInputStream(
                new java.util.zip.GZIPInputStream(
                        new java.io.FileInputStream("data.gz")));
    }
}
```

### 3.3 JDK IO 流的装饰器结构

```txt
InputStream（抽象组件）
├── FileInputStream（具体组件）
├── ByteArrayInputStream（具体组件）
└── FilterInputStream（抽象装饰器）
    ├── BufferedInputStream（具体装饰器：添加缓冲）
    ├── DataInputStream（具体装饰器：添加基本类型读取）
    └── GZIPInputStream（具体装饰器：添加解压）
```

### 3.4 核心流程图（方法调用链）

```mermaid
flowchart LR
    A[Client 调用 cost] --> B[VanillaDecorator.cost]
    B -->|beverage.cost + 2.0| C[SugarDecorator.cost]
    C -->|beverage.cost + 0.5| D[MilkDecorator.cost]
    D -->|beverage.cost + 1.0| E[Americano.cost]
    E -->|返回 5.0| D
    D -->|返回 6.0| C
    C -->|返回 6.5| B
    B -->|返回 8.5| A

    style E fill:#9f9,stroke:#333
    note1["装饰器形成调用链<br/>每层在上一层结果基础上叠加"]
```

## 4. 特性：关键对比

### 4.1 装饰器模式 vs 代理模式（最容易混淆）

两者结构相似，都持有被包装对象的引用，区分主要看设计意图而非结构性二分，职责上可能重叠（代理也可以缓存或记录日志，装饰器也可以做访问控制）。

| 对比维度 | 装饰器模式 | 代理模式 |
| :-- | :-- | :-- |
| **核心意图** | 动态**叠加**可选行为，能力自由组合 | **控制**对目标对象的访问（权限、延迟加载、远程调用） |
| **典型例子** | `BufferedInputStream`、IO 流 | Spring AOP、Feign Client |

### 4.2 装饰器模式 vs 继承

| 对比维度 | 装饰器模式 | 继承 |
| :-- | :-- | :-- |
| **扩展时机** | 运行期动态组合 | 编译期静态确定 |
| **类数量** | O(N)，N 种装饰器 | O(2^N)，N 种功能的所有组合 |
| **灵活性** | ✅ 可以任意组合 | ❌ 组合固定 |
| **耦合度** | 低（面向接口） | 高（父子类强耦合） |

> 注：O(2^N) 指"为 N 种功能的所有组合分别创建子类"的方案；O(N) 指"基础组件 + N 种独立装饰能力"的典型设计，均不是模式本身的普遍定律。

### 4.3 在 Spring / JDK 中的应用

| 框架/类 | 说明 |
| :-- | :-- |
| `BufferedInputStream` | 为 InputStream 添加缓冲功能 |
| `Collections.synchronizedList()` | 为 List 添加线程安全 |
| `Collections.unmodifiableList()` | 返回禁止通过该视图修改元素的包装视图，底层集合变化时视图仍反映 |
| `HttpServletRequestWrapper` | 装饰 HttpServletRequest，扩展请求处理 |
| MyBatis `Plugin` | 通过 `Plugin.wrap()` 以 JDK 动态代理包装 Executor/StatementHandler，与装饰器结构相似但拦截机制不同 |

## 5. 边界：异常情况与常见误区

### 5.1 误区一：装饰器层数过多导致调试困难（设计问题）

```java
// ❌ 问题：装饰器嵌套过深，出错时难以定位
InputStream is = new DataInputStream(
        new GZIPInputStream(
                new BufferedInputStream(
                        new FileInputStream("data.gz"))));
// 出现异常时，堆栈信息穿越多层装饰器，难以定位根因

// ✅ 建议：嵌套过深时按可观测性与调用链复杂度判断是否重构；组合逻辑复杂时可用 Builder 集中管理组装
public class InputStreamBuilder {
    private InputStream stream;
    public InputStreamBuilder from(String path) throws IOException {
        this.stream = new FileInputStream(path);
        return this;
    }
    public InputStreamBuilder buffered() {
        this.stream = new BufferedInputStream(stream);
        return this;
    }
    public InputStreamBuilder gzip() throws IOException {
        this.stream = new java.util.zip.GZIPInputStream(stream);
        return this;
    }
    public InputStream build() { return stream; }
}
```

### 5.2 误区二：装饰器没有实现同一接口，破坏透明性（编译期/设计问题）

```java
// ❌ 错误：装饰器没有实现被装饰对象的接口
public class LoggingList {
    private final List<String> list; // 持有引用，但没有实现 List 接口！

    public void add(String item) {
        System.out.println("添加: " + item);
        list.add(item);
    }
    // 调用方必须知道 LoggingList 的存在，无法透明替换
}

// ✅ 正确：装饰器实现同一接口，对调用方透明
public class LoggingList<E> implements List<E> {
    private final List<E> delegate;
    // 实现所有 List 方法，在需要的方法中添加日志
    @Override
    public boolean add(E e) {
        System.out.println("添加元素: " + e);
        return delegate.add(e);
    }
    // ... 其他方法委托给 delegate
}
```

### 5.3 误区三：把装饰器与代理当成互斥的两类做绝对归类（设计问题）

```java
// ⚠️ 误区：认为权限控制只能用代理、功能增强只能用装饰器
public class AuthOrderService implements OrderService {
    private final OrderService delegate;
    public AuthOrderService(OrderService delegate) {
        this.delegate = delegate;
    }
    @Override
    public void createOrder(Order order) {
        if (!hasPermission()) throw new UnauthorizedException();
        delegate.createOrder(order);
    }
}

// ✅ 正确：两者结构相似，权限控制既可由代理也可由装饰器实现，关键是看主要意图
// 以控制访问为主（权限、事务、延迟加载）用代理，如 Spring AOP @PreAuthorize；
// 以叠加能力为主（缓冲、压缩、加密）用装饰器。职责可重叠，不必强行归类
```

## 6. 总结：面试标准化表达

### 6.1 高频问题

**Q1：装饰器模式和继承有什么区别？为什么说装饰器比继承更灵活？**

> 继承是编译期静态扩展，N 种功能的所有组合需要 2^N 个子类，类数量指数级增长，且组合关系固定无法在运行期改变。装饰器模式是运行期动态组合，只需 N 个装饰器类，通过嵌套包装实现任意组合，类数量线性增长。JDK IO 流就是最好的例子：`BufferedInputStream`、`GZIPInputStream` 等装饰器可以任意组合，而不需要为每种组合创建子类。

**Q2：JDK 的 IO 流为什么使用装饰器模式？**

> IO 流有多种数据源（文件、网络、内存）和多种处理能力（缓冲、压缩、加密、字符转换），如果用继承，每种数据源和处理能力的组合都需要一个子类，会产生类爆炸。装饰器模式让这些能力可以自由组合：`new BufferedInputStream(new GZIPInputStream(new FileInputStream(...)))` 实现了"从文件读取 + 解压 + 缓冲"，每种能力独立封装，按需叠加。

**Q3：装饰器模式和代理模式有什么区别？**

> 两者结构相似，都持有被包装对象的引用，核心区分是设计意图：装饰器用于**动态叠加可选行为**（如缓冲、压缩、加密），让能力自由组合、可多层嵌套；代理用于**控制对目标对象的访问**（如权限、事务、延迟加载、远程调用）。两者并非互斥，职责可能重叠：代理也可以缓存或记录日志，装饰器也可以做访问控制。判断时看主要意图，不要把"对象由谁创建""调用方是否感知"当作硬性标准。
