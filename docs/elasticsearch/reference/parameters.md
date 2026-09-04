# Elasticsearch 参数速查

## JVM 配置（jvm.options）

| 参数 | 默认值 | 推荐值 | 说明 |
| :-- | :-- | :-- | :-- |
| `-Xms` / `-Xmx` | 1g | 物理内存的 50%（不超过 32G） | 堆内存，两端设相同值 |
| `-XX:+UseG1GC` | 是 | 是 | 使用 G1 垃圾回收器 |
| `-XX:MaxGCPauseMillis` | 200 | 200 | GC 最大暂停时间 |

## 集群配置（elasticsearch.yml）

| 参数 | 默认值 | 推荐值 | 说明 |
| :-- | :-- | :-- | :-- |
| `cluster.name` | elasticsearch | 自定义 | 集群名称 |
| `node.name` | 自动生成 | 节点主机名 | 节点名称 |
| `node.roles` | all | 按需分配 | 节点角色：master/data/ingest |
| `path.data` | /var/lib/elasticsearch | SSD 路径 | 数据目录（支持多路径） |
| `path.logs` | /var/log/elasticsearch | 自定义 | 日志目录 |
| `network.host` | 127.0.0.1 | 0.0.0.0 | 绑定地址 |
| `http.port` | 9200 | 9200 | HTTP 端口 |
| `transport.port` | 9300 | 9300 | 节点间通信端口 |
| `discovery.seed_hosts` | - | 所有 master 节点 | 集群发现列表 |
| `cluster.initial_master_nodes` | - | 所有 master 节点 | 初始 master 列表 |

## 索引配置

| 参数 | 默认值 | 说明 |
| :-- | :-- | :-- |
| `number_of_shards` | 1 | 主分片数（创建后不可改） |
| `number_of_replicas` | 1 | 副本数（可动态修改） |
| `refresh_interval` | 1s | 刷新间隔，-1=关闭 |
| `translog.durability` | request | request=每次写入刷盘，async=异步 |
| `translog.sync_interval` | 5s | 异步刷盘间隔 |
| `merge.scheduler.max_thread_count` | 自动 | 合并线程数 |
| `index.codec` | default | 压缩算法，best_compression 更高压缩比 |

## 搜索配置

| 参数 | 默认值 | 说明 |
| :-- | :-- | :-- |
| `max_result_window` | 10000 | from+size 最大值 |
| `max_inner_result_window` | 100 | 嵌套查询最大结果数 |
| `search.max_buckets` | 65536 | 聚合最大桶数 |
| `query.bool.max_clause_count` | 1024 | bool 查询最大子句数 |

## 线程池配置

| 线程池 | 类型 | 默认大小 | 说明 |
| :-- | :-- | :-- | :-- |
| `search` | fixed | CPU 核数 | 搜索请求 |
| `write` | fixed | CPU 核数 | 写入请求 |
| `get` | fixed | CPU 核数 | GET 请求 |
| `bulk` | fixed | CPU 核数 | 批量请求 |
