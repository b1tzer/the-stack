# 安全与用户管理

## 1. 权限体系

MySQL 的权限按层级划分：全局 → 数据库 → 表 → 列 → 存储过程，逐层收窄。授权用 `GRANT`，撤权用 `REVOKE`。

```sql
-- 创建用户
CREATE USER 'app_user'@'%' IDENTIFIED BY 'secret';

-- 全局权限
GRANT ALL PRIVILEGES ON *.* TO 'admin'@'%';

-- 数据库权限
GRANT SELECT, INSERT, UPDATE, DELETE ON mydb.* TO 'app_user'@'%';

-- 表权限
GRANT SELECT, INSERT ON mydb.users TO 'readonly_user'@'%';

-- 列权限
GRANT SELECT (id, name, email) ON mydb.users TO 'limited_user'@'%';

-- 存储过程权限
GRANT EXECUTE ON PROCEDURE mydb.my_proc TO 'app_user'@'%';

-- 撤权
REVOKE INSERT ON mydb.* FROM 'app_user'@'%';

-- 刷新权限
FLUSH PRIVILEGES;
```

查看权限分布：

```sql
-- 查看某用户的所有权限
SHOW GRANTS FOR 'app_user'@'%';

-- 查看全局权限
SELECT * FROM mysql.user WHERE User = 'app_user';

-- 查看数据库权限
SELECT * FROM mysql.db WHERE User = 'app_user';

-- 查看表权限
SELECT * FROM mysql.tables_priv WHERE User = 'app_user';
```

## 2. 角色 (8.0+)

角色把一组权限打包，再赋给用户，避免逐个用户重复授权：

```sql
-- 创建角色
CREATE ROLE 'app_read', 'app_write';

-- 授权角色
GRANT SELECT ON mydb.* TO 'app_read';
GRANT INSERT, UPDATE, DELETE ON mydb.* TO 'app_write';

-- 分配角色
GRANT 'app_read', 'app_write' TO 'app_user'@'%';
SET DEFAULT ROLE ALL TO 'app_user'@'%';

-- 查看角色
SELECT * FROM mysql.role_edges;
```

## 3. 用户生命周期管理

```sql
-- 创建用户（带完整选项）
CREATE USER 'app_user'@'%'
    IDENTIFIED BY 'StrongP@ss123'
    PASSWORD EXPIRE INTERVAL 90 DAY
    FAILED_LOGIN_ATTEMPTS 5
    PASSWORD_LOCK_TIME 2
    MAX_USER_CONNECTIONS 50
    MAX_CONNECTIONS_PER_HOUR 1000;

-- 锁定/解锁用户
ALTER USER 'app_user'@'%' ACCOUNT LOCK;
ALTER USER 'app_user'@'%' ACCOUNT UNLOCK;

-- 重命名用户
RENAME USER 'old_name'@'%' TO 'new_name'@'%';

-- 删除用户
DROP USER 'app_user'@'%';

-- 修改密码
ALTER USER 'app_user'@'%' IDENTIFIED BY 'NewP@ss456';
ALTER USER USER() IDENTIFIED BY 'NewP@ss456';  -- 当前用户
```

## 4. 密码策略

密码策略靠 `validate_password` 组件强制复杂度，并可叠加过期、历史、失败锁定：

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
SET GLOBAL password_history = 5;

-- 登录失败锁定
SET GLOBAL connection_control_failed_connections_threshold = 5;
SET GLOBAL connection_control_min_connection_delay = 1800000;   -- 锁定 30 分钟
```

## 5. 连接安全

```sql
-- 限制连接来源
CREATE USER 'app_user'@'192.168.1.%' IDENTIFIED BY 'secret';  -- 只允许内网
CREATE USER 'app_user'@'10.0.0.%' IDENTIFIED BY 'secret';     -- 只允许指定网段

-- 禁止 root 远程登录
DELETE FROM mysql.user WHERE User = 'root' AND Host NOT IN ('localhost', '127.0.0.1', '::1');
FLUSH PRIVILEGES;

-- 限制用户连接数
ALTER USER 'app_user'@'%' WITH MAX_USER_CONNECTIONS 50;
ALTER USER 'app_user'@'%' WITH MAX_CONNECTIONS_PER_HOUR 1000;
```

## 6. SSL

```ini
[mysqld]
ssl-ca = /etc/mysql/ssl/ca.pem
ssl-cert = /etc/mysql/ssl/server-cert.pem
ssl-key = /etc/mysql/ssl/server-key.pem
require_secure_transport = ON
```

## 7. 数据加密

```sql
-- 表空间加密
ALTER TABLE users ENCRYPTION='Y';
```

## 8. SQL 注入防护

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

## 9. 数据脱敏

```sql
-- 创建脱敏视图
CREATE VIEW users_masked AS
SELECT
    id,
    CONCAT(LEFT(username, 1), '**') AS username,
    CONCAT(LEFT(email, 3), '***@', SUBSTRING_INDEX(email, '@', -1)) AS email,
    CONCAT(LEFT(phone, 3), '****', RIGHT(phone, 4)) AS phone
FROM users;

-- 动态数据脱敏（MySQL Enterprise Edition）或应用层实现
```

## 10. 审计日志

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

## 11. 安全最佳实践模板

```sql
-- 应用账号模板
CREATE USER 'app_readonly'@'192.168.1.%' IDENTIFIED BY 'StrongP@ss1';
CREATE USER 'app_readwrite'@'192.168.1.%' IDENTIFIED BY 'StrongP@ss2';
CREATE USER 'app_admin'@'192.168.1.%' IDENTIFIED BY 'StrongP@ss3';

-- 只读账号
GRANT SELECT ON mydb.* TO 'app_readonly'@'192.168.1.%';

-- 读写账号
GRANT SELECT, INSERT, UPDATE, DELETE ON mydb.* TO 'app_readwrite'@'192.168.1.%';

-- 管理账号（不含 SUPER 和 GRANT）
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, DROP, ALTER, INDEX,
    CREATE TEMPORARY TABLES, LOCK TABLES, EXECUTE, CREATE VIEW, SHOW VIEW
ON mydb.* TO 'app_admin'@'192.168.1.%';

-- 密码过期策略
ALTER USER 'app_readonly'@'192.168.1.%' PASSWORD EXPIRE INTERVAL 90 DAY;
ALTER USER 'app_readwrite'@'192.168.1.%' PASSWORD EXPIRE INTERVAL 90 DAY;
ALTER USER 'app_admin'@'192.168.1.%' PASSWORD EXPIRE INTERVAL 60 DAY;

FLUSH PRIVILEGES;
```

## 12. 用户审计

```sql
-- 查看所有用户
SELECT User, Host, account_locked, password_expired
FROM mysql.user ORDER BY User;

-- 查看长时间未使用的用户
SELECT User, Host FROM mysql.user
WHERE User NOT IN (
    SELECT DISTINCT USER FROM performance_schema.events_statements_summary_by_user_by_event_name
);

-- 查看权限过大的用户
SELECT User, Host FROM mysql.user
WHERE Super_priv = 'Y' OR Grant_priv = 'Y'
AND User NOT IN ('root', 'mysql.sys');

-- 查看空密码用户
SELECT User, Host FROM mysql.user WHERE authentication_string = '';
```

## 13. 最佳实践

1. **最小权限原则** — 只授予必要的权限
2. **不同环境使用不同账号** — 开发、测试、生产分离
3. **禁止 root 远程登录** — 只允许本地连接
4. **禁止共享账号** — 每个应用/人员使用独立账号
5. **使用 SSL 加密连接** — 防止中间人攻击
6. **密码策略必须开启** — 复杂度 + 过期 + 历史 + 失败锁定
7. **SQL 注入防护** — 预编译语句 + ORM 框架
8. **敏感数据脱敏** — 生产数据不暴露给非授权人员
9. **开启审计日志** — 满足合规要求
10. **定期审计用户和权限** — 清理无用账号，使用角色简化管理

