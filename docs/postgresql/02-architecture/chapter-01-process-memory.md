---
doc_id: pg-process-memory
title: 进程与内存架构
---

# 进程与内存架构

> **核心问题：** PostgreSQL 采用多进程架构而非多线程，这意味着什么？每个连接背后有哪些进程在协作？共享内存和本地内存各自承担什么职责？理解这些，是排查性能问题和连接瓶颈的基础。

---

## 1. 多进程架构总览

PostgreSQL 采用经典的 **一连接一进程（process-per-connection）** 模型。每当客户端发起连接，Postmaster 会 fork 出一个独立的 Backend Process 来服务该连接。

```
┌─────────────────────────────────────────────────────┐
│                   PostgreSQL 集群                     │
│                                                      │
│  ┌──────────────────────────────────────────────┐    │
│  │              Postmaster (主进程)               │    │
│  │   监听端口 → 接收连接 → fork Backend Process    │    │
│  └──────┬────────┬────────┬────────┬─────────────┘    │
│         │        │        │        │                  │
│    ┌────▼──┐┌────▼──┐┌────▼──┐┌────▼──┐              │
│    │Backend││Backend││Backend││Backend│  ← 客户端连接  │
│    │  P1   ││  P2   ││  P3   ││  P4   │              │
│    └───────┘└───────┘└───────┘└───────┘              │
│                                                      │
│  ┌──────────────────────────────────────────────┐    │
│  │            Background Workers（后台进程）       │    │
│  │  ┌──────────┐ ┌──────────┐ ┌───────────────┐  │    │
│  │  │WAL Writer│ │Bg Writer │ │Checkpointer   │  │    │
│  │  └──────────┘ └──────────┘ └───────────────┘  │    │
│  │  ┌──────────┐ ┌──────────┐ ┌───────────────┐  │    │
│  │  │Autovacuum│ │Stats     │ │WAL Archiver   │  │    │
│  │  │Launcher  │ │Collector │ │(可选)          │  │    │
│  │  └──────────┘ └──────────┘ └───────────────┘  │    │
│  └──────────────────────────────────────────────┘    │
│                                                      │
│  ┌──────────────────────────────────────────────┐    │
│  │               共享内存 (Shared Memory)         │    │
│  │  Shared Buffers | WAL Buffers | CLOG | ...    │    │
│  └──────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────┘
```

### 关键进程一览

| 进程 | 类型 | 职责 | 启动方式 |
|------|------|------|---------|
| **Postmaster** | 主进程 | 监听连接请求，fork Backend，管理集群生命周期 | 集群启动时 |
| **Backend Process** | 服务进程 | 处理单个客户端连接的 SQL 请求 | 每次连接时 fork |
| **WAL Writer** | 后台进程 | 将 WAL 缓冲区写入磁盘 | 集群启动时 |
| **Background Writer** | 后台进程 | 将脏数据页从共享缓冲区刷到磁盘 | 集群启动时 |
| **Checkpointer** | 后台进程 | 执行 Checkpoint，协调脏页刷新 | 集群启动时 |
| **Autovacuum Launcher** | 后台进程 | 启动 Autovacuum Worker 清理死元组 | 集群启动时 |
| **Stats Collector** | 后台进程 | 收集表/索引的统计信息供优化器使用 | 集群启动时 |
| **WAL Archiver** | 后台进程 | 归档 WAL 段文件（用于 PITR） | archive_mode=on 时 |

---

## 2. 各后台进程详解

### 2.1 WAL Writer

- **职责：** 定期将 WAL Buffer 中的数据写入 WAL 段文件
- **触发条件：** 事务提交时（同步提交）、WAL Buffer 达到阈值（`wal_writer_delay` 周期）
- **关键参数：** `wal_writer_delay`（默认 200ms）、`wal_buffers`（默认 -1，自动计算）

### 2.2 Background Writer

- **职责：** 将共享缓冲区中的脏页（dirty page）写出到数据文件
- **目的：** 减轻 Checkpoint 时的 I/O 压力，平滑磁盘写入
- **关键参数：** `bgwriter_delay`（默认 200ms）、`bgwriter_lru_maxpages`（每次最多写多少页）

### 2.3 Checkpointer

- **职责：** 执行 Checkpoint 操作，确保所有脏页被刷盘，更新控制文件
- **触发条件：** `checkpoint_timeout`（默认 5min）、WAL 量达到 `max_wal_size`、手动 `CHECKPOINT`
- **与 Background Writer 的区别：** Checkpointer 保证所有脏页落盘；Bg Writer 只是"预刷"部分脏页

### 2.4 Autovacuum Launcher

- **职责：** 定期检查各表的死元组数量，超过阈值时启动 Autovacuum Worker 进行清理
- **关键参数：** `autovacuum_naptime`（检查间隔，默认 1min）、`autovacuum_vacuum_threshold`、`autovacuum_vacuum_scale_factor`

### 2.5 Stats Collector

- **职责：** 收集表的行数、页数、索引使用率、Tuple 操作统计等
- **供谁使用：** 查询优化器通过统计信息估算执行计划成本
- **查看方式：** `pg_stat_user_tables`、`pg_stat_activity` 等系统视图

---

## 3. 共享内存（Shared Memory）

PostgreSQL 启动时分配一块大的共享内存区域，所有 Backend Process 和后台进程都可以访问。

```
┌────────────────────────────────────────────┐
│              共享内存 (Shared Memory)        │
│                                            │
│  ┌──────────────────────────────────────┐  │
│  │         Shared Buffers               │  │
│  │   (数据页缓存，核心组件)               │  │
│  │   默认 128MB，生产建议 RAM 的 25%     │  │
│  └──────────────────────────────────────┘  │
│  ┌──────────────────────────────────────┐  │
│  │         WAL Buffers                  │  │
│  │   (WAL 日志缓冲区)                   │  │
│  │   默认 -1 (自动 ≈ 64MB 的 1/32)      │  │
│  └──────────────────────────────────────┘  │
│  ┌──────────────────────────────────────┐  │
│  │         CLOG (Commit Log)            │  │
│  │   (事务提交状态，2bit/事务)           │  │
│  └──────────────────────────────────────┘  │
│  ┌──────────────────────────────────────┐  │
│  │     Lock Tables / Proc Array         │  │
│  │   (锁信息、进程状态数组)              │  │
│  └──────────────────────────────────────┘  │
└────────────────────────────────────────────┘
```

### Shared Buffers 核心机制

| 概念 | 说明 |
|------|------|
| **Buffer Tag** | 每个缓冲区页的唯一标识（RelFileNode + ForkNumber + BlockNumber） |
| **Buffer Descriptor** | 描述缓冲区状态：pin count、usage count、dirty flag |
| **Clock-Sweep 算法** | 缓存替换策略，类似 LRU 的简化版本 |
| **双缓冲机制** | 读数据先到 Shared Buffers，Backend 通过它间接访问磁盘 |

> **调优建议：** `shared_buffers` 设置为系统内存的 **25%**。过大会导致 OS 文件系统缓存不足，反而降低性能。PG 的设计依赖 OS Page Cache 作为二级缓存。

---

## 4. 本地内存（Local Memory）

每个 Backend Process 独立分配的内存区域，连接结束时释放。

| 参数 | 默认值 | 用途 |
|------|--------|------|
| **work_mem** | 4MB | 排序（ORDER BY）、哈希连接（Hash Join）、哈希聚合使用的内存。**每个操作**独立分配，复杂查询可能分配多个 |
| **maintenance_work_mem** | 64MB | VACUUM、CREATE INDEX、ALTER TABLE ADD FK 等维护操作使用 |
| **temp_buffers** | 8MB | 临时表（TEMP TABLE）的缓冲区 |
| **hash_mem_multiplier** | 1.0 | Hash Join 可额外使用 work_mem 的倍数（PG 13+） |

> **⚠️ 注意：** `work_mem` 不是每连接总量，而是**每个排序/哈希操作**的上限。一条 SQL 可能触发多个排序操作，实际内存消耗 = `work_mem × 并发操作数 × 连接数`。生产环境建议设置为 **4MB~64MB**，不要过大。

---

## 5. 进程模型对比：PostgreSQL vs MySQL

| 维度 | PostgreSQL | MySQL (InnoDB) |
|------|------------|----------------|
| **并发模型** | 多进程（process-per-connection） | 多线程（thread-per-connection） |
| **单连接开销** | 较大（fork 进程，独立地址空间） | 较小（创建线程，共享地址空间） |
| **内存隔离** | 进程级隔离，一个 Backend crash 不影响其他 | 线程共享内存，一个线程 bug 可能影响整个实例 |
| **上下文切换** | 进程切换开销大（TLB 刷新等） | 线程切换开销小 |
| **高并发扩展** | 依赖连接池（PgBouncer）缓解 | 原生支持更高并发连接数 |
| **故障隔离** | 强（进程独立崩溃恢复） | 弱（需整体恢复） |
| **共享内存** | 显式管理（Shared Buffers） | InnoDB Buffer Pool（类似但实现不同） |

> **Java 开发者注意：** PG 的进程模型意味着直接开几千个连接会消耗大量内存和 CPU（fork 开销）。生产环境**必须**使用连接池（PgBouncer 或应用层 HikariCP），将连接数控制在 `CPU核心数 × 2 + 磁盘数` 的范围内。

---

## 6. 连接建立流程

```
客户端                   Postmaster              Backend Process
  │                         │                         │
  │── TCP 三次握手 ────────→│                         │
  │                         │                         │
  │── SSL 协商(可选) ──────→│                         │
  │                         │                         │
  │── StartupMessage ──────→│                         │
  │   (user, database, ...) │                         │
  │                         │── fork() ──────────────→│
  │                         │                         │
  │                         │                    验证用户(pg_hba.conf)
  │                         │                    验证密码
  │                         │                    加载数据库配置
  │                         │                    分配 Backend 内存
  │                         │                         │
  │←──── AuthenticationOk ──│←────────────────────────│
  │                         │                         │
  │←── ReadyForQuery ───────│                         │
  │                         │                         │
  │── Query/Parse/Bind ─────────────────────────────→│
  │                         │                    执行SQL
  │←── DataRow / CommandComplete ────────────────────│
```

### 关键步骤说明

1. **Postmaster 接收连接请求**：监听 `listen_addresses` 和 `port`（默认 5432）
2. **pg_hba.conf 认证**：根据客户端 IP、用户名、数据库名匹配认证方式（md5/scram-sha-256/trust 等）
3. **fork Backend Process**：Postmaster 调用 `fork()` 创建子进程
4. **Backend 初始化**：加载 `postgresql.conf` 配置、设置信号处理、分配本地内存
5. **进入查询循环**：Backend 等待客户端消息（Query/Parse/Bind/Execute），处理后返回结果

> **调优要点：** 如果连接建立耗时过长，检查 `pg_hba.conf` 中是否使用了 DNS 解析（`host` vs `hostnossl`），以及 `max_connections` 是否已满。高并发场景建议前置 PgBouncer，使用 **Transaction Pooling** 模式复用连接。

---

## 本章小结

| 要点 | 记忆关键词 |
|------|-----------|
| PG 使用多进程架构 | process-per-connection，必须用连接池 |
| Postmaster 是所有进程的父进程 | fork 模式，故障隔离强 |
| Shared Buffers 是数据缓存核心 | 设置为 RAM 的 25%，配合 OS Page Cache |
| work_mem 是**每次操作**的上限 | 非每连接总量，注意乘数效应 |
| 后台进程各有分工 | WAL Writer / Bg Writer / Checkpointer / Autovacuum |
| 连接建立经过认证 → fork → 初始化 | 耗时问题查 pg_hba.conf 和 max_connections |
