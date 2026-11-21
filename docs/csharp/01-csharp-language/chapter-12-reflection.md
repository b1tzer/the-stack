---
type: explanation
level: advanced
---

# 反射与元数据：在运行时检查类型

本页回答三个问题：反射如何读取类型元数据、创建实例和调用成员，反射有什么代价，什么时候该用什么时候不该用。特性见[特性](./chapter-06-attributes.md)。

## 1. 反射是什么

反射在运行时检查程序集的元数据：类型、成员、特性、方法签名。元数据是编译器写入程序集的信息（见[编译与 CLR](../02-dotnet-runtime/chapter-01-compilation-clr.md)），反射通过 `System.Reflection` 读取它。

```csharp
Type type = typeof(Order);
Console.WriteLine(type.FullName);          // 类型全名

foreach (var prop in type.GetProperties())
{
    Console.WriteLine(prop.Name);           // 列出所有属性
}
```

`typeof` 在编译期拿到类型，反射则在运行时枚举它的成员。这是「把类型当作数据」的能力。

## 2. 创建实例与调用成员

反射可以绕过编译期，在运行时创建对象、调用方法：

```csharp
Type type = typeof(Order);

object instance = Activator.CreateInstance(type);        // 创建实例
var idProp = type.GetProperty("Id");
idProp.SetValue(instance, 1);                             // 设属性值

var method = type.GetMethod("ToString");
object result = method.Invoke(instance, null);            // 调用方法
```

`MethodInfo.Invoke` 是运行时动态调用，绕过了编译期类型检查。传错参数或成员不存在会在运行时抛异常（`TargetException`、`ArgumentException`），编译器无法帮你发现。

## 3. 反射的代价

反射开销显著：

- **查找成员**：`GetProperties`、`GetMethod` 需要扫描元数据，比直接访问慢几个数量级。
- **动态调用**：`Invoke` 走反射分派，没有 JIT 内联和优化。
- **装箱与类型检查**：反射 API 大量用 `object`，频繁装箱。

因此反射不能出现在热路径。框架通常在**启动阶段集中反射一次**（如依赖注入扫描、序列化器构建元数据），缓存结果供后续使用，而不是每次调用都反射。

## 4. 何时用反射

反射适合「框架/基础设施」层，不适合业务代码：

- 序列化器、ORM、DI 容器：需要通用地处理任意类型。
- 特性读取：框架读取 `[JsonIgnore]` 等特性（见[特性](./chapter-06-attributes.md)）。
- 插件/动态加载：运行时加载未知类型。

业务代码里能用编译期类型安全就用编译期，反射是「类型未知时」的最后手段。滥用反射会让错误从编译期推迟到运行时，且难以排查。

## 5. 反射与 AOT

NativeAOT 下，反射依赖的元数据可能被裁剪掉，因为编译器无法静态知道运行时会反射哪些类型。AOT 场景需要显式声明保留哪些类型（如 `System.Text.Json` 的 `JsonSerializable`，见[序列化](./chapter-11-serialization.md)）。大量反射的应用不适合 AOT（见[JIT 与 AOT](../02-dotnet-runtime/chapter-04-jit-aot.md)）。

## 6. 后续阅读

- [特性](./chapter-06-attributes.md)解释反射如何读取特性。
- [序列化](./chapter-11-serialization.md)解释反射在序列化中的角色。
- [编译与 CLR](../02-dotnet-runtime/chapter-01-compilation-clr.md)解释元数据的来源。
- [JIT 与 AOT](../02-dotnet-runtime/chapter-04-jit-aot.md)解释反射与 AOT 的冲突。

> 本页的技术边界按 .NET 10 / C# 14 核对；反射由 `System.Reflection` 提供，NativeAOT 下需显式保留反射元数据。官方参考：[反射](https://learn.microsoft.com/en-us/dotnet/csharp/advanced-topics/reflection-and-attributes/)。
