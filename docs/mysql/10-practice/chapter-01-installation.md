# 安装部署与配置

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
innodb_log_file_size = 1G
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

## 5. 生产环境推荐配置

```ini
[mysqld]
# ========== 性能相关 ==========
# Buffer Pool: 物理内存的 50%-70%
innodb_buffer_pool_size = 8G
innodb_buffer_pool_instances = 8

# Redo Log
innodb_log_file_size = 2G
innodb_log_buffer_size = 64M
innodb_flush_log_at_trx_commit = 1
innodb_flush_method = O_DIRECT

# 并发
innodb_thread_concurrency = 0          # 自适应
innodb_read_io_threads = 8
innodb_write_io_threads = 8
innodb_io_capacity = 2000              # SSD 建议 2000+
innodb_io_capacity_max = 4000

# ========== 连接相关 ==========
max_connections = 500
max_connect_errors = 100
wait_timeout = 600
interactive_timeout = 600
thread_cache_size = 64

# ========== 查询相关 ==========
tmp_table_size = 64M
max_heap_table_size = 64M
sort_buffer_size = 4M
join_buffer_size = 4M
read_buffer_size = 2M
read_rnd_buffer_size = 8M

# ========== 日志相关 ==========
log_error = /var/log/mysql/error.log
slow_query_log = 1
slow_query_log_file = /var/log/mysql/slow.log
long_query_time = 1
log_queries_not_using_indexes = 1

# ========== Binlog ==========
log-bin = mysql-bin
binlog_format = ROW
binlog_expire_logs_seconds = 604800    # 7 天
sync_binlog = 1                        # 与 innodb_flush_log_at_trx_commit=1 配合保证双1
```

## 6. 关键参数调优说明

| 参数 | 默认值 | 建议值 | 说明 |
| :-- | :-- | :-- | :-- |
| innodb_buffer_pool_size | 128M | 物理内存 70% | 最重要的参数，缓存数据和索引 |
| innodb_flush_log_at_trx_commit | 1 | 1 (安全) / 2 (性能) | 1=每次提交刷盘，最安全 |
| sync_binlog | 1 | 1 (安全) / 100 (性能) | 双1保证数据不丢失 |
| max_connections | 151 | 根据业务量设置 | 过大浪费内存，过小连接拒绝 |
| innodb_io_capacity | 200 | SSD: 2000 | InnoDB 后台 IO 能力 |

## 7. 安装后安全加固

```bash
# 运行安全配置向导
mysql_secure_installation

# 会执行以下操作：
# 1. 设置 root 密码
# 2. 删除匿名用户
# 3. 禁止 root 远程登录
# 4. 删除测试数据库
# 5. 刷新权限表
```

## 8. 多实例部署

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

