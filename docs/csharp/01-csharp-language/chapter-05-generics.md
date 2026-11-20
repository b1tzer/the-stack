---
type: explanation
level: intermediate
---

# C# 泛型：类型参数、约束与协变

本页回答三个问题：泛型如何在不损失类型安全的前提下复用逻辑，约束如何限制类型参数，协变与逆变如何让泛型类型之间建立转换。类型分类见[类型系统](./chapter-02-type-system.md)。

## 1. 泛型要解决什么问题

没有泛型时，复用逻辑要么为每个类型重复代码，要么退回 `object` 并承担装箱和运行时转换的风险：

```csharp
// 用 object 实现栈：每次取出都要转换，且可能失败
class ObjectStack
{
    private readonly List<object> items = new();

    public void Push(object item) => items.Add(item);
    public object Pop()
    {
        var item = items[^1];
        items.RemoveAt(items.Count - 1);
        return item;
    }
}
```

调用方必须手动转换，编译器无法保证类型正确：

```csharp
var stack = new ObjectStack();
stack.Push(1);
string s = (string)stack.Pop(); // InvalidCastException：实际是 int
```

泛型把类型作为参数，让编译器在编译期就锁定元素类型：

```csharp
class Stack<T>
{
    private readonly List<T> items = new();

    public void Push(T item) => items.Add(item);

    public T Pop()
    {
        var item = items[^1];
        items.RemoveAt(items.Count - 1);
        return item;
    }
}

var stack = new Stack<int>();
stack.Push(1);
int value = stack.Pop(); // 无需转换，类型安全
```

泛型同时消除装箱：`Stack<int>` 内部是 `List<int>`，存的是值类型本身，不再包装为 `object`。

## 2. 类型参数与运行时信息

与 Java 的类型擦除不同，C# 的泛型在运行时保留类型参数。这意味着：

- `typeof(T)` 返回真实的运行时类型，而不是擦除后的占位符。
- `new List<int>()` 和 `new List<string>()` 是运行时的不同具体类型。
- 可以对 `T` 使用 `typeof`、`is` 等运算符。

但这也意味着每个封闭泛型类型（如 `Stack<int>`、`Stack<string>`）在 JIT 下会生成各自的机器码，可能增加编译产物大小；NativeAOT 场景下尤其需要关注这一点。

## 3. 泛型约束

约束限制类型参数能是什么，从而让编译器知道可以对 `T` 调用哪些成员：

```csharp
class SortedBox<T> where T : IComparable<T>
{
    public T Value { get; }

    public SortedBox(T value) => Value = value;

    public bool ComesAfter(T other) => Value.CompareTo(other) > 0;
}
```

`where T : IComparable<T>` 让编译器允许调用 `CompareTo`；没有约束时，`T` 只能当作 `object` 使用。

常用约束：

| 约束 | 含义 |
| :-- | :-- |
| `where T : struct` | 类型参数必须是值类型 |
| `where T : class` | 类型参数必须是引用类型 |
| `where T : new()` | 类型参数必须有公共无参构造器 |
| `where T : BaseClass` | 类型参数必须派生自某基类 |
| `where T : ISomeInterface` | 类型参数必须实现某接口 |
| `where T : notnull` | 类型参数必须是非空类型 |

约束不是可选声明，而是编译期保证。把约束放得越宽，`T` 能调用的成员越少；放得越窄，泛型类型的适用面越小，需要在两者间权衡。

## 4. 协变与逆变

协变（`out`）和逆变（`in`）只在接口和委托的类型参数上有效，且类型参数必须出现在对应的位置上。

### 4.1 协变：out

`IEnumerable<T>` 声明为 `out T`，表示类型参数只作为输出（返回值）：

```csharp
IEnumerable<string> strings = new List<string> { "a", "b" };
IEnumerable<object> objects = strings; // 协变：string 可以当作 object 的序列
```

因为 `string` 是 `object` 的子类型，`IEnumerable<string>` 可以赋给 `IEnumerable<object>`。编译器允许这一转换的前提是 `T` 只出现在输出位置——否则可能通过父类型引用塞入不兼容的对象。

### 4.2 逆变：in

`Action<T>` 声明为 `in T`，表示类型参数只作为输入（参数）：

```csharp
Action<object> printObject = o => Console.WriteLine(o);
Action<string> printString = printObject; // 逆变：能处理 object 的，也能处理 string
```

因为能接受 `object` 的委托必然能接受 `string`，`Action<object>` 可以赋给 `Action<string>`。

### 4.3 为什么不是所有泛型都能变

`List<T>` 既把 `T` 作为输入（`Add`）又作为输出（索引器），所以既不能协变也不能逆变。协变和逆变要求类型参数严格单向使用：只出不进用 `out`，只进不出用 `in`。

## 5. 后续阅读

- [集合与 LINQ](./chapter-09-collections-linq.md)解释 `List`、`Dictionary` 与 LINQ 查询如何建立在泛型之上。
- [委托与 Lambda](./chapter-07-delegates-lambda.md)解释 `Func`/`Action` 与协变逆变的关系。
- [对象与值语义](./chapter-03-object-values.md)解释泛型如何避免装箱。

> 本页的技术边界按 .NET 10 / C# 14 核对；C# 泛型自 2.0 引入，运行时不擦除类型信息。官方参考：[C# 语言参考](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/)、[泛型](https://learn.microsoft.com/en-us/dotnet/csharp/fundamentals/types/generics)。
