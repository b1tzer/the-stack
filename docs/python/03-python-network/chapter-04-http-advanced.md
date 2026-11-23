---
type: howto
level: intermediate
---

# HTTP 客户端进阶

本页面向已经会用 requests / httpx 发单次请求、想处理并发、大文件下载和自动重试的读者，回答四个问题：怎么并发发请求、连接池是什么以及怎么配、大响应怎么流式读、失败怎么自动重试。前置知识是 [HTTP 客户端基础](./chapter-01-http-client.md)，异步部分依赖 [asyncio 章节](../01-python-language/chapter-11-asyncio.md)。

示例基于 httpx 0.28、requests 2.x 和 Python 3.13+；结果以本机运行的本地 HTTP 服务为准。

## 1. 复用 client，而不是反复创建

httpx 的 `Client` / `AsyncClient` 内部维护一个连接池，复用同一个实例才能让多个请求共享 TCP 连接。正确做法是创建一次、用多次：

```python
import asyncio
import httpx

async def fetch(client, url):
    return await client.get(url)

async def main():
    urls = ['http://127.0.0.1:8000/1', 'http://127.0.0.1:8000/2', 'http://127.0.0.1:8000/3']
    async with httpx.AsyncClient() as client:
        responses = await asyncio.gather(*(fetch(client, u) for u in urls))
    print([r.status_code for r in responses])   # [200, 200, 200]

asyncio.run(main())
```

`asyncio.gather` 并发等待三个请求，同一个 `client` 里的连接被复用。**反例**是在循环里每请求写一次 `async with httpx.AsyncClient() as client`：那样每次都新建连接池、用完即弃，TCP 连接无法复用，性能和资源都变差。`requests` 同理，应复用 `requests.Session`。

## 2. 连接池与 Limits

连接池的上限用 `httpx.Limits` 配置，三个默认值需要记：

- `max_connections`：连接总数上限，默认 100。
- `max_keepalive_connections`：空闲保活的连接上限，默认 20。
- `keepalive_expiry`：空闲保活连接的存活秒数，默认 5。

```python
limits = httpx.Limits(max_connections=50, max_keepalive_connections=10)
client = httpx.Client(limits=limits)
```

当并发请求超过连接池上限时，多余的请求会排队等连接，等不到就抛 `PoolTimeout`。因此池子大小要按"同时会发多少个请求"来定，而不是越大越好——过大的池子会让下游和本机各占一堆空闲连接。`requests` 的对应参数是 `HTTPAdapter(pool_connections, pool_maxsize)`，默认每个主机最多 10 条连接，比 httpx 保守。

## 3. 大响应用流式读取

`r.json()` 和 `r.text` 会把整个响应体读进内存，下载大文件时会撑爆内存。改用 `stream`，逐块读取：

```python
with httpx.Client() as client:
    with client.stream('GET', 'http://127.0.0.1:8000/big') as r:
        r.raise_for_status()
        with open('out.bin', 'wb') as f:
            for chunk in r.iter_bytes(chunk_size=8192):   # 每块 8 KiB
                f.write(chunk)
```

异步版用 `aiter_bytes()`：

```python
async with httpx.AsyncClient() as client:
    async with client.stream('GET', 'http://127.0.0.1:8000/big') as r:
        async for chunk in r.aiter_bytes():
            ...
```

逐块写盘，内存里始终只有一块数据。需要边收边处理文本行（如解析 SSE）时用 `iter_lines()` / `aiter_lines()`。

## 4. 超时要细分

`timeout=5` 是总超时，但生产里连接建立和读取数据是两类不同的等待，要分开设：

```python
timeout = httpx.Timeout(connect=5.0, read=30.0, write=10.0, pool=5.0)
client = httpx.Client(timeout=timeout)
```

- `connect`：建立 TCP 连接的超时，短一些（网络不通时快速失败）。
- `read`：等响应数据的超时，按接口耗时设，长请求（下载、慢接口）要放宽。
- `write`：发送请求体的超时。
- `pool`：从连接池拿到连接的超时，池子被占满时触发。

## 5. 失败自动重试

重试要约束范围和次数，否则会把下游打爆。同步的 `requests` 用 `urllib3` 的 `Retry`：

```python
import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

retry = Retry(total=3, backoff_factor=0.5,
              status_forcelist=[500, 502, 503, 504],
              allowed_methods=['GET'])
s = requests.Session()
s.mount('http://', HTTPAdapter(max_retries=retry))
s.mount('https://', HTTPAdapter(max_retries=retry))
r = s.get('http://127.0.0.1:8000/flaky')
```

`total=3` 是最多重试 3 次，`backoff_factor=0.5` 让重试间隔指数退避（0.5s、1s、2s），`status_forcelist` 只对这几个服务端错误码重试，`allowed_methods=['GET']` 限定只重试幂等的 GET。httpx 则在 transport 层开启：

```python
transport = httpx.HTTPTransport(retries=3)
with httpx.Client(transport=transport) as client:
    ...
```

**写操作（POST/PUT）默认不重试**，除非接口明确幂等——重复提交订单比一次失败更糟。

## 6. 这一章要记住的结论

复用同一个 client/session，不要每请求新建；连接池大小按并发量配置，超额请求会排队并抛 `PoolTimeout`；大响应用 `stream` + `iter_bytes` 逐块读；超时区分 connect / read / write / pool；重试只对幂等操作，且限制次数和退避。

接下来进入 [SSE 与 WebSocket](./chapter-05-sse-websocket.md)，看需要服务端主动推送或双向实时通信时用什么。
