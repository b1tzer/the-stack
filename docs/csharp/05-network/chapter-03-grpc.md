---
type: explanation
level: advanced
---

# gRPC：基于 HTTP/2 的高效 RPC

本页回答三个问题：gRPC 与 REST 有何不同，如何用 protobuf 定义并实现服务，四种调用模式分别适合什么场景。HTTP 基础见[HttpClient](./chapter-01-http-client.md)。

## 1. gRPC 是什么

gRPC 是基于 HTTP/2 的远程过程调用（RPC）框架，用 protobuf（Protocol Buffers）定义接口和数据，生成强类型的客户端与服务端代码。相比 REST 的 JSON 文本，它：

- 用二进制 protobuf 序列化，体积更小、解析更快。
- 基于 HTTP/2 多路复用，支持双向流。
- 接口用 `.proto` 文件定义，客户端和服务端共享契约、强类型。

## 2. 定义服务

接口和数据在 `.proto` 文件中声明：

```proto
service Greeter {
  rpc SayHello (HelloRequest) returns (HelloReply);
  rpc StreamHello (HelloRequest) returns (stream HelloReply);
}

message HelloRequest {
  string name = 1;
}

message HelloReply {
  string message = 1;
}
```

`SayHello` 是一元调用，`StreamHello` 是服务端流式调用。protobuf 编译器从 `.proto` 生成 C# 强类型类，调用方不可能传错类型。

## 3. 实现服务端

服务端继承生成的基类，实现服务方法：

```csharp
public class GreeterService : Greeter.GreeterBase
{
    public override Task<HelloReply> SayHello(
        HelloRequest request, ServerCallContext context)
    {
        return Task.FromResult(new HelloReply
        {
            Message = $"Hello {request.Name}"
        });
    }
}
```

注册到 ASP.NET Core：

```csharp
builder.Services.AddGrpc();

app.MapGrpcService<GreeterService>();
```

## 4. 调用客户端

客户端用 `GrpcChannel` 连接服务端：

```csharp
using var channel = GrpcChannel.ForAddress("https://localhost:5001");
var client = new Greeter.GreeterClient(channel);

var reply = await client.SayHelloAsync(new HelloRequest { Name = "dotnet" });
Console.WriteLine(reply.Message);
```

`GrpcChannel` 复用 HTTP/2 连接，与 `HttpClient` 的复用原则一致。

## 5. 四种调用模式

| 模式 | 说明 | 适用 |
| :-- | :-- | :-- |
| 一元 | 一个请求一个响应 | 普通 RPC |
| 服务端流式 | 客户端一个请求，服务端多个响应 | 推送日志、实时数据 |
| 客户端流式 | 客户端多个请求，服务端一个响应 | 上传、批量 |
| 双向流式 | 双方并发收发 | 聊天、实时协同 |

流式调用用 `IAsyncStreamReader`/`IServerStreamWriter` 迭代读写。双向流是 gRPC 相对 REST 的核心优势，适合需要持续双向通信的场景。

## 6. gRPC vs REST

| | gRPC | REST |
| :-- | :-- | :-- |
| 数据格式 | protobuf 二进制 | JSON 文本 |
| 契约 | `.proto` 强类型 | OpenAPI/约定 |
| 流式 | 原生支持 | 需 SSE/WebSocket |
| 浏览器直连 | 受限（需 gRPC-Web） | 直接可用 |

gRPC 适合服务间通信（微服务内部），强类型契约和低开销是优势。对外公开给浏览器的 API 仍常用 REST/JSON，因为浏览器直连 gRPC 受限。两者可共存：对外 REST，对内 gRPC。

## 7. 后续阅读

- [HttpClient](./chapter-01-http-client.md)解释底层 HTTP 客户端与连接复用。
- [ASP.NET Core 中间件](../04-aspnet-core/chapter-04-middleware-pipeline.md)解释 gRPC 如何接入请求管道。
- [SignalR](./chapter-04-signalr.md)对比实时通信的另一选择。

> 本页的技术边界按 .NET 10 / C# 14 核对；gRPC 的 .NET 实现由 `Grpc.AspNetCore` 与 `Grpc.Net.Client` 提供。官方参考：[gRPC on .NET](https://learn.microsoft.com/en-us/aspnet/core/grpc/)。
