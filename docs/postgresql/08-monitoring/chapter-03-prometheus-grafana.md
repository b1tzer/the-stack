---
doc_id: pg-prometheus
title: Prometheus + Grafana 监控方案
---

# Prometheus + Grafana 监控方案

> **核心问题**：系统视图和 pg_stat_statements 提供了丰富的数据，但它们是"快照式"的——你必须主动查询才能看到。如何实现 7×24 自动采集、可视化展示、异常告警？更关键的是，当数据库已经高负载时，监控系统本身如何不成为负担？

## 1. postgres_exporter 安装配置

### 安装

```bash
# 下载最新版本（以 0.16.0 为例）
wget https://github.com/prometheus-community/postgres_exporter/releases/download/v0.16.0/postgres_exporter-0.16.0.linux-amd64.tar.gz
tar xzf postgres_exporter-*.tar.gz
sudo mv postgres_exporter-*/postgres_exporter /usr/local/bin/

# 创建专用监控用户
sudo -u postgres psql -c "
CREATE USER pg_exporter WITH PASSWORD 'your_secure_password';
GRANT pg_monitor TO pg_exporter;
"

# 创建 systemd 服务
sudo tee /etc/systemd/system/postgres_exporter.service <<'EOF'
[Unit]
Description=PostgreSQL Exporter
After=network.target

[Service]
Type=simple
User=postgres
Environment="DATA_SOURCE_NAME=postgresql://pg_exporter:your_secure_password@localhost:5432/postgres?sslmode=disable"
ExecStart=/usr/local/bin/postgres_exporter \
  --web.listen-address=:9187 \
  --collector.process_idle \
  --collector.stat_statements \
  --collector.stat_statements.max=100
Restart=always

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now postgres_exporter
```

### Prometheus 配置

```yaml
# prometheus.yml
scrape_configs:
  - job_name: 'postgresql'
    scrape_interval: 15s
    static_configs:
      - targets: ['localhost:9187']
        labels:
          instance: 'pg-primary'
      - targets: ['standby-host:9187']
        labels:
          instance: 'pg-standby'
```

### 验证

```bash
curl http://localhost:9187/metrics | grep pg_stat_database
```

## 2. 关键指标详解

### 连接数

| 指标 | PromQL 表达式 | 说明 |
| :-- | :-- | :-- |
| 当前连接数 | `pg_stat_activity_count` | 按 state 标签分组 |
| 最大连接数 | `pg_settings_max_connections` | 静态配置值 |
| 连接使用率 | `pg_stat_activity_count / pg_settings_max_connections * 100` | 超过 80% 告警 |
| 空闲事务数 | `pg_stat_activity_count{state="idle in transaction"}` | 超过 5 个告警 |

### 缓存命中率

```promql
# 数据库级缓存命中率
pg_stat_database_blks_hit{datname="your_db"} 
  / (pg_stat_database_blks_hit{datname="your_db"} + pg_stat_database_blks_read{datname="your_db"}) 
  * 100
```

### 事务统计

```promql
# TPS（每秒事务提交数）
rate(pg_stat_database_xact_commit{datname="your_db"}[5m])

# 回滚率
rate(pg_stat_database_xact_rollback{datname="your_db"}[5m]) 
  / (rate(pg_stat_database_xact_commit{datname="your_db"}[5m]) + rate(pg_stat_database_xact_rollback{datname="your_db"}[5m])) 
  * 100

# 死锁次数
pg_stat_database_deadlocks{datname="your_db"}
```

### 复制延迟

```promql
# 复制延迟（字节）
pg_stat_replication_pg_wal_lsn_diff{state="streaming"}

# 复制延迟（秒，基于 WAL apply 时间差）
pg_stat_replication_replay_lag
```

### 表膨胀率

```promql
# 死元组占比
pg_stat_user_tables_n_dead_tup 
  / (pg_stat_user_tables_n_live_tup + pg_stat_user_tables_n_dead_tup) 
  * 100
```

### 事务 ID 年龄

```promql
# 事务 ID 年龄（接近 2^31 = 2147483647 需要紧急处理）
pg_database_xid_age{datname="your_db"}
# 使用率百分比
pg_database_xid_age{datname="your_db"} / 2147483647 * 100
```

## 3. Grafana Dashboard 搭建

### 推荐 Dashboard

| Dashboard ID | 名称 | 适用场景 |
| :-- | :-- | :-- |
| 9628 | PostgreSQL Database | 通用数据库概览 |
| 14114 | PostgreSQL | 细粒度监控 |
| 10923 | pg_stat_statements | SQL 级分析 |

### 导入步骤

1. Grafana 左侧菜单 → **+** → **Import**
2. 输入 Dashboard ID（如 `9628`）
3. 选择 Prometheus 数据源
4. 点击 **Import**

### 关键面板自定义 PromQL

```promql
# 1. 连接使用率仪表盘
100 * sum(pg_stat_activity_count) by (instance) / on(instance) pg_settings_max_connections

# 2. QPS 趋势
sum(rate(pg_stat_database_xact_commit{datname!~"template.*"}[5m])) by (instance)

# 3. 缓存命中率趋势
pg_stat_database_blks_hit{datname="your_db"} 
  / (pg_stat_database_blks_hit{datname="your_db"} + pg_stat_database_blks_read{datname="your_db"}) 
  * 100

# 4. 慢查询 Top 5（需要 pg_stat_statements 扩展）
topk(5, pg_stat_statements_mean_time_ms)

# 5. 复制延迟
pg_stat_replication_pg_wal_lsn_diff{state="streaming"}
```

## 4. 告警规则设计

### alert_rules.yml

```yaml
groups:
  - name: postgresql_critical
    rules:
      # 1. 连接数超过 80%
      - alert: PG_Connection_High
        expr: sum(pg_stat_activity_count) by (instance) / on(instance) pg_settings_max_connections > 0.8
        for: 2m
        labels:
          severity: warning
        annotations:
          summary: "PostgreSQL 连接数超过 80%"
          description: "实例 {{ $labels.instance }} 连接使用率 {{ $value | humanizePercentage }}"

      # 2. 连接数超过 95%
      - alert: PG_Connection_Critical
        expr: sum(pg_stat_activity_count) by (instance) / on(instance) pg_settings_max_connections > 0.95
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: "PostgreSQL 连接数超过 95%，服务可能不可用"

      # 3. 缓存命中率低于 99%
      - alert: PG_Cache_Hit_Rate_Low
        expr: pg_stat_database_blks_hit{datname!~"template.*"} / (pg_stat_database_blks_hit{datname!~"template.*"} + pg_stat_database_blks_read{datname!~"template.*"}) < 0.99
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "数据库 {{ $labels.datname }} 缓存命中率 {{ $value | humanizePercentage }}"

      # 4. 死锁发生
      - alert: PG_Deadlock_Detected
        expr: increase(pg_stat_database_deadlocks{datname!~"template.*"}[5m]) > 0
        labels:
          severity: critical
        annotations:
          summary: "数据库 {{ $labels.datname }} 发生死锁"

      # 5. 事务 ID 年龄超过 80%
      - alert: PG_XID_Age_High
        expr: pg_database_xid_age{datname!~"template.*"} / 2147483647 > 0.8
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "数据库 {{ $labels.datname }} 事务 ID 年龄 {{ $value | humanizePercentage }}，需要尽快 VACUUM FREEZE"

      # 6. 复制延迟超过 100MB
      - alert: PG_Replication_Lag_High
        expr: pg_stat_replication_pg_wal_lsn_diff{state="streaming"} > 100 * 1024 * 1024
        for: 2m
        labels:
          severity: warning
        annotations:
          summary: "复制延迟 {{ $value | humanize1024 }}B"

      # 7. 表死元组占比超过 20%
      - alert: PG_Table_Bloat_High
        expr: pg_stat_user_tables_n_dead_tup / (pg_stat_user_tables_n_live_tup + pg_stat_user_tables_n_dead_tup) > 0.2
        for: 10m
        labels:
          severity: warning
        annotations:
          summary: "表 {{ $labels.relname }} 死元组占比 {{ $value | humanizePercentage }}"

      # 8. 强制检查点占比过高
      - alert: PG_Forced_Checkpoint_High
        expr: rate(pg_stat_bgwriter_checkpoints_req[5m]) / (rate(pg_stat_bgwriter_checkpoints_req[5m]) + rate(pg_stat_bgwriter_checkpoints_timed[5m])) > 0.5
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "强制检查点占比过高，检查 max_wal_size 配置"

      # 9. 临时文件增长
      - alert: PG_Temp_Files_Growing
        expr: increase(pg_stat_database_temp_files{datname!~"template.*"}[10m]) > 100
        labels:
          severity: warning
        annotations:
          summary: "数据库 {{ $labels.datname }} 10分钟内产生 {{ $value }} 个临时文件，work_mem 可能不足"

      # 10. WAL 生成速率异常
      - alert: PG_WAL_Rate_High
        expr: rate(pg_stat_wal_bytes[5m]) > 50 * 1024 * 1024
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "WAL 生成速率 {{ $value | humanize1024 }}B/s，可能有大批量写入"

      # 11. 未使用的索引空间浪费
      - alert: PG_Unused_Index_Large
        expr: pg_stat_user_indexes_idx_scan == 0 and pg_relation_size > 100 * 1024 * 1024
        for: 1h
        labels:
          severity: info
        annotations:
          summary: "索引 {{ $labels.indexrelname }} 从未使用且占用 {{ $value | humanize1024 }}B"

      # 12. Autovacuum 长时间未运行
      - alert: PG_Autovacuum_Stale
        expr: (time() - pg_stat_user_tables_last_autovacuum) > 86400 * 3
        for: 1h
        labels:
          severity: warning
        annotations:
          summary: "表 {{ $labels.relname }} 已 {{ $value | humanizeDuration }} 未执行 Autovacuum"
```

## 5. 高负载时监控策略

> **"只能在健康时测体温"问题**：当数据库已经满负荷运行时，监控查询本身可能加剧负载。

### 解决方案

| 策略 | 实现方式 | 适用场景 |
| :-- | :-- | :-- |
| **只读副本监控** | 在 replica 上执行 pg_stat_statements 查询 | 主库不承担监控查询开销 |
| **采样而非全量** | `pg_stat_statements.track = top`，限制 `max` 值 | 减少统计开销 |
| **exporter 超时保护** | `--timeout=5s`，超时放弃采集 | 避免监控卡住 |
| **本地缓存** | exporter 内置 15s 刷新间隔 | 不要过于频繁采集 |
| **分离连接池** | 监控连接走独立池，不与业务竞争 | 避免连接耗尽 |
| **pg_stat_statements 降频** | 生产环境关闭 `track_planning` | 减少计划统计开销 |

```bash
# postgres_exporter 超时和缓存配置
ExecStart=/usr/local/bin/postgres_exporter \
  --web.listen-address=:9187 \
  --timeout=5s \
  --constantLabels=instance=pg-primary
```

```sql
-- 对 pg_stat_statements 进行过滤，只采集 Top SQL
-- 在 exporter 自定义查询中
SELECT * FROM pg_stat_statements 
WHERE calls > 100 AND mean_exec_time > 10
ORDER BY total_exec_time DESC 
LIMIT 50;
```

## 6. pgwatch2 简介

[pgwatch2](https://github.com/cybertec-postgresql/pgwatch2) 是一个开箱即用的 PostgreSQL 监控方案，集成了指标采集、存储和 Grafana 展示。

### 与 postgres_exporter 对比

| 特性 | postgres_exporter | pgwatch2 |
| :-- | :-- | :-- |
| 安装复杂度 | 低（单二进制） | 中（含 Web UI + InfluxDB/PG） |
| 指标丰富度 | 基础（系统视图） | 丰富（含自定义 SQL） |
| 存储后端 | Prometheus（拉取） | InfluxDB / PostgreSQL / Prometheus |
| 多实例支持 | 通过 Prometheus target | 内置 Web UI 配置 |
| 自定义指标 | 自定义查询文件 | Web UI 配置 |
| 适用规模 | 中小规模 | 中大规模 |

### 快速启动（Docker）

```bash
docker run -d --name pgwatch2 \
  -p 3000:3000 \
  -p 8080:8080 \
  -p 8086:8086 \
  cybertecpostgresql/pgwatch2:latest
```

> **选型建议**：已有 Prometheus 体系用 postgres_exporter；从零开始或需要更丰富的开箱即用指标选 pgwatch2。

## 小结

Prometheus + Grafana 是生产级 PostgreSQL 监控的标准方案。关键是告警规则的设计——既要覆盖核心指标（连接、缓存、复制、膨胀、事务 ID），又要注意阈值合理性，避免告警风暴。高负载场景下，监控策略本身也需要"轻量化"设计。
