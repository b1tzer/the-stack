---
type: explanation
level: intermediate
---

# .NET JIT 与 AOT：IL 如何变成机器码

本页回答三个问题：JIT 如何把 IL 编译为机器码，分层编译与 PGO 如何平衡启动与峰值性能，AOT 带来什么收益和代价。编译流程见[编译与 CLR](./chapter-01-compilation-clr.md)。

## 1. JIT 编译

IL 不是机器码，运行时需要把它翻译为当前 CPU 可执行的指令。JIT（Just-In-Time）编译器在方法第一次被调用时才编译该方法：

```txt
IL → JIT（RyuJIT）→ 机器码 → CPU 执行
```

首次调用一个方法时，会有编译开销。方法一旦编译，后续调用直接执行机器码。这带来两个特点：

- **启动时**：尚未被调用的方法不编译，启动快。
- **运行时**：JIT 可以根据实际运行情况（目标 CPU 特性、运行时 profile）优化。

JIT 只知道目标平台是运行时所在的机器，因此能利用该 CPU 的特定指令集。

## 2. 分层编译

编译有优化成本：高度优化的代码编译慢，会拖慢启动。分层编译（tiered compilation）把编译分为两个阶段：

1. **Tier 0**：快速编译，几乎不优化，尽快让方法可执行。
2. **Tier 1**：方法被频繁调用后，重新编译为高度优化的版本。

冷路径方法停留在 Tier 0，热路径方法升级到 Tier 1。这样启动时不为冷代码支付优化成本，运行时又让热代码享受优化。升级是自动的，基于调用次数。

## 3. 动态 PGO

动态 PGO（Profile-guided optimization，.NET 7 起）在 Tier 0 阶段插桩收集运行时信息——哪些分支更常走、哪些虚方法调用实际是哪个类型——再用这些信息指导 Tier 1 的优化。

这使 JIT 能做出基于真实数据的优化，例如对常见的接口调用做去虚拟化（devirtualization）。动态 PGO 无需开发者手动提供 profile，运行时自己收集。

## 4. AOT 编译

AOT（Ahead-Of-Time）在发布时把 IL 预编译为原生代码，运行时不再 JIT。.NET 提供两条路径：

- **ReadyToRun（R2R）**：把部分方法预编译为原生代码打进程序集，未预编译的方法仍回退 JIT。它改善启动，但保留 JIT 的动态能力。
- **NativeAOT**：完整预编译为单个原生可执行文件，运行时无 JIT。启动快、内存占用小、产物可自包含，但代价是：

  - 失去 JIT 的运行时动态优化能力，峰值吞吐可能低于 JIT。
  - 反射、动态加载等依赖 JIT 元数据的能力受限，需要额外配置。
  - 泛型的每个封闭类型都要在编译期生成，产物可能增大。

AOT 适合启动敏感、内存受限或需要无依赖部署的场景（CLI 工具、微服务、无服务器）。长期运行、追求峰值吞吐的服务端程序通常仍用 JIT。

## 5. 如何选择

| 目标 | 建议 |
| :-- | :-- |
| 长期运行的服务，追求峰值吞吐 | JIT（默认） |
| 启动时间敏感的 CLI 工具 | NativeAOT 或 R2R |
| 内存受限、无服务器 | NativeAOT |
| 需要大量反射/动态加载 | JIT（默认） |

选择 AOT 不是「更快」的通用答案，而是在启动、内存、峰值性能和动态能力之间权衡。先用默认的 JIT，确认启动或内存是真实瓶颈后，再评估 AOT。

## 6. 后续阅读

- [编译与 CLR](./chapter-01-compilation-clr.md)解释 IL 与程序集。
- [GC](./chapter-03-gc.md)解释运行时的内存回收。
- [非托管互操作](./chapter-05-unmanaged-interop.md)解释原生边界与 AOT 的关系。
- [诊断](../07-diagnostics/index.md)了解如何测量启动与吞吐。

> 本页的技术边界按 .NET 10 / C# 14 核对；分层编译自 .NET Core 3.0 起默认启用，动态 PGO 自 .NET 7 引入，NativeAOT 自 .NET 7 起可用。官方参考：[.NET 文档](https://learn.microsoft.com/en-us/dotnet/)、[NativeAOT](https://learn.microsoft.com/en-us/dotnet/core/deploying/native-aot/)。
