# Redis 安全与访问控制

本页说明后端应用接入 Redis 时需要建立的网络边界、身份权限、传输保护和凭据轮换流程。内容以 Redis 7.4.11 为基准；TLS 自 Redis 6 起可用，ACL 自 Redis 6 起提供命名用户和细粒度权限。

Redis 默认假设它位于受信任网络，由应用代表最终用户访问。Redis 不是面向公网的数据库服务，认证、ACL 和 TLS 也不能替代网络隔离。权威来源见[Redis 安全说明](https://redis.io/docs/latest/operate/oss_and_stack/management/security/)、[ACL 文档](https://redis.io/docs/latest/operate/oss_and_stack/management/security/acl/)和 [TLS 文档](https://redis.io/docs/latest/operate/oss_and_stack/management/security/encryption/)。

## 1. 划定威胁边界 {#threat-model}

先明确谁能连接、能执行什么、数据经过哪里，以及泄露后的最大影响。

| 边界 | 至少需要回答的问题 |
| :-- | :-- |
| 网络 | 哪些应用、运维和监控网段可以访问数据端口？公网是否完全不可达？ |
| 身份 | 每个服务是否拥有独立账号？默认用户和管理员账号由谁使用？ |
| 权限 | 应用需要哪些命令和 Key 前缀？是否需要管理、脚本或危险命令？ |
| 传输 | Redis 与应用、副本、Sentinel 或 Cluster 节点之间经过哪些不可信网络？ |
| 凭据 | 密码和证书从哪里注入、谁可以读取、多久轮换、如何回滚？ |
| 审计 | 如何发现认证失败、越权命令和配置变更？ |

不接受来自互联网的直接 Redis 连接。应用如果需要接收不可信用户输入，应先验证输入并决定允许的业务操作，再由应用使用受限的 Redis 身份访问。

## 2. 收紧网络边界 {#network}

网络控制按以下顺序建立：

1. 将 Redis 绑定到回环地址或明确的私网接口，不监听未使用的公网地址。
2. 使用防火墙或安全组，只允许应用、副本、Sentinel/Cluster 和受控运维网段访问。
3. 容器和编排平台分别检查 Pod 网络、Service、NetworkPolicy 和节点安全组。
4. 确认代理、跳板机和监控任务也使用独立身份，不共享应用凭据。
5. 对公网暴露需求使用经过评审的代理或托管服务，不直接开放 Redis 端口。

`bind` 控制监听地址，防火墙控制谁能到达端口，两者不能相互替代。`protected-mode` 主要保护“绑定所有接口且没有认证”的默认危险配置；生产环境不能把它当作完整的访问控制。

配置示例：

```conf
bind 127.0.0.1 -::1
protected-mode yes
port 6379
```

容器通常绑定回环地址后会无法从其他 Pod 访问，应绑定明确的容器地址或使用受控网络策略，不能通过关闭保护机制来暴露端口。

## 3. 使用 ACL 实施最小权限 {#acl}

ACL 使用命名用户控制认证、可执行命令和可访问 Key。每个应用使用独立用户，管理任务使用另一用户；不要让所有服务共享 `requirepass` 的单一密码。

以下规则创建一个只能访问 `order:*` 的应用用户。先在管理连接中建立用户结构：

```text
ACL SETUSER order-service off ~order:* +ping +get +set +mget +mset \
  +del +expire +ttl +hget +hset +hdel +hgetall +expireat
ACL SETUSER order-service +select|0
ACL GETUSER order-service
```

密钥管理系统随后为该用户写入 `>generated-secret` 密码规则，再将用户切换为 `on`。不要把真实密码作为命令行参数、脚本常量或文档示例展示。Redis 内部使用 SHA-256 保存 ACL 密码；应使用 `ACL GENPASS` 生成高熵随机值，并通过密钥管理系统注入。

身份生效后先验证允许和禁止的请求。`redis-cli` 使用 `REDISCLI_AUTH` 接收密码，避免密码出现在进程参数中：

```bash
REDISCLI_AUTH="${REDIS_ORDER_PASSWORD}" redis-cli --user order-service ping
REDISCLI_AUTH="${REDIS_ORDER_PASSWORD}" redis-cli --user order-service set order:1001 created
REDISCLI_AUTH="${REDIS_ORDER_PASSWORD}" redis-cli --user order-service del forbidden:1
```

最后一条应返回 `NOPERM`。如果它成功执行，说明 Key 模式或命令规则配置错误，应停止切换。

ACL 设计要点：

- 应用用户只授予确实使用的命令，不使用 `+@all` 或 `~*`，除非有可记录的理由。
- 命令类别便于授权，但要检查类别是否包含超出业务需要的命令。
- Key 模式使用稳定前缀；一个应用访问多个数据域时，分别说明每个前缀的用途。
- `ACL`、`CONFIG`、`SCRIPT`、复制和危险管理命令只授予受控管理员。
- 持续写入的权限使用 `aclfile` 或受版本控制的配置流程保存，避免重启后丢失；`CONFIG REWRITE` 不会自动保存 ACL 文件。
- 切换前保留独立管理连接，最后才停用默认用户；否则一次配置错误可能同时锁死业务和管理员。

`ACL LOG` 记录最近的安全违规，包括认证失败和 `NOPERM`。应对异常来源告警，但注意日志只保存最近事件，不能替代集中审计。

## 4. 启用 TLS 保护传输 {#tls}

数据经过共享网络、跨机房、跨租户或由云代理转发时，应启用 TLS。Redis 6 及以上使用 X.509 证书；以下配置只启用 TLS 端口：

```conf
port 0
tls-port 6379
tls-cert-file /etc/redis/tls/redis.crt
tls-key-file /etc/redis/tls/redis.key
tls-ca-cert-file /etc/redis/tls/ca.crt
tls-auth-clients yes
```

- `tls-cert-file` 和 `tls-key-file` 配置服务端身份。
- `tls-ca-cert-file` 用于验证对端证书。
- `tls-auth-clients yes` 要求客户端证书，适合可控的应用网络；客户端没有证书时不能直接关闭，应先完成威胁评审。
- `port 0` 关闭非 TLS 明文端口。迁移期间可以临时保留两个端口，但必须记录移除时间。

连接测试：

```bash
redis-cli --tls \
  --cacert /etc/redis/tls/ca.crt \
  --cert /etc/redis/tls/client.crt \
  --key /etc/redis/tls/client.key \
  ping
```

主从、Sentinel 和 Cluster 还要分别配置节点间连接。启用复制加密时检查 `tls-replication`，启用集群加密时检查 `tls-cluster`；不同部署形态的默认值和要求不能混用。TLS 会增加握手、加密和解密开销，应复用连接并在故障演练中测量延迟。

## 5. 管理凭据和证书 {#rotation}

密码和私钥不能写入代码仓库、镜像层、命令历史或应用日志。使用环境变量只适合进程启动时注入；更完整的方案由密钥管理系统控制读取权限、版本和轮换时间。

轮换流程应满足：

1. 生成新凭据，记录版本但不记录明文。
2. 在不中断服务的窗口内为应用创建或更新凭据。
3. 逐批重启或刷新客户端连接，确认新连接使用新凭据。
4. 监控认证失败和连接池重建，确认旧凭据已停止使用。
5. 撤销旧凭据，保留一次可执行的回退路径。

TLS 证书同样要提前检查到期时间，分别轮换服务端证书、客户端证书和 CA。轮换前在隔离环境验证完整链路，不要在证书过期后临时关闭证书校验。

## 6. 验证安全配置 {#verify}

上线前执行以下验证，并保存不含密钥的结果：

```bash
redis-cli ACL WHOAMI
redis-cli ACL LIST
redis-cli ACL LOG 20
redis-cli CONFIG GET protected-mode
redis-cli CONFIG GET bind
redis-cli INFO server | grep redis_version
```

还需要从应用网络和非授权网络分别测试：

- 非授权网络无法建立连接。
- 应用身份无法执行未授权命令，也无法读取其他前缀的 Key。
- 管理身份可以在维护窗口完成操作，但不会被应用共享。
- TLS 客户端能校验证书和主机名，关闭证书校验的连接被拒绝。
- 错误日志不包含密码、私钥或完整连接字符串。
- 新凭据轮换后没有持续的 `NOAUTH`、`WRONGPASS` 或 `NOPERM` 告警。

安全配置的验收结果应加入[上线检查清单](./chapter-08-pitfalls.md)。网络、ACL、TLS 和密钥轮换是四个独立控制项，任何一项通过都不能代替其他三项。

## 7. 参考资料

- Redis 官方：[Redis security](https://redis.io/docs/latest/operate/oss_and_stack/management/security/)
- Redis 官方：[Access Control Lists](https://redis.io/docs/latest/operate/oss_and_stack/management/security/acl/)
- Redis 官方：[TLS support](https://redis.io/docs/latest/operate/oss_and_stack/management/security/encryption/)
