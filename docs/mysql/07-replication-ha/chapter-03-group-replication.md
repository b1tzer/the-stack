# 组复制 (MGR)

## 1. 什么是 MGR

MySQL Group Replication，基于 Paxos 协议的多主复制。

## 2. 配置

```ini
# my.cnf
plugin_load_add = 'group_replication.so'
group_replication_group_name = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
group_replication_start_on_boot = OFF
group_replication_local_address = "192.168.1.100:33061"
group_replication_group_seeds = "192.168.1.100:33061,192.168.1.101:33061,192.168.1.102:33061"
group_replication_single_primary_mode = ON  # 单主模式
```

## 3. 单主 vs 多主

| 模式 | 说明 |
|------|------|
| 单主 | 只有一个可写，其他只读（推荐） |
| 多主 | 所有节点可写，需处理冲突 |

多主模式的限制：

1. 不支持 `SERIALIZABLE` 隔离级别
2. 不支持级联约束检查（外键）
3. 不支持大事务（超过 `group_replication_transaction_size_limit`）
4. 所有表必须有主键

```sql
-- 切换到多主模式
STOP GROUP_REPLICATION;
SET GLOBAL group_replication_single_primary_mode = OFF;
SET GLOBAL group_replication_enforce_update_everywhere_checks = ON;
START GROUP_REPLICATION;

-- 切换回单主模式
STOP GROUP_REPLICATION;
SET GLOBAL group_replication_single_primary_mode = ON;
SET GLOBAL group_replication_enforce_update_everywhere_checks = OFF;
START GROUP_REPLICATION;
```

## 4. 监控

```sql
SELECT * FROM performance_schema.replication_group_members;
SELECT * FROM performance_schema.replication_group_member_stats;
```

## 5. MGR 部署实战

```ini
# 完整的 MGR 配置（3 节点）
[mysqld]
# 基础配置
server-id = 1  # 每个节点不同
gtid_mode = ON
enforce_gtid_consistency = ON
binlog_checksum = NONE
log_bin = mysql-bin
binlog_format = ROW
log_slave_updates = ON
master_info_repository = TABLE
relay_log_info_repository = TABLE

# MGR 配置
plugin_load_add = 'group_replication.so'
group_replication_group_name = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"  # 所有节点相同
group_replication_start_on_boot = OFF
group_replication_local_address = "192.168.1.100:33061"  # 每个节点不同
group_replication_group_seeds = "192.168.1.100:33061,192.168.1.101:33061,192.168.1.102:33061"
group_replication_single_primary_mode = ON  # 单主模式
group_replication_enforce_update_everywhere_checks = OFF  # 单主模式下关闭
```

```sql
-- 节点 1 初始化 MGR
SET GLOBAL group_replication_bootstrap_group = ON;
START GROUP_REPLICATION;
SET GLOBAL group_replication_bootstrap_group = OFF;

-- 节点 2、3 加入 MGR
START GROUP_REPLICATION;

-- 查看组成员
SELECT * FROM performance_schema.replication_group_members;
-- MEMBER_STATE: ONLINE / RECOVERING / OFFLINE
```

## 6. MGR 故障处理

```sql
-- 节点故障自动处理
-- 1. 少数节点故障（1/3）→ 集群继续运行
-- 2. 多数节点故障 → 集群停止服务

-- 手动踢出故障节点
SELECT group_replication_remove_member('192.168.1.102:33061');

-- 重新加入故障节点
-- 在故障节点上执行
STOP GROUP_REPLICATION;
START GROUP_REPLICATION;

-- 查看组状态
SELECT * FROM performance_schema.replication_group_member_stats;
-- COUNT_TRANSACTIONS_IN_QUEUE: 等待提交的事务数
-- COUNT_TRANSACTIONS_CHECKED: 已检查的事务数
-- COUNT_TRANSACTIONS_ROWS_VALIDATING: 验证集大小
```

## 7. MGR vs 传统主从复制

| 特性 | 传统主从 | MGR |
|------|---------|-----|
| 数据一致性 | 最终一致 | 强一致（Paxos） |
| 自动故障转移 | 需要 MHA/Orchestrator | 内置 |
| 多写支持 | 不支持 | 多主模式支持 |
| 性能 | 高 | 略低（共识开销） |
| 节点数 | 1 主 N 从 | 建议奇数节点（3/5/7） |
| 适用场景 | 读写分离 | 高可用要求高 |

## 8. 最佳实践

1. **使用单主模式** — 多主模式限制多，问题排查复杂
2. **部署奇数节点** — 3 节点容忍 1 个故障，5 节点容忍 2 个
3. **监控 MGR 状态** — 关注 MEMBER_STATE 和延迟
4. **避免大事务** — 超过 `group_replication_transaction_size_limit` 会失败
5. **所有表必须有主键** — MGR 强制要求
6. **配合 MySQL Router 实现自动路由**

