---
type: howto
level: intermediate
---

# FastAPI 后端开发

本页面向已经掌握 Python 语言核心、想用它写 HTTP 后端的读者，回答一个问题：如何用 FastAPI 搭一个带请求校验和依赖注入的接口。FastAPI 是 Python 后端的主流框架之一，它用类型注解和 Pydantic 把参数校验、文档生成自动化。

前置知识是[函数、作用域与模块](../01-python-language/chapter-04-functions.md)（类型注解、pydantic）和[HTTP 客户端与网络编程](../03-python-network/chapter-01-http-client.md)。示例基于 FastAPI 0.165、Pydantic 2.x 和 Python 3.13+。

## 1. FastAPI 解决什么问题

FastAPI 建立在 Starlette（异步 Web 框架）和 Pydantic（数据校验）之上，核心卖点是把类型注解变成运行时能力：

- 用类型注解声明参数和返回值，框架自动校验、转换和生成文档。
- 请求体用 Pydantic 模型校验，非法输入自动返回 422，不需要手写校验代码。
- 自动生成 OpenAPI 文档（`/docs` 交互式页面）。
- 支持 `async def` 异步接口和 `def` 同步接口（同步函数在线程池运行）。

用类型注解声明参数，FastAPI 就自动完成校验和文档，省去大量样板代码。

## 2. 安装与第一个应用

安装 FastAPI 和 ASGI 服务器 uvicorn：

```txt
pip install "fastapi" "uvicorn[standard]"
```

创建 `main.py`：

```python
from fastapi import FastAPI

app = FastAPI()

@app.get('/')
def root():
    return {'hello': 'world'}
```

运行：

```txt
uvicorn main:app --reload
```

成功标志：控制台输出 `Uvicorn running on http://127.0.0.1:8000`。访问 `http://127.0.0.1:8000/` 返回 `{"hello":"world"}`，访问 `http://127.0.0.1:8000/docs` 看到自动生成的交互式文档。

## 3. 路径参数与查询参数

用类型注解声明参数，FastAPI 自动做类型转换和校验：

```python
@app.get('/items/{item_id}')
def read_item(item_id: int, q: str | None = None):
    return {'item_id': item_id, 'q': q}
```

`item_id: int` 把路径里的字符串自动转成 `int`，传入非数字时自动返回 422；`q: str | None = None` 声明可选查询参数。

## 4. 请求体与 Pydantic 模型

请求体用 Pydantic 模型声明，自动校验和序列化：

```python
from pydantic import BaseModel

class Item(BaseModel):
    name: str
    price: float

@app.post('/items/{item_id}')
def create_item(item_id: int, item: Item):
    return {'id': item_id, 'item': item}
```

发送 `{"name": "x", "price": 1.5}` 时，FastAPI 把它解析成 `Item` 实例并校验字段；`price` 传非数字时自动返回 422 和字段错误明细，不需要手写校验逻辑。

## 5. 依赖注入

用 `Depends` 声明依赖，FastAPI 自动注入：

```python
from fastapi import Depends

def get_db():
    return {'items': {}}

@app.post('/items/{item_id}')
def create_item(item_id: int, item: Item, db=Depends(get_db)):
    db['items'][item_id] = item.model_dump()
    return {'id': item_id}
```

`db=Depends(get_db)` 让 FastAPI 每次请求调用 `get_db` 并把返回值注入。依赖可以层层嵌套，用于数据库连接、鉴权、配置等横切逻辑。

## 6. 异常处理

用 `HTTPException` 返回错误状态码，框架会生成规范的错误响应：

```python
from fastapi import HTTPException

@app.get('/items/{item_id}')
def read_item(item_id: int):
    raise HTTPException(status_code=404, detail='item not found')
```

客户端收到 `404` 和 `{"detail": "item not found"}`。业务错误用 `HTTPException`；未捕获的异常由全局异常处理器统一兜底，返回 500。

## 7. 验证与测试

接口写完后用 `TestClient` 验证，不需要真正起服务器：

```python
from fastapi.testclient import TestClient

client = TestClient(app)
assert client.get('/').json() == {'hello': 'world'}
assert client.post('/items/1', json={'name': 'x', 'price': 1.5}).status_code == 200
assert client.post('/items/2', json={'name': 'y', 'price': 'bad'}).status_code == 422
```

`TestClient` 基于 httpx，配合 pytest 就能在 CI 里跑接口测试。请求校验（422）和业务逻辑（200/404）都应覆盖。

## 8. 这一章要记住的结论

FastAPI 用类型注解和 Pydantic 把参数校验、请求体解析和文档生成自动化；路由用 `@app.get/post` 声明，依赖用 `Depends` 注入，错误用 `HTTPException` 返回。

FastAPI 的完整生产能力（鉴权、数据库 ORM、后台任务、部署）超出语言专题范围，需要时按官方文档和对应组件专题展开。
