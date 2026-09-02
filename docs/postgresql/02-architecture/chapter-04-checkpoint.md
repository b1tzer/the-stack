---
doc_id: pg-checkpoint
title: Checkpoint 与脏页刷新
---

# Checkpoint 与脏页刷新

> **核心问题：** PostgreSQL 的脏页（Dirty Page）何时、如何被刷到磁盘？Checkpoint 对写入性能有什么影响？`full_page_writes` 是做什么的？理解 Checkpoint 机制，是调优写入密集型工作负载的关键。

## 1. Checkpoint 是什么

**Checkpoint** 是一个时间点，在这个时间点上，PostgreSQL 保证**所有在该时间点之前产生的脏页都已写入磁盘**。完成 Checkpoint 后，崩溃恢复只需从该 Checkpoint 的 LSN 开始重放 WAL，而不需要从更早的位置开始。

```text
时间轴:
─────────────────────────────────────────────────────►

  CP1                                    CP2
   │                                      │
   ▼                                      ▼
   ├──── 脏页范围 ─────────────────────────┤
   │                                      │
   │  这些脏页必须在 CP2 完成前全部刷盘        │
   │                                      │

  如果在 CP2 之后崩溃:
  → 恢复从 CP2 的 redo LSN 开始重放 WAL
  → CP2 之前的脏页已经落盘，无需重放
```

### Checkpoint 做了什么？

| 步骤 | 操作 | I/O 特征 |
|------|------|---------|
| 1 | 记录 Checkpoint 开始（WAL） | 顺序写 |
| 2 | 将所有脏页刷到磁盘 | **大量随机写**（最耗时） |
| 3 | 刷 CLOG、Subtrans 等状态文件 | 顺序写 |
| 4 | 更新 `pg_control` 控制文件 | 顺序写 |
| 5 | 记录 Checkpoint 完成（WAL） | 顺序写 |

> **性能关键点：** 步骤 2 是 Checkpoint 最耗时的操作。大量脏页同时刷盘会造成 **I/O 写尖峰**，导致正常查询的响应时间急剧上升。这就是为什么需要 Background Writer 和 `checkpoint_completion_target` 来平滑 I/O。

## 2. Checkpoint 触发条件

PostgreSQL 的 Checkpoint 由以下任一条件触发：

| 触发条件 | 参数 | 默认值 | 说明 |
|----------|------|--------|------|
| **超时触发** | `checkpoint_timeout` | 5 min | 距离上次 Checkpoint 超过此时间 |
| **WAL 量触发** | `max_wal_size` | 1 GB | 自上次 Checkpoint 以来产生的 WAL 量超过此值 |
| **手动触发** | `CHECKPOINT` 命令 | — | DBA 手动执行（如 VACUUM 大表后） |
| **干净关库** | `pg_ctl stop -m fast` | — | 关闭前执行一次 Checkpoint |

### 参数关系图

```text
checkpoint_timeout = 5min
         │
         ▼
   ┌─────────────────────────────────────────┐
   │              Checkpoint 间隔             │
   │                                         │
   │   CP1 ──────────────────────── CP2      │
   │   │                           │         │
   │   │←── 最长 5 分钟 ──────────→  │        │
   │   │                           │         │
   │   │←── 除非 WAL 量达到 ──────→  │         │
   │   │    max_wal_size (1GB)     │         │
   │   │    先触发                  │         │
   └─────────────────────────────────────────┘

max_wal_size 越大 → Checkpoint 间隔越长 → 写入性能越好
                    → 但恢复时间越长 → pg_wal/ 占用越多
```

### 相关参数

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `checkpoint_timeout` | 5min | Checkpoint 最大间隔（建议 5~30min） |
| `max_wal_size` | 1GB | 触发 Checkpoint 的 WAL 累积量 |
| `min_wal_size` | 80MB | pg_wal/ 空间回收的下限 |
| `checkpoint_warning` | 30s | 如果 Checkpoint 间隔小于此值，打印警告日志 |

```sql
-- 查看当前 Checkpoint 配置
SHOW checkpoint_timeout;       -- 5min
SHOW max_wal_size;             -- 1GB
SHOW checkpoint_completion_target; -- 0.9

-- 监控 Checkpoint 频率
SELECT * FROM pg_stat_bgwriter;
```

## 3. checkpoint_completion_target 参数

`checkpoint_completion_target` 控制 Checkpoint 脏页刷盘的**节奏**，是平滑 I/O 的核心参数。

### 工作原理

Checkpoint 不是一次性把所有脏页刷完，而是在**两次 Checkpoint 之间的时间窗口**内，按照 `checkpoint_completion_target` 的比例分散刷盘。

```text
checkpoint_completion_target = 0.9 (默认)

CP1                                              CP2
 │                                                │
 ▼                                                ▼
 ├────────────────────────────────────────────────┤
 │                                                │
 │  [=== 均匀刷脏页 =============================>]│
 │   ↑                                    ↑       │
 │   开始刷                        完成(90%处)     │
 │                                                │
 │   最后 10% 留给 Checkpoint 快速完成             │
```

### 不同取值的影响

| 值 | 行为 | 适合场景 |
|----|------|---------|
| **0.0** | Checkpoint 一开始就集中刷完所有脏页 | ❌ 不推荐，I/O 尖峰严重 |
| **0.5** | 在前 50% 的时间内均匀刷完 | 写入压力中等 |
| **0.9** | 在前 90% 的时间内均匀刷完（默认） | 大多数场景，I/O 最平滑 |
| **1.0** | 几乎到下次 Checkpoint 才刷完 | ⚠️ 风险高，可能来不及刷完 |

> **调优建议：** 保持默认值 `0.9` 即可。如果 Checkpoint 期间仍有 I/O 尖峰，应优先增大 `max_wal_size` 来拉长 Checkpoint 间隔，而非调整此参数。

## 4. Checkpoint 对性能的影响

### 写放大效应

Checkpoint 期间的 I/O 问题主要体现在：

```text
正常运行时:
  写入速率: ─────────────────────── (平稳)
               ↑
               │ 小批量写入 (Background Writer)
               │

Checkpoint 期间:
  写入速率: ──────╱══════╲───────── (尖峰)
                  ↑      ↑
                  │      │
            Checkpoint  脏页集中
            开始刷盘    涌入磁盘
```

### Checkpoint 性能指标监控

```sql
-- 查看 Checkpoint 统计
SELECT
    checkpoints_timed,          -- 超时触发的次数
    checkpoints_req,            -- WAL 量触发的次数
    checkpoint_write_time,      -- 写脏页耗时 (ms)
    checkpoint_sync_time,       -- fsync 耗时 (ms)
    buffers_checkpoint,         -- Checkpoint 写出的缓冲区数
    buffers_clean,              -- Bg Writer 写出的缓冲区数
    buffers_backend,            -- Backend 直接写出的缓冲区数
    buffers_alloc               -- 分配的缓冲区总数
FROM pg_stat_bgwriter;
```

| 指标 | 健康范围 | 异常信号 |
|------|---------|---------|
| `checkpoints_req / checkpoints_timed` | < 0.1 | 频繁被 WAL 量触发 → 增大 `max_wal_size` |
| `buffers_backend / buffers_checkpoint` | < 0.1 | Backend 直接写出过多 → 增大 `shared_buffers` 或 `bgwriter` 参数 |
| `checkpoint_write_time` | 与 `checkpoint_sync_time` 接近 | 写入时间远大于 sync → 磁盘写入瓶颈 |

## 5. Background Writer 的作用

Background Writer 是 Checkpoint 的"前置助手"，它的职责是在 Checkpoint 之间**提前将部分脏页刷出**，减轻 Checkpoint 时的 I/O 压力。

### Bg Writer vs Checkpointer

| 维度 | Background Writer | Checkpointer |
|------|-------------------|--------------|
| **职责** | 提前刷出"不活跃"的脏页 | 保证**所有**脏页在 Checkpoint 点落盘 |
| **刷出范围** | 部分脏页（基于 LRU 策略） | 所有在 Checkpoint LSN 之前的脏页 |
| **刷出策略** | 周期性扫描，优先刷 usage_count 低的页 | 必须在 Checkpoint 完成前全部刷完 |
| **关键参数** | `bgwriter_delay`, `bgwriter_lru_maxpages`, `bgwriter_lru_multiplier` | `checkpoint_completion_target` |
| **是否可被跳过** | 可以，Backend 可能自己刷脏页 | 不可以，必须完成 |

### Bg Writer 关键参数

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `bgwriter_delay` | 200ms | Bg Writer 唤醒间隔 |
| `bgwriter_lru_maxpages` | 100 | 每次最多写出的页数（0 = 禁用 Bg Writer） |
| `bgwriter_lru_multiplier` | 2.0 | 预判需要多少干净页可复用，值越大写出越多 |

### 三层脏页刷出体系

```text
┌───────────────────────────────────────────────────────┐
│                    脏页刷出架构                         │
│                                                       │
│  Layer 1: Background Writer (持续、小批量)              │
│  ┌─────────────────────────────────────────────────┐  │
│  │  每 200ms 醒来，刷出 usage_count 低的脏页        │  │
│  │  目标: 保持足够的干净页供新数据使用               │  │
│  └─────────────────────────────────────────────────┘  │
│                    │                                  │
│                    ▼                                  │
│  Layer 2: Checkpointer (周期性、全量)                  │
│  ┌─────────────────────────────────────────────────┐  │
│  │  每 5min 或 WAL 量达标时触发                     │  │
│  │  目标: 保证所有脏页落盘，标记恢复点              │  │
│  └─────────────────────────────────────────────────┘  │
│                    │                                  │
│                    ▼                                  │
│  Layer 3: Backend 直接写出 (兜底)                      │
│  ┌─────────────────────────────────────────────────┐  │
│  │  当 Shared Buffers 找不到干净页时                │  │
│  │  Backend 被迫自己刷出脏页 → 严重影响查询性能      │  │
│  │  buffers_backend 指标上升是信号                  │  │
│  └─────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────┘
```

> **调优方向：** 如果 `buffers_backend` 占比过高（> 10%），说明 Bg Writer 和 Checkpointer 的刷出速度跟不上写入速度。应增大 `bgwriter_lru_maxpages` 或 `bgwriter_lru_multiplier`，让 Bg Writer 更积极地刷脏页。

## 6. full_page_writes 参数

### 问题背景：部分页写入（Torn Page）

磁盘通常以扇区（512B 或 4KB）为单位写入。如果在写入 8KB 数据页的过程中断电，可能只有前 4KB 被写入，后 4KB 仍是旧数据 — 这就是 **部分页写入（Torn Page）** 问题。

```text
正常写入 8KB 数据页:
[═══════════════════════════════════]  ✅ 完整写入

断电导致部分写入:
[════════════════░░░░░░░░░░░░░░░░░░]  ❌ 只写了前半部分
                   ↑
                   断电点
                   前半部分 = 新数据
                   后半部分 = 旧数据
                   → 页面不一致！
```

### full_page_writes 的解决方案

`full_page_writes = on`（默认）时，每次 Checkpoint 后**第一次修改**某个数据页，会将该页的**完整内容**写入 WAL 记录（Full Page Image），而非仅记录增量变化。

```text
WAL 记录类型:

  普通 WAL 记录: [LSN] [操作类型] [增量数据]  (小)
  
  Full Page Image: [LSN] [操作类型] [整页 8KB 数据]  (大)

当 full_page_writes = on:
  Checkpoint 后首次修改某页 → 写 Full Page Image
  后续修改该页           → 写普通 WAL 记录 (增量)

恢复时:
  即使数据页部分写入损坏
  → 用 Full Page Image 恢复完整页面
  → 再重放后续增量 WAL 记录
  → 数据一致性得到保证
```

### full_page_writes 的性能影响

| 场景 | 影响 |
|------|------|
| Checkpoint 刚完成后的写入 | WAL 量显著增大（每页首次修改多 8KB） |
| 大批量 UPDATE/INSERT | Checkpoint 后短时间内 WAL 膨胀 |
| 关闭 full_page_writes | WAL 量减少，但有数据损坏风险 |

```sql
-- 查看设置
SHOW full_page_writes;

-- 通常不建议关闭！
-- 如果底层存储保证原子写入（如某些企业级 SSD、ZFS），可以考虑关闭
```

> **⚠️ 不要轻易关闭：** 除非你确定存储层支持原子写入（如 ZFS、部分企业存储阵列），否则关闭 `full_page_writes` 可能导致数据损坏。在大多数场景下保持默认值 `on`。

## 7. 与 MySQL Redo Log Checkpoint 对比

| 维度 | PostgreSQL | MySQL (InnoDB) |
|------|------------|----------------|
| **日志名称** | WAL (Write-Ahead Log) | Redo Log (ib_logfile) |
| **日志结构** | 多个 16MB 段文件 | 固定大小的循环文件组 |
| **Checkpoint 方式** | 独立进程 Checkpointer，周期性全量刷脏页 | 模糊检查点（Fuzzy Checkpoint），持续部分刷脏页 |
| **刷脏页时机** | Bg Writer 持续预刷 + Checkpointer 全量刷 | Master Thread、Page Cleaner 线程 |
| **Checkpoint 标记** | WAL 中的 Checkpoint 记录 + pg_control | Redo Log 中的 checkpoint LSN |
| **日志空间管理** | 段文件循环覆盖（归档后可删除） | 固定大小循环写入 |
| **full_page_writes** | 默认开启，Checkpoint 后首次修改写全页 | 通过 Doublewrite Buffer 解决部分页写入 |
| **I/O 平滑策略** | checkpoint_completion_target (0.9) | 自适应刷脏（innodb_adaptive_flushing） |
| **脏页比例监控** | pg_stat_bgwriter | innodb_max_dirty_pages_pct |
| **恢复速度** | 取决于 Checkpoint 间隔 × WAL 重放速率 | 取决于 Redo Log 量 × 重放速率 |

### 架构差异图

```text
PostgreSQL Checkpoint 模型:
┌────────────────────────────────────────────┐
│  CP1 ───── Bg Writer 预刷 ────── CP2       │
│   │                             │          │
│   │←── checkpoint_target=0.9 ──→│          │
│   │   (均匀分散刷脏)             │          │
│   │                             │          │
│   └── Checkpointer 全量刷完 ────┘          │
└────────────────────────────────────────────┘

MySQL InnoDB Checkpoint 模型:
┌────────────────────────────────────────────┐
│  Redo Log 循环写入                           │
│   │                                        │
│   ├── checkpoint_age → 接近 log 容量时      │
│   │   触发激进刷脏                          │
│   │                                        │
│   ├── innodb_adaptive_flushing             │
│   │   根据 redo 产生速率动态调整刷脏速度     │
│   │                                        │
│   └── Page Cleaner 线程                    │
│       (多线程并行刷脏)                      │
└────────────────────────────────────────────┘
```

> **关键区别总结：** PG 的 Checkpoint 是**周期性全量**的，通过 `checkpoint_completion_target` 平滑 I/O；MySQL 是**持续增量**的，通过自适应刷脏算法动态调整。PG 的方式更简单可控，MySQL 的方式理论上 I/O 更平滑，但调优更复杂。

## 本章小结

| 要点 | 记忆关键词 |
|------|-----------|
| Checkpoint 将所有脏页刷盘 | 标记恢复点，缩短恢复时间 |
| 两种触发：超时(5min) + WAL 量(1GB) | `max_wal_size` 是核心调优参数 |
| checkpoint_completion_target = 0.9 | 分散刷脏，平滑 I/O |
| Background Writer 提前预刷脏页 | 三层体系：Bg Writer → Checkpointer → Backend |
| full_page_writes 防止部分页写入 | Checkpoint 后首次修改写全页，不要关闭 |
| buffers_backend 过高说明刷脏不及时 | 增大 Bg Writer 参数或 shared_buffers |
| PG 是周期性全量 Checkpoint | MySQL 是持续增量，理念不同 |
