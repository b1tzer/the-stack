# 首次生产部署

## 硬件规划

| 组件 | 建议 |
|------|------|
| 内存 | ≥ 32G（堆内存 ≤ 32G，剩余给 OS 文件缓存） |
| 磁盘 | SSD，IOPS ≥ 10000，RAID 0 或单盘 |
| CPU | ≥ 8 核 |
| 网络 | 万兆网卡（集群内部通信） |

## 节点角色规划

| 角色 | 最少节点数 | 说明 |
|------|-----------|------|
| master | 3 | 专用 master，不存数据 |
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

network.host: 0.0.0.0
http.port: 9200
transport.port: 9300

discovery.seed_hosts: ["master-1", "master-2", "master-3"]
cluster.initial_master_nodes: ["master-1", "master-2", "master-3"]

# 安全
xpack.security.enabled: true
xpack.security.transport.ssl.enabled: true

# 路径（多磁盘）
path.data: ["/data1/elasticsearch", "/data2/elasticsearch"]
path.logs: /var/log/elasticsearch
```

## JVM 配置

```bash
# jvm.options
-Xms16g
-Xmx16g
-XX:+UseG1GC
-XX:MaxGCPauseMillis=200
```

## 安全加固

```bash
# 设置密码
bin/elasticsearch-setup-passwords interactive

# 创建只读用户
POST /_security/role/read_only
{ "indices": [{ "names": ["*"], "privileges": ["read"] }] }

POST /_security/user/readonly
{ "password": "password", "roles": ["read_only"] }
```

## 监控

| 指标 | 说明 | 告警阈值 |
|------|------|----------|
| 集群健康状态 | green/yellow/red | yellow > 5min 告警 |
| 节点磁盘使用率 | 数据盘空间 | > 80% 告警 |
| JVM 堆使用率 | 堆内存 | > 75% 告警 |
| GC 暂停时间 | GC 耗时 | > 1s 告警 |
| 搜索延迟 | P99 查询耗时 | > 500ms 告警 |
| 索引速率 | 每秒写入文档数 | 基线监控 |
| 未分配分片 | 分片分配失败 | > 0 告警 |
