# 安装部署与环境配置

## Docker 快速启动

```bash
docker run -d \
  --name redis \
  -p 6379:6379 \
  -v /data/redis:/data \
  redis:7-alpine \
  redis-server --appendonly yes --requirepass your_password
```

## 配置文件要点

```conf
# redis.conf
bind 0.0.0.0
port 6379
requirepass your_password
protected-mode yes

# 内存
maxmemory 4gb
maxmemory-policy allkeys-lru

# 持久化
appendonly yes
appendfsync everysec
save 3600 1 300 100 60 10000

# 安全
rename-command FLUSHALL ""
rename-command FLUSHDB ""
rename-command CONFIG ""
```

## 验证安装

```bash
redis-cli -a your_password PING
# 返回 PONG

redis-cli -a your_password INFO server | grep redis_version
```

## 客户端连接

```bash
# 命令行
redis-cli -h host -p 6379 -a password

# Java (Jedis)
JedisPool pool = new JedisPool("host", 6379);

# Python
import redis
r = redis.Redis(host='host', port=6379, password='password')
```
