---
type: explanation
level: intermediate
---

# SignalR：实时通信与连接管理

本页回答三个问题：SignalR 解决什么实时通信需求，Hub 如何组织双向消息，连接断开后如何处理。gRPC 流式见[gRPC](./chapter-03-grpc.md)。

## 1. SignalR 是什么

SignalR 是 ASP.NET Core 的实时通信库，让服务端能主动向客户端推送消息，而不仅是响应客户端请求。它自动选择传输协议，并统一封装成「连接」和「消息」的抽象。

典型场景：聊天、实时通知、仪表盘推送、协同编辑、游戏状态同步。

## 2. Hub：消息的收发中心

Hub 是 SignalR 的核心，客户端调用 Hub 方法、服务端向连接发送消息：

```csharp
public class ChatHub : Hub
{
    public async Task SendMessage(string user, string message)
    {
        await Clients.All.SendAsync("ReceiveMessage", user, message);
    }
}
```

`Clients.All.SendAsync` 向所有连接推送 `ReceiveMessage` 消息。`Clients.User`、`Clients.Group`、`Clients.Caller` 分别按用户、分组、当前连接定向发送。

客户端调用 `SendMessage`，服务端处理后再推送给 `ReceiveMessage`。这就是「客户端调用 → 服务端广播」的双向模式。

## 3. 传输协议

SignalR 自动协商传输协议，优先级从高到低：

| 协议 | 特点 |
| :-- | :-- |
| WebSocket | 全双工，最优 |
| Server-Sent Events | 服务端单向推送 |
| Long Polling | 兼容性兜底 |

WebSocket 是全双工、低开销的首选。环境不支持时降级到 SSE 或长轮询。开发者通常无需关心具体协议，SignalR 透明处理。

## 4. 连接生命周期

SignalR 的连接是长期存在的，会经历：建立 → 收发消息 → 断开/重连。

连接可能因网络抖动、服务重启、客户端关闭而断开。健壮的应用要处理重连：

```csharp
// 客户端：断线自动重连
hubConnection.OnClosed(async _ =>
{
    await Task.Delay(TimeSpan.FromSeconds(3));
    await hubConnection.StartAsync();
});
```

服务端可以通过 `OnConnectedAsync`/`OnDisconnectedAsync` 跟踪连接状态，做上线/下线处理。断开是常态而非异常，重连和状态恢复必须纳入设计。

## 5. 分组与横向扩展

分组把连接组织起来，按组广播：

```csharp
await Groups.AddToGroupAsync(Context.ConnectionId, "room1");
await Clients.Group("room1").SendAsync("ReceiveMessage", message);
```

单机时连接和分组在内存中。横向扩展（多实例）时，各实例的连接状态不一致，需要 backplane（Redis、Azure SignalR Service）同步分组和消息。扩展前要评估「连接状态是否需要跨实例共享」。

## 6. SignalR vs gRPC

| | SignalR | gRPC |
| :-- | :-- | :-- |
| 定位 | 浏览器/客户端实时推送 | 服务间强类型 RPC |
| 传输 | WebSocket/SSE/长轮询 | HTTP/2 |
| 消息格式 | 约定（默认 JSON） | protobuf |
| 典型场景 | 聊天、通知、推送 | 微服务内部调用 |

SignalR 面向「需要从服务端主动推送、且客户端可能是浏览器」的场景；gRPC 面向「服务间强类型高效调用」。两者解决不同问题，可共存。

## 7. 后续阅读

- [gRPC](./chapter-03-grpc.md)对比实时通信的另一选择。
- [ASP.NET Core 依赖注入](../04-aspnet-core/chapter-05-dependency-injection.md)解释 Hub 如何注入服务。
- [并发与异步](../03-csharp-concurrency/chapter-01-why-async.md)解释大量长连接的异步模型。

> 本页的技术边界按 .NET 10 / C# 14 核对；SignalR 由 `Microsoft.AspNetCore.SignalR` 提供，backplane 需 Redis 或 Azure SignalR Service。官方参考：[SignalR 文档](https://learn.microsoft.com/en-us/aspnet/core/signalr/)。
