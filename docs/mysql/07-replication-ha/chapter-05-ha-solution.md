# 高可用方案

> MySQL 高可用方案的选择取决于业务对数据一致性、切换时间、运维复杂度的要求。

## 1. 方案对比

| 方案 | 切换时间 | 数据一致性 | 运维复杂度 | 适用场景 |
|------|----------|-----------|-----------|----------|
| 主从 + 手动切换 | 分钟级 | 可能丢数据 | 低 | 非核心业务 |
| MHA | 秒级 | 最多丢1条 | 中 | 通用场景 |
| MGR (Group Replication) | 秒级 | 强一致 | 中 | 核心业务 |
| Orchestrator | 秒级 | 可配置 | 中 | 大规模集群 |
| ProxySQL + 主从 | 秒级 | 可配置 | 中 | 读写分离 |

## 2. MHA（Master High Availability）

```text
Master 故障
  → MHA Manager 检测到
  → 从所有 Slave 中选择数据最新的
  → 补齐差异日志
  → 提升为新 Master
  → 其他 Slave 指向新 Master
  → VIP 漂移到新 Master
```

## 3. MGR（MySQL Group Replication）

```text
Node 1 ←──→ Node 2 ←──→ Node 3
         Paxos 协议

写入需要多数节点确认（和 Kafka ISR 类似）
```

| 模式 | 说明 |
|------|------|
| 单主模式 | 只有一个节点可写，其他只读 |
| 多主模式 | 所有节点可写，需要处理冲突 |

## 4. 读写分离

```text
App → ProxySQL → Master（写）
                → Slave 1（读）
                → Slave 2（读）
```

```sql
-- ProxySQL 配置
INSERT INTO mysql_servers VALUES (1, 'master', 3306, ...);
INSERT INTO mysql_servers VALUES (2, 'slave1', 3306, ...);
INSERT INTO mysql_servers VALUES (3, 'slave2', 3306, ...);

-- 读写分离规则
INSERT INTO mysql_query_rules VALUES (1, '^SELECT', 0, 2);  -- SELECT 走 Slave
```

### 读写分离的问题

- 主从延迟导致读到旧数据
- 写后立即读可能不一致
- 解决方案：关键读走 Master，或使用半同步复制

## 5. 选型建议

| 场景 | 推荐方案 |
|------|----------|
| 小规模、非核心 | 主从 + 手动切换 |
| 通用业务 | MHA 或 Orchestrator |
| 金融、强一致 | MGR 单主模式 |
| 读多写少 | ProxySQL 读写分离 |
| 云环境 | RDS 高可用版 |
