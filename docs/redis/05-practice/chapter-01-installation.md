# 在本机安装 Redis

本页帮助你在本机启动一个 Redis 7.4 实例，并确认客户端可以连接。示例只面向开发环境；生产环境应按照[首次生产部署](./chapter-03-first-production.md)配置网络、认证、持久化和监控。

## 准备环境

- 已安装 Docker，并能执行 `docker` 命令。
- 本机 `6379` 端口未被占用。
- 准备一个足够长的开发密码，不要把真实凭据写入文档或代码仓库。

## 使用 Docker 启动

下面的命令只把 Docker 发布端口绑定到宿主机回环地址，因此外部主机无法通过宿主机的 `6379` 访问：

```bash
docker run -d \
  --name redis-dev \
  -p 127.0.0.1:6379:6379 \
  -v redis-data:/data \
  redis:7.4-alpine \
  redis-server --appendonly yes --requirepass your_password
```

`your_password` 只是占位符。正式使用时应替换为密码，或改用 Redis ACL 创建权限受限的用户。

这里的 `127.0.0.1:6379:6379` 限制的是**宿主机发布地址**，不等于容器内 Redis 只监听 `127.0.0.1`。桥接网络下，容器内 Redis 通常需要监听容器网络可达的地址，Docker 才能把流量转发进来。不要把 Docker 的 `-p` 发布规则与 Redis 自身的 `bind`、`protected-mode` 和防火墙规则混为一谈。

## 保存基础配置

如果把 Redis 作为宿主机进程运行，使用宿主机上的 `redis.conf` 时，开发环境至少应保留以下边界；容器部署应根据容器网络模型单独配置 `bind`：

```conf
# 只监听回环地址
bind 127.0.0.1
port 6379
protected-mode yes

# 开发密码；生产环境优先使用 ACL
requirepass your_password

# 持久化：开发环境也需要保留可恢复的数据
appendonly yes
appendfsync everysec
save 3600 1 300 100 60 10000

# 示例中不使用 rename-command 替代认证或网络访问控制
```

不要把 `bind 0.0.0.0` 与公开端口组合使用。`rename-command` 可以减少误操作，但不能替代防火墙、ACL 或密钥管理。

## 验证安装

```bash
redis-cli -h 127.0.0.1 -p 6379 -a your_password PING
# PONG

redis-cli -h 127.0.0.1 -p 6379 -a your_password INFO server | grep redis_version
# redis_version:7.4.x
```

`redis-cli -a` 会在命令行中留下密码历史。开发时可以改用 `REDISCLI_AUTH` 环境变量或交互式 `AUTH`：

```bash
export REDISCLI_AUTH=your_password
redis-cli -h 127.0.0.1 PING
```

## 连接客户端

```bash
# 命令行
redis-cli -h 127.0.0.1 -p 6379

# Java（Jedis）
JedisPool pool = new JedisPool("127.0.0.1", 6379);

# Python
import redis
r = redis.Redis(host="127.0.0.1", port=6379, password="your_password")
```

客户端连接池应设置连接超时、读取超时和最大连接数，并在应用退出时关闭连接池。
