---
type: explanation
level: intermediate
---

# C# 委托与 Lambda：把方法当作值

本页回答三个问题：委托（delegate）如何把方法当作值传递，Lambda 如何简化委托的书写，事件（event）如何实现安全的发布订阅。泛型协变逆变见[泛型](./chapter-05-generics.md)。

## 1. 委托：方法的引用类型

委托是一种类型，其实例指向一个方法，可以像值一样传递和调用：

```csharp
delegate int Operation(int a, int b);

int Add(int a, int b) => a + b;
int Multiply(int a, int b) => a * b;

Operation op = Add;
Console.WriteLine(op(2, 3)); // 5

op = Multiply;
Console.WriteLine(op(2, 3)); // 6
```

委托把「调用哪个方法」从调用点解耦出来：调用方只依赖委托的签名，不依赖具体方法。这是回调、策略模式和事件的基础。

### 1.1 内置委托：Func 与 Action

大多数场景不需要自定义委托类型，用内置的 `Func` 和 `Action`：

```csharp
Func<int, int, int> add = (a, b) => a + b;  // 有返回值，最后是返回类型
Action<string> print = s => Console.WriteLine(s); // 无返回值
```

`Func<...>` 的最后一个类型参数是返回类型，`Action<...>` 无返回类型。需要 `out`/`in` 变体（协变逆变）时也可用 `Func`/`Action`，它们已按正确方向声明。

## 2. Lambda 表达式

Lambda 是创建委托实例的简洁语法：

```csharp
Func<int, int> square = x => x * x;
Func<int, int, int> sum = (a, b) => a + b;
```

Lambda 可以写成表达式体（直接返回值）或语句块：

```csharp
Func<int, int> absolute = x =>
{
    if (x < 0) return -x;
    return x;
};
```

Lambda 只是委托的简写，没有独立于委托的运行时类型。它最终编译成方法或委托实例，行为与显式写方法等价。

### 2.1 闭包：捕获变量

Lambda 可以引用定义处作用域内的变量，这称为闭包：

```csharp
int factor = 10;
Func<int, int> scale = x => x * factor;

Console.WriteLine(scale(2)); // 20

factor = 100;
Console.WriteLine(scale(2)); // 200：捕获的是变量本身，不是它的值
```

被捕获的变量由编译器提升到堆上的一个对象中，Lambda 持有对该对象的引用。因此 `factor` 后续变化会反映到 Lambda 的调用结果。闭包是「捕获变量而非捕获值」，这是它与传参的根本区别。

闭包的生命周期陷阱：Lambda 引用的变量在委托存活期间不会被回收。如果 Lambda 存入长生命周期容器，被捕获的对象也会随之存活，可能造成内存占用超出预期。

## 3. 多播委托与事件

委托可以组合多个方法，调用时依次执行：

```csharp
Action log = () => Console.WriteLine("first");
log += () => Console.WriteLine("second");
log(); // 先 first 后 second
```

`+` 把方法加入委托的调用列表。多播委托返回最后一个方法的返回值，且某个方法抛异常会中断后续调用。

直接暴露多播委托有一个风险：外部可以任意赋值为 `null` 或替换整个委托。事件（event）正是为了限制这种访问：

```csharp
class Button
{
    public event EventHandler? Clicked;

    public void Press() => Clicked?.Invoke(this, EventArgs.Empty);
}

var button = new Button();
button.Clicked += (_, _) => Console.WriteLine("clicked");
button.Press(); // clicked
```

`event` 关键字让 `Clicked` 只能被外部用 `+=` 订阅、`-=` 取消订阅，不能赋值或直接调用——调用权留在声明它的类内部。事件是「类持有状态变化通知」的标准方式。

## 4. 委托与接口的选择

委托适合「单个方法作为参数或回调」的场景，接口适合「一组相关方法作为一个契约」的场景。LINQ 的 `Where(Func<T, bool>)` 用委托，因为只需要一个谓词；`IComparer<T>` 用接口，因为它可能带配置状态和多个成员。经验法则：单一行为用委托，成组行为或带状态的对象用接口。

## 5. 后续阅读

- [集合与 LINQ](./chapter-09-collections-linq.md)解释 LINQ 如何大量使用 `Func` 委托。
- [泛型](./chapter-05-generics.md)解释 `Func`/`Action` 的协变逆变。
- [并发与异步](../03-csharp-concurrency/chapter-02-task-async-await.md)解释委托与回调如何演化为 `Task`。

> 本页的技术边界按 .NET 10 / C# 14 核对；Lambda 自 C# 3 引入。官方参考：[C# 语言参考](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/)、[委托与 Lambda](https://learn.microsoft.com/en-us/dotnet/csharp/programming-guide/delegates/)。
