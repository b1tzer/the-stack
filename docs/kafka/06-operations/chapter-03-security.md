# 安全

> Kafka 安全配置解决三个问题：确认连接方身份（认证）、限制身份能执行的操作（授权）、保护网络传输中的数据（加密）。SASL 负责认证，ACL 负责授权，TLS 负责传输加密。认证成功不代表拥有读写权限，启用 TLS 也不代表客户端已通过身份认证。本文以 Kafka 4.x 的 KRaft 集群为基线，给出可落地的 Broker/客户端配置与常用命令；示例中的密码均为占位符，生产环境请替换并妥善保管。

## 1. 认证（SASL）

SASL 为客户端与 Broker 之间的连接提供身份认证。`PLAIN` 直接传输用户名密码，必须依赖 TLS 加密保护凭证；`SCRAM-SHA-256` / `SCRAM-SHA-512` 通过挑战响应机制验证密码，不直接发送明文密码，但本身不加密消息。生产环境通常用 `SASL_SSL` 组合 SCRAM 与 TLS，本节的 `SASL_PLAINTEXT` 仅用于本地测试。

### 1.1 SASL/PLAIN（仅测试）

```properties
# Broker 配置
listeners=SASL_PLAINTEXT://:9092
sasl.mechanism.inter.broker.protocol=PLAIN
sasl.enabled.mechanisms=PLAIN
```

```properties
# JAAS 配置：kafka_server_jaas.conf
KafkaServer {
    org.apache.kafka.common.security.plain.PlainLoginModule required
    username="admin"
    password="admin-secret"
    user_admin="admin-secret"
    user_alice="alice-secret";
};
```

`PLAIN` 在网络上以明文传口令，不可用于生产。

### 1.2 SASL/SCRAM（推荐）

```properties
# Broker 配置
listeners=SASL_PLAINTEXT://:9092
sasl.mechanism.inter.broker.protocol=SCRAM-SHA-256
sasl.enabled.mechanisms=SCRAM-SHA-256
```

SCRAM 用户凭证存在集群元数据里，用 `kafka-configs.sh` 创建：

```bash
kafka-configs.sh --bootstrap-server localhost:9092 \
    --alter --add-config 'SCRAM-SHA-256=[iterations=8192,password=alice-secret]' \
    --entity-type users --entity-name alice
```

删除用户凭证：

```bash
kafka-configs.sh --bootstrap-server localhost:9092 \
    --alter --delete-config 'SCRAM-SHA-256' \
    --entity-type users --entity-name alice
```

`iterations=8192` 是示例值，应结合安全要求与认证开销选择。本节的监听器是 `SASL_PLAINTEXT`，上面两条命令适用于监听器尚未强制认证的本地测试；集群启用认证后，管理命令要通过安全监听器连接，并用 `--command-config` 提供有权限的管理身份（见第 4 节），否则会认证失败。PLAIN 与 SCRAM 两组配置是互相独立的示例，不能直接合并；要同时启用两种机制，需分别配置对应的 JAAS 登录模块，并都加入 `sasl.enabled.mechanisms`。

客户端 JAAS 示例：

```java
props.put("security.protocol", "SASL_PLAINTEXT");
props.put("sasl.mechanism", "SCRAM-SHA-256");
props.put("sasl.jaas.config",
    "org.apache.kafka.common.security.scram.ScramLoginModule required " +
    "username=\"alice\" password=\"alice-secret\";");
```

Broker 通过 JVM 参数加载 JAAS 文件，`KafkaServer` 是登录上下文名称：

```properties
-Djava.security.auth.login.config=/etc/kafka/kafka_server_jaas.conf
```

## 2. 加密（SSL）

SSL/TLS 保护 Broker 间与客户端-Broker 链路的机密性与完整性。`Keystore` 存本机私钥与证书，`Truststore` 存受信任的 CA 证书。下面用自签 CA 演示服务端证书的签发流程。

```bash
# 1. 生成 CA（显式声明 CA 用途，供后续签发服务端证书）
openssl req -new -x509 -keyout ca-key -out ca-cert -days 365 -nodes \
    -subj "/CN=kafka-ca" \
    -addext "basicConstraints=critical,CA:TRUE" \
    -addext "keyUsage=critical,keyCertSign,cRLSign"

# 2. 生成 Keystore（私钥 + 自签占位证书，SAN 按实际访问地址填写）
keytool -keystore kafka.server.keystore.jks -alias localhost \
    -validity 365 -genkey -keyalg RSA \
    -ext SAN=dns:broker1,dns:localhost,ip:127.0.0.1

# 3. 生成 CSR
keytool -keystore kafka.server.keystore.jks -alias localhost \
    -certreq -file kafka-server.csr

# 4. 准备证书扩展文件（SAN 与第 2 步一致，并声明服务端认证用途）
cat > cert-ext.cnf <<EOF
subjectAltName=DNS:broker1,DNS:localhost,IP:127.0.0.1
extendedKeyUsage=serverAuth
EOF

# 5. 用 CA 签名（把 SAN 与 serverAuth 写入最终证书）
openssl x509 -req -CA ca-cert -CAkey ca-key \
    -in kafka-server.csr -out kafka-server-signed.pem -days 365 \
    -extfile cert-ext.cnf

# 6. 把 CA 与签名证书导入 Keystore
keytool -keystore kafka.server.keystore.jks -alias CARoot -import -file ca-cert
keytool -keystore kafka.server.keystore.jks -alias localhost \
    -import -file kafka-server-signed.pem

# 7. 生成 Truststore（只含 CA）
keytool -keystore kafka.server.truststore.jks -alias CARoot \
    -import -file ca-cert
```

`SAN` 必须匹配客户端实际访问 Broker 时使用的主机名或 IP，否则现代客户端的主机名校验会失败；`serverAuth` 声明证书的服务端认证用途。二者作用不同，都不能省略。客户端同样要配置 Truststore 信任签发服务端证书的 CA（见第 4 节）。第 1 步的 `-nodes` 生成未加密的 CA 私钥，仅适合测试，生产 CA 应加密私钥并妥善保管。

签发后应验证最终证书包含预期扩展、且证书链可被验证：

```bash
# 查看签名证书的扩展与签发者
openssl x509 -in kafka-server-signed.pem -noout -text
# 用 CA 验证证书链
openssl verify -CAfile ca-cert kafka-server-signed.pem
```

Broker 引用 Keystore / Truststore：

```properties
ssl.keystore.location=/etc/kafka/ssl/kafka.server.keystore.jks
ssl.keystore.password=***
ssl.key.password=***
ssl.truststore.location=/etc/kafka/ssl/kafka.server.truststore.jks
ssl.truststore.password=***
```

`ssl.key.password` 是私钥密码；keytool 生成密钥对时私钥密码默认与 Keystore 密码一致，此时可省略该项。若单独设置了私钥密码，则必须配置，否则 Broker 启动或 TLS 初始化会因密码不匹配失败。

## 3. 授权（ACL）

ACL 在认证身份之上控制读写与集群操作权限。先在 Broker 开启 Authorizer，再用 `kafka-acls.sh` 管理规则。

```bash
# 允许 alice 对 my-topic 读写
kafka-acls.sh --add --allow-principal User:alice \
    --operation Read --operation Write \
    --topic my-topic \
    --bootstrap-server localhost:9092

# 允许 alice 作为 my-group 的消费者
kafka-acls.sh --add --allow-principal User:alice \
    --operation Read --group my-group \
    --bootstrap-server localhost:9092

# 删除一条 ACL
kafka-acls.sh --remove --allow-principal User:alice \
    --operation Read --topic my-topic \
    --bootstrap-server localhost:9092

# 查看 Topic 上的 ACL
kafka-acls.sh --list --topic my-topic --bootstrap-server localhost:9092

# 列出集群全部 ACL
kafka-acls.sh --list --bootstrap-server localhost:9092
```

Broker 侧相关配置：

```properties
authorizer.class.name=org.apache.kafka.metadata.authorizer.StandardAuthorizer
# 没有匹配 ACL 时拒绝，而不是放行
allow.everyone.if.no.acl.found=false
super.users=User:admin
```

Kafka 4.x 已移除 ZooKeeper，KRaft 集群使用 `StandardAuthorizer`；`AclAuthorizer` 是 ZooKeeper 模式的旧类，不再适用。`allow.everyone.if.no.acl.found=false` 表示未命中 ACL 即拒绝，避免对未配置 ACL 的资源默认放行；`super.users` 中的主体绕过 ACL 检查，仅保留给必要的运维账号。

权限边界要分清：Topic 的 `Read`/`Write` 只授权该 Topic 的读写，不等于管理集群；消费者通常同时需要 Topic 的 `Read` 与 Consumer Group 的 `Read`，但事务性生产者、幂等生产者、管理操作等场景还可能需要其他资源与操作的授权，不能由上面两条规则推导出来。`--remove` 删除的是与过滤条件匹配的 ACL 条目，不是撤销该主体在所有资源上的全部权限。上面的命令连接的是本地测试的 `SASL_PLAINTEXT` 监听器；生产环境要连接实际安全监听器（如 `broker1:9093`）并带 `--command-config` 提供管理身份。

## 4. 完整配置示例

本文采用的生产配置：`SASL_SSL`（SCRAM 认证 + TLS 加密）并开启 ACL，采用单向 TLS，即仅由服务端证书保护链路，客户端身份交给 SCRAM 认证。

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
ssl.client.auth=none

authorizer.class.name=org.apache.kafka.metadata.authorizer.StandardAuthorizer
allow.everyone.if.no.acl.found=false
super.users=User:admin
```

`ssl.client.auth=none` 表示单向 TLS：客户端验证服务端证书，服务端不要求客户端出示证书。若确实需要双向 TLS，则把该项改为 `required`，并为客户端签发证书、配置客户端 Keystore，同时让 Broker 信任签发客户端证书的 CA。

多 Broker 集群还要为 Broker 间通信准备独立身份：创建 Broker 的 SCRAM 用户，并让每台 Broker 加载对应的 JAAS 登录凭证。

```bash
# 创建 Broker 间认证用户（管理命令同样走安全监听器）
kafka-configs.sh --bootstrap-server broker1:9093 \
    --alter --add-config 'SCRAM-SHA-256=[iterations=8192,password=broker-secret]' \
    --entity-type users --entity-name broker1 \
    --command-config /etc/kafka/admin-client.properties
```

```properties
# Broker 的 KafkaServer JAAS（通过 KAFKA_OPTS 加载）
KafkaServer {
    org.apache.kafka.common.security.scram.ScramLoginModule required
    username="broker1"
    password="broker-secret";
};
```

认证成功只代表 Broker 身份得到验证，不意味着拥有集群内部操作权限。启用 `StandardAuthorizer` 后，Broker 间通信的主体同样需要授权：最简单是把 Broker 主体加入 `super.users`（如 `super.users=User:admin;User:broker1`），或为这些主体显式授予所需的集群级权限，否则可能出现认证通过、但集群内部请求被授权器拒绝的情况。

部署前逐项检查：各 Broker 的 `advertised.listeners` 能被相应客户端访问；证书 `SAN` 与实际连接地址一致；Broker 间认证用户已创建且各节点机制一致；ACL 已覆盖业务 Topic、Consumer Group 与必要的管理操作；客户端与管理命令都通过预期的安全监听器连接。

排查故障时按层定位：TLS 握手失败对应证书或 SAN 问题，SASL 认证失败对应凭证或机制问题，ACL 拒绝访问对应授权问题，三层要分别排查。

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
