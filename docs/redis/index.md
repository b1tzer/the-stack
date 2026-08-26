# Redis 技术体系

从数据结构到高可用的完整知识体系，五卷二十六章。

## 目录结构

### 01-data-model
- [概览](01-data-model/chapter-01-overview) — Redis 是什么、为什么快、适用场景
- [基础类型](01-data-model/chapter-02-basic-types) — String/List/Hash/Set/ZSet 命令与底层编码
- [高级类型](01-data-model/chapter-03-advanced-types) — Bitmap/HyperLogLog/Stream/Geospatial
- [数据结构](01-data-model/chapter-04-data-structures) — SDS/ziplist/listpack/quicklist/skiplist/intset
- [对象编码](01-data-model/chapter-05-object-encoding) — 编码转换阈值、OBJECT ENCODING 命令

### 02-standalone-core
- [线程模型](02-standalone-core/chapter-01-thread-model) — 单线程为什么快、多线程 I/O
- [命令与 RESP](02-standalone-core/chapter-02-command-resp) — RESP 协议、命令执行流程
- [RDB](02-standalone-core/chapter-03-rdb) — fork/COW、bgsave、RDB 文件格式
- [AOF](02-standalone-core/chapter-04-aof) — 重写机制、混合持久化
- [过期策略](02-standalone-core/chapter-05-expiration) — 惰性删除、定期删除、内存释放
- [淘汰策略](02-standalone-core/chapter-06-eviction) — LRU/LFU/TTL、8 种策略对比

### 03-cache-engineering
- [穿透](03-cache-engineering/chapter-01-penetration) — 缓存空值、布隆过滤器
- [击穿](03-cache-engineering/chapter-02-breakdown) — 热 Key 过期、互斥锁、逻辑过期
- [雪崩](03-cache-engineering/chapter-03-avalanche) — 大面积过期、随机 TTL、多级缓存
- [一致性](03-cache-engineering/chapter-04-consistency) — Cache Aside、延迟双删、Binlog 订阅
- [大 Key 与热 Key](03-cache-engineering/chapter-05-big-hot-key) — 发现手段、拆分方案、本地缓存

### 04-high-availability
- [主从复制](04-high-availability/chapter-01-replication) — 全量/增量复制、复制积压缓冲区
- [哨兵](04-high-availability/chapter-02-sentinel) — 故障检测、Leader 选举、客户端路由
- [集群](04-high-availability/chapter-03-cluster) — Hash Slot、Gossip 协议、MOVED/ASK 重定向
- [分布式锁](04-high-availability/chapter-04-distributed-lock) — SET NX EX、Redlock、看门狗续期
- [事务与 Lua](04-high-availability/chapter-05-transaction-lua) — MULTI/EXEC、Lua 脚本原子性
- [Pipeline 与 Pub/Sub](04-high-availability/chapter-06-pipeline-pubsub) — 批量命令、发布订阅

### 05-operations
- [性能](05-operations/chapter-01-performance) — 慢查询、内存分析、客户端优化
- [排障](05-operations/chapter-02-troubleshooting) — 阻塞排查、主从不一致、集群故障
- [监控](05-operations/chapter-03-monitoring) — INFO 命令、Prometheus + Grafana
- [踩坑](05-operations/chapter-04-pitfalls) — 真实案例、常见误区
- [实战项目](05-operations/chapter-05-hands-on-project) — 限流器、排行榜、延迟队列
