# MySQL 参数速查

> 生产环境最常调整的参数，按功能分类。所有参数均基于 MySQL 8.0。

## 连接与线程

| 参数 | 默认值 | 推荐值 | 说明 |
|------|--------|--------|------|
| `max_connections` | 151 | 500~2000 | 最大连接数，按业务并发调整 |
| `max_connect_errors` | 100 | 100000 | 连续错误次数上限，超过后拒绝连接 |
| `wait_timeout` | 28800 | 300~600 | 空闲连接超时（秒） |
| `interactive_timeout` | 28800 | 300~600 | 交互式连接超时（秒） |
| `thread_cache_size` | 9 | 64~128 | 线程缓存，减少线程创建开销 |

## InnoDB 缓冲池

| 参数 | 默认值 | 推荐值 | 说明 |
|------|--------|--------|------|
| `innodb_buffer_pool_size` | 128M | 物理内存的 60%~80% | 最关键参数，决定缓存能力 |
| `innodb_buffer_pool_instances` | 1 | 8（≥8G 内存时） | 缓冲池实例数，减少锁竞争 |
| `innodb_buffer_pool_dump_at_shutdown` | ON | ON | 关闭时保存热数据索引 |
| `innodb_buffer_pool_load_at_startup` | ON | ON | 启动时加载热数据索引 |

## Redo Log

| 参数 | 默认值 | 推荐值 | 说明 |
|------|--------|--------|------|
| `innodb_redo_log_capacity` | 100M | 1G~4G | Redo Log 总大小（8.0.30+） |
| `innodb_flush_log_at_trx_commit` | 1 | 1（强一致）/ 2（高性能） | 1=每次提交刷盘，2=每秒刷盘 |
| `innodb_log_buffer_size` | 16M | 64M~256M | 日志缓冲区大小 |

## Binlog

| 参数 | 默认值 | 推荐值 | 说明 |
|------|--------|--------|------|
| `log_bin` | OFF | ON | 开启 Binlog（主从复制必须） |
| `binlog_format` | ROW | ROW | 推荐 ROW 格式 |
| `binlog_expire_logs_seconds` | 2592000 | 604800 | Binlog 保留时间（秒） |
| `sync_binlog` | 1 | 1（强一致）/ 100（高性能） | 每 N 次提交同步 Binlog |

## 查询与排序

| 参数 | 默认值 | 推荐值 | 说明 |
|------|--------|--------|------|
| `sort_buffer_size` | 256K | 2M~4M | 每个会话的排序缓冲区 |
| `join_buffer_size` | 256K | 2M~4M | 连接缓冲区 |
| `tmp_table_size` | 16M | 64M~128M | 内存临时表大小上限 |
| `max_heap_table_size` | 16M | 64M~128M | 内存引擎表大小上限 |
| `long_query_time` | 10 | 1 | 慢查询阈值（秒） |
| `slow_query_log` | OFF | ON | 开启慢查询日志 |

## 字符集与排序规则

| 参数 | 默认值 | 推荐值 | 说明 |
|------|--------|--------|------|
| `character_set_server` | utf8mb4 | utf8mb4 | 服务端字符集 |
| `collation_server` | utf8mb4_0900_ai_ci | utf8mb4_0900_ai_ci | 服务端排序规则 |

## 安全

| 参数 | 默认值 | 推荐值 | 说明 |
|------|--------|--------|------|
| `local_infile` | ON | OFF | 禁止 LOAD DATA LOCAL |
| `skip_symbolic_links` | OFF | ON | 禁用符号链接 |
| `sql_mode` | （含多种） | STRICT_TRANS_TABLES,NO_ENGINE_SUBSTITUTION | 严格模式 |
