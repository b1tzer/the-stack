---
doc_id: pg-process-memory
title: 进程与内存架构
---

# 进程与内存架构

> 一条查询卡住，`top` 一看满屏几十个 `postgres` 进程在抢 CPU。这不是 bug，是 PG 的进程模型——每个连接一个进程。要理解为什么会这样、怎么避免，得先看清进程和内存这两层结构。

## 1. 多进程架构总览

PostgreSQL 采用经典的 **一连接一进程（process-per-connection）** 模型。每当客户端发起连接，Postmaster 会 fork 出一个独立的 Backend Process 来服务该连接。

```text
┌───────────────────────────────────────────────────────┐
│                   PostgreSQL 集群                      │
│                                                       │
│  ┌───────────────────────────────────────────────┐    │
│  │              Postmaster (主进程)               │    │
│  │   监听端口 → 接收连接 → fork Backend Process     │    │
│  └──────┬────────┬────────┬────────┬─────────────┘    │
│         │        │        │        │                  │
│    ┌────▼──┐┌────▼──┐┌────▼──┐┌────▼──┐               │
│    │Backend││Backend││Backend││Backend│  ← 客户端连接   │
│    │  P1   ││  P2   ││  P3   ││  P4   │               │
│    └───────┘└───────┘└───────┘└───────┘               │
│                                                       │
│  ┌───────────────────────────────────────────────┐    │
│  │            Background Workers（后台进程）       │    │
│  │  ┌──────────┐ ┌──────────┐ ┌───────────────┐  │    │
│  │  │WAL Writer│ │Bg Writer │ │Checkpointer   │  │    │
│  │  └──────────┘ └──────────┘ └───────────────┘  │    │
│  │  ┌──────────┐ ┌──────────┐ ┌───────────────┐  │    │
│  │  │Autovacuum│ │Stats     │ │WAL Archiver   │  │    │
│  │  │Launcher  │ │Collector │ │(可选)          │  │    │
│  │  └──────────┘ └──────────┘ └───────────────┘  │    │
│  └───────────────────────────────────────────────┘    │
│                                                       │
│  ┌───────────────────────────────────────────────┐    │
│  │               共享内存 (Shared Memory)         │    │
│  │  Shared Buffers | WAL Buffers | CLOG | ...    │    │
│  └───────────────────────────────────────────────┘    │
└───────────────────────────────────────────────────────┘
```

> **为什么选多进程，而不是像 MySQL 那样用多线程？** 这是 PostgreSQL 最根深蒂固的设计决策，先讲清动机，后面每个进程/内存结构才有意义。

**好处：隔离性与可移植性**

- **一个 Backend 崩溃不连累其他连接**。每个 Backend 有独立地址空间，一个进程踩了野指针、段错误，操作系统直接杀掉它，其余连接照常服务。多线程模型下，一个线程的缓冲区溢出会写坏共享堆，殃及整个实例。
- **可移植性**。PostgreSQL 的前身 POSTGRES 诞生于 1986 年，那个年代 Unix 线程库远未成熟，各系统线程行为不一致；而 `fork()` 是 Unix 基石，所有平台都稳定。选进程，PG 就不依赖任何特定线程实现，能跑在所有类 Unix 系统上。

**弊端：单连接贵，高并发必须靠连接池**

- **fork 开销大**。每次新连接要 fork 进程、复制地址空间，单连接内存可达几 MB 到十几 MB，而一个线程只需几百 KB。
- **上下文切换慢**。进程切换要刷新 TLB、切换页表，比线程切换贵得多。
- **连接数受限**。几千个连接就是几千个进程，内存和 CPU 都扛不住。

一句话：PG 用进程换来**隔离性和可移植性**，代价是**单连接贵**，于是把高并发压力转移给连接池去扛（见 §5）。

## 2. 后台进程：为 Backend 分担落盘与维护工作

Backend Process 只负责执行 SQL，落盘、维护这类工作交给后台进程。它们按重要性分三层：Checkpointer 和 WAL Writer 决定数据安全，Background Writer 摊平 IO 峰值，Autovacuum 防表膨胀（机制另文讲）、Stats Collector 供优化器估算成本（知道存在即可）。

### 2.1 Checkpointer 与 Background Writer：一个是保障，一个是缓冲

这俩最容易混。一句话区分：

- **Checkpointer 对数据安全负责**：执行 Checkpoint，把某个时间点之前所有脏页刷盘，再更新控制文件，标记"到这里为止的 WAL 可以回收"。
- **Background Writer 只负责摊平 IO**：平时把部分脏页提前刷出去，让 Checkpoint 那一刻不至于瞬间写爆磁盘。它刷不刷、刷多少，不影响数据安全。

为什么需要两个？Checkpoint 必须"一次性把所有脏页落盘"，如果没人提前刷，Checkpoint 那一刻磁盘 IO 瞬间打满，所有查询变慢。Background Writer 就是那个平时悄悄刷一点的进程，把峰值摊平。

Checkpoint 触发条件：`checkpoint_timeout`（默认 5min）或 WAL 累积到 `max_wal_size`。

### 2.2 WAL Writer：提交成功 ≠ 数据已落盘

`COMMIT` 返回成功前，这条事务的 WAL 必须刷到磁盘，否则崩溃后就丢了——这是 WAL 的立身之本。

但 WAL 不是每条直接写盘：先写进共享内存的 WAL Buffer，再由 WAL Writer 刷到 WAL 段文件。**同步提交**（默认）时，`COMMIT` 主动触发刷盘；`synchronous_commit = off` 时交给 WAL Writer 按 `wal_writer_delay`（默认 200ms）周期刷，最多丢最近 200ms 的已提交事务。

> **为什么不逐条写盘？** 磁盘写入的最小单位是页（一般 8KB），而一条 WAL 记录往往只有几十字节，逐条写会把磁盘 IO 放大几十倍。先攒进 WAL Buffer，再由 WAL Writer 批量刷盘，能把零碎小写合并成连续大写。代价正是上面说的：异步提交时，`wal_writer_delay` 窗口内的已提交事务可能随宕机一起丢失——这是「IO 效率」换「持久性」的取舍。

### 2.3 Autovacuum Launcher

定期检查死元组数量，超阈值拉起 Autovacuum Worker 清理。机制见 [VACUUM 章节](../01-pg-unique/chapter-04-vacuum.md)，这里不重复。

### 2.4 Stats Collector

一句话：收集表的行数、页数、索引使用率，供优化器估算执行计划成本。不用调参。

## 3. 共享内存（Shared Memory）

前面这些进程——Backend 和后台进程——都要读写同一批数据页和 WAL，于是需要一块大家都能访问的内存。PostgreSQL 启动时分配这块共享内存，所有进程共享。

```text
┌────────────────────────────────────────────┐
│              共享内存 (Shared Memory)       │
│                                            │
│  ┌──────────────────────────────────────┐  │
│  │         Shared Buffers               │  │
│  │   (数据页缓存，核心组件)                │  │
│  │   默认 128MB，生产建议 RAM 的 25%       │  │
│  └──────────────────────────────────────┘  │
│  ┌──────────────────────────────────────┐  │
│  │         WAL Buffers                  │  │
│  │   (WAL 日志缓冲区)                     │  │
│  │   默认 -1 (自动 ≈ 64MB 的 1/32)        │  │
│  └──────────────────────────────────────┘  │
│  ┌──────────────────────────────────────┐  │
│  │         CLOG (Commit Log)            │  │
│  │   (事务提交状态，2bit/事务)             │  │
│  └──────────────────────────────────────┘  │
│  ┌──────────────────────────────────────┐  │
│  │     Lock Tables / Proc Array         │  │
│  │   (锁信息、进程状态数组)                │  │
│  └──────────────────────────────────────┘  │
└────────────────────────────────────────────┘
```

### Shared Buffers 核心机制

| 概念 | 说明 |
|------|------|
| **Buffer Tag** | 每个缓冲区页的唯一标识（RelFileNode + ForkNumber + BlockNumber） |
| **Buffer Descriptor** | 描述缓冲区状态：pin count、usage count、dirty flag |
| **Clock-Sweep 算法** | 缓存替换策略，类似 LRU 的简化版本 |

> **为什么设 25%，而且不能贪多？** 数据读取的真实路径是：磁盘 → OS Page Cache → Shared Buffers → Backend。`shared_buffers` 存一份，OS Page Cache 往往还存一份，这就是 double buffering。
>
> 如果 `shared_buffers` 设到 80% 内存，OS Page Cache 被挤得只剩一点，从磁盘读进来的数据没地方放，频繁换页，反而更慢。PG 的设计就是把 OS Page Cache 当二级缓存，所以 `shared_buffers` 只拿 25%，大头留给 OS。

## 4. 本地内存（Local Memory）

每个 Backend Process 独立分配的内存区域，连接结束时释放。

| 参数 | 默认值 | 用途 |
|------|--------|------|
| **work_mem** | 4MB | 排序（ORDER BY）、哈希连接（Hash Join）、哈希聚合使用的内存。**每个操作**独立分配，复杂查询可能分配多个 |
| **maintenance_work_mem** | 64MB | VACUUM、CREATE INDEX、ALTER TABLE ADD FK 等维护操作使用 |
| **temp_buffers** | 8MB | 临时表（TEMP TABLE）的缓冲区 |
| **hash_mem_multiplier** | 1.0 | Hash Join 可额外使用 work_mem 的倍数（PG 13+） |

> **`work_mem` 是本地内存里最容易爆的坑。** 它的单位不是"每个连接"，而是"每个排序/哈希操作"。一条 SQL 同时有 3 个排序、2 个 Hash Join，就要开 5 份；再乘并发连接数。
>
> 举例：`work_mem = 64MB`，一个连接一条 SQL 用 4 个操作就是 256MB；200 个并发连接同时跑，峰值 **50GB**，直接 OOM。
>
> 所以 `work_mem` 不能照内存大小随便给。判断公式：`work_mem × 单查询最大操作数 × 并发连接数 ≤ 可用内存`。生产从 4MB~64MB 起步，用 `EXPLAIN ANALYZE` 看排序是否落盘（`Sort Method: external`）再调大。

到这里，开头那条查询为什么卡住，答案齐了：连接数过多吃掉 CPU（§1），`work_mem` 乘数效应吃掉内存（本节）。

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

> 选进程还是选线程的动机，§1 已经讲透。这里只剩一个增量：为什么 MySQL 选了线程？因为它的定位是 Web 高并发读，线程单连接开销小、切换快，正好契合；代价是隔离性弱。而 PG 的进程模型早定型十年，改造成本高，索性沿用。

> **Java 开发者注意：** PG 的进程模型意味着直接开几千个连接会消耗大量内存和 CPU（fork 开销）。生产环境**必须**使用连接池（PgBouncer 或应用层 HikariCP），将连接数控制在 `CPU核心数 × 2 + 磁盘数` 的范围内。

## 6. 连接建立流程

```text
客户端                   Postmaster              Backend Process
  │                         │                         │
  │── TCP 三次握手 ────────→ │                         │
  │                         │                         │
  │── SSL 协商(可选) ──────→ │                         │
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
  │── Query/Parse/Bind ─────────────────────────────→ │
  │                         │                     执行SQL
  │←── DataRow / CommandComplete ──────────────────── │
```

### 关键步骤说明

1. **Postmaster 接收连接请求**：监听 `listen_addresses` 和 `port`（默认 5432）
2. **pg_hba.conf 认证**：根据客户端 IP、用户名、数据库名匹配认证方式（md5/scram-sha-256/trust 等）
3. **fork Backend Process**：Postmaster 调用 `fork()` 创建子进程
4. **Backend 初始化**：加载 `postgresql.conf` 配置、设置信号处理、分配本地内存
5. **进入查询循环**：Backend 等待客户端消息（Query/Parse/Bind/Execute），处理后返回结果

> **调优要点：** 如果连接建立耗时过长，检查 `pg_hba.conf` 中是否使用了 DNS 解析（`host` vs `hostnossl`），以及 `max_connections` 是否已满。高并发场景建议前置 PgBouncer，使用 **Transaction Pooling** 模式复用连接。

## 本章小结

| 要点 | 记忆关键词 |
|------|-----------|
| PG 使用多进程架构 | process-per-connection，必须用连接池 |
| Postmaster 是所有进程的父进程 | fork 模式，故障隔离强 |
| Shared Buffers 是数据缓存核心 | 设置为 RAM 的 25%，配合 OS Page Cache |
| work_mem 是**每次操作**的上限 | 非每连接总量，注意乘数效应 |
| 后台进程各有分工 | WAL Writer / Bg Writer / Checkpointer / Autovacuum |
| 连接建立经过认证 → fork → 初始化 | 耗时问题查 pg_hba.conf 和 max_connections |
