---
type: explanation
level: intermediate
---

# .NET 编译与 CLR：从源码到执行

本页回答三个问题：C# 源码如何变成可执行的程序集，CLR（Common Language Runtime）在运行时承担哪些职责，托管代码与非托管代码的边界在哪里。这是理解 GC、JIT 和类型布局的前提。

## 1. 编译流程

C# 源码经过编译器（Roslyn）编译为中间语言（IL），连同元数据一起打包为程序集（assembly，通常是 `.dll` 或 `.exe` 文件）：

```txt
C# 源码 → 编译器（Roslyn）→ IL + 元数据 → 程序集（.dll）
```

一个简单方法编译成 IL 后长这样。用 `dotnet-ildasm` 查看程序集即可看到这份 IL：

```csharp
static int Add(int a, int b) => a + b;
```

```txt
.method static int32 Add(int32 a, int32 b) cil managed
{
    .maxstack 2
    IL_0000: ldarg.0     // 加载参数 a
    IL_0001: ldarg.1     // 加载参数 b
    IL_0002: add         // a + b
    IL_0003: ret         // 返回结果
}
```

`ldarg` 加载参数、`add` 相加、`ret` 返回——IL 是基于栈的指令序列，运行时再把它 JIT 成本机机器码。

程序集不是可独立运行的原生代码，而是运行时可以加载和执行的托管格式。它包含：

- **IL**：平台无关的指令序列，描述方法体逻辑。
- **元数据**：类型、成员、引用的声明信息，供反射和工具读取。
- **资源与程序集清单**：版本、依赖、入口点等。

执行时，运行时加载程序集，把 IL 交给 JIT 编译为机器码（见[JIT 与 AOT](./chapter-04-jit-aot.md)）。

## 2. CLR 承担什么

CLR 是 .NET 的托管执行环境，对应 Java 的 JVM。它提供的核心能力：

| 职责 | 说明 |
| :-- | :-- |
| 类型系统 | 加载类型、解析引用、执行类型安全规则 |
| JIT 编译 | 把 IL 编译为当前 CPU 的机器码 |
| 垃圾回收 | 自动回收托管堆内存（见[GC](./chapter-03-gc.md)） |
| 异常处理 | 管理异常的抛出与栈展开 |
| 线程与异步 | 提供线程池、`Task` 调度等基础设施 |
| 互操作 | 通过 P/Invoke 调用非托管代码（见[非托管互操作](./chapter-05-unmanaged-interop.md)） |

「托管代码」指运行在 CLR 控制之下的代码：它的内存、类型和异常都由运行时管理。「非托管代码」是脱离 CLR 的原生代码（C/C++ 库、操作系统 API），通过互操作层调用。

## 3. 托管执行的含义

托管执行带来的关键变化是：代码运行在运行时的约束下，而非直接面对操作系统。

```csharp
var list = new List<int> { 1, 2, 3 };
list.Add(4);
```

这段代码运行时，`new List<int>` 由运行时在托管堆上分配，`Add` 通过 JIT 编译后的机器码执行，`list` 不再被引用后由 GC 回收。开发者不管理内存，但也因此失去对内存布局和释放时机的直接控制。

托管执行不是零成本。它带来 JIT 编译的启动开销、GC 的暂停、边界检查等成本，换来的是内存安全、类型安全和更高的开发效率。这个权衡在[认识 .NET 与 C#](../01-csharp-language/chapter-01-why-csharp.md)中已展开。

## 4. 程序集的加载

运行时按需加载程序集。当类型第一次被使用时，运行时定位并加载其所在程序集，解析依赖，完成类型初始化。程序集有版本和强名称（可选），运行时依据这些信息避免加载冲突。

默认情况下 .NET 应用框架依赖的程序集（`System.*`）随运行时提供，应用自身的程序集和第三方包则随应用部署。.NET 5 之后统一为跨平台的 .NET，不再区分 .NET Framework 的 GAC（全局程序集缓存）模型。

## 5. 后续阅读

- [类型布局与内存](./chapter-02-type-layout-memory.md)解释托管对象在堆上的布局。
- [GC](./chapter-03-gc.md)解释托管堆如何回收内存。
- [JIT 与 AOT](./chapter-04-jit-aot.md)解释 IL 如何变为机器码。
- [非托管互操作](./chapter-05-unmanaged-interop.md)解释托管与非托管的边界。

> 本页的技术边界按 .NET 10 / C# 14 核对；.NET 5 起统一跨平台运行时，此前的 .NET Framework 使用独立的 GAC 模型。官方参考：[.NET 文档](https://learn.microsoft.com/en-us/dotnet/)、[通用语言运行时](https://learn.microsoft.com/en-us/dotnet/standard/clr)。
