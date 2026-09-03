# 首次生产部署

## 硬件规划

| 组件 | 建议 |
| :-- | :-- |
| 内存 | ≥ 8G，RabbitMQ 对内存敏感 |
| 磁盘 | SSD，持久化消息写磁盘 |
| CPU | ≥ 4 核 |
| 网络 | 千兆网卡 |

## 必改配置

```ini
# 内存与磁盘
vm_memory_high_watermark.relative = 0.6
disk_free_limit.absolute = 2GB

# 安全
loopback_users.guest = true  # 禁止 guest 远程登录

# 连接
heartbeat = 30
channel_max = 2047
tcp_listen_options.backlog = 1024
tcp_listen_options.nodelay = true

# 集群（每个节点不同）
cluster_formation.peer_discovery_backend = rabbit_peer_discovery_classic_config
cluster_formation.classic_config.nodes.1 = rabbit@node1
cluster_formation.classic_config.nodes.2 = rabbit@node2
cluster_formation.classic_config.nodes.3 = rabbit@node3
```

## 高可用策略

```bash
# 所有队列自动镜像到所有节点
rabbitmqctl set_policy ha-all "^" '{"ha-mode":"all","ha-sync-mode":"automatic"}'

# 或使用 Quorum 队列（推荐）
# 声明队列时指定 x-queue-type: quorum
```

## 用户与权限

```bash
# 创建管理员
rabbitmqctl add_user admin strong_password
rabbitmqctl set_user_tags admin administrator

# 创建应用用户
rabbitmqctl add_user appuser app_password
rabbitmqctl set_permissions -p / appuser "^app\\..*" "^app\\..*" "^app\\..*"

# 删除默认 guest
rabbitmqctl delete_user guest
```

## 监控

| 指标 | 说明 | 告警阈值 |
| :-- | :-- | :-- |
| 队列消息数 | 堆积情况 | 持续增长告警 |
| 消费者数量 | 消费能力 | = 0 时告警 |
| 连接数 | 连接使用 | 接近 max 时告警 |
| 内存使用 | 内存水位 | 接近 80% 告警 |
| 磁盘使用 | 磁盘水位 | 接近 disk_free_limit 告警 |
| 发布速率 | 生产压力 | 基线监控 |
| 确认速率 | 消费进度 | 与发布速率对比 |
