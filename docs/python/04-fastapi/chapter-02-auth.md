---
type: howto
level: advanced
---

# 认证与鉴权

本页面向已经会用 FastAPI 写接口、需要做用户登录和权限控制的读者，回答一个问题：怎么给接口加认证，区分"你是谁"和"你能做什么"。前置知识是 [FastAPI 后端开发](./chapter-01-fastapi-core.md)和数据访问。

示例基于 FastAPI 0.115+、PyJWT 2.x、bcrypt 4.x 和 Python 3.13+。

## 1. 认证与鉴权是两个概念

- **认证（authentication）**：确认"你是谁"——核对用户名密码，颁发一个令牌。
- **鉴权（authorization）**：确认"你能做什么"——根据令牌判断是否允许访问某个接口。

常见实现：登录接口校验密码、签发 JWT 令牌；客户端每次请求带上令牌；受保护接口校验令牌、注入当前用户。

## 2. 密码哈希

密码绝不能明文存库，要用慢哈希算法（bcrypt 或 argon2）加盐哈希。这里用 bcrypt：

```python
import bcrypt

def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()

def verify_password(password: str, hashed: str) -> bool:
    return bcrypt.checkpw(password.encode(), hashed.encode())

hashed = hash_password('secret')
verify_password('secret', hashed)   # True
verify_password('wrong', hashed)    # False
```

`bcrypt.hashpw` 每次生成不同的盐，所以同一密码两次哈希结果不同；校验用 `checkpw`，而不是直接比较哈希值。

注意：旧教程常推荐 `passlib`，但它已多年不维护，在 Python 3.13 上有兼容问题。新项目直接用 `bcrypt` 或 `argon2-cffi`。

## 3. 签发 JWT 令牌

登录成功后签发 JWT。用 PyJWT：

```python
import jwt
from datetime import datetime, timedelta, timezone

SECRET_KEY = 'your-secret-key'   # 生产环境从环境变量读取
ALGORITHM = 'HS256'

def create_token(user_id: int) -> str:
    payload = {
        'sub': str(user_id),
        'exp': datetime.now(timezone.utc) + timedelta(hours=1),
    }
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)
```

`sub` 是主题（用户 id），`exp` 是过期时间。`SECRET_KEY` 必须保密且足够随机，生产环境从环境变量读取。校验令牌失败（过期、篡改）会抛 `jwt.InvalidTokenError`。

## 4. 登录接口与令牌校验

用 FastAPI 的 `OAuth2PasswordBearer` 从请求头提取令牌，用依赖注入校验并注入当前用户：

```python
from fastapi import Depends, FastAPI, HTTPException, status
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm

app = FastAPI()
oauth2_scheme = OAuth2PasswordBearer(tokenUrl='token')

def get_current_user(token: str = Depends(oauth2_scheme)):
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id = int(payload['sub'])
    except jwt.InvalidTokenError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail='无效的令牌',
        )
    return {'id': user_id}

@app.post('/token')
def login(form_data: OAuth2PasswordRequestForm = Depends()):
    # 校验 form_data.username / form_data.password，成功后签发
    return {'access_token': create_token(1), 'token_type': 'bearer'}
```

受保护接口用 `Depends(get_current_user)` 声明即可，FastAPI 自动先执行令牌校验：

```python
@app.get('/me')
def me(user=Depends(get_current_user)):
    return user
```

没有令牌或令牌无效时，FastAPI 自动返回 401。登录接口用 `OAuth2PasswordRequestForm` 接收表单形式的用户名密码。

## 5. 鉴权：按角色限制访问

拿到当前用户后，可以进一步做权限判断：

```python
def require_admin(user=Depends(get_current_user)):
    if user['id'] not in ADMIN_IDS:
        raise HTTPException(status_code=403, detail='需要管理员权限')
    return user

@app.get('/admin')
def admin_only(user=Depends(require_admin)):
    return {'ok': True}
```

依赖可以层层嵌套：`require_admin` 依赖 `get_current_user`，先认证再鉴权。

## 6. 生产注意

- **密钥管理**：`SECRET_KEY` 从环境变量或密钥管理服务读取，绝不硬编码进源码或提交到仓库。
- **HTTPS**：JWT 通过请求头传输，生产必须用 HTTPS，否则令牌会被中间人截获。
- **令牌有效期**：`exp` 设短（如 1 小时），配合刷新令牌；不要签发永不过期的令牌。
- **密码哈希成本**：bcrypt 的成本因子（`gensalt` 的 rounds）按服务器性能调，通常是 10~12。

## 7. 这一章要记住的结论

认证是"你是谁"、鉴权是"你能做什么"；密码用 bcrypt/argon2 慢哈希（别用 passlib），令牌用 PyJWT 签发 JWT；FastAPI 用 `OAuth2PasswordBearer` + 依赖注入校验令牌、注入当前用户；生产密钥从环境变量读、必须 HTTPS、令牌要设过期。
