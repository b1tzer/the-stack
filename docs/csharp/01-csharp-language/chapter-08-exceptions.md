---
type: explanation
level: intermediate
---

# C# 异常：抛出、捕获与资源释放

本页回答三个问题：C# 如何表示和传播错误，`try/catch/finally` 各承担什么职责，如何可靠地释放资源。异常是控制流的非常规出口，理解它的代价和边界比记住语法更重要。

## 1. 异常如何表示与传播

异常是 `Exception` 派生类型的实例。当方法无法完成其职责时抛出异常，调用栈沿调用链向上传播，直到被 `catch` 捕获或使程序终止：

```csharp
void ReadFile(string path)
{
    var content = File.ReadAllText(path); // 文件不存在时抛 FileNotFoundException
    Console.WriteLine(content);
}

try
{
    ReadFile("missing.txt");
}
catch (FileNotFoundException ex)
{
    Console.WriteLine($"文件不存在：{ex.FileName}");
}
```

异常对象携带调用栈、消息和可选的内层异常（`InnerException`），用于定位问题。

### 1.1 异常层级

所有异常都派生自 `Exception`。`SystemException` 之下是运行时抛出的具体异常（`NullReferenceException`、`InvalidOperationException` 等），应用自定义异常通常直接派生自 `Exception` 或 `ApplicationException`。

| 常见异常 | 触发场景 |
| :-- | :-- |
| `NullReferenceException` | 解引用为 `null` 的引用 |
| `InvalidCastException` | 拆箱或向下转型失败 |
| `IndexOutOfRangeException` | 数组下标越界 |
| `ArgumentException` | 参数不满足方法契约 |
| `InvalidOperationException` | 对象状态不支持当前调用 |
| `FileNotFoundException` | 访问不存在的文件 |

捕获时要精确：`catch (Exception)` 会吞掉所有异常，包括你本不该处理的 `OutOfMemoryException` 和编程错误，掩盖真实问题。

## 2. try / catch / finally

三个块职责不同：`try` 划定可能失败的代码，`catch` 处理可恢复的错误，`finally` 保证清理代码总是执行。

```csharp
Stream? stream = null;
try
{
    stream = File.OpenRead("data.txt");
    // 读取并处理
}
catch (IOException ex)
{
    Console.WriteLine($"读取失败：{ex.Message}");
}
finally
{
    stream?.Dispose(); // 无论是否异常都会执行
}
```

`finally` 在 `try` 正常结束、抛异常或 `return` 时都会执行，用于释放资源。但释放资源有更可靠的写法，见下文 `using`。

### 2.1 异常过滤器

`catch when` 根据条件决定是否捕获：

```csharp
catch (HttpRequestException ex) when (ex.StatusCode == HttpStatusCode.NotFound)
{
    // 只处理 404
}
```

过滤器在进入 `catch` 块前求值；不满足时异常继续向上传播。它比在 `catch` 块内再判断、不匹配再 `throw` 更清晰，也保留了原始调用栈。

## 3. 抛出异常

方法发现无法完成职责时抛出异常，而不是返回错误码：

```csharp
void Transfer(Account from, Account to, decimal amount)
{
    if (amount <= 0)
    {
        throw new ArgumentOutOfRangeException(nameof(amount), "金额必须为正");
    }
    // 转账逻辑
}
```

抛出前先验证参数，用 `ArgumentOutOfRangeException`/`ArgumentException` 表达调用方错误。自定义异常只在需要按类型区分处理时才定义：

```csharp
class InsufficientFundsException : Exception
{
    public decimal Balance { get; }

    public InsufficientFundsException(decimal balance)
        : base("余额不足") => Balance = balance;
}
```

### 3.1 重新抛出

在 `catch` 中重新抛出以记录日志时，用 `throw;` 而不是 `throw ex;`：

```csharp
catch (Exception ex)
{
    Logger.Log(ex);
    throw;      // 保留原始调用栈
    // throw ex; // 重置调用栈，丢失原始位置
}
```

`throw ex;` 会从当前语句重新计算调用栈，掩盖异常的真实来源。

## 4. using 与 IDisposable

需要释放的资源（文件、连接、句柄）应实现 `IDisposable`，并用 `using` 保证释放：

```csharp
using (var stream = File.OpenRead("data.txt"))
{
    // 使用 stream
} // 离开作用域时自动调用 stream.Dispose()
```

C# 8 起支持 `using` 声明，作用域到块末尾：

```csharp
using var stream = File.OpenRead("data.txt");
// 使用 stream
// 方法结束时自动释放
```

`using` 在块正常结束或抛异常时都会调用 `Dispose`，等价于 `try/finally` 但更简洁、不易遗漏。凡是实现 `IDisposable` 的对象都应放进 `using`。

异步资源释放对应 `await using` 与 `IAsyncDisposable`，见[并发与异步](../03-csharp-concurrency/chapter-02-task-async-await.md)。

## 5. 异常的使用边界

异常不是普通的控制流。它涉及调用栈展开，开销远高于正常分支，且中断线性流程。经验法则：

- 用异常表达「方法无法完成职责」的意外情况，不用它做常规分支（如「文件是否存在」应先用 `File.Exists` 判断，而不是靠捕获异常）。
- 捕获只处理你能恢复的错误，不能恢复就让它向上传播。
- 别用空 `catch` 吞掉异常；要么处理，要么记录后重新抛出。

## 6. 后续阅读

- [委托与 Lambda](./chapter-07-delegates-lambda.md)理解多播委托中异常如何中断调用。
- [并发与异步](../03-csharp-concurrency/chapter-02-task-async-await.md)理解异步方法中异常的传播与 `AggregateException`。
- [数据访问](../06-data-access/chapter-01-persistence-thought.md)理解数据库异常与事务回滚的关系。

> 本页的技术边界按 .NET 10 / C# 14 核对；异常过滤器自 C# 6 引入，`using` 声明自 C# 8 引入。官方参考：[C# 语言参考](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/)、[异常与异常处理](https://learn.microsoft.com/en-us/dotnet/csharp/fundamentals/exceptions/)。
