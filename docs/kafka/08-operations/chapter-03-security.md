# 安全

## 1. 认证 (SASL)

```properties
# SASL/PLAIN
sasl.mechanism.inter.broker.protocol=PLAIN
sasl.enabled.mechanisms=PLAIN

# SASL/SCRAM
sasl.mechanism.inter.broker.protocol=SCRAM-SHA-256
sasl.enabled.mechanisms=SCRAM-SHA-256
```

## 2. 授权 (ACL)

```bash
# 添加 ACL
kafka-acls.sh --add --allow-principal User:alice --operation Read --topic my-topic --bootstrap-server localhost:9092

# 查看 ACL
kafka-acls.sh --list --topic my-topic --bootstrap-server localhost:9092
```

## 3. 加密 (SSL)

```properties
ssl.keystore.location=/path/to/kafka.server.keystore.jks
ssl.keystore.password=***
ssl.truststore.location=/path/to/kafka.server.truststore.jks
ssl.truststore.password=***
```

## 4. 配置示例

```properties
# 安全配置
security.protocol=SASL_SSL
sasl.mechanism=SCRAM-SHA-256
```

## 5. SASL 认证详解

### 5.1 SASL/PLAIN（明文，仅用于测试）
```properties
# Broker 配置
listeners=SASL_PLAINTEXT://:9092
sasl.mechanism.inter.broker.protocol=PLAIN
sasl.enabled.mechanisms=PLAIN

# JAAS 配置：kafka_server_jaas.conf
KafkaServer {
    org.apache.kafka.common.security.plain.PlainLoginModule required
    username="admin"
    password="admin-secret"
    user_admin="admin-secret"
    user_alice="alice-secret";
};
```

### 5.2 SASL/SCRAM（推荐）
```properties
# Broker 配置
listeners=SASL_PLAINTEXT://:9092
sasl.mechanism.inter.broker.protocol=SCRAM-SHA-256
sasl.enabled.mechanisms=SCRAM-SHA-256

# 创建用户
kafka-configs.sh --bootstrap-server localhost:9092 \
    --alter --add-config 'SCRAM-SHA-256=[iterations=8192,password=alice-secret]' \
    --entity-type users --entity-name alice
```

## 6. SSL 加密详解

```bash
# 1. 生成 CA
openssl req -new -x509 -keyout ca-key -out ca-cert -days 365

# 2. 生成 Keystore
keytool -keystore kafka.server.keystore.jks -alias localhost \
    -validity 365 -genkey -keyalg RSA

# 3. 生成 CSR
keytool -keystore kafka.server.keystore.jks -alias localhost \
    -certreq -file kafka-server.csr

# 4. 签名证书
openssl x509 -req -CA ca-cert -CAkey ca-key \
    -in kafka-server.csr -out kafka-server-signed.pem -days 365

# 5. 导入 CA 和签名证书
keytool -keystore kafka.server.keystore.jks -alias CARoot -import -file ca-cert
keytool -keystore kafka.server.keystore.jks -alias localhost \
    -import -file kafka-server-signed.pem

# 6. 生成 Truststore
keytool -keystore kafka.server.truststore.jks -alias CARoot \
    -import -file ca-cert
```

## 7. ACL 配置详解

```bash
# 添加 ACL
kafka-acls.sh --add --allow-principal User:alice \
    --operation Read --operation Write \
    --topic my-topic \
    --bootstrap-server localhost:9092

# 添加消费者组 ACL
kafka-acls.sh --add --allow-principal User:alice \
    --operation Read --group my-group \
    --bootstrap-server localhost:9092

# 删除 ACL
kafka-acls.sh --remove --allow-principal User:alice \
    --operation Read --topic my-topic \
    --bootstrap-server localhost:9092

# 列出所有 ACL
kafka-acls.sh --list --bootstrap-server localhost:9092
```

## 8. 完整安全配置示例

```properties
# Broker 配置
listeners=SASL_SSL://:9093
advertised.listeners=SASL_SSL://broker1:9093
security.inter.broker.protocol=SASL_SSL
sasl.mechanism.inter.broker.protocol=SCRAM-SHA-256
sasl.enabled.mechanisms=SCRAM-SHA-256

ssl.keystore.location=/etc/kafka/ssl/kafka.server.keystore.jks
ssl.keystore.password=***
ssl.truststore.location=/etc/kafka/ssl/kafka.server.truststore.jks
ssl.truststore.password=***
ssl.client.auth=required

# 开启 ACL
authorizer.class.name=kafka.security.authorizer.AclAuthorizer
allow.everyone.if.no.acl.found=false
super.users=User:admin
```

```java
// 客户端配置
Properties props = new Properties();
props.put("bootstrap.servers", "broker1:9093");
props.put("security.protocol", "SASL_SSL");
props.put("sasl.mechanism", "SCRAM-SHA-256");
props.put("sasl.jaas.config", 
    "org.apache.kafka.common.security.scram.ScramLoginModule required " +
    "username=\"alice\" password=\"alice-secret\";");
props.put("ssl.truststore.location", "/etc/kafka/ssl/kafka.client.truststore.jks");
props.put("ssl.truststore.password", "***");
```

## 9. 最佳实践

1. **生产环境使用 SASL_SSL**：同时启用认证和加密，保护数据安全。
2. **使用 SCRAM-SHA-256**：比 PLAIN 更安全，支持动态用户管理。
3. **启用 ACL**：最小权限原则，只授予必要的访问权限。
4. **定期轮换证书**：证书有效期设为 1 年，建立证书轮换流程。
