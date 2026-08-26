# NewSQL

## 1. TiDB

- 兼容 MySQL 协议
- 分布式事务
- 水平扩展

```bash
# TiUP 部署
tiup cluster deploy mydb v7.5.0 topology.yaml
tiup cluster start mydb
```

## 2. CockroachDB

- 兼容 PostgreSQL 协议
- 强一致性
- 自动分片

## 3. 适用场景

| 场景 | MySQL | NewSQL |
|------|-------|--------|
| 单机百万级 | ✅ | 过度 |
| 千万级分库分表 | 复杂 | ✅ |
| 亿级数据 | 分库分表 | ✅ |
| 强一致分布式 | ❌ | ✅ |

## 4. 迁移注意

- TiDB 不支持外键（6.6 前）
- 事务大小限制
- 自增 ID 行为不同

## 5. TiDB 架构详解

```
┌─────────────────────────────────────────┐
│              TiDB Server                │  SQL 层（无状态，可水平扩展）
│  ├─ SQL Parser                          │
│  ├─ Optimizer                           │
│  └─ Executor                            │
├─────────────────────────────────────────┤
│              PD (Placement Driver)      │  调度层（元数据、TSO、调度）
│  ├─ TSO (Timestamp Oracle)              │
│  ├─ Region 调度                         │
│  └─ 负载均衡                            │
├─────────────────────────────────────────┤
│              TiKV                       │  存储层（分布式 KV，Raft 共识）
│  ├─ Region (96MB 数据分片)              │
│  ├─ Raft Group (3 副本)                 │
│  └─ RocksDB (底层存储引擎)              │
└─────────────────────────────────────────┘
```

```bash
# TiDB 部署（使用 TiUP）
# 安装 TiUP
curl --proto '=https' --tlsv1.2 -sSf https://tiup-mirrors.pingcap.com/install.sh | sh

# 初始化集群拓扑
tiup cluster template > topology.yaml
# 编辑 topology.yaml 配置节点信息

# 部署集群
tiup cluster deploy mydb v7.5.0 topology.yaml -u root -p

# 启动集群
tiup cluster start mydb

# 查看集群状态
tiup cluster display mydb

# 连接 TiDB
mysql -h 192.168.1.100 -P 4000 -u root
```

## 6. TiDB vs MySQL 兼容性

| 特性 | MySQL | TiDB | 说明 |
|------|-------|------|------|
| 事务 | 支持 | 支持 | TiDB 事务有大小限制 |
| 外键 | 支持 | 6.6+ 支持 | 早期版本不支持 |
| 存储过程 | 支持 | 7.5+ 实验性 | 建议应用层实现 |
| 触发器 | 支持 | 不支持 | 使用 CDC 替代 |
| 自增 ID | 连续递增 | 不连续 | 分布式环境保证唯一但不连续 |
| 字符集 | utf8mb4 | utf8mb4 | 完全兼容 |
| JSON | 支持 | 支持 | 完全兼容 |
| 窗口函数 | 8.0+ | 支持 | 完全兼容 |
| 分区表 | 支持 | 不需要 | TiDB 自动分片 |

## 7. CockroachDB 简介

```bash
# CockroachDB 部署
# 下载并安装
wget https://binaries.cockroachdb.com/cockroach-v23.1.0.linux-amd64.tgz
tar xzf cockroach-v23.1.0.linux-amd64.tgz
cp cockroach-v23.1.0.linux-amd64/cockroach /usr/local/bin/

# 启动节点
cockroach start --insecure --store=node1 --listen-addr=localhost:26257 --http-addr=localhost:8080
cockroach start --insecure --store=node2 --listen-addr=localhost:26258 --http-addr=localhost:8081 --join=localhost:26257
cockroach start --insecure --store=node3 --listen-addr=localhost:26259 --http-addr=localhost:8082 --join=localhost:26257

# 初始化集群
cockroach init --insecure --host=localhost:26257

# 连接
cockroach sql --insecure --host=localhost:26257
```

**CockroachDB 特点：**
- 兼容 PostgreSQL 协议
- 强一致性分布式事务
- 自动分片和负载均衡
- 地理位置感知的数据放置
- 适合全球分布式部署

## 8. NewSQL 迁移注意事项

| 注意项 | 说明 |
|--------|------|
| 自增 ID | 分布式环境不连续，应用不能依赖连续性 |
| 大事务 | TiDB 事务默认限制 10GB，需要分批 |
| 热点写入 | 避免自增主键导致热点，使用 AUTO_RANDOM |
| 外键 | 性能开销大，建议应用层保证 |
| 存储过程 | 尽量迁移到应用层 |
| 全局唯一约束 | 性能开销大，慎用 |

## 9. 最佳实践

1. **单机能解决就不要分布式** — NewSQL 有额外的复杂度和开销
2. **评估迁移成本** — 存储过程、触发器等需要重写
3. **选择合适的 NewSQL** — TiDB（MySQL 兼容）/ CockroachDB（PG 兼容）
4. **数据量超过单机能力时考虑** — 通常在 TB 级别以上
5. **使用 AUTO_RANDOM 替代 AUTO_INCREMENT** — 避免热点写入
6. **监控 Region 分布** — 确保数据均匀分布

