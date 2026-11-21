---
type: howto
level: advanced
---

# 部署：从开发到生产

本页面向已经把 FastAPI 服务写好、想部署上线的读者，回答一个问题：怎么把 FastAPI 应用稳定地跑在生产环境。前置知识是 [FastAPI 后端开发](../04-fastapi/chapter-01-fastapi-core.md)。

## 1. ASGI 服务器

FastAPI 应用是 ASGI 应用，需要一个 ASGI 服务器来运行。开发时用 `uvicorn --reload`，生产去掉 `--reload` 并加多进程：

```txt
uvicorn main:app --host 0.0.0.0 --port 8000 --workers 4
```

- `--host 0.0.0.0` 监听所有网卡，允许外部访问。
- `--workers 4` 启动 4 个 worker 进程，利用多核。
- 生产**不要**用 `--reload`（它用于开发时热重载，会拖慢性能）。

worker 数量一般设为 CPU 核心数的 1~4 倍，具体按负载和内存调。IO 密集应用可以多开，CPU 密集受 GIL 限制，多 worker 也难线性提升。

## 2. Gunicorn 管理 worker

生产常用 Gunicorn 作为进程管理器，用它拉起多个 uvicorn worker：

```txt
pip install gunicorn
gunicorn -k uvicorn.workers.UvicornWorker -w 4 -b 0.0.0.0:8000 main:app
```

- `-k uvicorn.workers.UvicornWorker` 指定 worker 类型为 uvicorn。
- `-w 4` worker 数量，`-b` 绑定地址。

Gunicorn 负责进程管理（fork、重启崩溃的 worker、平滑重启），uvicorn worker 负责真正处理请求。两者组合是 FastAPI 最常见的生产部署方式。

## 3. Nginx 反向代理

生产通常在前面加一层 Nginx：处理 TLS、静态文件、负载均衡，把请求转发给后面的 uvicorn/gunicorn：

```nginx
server {
    listen 80;
    server_name example.com;

    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

FastAPI 应用监听本机 8000 端口，Nginx 对外提供服务。TLS 证书（HTTPS）也在 Nginx 这一层配置，应用本身不需要处理 HTTPS。

## 4. 容器化

用 Docker 打包，保证环境一致。一个最小的 Dockerfile：

```dockerfile
FROM python:3.13-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
EXPOSE 8000
CMD ["gunicorn", "-k", "uvicorn.workers.UvicornWorker", "-w", "4", "-b", "0.0.0.0:8000", "main:app"]
```

要点：先 `COPY requirements.txt` 再 `pip install`，利用 Docker 层缓存；`CMD` 用生产命令而不是 `--reload`。

## 5. 配置与环境变量

不同环境（开发/测试/生产）的配置不同，用环境变量注入，不硬编码：

```python
import os

DATABASE_URL = os.environ.get('DATABASE_URL', 'sqlite:///app.db')
SECRET_KEY = os.environ['SECRET_KEY']   # 生产必须提供，缺失则启动失败
```

数据库地址、密钥、第三方服务的 key 都通过环境变量传入。密码、令牌这类敏感值绝不写进代码或镜像。

## 6. 这一章要记住的结论

FastAPI 用 ASGI 服务器运行，生产用 `gunicorn -k uvicorn.workers.UvicornWorker` 或 `uvicorn --workers` 多进程部署；前面加 Nginx 处理 HTTPS 和负载均衡；用 Docker 打包；配置通过环境变量注入。
