---
doc_id: pg-ref-parameters
title: 参数速查表
---

# 参数速查表

## 内存参数

| 参数 | 默认值 | 推荐值 | 说明 |
| :-- | :-- | :-- | :-- |
| `shared_buffers` | 128MB | 物理内存 25% | 数据页缓存 |
| `effective_cache_size` | 4GB | 物理内存 75% | 优化器估算缓存大小 |
| `work_mem` | 4MB | 4-64MB | 排序/哈希操作内存（每操作） |
| `maintenance_work_mem` | 64MB | 512MB-2GB | VACUUM/CREATE INDEX 内存 |
| `wal_buffers` | -1（自动） | 64MB | WAL 日志缓存 |

## 连接参数

| 参数 | 默认值 | 推荐值 | 说明 |
| :-- | :-- | :-- | :-- |
| `max_connections` | 100 | 200-500 | 最大连接数 |
| `superuser_reserved_connections` | 3 | 3 | 超级用户预留连接 |
| `authentication_timeout` | 60s | 60s | 认证超时 |

## WAL 参数

| 参数 | 默认值 | 推荐值 | 说明 |
| :-- | :-- | :-- | :-- |
| `wal_level` | replica | replica/logical | WAL 级别 |
| `max_wal_senders` | 10 | 10 | 最大 WAL 发送进程 |
| `max_wal_size` | 1GB | 4GB | 触发检查点的 WAL 大小 |
| `min_wal_size` | 80MB | 80MB | WAL 最小保留 |
| `wal_compression` | off | on (PG15+) | WAL 压缩 |

## 检查点参数

| 参数 | 默认值 | 推荐值 | 说明 |
| :-- | :-- | :-- | :-- |
| `checkpoint_timeout` | 5min | 5min | 检查点间隔 |
| `checkpoint_completion_target` | 0.5 | 0.9 | 检查点完成目标 |

## 优化器参数

| 参数 | 默认值 | SSD 推荐 | 说明 |
| :-- | :-- | :-- | :-- |
| `random_page_cost` | 4.0 | 1.1 | 随机 IO 代价 |
| `effective_io_concurrency` | 1 | 200 | 并发 IO 能力 |
| `default_statistics_target` | 100 | 100 | 统计信息采样量 |

## Autovacuum 参数

| 参数 | 默认值 | 说明 |
| :-- | :-- | :-- |
| `autovacuum` | on | 自动清理开关 |
| `autovacuum_max_workers` | 3 | 最大工作进程 |
| `autovacuum_naptime` | 1min | 检查间隔 |
| `autovacuum_vacuum_threshold` | 50 | 触发阈值（行数） |
| `autovacuum_vacuum_scale_factor` | 0.2 | 触发比例（20%） |
| `autovacuum_vacuum_cost_delay` | 2ms | IO 延迟 |
| `autovacuum_vacuum_cost_limit` | -1 | IO 代价限制 |

## 日志参数

| 参数 | 默认值 | 推荐值 | 说明 |
| :-- | :-- | :-- | :-- |
| `log_min_duration_statement` | -1 | 1000 | 记录慢查询（ms） |
| `log_checkpoints` | off | on | 记录检查点 |
| `log_statement` | none | ddl | 记录 SQL 类型 |
| `log_line_prefix` | '%m [%p] | '%m [%p] %u@%d ' | 日志前缀 |
