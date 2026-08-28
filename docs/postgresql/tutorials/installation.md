---
doc_id: pg-install
title: 安装部署与环境配置
---

# 安装部署与环境配置

> **核心问题：** 作为 Java 后端开发者，如何在本地或服务器上快速安装 PostgreSQL 并完成基础配置，以便立即投入开发？

---

## 1. 各平台安装

### Ubuntu / Debian（apt）

```bash
# 添加官方源（推荐，获取最新版本）
sudo sh -c 'echo "deb http://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" > /etc/apt/sources.list.d/pgdg.list'
curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc | sudo gpg --dearmor -o /usr/share/keyrings/postgresql-keyring.gpg
sudo apt update

# 安装 PostgreSQL 16
sudo apt install -y postgresql-16

# 安装后服务自动启动，验证
sudo systemctl status postgresql
```

### CentOS / RHEL（yum）

```bash
# 安装官方仓库
sudo yum install -y https://download.postgresql.org/pub/repos/yum/reporpms/EL-8-x86_64/pgdg-redhat-repo-latest.noarch.rpm
sudo yum module disable -y postgresql   # 禁用系统自带版本
sudo yum install -y postgresql16-server

# 初始化并启动
sudo /usr/pgsql-16/bin/postgresql-16-setup initdb
sudo systemctl enable --now postgresql-16
```

### macOS（Homebrew）

```bash
brew install postgresql@16
brew services start postgresql@16

# 验证
psql --version
```

### Docker（推荐开发环境）

```bash
# 一行启动
docker run -d \
  --name pg-dev \
  -e POSTGRES_PASSWORD=dev123 \
  -e POSTGRES_DB=appdb \
  -p 5432:5432 \
  -v pgdata:/var/lib/postgresql/data \
  postgres:16-alpine

# 进入容器
docker exec -it pg-dev psql -U postgres
```

> **Docker 最省心**：环境隔离、秒级销毁重建，本地开发首选。

---

## 2. 安装后基础配置

配置文件位于数据目录下（Ubuntu: `/etc/postgresql/16/main/`，CentOS: `/var/lib/pgsql/16/data/`）。

### postgresql.conf 关键参数

| 参数 | 默认值 | 推荐开发值 | 说明 |
|------|--------|------------|------|
| `listen_addresses` | `localhost` | `'*'`（容器/远程） | 监听地址 |
| `port` | `5432` | `5432` | 端口号 |
| `max_connections` | `100` | `200` | 最大连接数 |
| `shared_buffers` | `128MB` | 物理内存的 25% | 共享缓冲区 |
| `work_mem` | `4MB` | `16MB` | 单次排序/哈希内存 |
| `effective_cache_size` | `4GB` | 物理内存的 75% | 查询规划器缓存估算 |
| `log_statement` | `none` | `all`（开发环境） | 记录所有 SQL |

```ini
# postgresql.conf 示例（开发环境）
listen_addresses = '*'
port = 5432
max_connections = 200
shared_buffers = '256MB'
work_mem = '16MB'
log_statement = 'all'
```

### pg_hba.conf 认证配置

```
# TYPE  DATABASE  USER       ADDRESS         METHOD
local   all       postgres                   peer
local   all       all                        md5
host    all       all        127.0.0.1/32    scram-sha-256
host    all       all        0.0.0.0/0       scram-sha-256
```

| METHOD | 说明 |
|--------|------|
| `peer` | 仅限本地 OS 用户同名连接 |
| `md5` | 密码认证（兼容旧客户端） |
| `scram-sha-256` | 推荐，更安全的密码认证 |
| `trust` | 无密码（⚠️ 仅限本地开发） |

修改配置后需重载：

```bash
sudo systemctl reload postgresql
# 或在 psql 中
SELECT pg_reload_conf();
```

---

## 3. 服务管理命令

```bash
# systemd（Ubuntu/CentOS）
sudo systemctl start postgresql     # 启动
sudo systemctl stop postgresql      # 停止
sudo systemctl restart postgresql   # 重启
sudo systemctl status postgresql    # 状态
sudo systemctl enable postgresql    # 开机自启

# macOS
brew services start postgresql@16
brew services stop postgresql@16
brew services restart postgresql@16

# Docker
docker start pg-dev
docker stop pg-dev
docker restart pg-dev
```

---

## 4. psql 客户端常用命令

连接数据库：

```bash
psql -h localhost -p 5432 -U postgres -d appdb
# 或简写（本地默认）
psql -U postgres
```

常用元命令：

| 命令 | 作用 | 示例 |
|------|------|------|
| `\l` | 列出所有数据库 | `\l` |
| `\c dbname` | 切换数据库 | `\c appdb` |
| `\dt` | 列出当前 schema 的表 | `\dt` |
| `\dt *.*` | 列出所有 schema 的表 | `\dt *.*` |
| `\d tablename` | 查看表结构 | `\d users` |
| `\di` | 列出索引 | `\di` |
| `\du` | 列出角色/用户 | `\du` |
| `\x` | 切换扩展显示（宽表友好） | `\x` |
| `\timing` | 显示 SQL 执行时间 | `\timing` |
| `\q` | 退出 psql | `\q` |
| `\i file.sql` | 执行 SQL 文件 | `\i init.sql` |
| `\?` | 查看所有元命令帮助 | `\?` |

```sql
-- 连接后快速验证
SELECT version();              -- 查看版本
SELECT current_database();     -- 当前数据库
SELECT now();                  -- 当前时间
\conninfo                      -- 连接信息
```

---

## 5. 图形化工具

| 工具 | 类型 | 特点 | 适合场景 |
|------|------|------|----------|
| **pgAdmin 4** | Web / 桌面 | 官方出品，功能全面 | DBA 管理、SQL 开发 |
| **DBeaver** | 桌面（免费） | 支持多种数据库，社区版免费 | 多数据库开发者 |
| **DataGrip** | 桌面（付费） | JetBrains 全家桶，智能补全强 | Java 开发者（已有 IDEA 许可） |
| **Navicat** | 桌面（付费） | 界面友好，数据导入导出方便 | 非技术用户 |

> **Java 开发者推荐**：如果你已有 IntelliJ IDEA，直接安装 Database 插件即可，无需额外工具。

---

## 6. 验证安装成功

完成以下操作即表示安装成功：

```sql
-- 1. 创建测试数据库
CREATE DATABASE testdb;

-- 2. 连接到新库
\c testdb

-- 3. 创建测试表
CREATE TABLE hello (
    id   SERIAL PRIMARY KEY,
    msg  TEXT NOT NULL,
    ts   TIMESTAMP DEFAULT now()
);

-- 4. 插入并查询
INSERT INTO hello (msg) VALUES ('PostgreSQL 安装成功！');
SELECT * FROM hello;

-- 5. 查看结果
--  id |          msg           |             ts
-- ----+------------------------+----------------------------
--   1 | PostgreSQL 安装成功！    | 2026-08-28 18:00:00.000000
```

---

## 要点总结

- **开发环境推荐 Docker**：一条命令搞定，数据可持久化到 volume
- **生产环境关注**：`shared_buffers`、`max_connections`、认证方式
- **pg_hba.conf** 是安全第一道防线，生产环境务必用 `scram-sha-256`
- **psql 元命令** 熟练使用 `\d`、`\dt`、`\x` 能大幅提升效率
- 修改配置后记得 `reload`，不需要重启（除 `listen_addresses` 外）
