# 首次生产部署

## 硬件规划

| 组件 | 建议 |
| :-- | :-- |
| 内存 | ≥ 32G（堆内存设为物理内存一半左右，且 ≤ 32G，其余为 OS 文件缓存及其他非堆内存开销预留） |
| 磁盘 | SSD，IOPS ≥ 10000，多盘用 RAID 或 LVM 合并为单一文件系统 |
| CPU | ≥ 8 核 |
| 网络 | 万兆网卡（集群内部通信） |

> 上表为首次部署的示例性估算值，不是 Elasticsearch 官方通用要求，也不是最低要求。实际规格需按压测结果与峰值负载确定，并验证副本分布、节点冗余与故障恢复能力。

## 节点角色规划

| 角色 | 建议规模 | 说明 |
| :-- | :-- | :-- |
| master | 3 | 专用 master，不存数据（三节点为常见方案，非固定拓扑） |
| data_hot | ≥ 2 | 热数据节点，SSD |
| data_warm | ≥ 2 | 温数据节点，HDD（可选） |
| ingest | ≥ 2 | 预处理节点（可选） |
| coordinating | ≥ 2 | 协调节点（可选） |

## 关键配置

```yaml
# elasticsearch.yml
cluster.name: production-cluster
node.name: node-1
node.roles: [master]

network.host: 10.0.0.1  # 示例：绑定内网网卡 IP，并配合网络层访问控制限制访问范围
http.port: 9200
transport.port: 9300

discovery.seed_hosts: ["master-1", "master-2", "master-3"]
# 仅用于全新集群的首次引导，集群形成后必须从所有节点移除
cluster.initial_master_nodes: ["master-1", "master-2", "master-3"]

# 安全（传输层 TLS 需配置证书与信任关系，自动安全配置生成的证书需按部署方式管理生命周期）
xpack.security.enabled: true
xpack.security.transport.ssl.enabled: true

# 路径（多盘建议用 RAID/LVM 合并为单一文件系统）
path.data: /data/elasticsearch
path.logs: /var/log/elasticsearch
```

`cluster.initial_master_nodes` 只用于全新集群的首次引导。首次成功形成集群后，从所有节点删除该参数，后续节点加入与集群重启依赖 `discovery.seed_hosts` 等发现配置，不要再设置它，否则在特定错误配置下可能引导出另一个集群。

## JVM 配置

```bash
# jvm.options
-Xms16g
-Xmx16g
-XX:+UseG1GC
-XX:MaxGCPauseMillis=200  # 可选：暂停时间目标，非硬性上限
```

## 安全加固

```bash
# 8.x：设置或重置 elastic 内置用户密码
bin/elasticsearch-reset-password -u elastic -i
# 7.x 及更早版本使用
# bin/elasticsearch-setup-passwords interactive

# 创建只读用户（密码用占位符替换，不要复用示例密码）
POST /_security/role/read_only
{ "indices": [{ "names": ["*"], "privileges": ["read"] }] }

POST /_security/user/readonly
{ "password": "<your-password>", "roles": ["read_only"] }
```

## 监控

| 指标 | 说明 | 告警阈值 | 诊断入口 |
| :-- | :-- | :-- | :-- |
| 集群健康状态 | green/yellow/red | red 立即告警；yellow 按容忍度设持续时间 | `_cluster/health` |
| 节点磁盘使用率 | 数据盘空间 | > 80% 告警 | `_cat/allocation` |
| JVM 堆使用率 | 堆内存 | > 75% 告警 | `_nodes/stats/jvm` |
| GC 暂停时间 | 单次 GC 暂停时长 | > 1s 告警 | GC 日志 / 监控采集单次暂停事件 |
| 搜索延迟 | P99 查询耗时 | > 500ms 告警 | 应用侧 / APM 耗时分布 |
| 索引速率 | 每秒写入文档数 | 基线监控 | 按时间窗口的写入计数差值 |
| 未分配分片 | 分片分配失败 | > 0 告警 | `_cat/shards` 定位 + `_cluster/allocation/explain` 分析 |

> 阈值为初始参考值，最终需按业务 SLO 与压测结果调整。
