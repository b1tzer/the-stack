# 首次生产部署

本页是面向已有 Redis 基础的运维人员的部署操作指南，配置示例以 Redis 7.4.11 为基准。它回答一个问题：如何把 Redis 安全地部署到生产环境，并在上线前确认数据、网络、监控和故障恢复条件。

## 明确部署前提

开始配置前，先记录以下输入：

- 数据的恢复点目标（RPO）和恢复时间目标（RTO）。
- 预计数据量、峰值 QPS、平均值大小和大 Key 上限。
- 客户端只能从哪些网段访问 Redis。
- 数据是否允许被淘汰，以及故障转移时最多能接受多少已确认写入丢失。
- 是否需要跨机房部署，以及网络分区时允许哪一侧继续写入。

这些输入决定拓扑、持久化和淘汰策略。没有这些输入时，不应直接套用“推荐配置”。

## 限制网络访问

Redis 端口只允许受信任的应用服务器访问：

```conf
# 绑定到实例的私网地址，不要绑定到公网地址
bind 10.0.0.21
port 6379
protected-mode yes
```

同时完成以下检查：

1. 在主机防火墙或云安全组中，只允许应用网段访问 `6379`。
2. 不要把 Redis 端口映射到公网，也不要把端口暴露给办公网或不可信容器网络。
3. 使用 Redis ACL 创建按应用分离、只授必要命令和 Key 模式的用户。
4. Redis 与客户端跨越不可信网络时启用 TLS；密码通过密钥管理系统注入，不写入仓库。
5. 为管理命令设置审计和变更流程，不把 `rename-command` 当作认证措施。

官方[安全文档](https://redis.io/docs/latest/operate/oss_and_stack/management/security/)要求 Redis 端口只能被受信任客户端访问，并把 ACL 作为 Redis 6 之后推荐的认证方式。网络、ACL、TLS 和轮换步骤见[安全与访问控制](../04-operations/chapter-02-security-access.md)。

## 选择部署拓扑

拓扑不能单独保证“不丢数据”。先按下表选择：

| 主要约束 | 可考虑的拓扑 | 仍需处理的风险 |
| :-- | :-- | :-- |
| 数据量可放入单实例，需要自动故障转移 | 主从复制 + Sentinel | 异步复制可能丢失故障前未复制的写入 |
| 数据量或吞吐超过单实例 | Redis Cluster | 跨槽限制、迁移风险和分区写安全 |
| 只有单实例且可接受重启后重建 | 单实例 | 没有故障转移，单点可用性 |
| 需要分片但不要求 Redis 原生高可用 | 客户端分片或代理 | 需要自行处理拓扑、重试和故障转移 |

Sentinel 和 Redis Cluster 默认都使用异步复制，参见官方[复制说明](https://redis.io/docs/latest/operate/oss_and_stack/management/replication/)和 [Cluster 规范](https://redis.io/docs/latest/develop/reference/cluster-spec/)。Cluster 不等于“不丢数据”，Sentinel 也不等于“一定丢数据”；两者都需要根据 RPO 配置持久化、副本和写入保护。

## 配置内存和淘汰

先计算可用内存，再设置上限：

```text
Redis 可用内存 ≤ 容器/主机可用内存 - 操作系统和监控开销 - fork/COW 预留
```

```conf
# 示例：16 GiB 主机，先预留系统、监控和 fork 空间
maxmemory 10gb
maxmemory-policy noeviction
maxmemory-samples 10
```

`noeviction` 适合不能主动丢弃数据的实例：达到上限后写入会失败，必须配套告警和扩容。只有可重建的缓存才使用 `allkeys-lru` 或 `allkeys-lfu`；不要对主数据使用会淘汰全部 Key 的策略。

## 配置持久化

按 RPO 选择持久化，而不是默认照抄：

| RPO 要求 | 起点配置 | 需要验证 |
| :-- | :-- | :-- |
| 可接受最近数分钟数据丢失 | RDB 或从节点持久化 | 快照窗口、恢复时间和备份保留 |
| 需要较低的命令级丢失窗口 | AOF `everysec` | 磁盘吞吐、fsync 延迟和恢复时间 |
| 同时需要快速恢复和较细恢复点 | RDB + AOF | fork、磁盘容量和 AOF 重写影响 |

```conf
appendonly yes
appendfsync everysec
auto-aof-rewrite-percentage 100
auto-aof-rewrite-min-size 256mb
save 3600 1 300 100 60 10000
```

`everysec` 允许故障时丢失约一秒窗口的数据。`always` 提供更细的持久化保证，但会显著增加写延迟；是否使用必须通过目标磁盘和真实负载验证。把持久化转化为可执行流程见[备份、恢复与升级](../04-operations/chapter-03-backup-recovery.md)。

## 配置连接与慢日志

```conf
# 0 表示不主动断开空闲连接；不要为了“安全”盲目设置服务端超时
timeout 0
tcp-keepalive 300

slowlog-log-slower-than 10000
slowlog-max-len 128
```

客户端必须配置连接池上限、连接/读取超时、指数退避和重试上限。`timeout` 会主动断开空闲客户端，可能影响长连接或低频任务，应根据客户端行为决定。

## 上线前验证

- [ ] Redis 只监听私网或回环地址，公网和不可信网段无法连接。
- [ ] ACL 用户按应用隔离，凭据通过环境变量或密钥系统注入。
- [ ] `maxmemory` 与数据增长、淘汰策略和告警阈值一致。
- [ ] RDB、AOF 和备份均完成一次恢复演练。
- [ ] 主从复制延迟、复制偏移和故障转移经过演练。
- [ ] 客户端连接池、超时和重试不会在故障时放大流量。
- [ ] 大 Key、热 Key、慢命令和内存增长已有检测规则。
- [ ] 已定义 Redis 不可用时应用的降级或只读行为。

## 接入监控

至少采集以下指标，并按业务设置告警：

- 内存：`used_memory`、`used_memory_rss`、碎片率、淘汰次数。
- 延迟：命令延迟分位数、`SLOWLOG`、`latest_fork_usec`。
- 流量：QPS、网络入出带宽、客户端连接数。
- 数据：命中率、Key 数量、过期数量、主从复制偏移差。
- 持久化：RDB 最后保存时间、AOF 状态、磁盘剩余空间。
- 高可用：Sentinel 状态、Cluster 节点状态、故障转移次数。

上线后先观察一个完整业务周期，再逐步提高流量。监控指标的阈值应来自基线，而不是直接复制示例值。
