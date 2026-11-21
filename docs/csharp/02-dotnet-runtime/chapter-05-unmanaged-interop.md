---
type: explanation
level: advanced
---

# .NET 非托管互操作：P/Invoke、unsafe 与资源释放

本页回答三个问题：托管代码如何调用原生库，`unsafe` 与指针用在何处，非托管资源为何需要显式释放。这是 .NET 与操作系统、C/C++ 库交互的边界。

## 1. P/Invoke：调用原生函数

P/Invoke（Platform Invoke）通过 `[DllImport]` 调用操作系统或 C 库导出的原生函数：

```csharp
using System.Runtime.InteropServices;

[DllImport("libc", EntryPoint = "getpid")]
static extern int GetPid();

Console.WriteLine(GetPid());
```

`[DllImport]` 声明原生库名和入口点，运行时负责参数和返回值的封送（marshalling）——在托管类型和原生类型之间转换。

P/Invoke 的代价：跨越托管边界有封送开销，且绕过类型安全。签名写错（参数类型、调用约定不匹配）会在运行时崩溃或产生未定义行为，编译器无法检查。因此 P/Invoke 声明应集中在少数封送层，避免散落在业务代码里。

## 2. unsafe 与指针

`unsafe` 上下文允许使用指针和直接内存操作：

```csharp
unsafe
{
    int value = 10;
    int* p = &value;
    Console.WriteLine(*p); // 10
}
```

指针绕过 GC 和类型安全，可能产生悬空指针、越界读写等问题。`unsafe` 默认被项目设置禁用，需要显式开启 `<AllowUnsafeBlocks>true</AllowUnsafeBlocks>`。只有在确需与原生内存直接交互或极致优化时才使用，且应限制在最小范围内。

## 3. 固定内存与 Span

GC 会移动堆上的对象，因此把托管对象的地址交给原生代码前，需要「固定」（pin）它，防止 GC 移动：

```csharp
var bytes = new byte[1024];
unsafe
{
    fixed (byte* p = bytes)
    {
        NativeFill(p, bytes.Length);
    }
}
```

`fixed` 语句在作用域内固定对象。固定对象会阻碍 GC 压缩，应尽量缩短固定时间。

`Span<T>` 也能包装非托管内存：从原生指针构造 `Span<T>`，用托管、安全的 API 读写原生缓冲区：

```csharp
unsafe
{
    Span<byte> buffer = new Span<byte>(nativePointer, length);
    // 用 Span 的 API 读写，无需手写指针算术
}
```

这保留了 `Span<T>` 的边界检查和便利，同时操作非托管内存。

## 4. 非托管资源与 IDisposable

GC 只管理托管内存。文件句柄、网络连接、原生内存等非托管资源不受 GC 管理，必须显式释放，否则资源泄漏可能拖垮进程。

约定是实现 `IDisposable`，在 `Dispose` 里释放非托管资源，配合 `using` 保证释放（见[异常](../01-csharp-language/chapter-08-exceptions.md)）：

```csharp
class NativeBuffer : IDisposable
{
    private IntPtr handle;
    private bool disposed;

    public void Dispose()
    {
        if (disposed) return;
        NativeFree(handle);
        disposed = true;
        GC.SuppressFinalize(this); // 已显式释放，无需终结器再处理
    }
}
```

`Dispose` 应幂等（可重复调用），并在释放后调用 `GC.SuppressFinalize` 告知 GC 无需终结。终结器（`~NativeBuffer`）是释放的最后兜底，但不保证执行时机，不能作为唯一释放手段——资源释放应依赖 `Dispose`。

## 5. 边界原则

互操作代码是 .NET 应用中最容易出错、最难调试的部分。原则是：

- 把 P/Invoke 和 `unsafe` 集中到薄封送层，业务代码只依赖托管、安全的 API。
- 参数和返回值类型严格对齐，用 `[StructLayout]` 显式指定需要稳定布局的结构体。
- 非托管资源一律 `IDisposable` + `using`，不依赖终结器兜底。
- 固定内存的时间尽量短，避免阻碍 GC。

## 6. 后续阅读

- [类型布局与内存](./chapter-02-type-layout-memory.md)解释 `[StructLayout]` 与 `Span<T>`。
- [异常](../01-csharp-language/chapter-08-exceptions.md)解释 `using` 与 `IDisposable`。
- [诊断](../07-diagnostics/index.md)了解如何排查非托管内存泄漏。

> 本页的技术边界按 .NET 10 / C# 14 核对；`unsafe` 需显式开启，`Span<T>` 自 C# 7.2 引入。官方参考：[.NET 文档](https://learn.microsoft.com/en-us/dotnet/)、[平台调用](https://learn.microsoft.com/en-us/dotnet/standard/native-interop/pinvoke)。
