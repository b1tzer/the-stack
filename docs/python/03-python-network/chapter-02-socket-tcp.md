---
type: howto
level: intermediate
---

# socket 与 TCP 底层

本页面向需要在 Python 里直接收发 TCP 字节流的读者，回答一个问题：什么时候必须碰 `socket`，以及怎么在"字节流没有消息边界"的前提下写出能正确分帧的程序。前置知识是[语言核心章节](../01-python-language/chapter-00-getting-started.md)里的值与异常处理，不需要事先了解 asyncio。

示例基于 Python 3.13+ 的标准库 `socket`，不依赖第三方库；结果以本机运行的本地 TCP 服务为准。

## 1. 先判断要不要用 socket

大多数网络任务不该碰 `socket`：访问 HTTP 接口用 [requests / httpx](./chapter-01-http-client.md)，它们内部已经处理了连接、编码、超时和协议细节。只有当你在实现自定义协议、对接一个不走 HTTP 的现有服务（如 Redis、MySQL 的 wire protocol），或者做底层网络调试时，才需要直接操作 TCP。

`socket` 是操作系统网络接口的薄封装。所谓"底层"，指的是你拿到的是一段**字节流**：没有请求/响应、没有 JSON、没有消息边界，这些结构都要自己定义。理解这一点比记住 API 更重要。

## 2. 一个完整的回显：服务端与客户端

服务端监听一个端口，收到连接后把收到的字节原样发回：

```python
import socket

with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
    s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    s.bind(('127.0.0.1', 9000))
    s.listen()
    conn, addr = s.accept()          # 阻塞，直到有客户端连入
    with conn:
        data = conn.recv(1024)       # 最多读 1024 字节
        conn.sendall(data)           # 把收到的字节原样发回
```

`AF_INET` 是 IPv4，`SOCK_STREAM` 是 TCP。`SO_REUSEADDR` 让服务端重启时能立刻复用仍处于 TIME_WAIT 的端口，开发期几乎必设。`accept()` 返回代表这条连接的新套接字 `conn` 和对端地址 `addr`。

客户端连上去、发一段字节、读回：

```python
import socket

with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
    s.connect(('127.0.0.1', 9000))
    s.sendall(b'hello')
    print(s.recv(1024))              # b'hello'
```

先启动服务端，再运行客户端。客户端打印 `b'hello'` 即成功。用 `sendall` 而不是 `send`：`send` 可能只发送一部分字节就返回，`sendall` 会循环直到全部发完。

## 3. 字节流没有消息边界

上面例子能工作，是因为客户端只发一条消息、服务端只读一次。真实场景里消息会连续到达，此时 TCP 的一个关键性质会立刻暴露：**TCP 是字节流，`send` 的调用次数不等于 `recv` 的接收次数**。

服务端连续两次 `sendall`，客户端一次 `recv` 可能一次全读到（粘包），也可能第一次只读到半个字段（半包）。原因是 TCP 只保证字节按顺序、不丢失地到达，不保留发送方每次调用的边界。

所以凡是"一条条消息"的协议，都必须自己定义分帧规则。最常用的是**长度前缀**：每条消息先发 4 字节长度，再发内容。

```python
import struct

def recv_exact(conn, n):
    buf = b''
    while len(buf) < n:
        chunk = conn.recv(n - len(buf))
        if not chunk:                    # 对端关闭，数据没读够
            raise ConnectionError('连接在数据读完前关闭')
        buf += chunk
    return buf

def send_msg(conn, payload):
    conn.sendall(struct.pack('!I', len(payload)))   # 网络字节序的 4 字节长度
    conn.sendall(payload)

def recv_msg(conn):
    n = struct.unpack('!I', recv_exact(conn, 4))[0]  # 先读长度
    return recv_exact(conn, n)                       # 再按长度读内容
```

`recv_exact` 循环读取直到凑够 `n` 字节，`recv` 返回空字节表示对端已经关闭连接。`struct.pack('!I', ...)` 用 `!` 强制网络字节序（大端），保证不同字节序的机器之间长度字段一致。

## 4. 超时、关闭与半关闭

网络操作可能无限阻塞，生产代码要给 socket 设超时，或直接在一开始用 `socket.create_connection`：

```python
with socket.create_connection(('127.0.0.1', 9000), timeout=5) as s:
    ...
```

`create_connection` 同时完成 `socket()` 和 `connect()`，`timeout=5` 覆盖连接与后续收发。超时抛 `TimeoutError`（它是 `OSError` 的子类），对端关闭时 `recv` 返回空字节。

服务端主动告诉对端"我不再发送了"用半关闭，而不是直接 `close`：

```python
s.shutdown(socket.SHUT_WR)   # 关闭写端，发送 FIN；仍可读对端数据
```

`close` 直接断开整个连接；`shutdown(SHUT_WR)` 只关写方向，常用于"发完请求后等回应"的协议。日常写 HTTP 客户端用不到这些，但实现自定义协议时这是关闭语义的基础。

## 5. 这一章要记住的结论

绝大多数网络任务用 requests / httpx，只有自定义协议或底层调试才碰 `socket`；TCP 是字节流，`send` 次数不等于 `recv` 次数，消息边界要用长度前缀这类规则自己定义；发送用 `sendall`、接收要循环凑够字节数、给连接设超时。

接下来进入 [asyncio 网络原语](./chapter-03-asyncio-network.md)，看不用线程怎么让一个服务端同时服务多个连接。
