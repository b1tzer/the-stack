# 安全配置

## 1. 安全特性概述

Elasticsearch 8.x 默认启用安全功能，包括认证、授权、加密通信等。对于符合自动配置条件的首次启动，Elasticsearch 还会自动生成相关认证与 TLS 配置。已有集群、升级和手动配置场景应以实际配置为准。

| 特性 | 说明 |
| :-- | :-- |
| **认证** | 验证用户身份（内置用户、LDAP、AD 等） |
| **授权** | 基于角色的访问控制（RBAC） |
| **TLS/SSL** | 节点间和客户端通信加密 |
| **审计日志** | 记录安全相关事件 |

## 2. 内置用户

```json
// 修改内置用户密码
POST /_security/user/elastic/_password
{
  "password": "new_password"
}

// 查看内置用户
GET /_security/user
```

| 用户 | 说明 |
| :-- | :-- |
| `elastic` | 超级管理员 |
| `kibana_system` | Kibana 专用用户 |
| `logstash_system` | Logstash 专用用户 |
| `apm_system` | APM 专用用户 |

## 3. 创建自定义用户

```json
POST /_security/user/dev_user
{
  "password": "dev_password",
  "roles": ["dev_role"],
  "full_name": "开发用户",
  "email": "dev@example.com"
}
```

## 4. 角色管理

```json
// 创建自定义角色
POST /_security/role/dev_role
{
  "cluster": ["monitor"],
  "indices": [
    {
      "names": ["dev-*"],
      "privileges": ["read", "write", "view_index_metadata"]
    }
  ]
}

// 只读角色
POST /_security/role/readonly_role
{
  "cluster": ["monitor"],
  "indices": [
    {
      "names": ["*"],
      "privileges": ["read", "view_index_metadata"]
    }
  ]
}

// 自定义集群管理角色
POST /_security/role/cluster_admin_role
{
  "cluster": ["all"],
  "indices": [
    {
      "names": ["*"],
      "privileges": ["all"]
    }
  ]
}
```

`cluster: all` 与 `indices: all` 授予广泛的集群和索引操作权限，但这不是内置的 `superuser` 角色。`superuser` 是系统保留角色，无法通过 role API 复制其权限定义。需要完整的超级用户权限时，应直接将内置 `superuser` 分配给用户。

## 5. TLS/SSL 配置

```yaml
# elasticsearch.yml
xpack.security.transport.ssl.enabled: true
xpack.security.transport.ssl.verification_mode: full
xpack.security.transport.ssl.keystore.path: elastic-certificates.p12
xpack.security.transport.ssl.truststore.path: elastic-certificates.p12

xpack.security.http.ssl.enabled: true
xpack.security.http.ssl.keystore.path: http.p12
```

```bash
# 生成证书
./bin/elasticsearch-certutil ca
./bin/elasticsearch-certutil cert --ca elastic-stack-ca.p12
```

`verification_mode` 为 `full` 时校验主机名和证书链，生产环境推荐使用。`certificate` 只校验证书链、不校验目标主机名，会削弱对端身份确认能力。需要密码保护的密钥库或信任库，应通过 `elasticsearch-keystore` 的 secure settings 管理（如 `xpack.security.transport.ssl.keystore.secure_password`），不要写入普通配置文件。上述 certutil 命令只负责生成证书，完整的集群 TLS 部署还需在所有节点统一配置 Transport TLS 并执行完整集群重启。HTTP TLS 示例只配置了服务端证书，客户端还需信任该证书，如将证书导入客户端信任库。

## 6. API Key 认证

```json
// 创建 API Key
POST /_security/api_key
{
  "name": "my-api-key",
  "role_descriptors": {
    "role": {
      "cluster": ["monitor"],
      "indices": [
        { "names": ["my-index"], "privileges": ["read"] }
      ]
    }
  }
}

// 使用 API Key 认证
// curl -H "Authorization: ApiKey <base64_encoded_key>" http://localhost:9200
```

API Key 的有效权限由创建者的权限与其 `role_descriptors` 共同决定，API Key 不会获得创建者本身不具备的权限。

## 7. 审计日志

审计日志需要 Platinum 或 Enterprise 订阅许可。`xpack.security.audit.enabled` 是静态设置，需要在每个节点的 elasticsearch.yml 中配置并重启节点后生效。

```yaml
# elasticsearch.yml
xpack.security.audit.enabled: true
xpack.security.audit.logfile.events.include:
  - access_denied
  - access_granted
  - anonymous_access_denied
  - authentication_failed
  - run_as_denied
  - run_as_granted
```

## 8. 最佳实践

- 生产环境必须启用安全特性
- 使用最小权限原则分配角色
- 定期轮换密码和 API Key
- 启用 TLS 加密节点间通信
- 开启审计日志记录安全事件
- 不要使用 `elastic` 用户进行日常操作
- 为不同应用创建独立的用户和角色
