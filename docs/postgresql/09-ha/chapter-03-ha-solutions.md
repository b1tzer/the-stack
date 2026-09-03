---
doc_id: pg-ha-solutions
title: 高可用方案
---

# 高可用方案

> **核心问题**：PostgreSQL 有哪些高可用方案？Patroni、repmgr、pg_auto_failover 怎么选？

## 1. 方案对比

| 特性 | Patroni | repmgr | pg_auto_failover |
| :-- | :-- | :-- | :-- |
| 自动故障切换 | ✅ | ✅ | ✅ |
| 自动从库搭建 | ✅ | ✅ | ✅ |
| 依赖组件 | etcd/ZK/Consul | 无（内置） | 监控节点 |
| 同步复制 | ✅ | ✅ | ✅ |
| 配置复杂度 | 中 | 低 | 低 |
| 社区活跃度 | 高 | 中 | 中 |
| 适用场景 | 大规模集群 | 中小规模 | 简单 HA |

## 2. Patroni

```yaml
# patroni.yml
scope: pg-cluster
name: node1

restapi:
  listen: 0.0.0.0:8008
  connect_address: 192.168.1.101:8008

etcd3:
  hosts: 192.168.1.1:2379,192.168.1.2:2379,192.168.1.3:2379

bootstrap:
  dcs:
    ttl: 30
    loop_wait: 10
    retry_timeout: 10
    maximum_lag_on_failover: 1048576
    synchronous_mode: true
    postgresql:
      use_pg_rewind: true
      parameters:
        max_connections: 200
        shared_buffers: 4GB
        wal_level: replica
        max_wal_senders: 10

postgresql:
  listen: 0.0.0.0:5432
  connect_address: 192.168.1.101:5432
  data_dir: /var/lib/postgresql/16/main
  authentication:
    superuser:
      username: postgres
      password: secret
    replication:
      username: replicator
      password: secret
```

```bash
# 启动 Patroni
patroni /etc/patroni/patroni.yml

# 查看集群状态
patronictl -c /etc/patroni/patroni.yml list

# 手动切换主库
patronictl -c /etc/patroni/patroni.yml switchover
```

## 3. repmgr

```bash
# 注册主节点
repmgr -f /etc/repmgr.conf primary register

# 克隆从节点
repmgr -h 192.168.1.101 -U repmgr -d repmgr standby clone

# 注册从节点
repmgr -f /etc/repmgr.conf standby register

# 查看集群状态
repmgr -f /etc/repmgr.conf cluster show

# 手动切换
repmgr -f /etc/repmgr.conf standby switchover
```

## 4. pg_auto_failover

```bash
# 创建监控节点
pg_autoctl create monitor --pgdata /var/lib/postgresql/monitor

# 创建主节点
pg_autoctl create postgres --pgdata /var/lib/postgresql/16/main \
  --monitor 'postgres://autoctl_node@monitor:5432/pg_auto_failover'

# 创建从节点
pg_autoctl create postgres --pgdata /var/lib/postgresql/16/standby \
  --monitor 'postgres://autoctl_node@monitor:5432/pg_auto_failover'

# 查看状态
pg_autoctl show state
```

## 5. HA 最佳实践

| 实践 | 说明 |
| :-- | :-- |
| 使用复制槽 | 防止 WAL 被过早清理 |
| 设置最大延迟 | `maximum_lag_on_failover` 防止延迟过大的从库被提升 |
| 同步复制 | 金融场景使用同步复制，防止数据丢失 |
| 定期测试切换 | 定期演练故障切换，确保方案可行 |
| 监控复制延迟 | 及时发现复制问题 |
| 避免脑裂 | 使用 etcd/ZK 等一致性存储做 leader 选举 |
