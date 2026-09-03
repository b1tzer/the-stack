# 安全配置

## 1. 安全特性概述

ES 8.x 默认启用安全特性，包括认证、授权、加密通信等。

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

// 管理员角色
POST /_security/role/admin_role
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

## 5. TLS/SSL 配置

```yaml
# elasticsearch.yml
xpack.security.transport.ssl.enabled: true
xpack.security.transport.ssl.verification_mode: certificate
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

## 7. 审计日志

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
