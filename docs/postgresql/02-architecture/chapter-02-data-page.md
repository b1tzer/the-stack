---
doc_id: pg-data-page
title: 数据页与存储结构
---

# 数据页与存储结构

> **核心问题：** PostgreSQL 中一张表的数据在磁盘上是如何组织的？8KB 的数据页内部是什么结构？大字段（如 JSONB、大文本）是怎么存的？理解存储结构，是理解 VACUUM、索引扫描和 IO 性能的前提。

---

## 1. 逻辑结构层次

PostgreSQL 的逻辑结构从大到小依次为：

```
Database Cluster (集群)
  └── Database (数据库)
        └── Schema (模式)
              └── Table (表)
                    └── Page (数据页, 8KB)
                          └── Tuple (元组/行)
```

| 层次 | 说明 | 对应 Java 类比 |
|------|------|---------------|
| **Database Cluster** | 一个 PG 实例管理的所有数据库 | 一个 MySQL Instance |
| **Database** | 独立的数据库，不同 DB 之间默认隔离 | MySQL 的 Database |
| **Schema** | 数据库内的命名空间，隔离表/视图等对象 | 无直接对应（MySQL schema ≈ database） |
| **Table** | 存储数据的表 | 同 MySQL |
| **Page** | 磁盘 I/O 的最小单位，固定 8KB | 类似 InnoDB 的 Page（16KB） |
| **Tuple** | 表中的一行记录 | Row / Record |

> **Java 开发者注意：** PG 的 Schema 是 Database 下级的概念，与 MySQL 不同。MySQL 中 `CREATE DATABASE` 和 `CREATE SCHEMA` 几乎等价，但 PG 中两者是不同的层级。

---

## 2. 数据页结构（8KB）

每个数据页固定为 **8192 字节（8KB）**，内部结构如下：

```
┌──────────────────────────────────────────┐  偏移 0
│           PageHeaderData (24 字节)        │
│  - pd_lsn: 最后修改该页的 WAL LSN        │
│  - pd_checksum: 页校验和(PG 12+)         │
│  - pd_lower: ItemId 数组末尾指针         │
│  - pd_upper: Tuple 数据起始指针          │
│  - pd_special: 特殊空间起始指针          │
│  - pd_pagesize_version: 页大小+版本      │
├──────────────────────────────────────────┤  偏移 24
│           ItemId 数组 (行指针)            │
│  [ItemId 1][ItemId 2][ItemId 3]...       │
│  每个 ItemId 4 字节: (offset, length,     │
│                       flag)              │
│  从前往后增长 ←──── pd_lower             │
├──────────────────────────────────────────┤
│              Free Space                  │
│          (未使用的中间空间)                │
├──────────────────────────────────────────┤
│           Tuple 数据区                    │
│  ...[Tuple 3][Tuple 2][Tuple 1]          │
│  从后往前增长 ────→ pd_upper              │
├──────────────────────────────────────────┤  偏移 Special
│         Special Space (索引页专用)        │
│   堆表页中为空，索引页存储索引特定数据     │
└──────────────────────────────────────────┘  偏移 8192
```

### PageHeader 字段详解

| 字段 | 大小 | 说明 |
|------|------|------|
| `pd_lsn` | 8 字节 | 最后修改该页的 WAL 记录的 LSN，用于恢复判断 |
| `pd_checksum` | 2 字节 | 页校验和（PG 12+，需 initdb 时开启 `--data-checksums`） |
| `pd_lower` | 2 字节 | ItemId 数组的结束位置（空闲空间起点） |
| `pd_upper` | 2 字节 | Tuple 数据的起始位置（空闲空间终点） |
| `pd_special` | 2 字节 | 特殊空间的起始偏移 |
| `pd_pagesize_version` | 2 字节 | 页大小和布局版本号 |

### ItemId（行指针）

每个 ItemId 占 **4 字节**，记录对应 Tuple 在页内的偏移和长度。ItemId 数组从页头开始向后增长，Tuple 数据从页尾开始向前增长，中间是 Free Space。

```
ItemId 结构 (4 bytes):
┌──────────────────────────────────┐
│  offset (15 bits) | flags (2 bits) | length (15 bits) │
└──────────────────────────────────┘
```

---

## 3. 堆表（Heap Table）存储方式

PostgreSQL 默认使用 **堆表（Heap Table）** 存储数据，即行记录无序地存放在数据页中。

### 3.1 Tuple（元组）结构

```
┌────────────────────────────────────┐
│        HeapTupleHeaderData         │
│  (23~27 字节，含对齐)              │
│                                    │
│  t_xmin:   插入该元组的事务 ID     │
│  t_xmax:   删除/锁定该元组的事务ID │
│  t_cid:    命令 ID (同一事务内序号) │
│  t_ctid:   当前元组的物理位置       │
│            (page_number, offset)   │
│  t_infomask: 元组状态标志位        │
│  t_hoff:   用户数据起始偏移        │
├────────────────────────────────────┤
│         Null Bitmap (可选)         │
│   标记哪些列为 NULL                │
├────────────────────────────────────┤
│         用户数据 (列值)            │
│   按列定义顺序存储                 │
│   变长列: 1~4 字节长度前缀 + 数据  │
└────────────────────────────────────┘
```

### 3.2 多版本并发控制（MVCC）

PG 的 MVCC 直接体现在 Tuple 头部：

| 操作 | 行为 |
|------|------|
| **INSERT** | 写入新 Tuple，`t_xmin` = 当前事务 ID |
| **UPDATE** | 旧行标记删除（`t_xmax` = 当前事务 ID），新行作为新 Tuple 插入 |
| **DELETE** | 不物理删除，仅设置 `t_xmax` = 当前事务 ID |
| **SELECT** | 根据 `t_xmin`、`t_xmax` 和事务快照判断可见性 |

> **与 MySQL 的关键区别：** InnoDB 将旧版本存放在 Undo Log 中，表中只保留最新版本；PG 直接在表中保留多个版本。这意味着 PG 的 UPDATE 实际上是 DELETE + INSERT，会产生更多死元组（dead tuples），需要 VACUUM 清理。

---

## 4. TOAST 机制（大字段存储）

**TOAST（The Oversized-Attribute Storage Technique）** 是 PG 处理大字段的机制。当一行数据超过单页容量时，大字段值会被"弹出"到独立的 TOAST 表中。

### TOAST 触发条件

- 单个 Tuple 超过约 **2KB**（约 1/4 页）时，PG 会尝试 TOAST
- TOAST 表的命名格式：`pg_toast.pg_toast_<oid>`

### TOAST 存储策略

| 策略 | 说明 | 适用场景 |
|------|------|---------|
| **PLAIN** | 不压缩，不外部存储 | 小字段（默认值） |
| **EXTENDED** | 先压缩，压缩后仍太大则外部存储 | TEXT、BYTEA（默认策略） |
| **EXTERNAL** | 不压缩，直接外部存储 | 不需要压缩的大字段 |
| **MAIN** | 压缩，尽量不外部存储 | 需要尽量保留在行内的字段 |

```
┌─────────────────────────────────────────────────┐
│                  主表 (Heap Table)                │
│                                                  │
│  ┌──────────────────────────────────────────┐    │
│  │ Tuple: [col1] [col2] [col3→TOAST Pointer]│    │
│  └──────────────┬───────────────────────────┘    │
│                 │                                │
│                 ▼ TOAST Pointer                  │
│  ┌──────────────────────────────────────────┐    │
│  │ TOAST 表 (pg_toast.pg_toast_xxxxx)       │    │
│  │                                          │    │
│  │  Chunk 1: [chunk_id, seq, data...]       │    │
│  │  Chunk 2: [chunk_id, seq, data...]       │    │
│  │  Chunk 3: [chunk_id, seq, data...]       │    │
│  │  ...                                     │    │
│  │  (每个 chunk 默认 2KB)                    │    │
│  └──────────────────────────────────────────┘    │
└─────────────────────────────────────────────────┘
```

> **实践建议：** 对于 JSONB 列中可能存储大 JSON 文档的场景，注意 TOAST 的存在。频繁访问 TOAST 存储的列会产生额外的 I/O。如果大部分查询不需要该大字段，可以考虑拆表或使用延迟加载。

---

## 5. 表空间（Tablespace）

表空间定义了数据库对象在文件系统中的存储位置。

```
┌─────────────────────────────────────────────┐
│              表空间 (Tablespace)              │
│                                              │
│  pg_default (默认表空间)                      │
│  → $PGDATA/base/                             │
│                                              │
│  pg_global (全局共享表空间)                    │
│  → $PGDATA/global/                           │
│                                              │
│  自定义表空间:                                │
│  → 指定目录下的 PG_VERSION 文件               │
│  → 可指向不同磁盘/SSD                        │
└─────────────────────────────────────────────┘
```

| 用途 | 说明 |
|------|------|
| **磁盘空间管理** | 将大表放在高速 SSD，小表放在 HDD |
| **I/O 隔离** | 将热点表和冷数据表分离到不同磁盘 |
| **备份策略** | 不同表空间可以使用不同的备份策略 |

```sql
-- 创建表空间
CREATE TABLESPACE fast_ssd LOCATION '/mnt/ssd/pg_data';

-- 在指定表空间创建表
CREATE TABLE orders (
    id BIGSERIAL PRIMARY KEY,
    data JSONB
) TABLESPACE fast_ssd;
```

---

## 6. 数据目录结构

`$PGDATA` 目录是 PG 集群的根目录，主要结构如下：

```
$PGDATA/
├── base/                  # 各数据库的数据文件
│   ├── 1/                 # template1 的数据
│   ├── 13587/             # 用户数据库的数据（OID 为键）
│   │   ├── 16384          # 表的数据文件（relfilenode）
│   │   ├── 16384.1        # 表的 FSM（Free Space Map）
│   │   ├── 16384.2        # 表的 VM（Visibility Map）
│   │   └── ...
│   └── ...
├── global/                # 集群共享数据（pg_database, pg_authid 等）
├── pg_wal/                # WAL 日志文件
│   ├── 000000010000000000000001  # WAL 段文件 (16MB)
│   ├── 000000010000000000000002
│   └── ...
├── pg_xact/               # 事务提交状态（CLOG）
├── pg_tblspc/             # 表空间符号链接
├── pg_stat_tmp/           # 统计信息临时文件
├── pg_logical/            # 逻辑复制相关数据
├── pg_commit_ts/          # 事务提交时间戳
├── postgresql.conf        # 主配置文件
├── pg_hba.conf            # 客户端认证配置
├── pg_ident.conf          # 用户名映射
├── postmaster.pid         # Postmaster PID 文件
├── postmaster.opts        # 启动参数记录
└── PG_VERSION             # PG 主版本号
```

### 数据文件命名规则

| 文件后缀 | 说明 |
|----------|------|
| 无后缀 | 表/索引的主数据文件（大小 = N × 8KB） |
| `.1`, `.2`, ... | 超过 1GB 的表自动分段（段文件） |
| `_fsm` | Free Space Map — 记录每个数据页的空闲空间 |
| `_vm` | Visibility Map — 记录哪些页的所有元组都可见（用于 Index-Only Scan 和 VACUUM 跳过） |

### FSM 和 VM 的作用

```
表数据文件: 16384
  ├── 16384        (主数据文件，存储实际 Tuple)
  ├── 16384_fsm    (Free Space Map: 记录每页空闲空间大小)
  │   → INSERT 时快速找到有足够空间的页，避免全表扫描
  └── 16384_vm     (Visibility Map: 标记全可见页)
      → Index-Only Scan: 只需检查 VM 而非回表
      → VACUUM: 跳过全可见页，减少扫描量
```

> **性能关联：** 当表膨胀严重时，FSM 无法有效指导空间分配，导致 INSERT 变慢。此时需要 `VACUUM FULL` 或 `pg_repack` 来回收空间。VM 对 Index-Only Scan 至关重要 — 如果 VM 标记不准确，优化器会选择普通 Index Scan 而非 Index-Only Scan。

---

## 本章小结

| 要点 | 记忆关键词 |
|------|-----------|
| PG 数据页固定 8KB | 比 InnoDB 的 16KB 小一半 |
| PageHeader + ItemId + Tuple + Free Space | ItemId 从前往后，Tuple 从后往前 |
| 堆表存储，MVCC 在 Tuple 头部 | UPDATE = DELETE + INSERT，产生死元组 |
| TOAST 处理大字段 | 超 2KB 触发，chunk 分片存储 |
| FSM 加速插入，VM 加速 Index-Only Scan | 膨胀问题的诊断切入点 |
| base/ 存数据，pg_wal/ 存 WAL | 按 OID 和 relfilenode 组织 |
