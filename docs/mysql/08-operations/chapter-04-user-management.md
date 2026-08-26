# 用户管理

## 1. 角色 (8.0+)

```sql
-- 创建角色
CREATE ROLE 'app_read', 'app_write';

-- 授权角色
GRANT SELECT ON mydb.* TO 'app_read';
GRANT INSERT, UPDATE, DELETE ON mydb.* TO 'app_write';

-- 分配角色
GRANT 'app_read', 'app_write' TO 'app_user'@'%';
SET DEFAULT ROLE ALL TO 'app_user'@'%';
```

## 2. 权限查看

```sql
-- 查看用户权限
SHOW GRANTS FOR 'app_user'@'%';

-- 查看角色
SELECT * FROM mysql.role_edges;
```

## 3. 密码策略

```sql
-- 密码过期
ALTER USER 'app_user'@'%' PASSWORD EXPIRE INTERVAL 90 DAY;

-- 密码复杂度
SET GLOBAL validate_password.length = 8;
SET GLOBAL validate_password.mixed_case_count = 1;
```

## 4. 用户生命周期管理

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

-- 当前用户修改密码
ALTER USER USER() IDENTIFIED BY 'NewP@ss456';
```

## 5. 权限体系详解

```sql
-- 权限层级：全局 → 数据库 → 表 → 列 → 存储过程

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

-- 查看所有权限
SHOW GRANTS FOR 'app_user'@'%';

-- 查看全局权限
SELECT * FROM mysql.user WHERE User = 'app_user';

-- 查看数据库权限
SELECT * FROM mysql.db WHERE User = 'app_user';

-- 查看表权限
SELECT * FROM mysql.tables_priv WHERE User = 'app_user';
```

## 6. 安全最佳实践模板

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

## 7. 用户审计

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

## 8. 最佳实践

1. **不同环境使用不同账号** — 开发、测试、生产分离
2. **最小权限原则** — 只授予必要的权限
3. **定期审计用户和权限** — 清理无用账号
4. **使用角色简化管理** — MySQL 8.0+ 角色功能
5. **限制连接来源 IP** — 不要使用 '%' 通配符
6. **密码策略强制执行** — 复杂度 + 过期 + 历史
7. **禁止共享账号** — 每个应用/人员使用独立账号

