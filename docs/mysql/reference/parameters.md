# 常用参数速查

> 本页只记录参数用途、默认值和适用范围。参数背后的机制与调优方法见[性能调优](../10-practice/chapter-05-performance-tuning.md)和[首次生产部署](../10-practice/chapter-03-first-production.md)。

> 参数按功能分类，默认值以 MySQL 8.0 为基线；“配置原则”不是可直接套用的生产值。版本和小版本差异请用 `SHOW VARIABLES LIKE` 或官方文档确认。

## 连接与线程

| 参数 | 默认值 | 配置原则 | 说明 |
| :-- | :-- | :-- | :-- |
| `max_connections` | 151 | 按应用总峰值、管理与复制连接规划，并保留余量 | 最大连接数；调大前先排除连接泄漏 |
| `max_connect_errors` | 100 | 根据网络和客户端行为评估 | 连续连接失败达到阈值后拒绝该主机，直到执行 `FLUSH HOSTS` |
| `wait_timeout` | 28800 | 与连接池空闲策略协调 | 非交互式连接空闲超时（秒） |
| `interactive_timeout` | 28800 | 与交互会话需求协调 | 交互式连接空闲超时（秒） |
| `thread_cache_size` | -1（自动设置） | 根据 `Threads_created/Connections` 观察调整 | 线程缓存，减少线程创建开销；不要把 -1 当作固定缓存数 |

## InnoDB 缓冲池

| 参数 | 默认值 | 推荐值 | 说明 |
| :-- | :-- | :-- | :-- |
| `innodb_buffer_pool_size` | 128M | 独占服务器常从物理内存的 60%~80% 开始压测 | 缓冲池容量；共享主机需为系统和其他进程保留内存 |
| `innodb_buffer_pool_instances` | 1 | 与缓冲池容量和并发模型共同评估 | 缓冲池分片数；实例数越多，每个分片越小 |
| `innodb_buffer_pool_dump_at_shutdown` | ON | ON | 关闭时保存热数据索引 |
| `innodb_buffer_pool_load_at_startup` | ON | ON | 启动时加载热数据索引 |

## Redo Log

| 参数 | 默认值 | 推荐值 | 说明 |
| :-- | :-- | :-- | :-- |
| `innodb_redo_log_capacity` | 100M | 1G~4G | Redo Log 总大小（8.0.30+） |
| `innodb_flush_log_at_trx_commit` | 1 | 生产默认保留 1 | 1 表示每次提交刷 Redo；2 表示每秒刷盘，进程或系统崩溃时可能丢失已提交事务 |
| `innodb_log_buffer_size` | 16M | 64M~256M | 日志缓冲区大小 |

## Binlog

| 参数 | 默认值 | 推荐值 | 说明 |
| :-- | :-- | :-- | :-- |
| `log_bin` | 取决于发行版与启动方式 | 复制、PITR 或审计场景按方案启用 | Binlog 总开关；启用前评估磁盘、网络和保留策略 |
| `binlog_format` | ROW | ROW | 推荐 ROW 格式 |
| `binlog_expire_logs_seconds` | 2592000 | 不早于备份和恢复演练要求的最短时长 | Binlog 保留时间（秒） |
| `sync_binlog` | 1 | 需要耐受崩溃时保持 1 | 每 N 次提交同步 Binlog；大于 1 可提升吞吐，但系统崩溃时可能丢失已提交事务 |

## 查询与排序

| 参数 | 默认值 | 推荐值 | 说明 |
| :-- | :-- | :-- | :-- |
| `sort_buffer_size` | 256K | 仅对可证明受益的会话增大 | 每个需要排序的线程分配，不能无条件全局调大 |
| `join_buffer_size` | 256K | 仅对无索引连接的热点查询评估 | 每个未使用索引的连接分配 |
| `tmp_table_size` | 16M | 与 `max_heap_table_size` 同步评估 | 内存临时表大小上限 |
| `max_heap_table_size` | 16M | 与 `tmp_table_size` 同步评估 | MEMORY/内部内存表大小上限；两者取较小值生效 |
| `long_query_time` | 10 | 按业务延迟目标和采样开销设置 | 慢查询阈值（秒） |
| `slow_query_log` | OFF | ON | 开启慢查询日志 |

## 字符集与排序规则

| 参数 | 默认值 | 推荐值 | 说明 |
| :-- | :-- | :-- | :-- |
| `character_set_server` | utf8mb4 | utf8mb4 | 服务端字符集 |
| `collation_server` | utf8mb4_0900_ai_ci | utf8mb4_0900_ai_ci | 服务端排序规则 |

## 安全

| 参数 | 默认值 | 推荐值 | 说明 |
| :-- | :-- | :-- | :-- |
| `local_infile` | OFF | 保持 OFF，除非有明确迁移需求 | 控制客户端 `LOAD DATA LOCAL INFILE`；开启时同时限制客户端和服务器侧能力 |
| `--symbolic-links` | OFF | 保持默认关闭 | 控制 MyISAM 符号链接支持；该选项已弃用，不是 `skip_symbolic_links` 系统变量 |
| `sql_mode` | `ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION` | 优先保留官方默认值 | 兼容旧 SQL 而删除保护模式时，应先修正规则和查询，并记录临时兼容范围 |

参数变更前记录当前值、来源（配置文件或 `SET PERSIST`）、版本和变更目的。按同一组指标做变更前后对比，避免一次同时修改多个互相关联的参数。
