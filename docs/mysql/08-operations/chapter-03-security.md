# 安全

## 1. 权限体系

```sql
-- 创建用户
CREATE USER 'app_user'@'%' IDENTIFIED BY 'secret';

-- 授权
GRANT SELECT, INSERT, UPDATE ON mydb.* TO 'app_user'@'%';
GRANT ALL PRIVILEGES ON mydb.* TO 'admin'@'%';

-- 撤权
REVOKE INSERT ON mydb.* FROM 'app_user'@'%';

-- 刷新权限
FLUSH PRIVILEGES;
```

## 2. SSL

```ini
[mysqld]
ssl-ca = /etc/mysql/ssl/ca.pem
ssl-cert = /etc/mysql/ssl/server-cert.pem
ssl-key = /etc/mysql/ssl/server-key.pem
require_secure_transport = ON
```

## 3. 审计

```sql
-- 安装审计插件
INSTALL PLUGIN audit_log SONAME 'audit_log.so';
```

## 4. 数据加密

```sql
-- 表空间加密
ALTER TABLE users ENCRYPTION='Y';
```

## 5. 密码策略配置

```sql
-- 安装密码验证组件
INSTALL COMPONENT 'file://component_validate_password';

-- 查看密码策略
SHOW VARIABLES LIKE 'validate_password%';
-- validate_password.length: 最小长度（默认 8）
-- validate_password.mixed_case_count: 大小写字母数（默认 1）
-- validate_password.number_count: 数字数（默认 1）
-- validate_password.special_char_count: 特殊字符数（默认 1）
-- validate_password.policy: 策略（LOW/MEDIUM/STRONG）

-- 设置密码策略
SET GLOBAL validate_password.policy = 'MEDIUM';
SET GLOBAL validate_password.length = 12;

-- 密码过期
ALTER USER 'app_user'@'%' PASSWORD EXPIRE INTERVAL 90 DAY;
ALTER USER 'app_user'@'%' PASSWORD EXPIRE NEVER;

-- 密码历史（防止重用）
SET GLOBAL password_history = 5;  -- 不能重用最近 5 个密码

-- 登录失败锁定
SET GLOBAL connection_control_failed_connections_threshold = 5;  -- 5 次失败后锁定
SET GLOBAL connection_control_min_connection_delay = 1800000;   -- 锁定 30 分钟
```

## 6. 连接安全

```sql
-- 限制连接来源
CREATE USER 'app_user'@'192.168.1.%' IDENTIFIED BY 'secret';  -- 只允许内网
CREATE USER 'app_user'@'10.0.0.%' IDENTIFIED BY 'secret';     -- 只允许指定网段

-- 禁止 root 远程登录
DELETE FROM mysql.user WHERE User = 'root' AND Host NOT IN ('localhost', '127.0.0.1', '::1');
FLUSH PRIVILEGES;

-- 最大连接数限制
ALTER USER 'app_user'@'%' WITH MAX_USER_CONNECTIONS 50;
ALTER USER 'app_user'@'%' WITH MAX_CONNECTIONS_PER_HOUR 1000;
```

## 7. SQL 注入防护

```java
// ❌ 危险：字符串拼接
String sql = "SELECT * FROM users WHERE name = '" + name + "'";

// ✅ 安全：使用预编译语句
String sql = "SELECT * FROM users WHERE name = ?";
PreparedStatement ps = conn.prepareStatement(sql);
ps.setString(1, name);

// MyBatis 中使用 #{} 而不是 ${}
// ✅ 安全
SELECT * FROM users WHERE name = #{name}
// ❌ 危险
SELECT * FROM users WHERE name = '${name}'
```

## 8. 数据脱敏

```sql
-- 创建脱敏视图
CREATE VIEW users_masked AS
SELECT
    id,
    CONCAT(LEFT(username, 1), '**') AS username,
    CONCAT(LEFT(email, 3), '***@', SUBSTRING_INDEX(email, '@', -1)) AS email,
    CONCAT(LEFT(phone, 3), '****', RIGHT(phone, 4)) AS phone
FROM users;

-- 使用动态数据脱敏（MySQL Enterprise Edition）
-- 或应用层实现
```

## 9. 审计日志

```sql
-- MySQL Enterprise Audit
INSTALL PLUGIN audit_log SONAME 'audit_log.so';

-- 开源替代：MariaDB Audit Plugin
INSTALL PLUGIN server_audit SONAME 'server_audit.so';
SET GLOBAL server_audit_logging = ON;
SET GLOBAL server_audit_events = 'CONNECT,QUERY_DDL,QUERY_DML';
SET GLOBAL server_audit_file_rotate_size = 104857600;  -- 100MB
SET GLOBAL server_audit_file_rotations = 10;
```

## 10. 最佳实践

1. **最小权限原则** — 只授予必要的权限
2. **禁止 root 远程登录** — 只允许本地连接
3. **使用 SSL 加密连接** — 防止中间人攻击
4. **密码策略必须开启** — 复杂度 + 过期 + 历史
5. **定期审计用户权限** — 清理无用账号和权限
6. **SQL 注入防护** — 预编译语句 + ORM 框架
7. **敏感数据脱敏** — 生产数据不暴露给非授权人员
8. **开启审计日志** — 满足合规要求

