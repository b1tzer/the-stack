# Elasticsearch 参数速查

> 本文以 Elasticsearch 8.x 为基线，线程池、堆内存等默认值随版本变化，实际运行值以 `GET /_nodes/thread_pool`、`GET /_nodes/stats/jvm` 查询为准。

## JVM 配置（jvm.options）

| 参数 | 默认值 | 推荐值 | 说明 |
| :-- | :-- | :-- | :-- |
| `-Xms` / `-Xmx` | 自动计算 | 手动设置时：≤ 可用内存 50%，且不超过压缩指针阈值（约 26GB） | 堆内存，两端设相同值；7.11 起按节点角色和可用内存自动配置，容器环境按容器内存计算 |
| `-XX:+UseG1GC` | 已启用 | 已启用（通常无需手工指定） | 使用 G1 垃圾回收器 |
| `-XX:MaxGCPauseMillis` | 200 | 200 | GC 目标暂停时间（JVM 默认 200ms），非保证值 |

## 集群配置（elasticsearch.yml）

| 参数 | 默认值 | 推荐值 | 说明 |
| :-- | :-- | :-- | :-- |
| `cluster.name` | elasticsearch | 自定义 | 集群名称 |
| `node.name` | 自动生成 | 节点主机名 | 节点名称 |
| `node.roles` | all | 按需分配 | 常见角色：master/data/ingest；未显式配置时承担一组内置角色（含 data_* 角色） |
| `path.data` | 依发行方式而异 | SSD 路径 | 数据目录（Debian/RPM 包默认 /var/lib/elasticsearch；多路径自 8.0 起移除） |
| `path.logs` | 依发行方式而异 | 自定义 | 日志目录（Debian/RPM 包默认 /var/log/elasticsearch） |
| `network.host` | 127.0.0.1 | 按部署环境绑定 | 绑定地址；`0.0.0.0` 监听所有网卡，生产须配网络隔离与安全认证 |
| `http.port` | 9200 | 9200 | HTTP 端口 |
| `transport.port` | 9300 | 9300 | 节点间通信端口 |
| `discovery.seed_hosts` | - | 种子节点地址 | 集群发现种子地址，不必列出所有 master 节点 |
| `cluster.initial_master_nodes` | - | 首次引导时列出 | 仅用于首次集群引导，引导完成后移除 |

## 索引配置

| 参数 | 默认值 | 说明 |
| :-- | :-- | :-- |
| `number_of_shards` | 1 | 主分片数（创建后不可直接改，需 split/shrink/reindex 调整） |
| `number_of_replicas` | 1 | 副本数（可动态修改） |
| `refresh_interval` | 1s | 刷新间隔，-1=关闭 |
| `translog.durability` | request | request=请求确认前同步 translog，async=异步同步（有丢失窗口） |
| `translog.sync_interval` | 5s | 异步刷盘间隔 |
| `merge.scheduler.max_thread_count` | 自动 | 合并线程数 |
| `index.codec` | default | 压缩算法，best_compression 更高压缩比但 CPU 开销更大 |

## 搜索配置

| 参数 | 默认值 | 说明 |
| :-- | :-- | :-- |
| `max_result_window` | 10000 | from+size 最大值 |
| `max_inner_result_window` | 100 | inner_hits 的 from+size 最大值 |
| `search.max_buckets` | 65536 | 聚合最大桶数 |
| `indices.query.bool.max_clause_count` | 动态计算 | bool 查询最大子句数；8.0 起静态设置已弃用，限制值由 ES 动态计算（最低 1024） |

## 线程池配置

| 线程池 | 类型 | 默认大小 | 说明 |
| :-- | :-- | :-- | :-- |
| `search` | fixed | `(可用处理器数 * 3) / 2 + 1` | 搜索请求 |
| `write` | fixed | 可用处理器数 | 写入请求（bulk 走此线程池） |
| `get` | fixed | 可用处理器数 | GET 请求 |

> Bulk API 没有独立的 bulk 线程池，写入统一由 write 线程池处理。上表为常见默认值，实际以 `GET /_nodes/thread_pool` 查询结果为准。
