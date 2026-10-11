# 安装部署与配置

> 本页完成开发或测试环境的安装、基础配置和一次可验证的建表查询流程。生产实例的参数、加固、备份与监控见[首次生产部署](./chapter-03-first-production.md)。

## 1. 安装方式

### 1.1 Docker
```bash
docker run -d --name mysql8 \
  -e MYSQL_ROOT_PASSWORD=secret \
  -p 3306:3306 \
  mysql:8.0
```

### 1.2 apt/yum
```bash
# Ubuntu
apt install mysql-server-8.0

# CentOS
yum install mysql-community-server
```

## 2. 快速搭建

装好后，用下面的语句从建库到查执行计划快速走通一遍：

```sql
-- 连接（宿主机或容器内执行）
-- mysql -u root -p

-- 建库（字符集 utf8mb4）
CREATE DATABASE demo DEFAULT CHARACTER SET utf8mb4 DEFAULT COLLATE utf8mb4_0900_ai_ci;
USE demo;

-- 建表：自增主键 + 唯一索引
CREATE TABLE users (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(50) NOT NULL UNIQUE,
  email VARCHAR(100) NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 基本 CRUD
INSERT INTO users (username, email) VALUES ('alice', 'alice@example.com');
SELECT * FROM users WHERE username = 'alice';
UPDATE users SET email = 'alice_new@example.com' WHERE username = 'alice';
DELETE FROM users WHERE username = 'bob';

-- 事务：先建转账表，再演示提交
CREATE TABLE accounts (
  user_id INT PRIMARY KEY,
  balance DECIMAL(10,2) NOT NULL DEFAULT 0
);
START TRANSACTION;
UPDATE accounts SET balance = balance - 100 WHERE user_id = 1;
UPDATE accounts SET balance = balance + 100 WHERE user_id = 2;
COMMIT;

-- 查看执行计划
EXPLAIN SELECT * FROM users WHERE email = 'alice@example.com';
```

## 3. 核心配置 (my.cnf)

```ini
[mysqld]
# 基础
port = 3306
datadir = /var/lib/mysql
socket = /var/run/mysqld/mysqld.sock

# 字符集
character-set-server = utf8mb4
collation-server = utf8mb4_unicode_ci

# InnoDB
innodb_buffer_pool_size = 4G          # 物理内存的 70%
innodb_redo_log_capacity = 1G       # MySQL 8.0.30+
innodb_flush_log_at_trx_commit = 1    # 1=每次提交刷盘
innodb_flush_method = O_DIRECT

# 连接
max_connections = 500
wait_timeout = 600

# 慢查询
slow_query_log = 1
long_query_time = 1
```

## 4. 字符集

```sql
-- 查看字符集
SHOW CHARACTER SET;

-- 设置数据库字符集
CREATE DATABASE mydb CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

字符集的比较规则、排序行为和常见乱码原因见[字符集与排序规则](../01-basics/chapter-03-charset-collation.md)。

## 5. 多实例部署

```bash
# 使用 mysqld_multi 管理多实例
[mysqld_multi]
mysqld = /usr/sbin/mysqld
mysqladmin = /usr/bin/mysqladmin

[mysqld1]
port = 3306
datadir = /var/lib/mysql1
socket = /var/run/mysqld/mysqld1.sock

[mysqld2]
port = 3307
datadir = /var/lib/mysql2
socket = /var/run/mysqld/mysqld2.sock
```
