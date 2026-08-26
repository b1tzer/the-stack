# SQL 基础与数据类型

## 1. DDL

```sql
CREATE TABLE users (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(50) NOT NULL UNIQUE,
    email VARCHAR(100),
    age INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

## 2. 数据类型

### 2.1 数值
| 类型 | 存储 | 范围 |
|------|------|------|
| TINYINT | 1字节 | -128~127 |
| INT | 4字节 | -21亿~21亿 |
| BIGINT | 8字节 | 极大 |
| DECIMAL(m,d) | 可变 | 精确小数 |

### 2.2 字符串
| 类型 | 说明 |
|------|------|
| VARCHAR(n) | 可变长度，最大 65535 |
| CHAR(n) | 固定长度 |
| TEXT | 大文本 |

### 2.3 日期时间
| 类型 | 说明 |
|------|------|
| DATETIME | 日期时间，无时区 |
| TIMESTAMP | 时间戳，自动转换时区 |
| DATE | 仅日期 |

## 3. DML 操作

```sql
-- INSERT
INSERT INTO users (username, email, age) VALUES ('张三', 'zhangsan@example.com', 25);
INSERT INTO users (username, email, age) VALUES ('李四', 'lisi@example.com', 30),
    ('王五', 'wangwu@example.com', 28);

-- INSERT ... SELECT
INSERT INTO users_backup (username, email)
SELECT username, email FROM users WHERE created_at < '2024-01-01';

-- UPDATE
UPDATE users SET age = 26 WHERE username = '张三';
-- 关联更新
UPDATE users u JOIN orders o ON u.id = o.user_id
SET u.last_order_at = o.created_at
WHERE o.status = 'completed';

-- DELETE
DELETE FROM users WHERE age < 18;
-- 分批删除（避免大事务）
DELETE FROM logs WHERE created_at < '2024-01-01' LIMIT 10000;

-- SELECT 基础
SELECT username, age FROM users WHERE age > 20 ORDER BY age DESC LIMIT 10;
SELECT age, COUNT(*) AS cnt FROM users GROUP BY age HAVING cnt > 5;
```

## 4. DCL 操作

```sql
-- 创建用户
CREATE USER 'app_user'@'%' IDENTIFIED BY 'StrongP@ss123';

-- 授权
GRANT SELECT, INSERT, UPDATE, DELETE ON mydb.* TO 'app_user'@'%';

-- 撤权
REVOKE DELETE ON mydb.* FROM 'app_user'@'%';

-- 刷新权限
FLUSH PRIVILEGES;

-- 查看权限
SHOW GRANTS FOR 'app_user'@'%';
```

## 5. 事务控制

```sql
-- 开启事务
START TRANSACTION;  -- 或 BEGIN

-- 执行操作
UPDATE accounts SET balance = balance - 100 WHERE id = 1;
UPDATE accounts SET balance = balance + 100 WHERE id = 2;

-- 提交
COMMIT;

-- 回滚
ROLLBACK;

-- 保存点
SAVEPOINT sp1;
UPDATE accounts SET balance = balance - 50 WHERE id = 1;
ROLLBACK TO sp1;  -- 只回滚到保存点
```

## 6. 数据类型选择最佳实践

| 场景 | 推荐类型 | 避免类型 | 原因 |
|------|---------|---------|------|
| 主键 | BIGINT | INT | 防止溢出，预留增长空间 |
| 金额 | DECIMAL(10,2) | FLOAT/DOUBLE | 浮点数精度问题 |
| 手机号 | VARCHAR(20) | BIGINT | 前导零、国际号码 |
| 邮箱 | VARCHAR(100) | CHAR | 可变长度 |
| 状态 | TINYINT | VARCHAR | 存储效率 |
| 时间 | DATETIME/TIMESTAMP | VARCHAR | 索引效率、函数支持 |
| 大文本 | TEXT | VARCHAR(65535) | 避免行溢出 |
| JSON | JSON | TEXT | 内置函数支持 |

