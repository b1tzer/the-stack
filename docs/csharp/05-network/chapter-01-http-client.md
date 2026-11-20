---
type: explanation
level: intermediate
---

# HttpClient 与 HttpClientFactory：复用连接，避免 socket 耗尽

本页回答三个问题：`HttpClient` 为什么必须复用，频繁创建会引发什么问题，`IHttpClientFactory` 如何管理连接和处理器生命周期。异步基础见[为什么需要异步](../03-csharp-concurrency/chapter-01-why-async.md)。

## 1. HttpClient 必须复用

`HttpClient` 设计为线程安全、可长期复用。它内部持有连接池和套接字处理器（`SocketsHttpHandler`），复用同一个实例能让多次请求共享底层的 TCP 连接：

```csharp
// 正确：作为单例或长生命周期对象复用
private static readonly HttpClient client = new();
```

**反模式**是每次请求都 `new HttpClient`：

```csharp
// 错误：每次请求新建，耗尽 socket
using var client = new HttpClient();
await client.GetAsync(url);
```

每次新建 `HttpClient` 都会创建新的连接处理器和底层 socket。请求结束后 socket 进入 `TIME_WAIT` 状态，短时间内无法复用。高并发下，socket 迅速耗尽，表现为「无法建立新连接」「Address already in use」甚至系统级 socket 泄漏。

## 2. HttpClientFactory 解决什么

`IHttpClientFactory` 由 ASP.NET Core 或 Microsoft.Extensions.Http 提供，集中管理 `HttpClient` 的处理器生命周期：

```csharp
builder.Services.AddHttpClient();

public class Service
{
    private readonly IHttpClientFactory factory;

    public Service(IHttpClientFactory factory) => this.factory = factory;

    public async Task<string> FetchAsync(string url)
    {
        var client = factory.CreateClient(); // 复用底层处理器
        return await client.GetStringAsync(url);
    }
}
```

`CreateClient()` 返回的 `HttpClient` 虽然每次都是新实例，但它共享同一个底层 `HttpMessageHandler` 和连接池。这既避免了 `new HttpClient` 的 socket 泄漏，又让每个 `HttpClient` 实例可以被独立配置（超时、基地址、头）。

## 3. 类型化客户端

`AddHttpClient<TClient>` 注册类型化客户端，把配置和用法封装到一个类里：

```csharp
builder.Services.AddHttpClient<GitHubClient>(c =>
{
    c.BaseAddress = new Uri("https://api.github.com/");
    c.DefaultRequestHeaders.Add("User-Agent", "my-app");
});

public class GitHubClient
{
    private readonly HttpClient client;

    public GitHubClient(HttpClient client) => this.client = client;

    public Task<string> GetRepoAsync(string owner, string repo)
        => client.GetStringAsync($"repos/{owner}/{repo}");
}
```

类型化客户端在构造函数拿到已配置的 `HttpClient`，业务代码只依赖 `GitHubClient` 而不是裸的 `HttpClient`，配置和用法集中、可测试。

## 4. 连接池配置

连接复用由 `SocketsHttpHandler` 控制，常用配置：

| 配置 | 作用 |
| :-- | :-- |
| `MaxConnectionsPerServer` | 每个服务器的最大连接数 |
| `PooledConnectionLifetime` | 连接空闲多久后回收 |
| `PooledConnectionIdleTimeout` | 空闲连接的保活时间 |

```csharp
builder.Services.AddHttpClient("default")
    .ConfigurePrimaryHttpMessageHandler(() => new SocketsHttpHandler
    {
        MaxConnectionsPerServer = 32,
        PooledConnectionLifetime = TimeSpan.FromMinutes(5)
    });
```

`PooledConnectionLifetime` 尤其重要：设一个有限值能让连接定期重建，避免连接被长期绑定到已失效的 DNS 解析或对端。默认 `MaxConnectionsPerServer` 在 .NET 上是有限值，合理配置可避免对单一下游的过度连接。

## 5. 失败信号与排查

socket 耗尽或连接异常的信号：

- 异常 `HttpRequestException` 且内部是 `SocketException`（Address already in use / Connection reset）。
- 高并发下请求突然大量超时或失败。
- 系统的 socket 数量持续增长（用 `ss -s` 或 `netstat` 观察）。

排查时先确认是否存在 `new HttpClient` 反模式，再检查 `MaxConnectionsPerServer` 和 `PooledConnectionLifetime` 配置。修复后观察 socket 数量是否回落。

## 6. 后续阅读

- [Socket 与 TCP](./chapter-02-socket-tcp.md)解释底层连接如何建立。
- [gRPC](./chapter-03-grpc.md)解释基于 HTTP/2 的高效 RPC。
- [为什么需要异步](../03-csharp-concurrency/chapter-01-why-async.md)解释 I/O 等待与线程的关系。
- [诊断](../07-diagnostics/index.md)了解网络问题的系统排查。

> 本页的技术边界按 .NET 10 / C# 14 核对；`IHttpClientFactory` 自 .NET Core 2.1 起提供，`SocketsHttpHandler` 自 .NET Core 2.1 起是默认处理器。官方参考：[.NET 文档](https://learn.microsoft.com/en-us/dotnet/fundamentals/networking/http/httpclient-guidelines)。
