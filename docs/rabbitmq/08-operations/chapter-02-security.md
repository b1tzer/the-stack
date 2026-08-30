# 安全配置

> RabbitMQ 安全涉及用户认证、权限控制、TLS 加密和网络隔离。

## 1. 用户管理

```bash
# 添加用户
rabbitmqctl add_user admin strong_password

# 设置用户标签
rabbitmqctl set_user_tags admin administrator

# 删除用户
rabbitmqctl delete_user guest

# 修改密码
rabbitmqctl change_password admin new_password
```

用户标签：

| 标签 | 权限 |
| :-- | :-- |
| (none) | 无管理权限 |
| management | 可登录 Management UI |
| policymaker | 可管理策略 |
| monitoring | 可查看集群状态 |
| administrator | 完全管理权限 |

## 2. 权限控制

```bash
# 设置权限
rabbitmqctl set_permissions -p / admin "^admin\." "^admin\." "^admin\."
```

权限格式：

```text
set_permissions -p <vhost> <user> <conf> <write> <read>
```

| 权限 | 说明 | 正则示例 |
| :-- | :-- | :-- |
| conf | 可配置（声明/删除交换器、队列） | `^order\.` |
| write | 可写入（发布消息） | `^order\.` |
| read | 可读取（消费消息） | `^order\.` |

## 3. VHost 隔离

```bash
# 创建 vhost
rabbitmqctl add_vhost /order

# 设置权限
rabbitmqctl set_permissions -p /order order-service "^order\." "^order\." "^order\."
```

## 4. TLS 加密

### 4.1 生成证书

```bash
# CA 证书
openssl req -x509 -newkey rsa:4096 -keyout ca-key.pem -out ca-cert.pem -days 365 -nodes

# 服务端证书
openssl req -newkey rsa:4096 -keyout server-key.pem -out server-req.pem -nodes
openssl x509 -req -in server-req.pem -CA ca-cert.pem -CAkey ca-key.pem -CAcreateserial -out server-cert.pem -days 365
```

### 4.2 配置 TLS

```ini
# rabbitmq.conf
listeners.ssl.default = 5671
ssl_options.cacertfile = /path/to/ca-cert.pem
ssl_options.certfile = /path/to/server-cert.pem
ssl_options.keyfile = /path/to/server-key.pem
ssl_options.verify = verify_peer
ssl_options.fail_if_no_peer_cert = true
```

## 5. 网络隔离

```bash
# 限制 Management UI 只能从内网访问
management.listener.port = 15672
management.listener.ip = 127.0.0.1
```

## 6. 最佳实践

- 删除默认 guest 用户
- 每个服务使用独立用户
- 最小权限原则
- 生产环境必须启用 TLS
- 使用 vhost 隔离不同业务
- 定期轮换密码和证书
