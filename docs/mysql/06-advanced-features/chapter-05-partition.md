# 分区表

一张 `orders` 表跑上几年，堆到几十亿行以后，事情开始不对劲：全表扫描慢得令人发指，删掉三年前的历史数据要跑几个小时的 `DELETE`，`OPTIMIZE TABLE` 一执行就锁表半宿。索引可以解决一部分查询问题，但删数据和空间回收依然痛苦——因为无论怎么加索引，物理上它还是一张表、一个大文件、一棵大 B+ 树。

分区（Partitioning）就是把这张逻辑上的大表，按某种规则切成若干个物理片段。对应用而言，仍然是同一张表、同一份 SQL；对存储引擎而言，每个分区是独立的数据文件、独立的索引，可以单独查询、单独删除、单独归档。它带来的直接好处有两个：其一是**分区裁剪**——查询只扫描与条件相关的分区，扫描量骤降；其二是**批量数据管理**——`DROP PARTITION` 是秒级的元数据操作，比 `DELETE` 快几个数量级。

::: warning 版本要求
分区功能诞生较早，但演进路径较长，各阶段能力差异明显：

| 特性 | 起始版本 |
| :-- | :-- |
| 基础分区（RANGE / LIST / HASH / KEY） | 5.1 |
| `RANGE COLUMNS` / `LIST COLUMNS`（支持多列、非整数类型） | 5.5 |
| 分区交换 `EXCHANGE PARTITION`、显式分区查询 | 5.6 |
| InnoDB 原生分区（性能与文件句柄大幅优化） | 5.7.6 |
| 通用分区处理器被移除，只有 InnoDB / NDB 支持分区 | 8.0 |

生产环境建议至少使用 5.7.6+，以享受 InnoDB 原生分区带来的资源优势。8.0 之后 MyISAM 等不实现原生分区的引擎无法再创建分区表，升级前需要预先转换为 InnoDB。
:::

## 1. 四种分区类型

MySQL 支持四种主要的分区方式，选择哪一种取决于数据本身的分布特征。

### 1.1 RANGE 分区：按范围切分

`RANGE` 分区把某个列（或表达式）的取值范围切成若干段，每段一个分区。它最典型的用途是**按时间切分**，因为时间数据天然连续、天然有序，也天然有「查最近、删最老」的访问模式。

```sql
CREATE TABLE orders (
    id BIGINT,
    user_id BIGINT,
    amount DECIMAL(10,2),
    created_at DATE,
    PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (YEAR(created_at)) (
    PARTITION p2023 VALUES LESS THAN (2024),
    PARTITION p2024 VALUES LESS THAN (2025),
    PARTITION p2025 VALUES LESS THAN (2026),
    PARTITION pmax  VALUES LESS THAN MAXVALUE
);
```

`VALUES LESS THAN` 声明的是分区的上界（开区间），2024 年的数据落到 `p2024`。最后的 `pmax` 是兜底分区——`MAXVALUE` 表示无穷大，用来接住未来年份的数据，避免落不进任何分区而报错。真正做数据归档时，通常不让 `pmax` 长期存在，而是每年提前 `REORGANIZE` 出下一年的具体分区。

注意主键包含了 `created_at`。这不是可选优化，是**硬性要求**：分区键必须是每个唯一索引（包括主键）的一部分，否则 MySQL 无法保证唯一性——不同分区的 B+ 树各自独立，同一个 `id` 完全可能出现在两个分区里。这条限制往往会打乱原有的主键设计。

### 1.2 LIST 分区：按枚举值切分

`LIST` 用于**离散取值**的场景，比如按地区、按业务线切分。它和 `RANGE` 的区别在于：一个 `RANGE` 是连续区间，一个 `LIST` 是可枚举的具体值集合。

```sql
CREATE TABLE users (
    id INT,
    name VARCHAR(50),
    region VARCHAR(20),
    PRIMARY KEY (id, region)
) PARTITION BY LIST COLUMNS (region) (
    PARTITION p_north VALUES IN ('north'),
    PARTITION p_south VALUES IN ('south'),
    PARTITION p_east  VALUES IN ('east')
);
```

这里用了 `LIST COLUMNS` 而不是 `LIST`，因为 `region` 是字符串。原始 `LIST` 只接受整数表达式，`LIST COLUMNS` 是 8.0 以后放宽的版本，支持字符串、日期等更多类型。用 `LIST` 时一定要覆盖所有可能取值，如果插入一个未列出的 `region`（例如 `'west'`），会直接报错——它没有 `MAXVALUE` 这种兜底语法。

### 1.3 HASH 分区：均匀打散

如果没有天然的范围或枚举可用，只是想把数据均匀打散、避免单分区过大，那就用 `HASH`：

```sql
CREATE TABLE logs (
    id BIGINT AUTO_INCREMENT,
    user_id BIGINT,
    message TEXT,
    PRIMARY KEY (id, user_id)
) PARTITION BY HASH (user_id) PARTITIONS 4;
```

MySQL 对 `user_id` 取模 4，决定行落到哪个分区。`HASH` 的意义只在于**均匀分布 I/O**，因为它无法支持范围裁剪——`WHERE user_id BETWEEN 100 AND 200` 在 `HASH` 分区表上仍然要扫全部分区，只有 `WHERE user_id = 42` 这种等值查询才能定位到具体分区。

### 1.4 KEY 分区：MySQL 自己算哈希

`KEY` 分区和 `HASH` 几乎相同，区别在于哈希函数是 MySQL 内置的，而不是你写在括号里的表达式。它的一个实际好处是**支持非整数列**——`HASH` 要求括号内的表达式返回整数，`KEY` 则可以直接对字符串、日期等类型分区。

```sql
CREATE TABLE sessions (
    id BIGINT AUTO_INCREMENT,
    session_token VARCHAR(64),
    data JSON,
    created_at DATETIME,
    PRIMARY KEY (id, session_token)
) PARTITION BY KEY (session_token) PARTITIONS 8;
```

如果不给 `KEY()` 指定列，MySQL 会用主键作为哈希键，这在批量测试环境里很方便，但生产上一般会显式指定，避免主键变更导致数据重新分布。

## 2. 分区裁剪：分区表的价值所在

分区表最大的收益来自**分区裁剪**（Partition Pruning）——优化器根据 `WHERE` 条件推断出哪些分区不可能包含匹配行，直接跳过它们。裁剪是否生效，可以用 `EXPLAIN` 输出的 `partitions` 列来验证。

裁剪的核心规则只有一句：**`WHERE` 条件必须能被优化器映射到分区表达式**。

最直接的情形是过滤列就是分区键（或与分区表达式一致），此时等值、范围、`BETWEEN`、`IN` 都能触发裁剪：

```sql
EXPLAIN SELECT * FROM orders WHERE created_at = '2024-06-01';
-- partitions: p2024

EXPLAIN SELECT * FROM orders
WHERE created_at >= '2024-01-01' AND created_at < '2025-01-01';
-- partitions: p2024
```

一个容易误解的点：即便把 `WHERE` 写成函数形式，只要**函数与分区表达式完全一致**，裁剪也能触发。对上面这张按 `YEAR(created_at)` 分区的表，下面这条 SQL 是可以裁剪的：

```sql
EXPLAIN SELECT * FROM orders WHERE YEAR(created_at) = 2024;
-- partitions: p2024
```

因为优化器知道分区表达式就是 `YEAR(created_at)`，`YEAR(created_at) = 2024` 显然只可能落在 `p2024`。官方文档明确列出，`RANGE(YEAR(col))`、`RANGE(TO_DAYS(col))`、`RANGE(TO_SECONDS(col))` 三种表达式都可以配合对应函数的等值查询做裁剪。

真正让裁剪失效的是**另一个不同的函数**：

```sql
EXPLAIN SELECT * FROM orders WHERE MONTH(created_at) = 3;
-- partitions: p2023,p2024,p2025,pmax
```

分区是按 `YEAR` 切的，`MONTH(created_at) = 3` 意味着「任意年份的三月」，每个分区里都可能有，所以只能全分区扫描。同样地，如果对 `created_at` 做类型转换、字符串拼接、`DATE_FORMAT` 等，即使语义上还是限定了年份，优化器也不认，一律全扫。

另外一种失效场景是**过滤条件根本不涉及分区键**：

```sql
EXPLAIN SELECT * FROM orders WHERE user_id = 100;
-- partitions: p2023,p2024,p2025,pmax
```

这类查询在分区表上不但没变快，反而更慢——因为原本一个大 B+ 树的索引查找，被拆成了每个分区各查一次。这是分区设计里最常见的性能反例：**当查询模式与分区键不匹配时，分区不仅无益，反而有害**。

## 3. 分区管理：为什么它比 DELETE 强

`DROP PARTITION` 是分区表相比普通表最实用的运维能力。删除一个分区本质上是**卸载一个数据文件加更新元数据**，即使这个分区有几亿行，也是秒级完成的：

```sql
ALTER TABLE orders DROP PARTITION p2023;
```

作为对比，`DELETE FROM orders WHERE created_at < '2024-01-01'` 会逐行删除、逐行写 undo、逐行写 binlog、逐行更新索引，几亿行下来可能跑几个小时，还会撑爆事务日志。分区表的这个能力，是很多日志类、监控类系统选择分区的唯一原因。

日常运维的典型模式是「滚动窗口」——新数据流入前建好新分区，老数据到期后 `DROP` 掉：

```sql
-- 每年年底，把兜底分区拆出下一年
ALTER TABLE orders REORGANIZE PARTITION pmax INTO (
    PARTITION p2026 VALUES LESS THAN (2027),
    PARTITION pmax  VALUES LESS THAN MAXVALUE
);

-- 到期归档：先把老分区数据搬到独立归档表，再从主表卸载
ALTER TABLE orders EXCHANGE PARTITION p2023 WITH TABLE orders_archive_2023;
ALTER TABLE orders DROP PARTITION p2023;
```

`EXCHANGE PARTITION` 让分区数据与一张独立表原地互换——两边表结构必须一致，互换后原分区变成一张普通表，可以搬到冷存储或直接备份走。这个动作也是元数据级别的，即使几亿行也是秒级。

其余的分区管理操作对应到常规 DDL 就好理解：

```sql
ALTER TABLE orders ADD PARTITION (PARTITION p2026 VALUES LESS THAN (2027));
ALTER TABLE orders TRUNCATE PARTITION p2024;    -- 清空单个分区
ALTER TABLE orders ANALYZE  PARTITION p2024;    -- 重算统计信息
ALTER TABLE orders REBUILD  PARTITION p2024;    -- 重建分区、回收碎片
```

想看每个分区的大小和行数，查 `information_schema.partitions`：

```sql
SELECT
    partition_name,
    table_rows,
    ROUND(data_length  / 1024 / 1024, 2) AS data_mb,
    ROUND(index_length / 1024 / 1024, 2) AS index_mb
FROM information_schema.partitions
WHERE table_schema = 'mydb' AND table_name = 'orders'
ORDER BY partition_ordinal_position;
```

## 4. 分区表的硬限制

在决定用分区之前，有几条硬性限制必须先看：

**分区键必须是每个唯一索引的一部分**。这条前面已经反复出现——它意味着你不能在一张有 `UNIQUE(email)` 的表上，按 `created_at` 分区，除非把 `created_at` 也加进唯一索引里，而这会破坏 `email` 原本的唯一性语义。很多现有表因为这条约束而无法平滑改造成分区表。

**分区表不支持外键**。InnoDB 在实现上，外键校验依赖单一 B+ 树的可达性，而分区表把 B+ 树切开了，因此不能作为外键的父表或子表存在。如果表处于外键关系中，必须先解除外键才能分区。

**分区表不支持全文索引，也不支持空间索引**。这两类索引的实现结构与分区不兼容。想在分区表上做文本搜索，只能走应用层（例如同步到 Elasticsearch），或者不用分区。

**分区数量有软上限**。MySQL 声明的硬上限是 8192 个分区（含子分区），但实际运行中，分区数量超过一两百个以后，`open_files_limit`、优化器解析、`information_schema` 查询等都会明显变慢。生产上一般把分区数量控制在 100 以内。

## 5. 什么时候不该用分区

分区不是「大表就该分」，它有很明确的适用边界。

真正适合分区的是**时序型 + 冷热分明**的数据：日志、订单、监控指标、消息记录。这些数据既有基于时间的天然查询模式（能用上分区裁剪），又有基于时间的自然生命周期（能用上 `DROP PARTITION`）。这种场景下，分区带来的收益是量级的。

反过来，如果一张表的查询模式主要是按 `user_id`、`product_id` 这种业务维度过滤，而且**没有批量删除历史数据的需求**，那分区几乎没有意义——查询无法裁剪，`DROP PARTITION` 用不上，反而多了一堆运维复杂度和索引拆分带来的额外开销。

另一个常见的错误定位是**把分区当分库分表用**。分区是单机内部的数据组织方式，所有分区仍然在同一个 MySQL 实例上，共享同一份 CPU、内存和 I/O。当单机容量或吞吐真的到瓶颈时，需要的是分库分表（横向水平拆分），而不是分区。分区解决的是「单表太大不好维护」，分库分表解决的是「单机装不下、扛不住」，两者不能互相替代。分库分表的具体做法见 [分库分表](../07-replication-ha/chapter-06-sharding.md)。
