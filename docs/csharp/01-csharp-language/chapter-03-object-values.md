---
type: explanation
level: intermediate
---

# C# 对象与值语义：相等性、record 与不可变性

本页回答三个问题：C# 如何区分「同一个对象」和「值相等的对象」，`record` 与 `struct` 分别带来怎样的值语义，不可变性如何帮助写出更可靠的代码。类型分类见[类型系统](./chapter-02-type-system.md)，多态见[面向对象](./chapter-04-oop.md)。

## 1. 相等性：引用相等与值相等

C# 提供三种比较方式，含义不同，且 `==` 和 `Equals` 可能被重载或重写。

| 比较方式 | 默认行为 | 是否可重载/重写 |
| :-- | :-- | :-- |
| `ReferenceEquals(a, b)` | 总是比较引用是否相同 | 不可重写 |
| `a.Equals(b)` | 引用类型默认比较引用；值类型按字段比较 | 可重写 |
| `a == b` | 引用类型默认比较引用；值类型按字段比较 | 可重载运算符 |

### 1.1 引用类型默认按引用比较

```csharp
var a = new StringBuilder("hi");
var b = new StringBuilder("hi");

Console.WriteLine(ReferenceEquals(a, b)); // False：不是同一个对象
Console.WriteLine(a.Equals(b));           // False：StringBuilder 未重写 Equals
Console.WriteLine(a == b);                // False：未重载 ==
```

两个内容相同的对象，默认不相等。只有当业务上需要「按值比较」时，才重写 `Equals` 和 `GetHashCode`。

### 1.2 string 是按值比较的特例

`string` 重载了 `==` 和 `Equals`，按内容比较：

```csharp
string a = "hi";
string b = "hi";

Console.WriteLine(a == b);                 // True：内容相同
Console.WriteLine(a.Equals(b));            // True
Console.WriteLine(ReferenceEquals(a, b));  // True：字面量被驻留（interned）
```

编译器会把相同的字符串字面量驻留到同一对象，因此上面 `ReferenceEquals` 也为 `True`。但运行时构造的字符串不保证驻留，不能依赖引用相等判断字符串是否相同：

```csharp
string c = string.Concat("h", "i");
Console.WriteLine(c == a);                 // True：按值比较
Console.WriteLine(ReferenceEquals(c, a));  // False：运行时构造，未驻留
```

结论：判断字符串内容用 `==` 或 `Equals`，判断身份用 `ReferenceEquals`，二者不可混用。

### 1.3 重写 Equals 必须同步重写 GetHashCode

`GetHashCode` 是散列容器（`Dictionary`、`HashSet`）的依据。C# 契约要求：两个相等的对象必须返回相同的散列码；反之不成立。只重写 `Equals` 而保留默认 `GetHashCode`，会把相等对象散列到不同桶，导致 `Dictionary` 查找失败。

.NET 6 起，编译器为 `record` 和重写 `GetHashCode` 的类型提供一种改进的随机化散列算法，但契约本身不变。

## 2. record：面向值的不可变类型

`record`（C# 9 起）为「值相等 + 不可变数据」提供内置支持。它自动生成基于所有属性的 `Equals`、`GetHashCode` 和 `ToString`，并提供 `with` 表达式做非破坏性修改。

### 2.1 record class 与 record struct

`record` 默认是引用类型（`record class`），`record struct` 是值类型：

```csharp
record Person(string Name, int Age);
```

这等价于声明一个带位置参数、不可变属性和值相等的引用类型。两个内容相同的实例按值相等：

```csharp
var p1 = new Person("Tom", 30);
var p2 = new Person("Tom", 30);

Console.WriteLine(p1 == p2);       // True：record 按值比较
Console.WriteLine(ReferenceEquals(p1, p2)); // False：仍是两个对象
```

`record class` 是引用类型，却按值比较，这是它与普通 `class` 的关键区别。

### 2.2 with 表达式：非破坏性修改

`with` 基于现有实例创建副本，并只修改指定属性：

```csharp
var tom = new Person("Tom", 30);
var olderTom = tom with { Age = 31 };

Console.WriteLine(tom.Age);       // 30：原实例不变
Console.WriteLine(olderTom.Age);  // 31
```

位置参数生成的属性是 `init` 类型的，只能在初始化时赋值，不能事后修改。这使 `record` 天然适合表达不可变数据。

### 2.3 record 的相等性只比较值

`record` 的相等性比较所有字段，且对引用类型成员递归使用其相等性。嵌套的可变引用类型成员会破坏值语义的直觉：

```csharp
record Order(string Id, List<string> Items);

var a = new Order("1", new List<string> { "book" });
var b = new Order("1", new List<string> { "book" });

Console.WriteLine(a == b); // False：List<string> 按引用比较，内容相同但引用不同
```

两个 `Order` 的 `Items` 列表内容相同但引用不同，因此整体不相等。用 `record` 表达不可变数据时，成员也应尽量使用值语义类型（`string`、`record`、`ImmutableArray` 等），否则值相等会被内部引用相等打断。

## 3. struct 的拷贝语义

`struct` 是值类型，赋值和传参都会复制整个值：

```csharp
struct Point
{
    public int X;
    public int Y;
}

var p1 = new Point { X = 1, Y = 2 };
var p2 = p1;          // 复制整个值，不是共享引用
p2.X = 99;

Console.WriteLine(p1.X); // 1：p1 不受影响
```

struct 适合表达小而不可变的数据（如坐标、颜色），但大 struct 的拷贝成本高，且默认相等性实现基于反射、性能较差——需要按值比较的 struct 应自己重写 `Equals` 和 `GetHashCode`。可变的 struct 容易引发「拷贝后修改却不生效」的混淆，因此除非有明确性能理由，应把 struct 设为 `readonly`。

## 4. 不可变性

不可变对象创建后状态不再改变，带来两个好处：多线程共享无需加锁，推理代码行为不必担心状态被别处修改。

C# 提供多种不可变手段：

- `record` + `init` 属性：初始化时赋值，之后不可改。
- `readonly struct`：字段不可变，赋值也是防御性拷贝。
- `readonly` 字段与属性：限制单个成员的修改。
- `System.Collections.Immutable`：不可变集合。

不可变性不是银弹：频繁修改的场景下，`with` 或不可变集合每次产生新对象，会增加分配。它更适合配置、值对象、并发共享数据这类「创建后少改」的数据。

## 5. 后续阅读

- [类型系统](./chapter-02-type-system.md)解释值类型与引用类型的分类和转换。
- [面向对象](./chapter-04-oop.md)解释类的继承、接口与多态。
- [泛型](./chapter-05-generics.md)解释类型参数与约束如何消除装箱。
- [现代语言特性](./chapter-10-modern-language-features.md)补充 record 与 `init` 的更多用法。

> 本页的技术边界按 .NET 10 / C# 14 核对；record 自 C# 9 引入，record struct 自 C# 10 引入，改进的字符串散列自 .NET 6 引入。官方参考：[C# 语言参考](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/)、[record 参考](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/builtin-types/record)。
