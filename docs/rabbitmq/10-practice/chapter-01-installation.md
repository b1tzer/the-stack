# 安装部署与环境配置

## Docker 快速启动

```bash
docker run -d \
  --name rabbitmq \
  -p 5672:5672 \
  -p 15672:15672 \
  -e RABBITMQ_DEFAULT_USER=admin \
  -e RABBITMQ_DEFAULT_PASS=admin123 \
  -v /data/rabbitmq:/var/lib/rabbitmq \
  rabbitmq:3-management
```

管理界面：`http://localhost:15672`

## 配置文件（rabbitmq.conf）

```ini
# 监听
listeners.tcp.default = 5672
management.listener.port = 15672

# 内存与磁盘
vm_memory_high_watermark.relative = 0.6
disk_free_limit.absolute = 1GB

# 连接
heartbeat = 60
channel_max = 2047

# 日志
log.file.level = info
log.file.rotation.date = $D0
log.file.rotation.size = 104857600
```

## 验证安装

```bash
# 检查状态
rabbitmqctl status

# 检查集群
rabbitmqctl cluster_status

# 测试连接
rabbitmqadmin -u admin -p admin123 list queues
```

## 启用管理插件

```bash
rabbitmq-plugins enable rabbitmq_management
```

## 延迟消息插件

```bash
# 下载插件
wget https://github.com/rabbitmq/rabbitmq-delayed-message-exchange/releases/download/v3.13.0/rabbitmq_delayed_message_exchange-3.13.0.ez

# 放入插件目录
cp rabbitmq_delayed_message_exchange-3.13.0.ez /opt/rabbitmq/plugins/

# 启用
rabbitmq-plugins enable rabbitmq_delayed_message_exchange
```
