# 实战项目：从 0 到 1 构建缓存系统

> 前面四章讲的是「怎么查问题、怎么避坑」，这一章反过来，从零搭一个真实可运行的 Redis 应用：一个带缓存的用户信息接口，加上分布式锁与限流器。把第一卷到第四卷的知识，串成一段能跑起来的代码。

## 1. 项目目标与架构

我们要实现一个「用户信息查询服务」，包含三个核心能力：

| 模块 | 解决的业务问题 | 用到的 Redis 能力 |
| :-- | :-- | :-- |
| 缓存接口 | 高频读用户信息，缓解数据库压力 | String、TTL、Cache-Aside 模式 |
| 分布式锁 | 防止并发下重复扣减库存/重复下单 | `SET NX PX`、Lua 原子释放 |
| 限流器 | 保护接口不被刷爆 | ZSet 滑动窗口 |

整体架构：

![实战项目整体架构](/redis/05-operations-chapter-05-hands-on-project.svg)

> 这三个场景分别对应第一卷的 String、第四卷的分布式锁，以及第三卷反复强调的「用 Redis 扛住流量」——是把全书知识落地的三个最小闭环。

## 2. 环境准备

用 Docker 起一个 Redis，再装 Python 客户端：

```bash
# 1. 启动 Redis（端口 6379，无密码，便于本地练习）
docker run -d --name redis-hands-on -p 6379:6379 redis:7.2

# 2. 验证连接
redis-cli ping          # 返回 PONG

# 3. 安装 Python 客户端
pip install redis
```

项目目录：

```text
hands-on/
├── db.py           # 模拟数据库
├── cache_service.py # 场景一：缓存接口
├── lock.py          # 场景二：分布式锁
├── rate_limiter.py  # 场景三：限流器
└── main.py          # 入口，串联三个场景
```

## 3. 场景一：缓存用户信息（Cache-Aside）

这是最经典的缓存模式：**先读缓存，未命中再读数据库，回填缓存并设 TTL**。

```python
# db.py — 模拟数据库（真实场景替换为 MySQL 查询）
import time

USERS = {
    1: {"name": "张三", "age": 25, "email": "zhangsan@qq.com"},
    2: {"name": "李四", "age": 30, "email": "lisi@qq.com"},
}

def get_user_from_db(user_id):
    time.sleep(0.05)  # 模拟数据库 50ms 查询延迟
    return USERS.get(user_id)
```

```python
# cache_service.py — Cache-Aside 缓存接口
import json
import redis
from db import get_user_from_db

r = redis.Redis(host="localhost", port=6379, decode_responses=True)
CACHE_TTL = 300  # 缓存 5 分钟

def get_user(user_id):
    key = f"user:{user_id}"

    # 1. 先读缓存
    cached = r.get(key)
    if cached is not None:
        return json.loads(cached)          # 命中，直接返回

    # 2. 未命中，回源数据库
    user = get_user_from_db(user_id)
    if user is None:
        return None

    # 3. 回填缓存，设置过期时间
    r.setex(key, CACHE_TTL, json.dumps(user, ensure_ascii=False))
    return user

def update_user(user_id, name, age, email):
    # 更新数据库后，删除缓存（Cache-Aside 的写路径）
    # 真实场景：先写数据库，再删缓存，避免读到旧数据
    USERS[user_id] = {"name": name, "age": age, "email": email}
    r.delete(f"user:{user_id}")
```

> 关键点：**读** 用「先缓存后库」，**写** 用「先库后删缓存」。顺序不能反——若先删缓存再写库，中间并发读会把旧数据重新写入缓存，造成缓存脏数据。

## 4. 场景二：分布式锁（防止重复扣减）

扣减库存这类「读-改-写」操作在并发下会超卖。用 `SET key value NX PX` 原子加锁，用 Lua 保证「校验 + 释放」的原子性。

```python
# lock.py — 分布式锁
import redis
import uuid

r = redis.Redis(host="localhost", port=6379, decode_responses=True)

class RedisLock:
    def __init__(self, name, expire_ms=10000):
        self.name = f"lock:{name}"
        self.expire_ms = expire_ms
        self.token = uuid.uuid4().hex   # 唯一标识，防止误删别人的锁

    def acquire(self, wait_ms=0):
        # NX：不存在才设置（互斥）；PX：毫秒级过期（防死锁）
        return r.set(self.name, self.token, nx=True, px=self.expire_ms)

    def release(self):
        # Lua 保证「判断锁归属」和「删除锁」两步原子执行
        script = """
        if redis.call("GET", KEYS[1]) == ARGV[1] then
            return redis.call("DEL", KEYS[1])
        else
            return 0
        end
        """
        r.eval(script, 1, self.name, self.token)
```

```python
# 使用示例：扣减库存
STOCK_KEY = "stock:item:100"

def deduct_stock(lock, delta=1):
    if not lock.acquire():
        raise RuntimeError("获取锁失败，请重试")
    try:
        stock = int(r.get(STOCK_KEY) or 0)
        if stock < delta:
            raise RuntimeError("库存不足")
        r.decrby(STOCK_KEY, delta)
    finally:
        lock.release()   # 无论如何都要释放锁
```

> 两个必须记住的点：① 锁一定要带过期时间，否则持锁方崩溃会导致死锁；② 释放锁必须校验「这把锁是不是我加的」，否则会误删别人刚加上的锁——这正是 Lua 脚本的价值所在（见第四卷第 5 章）。

## 5. 场景三：限流器（滑动窗口）

用 ZSet 实现滑动窗口限流：每个请求以当前时间戳作为 score 加入 ZSet，同时删除窗口外的旧记录，再统计窗口内的请求数。

```python
# rate_limiter.py — 基于 ZSet 的滑动窗口限流
import time
import redis

r = redis.Redis(host="localhost", port=6379, decode_responses=True)

def is_allowed(user_id, limit=10, window_sec=60):
    key = f"rate:{user_id}"
    now = time.time()
    window_start = now - window_sec

    # 用 Lua 保证「删旧 + 计数 + 加新」三步原子执行
    script = """
    redis.call("ZREMRANGEBYSCORE", KEYS[1], 0, ARGV[1])
    local count = redis.call("ZCARD", KEYS[1])
    if count < tonumber(ARGV[2]) then
        redis.call("ZADD", KEYS[1], ARGV[3], ARGV[3])
        redis.call("EXPIRE", KEYS[1], ARGV[4])
        return 1
    else
        return 0
    end
    """
    return r.eval(script, 1, key, window_start, limit, now, window_sec)
```

```python
# 使用示例
if is_allowed("user:123", limit=10, window_sec=60):
    print("请求放行")
else:
    print("请求被限流")
```

> 对比固定窗口（`INCR` + TTL）：滑动窗口能平滑过渡边界，避免「窗口交界瞬间双倍放行」的突发问题。但 ZSet 的存储开销高于 String 计数器，高 QPS 场景要权衡精度与内存。

## 6. 串联验证

```python
# main.py — 串联三个场景，本地可直接运行
from cache_service import get_user, update_user
from lock import RedisLock
from rate_limiter import is_allowed
import redis

r = redis.Redis(host="localhost", port=6379, decode_responses=True)

if __name__ == "__main__":
    # 场景一：缓存接口（第一次回源，第二次命中缓存）
    print(get_user(1))      # 回源数据库（50ms），写入缓存
    print(get_user(1))      # 命中缓存（<1ms），直接返回

    # 场景二：分布式锁（初始化库存为 5）
    r.set("stock:item:100", 5)
    lock = RedisLock("item:100")
    lock.acquire()
    r.decrby("stock:item:100", 1)
    lock.release()
    print("剩余库存:", r.get("stock:item:100"))   # 4

    # 场景三：限流（连续请求 11 次，第 11 次被限流）
    results = [is_allowed("user:123", limit=10, window_sec=60) for _ in range(11)]
    print("放行次数:", sum(results))              # 10
```

运行：

```bash
python main.py
```

## 7. 本章小结

| 场景 | 核心命令 | 易错点 |
| :-- | :-- | :-- |
| 缓存接口 | `GET` / `SETEX` / `DEL` | 写路径顺序（先库后删缓存） |
| 分布式锁 | `SET NX PX` / `EVAL` | 必须带过期时间、释放需校验归属 |
| 限流器 | `ZADD` / `ZREMRANGEBYSCORE` / `ZCARD` | 三步操作需 Lua 保证原子 |

三个场景虽小，但覆盖了「缓存、并发、高可用」三大实战主题，是进入生产环境的起点。建议在本地把代码跑通后，再回看第一卷到第四卷对应章节，体会「原理」如何落到「代码」。
