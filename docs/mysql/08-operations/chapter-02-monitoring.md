# 监控

## 1. 内置监控工具

### 1.1 Performance Schema

```sql
-- 查看连接
SELECT * FROM performance_schema.threads WHERE PROCESSLIST_ID = <pid>;

-- 查看锁等待
SELECT * FROM performance_schema.data_lock_waits;

-- 查看语句统计
SELECT * FROM performance_schema.events_statements_summary_by_digest
ORDER BY sum_timer_wait DESC LIMIT 10;
```

### 1.2 sys Schema

```sql
-- 最慢查询
SELECT * FROM sys.statements_with_runtimes_in_95th_percentile LIMIT 10;

-- 未使用的索引
SELECT * FROM sys.schema_unused_indexes;

-- 冗余索引
SELECT * FROM sys.schema_redundant_indexes;
```

### 1.3 慢查询日志

```ini
slow_query_log = 1
slow_query_log_file = /var/log/mysql/slow.log
long_query_log_time = 1
```

```bash
# 分析慢查询
mysqldumpslow -s t -t 10 /var/log/mysql/slow.log
```

## 2. 指标与可视化监控

### 2.1 关键监控指标

```sql
-- 连接相关
SHOW GLOBAL STATUS LIKE 'Threads_connected';   -- 当前连接数
SHOW GLOBAL STATUS LIKE 'Threads_running';      -- 活跃线程数（> CPU 核数说明过载）
SHOW GLOBAL STATUS LIKE 'Max_used_connections'; -- 历史最大连接数
SHOW GLOBAL STATUS LIKE 'Connection_errors%';   -- 连接错误

-- 查询相关
SHOW GLOBAL STATUS LIKE 'Queries';              -- 总查询数
SHOW GLOBAL STATUS LIKE 'Questions';            -- 客户端查询数
SHOW GLOBAL STATUS LIKE 'Slow_queries';         -- 慢查询数
SHOW GLOBAL STATUS LIKE 'Com_select';           -- SELECT 次数
SHOW GLOBAL STATUS LIKE 'Com_insert';           -- INSERT 次数
SHOW GLOBAL STATUS LIKE 'Com_update';           -- UPDATE 次数
SHOW GLOBAL STATUS LIKE 'Com_delete';           -- DELETE 次数

-- InnoDB 相关
SHOW GLOBAL STATUS LIKE 'Innodb_buffer_pool_read%';  -- Buffer Pool 命中率
SHOW GLOBAL STATUS LIKE 'Innodb_row_lock%';          -- 行锁统计
SHOW GLOBAL STATUS LIKE 'Innodb_deadlocks';          -- 死锁次数
SHOW GLOBAL STATUS LIKE 'Innodb_os_log_written';     -- Redo Log 写入量

-- 临时表
SHOW GLOBAL STATUS LIKE 'Created_tmp%';
-- Created_tmp_disk_tables: 磁盘临时表（越大越不好）
-- Created_tmp_tables: 内存临时表
```

### 2.2 Grafana + Prometheus 监控

```yaml
# mysqld_exporter 配置
# /etc/.mysqld_exporter.cnf
[client]
user=exporter
password=secret
host=127.0.0.1
port=3306
```

```bash
# 启动 mysqld_exporter
mysqld_exporter --config.my-cnf=/etc/.mysqld_exporter.cnf --web.listen-address=:9104
```

```yaml
# prometheus.yml
scrape_configs:
  - job_name: 'mysql'
    static_configs:
      - targets: ['192.168.1.100:9104']
```

**推荐 Grafana Dashboard：**
- MySQL Overview (ID: 7362)
- MySQL InnoDB Metrics (ID: 7365)
- MySQL Replication (ID: 7371)

### 2.3 告警规则

```yaml
# Prometheus 告警规则
groups:
  - name: mysql_alerts
    rules:
      - alert: MySQLDown
        expr: mysql_up == 0
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: "MySQL 实例宕机"
      
      - alert: MySQLSlowQueries
        expr: rate(mysql_global_status_slow_queries[5m]) > 0.1
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "慢查询过多"
      
      - alert: MySQLReplicationLag
        expr: mysql_slave_status_seconds_behind_master > 30
        for: 2m
        labels:
          severity: warning
        annotations:
          summary: "主从延迟超过 30 秒"
      
      - alert: MySQLConnectionsHigh
        expr: mysql_global_status_threads_connected / mysql_global_variables_max_connections > 0.8
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "连接数超过 80%"
```

## 3. 最佳实践

1. **部署 Prometheus + Grafana** — 成熟的监控方案
2. **关键指标必须告警** — 连接数、慢查询、复制延迟、磁盘空间
3. **定期分析慢查询** — 使用 pt-query-digest
4. **监控 Buffer Pool 命中率** — 低于 99% 需要调整
5. **监控磁盘空间** — Binlog 和数据文件增长
6. **保留历史监控数据** — 便于趋势分析和容量规划
