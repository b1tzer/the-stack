---
type: howto
level: intermediate
---

# HTTP 客户端与网络编程

本页面向需要让 Python 程序访问 HTTP 接口的读者，回答一个问题：发 HTTP 请求用什么、怎么处理超时和错误。前置知识是语言核心章节，异步请求部分依赖 [asyncio、协程与事件循环](../01-python-language/chapter-11-asyncio.md)。

示例基于 requests 2.x、httpx 0.28 和 Python 3.13+；结果以本机运行的本地 HTTP 服务为准。

## 1. requests：同步 HTTP 客户端

`requests` 是同步 HTTP 的事实标准。发起 GET 并解析 JSON：

```python
import requests

r = requests.get('http://127.0.0.1:8000/hello', timeout=5)
r.status_code      # 200
r.json()           # {'msg': 'hello'}
```

`r.json()` 直接把响应体解析为字典；`r.text` 返回原始字符串。POST 发送 JSON：

```python
r = requests.post('http://127.0.0.1:8000/items',
                  json={'name': 'x', 'price': 1.5}, timeout=5)
r.status_code      # 200
```

成功标志是 `r.status_code == 200`（或对应的 2xx）。网络错误和超时分别抛 `requests.ConnectionError` 和 `requests.Timeout`。

## 2. httpx：同步与异步统一

`httpx` 提供与 requests 几乎相同的同步接口，同时提供异步客户端，适合在 asyncio 里使用：

```python
import httpx

r = httpx.get('http://127.0.0.1:8000/hello', timeout=5)
r.json()           # {'msg': 'hello'}
```

异步版本：

```python
import asyncio, httpx

async def fetch(url):
    async with httpx.AsyncClient() as client:
        r = await client.get(url, timeout=5)
        return r.json()

asyncio.run(fetch('http://127.0.0.1:8000/hello'))   # {'msg': 'hello'}
```

在 asyncio 协程里必须用 `httpx.AsyncClient`，不能用同步的 `requests`——同步请求会阻塞事件循环。这是[异步章节](../01-python-language/chapter-11-asyncio.md)里"阻塞调用是 asyncio 的敌人"的直接体现。

## 3. socket 与底层网络

需要直接操作 TCP 连接时用标准库 `socket`，接口是创建套接字、连接、收发字节、关闭。底层 TCP 语义（三次握手、超时、粘包）是网络协议本身的行为，与语言无关。

绝大多数场景不需要碰 `socket`：HTTP 请求用 requests/httpx，它们内部处理连接、编码和协议细节。只有实现自定义协议或做底层调试时才降到 `socket`。

## 4. 超时、重试与错误处理

网络请求必须处理失败，不能假设一定成功：

- **超时**：`timeout=5` 设置总超时，避免请求无限挂起。生产环境应区分连接超时和读取超时。
- **重试**：瞬时故障（连接被重置、超时）可以重试，但要限制次数和退避，避免放大下游压力。写操作（POST 等）重试前先确认接口幂等。
- **错误**：按类型捕获——`ConnectionError`（连不上）、`Timeout`（超时）、`HTTPStatusError`（非 2xx 状态码，需要 `r.raise_for_status()` 才抛）。

```python
import requests

try:
    r = requests.get(url, timeout=5)
    r.raise_for_status()   # 非 2xx 抛 HTTPStatusError
except requests.Timeout:
    print('请求超时')
except requests.ConnectionError:
    print('连接失败')
except requests.HTTPError:
    print('HTTP 状态码错误')
```

`raise_for_status()` 让非 2xx 响应变成异常，避免静默拿到错误响应体。

## 5. 这一章要记住的结论

同步请求用 `requests`，异步请求用 `httpx.AsyncClient`；网络请求必须设超时、按类型捕获错误，写操作重试前确认幂等；底层 TCP 语义与语言无关，日常不必碰 `socket`。

接下来进入 [FastAPI 后端开发](../04-fastapi/chapter-01-fastapi-core.md)，把 HTTP 接口从"调用方"转到"提供方"。
