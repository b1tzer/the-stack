# 安全配置

> RabbitMQ 的安全配置涉及资源隔离、访问授权、身份认证和网络传输保护。vhost 划分资源空间，用户权限限制可执行的操作，认证机制验证客户端身份，TLS 保护连接并提供证书验证能力。本章分别说明这些配置的作用、边界和常见误区。

## 1. 第一层 vhost 隔离

vhost 是 RabbitMQ 的逻辑资源隔离单位。每个 vhost 有独立的 exchange、queue、binding 和资源权限，同名资源在不同 vhost 中属于不同对象。用户只有获得目标 vhost 的访问权限，才能在其中操作资源。

它的价值不在「多一套命名空间」，而在故障隔离。两个业务共用一个 `/` vhost 时，一个业务误删 exchange 会连累另一个业务，一个业务的队列堆积会增加整个 vhost 监控指标的归属和分析难度。按业务或环境拆 vhost（`/order`、`/payment`、`/test`），把互不相关的流量隔开。

但 vhost 不提供物理隔离。不同 vhost 仍可能争用同一节点的 CPU、内存、磁盘和网络资源，应用也可以同时连接多个 vhost 再转发消息。RabbitMQ 支持对单个 vhost 配置部分资源限制，但这与物理隔离是两回事，业务需要独立资源容量或故障域时应评估独立集群。

```bash
rabbitmqctl add_vhost /order
rabbitmqctl set_permissions -p /order orderapp ".*" ".*" ".*"
```

创建 vhost 后必须单独授权，用户不会自动获得新 vhost 的权限。漏掉这一步，客户端表现为 `access refused`。

## 2. 第二层 用户与权限

vhost 决定用户可以进入哪些资源空间，资源权限决定用户进入后能对哪些队列和交换机执行什么操作。两层授权分别检查，获得 vhost 访问权限不等于自动获得其中所有资源的操作权限。

每个 vhost 内，权限进一步拆成三项。权限检查针对具体协议操作及其涉及的资源，不是简单地按「创建、发送、接收」三类业务动作划分。

| 权限 | 主要控制的操作 |
| :-- | :-- |
| configure | 创建、删除队列或交换机，以及修改资源定义或行为；具体操作所需权限取决于协议操作 |
| write | 向资源写入消息，部分绑定操作检查目标资源的 write 权限 |
| read | 从资源读取消息，部分绑定操作检查源资源的 read 权限 |

以 AMQP 0-9-1 的 `queue.bind` 为例，RabbitMQ 检查目标队列的 write 权限和源 exchange 的 read 权限，而不是 configure 权限。

三项权限独立，一个用户可以只有 write 没有 read，也就是只能发不能收，这是常见的最小权限配置。

```bash
rabbitmqctl add_user appuser app_password
rabbitmqctl set_permissions -p / appuser "^order\..*" "^order\..*" "^order\..*"
```

这个示例只是按 `order.` 命名约定演示，三个正则相同会让该用户对匹配范围内的资源同时拥有三类权限，不是所有应用账号都应照抄的模板。只发布不消费的账号应当收紧 configure 和 read，只放开 write。

## 3. 权限正则的坑

权限用正则匹配资源名，三个正则分别作用于 configure、write、read。RabbitMQ 使用正则表达式匹配资源名，不会自动在表达式两端添加 `^` 和 `$`。正则没有锚点时，可以匹配资源名中的一部分；要限定资源名的开头、结尾或完整内容，应显式添加锚点。坑在下面三处。

坑一。`.` 没转义。正则里的 `.` 匹配任意字符。想匹配 `order.` 开头的资源，应写 `^order\..*`；若写成 `^order..*`（第二个点未转义），则 `orderXqueue` 也会被匹配，因为 `.` 匹配了 `X` 而不是字面点，权限范围比预期大。

坑二。`.*` 过于宽。`^order\..*` 只要求资源名以 `order.` 开头，不限定后续层级，所以 `order.admin.secret` 也会匹配。如果敏感资源也用了 `order.` 前缀命名，普通应用账号可能获得超出预期的访问权限。应根据资源用途划分命名空间，为不同应用配置各自的权限正则，不能只依赖共享前缀做权限隔离。

坑三。空权限。三个正则里任何一个写成 `""` 空串，等价于 `^$`，只匹配空字符串。常见的队列和交换机名都不是空字符串，所以它实际上关闭了该用户在这项权限上的能力。这不是 bug，是有意的收紧手段，但排查权限问题时容易被当成无效配置。

## 4. 第三层 认证机制选型

RabbitMQ 的认证机制和认证后端要分开理解。认证机制决定客户端以什么方式提交身份凭据，认证后端负责验证身份并参与授权决策。EXTERNAL 是一种 SASL 认证机制，LDAP 是认证与授权后端，两者不是同一层级的选项。

PLAIN 就是用户名密码，默认启用的常用机制。使用默认内部后端时，凭据由 RabbitMQ 管理，也可以配置 LDAP、HTTP 等外部后端。生产环境应使用独立账号、强凭据和轮换机制，并通过 TLS 保护传输。

EXTERNAL 常用于基于 TLS 客户端证书的认证，需要启用相应插件并配置客户端使用 EXTERNAL 机制。证书校验成功不等于已经完成 RabbitMQ 用户身份映射和授权。

OAuth 2.0 / JWT 通过 access token 认证和授权，适合已有身份提供方和 token 签发机制的环境，但要额外配置插件、签名验证和授权规则。

选型看现有基础设施和要解决的身份管理问题，不是越安全越好。已有统一 LDAP 可以用它做认证后端；微服务已有 token 体系可以评估 OAuth 2.0，但要先确认身份提供方、客户端支持和授权规则是否就绪。PLAIN 配合 TLS、强凭据和轮换机制同样能用于生产，并非只是没有其他基础设施时的临时方案。证书认证需要管理签发、分发、续期、撤销和故障恢复，没有自动续期和到期告警时，证书过期可能导致客户端连接失败或集中断连。

## 5. TLS 加密传输

下面是 RabbitMQ 服务端要求客户端出示证书的 mTLS 配置片段。

```ini
listeners.ssl.default = 5671
ssl_options.cacertfile = /path/to/ca_certificate.pem
ssl_options.certfile = /path/to/server_certificate.pem
ssl_options.keyfile = /path/to/server_key.pem
ssl_options.verify = verify_peer
ssl_options.fail_if_no_peer_cert = true
```

`verify_peer` 要求 RabbitMQ 校验客户端证书，`fail_if_no_peer_cert = true` 要求客户端必须提供证书。两者配合让 RabbitMQ 验证客户端证书，并拒绝不提供证书的客户端。严格来说，完整的双向 TLS（mTLS）还要求客户端验证服务器证书，服务端单侧配置不构成完整的 mTLS，也不等于已启用 EXTERNAL 用户认证。要直接用客户端证书作为 RabbitMQ 身份凭据，还需要启用认证插件、配置 EXTERNAL 机制，并完成证书身份到 RabbitMQ 用户的映射。

如果只需要加密传输、不要求客户端出示证书，把 `verify` 设为 `verify_none`，并去掉 `fail_if_no_peer_cert = true`，两个选项要一起调整，不能只改一个。此时连接已加密，但 RabbitMQ 不验证客户端身份，客户端仍需通过其他方式认证。生产环境还要确保客户端验证服务器证书及主机名，否则只加密却无法确认连接的服务器身份。

## 6. 网络安全

```ini
listeners.tcp.local = 127.0.0.1:5672
loopback_users.guest = true
management.tcp.port = 15672
management.tcp.ip = 127.0.0.1
```

Management 插件默认使用 15672 端口提供 HTTP 管理接口，默认监听所有可用网络接口，不能当作访问控制措施。上面的 `management.tcp.ip = 127.0.0.1` 是显式配置，把监听地址限制到本机。生产环境还应配合防火墙、安全组或受控反向代理限制访问来源，需要远程管理时通过 VPN 或受控代理入口访问，不把管理界面不加限制地暴露到公网。

`loopback_users.guest = true` 是默认行为，guest 只能从本机回环接口连接，它只是额外保护，不能代替删除默认账号。生产环境应优先删除 guest，并为应用创建独立凭据。

## 7. 检查清单

- 按业务拆 vhost，别让所有流量挤在 `/`
- 应用用户最小权限，能只 write 就不给 read
- 核对 configure、write、read 三个正则是否符合实际资源命名，确认应用不具备不必要的拓扑管理权限
- 删掉默认 guest，或至少确认 `loopback_users.guest` 生效
- 生产启用 TLS，明确只要加密还是要加密加验证客户端
- 确认生产客户端会验证服务器证书及主机名；采用客户端证书认证时，还要验证证书身份映射和续期流程
- 限制管理接口的网络可达范围
- 密码有轮换机制
