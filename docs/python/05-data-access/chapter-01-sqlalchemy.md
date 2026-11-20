---
type: howto
level: intermediate
---

# 数据访问：SQLAlchemy 与 asyncpg

本页面向已经会用 FastAPI 写接口、需要读写数据库的读者，回答一个问题：Python 后端怎么连接数据库、执行查询、管理事务。前置知识是[函数、作用域与模块](../01-python-language/chapter-04-functions.md)和 [FastAPI 后端开发](../04-fastapi/chapter-01-fastapi-core.md)。

示例基于 SQLAlchemy 2.x、asyncpg 0.32 和 Python 3.13+；本地练习用 SQLite（无需安装数据库），生产示例用 PostgreSQL。

## 1. 数据访问的三层选择

Python 访问数据库有三层抽象，从底到顶：

- **原始驱动**：直接执行 SQL，如 `psycopg`（PostgreSQL）、`sqlite3`（内置）。最灵活，但要手写 SQL、手动处理参数和结果。
- **异步驱动**：`asyncpg` 直接说 PostgreSQL 二进制协议，性能最好，但仍手写 SQL。
- **ORM**：`SQLAlchemy` 把表映射成 Python 类，用对象操作数据库，自动生成 SQL。

多数后端项目用 ORM（SQLAlchemy）做常规 CRUD，性能敏感的地方降到原始 SQL 或 asyncpg。三者不是互斥的，可以混合使用。

## 2. SQLAlchemy 2.x：声明模型

SQLAlchemy 2.x 用 `DeclarativeBase` 定义基类，用 `Mapped` + `mapped_column` 声明字段。以 SQLite 为例：

```python
from sqlalchemy import create_engine, String
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, Session

class Base(DeclarativeBase):
    pass

class User(Base):
    __tablename__ = 'users'
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(50))
    age: Mapped[int]

engine = create_engine('sqlite:///app.db')
Base.metadata.create_all(engine)
```

`create_all` 根据模型建表（生产环境通常用迁移工具，见第 7 节）。`Mapped[int]` 里的类型注解用于类型检查，`mapped_column` 描述列的数据库属性。

## 3. Session 与 CRUD

`Session` 是操作数据库的工作单元。增删改查：

```python
with Session(engine) as session:
    # 增
    u = User(name='Tom', age=30)
    session.add(u)
    session.commit()          # 提交事务，写入数据库
    # 查
    u = session.get(User, u.id)
    print(u.name)             # Tom
    # 改
    u.age = 31
    session.commit()
    # 删
    session.delete(u)
    session.commit()
```

`commit` 提交事务；`with Session(engine)` 保证退出时正确关闭会话。没 `commit` 的修改在会话结束后丢弃。

## 4. 查询：select 风格

SQLAlchemy 2.x 推荐用 `select()` 函数构建查询：

```python
from sqlalchemy import select

with Session(engine) as session:
    # 按条件查
    result = session.execute(
        select(User).where(User.age >= 18).order_by(User.name)
    )
    users = result.scalars().all()   # [User, ...]

    # 单条
    u = session.scalar(select(User).where(User.name == 'Tom'))
```

`select(User)` 构建查询，`.where()` 加条件，`.order_by()` 排序；`scalars()` 把结果行转成 `User` 对象，`scalar()` 取单条（没有则返回 `None`）。

## 5. 异步数据访问：asyncpg

asyncio 环境里，同步的 SQLAlchemy 会阻塞事件循环。两条路：

- **asyncpg**：直接用异步驱动，手写 SQL，性能最好。
- **SQLAlchemy async**：用 `create_async_engine` 拿到异步 ORM。

asyncpg 直接说 PostgreSQL 二进制协议：

```python
import asyncio, asyncpg

async def main():
    conn = await asyncpg.connect(user='postgres', password='pw',
                                 database='app', host='127.0.0.1')
    rows = await conn.fetch('SELECT id, name FROM users WHERE age > $1', 18)
    for row in rows:
        print(row['name'])
    await conn.close()

asyncio.run(main())
```

`fetch` 返回记录列表，`$1` 是参数占位符（asyncpg 用 `$n`）。asyncpg 只支持 PostgreSQL。

SQLAlchemy 的异步版本：

```python
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession

engine = create_async_engine('postgresql+asyncpg://postgres:pw@127.0.0.1/app')

async with AsyncSession(engine) as session:
    result = await session.execute(select(User).where(User.age >= 18))
    users = result.scalars().all()
```

注意 URL 用 `postgresql+asyncpg://` 指定异步驱动。`AsyncSession` 的用法与同步 `Session` 一致，只是所有操作都要 `await`。

## 6. 与 FastAPI 集成

FastAPI 里，数据库会话通过依赖注入提供，请求结束自动关闭：

```python
from fastapi import Depends, FastAPI
from sqlalchemy.orm import Session

app = FastAPI()

def get_db():
    with Session(engine) as session:
        yield session

@app.get('/users')
def list_users(db: Session = Depends(get_db)):
    result = db.execute(select(User).order_by(User.name))
    return [{'id': u.id, 'name': u.name} for u in result.scalars()]
```

`get_db` 用生成器提供会话，`yield` 之后 `with` 块自动关闭会话。FastAPI 的依赖注入和 SQLAlchemy 的 `Session` 配合，形成"每请求一个会话"的常见模式。

## 7. 事务与迁移

**事务**：`session.commit()` 提交当前事务，一次提交把本会话内的所有修改一起写入；中间出错不调用 `commit` 则全部回滚。需要手动回滚时调用 `session.rollback()`。

**迁移**：生产环境不用 `create_all` 建表，而用迁移工具（Alembic）管理表结构变更。`create_all` 只适合本地练习和一次性初始化。

## 8. 常见坑

- **N+1 查询**：在循环里逐个访问关联对象，会为每个对象发一次查询。用 `selectinload` 或 `joinedload` 一次加载关联数据。
- **连接泄漏**：没有关闭 Session 或连接，连接池会被耗尽。用 `with Session(engine)` 或依赖注入自动关闭。
- **延迟加载在异步下的问题**：async 环境访问未加载的关联属性会抛错（缺少 IO 上下文），需显式 eager load。
- **参数占位符**：不同驱动占位符不同（asyncpg 用 `$1`，SQLite 用 `?`），用 SQLAlchemy 的 `select().where(...)` 会自动处理，手写 SQL 时要注意。

## 9. 这一章要记住的结论

常规 CRUD 用 SQLAlchemy 2.x（`DeclarativeBase` + `Session` + `select` 风格）；asyncio 里用 `create_async_engine` 或直接 asyncpg；FastAPI 用依赖注入提供每请求一个会话；生产用 Alembic 做迁移，注意 N+1 和连接泄漏。
