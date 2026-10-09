# 内省与可观测性

> 本页解释 MySQL 内置观测机制；Prometheus 指标采集、可视化和告警见[监控](./chapter-03-monitoring.md)。

## 1. 这套东西解决什么问题

排查数据库问题时，你手上有两个截然不同的诉求：一个是"数据库里**有什么**"，另一个是"数据库**正在发生什么**"。前者是静态的目录，后者是动态的现场。MySQL 把这两件事分别固化成两个系统库，再加一层把它们翻译成人话的视图库，三者共同构成 MySQL 的**内省（introspection）层**。

| | information_schema | performance_schema | sys |
| :-- | :-- | :-- | :-- |
| 回答的问题 | 库里有什么（结构） | 正在发生什么（运行时） | 上面两层的结论（诊断） |
| 数据性质 | 静态元数据 | 动态埋点 | 只读视图 |
| 类比 | 仓库的货物清单 | 仓库的监控摄像头 | 值班员的总结报告 |
| 可写性 | 只读 | 只读（配置表除外） | 只读 |

理解这一层，关键是抓住一条链路，而不是背表名：

```txt
元数据（有什么）──→ 观测（正在发生什么）──→ 诊断（为什么慢/为什么锁）
information_schema ──→ performance_schema ──→ sys + EXPLAIN
```

## 2. information_schema：数据库里有什么

### 2.1 它是什么

`information_schema` 是一组**只读的虚拟表**，把库、表、列、索引、约束、权限等所有结构定义摊开来给你看。它的数据不是存在磁盘上的物理表，而是 MySQL 启动后从**数据字典（Data Dictionary）**实时映射出来的元数据。

MySQL 8.0 是关键分水岭：数据字典从原来分散在各库目录下的 `.frm` 文件，迁移到了 InnoDB 里的一组**事务化系统表**。带来的直接后果是——元数据查询也走 InnoDB，不再依赖文件系统，`information_schema` 的查询性能大幅提升，也避免了早版本里 `.frm` 文件与真实表结构不一致的坑。

### 2.2 为什么要有它

没有它，你想知道"这个库有哪些表、每张表有哪些列、索引长什么样"，只能去解析物理文件或猜。它把 schema 的结构信息抽象成**可以用标准 SQL 查询的关系**，让"元数据也是数据"这件事成立。这是很多工具（ORM 反向工程、生成器、监控采集）的底层数据源。

### 2.3 常用表与典型查询

```sql
-- 这个库有哪些表和它们的引擎
SELECT table_name, engine, table_rows, data_length, index_length
FROM information_schema.tables
WHERE table_schema = 'mydb';

-- 某张表的所有列
SELECT column_name, column_type, is_nullable, column_default, column_comment
FROM information_schema.columns
WHERE table_schema = 'mydb' AND table_name = 'users';

-- 哪些列是索引、索引的类型
SELECT index_name, column_name, non_unique, seq_in_index
FROM information_schema.statistics
WHERE table_schema = 'mydb' AND table_name = 'users';

-- 找"没有主键"的表（生产隐患）
SELECT t.table_name
FROM information_schema.tables t
LEFT JOIN information_schema.table_constraints c
  ON t.table_schema = c.table_schema
 AND t.table_name = c.table_name
 AND c.constraint_type = 'PRIMARY KEY'
WHERE t.table_schema = 'mydb' AND c.constraint_name IS NULL;

-- 找大表（按数据量 + 索引量估算）
SELECT table_name,
       ROUND((data_length + index_length) / 1024 / 1024, 2) AS size_mb
FROM information_schema.tables
WHERE table_schema = 'mydb'
ORDER BY data_length + index_length DESC;

-- 冗余索引：某个索引是另一个索引的前缀
SELECT s1.table_name, s1.index_name AS redundant, s2.index_name AS superset
FROM information_schema.statistics s1
JOIN information_schema.statistics s2
  ON s1.table_name = s2.table_name
 AND s1.index_name <> s2.index_name
 AND s1.seq_in_index = 1 AND s2.seq_in_index = 1
 AND s1.column_name = s2.column_name
GROUP BY s1.table_name, s1.index_name, s2.index_name;
```

### 2.4 需要注意的点

- **只读，不能改**：改结构必须走 `ALTER TABLE` / `CREATE`，不能动它本身。
- **有权限门槛**：普通用户只能看到自己有权访问的那部分，看不到全局。
- **结果可能不精确**：`table_rows` 是估算值（来自 InnoDB 统计信息），要准数用 `COUNT(*)`。

## 3. performance_schema：数据库正在发生什么

### 3.1 它是什么

`performance_schema`（简称 P_S）是一组**内存里的只读表**，记录数据库运行期间的**事件**：谁在等锁、哪条语句最慢、哪个连接占了多少内存、磁盘 I/O 都花在了哪张表上。它默认随 8.0 自动开启，由后台线程持续采集，数据只在内存里滚动，重启即清空。

### 3.2 它的核心概念：三层事件

P_S 用一套统一的"事件"模型覆盖几乎所有运行时行为，事件按层级由粗到细：

```
transaction（事务）→ statement（语句）→ stage（阶段）→ wait（等待）
```

一个查询从进来到返回，会被拆成多个 stage（解析、优化、执行），每个 stage 里又有若干次 wait（等锁、等 I/O），最后汇总成一条 statement。对应的表也按这个层级命名：

- `events_statements_*`：语句级聚合
- `events_stages_*`：阶段级明细
- `events_waits_*`：等待级（锁、I/O、同步）
- `table_io_waits_summary_by_table`：按表统计的 I/O 等待
- `memory_summary_by_thread_by_event_name`：按线程统计的内存占用

### 3.3 为什么需要它，以及为什么和 SHOW 并存

在 P_S 出现前，查运行状态只能靠 `SHOW STATUS` / `SHOW VARIABLES` / `SHOW ENGINE INNODB STATUS`。这些是**全局计数器或快照**，只能告诉你"现在累计了多少"，无法回答"是谁、在什么时候、等什么等了多久"。P_S 的价值正在于它把观测维度细化到**语句、线程、对象**级别，并且是结构化的、可以用 SQL 关联查询的。

两者并存而非互相取代，是因为定位不同：`SHOW` 便宜、随手可查、适合快速看全局刻度；P_S 贵一点、能定位到根因、适合深挖。实践中"先 `SHOW` 摸轮廓，再 P_S 钻细节"是标准动作。

### 3.4 典型排查场景

```sql
-- 谁在等锁、等的是哪个锁（死锁/锁等待排查入口）
SELECT * FROM performance_schema.data_lock_waits;

-- 当前活跃的连接和它们执行的语句
SELECT t.processlist_id, t.processlist_command,
       LEFT(esc.sql_text, 80) AS sql_text
FROM performance_schema.threads t
LEFT JOIN performance_schema.events_statements_current esc
  ON t.thread_id = esc.thread_id
WHERE t.processlist_state IS NOT NULL;

-- 被统计的所有语句里，总耗时最高的 Top 10（找慢查询）
SELECT schema_name, digest_text,
       count_star,
       ROUND(sum_timer_wait / 1e12, 2) AS total_sec,
       ROUND(avg_timer_wait / 1e9, 2) AS avg_ms
FROM performance_schema.events_statements_summary_by_digest
ORDER BY sum_timer_wait DESC
LIMIT 10;

-- 哪张表 I/O 等待最多（找热点表）
SELECT object_schema, object_name, index_name,
       count_read, count_write,
       ROUND(sum_timer_wait / 1e12, 2) AS total_sec
FROM performance_schema.table_io_waits_summary_by_table
ORDER BY sum_timer_wait DESC;

-- 内存按线程/事件类型分布（查内存泄漏）
SELECT thread_id, event_name,
       ROUND(sum_number_of_bytes_alloc / 1024 / 1024, 2) AS allocated_mb
FROM performance_schema.memory_summary_by_thread_by_event_name
ORDER BY allocated_mb DESC;
```

### 3.5 需要注意的点

P_S 不是无代价的免费午餐，这是它最大的"坑"：

- **采集有开销**：开启的 instrument 越多，对 CPU/内存的持续消耗越大。默认配置已经很克制，生产上别盲目全开 `setup_instruments`。
- **消费者要显式开启**：埋点数据默认只进 `setup_consumers` 里勾选的那几张表。想查 `events_statements_history_long` 这类历史明细，得先确认对应 consumer 是 `YES`。
- **内存表会滚动**：明细表是环形缓冲，旧事件会被覆盖，查历史要有心理预期。
- **线程映射**：P_S 用 `thread_id` 关联，`processlist_id` 才对应 `SHOW PROCESSLIST` 里的进程，两套 ID 别混。

## 4. sys：把人话讲清楚

### 4.1 它是什么

`sys` schema 是一组**只读视图 + 存储过程**，本质是包在 `performance_schema` 和 `information_schema` 外面的一层"翻译"。P_S 的表命名冗长、字段是皮秒级的 `timer_wait`、还经常要自己 JOIN，直接查很痛苦；sys 把它们整理成 `x$`（原始值）和去掉 `x$`（已换算成秒/MB/% 等人类单位）两套视图，外加一批拼装好的诊断存储过程。

### 4.2 为什么需要它

它解决的是"可观测性数据**可用性**"的问题——不是再采集一份新数据，而是让已有数据**读到即懂**。一句话：P_S 是原料，sys 是成品。

### 4.3 常用视图与过程

```sql
-- 最慢的语句（直接给百分比，不用看皮秒）
SELECT * FROM sys.statements_with_runtimes_in_95th_percentile LIMIT 10;

-- 未使用 / 冗余索引（清理索引神器）
SELECT * FROM sys.schema_unused_indexes;
SELECT * FROM sys.schema_redundant_indexes;

-- 当前每个连接的概况：跑了什么、等了什么、杀了什么
SELECT * FROM sys.session;

-- 诊断一个具体的连接（返回要跑的建议命令）
CALL sys.ps_trace_thread(<thread_id>, 'output_file', 10, 0.01, TRUE, TRUE);

-- InnoDB 缓冲池各表的占用排行
SELECT * FROM sys.innodb_buffer_stats_by_table
ORDER BY pages DESC LIMIT 10;
```

## 5. 三张表的协同与选型

遇到问题时按这个顺序走，能少走弯路：

```txt
1. SHOW 摸全局刻度（快、便宜）
     └─ SHOW STATUS / SHOW PROCESSLIST / SHOW ENGINE INNODB STATUS
2. sys 看现成结论（能直接定位，就不进 P_S 裸表）
     └─ sys.session / sys.schema_redundant_indexes / sys.statements_...
3. performance_schema 钻根因（sys 不够细时）
     └─ events_* / data_lock_waits / memory_summary_*
4. information_schema 查结构佐证
     └─ 表结构 / 索引定义 / 约束
```

**速查对照**（问题 → 去哪查）：

| 你想知道 | 首选入口 |
| :-- | :-- |
| 最慢的 SQL 是哪些 | `sys.statements_with_runtimes_in_95th_percentile` |
| 现在谁卡着、在等什么 | `sys.session` / `performance_schema.data_lock_waits` |
| 哪些索引没用、哪些重复 | `sys.schema_unused_indexes` / `schema_redundant_indexes` |
| 哪张表 I/O 最热 | `performance_schema.table_io_waits_summary_by_table` |
| 内存被谁吃了 | `performance_schema.memory_summary_by_*` |
| 这个库有哪些表/列/索引 | `information_schema.tables/columns/statistics` |
| 有没有表缺主键、有大表 | `information_schema.tables` 关联查询 |

## 6. 一句话小结

`information_schema` 告诉你**有什么**，`performance_schema` 告诉你**正在发生什么**，`sys` 把这两者的结论**翻译成人话**。排查问题时，养成"SHOW 摸轮廓 → sys 看结论 → P_S 钻根因 → information_schema 佐证结构"的顺序，比背一堆表名有用得多。但记住 P_S 的采集不是免费的，开 instrument 前先掂量它的开销。
