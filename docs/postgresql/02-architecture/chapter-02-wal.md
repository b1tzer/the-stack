---
doc_id: pg-wal
title: WAL 日志与崩溃恢复
---

# WAL 日志与崩溃恢复

> **核心问题：** 数据库如何保证在突然断电时不丢失已提交的事务？答案是 WAL（Write-Ahead Logging）— 先写日志，后写数据。WAL 不仅是崩溃恢复的基石，也是流复制和 PITR 的基础。理解 WAL 的原理，是掌握 PG 高可用架构的前提。

---

## 1. WAL 核心原理

**WAL（Write-Ahead Logging）** 的核心规则只有一条：

> **对数据页的修改，必须先将对应的 WAL 记录写入持久化存储，然后才能将修改后的数据页写入磁盘。**

这就是所谓的 **WAL 先写协议（Write-Ahead Protocol）**。

```
事务执行流程:

  BEGIN
    │
    ▼
  修改数据页 (在 Shared Buffers 中)
    │
    ▼
  生成 WAL 记录 → 写入 WAL Buffer
    │
    ▼
  COMMIT
    │
    ├──→ WAL Buffer → 刷入 WAL 文件 (pg_wal/)   ← 必须先完成
    │                     │
    │                     ▼
    │               fsync 确保落盘                 ← 此时事务才算提交
    │
    └──→ 脏页在 Shared Buffers 中等待              ← 后续由 Bg Writer / Checkpointer 刷盘
```

### 为什么需要 WAL？

| 问题 | 没有 WAL 的情况 | 有 WAL 的情况 |
|------|----------------|--------------|
| 事务提交后断电 | 数据可能还在内存，未写入磁盘 → 丢失 | WAL 已落盘 → 可恢复 |
| 脏页写到一半断电 | 数据页损坏 → 不一致 | 从 WAL 重放 → 恢复一致状态 |
| 随机 I/O vs 顺序 I/O | 每次修改都要随机写数据页 | WAL 是顺序写，性能更高 |

---

## 2. WAL 文件结构

WAL 日志存储在 `$PGDATA/pg_wal/` 目录下，由一系列 **段文件（Segment File）** 组成。

### 段文件基本属性

| 属性 | 值 |
|------|-----|
| **单个段文件大小** | 16MB（默认，编译时可通过 `--with-wal-segsize` 修改） |
| **命名格式** | `{时间线ID}{逻辑段号}{物理段号}`，各 8 位十六进制 |
| **示例** | `000000010000000000000001`（时间线 1，逻辑段 0，物理段 1） |
| **时间线 ID** | 24 位，标识数据库历史分支（PITR/故障切换后递增） |
| **逻辑段号** | 高 32 位 |
| **物理段号** | 低 32 位 |

```
pg_wal/
├── 000000010000000000000001   # 时间线1, 第1个16MB段
├── 000000010000000000000002   # 时间线1, 第2个16MB段
├── 000000010000000000000003   # 时间线1, 第3个16MB段
├── 000000010000000000000004   # 当前正在写入
└── archive_status/
    ├── 000000010000000000000001.done   # 已归档
    └── 000000010000000000000002.ready   # 等待归档
```

### WAL 记录结构

每条 WAL 记录包含：

```
┌──────────────────────────────────┐
│         WAL Record Header        │
│  - xl_tot_len:   记录总长度      │
│  - xl_xid:       事务 ID         │
│  - xl_prev:      前一条 WAL 的LSN│
│  - xl_rmid:      资源管理器 ID   │
│  - xl_info:      操作类型标志    │
│  - xl_tot_len:   CRC 校验        │
├──────────────────────────────────┤
│         Block Reference          │
│  - 关联的数据文件和页面号         │
├──────────────────────────────────┤
│         Record Data              │
│  - 实际的操作数据                 │
│  (如: INSERT 的行数据)            │
└──────────────────────────────────┘
```

---

## 3. LSN（Log Sequence Number）

LSN 是 WAL 日志中每条记录的唯一标识，本质上是一个 **64 位字节偏移量**，指向该记录在 WAL 流中的物理位置。

### LSN 格式

```
LSN 格式: 前32位/后32位 (十六进制)

示例: 0/15D6878
      │ │
      │ └── 低 32 位 (段内偏移)
      └──── 高 32 位 (逻辑段号)

字节偏移 = 高32位 × 16MB + 低32位
```

### LSN 的用途

| 用途 | 说明 |
|------|------|
| **WAL 记录排序** | LSN 递增，标识操作的先后顺序 |
| **数据页版本标记** | 每个数据页的 `pd_lsn` 记录最后修改它的 WAL LSN |
| **恢复起点** | Checkpoint 记录的 LSN 标识恢复应从哪里开始重放 |
| **复制同步** | 备库报告已重放的 LSN，主库据此判断同步状态 |
| **脏页判断** | 若 WAL 记录的 LSN > 数据页的 `pd_lsn`，说明该页需要重放此 WAL |

### 查看当前 LSN

```sql
-- 当前 WAL 写入位置
SELECT pg_current_wal_lsn();

-- 当前 WAL 文件名和偏移
SELECT pg_current_wal_insert_lsn();
SELECT pg_current_wal_flush_lsn();

-- 查看数据页的 LSN
SELECT lsn FROM pg_buffercache WHERE relfilenode = 16384 LIMIT 1;

-- 两个 LSN 之间的字节差
SELECT '0/15D6878'::pg_lsn - '0/15D6800'::pg_lsn;  -- = 120 字节
```

## 4. WAL 写入流程

```text
Backend Process                WAL Buffers              pg_wal/
    │                             │                       │
    │── 生成 WAL 记录 ──────────→   │                       │
    │   (写入 WAL Buffer)          │                       │
    │                             │                       │
    │── XLogInsert() ───────────→ │                       │
    │                             │                       │
    │── XLogFlush() (提交时) ────→ │                       │
    │                             │── 刷入 WAL 文件 ────→  │
    │                             │   (write + fsync)     │
    │                             │                       │
    │←── 返回 (事务已提交) ──────   │                       │
```

### WAL 写入的三种路径

| 路径 | 触发条件 | 关键参数 |
|------|---------|---------|
| **同步写入** | 事务提交时（`synchronous_commit = on`） | `wal_sync_method`（fsync/fdatasync 等） |
| **异步写入** | `synchronous_commit = off` 时，提交不等 fsync | 有数据丢失风险（最多 `wal_writer_delay` 时间窗口） |
| **WAL Buffer 满** | WAL Buffer 达到阈值自动写出 | `wal_buffers` |

### 关键参数

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `wal_level` | replica | WAL 记录的详细程度 |
| `wal_buffers` | -1 (自动) | WAL 缓冲区大小，通常为 shared_buffers 的 1/32 |
| `wal_writer_delay` | 200ms | WAL Writer 唤醒间隔 |
| `synchronous_commit` | on | 是否等待 WAL fsync 完成 |
| `wal_sync_method` | 平台相关 | fsync/fdatasync/open_datasync 等 |
| `commit_delay` | 0 (μs) | 组提交延迟，批量 fsync |
| `commit_siblings` | 5 | 组提交的最小并发事务数 |

> **性能建议：** `synchronous_commit = off` 可以显著提升写入性能，但断电时最多丢失 `wal_writer_delay`（默认 200ms）时间内的事务。对数据安全性要求不高的场景（如日志表）可以考虑。

## 5. 崩溃恢复流程

当 PG 检测到非正常关闭（缺少 `postmaster.pid` 或控制文件标记不一致），会自动进入恢复模式。

### 恢复步骤

```text
PG 启动
  │
  ▼
读取 pg_control (控制文件)
  │
  ▼
判断是否需要恢复? ──否──→ 正常启动
  │是
  ▼
定位最后一个 Checkpoint 记录
  │
  ▼
从 Checkpoint 的 redo LSN 开始
  │
  ▼
顺序读取 WAL 记录 ──────────────────────────┐
  │                                          │
  ├──→ 对每条 WAL 记录:                      │
  │    1. 读取关联的数据页                    │
  │    2. 比较 LSN:                          │
  │       - 数据页 pd_lsn ≥ WAL LSN → 跳过   │
  │       - 数据页 pd_lsn < WAL LSN → 重放   │
  │    3. 应用修改到数据页                    │
  │                                          │
  │←─────────────────────────────────────────┘
  │ (循环直到 WAL 结尾)
  │
  ▼
所有 WAL 重放完毕
  │
  ▼
回滚未提交的事务 (通过 CLOG)
  │
  ▼
恢复正常服务
```

### 恢复时间估算

恢复时间取决于需要重放的 WAL 量：

```text
恢复时间 ≈ (当前 LSN - 最近 Checkpoint LSN) / WAL 重放速率

影响因素:
- WAL 重放速率: 约 100~500 MB/s (取决于磁盘和 CPU)
- Checkpoint 间隔: checkpoint_timeout = 5min, max_wal_size = 1GB
- 理想情况: 恢复时间 < 1 分钟
```

> **调优关联：** 增大 `max_wal_size` 可以减少 Checkpoint 频率，提升写入性能，但会延长崩溃恢复时间。需要在写入性能和恢复时间之间权衡。

## 6. wal_level 配置

`wal_level` 控制 WAL 记录的详细程度，直接影响功能特性和性能。

| 级别 | 记录内容 | 支持的功能 | 性能影响 |
|------|---------|-----------|---------|
| **minimal** | 仅记录崩溃恢复所需的最少信息 | 基本恢复。不支持复制、PITR、pg_basebackup | 最小 |
| **replica** | 记录恢复 + 流复制所需的信息 | 流复制、PITR、归档、pg_basebackup | 中等（默认） |
| **logical** | 在 replica 基础上附加逻辑解码信息 | 逻辑复制、pg_recvlogical、变更数据捕获（CDC） | 较高 |

```sql
-- 查看当前 wal_level
SHOW wal_level;

-- 修改 wal_level (需重启)
ALTER SYSTEM SET wal_level = 'logical';
-- 然后重启 PostgreSQL
```

> **Java 生态关联：** 如果使用 Debezium 等 CDC 工具进行变更数据捕获（如同步到 Elasticsearch、Kafka），必须设置 `wal_level = logical`。这对写入性能有约 5~10% 的影响。

## 7. WAL 与复制的关系

WAL 是 PG 所有复制方案的基础。

### 复制架构

```text
┌─────────────────────┐         ┌─────────────────────┐
│     Primary          │         │     Standby          │
│                      │         │                      │
│  Backend Process     │   WAL   │  Startup Process     │
│       │              │  Stream │       │              │
│       ▼              │ ──────→ │       ▼              │
│  WAL Buffer          │         │  重放 WAL 记录       │
│       │              │         │       │              │
│       ▼              │         │       ▼              │
│  pg_wal/             │         │  pg_wal/ (接收)      │
│                      │         │       │              │
│                      │         │       ▼              │
│                      │         │  数据页 (应用修改)    │
└─────────────────────┘         └─────────────────────┘
```

### 同步 vs 异步复制

| 模式 | 行为 | 数据安全 | 性能 |
|------|------|---------|------|
| **同步复制** | 主库等待备库确认 WAL 已写入后才返回提交 | 零数据丢失 | 较高延迟 |
| **异步复制** | 主库不等待备库确认 | 故障时可能丢失少量事务 | 低延迟 |

```sql
-- 同步复制配置 (synchronous_standby_names)
ALTER SYSTEM SET synchronous_standby_names = 'standby1';

-- 查看复制状态
SELECT * FROM pg_stat_replication;
```

### 复制槽（Replication Slot）

复制槽确保主库保留备库所需的 WAL 文件，不会被清理：

```sql
-- 创建物理复制槽
SELECT pg_create_physical_replication_slot('standby1_slot');

-- 创建逻辑复制槽
SELECT pg_create_logical_replication_slot('cdc_slot', 'pgoutput');

-- 查看复制槽状态
SELECT * FROM pg_replication_slots;
```

> **⚠️ 警告：** 如果复制槽的消费者长时间断开，主库会保留大量 WAL 文件不清理，导致 `pg_wal/` 目录暴涨，最终磁盘空间耗尽。务必监控 `pg_replication_slots` 的 `restart_lsn` 滞后情况。
