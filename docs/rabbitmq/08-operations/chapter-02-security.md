# 安全配置

## 1. 用户管理

```bash
# 创建管理员
rabbitmqctl add_user admin strong_password
rabbitmqctl set_user_tags admin administrator

# 创建应用用户
rabbitmqctl add_user appuser app_password

# 设置权限（vhost, configure, write, read）
rabbitmqctl set_permissions -p / appuser ".*" ".*" ".*"

# 限制权限（只能访问特定 Exchange/Queue）
rabbitmqctl set_permissions -p / appuser "^order\\..*" "^order\\..*" "^order\\..*"

# 删除默认 guest
rabbitmqctl delete_user guest
```

## 2. 权限模型

| 权限 | 说明 | 正则 |
| :-- | :-- | :-- |
| configure | 可以创建/删除 Exchange 和 Queue | `^order\\..*` |
| write | 可以发布消息 | `^order\\..*` |
| read | 可以消费消息 | `^order\\..*` |

## 3. TLS 加密

```ini
# rabbitmq.conf
listeners.ssl.default = 5671
ssl_options.cacertfile = /path/to/ca_certificate.pem
ssl_options.certfile = /path/to/server_certificate.pem
ssl_options.keyfile = /path/to/server_key.pem
ssl_options.verify = verify_peer
ssl_options.fail_if_no_peer_cert = true
```

## 4. 网络安全

```ini
# 限制监听地址
listeners.tcp.local = 127.0.0.1:5672

# 禁止 guest 远程登录
loopback_users.guest = true

# 限制 Management UI 访问
management.listener.port = 15672
management.listener.ip = 127.0.0.1
```

## 5. 最佳实践

- 删除默认 guest 用户
- 应用用户使用最小权限原则
- 生产环境启用 TLS
- 限制 Management UI 的访问 IP
- 定期轮换密码
