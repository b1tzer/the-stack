---
type: explanation
level: intermediate
---

# C# 现代语言特性：模式匹配、可空引用与简化写法

本页汇总 C# 8 之后引入、能改变日常写法的主要特性，回答每个特性解决什么问题、何时该用。record 的值语义已在[对象与值语义](./chapter-03-object-values.md)详述，这里只补充未覆盖的部分。

## 1. 模式匹配

模式匹配把「检查类型/形状 + 提取数据」合并为一步，替代冗长的 `is` + 转换。

### 1.1 switch 表达式

`switch` 表达式按模式返回结果，比 `switch` 语句更紧凑：

```csharp
static string Describe(object value) => value switch
{
    int n => $"整数 {n}",
    string s => $"字符串 {s}",
    null => "空值",
    _ => "其他"
};
```

### 1.2 属性模式与关系模式

属性模式匹配对象的属性结构，关系模式匹配数值范围：

```csharp
static string Classify(Order o) => o switch
{
    { Total: > 1000 } => "大额",
    { Total: > 100 } => "普通",
    { Total: <= 0 } => "异常",
    _ => "小额"
};
```

`{ Total: > 1000 }` 检查 `o.Total` 是否大于 1000，无需先拆开再判断。模式可以组合，让多分支逻辑集中在一条表达式里，但分支过多时也应警惕可读性下降。

## 2. 可空引用类型（NRT）

C# 8 起，`string` 和 `string?` 在编译期被区分：前者承诺非空，后者允许为空。启用方式是在项目文件里加 `<Nullable>enable</Nullable>`：

```csharp
#nullable enable

string name = null;        // 警告：非空引用类型不能赋 null
string? maybe = null;      // 允许

int length = name.Length;  // 警告：name 可能为 null
```

NRT 是编译期分析，运行时 `string` 和 `string?` 完全一样——它不会在运行时插入空值检查。它的价值是让编译器在开发阶段标记可能的空引用，配合 `??`、`?.` 显式处理：

```csharp
int length = name?.Length ?? 0;
```

NRT 不是「消灭空引用」的保证。边界上（反序列化、非托管调用、未标注的第三方库）仍可能流入 `null`，需要在边界处显式校验，而不是信任标注。

## 3. 简化写法

### 3.1 init 属性与 required

`init` 属性只能在对象初始化器或构造器中赋值，之后不可变：

```csharp
class Person
{
    public string Name { get; init; }
    public int Age { get; init; }
}

var p = new Person { Name = "Tom", Age = 30 };
// p.Name = "Ada"; // 编译错误：init 属性不可事后赋值
```

`required`（C# 11）强制调用方在对象初始化器中提供该属性，否则编译失败：

```csharp
class Person
{
    public required string Name { get; init; }
    public required int Age { get; init; }
}

var p = new Person { Name = "Tom", Age = 30 }; // 缺任一属性则编译错误
```

`required` 把「必须提供」的约束交给编译器，减少遗漏。

### 3.2 顶级语句与 file-scoped 命名空间

顶级语句省去 `Program` 类与 `Main` 方法的样板，适合脚本式的小程序（见[认识 .NET 与 C#](./chapter-01-why-csharp.md)）。file-scoped 命名空间把命名空间声明简化为一行，作用于整个文件：

```csharp
namespace MyApp.Core;

class Order { }
```

两者都是减少样板、不改变语义的语法糖。

### 3.3 目标类型 new 与集合表达式

目标类型明确的 `new` 可以省略类型名；集合表达式（C# 12）用 `[...]` 初始化集合：

```csharp
List<int> numbers = new();          // 目标类型 new
int[] array = [1, 2, 3];            // 集合表达式
List<string> names = ["a", "b"];    // 集合表达式用于 List
```

集合表达式基于目标类型决定创建哪种集合，避免了 `new List<string> { ... }` 的重复。

### 3.4 主构造器

主构造器（C# 12）把构造参数直接写在类型声明上，用于简单类型的字段/属性初始化：

```csharp
class Distance(double meters)
{
    public double Meters => meters;
    public double Kilometers => meters / 1000;
}
```

主构造器适合参数只用于初始化、逻辑简单的类型；复杂构造逻辑仍用传统构造器更清晰。

## 4. 何时用新特性

这些特性都在减少样板或让约束提前到编译期，但它们不是必须用的。选择依据是「是否让意图更清楚」：

- 需要值相等或不可变数据 → `record` + `init`。
- 需要编译器强制必填 → `required`。
- 多分支的类型/结构判断 → 模式匹配。
- 大量空值风险 → 启用 NRT 并显式处理。
- 脚本式小工具 → 顶级语句。

如果一个特性让代码更绕或更晦涩，宁可用更直白的传统写法。语法糖不是目标，表达力才是。

## 5. 后续阅读

- [对象与值语义](./chapter-03-object-values.md)详解 `record` 与不可变性。
- [类型系统](./chapter-02-type-system.md)解释 NRT 与值类型可空 `T?` 的关系。
- [泛型](./chapter-05-generics.md)解释这些特性在泛型类型上的表现。

> 本页的技术边界按 .NET 10 / C# 14 核对；NRT 自 C# 8 引入，`required` 与 `file-scoped` 命名空间自 C# 11 引入，集合表达式与主构造器自 C# 12 引入。官方参考：[C# 语言参考](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/)、[C# 新功能](https://learn.microsoft.com/en-us/dotnet/csharp/whats-new/csharp-14)。
