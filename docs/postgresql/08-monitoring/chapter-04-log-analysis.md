---
doc_id: pg-log-analysis
title: 日志分析与审计
---

# 日志分析与审计

> **核心问题**：系统视图和指标监控告诉我们"现在怎么样"，但无法回答"过去发生了什么"。日志是事后分析、安全审计和慢查询回溯的关键数据源。如何配置日志级别、选择合适的日志格式、利用工具自动分析，同时不让日志 IO 成为新的性能瓶颈？

## 1. 日志配置详解

### postgresql.conf 核心日志参数

```ini
# === 日志输出方式 ===
logging_collector = on          # 启用日志收集器（生产环境必须开启）
log_destination = 'csvlog'      # 推荐 csvlog，便于工具解析；可选 stderr, jsonlog(PG15+)
log_directory = 'log'           # 日志目录（相对于 data_directory）
log_filename = 'postgresql-%Y-%m-%d.log'  # 日志文件名模式
log_rotation_age = 1d           # 按天轮转
log_rotation_size = 100MB       # 按大小轮转（与 age 取 OR）
log_truncate_on_rotation = on   # 轮转时覆盖同名文件

# === 记录哪些语句 ===
log_statement = 'ddl'           # none / ddl / mod / all
                                # none: 不记录语句
                                # ddl: 只记录 DDL（CREATE/ALTER/DROP）
                                # mod: 记录 DDL + DML（INSERT/UPDATE/DELETE）
                                # all: 记录所有语句（不建议生产环境）

# === 慢查询记录 ===
log_min_duration_statement = 1000  # 单位 ms，执行超过此时间的语句记录到日志
                                   # 0 = 记录所有语句的执行时间
                                   # -1 = 关闭

# === 其他重要参数 ===
log_checkpoints = on            # 记录检查点信息（强烈建议开启）
log_connections = on            # 记录连接建立
log_disconnections = on         # 记录连接断开（含会话持续时间）
log_lock_waits = on             # 记录锁等待超时
log_temp_files = 0              # 记录所有临时文件使用（0 = 全部记录）
log_autovacuum_min_duration = 0 # 记录所有 autovacuum 操作
log_line_prefix = '%m [%p] %u@%d '  # 日志行前缀
```

### log_line_prefix 常用占位符

| 占位符 | 含义 | 推荐 |
| :-- | :-- | :-- |
| `%t` | 时间戳（无毫秒） | - |
| `%m` | 时间戳（含毫秒） | ✅ 推荐 |
| `%p` | 进程 ID | ✅ 推荐 |
| `%u` | 用户名 | ✅ 推荐 |
| `%d` | 数据库名 | ✅ 推荐 |
| `%r` | 客户端地址和端口 | ✅ 推荐 |
| `%h` | 客户端主机名 | - |
| `%a` | 应用名称 | ✅ 推荐 |
| `%l` | 日志行号 | - |
| `%s` | 会话开始时间 | - |

```ini
# 推荐的 log_line_prefix 配置
log_line_prefix = '%m [%p] %u@%d/%a %r '
# 示例输出: 2024-01-15 10:30:45.123 CST [12345] app_user@mydb/app 192.168.1.100:5432
```

### Java 应用连接配置

```yaml
# application.yml - 让日志能追踪到 Java 应用
spring:
  datasource:
    url: jdbc:postgresql://localhost:5432/mydb?ApplicationName=my-spring-app
    hikari:
      data-source-properties:
        ApplicationName: my-spring-app
```

## 2. csvlog 格式解析

csvlog 是 PostgreSQL 推荐的日志格式，每行一条记录，字段用逗号分隔，方便导入数据库分析。

### csvlog 字段（PG 15 为例，共 23 列）

| 列号 | 字段 | 说明 |
| :-- | :-- | :-- |
| 1 | log_time | 日志时间 |
| 2 | user_name | 用户名 |
| 3 | database_name | 数据库名 |
| 4 | process_id | 进程 ID |
| 5 | connection_from | 客户端地址 |
| 6 | session_id | 会话 ID |
| 7 | session_line_num | 会话内行号 |
| 8 | command_tag | 命令标签 |
| 9 | session_start_time | 会话开始时间 |
| 10 | virtual_transaction_id | 虚拟事务 ID |
| 11 | transaction_id | 事务 ID |
| 12 | error_severity | 错误级别 |
| 13 | sql_state | SQLSTATE 错误码 |
| 14 | message | 日志消息 |
| 15 | detail | 详细信息 |
| 16 | hint | 提示 |
| 17 | internal_query | 内部查询 |
| 18 | internal_query_pos | 内部查询位置 |
| 19 | context | 上下文 |
| 20 | query | 用户查询 |
| 21 | query_pos | 查询位置 |
| 22 | location | 代码位置 |
| 23 | application_name | 应用名称 |

### 导入 csvlog 到数据库分析

```sql
-- 创建日志表
CREATE TABLE IF NOT EXISTS pg_log (
    log_time timestamptz,
    user_name text,
    database_name text,
    process_id integer,
    connection_from text,
    session_id text,
    session_line_num bigint,
    command_tag text,
    session_start_time timestamptz,
    virtual_transaction_id text,
    transaction_id bigint,
    error_severity text,
    sql_state text,
    message text,
    detail text,
    hint text,
    internal_query text,
    internal_query_pos integer,
    context text,
    query text,
    query_pos integer,
    location text,
    application_name text
);

-- 导入日志文件
COPY pg_log FROM '/var/lib/postgresql/data/log/postgresql-2024-01-15.csv' WITH (FORMAT csv);

-- 慢查询 Top 10
SELECT log_time, user_name, database_name, 
       LEFT(message, 200) AS message,
       LEFT(query, 200) AS query
FROM pg_log
WHERE message LIKE 'duration:%'
ORDER BY CAST(REPLACE(SPLIT_PART(message, ' ', 2), 'ms', '') AS numeric) DESC
LIMIT 10;

-- 错误统计
SELECT error_severity, sql_state, COUNT(*), 
       MIN(log_time) AS first_seen, MAX(log_time) AS last_seen
FROM pg_log
WHERE error_severity IN ('ERROR', 'FATAL', 'PANIC')
GROUP BY error_severity, sql_state
ORDER BY COUNT(*) DESC;
```

## 3. pgBadger 日志分析工具

[pgBadger](https://github.com/darold/pgbadger) 是 PostgreSQL 日志分析的瑞士军刀，能从 csvlog/stderr 中生成丰富的 HTML 报告。

### 安装

```bash
# Debian/Ubuntu
sudo apt-get install pgbadger

# 或从源码安装
wget https://github.com/darold/pgbadger/releases/download/v12.4/pgbadger-12.4.tar.gz
tar xzf pgbadger-*.tar.gz
cd pgbadger-*/
perl Makefile.PL
make && sudo make install
```

### 使用

```bash
# 分析单个日志文件
pgbadger /var/lib/postgresql/data/log/postgresql-2024-01-15.csv -o report.html

# 分析多个日志文件
pgbadger /var/lib/postgresql/data/log/postgresql-2024-01-*.csv -o report.html

# 增量分析（每天生成报告，支持历史对比）
pgbadger --last-parsed /tmp/pgbadger_last \
         /var/lib/postgresql/data/log/postgresql-*.csv \
         -o /var/www/pgbadger/report_$(date +%Y%m%d).html

# 并行处理（大日志文件加速）
pgbadger -j 4 /var/lib/postgresql/data/log/postgresql-*.csv -o report.html

# JSON 输出（便于程序化处理）
pgbadger -f json /var/lib/postgresql/data/log/postgresql-*.csv -o report.json
```

### 自动化脚本

```bash
#!/bin/bash
# /etc/cron.daily/pgbadger-analysis.sh

LOG_DIR="/var/lib/postgresql/data/log"
REPORT_DIR="/var/www/pgbadger"
YESTERDAY=$(date -d "yesterday" +%Y-%m-%d)
LAST_PARSED="/tmp/pgbadger_last"

pgbadger \
  --last-parsed "$LAST_PARSED" \
  --prefix='%m [%p] %u@%d/%a %r ' \
  "${LOG_DIR}/postgresql-${YESTERDAY}.csv" \
  -o "${REPORT_DIR}/report_${YESTERDAY}.html"

# 清理 30 天前的报告
find "$REPORT_DIR" -name "report_*.html" -mtime +30 -delete
```

### pgBadger 报告关键内容

| 模块 | 关注点 |
| :-- | :-- |
| Overall Statistics | 总查询数、TPS、连接数 |
| Slowest Queries | 最慢的 SQL Top N |
| Time Consuming Queries | 总耗时最高的 SQL |
| Most Frequent Queries | 高频 SQL |
| Queries by User | 按用户统计 |
| Errors | 错误和致命错误 |
| Checkpoints | 检查点频率和时长 |
| Connections | 连接/断开趋势 |

## 4. 审计日志配置（pgAudit 扩展）

pgAudit 提供细粒度的审计能力，记录谁在什么时间做了什么操作，满足合规要求。

### 安装和配置

```ini
# postgresql.conf
shared_preload_libraries = 'pgaudit'

# pgaudit 审核级别
pgaudit.log = 'ddl, role, write'
# ddl: CREATE/ALTER/DROP 等
# role: GRANT/REVOKE
# write: INSERT/UPDATE/DELETE/TRUNCATE
# read: SELECT（通常不开，日志量太大）
# function: 函数调用
# misc: DISCARD, FETCH, CHECKPOINT 等
# all: 以上全部

pgaudit.log_catalog = on          # 是否记录系统表访问
pgaudit.log_parameter = on        # 是否记录 SQL 参数
pgaudit.log_statement_once = on   # 每条语句只记录一次（减少重复）
pgaudit.log_level = 'log'         # 日志级别：debug5..log..warning
```

```sql
-- 启用扩展
CREATE EXTENSION IF NOT EXISTS pgaudit;

-- 针对特定角色启用审计（更精细的控制）
-- 不设置 pgaudit.log 参数，改为针对角色设置
ALTER ROLE auditor SET pgaudit.log = 'all';

-- 针对特定表审计
-- 先设置 pgaudit.role，然后将该角色的权限授予需要审计的对象
CREATE ROLE auditor_role;
ALTER DATABASE mydb SET pgaudit.role = 'auditor_role';
GRANT SELECT, INSERT, UPDATE, DELETE ON sensitive_table TO auditor_role;
```

### pgAudit 日志示例

```
2024-01-15 10:30:45.123 CST [12345] app_user@mydb LOG:  AUDIT: SESSION,1,1,WRITE,INSERT,,,
"INSERT INTO orders (user_id, amount) VALUES (123, 99.99);",<none>
```

## 5. 日志与监控的配合策略

### 分层监控体系

```
┌─────────────────────────────────────────────────────┐
│                    告警层 (PagerDuty/企微/钉钉)       │
├─────────────────────────────────────────────────────┤
│  指标监控 (Prometheus + Grafana)                      │
│  - 实时采集系统视图                                    │
│  - 秒级/分钟级指标                                    │
│  - 阈值告警                                          │
├─────────────────────────────────────────────────────┤
│  日志分析 (pgBadger + ELK)                            │
│  - 慢查询详细分析                                     │
│  - 错误和异常追踪                                     │
│  - 审计合规                                          │
├─────────────────────────────────────────────────────┤
│  SQL 分析 (pg_stat_statements)                        │
│  - Top N 资源消耗 SQL                                 │
│  - 执行计划变化检测                                    │
└─────────────────────────────────────────────────────┘
```

### 配合方式

| 场景 | 指标监控 | 日志分析 | SQL 分析 |
| :-- | :-- | :-- | :-- |
| 突然变慢 | 发现异常 → | 查看当时日志 → | 定位具体 SQL |
| 报错率上升 | 发现回滚增加 → | 查看 ERROR 日志 → | 分析报错 SQL |
| 连接耗尽 | 告警连接数 → | 查看连接建立日志 → | 分析连接来源 |
| 审计需求 | - | pgAudit 日志 → | - |

## 6. 日志对 IO 的影响及优化

### 日志 IO 影响评估

| log_statement | 日志量 | IO 影响 | 推荐 |
| :-- | :-- | :-- | :-- |
| `none` | 最小 | 无 | 开发环境 |
| `ddl` | 小 | 极低 | 生产环境默认 |
| `mod` | 中 | 低 | 需要审计 DML |
| `all` | 极大 | 高 | 仅调试用 |

| log_min_duration_statement | 日志量 | IO 影响 | 推荐 |
| :-- | :-- | :-- | :-- |
| `-1` (关闭) | 无 | 无 | 不推荐 |
| `0` (全部) | 极大 | 高 | 仅调试 |
| `1000` (1秒) | 中 | 低 | 生产推荐 |
| `5000` (5秒) | 小 | 极低 | 保守配置 |

### 优化建议

```ini
# 1. 日志存放在独立磁盘/volume
log_directory = '/pg_log'   # 与 data_directory 不同的磁盘

# 2. 使用 SSD 存放日志
# 将日志目录挂载到 SSD

# 3. 合理的轮转策略
log_rotation_age = 1d
log_rotation_size = 100MB
log_truncate_on_rotation = on

# 4. 关闭不必要的日志（生产环境）
log_statement = 'ddl'
log_connections = off       # 如果不需要审计连接，关闭以减少日志量
log_disconnections = off    # 同上

# 5. 使用 syslog 代替文件日志（高 IO 场景）
# log_destination = 'syslog'
# syslog_facility = 'local0'
# syslog_ident = 'postgres'
```

### 日志存储规划

```bash
# 估算日志量
# 假设：TPS 1000，log_min_duration_statement=1000，约 1% 慢查询
# 每条日志约 500 bytes
# 每天日志量 ≈ 1000 * 86400 * 1% * 500 ≈ 430 MB/天

# 磁盘规划
# 保留 30 天日志 → 约 13 GB
# 加上 csvlog 冗余 → 约 26 GB
# 建议预留 50 GB

# 自动清理脚本
find /pg_log -name "postgresql-*.csv" -mtime +30 -delete
find /pg_log -name "postgresql-*.log" -mtime +30 -delete
```

## 小结

日志是监控体系中不可或缺的一环。指标监控发现异常，日志分析定位根因。配置时要在"信息充分"和"IO 开销"之间找到平衡——生产环境推荐 `log_statement = 'ddl'` + `log_min_duration_statement = 1000ms` 的组合，既不会遗漏关键信息，也不会给 IO 带来过大压力。审计场景使用 pgAudit 扩展，日志分析使用 pgBadger，三者配合构成完整的日志监控方案。
