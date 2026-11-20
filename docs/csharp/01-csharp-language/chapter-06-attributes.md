---
type: explanation
level: intermediate
---

# C# 特性：为代码附加元数据

本页回答三个问题：特性（attribute）是什么，它如何被框架和反射消费，以及如何自定义特性。特性不改变程序本身的行为，它只是附加在类型和成员上的元数据。

## 1. 特性是什么

特性是标注在程序元素（类、方法、属性、参数、程序集）上的元数据，用 `[...]` 写在目标之前：

```csharp
[Obsolete("Use NewMethod instead")]
public void OldMethod() { }
```

`[Obsolete]` 告诉编译器和开发者这个方法已过时。特性本身不含可执行逻辑——它只是数据，需要编译器、框架或反射去读取和响应。这与 Java 注解的「运行时处理」相似，但 C# 特性默认只在被显式读取时才生效。

## 2. 常用内置特性

### 2.1 Obsolete 与弃用

`[Obsolete]` 标记不再推荐的成员，可附带消息和是否视为错误：

```csharp
[Obsolete("Use NewMethod instead", error: false)]
public void OldMethod() { }
```

编译器会在使用处产生警告或错误，帮助团队在迁移过程中逐步淘汰旧 API。

### 2.2 序列化与数据契约

`[Serializable]` 标记类型可被旧式序列化器处理；`System.Text.Json` 则用 `[JsonIgnore]` 等特性控制序列化行为：

```csharp
class User
{
    public string Name { get; set; }

    [JsonIgnore]
    public string PasswordHash { get; set; }
}
```

特性在这里是给序列化器看的配置，序列化器负责读取并遵守。

### 2.3 调用方信息

`[CallerMemberName]` 等特性让方法自动拿到调用方的名称，常用于日志：

```csharp
static void Log(string message, [CallerMemberName] string member = "")
{
    Console.WriteLine($"{member}: {message}");
}
```

编译器在调用点自动填充 `member`，无需调用方显式传参。

## 3. 反射读取特性

反射在运行时读取附加的特性：

```csharp
var method = typeof(Program).GetMethod("OldMethod");
var obsolete = method.GetCustomAttribute<ObsoleteAttribute>();
Console.WriteLine(obsolete?.Message);
```

读取特性需要类型和成员信息，反射成本不低。运行时按需读取而不是每次调用都读，是框架常用的策略；多数框架（ASP.NET Core、EF Core）在启动阶段集中反射一次，之后缓存结果。

## 4. 自定义特性

自定义特性是一个继承自 `Attribute` 的类：

```csharp
[AttributeUsage(AttributeTargets.Class | AttributeTargets.Method, AllowMultiple = false)]
class RetryAttribute : Attribute
{
    public int Attempts { get; }

    public RetryAttribute(int attempts) => Attempts = attempts;
}
```

`[AttributeUsage]` 限定特性能标注哪些目标、是否可重复、是否可继承。使用它：

```csharp
[Retry(3)]
public void Send() { }
```

`[Retry(3)]` 本身不产生任何重试行为——除非有代码读取它并实现重试。这是自定义特性最常见的误解：特性是声明，不是实现。需要行为时，要么配合框架（框架读取特性并处理），要么自己用反射读取并执行。

## 5. 特性 vs 配置 vs 接口

特性适合描述「这个类型/成员有什么属性」的声明式信息（标记、序列化控制、校验规则）。它不适合承载会频繁变化或需要集中管理的配置——那些放进配置文件更合适。也不适合替代接口表达「具备某种能力」：接口是编译期契约，特性是运行时可选的元数据。

经验法则：能被编译器或框架静态消费、且与代码结构绑定的信息用特性；运行时动态变化的信息用配置；需要多态调用的能力用接口。

## 6. 后续阅读

- [反射与类型布局](../02-dotnet-runtime/chapter-02-type-layout-memory.md)理解特性背后的类型元数据存储。
- [ASP.NET Core 的依赖注入](../04-aspnet-core/chapter-05-dependency-injection.md)看框架如何在启动阶段消费特性与约定。

> 本页的技术边界按 .NET 10 / C# 14 核对；`CallerMemberName` 等调用方信息特性自 C# 5 引入。官方参考：[C# 语言参考](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/)、[特性](https://learn.microsoft.com/en-us/dotnet/csharp/advanced-topics/reflection-and-attributes/)。
