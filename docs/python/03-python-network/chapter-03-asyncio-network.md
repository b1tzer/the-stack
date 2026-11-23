---
type: howto
level: advanced
---

# asyncio 网络原语

本页面向已经理解事件循环和 `await` 语义、想在 asyncio 里直接收发 TCP 数据的读者，回答一个问题：不用线程，怎么用标准库原语写一个能同时服务多个连接的 TCP 服务端和客户端。前置知识是 [asyncio、协程与事件循环](../01-python-language/chapter-11-asyncio.md)，其中"阻塞调用是 asyncio 的敌人"是本页的出发点。

示例基于 Python 3.13+ 标准库 `asyncio`；结果以本机运行的本地 TCP 服务为准。

## 1. 为什么需要这层原语

上一章的 `socket` 是阻塞的：`accept()` 和 `recv()` 会卡住当前线程，一个线程只能处理一个连接。要同时服务多个连接，传统做法是每连接开一个线程；asyncio 的做法是把连接的读写交给事件循环，在单线程里并发处理。

`asyncio.open_connection` 和 `asyncio.start_server` 就是事件循环上的 TCP 入口。它们底层仍然是 `socket`，只是把"等连接、等数据"从阻塞调用变成了可 `await` 的挂起，因此不会卡住事件循环。客户端和服务端都从这两条函数进入。

## 2. 客户端：open_connection

`open_connection` 连上服务端，返回一个读写对 `(reader, writer)`：

```python
import asyncio

async def main():
    reader, writer = await asyncio.open_connection('127.0.0.1', 9000)
    writer.write(b'hello\n')
    await writer.drain()                  # 等数据刷进内核
    data = await reader.readline()
    print(data)                           # b'hello\n'
    writer.close()
    await writer.wait_closed()            # 等连接真正关闭

asyncio.run(main())
```

`reader` 是 `StreamReader`，`writer` 是 `StreamWriter`。`readline()` 读到 `\n` 为止；服务端回显时它就返回 `b'hello\n'`。

## 3. 服务端：start_server

`start_server` 在指定地址监听，每当有新连接就调用你的处理函数，传入这一条连接的 `(reader, writer)`：

```python
import asyncio

async def handle_echo(reader, writer):
    addr = writer.get_extra_info('peername')
    data = await reader.read(100)
    print(f'received {data!r} from {addr!r}')

    writer.write(data)
    await writer.drain()

    writer.close()
    await writer.wait_closed()

async def main():
    server = await asyncio.start_server(handle_echo, '127.0.0.1', 9000)
    async with server:
        await server.serve_forever()

asyncio.run(main())
```

`handle_echo` 是普通 `async def`，`start_server` 会为每条连接把它调度成一个 `Task`，所以多个客户端可以同时被处理。`get_extra_info('peername')` 取出对端地址，`read(100)` 最多读 100 字节，`write` + `drain` 写回，`close` + `wait_closed` 关闭连接。服务端用 `async with server` 管理生命周期，`serve_forever()` 一直服务直到被取消。

## 4. 读写方法的边界

`StreamReader` 和 `StreamWriter` 的方法比裸 `socket` 更细，正确使用它们才能避免半包和丢数据：

- `read(n)`：最多读 `n` 字节；可能少于 `n`，读完数据不会报错。
- `readline()`：读到 `\n`；到 EOF 还没遇到 `\n` 就返回已读部分。
- `readexactly(n)`：精确读满 `n` 字节；EOF 前不够会抛 `IncompleteReadError`。
- `readuntil(sep)`：读到分隔符（含分隔符）；数据超过缓冲区上限抛 `LimitOverrunError`。
- `write(data)`：只是把数据放进缓冲区，**不保证已经发出去**，之后必须 `await drain()`。
- `drain()`：等写缓冲区降到低水位，可以继续写；流控就在这里发生。
- `close()` + `await wait_closed()`：`close` 发起关闭，`wait_closed` 等数据刷出、连接真正关闭。

和上一章一样，字节流没有消息边界：`readexactly` 或 `readuntil` 就是你要自己定义的"消息边界"。默认的读写缓冲区上限是 64 KiB，单条消息超过它时用循环读取或调大 `limit` 参数。

## 5. 这一章要记住的结论

用 `open_connection` 和 `start_server` 在事件循环上做 TCP，`start_server` 会为每条连接调度一个回调，单线程即可并发服务多个客户端；写数据必须 `write` 后 `drain`，关连接必须 `close` 后 `wait_closed`；消息边界仍要靠 `readexactly` / `readuntil` 自己定义。

接下来回到 HTTP 层面，进入 [HTTP 客户端进阶](./chapter-04-http-advanced.md)，看并发请求、连接池和流式下载。
