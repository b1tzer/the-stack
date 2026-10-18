# 安装部署

> RabbitMQ 支持多种部署方式：单节点、集群、Kubernetes。本章覆盖 Docker 单节点与 Compose 集群部署及关键配置，Kubernetes 部署不在本章展开。

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

该示例仅适用于临时开发环境，注意三点：

- 未挂载数据卷，容器删除后数据随之丢失。需要保留数据时挂载持久化卷（如 `-v rabbitmq_data:/var/lib/rabbitmq`），并设置稳定的节点名（如 `--hostname rabbitmq`）以保持节点身份一致；数据卷不能替代备份。
- `rabbitmq:3-management` 是浮动的大版本标签，重建时不一定得到相同小版本。需要可复现部署时锁定具体版本。
- `admin/admin` 凭据仅限本地开发，生产环境应使用独立凭据并配置权限。

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
    volumes:
      - ./rabbitmq.conf:/etc/rabbitmq/rabbitmq.conf
    networks:
      - rabbitmq

  rabbitmq3:
    image: rabbitmq:3-management
    hostname: rabbitmq3
    environment:
      RABBITMQ_ERLANG_COOKIE: "SWQOKODSQALRPCLNMEQG"
    volumes:
      - ./rabbitmq.conf:/etc/rabbitmq/rabbitmq.conf
    networks:
      - rabbitmq

networks:
  rabbitmq:
    driver: bridge
```

容器启动不等于集群已经形成。该示例是本地实验方案，不是生产集群部署模板，注意以下几点：

- `./rabbitmq.conf` 必须预先在宿主机创建且内容有效，否则挂载或启动会失败；三节点挂载同一份配置，保证参数一致。
- 三个节点使用浮动标签 `rabbitmq:3-management`，重建前建议锁定具体版本，保证节点版本兼容。
- 相同的 `RABBITMQ_ERLANG_COOKIE` 只是集群认证所需的共享密钥，节点不会自动加入集群。
- 节点名 `rabbit@rabbitmq1` 依赖默认短节点名规则；若启用长节点名或修改节点名，加入命令需相应调整。

先确认各节点已启动完成，再手动让 rabbitmq2、rabbitmq3 加入 rabbitmq1：

```bash
# 在 rabbitmq2 上执行；reset 会清空节点本地数据，仅适用于全新或可清空的节点
docker exec rabbitmq2 rabbitmqctl stop_app
docker exec rabbitmq2 rabbitmqctl reset
docker exec rabbitmq2 rabbitmqctl join_cluster rabbit@rabbitmq1
docker exec rabbitmq2 rabbitmqctl start_app

# rabbitmq3 同理，将 rabbitmq2 替换为 rabbitmq3
```

验证集群状态：

```bash
docker exec rabbitmq1 rabbitmqctl cluster_status
```

生产部署应优先考虑自动节点发现机制，手动 `join_cluster` 更适合开发、测试和恢复场景。

## 3. 关键配置

### 3.1 rabbitmq.conf

```ini
# 相对内存水位，按 RabbitMQ 识别到的可用内存计算
# 容器环境应确认当前版本能否正确识别 cgroup 内存限制，必要时改用绝对值
vm_memory_high_watermark.relative = 0.4

# 磁盘空闲空间保护阈值；触发磁盘告警时可能阻塞发布端
disk_free_limit.absolute = 1GB

# 单个连接可用的 channel 数量上限（不是节点最大连接数）
# channel_max = 2047

# 消费者确认超时（毫秒）：限制消费者确认已投递消息的等待时间
# 超时后通常关闭相应 channel，该 channel 上未确认的投递会重新入队，之后可能再次投递
consumer_timeout = 1800000

# 队列最大长度
# x-max-length 在声明队列时设置
```

### 3.2 环境变量

| 变量 | 说明 | 默认值 |
| :-- | :-- | :-- |
| RABBITMQ_NODE_PORT | AMQP 客户端连接端口 | 5672 |
| RABBITMQ_DIST_PORT | 节点间分布式通信端口（非 AMQP 客户端端口） | AMQP 端口 + 20000 |
| RABBITMQ_DEFAULT_USER | 默认用户 | guest |
| RABBITMQ_DEFAULT_PASS | 默认密码 | guest |
| RABBITMQ_DEFAULT_VHOST | 默认 vhost | / |

`RABBITMQ_DIST_PORT` 服务于 Erlang 节点间通信及 `rabbitmqctl` 等 CLI 工具，与 AMQP 客户端端口是两个概念；`端口+20000` 是默认端口规划。若在 `rabbitmq.conf` 中设置了 `distribution.listener.port_range.min` 或 `distribution.listener.port_range.max`，该环境变量会被忽略。

`RABBITMQ_DEFAULT_USER`、`RABBITMQ_DEFAULT_PASS`、`RABBITMQ_DEFAULT_VHOST` 仅在节点首次启动（数据目录为空）时生效。修改后重启已有节点不会更新既有凭据，需通过 `rabbitmqctl` 等用户管理机制修改。

## 4. 生产环境建议

| 项目 | 建议 |
| :-- | :-- |
| 内存 | vm_memory_high_watermark 按可用内存与负载设置，0.4~0.6 是常见选择范围，不同版本默认值有差异（3.x 默认 0.4，4.x 默认 0.6） |
| 磁盘 | disk_free_limit 结合可用磁盘容量、预期积压量与恢复空间设置，触发后可能阻塞发布端 |
| 文件描述符 | ulimit -n 按连接规模评估，65536 是经验起点而非硬性要求 |
| TCP 参数 | 按连接问题排查结果调整 tcp_listen_options，不默认统一修改 |
| 日志 | 排查连接或 channel 异常时启用对应日志 |
| 监控 | 启用 Prometheus 插件 |

> 表中数值均需结合容器内存限制、连接规模与消息负载实测确定。
