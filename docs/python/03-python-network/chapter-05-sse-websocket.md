---
type: howto
level: intermediate
---

# SSE 与 WebSocket

本页面向需要"服务端主动把消息推给客户端"或"双向实时通信"的读者，回答两个问题：SSE 和 WebSocket 怎么选、各自怎么实现。前置知识是 [HTTP 客户端基础](./chapter-01-http-client.md)和 [FastAPI 后端开发](../04-fastapi/chapter-01-fastapi-core.md)（SSE 服务端示例用到它）。

示例基于 Python 3.13+、httpx 0.28、FastAPI 0.165 和 websockets 17.x；结果以本机运行的服务为准。

## 1. 先选对方向：SSE 还是 WebSocket

两者都能做服务端推送，但能力边界不同：

- **SSE（Server-Sent Events）**：服务端到客户端的**单向**流，走普通 HTTP，客户端用 `EventSource` 或手动读流。它自动重连、能被代理和负载均衡器正常转发，实现简单。适合通知、日志流、大模型逐字输出这类"只推不收"的场景。
- **WebSocket**：一次握手后升级成**双向**、持久的全双工连接，双方随时互发。适合聊天、实时协作、游戏这类"双方都要发"的场景。

能单向解决就不要上 WebSocket：SSE 复用现有 HTTP 基础设施，不用处理心跳、重连和协议升级。反过来，客户端要主动发消息给服务端，SSE 办不到，只能用 WebSocket 或退回普通 POST 轮询。

## 2. SSE 服务端与客户端

服务端用 FastAPI 的 `StreamingResponse` 输出 `text/event-stream`，每条消息是 `data: ...` 加一个空行结尾：

```python
from fastapi import FastAPI
from fastapi.responses import StreamingResponse
import asyncio

app = FastAPI()

@app.get('/events')
async def events():
    async def gen():
        for i in range(5):
            yield f'data: {i}\n\n'
            await asyncio.sleep(1)
    return StreamingResponse(gen(), media_type='text/event-stream')
```

客户端用 httpx 的 `stream` 逐行读，遇到 `data: ` 开头的行就是一条消息：

```python
import httpx

with httpx.Client() as client:
    with client.stream('GET', 'http://127.0.0.1:8000/events') as r:
        for line in r.iter_lines():
            if line.startswith('data: '):
                print(line[6:])   # 0 1 2 3 4
```

`iter_lines` 逐行产出，内存里只有当前行，适合长连接。浏览器里则直接用原生 `EventSource`，连解析都不用自己写。

## 3. WebSocket 服务端与客户端

Python 里 WebSocket 的首选库是 `websockets`。**从 14.0 起，它的 API 从顶层 `websockets.serve` / `websockets.connect` 迁移到了 `websockets.asyncio.server` / `websockets.asyncio.client`**，网上大量旧教程的 `import websockets` 写法在新版本会直接报错。服务端：

```python
from websockets.asyncio.server import serve
import asyncio

async def handler(websocket):
    async for message in websocket:       # 逐条收消息
        await websocket.send(f'echo: {message}')

async def main():
    async with serve(handler, '127.0.0.1', 9001):
        await asyncio.Future()            # 一直运行，直到被取消

asyncio.run(main())
```

客户端：

```python
from websockets.asyncio.client import connect
import asyncio

async def main():
    async with connect('ws://127.0.0.1:9001') as websocket:
        await websocket.send('hello')
        print(await websocket.recv())     # echo: hello

asyncio.run(main())
```

`async with connect(...)` 退出时自动关闭连接；`send` 发文本或二进制，`recv` 收下一条消息。连接被对端关闭时 `recv` 抛 `ConnectionClosed`，长连接客户端要捕获它并决定是否重连。

## 4. 这一章要记住的结论

单向推送用 SSE（走普通 HTTP、自动重连），双向实时通信用 WebSocket；SSE 服务端用 FastAPI 的 `StreamingResponse` 输出 `text/event-stream`，客户端用 httpx `stream` 逐行读；WebSocket 用 `websockets` 库，且 14.0 起要用 `websockets.asyncio.server.serve` / `websockets.asyncio.client.connect` 的新导入路径。

接下来进入 [生产实践](./chapter-06-production-practices.md)，把前面这些工具放到真实部署环境里看怎么选、怎么配。
