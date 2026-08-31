# 第一个数据库

> 从零开始创建你的第一个 MySQL 数据库、表，完成基本的 CRUD 操作。

## 1. 连接 MySQL

```bash
mysql -u root -p
```

## 2. 创建数据库

```sql
CREATE DATABASE demo
  DEFAULT CHARACTER SET utf8mb4
  DEFAULT COLLATE utf8mb4_0900_ai_ci;

USE demo;
```

## 3. 创建表

```sql
CREATE TABLE users (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(50) NOT NULL UNIQUE,
  email VARCHAR(100) NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

## 4. 基本 CRUD

```sql
-- 插入
INSERT INTO users (username, email) VALUES ('alice', 'alice@example.com');
INSERT INTO users (username, email) VALUES ('bob', 'bob@example.com');

-- 查询
SELECT * FROM users;
SELECT * FROM users WHERE username = 'alice';

-- 更新
UPDATE users SET email = 'alice_new@example.com' WHERE username = 'alice';

-- 删除
DELETE FROM users WHERE username = 'bob';
```

## 5. 事务示例

```sql
START TRANSACTION;

UPDATE accounts SET balance = balance - 100 WHERE user_id = 1;
UPDATE accounts SET balance = balance + 100 WHERE user_id = 2;

COMMIT;
```

## 6. 查看执行计划

```sql
EXPLAIN SELECT * FROM users WHERE email = 'alice@example.com';
```
