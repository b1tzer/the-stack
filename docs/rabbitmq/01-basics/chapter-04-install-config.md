# 安装部署

> RabbitMQ 支持多种部署方式：单节点、集群、Kubernetes。本章覆盖从开发环境到生产环境的完整部署方案。

## 1. Docker 单节点（开发环境）

```bash
docker run -d --name rabbitmq \
  -p 5672:5672 \
  -p 15672:15672 \
  -e RABBITMQ_DEFAULT_USER=admin \
  -e RABBITMQ_DEFAULT_PASS=admin \
  rabbitmq:3-management
```

- 5672：AMQP 协议端口
- 15672：Management UI 端口
- 默认用户 guest 只能 localhost 访问

## 2. Docker Compose 集群

```yaml
version: '3.8'
services:
  rabbitmq1:
    image: rabbitmq:3-management
    hostname: rabbitmq1
    environment:
      RABBITMQ_ERLANG_COOKIE: "SWQOKODSQALRPCLNMEQG"
    volumes:
      - ./rabbitmq.conf:/etc/rabbitmq/rabbitmq.conf
    networks:
      - rabbitmq

  rabbitmq2:
    image: rabbitmq:3-management
    hostname: rabbitmq2
    environment:
      RABBITMQ_ERLANG_COOKIE: "SWQOKODSQALRPCLNMEQG"
    depends_on:
      - rabbitmq1

  rabbitmq3:
    image: rabbitmq:3-management
    hostname: rabbitmq3
    environment:
      RABBITMQ_ERLANG_COOKIE: "SWQOKODSQALRPCLNMEQG"
    depends_on:
      - rabbitmq1
```

## 3. 关键配置

### 3.1 rabbitmq.conf

```ini
# 内存限制（物理内存的 40%）
vm_memory_high_watermark.relative = 0.4

# 磁盘空闲空间阈值
disk_free_limit.absolute = 1GB

# 最大连接数
# channel_max = 2047

# 消费者超时（30 分钟无 ACK 断开）
consumer_timeout = 1800000

# 队列最大长度
# x-max-length 在声明队列时设置
```

### 3.2 环境变量

| 变量 | 说明 | 默认值 |
| :-- | :-- | :-- |
| RABBITMQ_NODE_PORT | AMQP 端口 | 5672 |
| RABBITMQ_DIST_PORT | 集群端口 | 端口+20000 |
| RABBITMQ_DEFAULT_USER | 默认用户 | guest |
| RABBITMQ_DEFAULT_PASS | 默认密码 | guest |
| RABBITMQ_DEFAULT_VHOST | 默认 vhost | / |

## 4. 生产环境建议

| 项目 | 建议 |
| :-- | :-- |
| 内存 | vm_memory_high_watermark 设为 0.4~0.6 |
| 磁盘 | disk_free_limit 至少 1.5 倍内存 |
| 文件描述符 | ulimit -n 至少 65536 |
| TCP 参数 | 调整 tcp_listen_options |
| 日志 | 启用 connection/channel 日志 |
| 监控 | 启用 Prometheus 插件 |
