---
type: explanation
level: intermediate
---

# C# 面向对象：继承、接口与多态

本页面向已经能写类和方法、但还不清楚 C# 继承与多态边界的读者，回答三个问题：`class` 如何组织状态与行为，继承和多态如何工作，什么时候用接口而不是继承。类型分类见[类型系统](./chapter-02-type-system.md)，值语义见[对象与值语义](./chapter-03-object-values.md)。

## 1. 类：状态与行为的组织单位

类把字段（状态）和方法（行为）组织在一起。字段通常私有，通过属性暴露受控的访问：

```csharp
class Account
{
    private decimal balance;

    public string Owner { get; }

    public Account(string owner)
    {
        Owner = owner;
    }

    public decimal Balance => balance;

    public void Deposit(decimal amount)
    {
        if (amount <= 0)
        {
            throw new ArgumentOutOfRangeException(nameof(amount));
        }
        balance += amount;
    }
}
```

属性（property）对调用方表现为字段，内部是访问器方法。`Balance` 是只读表达式属性；`Owner` 是只能在构造器中赋值的只读属性。字段保持私有、通过属性或方法暴露，是为了把状态变更集中到少数入口，便于检查不变量。

### 1.1 构造器与对象初始化

构造器负责把对象建立到合法状态。C# 也支持对象初始化器，为属性赋值而不必提供对应的构造器参数：

```csharp
var account = new Account("Tom") { };
```

只读属性（`Owner`）不能在对象初始化器中赋值，因为它只在构造器内可写。需要一次性赋值但构造器参数过长的场景，可用 `init` 属性（见[现代语言特性](./chapter-10-modern-language-features.md)）。

## 2. 继承与多态

继承表达「是一个」的关系。派生类复用基类实现，并可通过虚方法改变行为。

### 2.1 虚方法与重写

基类用 `virtual` 声明可重写的方法，派生类用 `override` 改变行为：

```csharp
class Shape
{
    public virtual double Area() => 0;
}

class Circle : Shape
{
    private readonly double radius;

    public Circle(double radius) => this.radius = radius;

    public override double Area() => Math.PI * radius * radius;
}
```

通过基类引用调用时，执行的是对象实际类型的重写方法，这是多态的核心：

```csharp
Shape shape = new Circle(2);
Console.WriteLine(shape.Area()); // 12.566...：调用 Circle 的 Area，而不是 Shape 的
```

多态只在虚方法上生效。非虚方法通过基类引用调用时，执行的是基类实现，即使派生类声明了同名方法。

### 2.2 抽象类与抽象方法

抽象类是不能实例化的类，用于声明派生类必须实现的方法：

```csharp
abstract class Shape
{
    public abstract double Area();
}
```

抽象方法没有实现，派生类必须 `override`。抽象类可以同时包含有实现的成员，适合「提供公共实现 + 强制派生类补全差异」的场景。

### 2.3 单继承与 sealed

C# 只支持单继承：一个类只能有一个直接基类。需要组合多个能力时用接口。

`sealed` 阻止类被继承，或阻止方法被进一步重写：

```csharp
sealed class Circle : Shape { /* ... */ }
```

把类设为 `sealed` 是默认推荐的保守选择：它缩小了类契约的边界，避免继承带来的脆弱基类问题。除非确实设计了继承扩展点，否则优先 `sealed`。

## 3. 接口：契约与多实现

接口声明一组成员，不含实现，实现它的类必须提供这些成员：

```csharp
interface IShape
{
    double Area();
}

class Circle : IShape
{
    private readonly double radius;

    public Circle(double radius) => this.radius = radius;

    public double Area() => Math.PI * radius * radius;
}
```

一个类可以实现多个接口，这弥补了单继承的限制。接口表达「能做什么」的契约，继承表达「是什么」的关系；需要多态地调用一组相关类型时优先接口。

C# 8 起接口可以有默认实现，但这主要用于在不破坏已有实现的前提下为接口增加成员，不应把接口当作基类承载共享实现。

## 4. 继承 vs 组合

继承复用基类实现，但也把基类的内部结构暴露给派生类，形成耦合。修改基类可能破坏派生类，这就是「脆弱基类」问题。

组合则把另一个类的实例作为字段持有，只依赖其公开契约：

```csharp
class ReportGenerator
{
    private readonly IClock clock;

    public ReportGenerator(IClock clock) => this.clock = clock;
}
```

经验法则是：优先组合，继承只用于真正稳定的「是一个」关系。可复用的差异优先抽象成接口，由组合持有，而不是层层继承。

## 5. 静态成员

静态成员属于类型本身，不属于任何实例：

```csharp
class Counter
{
    private static int count;

    public static int Next() => ++count;
}

Console.WriteLine(Counter.Next()); // 1
Console.WriteLine(Counter.Next()); // 2
```

静态字段是进程级共享状态，多线程下需要同步（见[并发与异步](../03-csharp-concurrency/chapter-01-why-async.md)）。静态字段在首次访问类型时初始化，默认值规则与实例字段相同。

## 6. 后续阅读

- [泛型](./chapter-05-generics.md)解释类型参数与约束如何复用逻辑并保持类型安全。
- [特性](./chapter-06-attributes.md)解释如何为类型附加元数据。
- [委托与 Lambda](./chapter-07-delegates-lambda.md)解释行为如何作为值传递。
- [现代语言特性](./chapter-10-modern-language-features.md)补充 `init`、主构造器等简化写法。

> 本页的技术边界按 .NET 10 / C# 14 核对；接口默认实现自 C# 8 引入。官方参考：[C# 语言参考](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/)、[继承与多态](https://learn.microsoft.com/en-us/dotnet/csharp/fundamentals/object-oriented/)。
