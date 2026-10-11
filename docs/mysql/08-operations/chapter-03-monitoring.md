# 监控、告警与慢查询

> 本页组织指标、仪表盘、告警和慢查询分析；`information_schema`、`performance_schema` 与 `sys` 的定位见[内置诊断数据源](./chapter-02-observability.md)。

## 确定监控对象

监控不是把所有状态变量都画到仪表盘上，而是围绕业务可用性和容量风险建立可行动的信号。

| 目标 | 常见信号 | 触发后要回答的问题 |
| :-- | :-- | :-- |
| 可用性 | 实例探测、连接失败、错误率 | 实例、网络、磁盘还是应用连接池异常 |
| 吞吐与延迟 | QPS、事务数、语句延迟、请求 P95 | 是流量增长、慢查询还是资源竞争 |
| 饱和度 | 连接使用率、CPU、IO 队列、缓冲池压力 | 哪种资源先成为瓶颈，扩容是否有效 |
| 正确性 | 死锁、复制错误、备份失败 | 数据链路是否仍满足 RPO 和一致性要求 |
| 容量 | 数据、Redo、Undo、Binlog、备份空间 | 哪类数据将在多久后耗尽磁盘 |

同一指标可以有多种解释。例如 `Threads_running` 上升可能来自慢查询、锁等待或 CPU 不足，告警应引导排查下一步，而不是直接给出单一修复动作。

## 采集指标

### 数据源

- `SHOW GLOBAL STATUS` 和 `SHOW GLOBAL STATUS LIKE`：实例级累计计数器和瞬时值；
- Performance Schema 语句摘要：按摘要聚合的执行次数与时间分布；
- 慢查询日志和 `mysqldumpslow`/`pt-query-digest`：慢语句样例与聚合特征；
- `mysqld_exporter` 等导出器：把状态变量暴露给 Prometheus 等采集系统；
- 主机和存储监控：CPU、内存、磁盘、网络与文件系统容量。

`SHOW GLOBAL STATUS` 中的 `Queries`、`Slow_queries` 等累计计数器适合计算区间速率，不应直接把当前值当作瞬时故障。

```sql
SHOW GLOBAL STATUS LIKE 'Threads_connected';
SHOW GLOBAL STATUS LIKE 'Threads_running';
SHOW GLOBAL STATUS LIKE 'Max_used_connections';
SHOW GLOBAL STATUS LIKE 'Connection_errors%';

SHOW GLOBAL STATUS LIKE 'Questions';
SHOW GLOBAL STATUS LIKE 'Slow_queries';
SHOW GLOBAL STATUS LIKE 'Innodb_row_lock_time';
SHOW GLOBAL STATUS LIKE 'Innodb_deadlocks';
SHOW GLOBAL STATUS LIKE 'Innodb_buffer_pool_reads';
SHOW GLOBAL STATUS LIKE 'Innodb_buffer_pool_read_requests';

SHOW GLOBAL STATUS LIKE 'Created_tmp_tables';
SHOW GLOBAL STATUS LIKE 'Created_tmp_disk_tables';
```

### 指标解释

- 连接接近上限时，结合连接池活跃数、等待数和错误日志判断是容量不足还是泄漏。
- 临时表磁盘转换应观察 `Created_tmp_disk_tables/Created_tmp_tables` 的变化趋势，单个计数没有统一告警阈值。
- Buffer Pool 命中率是 `1 - Innodb_buffer_pool_reads/Innodb_buffer_pool_read_requests`，但工作集、读模型和冷启动都会影响它；不要把“低于 99%”当成普适调整规则。
- 死锁和慢查询适合看速率与受影响语句，而不是只看是否大于 0。

## 配置仪表盘

### 导出与抓取

示例配置包含敏感凭据，应放在权限受限的文件中，并使用最小权限监控账号：

```ini
# /etc/.mysqld_exporter.cnf
[client]
host=127.0.0.1
port=3306
user=exporter
password=replace-with-secret
```

```bash
mysqld_exporter \
  --config.my-cnf=/etc/.mysqld_exporter.cnf \
  --web.listen-address=:9104
```

```yaml
# prometheus.yml
scrape_configs:
  - job_name: mysql
    static_configs:
      - targets: ["192.0.2.10:9104"]
```

### 分层组织仪表盘

建议按决策顺序分层，而不是把所有图表堆在一起：

1. **实例总览**：可用性、QPS、连接、错误、CPU、内存和磁盘；
2. **InnoDB**：缓冲池、Redo、行锁、死锁、脏页和后台线程；
3. **复制与高可用**：复制线程、延迟、GTID 差异、故障切换状态；
4. **容量趋势**：表空间、Binlog、Undo、备份和增长预测；
5. **慢查询下钻**：语句摘要、执行计划变化和对应时间窗口。

社区 Dashboard ID 可以作为起点，但面板名称、指标名和单位会随 exporter 版本变化。导入后必须核对数据源、PromQL、时区和刷新频率。

## 设计告警

### 告警原则

- 优先告警业务影响或即将耗尽的资源，而不是每个异常计数器；
- 为持续时间设置 `for`，减少重启、部署和流量瞬变造成的噪声；
- 明确严重级别、负责人、首次处置步骤和抑制条件；
- 指标恢复只表示信号恢复，数据或复制需要另行验证。

```yaml
groups:
  - name: mysql_alerts
    rules:
      - alert: MySQLDown
        expr: mysql_up == 0
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: "MySQL 实例探测失败"
          runbook: "检查网络、端口、错误日志和主机资源"

      - alert: MySQLConnectionsNearLimit
        expr: >
          mysql_global_status_threads_connected
          / mysql_global_variables_max_connections
          > 0.8
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "MySQL 连接数超过上限的 80%"
          runbook: "区分业务峰值、复制连接与连接泄漏"

      - alert: MySQLSlowQueryRateHigh
        expr: rate(mysql_global_status_slow_queries[5m]) > 1
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "慢查询速率持续升高"
          runbook: "按语句摘要、时间窗和执行计划下钻"
```

示例阈值只是格式演示。连接比例、慢查询速率和复制延迟阈值必须基于历史基线、业务 SLO、故障演练和误报率调整。复制指标名称取决于 exporter 版本，部署前先核对实际暴露名称。

## 分析慢查询

1. 按发生时间对齐应用错误、流量、锁等待和资源曲线；
2. 用慢查询日志或 Performance Schema 找到高频和高耗时摘要；
3. 对代表性参数组合执行 `EXPLAIN`，比较扫描行数和实际耗时；
4. 修复后验证延迟分布、吞吐和资源占用，不只验证单条 SQL；
5. 把新增阈值、回归用例和观察窗口写入变更记录。

配置和分析入口见[执行计划](../04-query-optimization/chapter-01-execution-plan.md)、[索引优化](../03-index/chapter-04-index-optimization.md)和[性能调优实战](../10-practice/chapter-05-performance-tuning.md)。
