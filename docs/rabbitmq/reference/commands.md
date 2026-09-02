# RabbitMQ 命令速查

## rabbitmqctl 管理

```bash
# 集群状态
rabbitmqctl cluster_status

# 节点状态
rabbitmqctl status

# 列出所有连接
rabbitmqctl list_connections

# 列出所有通道
rabbitmqctl list_channels

# 列出所有队列
rabbitmqctl list_queues name messages consumers

# 列出所有交换机
rabbitmqctl list_exchanges

# 列出所有绑定
rabbitmqctl list_bindings
```

## 用户与权限

```bash
# 创建用户
rabbitmqctl add_user myuser mypassword

# 设置管理员标签
rabbitmqctl set_user_tags myuser administrator

# 设置权限（vhost, configure, write, read）
rabbitmqctl set_permissions -p / myuser ".*" ".*" ".*"

# 列出用户
rabbitmqctl list_users

# 删除用户
rabbitmqctl delete_user myuser
```

## 队列操作

```bash
# 清空队列
rabbitmqctl purge_queue my-queue

# 删除队列
rabbitmqctl delete_queue my-queue

# 同步队列（镜像队列）
rabbitmqctl sync_queue my-queue

# 取消同步
rabbitmqctl cancel_sync_queue my-queue
```

## 策略管理

```bash
# 设置策略（高可用）
rabbitmqctl set_policy ha-all "^" '{"ha-mode":"all","ha-sync-mode":"automatic"}'

# 设置策略（TTL + DLX）
rabbitmqctl set_policy dlx ".*" \
  '{"dead-letter-exchange":"dlx-exchange","message-ttl":60000}' \
  --apply-to queues

# 列出策略
rabbitmqctl list_policies

# 删除策略
rabbitmqctl clear_policy ha-all
```

## 插件管理

```bash
# 启用管理插件
rabbitmq-plugins enable rabbitmq_management

# 启用延迟消息插件
rabbitmq-plugins enable rabbitmq_delayed_message_exchange

# 列出插件
rabbitmq-plugins list
```
