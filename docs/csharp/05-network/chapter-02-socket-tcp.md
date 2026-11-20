---
type: explanation
level: advanced
---

# Socket 与 TCP：连接的生命周期与异步 I/O

本页回答三个问题：`Socket` 如何表达一条 TCP 连接，服务端如何接受和并发处理连接，异步 Socket 编程如何避免线程阻塞。HTTP 客户端见[HttpClient](./chapter-01-http-client.md)。

## 1. TCP 连接的抽象

`System.Net.Sockets.Socket` 是 TCP 连接的底层抽象，`TcpListener`/`TcpClient` 是它的高层封装。一条 TCP 连接的两端各有一个 socket：

```txt
客户端 Socket ── TCP 三次握手 ── 服务端监听 Socket → 已连接 Socket
```

服务端用监听 socket 接受连接，每个被接受的连接得到一个新的已连接 socket，与特定客户端通信。

## 2. 服务端接受连接

`TcpListener` 监听端口并接受连接：

```csharp
var listener = new TcpListener(IPAddress.Any, 8080);
listener.Start();

while (true)
{
    var client = await listener.AcceptTcpClientAsync();
    _ = HandleClientAsync(client); // 每个连接一个任务，不阻塞接受循环
}
```

`AcceptTcpClientAsync` 异步等待新连接。每个连接交给独立任务处理，接受循环立即继续等下一个连接。

## 3. 读写数据

TCP 是字节流，没有消息边界。读写必须处理「一次读写可能只返回部分数据」的情况：

```csharp
async Task HandleClientAsync(TcpClient client)
{
    using var stream = client.GetStream();
    var buffer = new byte[4096];

    while (true)
    {
        int read = await stream.ReadAsync(buffer);
        if (read == 0)
        {
            break; // 对端关闭连接
        }
        await stream.WriteAsync(buffer.AsMemory(0, read));
    }
}
```

`ReadAsync` 返回 `0` 表示对端已关闭。因为 TCP 不保证消息边界，应用层需要自己定义消息格式（长度前缀、分隔符），否则会把多条消息拼在一起或拆开。

## 4. 连接的生命周期

- **建立**：三次握手（`ConnectAsync`）。
- **数据传输**：双向字节流。
- **关闭**：`Shutdown` 半关闭 + `Dispose` 完全关闭，或对端主动关闭。

服务端要处理连接异常断开：读写抛 `IOException`/`SocketException` 时释放该连接的 socket，不影响其他连接。

## 5. 并发模型

Socket 服务端的并发模型选择：

- **每连接一任务**（上面示例）：简单，连接数多时任务开销大。
- **异步 I/O + 线程池**：`await` 期间不占用线程，大量连接可复用少量线程（见[为什么需要异步](../03-csharp-concurrency/chapter-01-why-async.md)）。
- **SocketAsyncEventArgs**：为极致性能设计的可复用异步操作，代码复杂，仅在高性能网络库中需要。

大多数应用用「异步 I/O + `TcpListener`」足够。需要大规模连接和极致吞吐时，通常直接用成熟框架（如 Kestrel）而不是手写 Socket 服务端。

## 6. 失败信号

Socket 编程的常见失败：

- `SocketException`：连接被拒绝、连接重置、网络不可达。
- `IOException`：连接中途断开。
- `ObjectDisposedException`：在已关闭的 socket 上操作。

读写失败后要关闭并释放该连接，捕获具体异常类型而不是笼统吞掉。半关闭（对端只发不收了）时用 `Shutdown(SocketShutdown.Send)` 表达。

## 7. 后续阅读

- [HttpClient](./chapter-01-http-client.md)解释高层 HTTP 如何复用底层连接。
- [为什么需要异步](../03-csharp-concurrency/chapter-01-why-async.md)解释异步 I/O 与线程池。
- [诊断](../07-diagnostics/index.md)了解连接问题的排查。

> 本页的技术边界按 .NET 10 / C# 14 核对；`TcpListener`/`TcpClient` 与 `Socket` 由 `System.Net.Sockets` 提供。官方参考：[.NET 文档](https://learn.microsoft.com/en-us/dotnet/fundamentals/networking/sockets/)。
