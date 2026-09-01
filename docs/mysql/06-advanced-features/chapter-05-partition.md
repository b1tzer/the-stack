# 分区表

## 1. 分区类型

### 1.1 范围分区

```sql
CREATE TABLE orders (
    id BIGINT,
    user_id BIGINT,
    amount DECIMAL(10,2),
    created_at DATE
) PARTITION BY RANGE (YEAR(created_at)) (
    PARTITION p2023 VALUES LESS THAN (2024),
    PARTITION p2024 VALUES LESS THAN (2025),
    PARTITION p2025 VALUES LESS THAN (2026),
    PARTITION pmax VALUES LESS THAN MAXVALUE
);
```

### 1.2 列表分区

```sql
CREATE TABLE users (
    id INT,
    name VARCHAR(50),
    region VARCHAR(20)
) PARTITION BY LIST COLUMNS (region) (
    PARTITION p_north VALUES IN ('north'),
    PARTITION p_south VALUES IN ('south'),
    PARTITION p_east VALUES IN ('east')
);
```

### 1.3 哈希分区

```sql
CREATE TABLE logs (
    id BIGINT,
    message TEXT
) PARTITION BY HASH (id) PARTITIONS 4;
```

### 1.4 KEY 分区

```sql
-- 按 KEY 分区（类似 HASH，但使用 MySQL 内部哈希函数）
CREATE TABLE sessions (
    id BIGINT AUTO_INCREMENT,
    user_id BIGINT,
    data JSON,
    created_at DATETIME,
    PRIMARY KEY (id, user_id)  -- 分区键必须是主键的一部分
) PARTITION BY KEY (user_id) PARTITIONS 8;

-- KEY 分区支持非整数类型
CREATE TABLE logs (
    id BIGINT AUTO_INCREMENT,
    message_id VARCHAR(64),
    content TEXT,
    PRIMARY KEY (id, message_id)
) PARTITION BY KEY (message_id) PARTITIONS 4;
```

## 2. 分区裁剪

### 2.1 基本用法

```sql
-- 只扫描相关分区
EXPLAIN SELECT * FROM orders WHERE created_at = '2024-06-01';
-- 输出：p2024
```

### 2.2 分区裁剪详解

```sql
-- 分区裁剪（Partition Pruning）：只扫描相关分区

-- ✅ 触发分区裁剪
EXPLAIN SELECT * FROM orders WHERE created_at = '2024-06-01';
-- partitions: p2024

EXPLAIN SELECT * FROM orders WHERE created_at >= '2024-01-01' AND created_at < '2025-01-01';
-- partitions: p2024

-- ❌ 不触发分区裁剪
EXPLAIN SELECT * FROM orders WHERE YEAR(created_at) = 2024;
-- partitions: ALL（函数操作导致无法裁剪）

-- 替代方案
EXPLAIN SELECT * FROM orders WHERE created_at >= '2024-01-01' AND created_at < '2025-01-01';
-- partitions: p2024

-- 查看裁剪信息
EXPLAIN SELECT * FROM orders WHERE id = 100;
-- 如果 id 不是分区键，会扫描所有分区
```

## 3. 分区管理

### 3.1 分区管理操作

```sql
-- 添加分区
ALTER TABLE orders ADD PARTITION (
    PARTITION p2026 VALUES LESS THAN (2027)
);

-- 删除分区（快速删除历史数据）
ALTER TABLE orders DROP PARTITION p2023;  -- 秒级完成，比 DELETE 快得多

-- 截断分区
ALTER TABLE orders TRUNCATE PARTITION p2024;

-- 重组分区
ALTER TABLE orders REORGANIZE PARTITION pmax INTO (
    PARTITION p2026 VALUES LESS THAN (2027),
    PARTITION pmax VALUES LESS THAN MAXVALUE
);

-- 交换分区（快速归档）
ALTER TABLE orders EXCHANGE PARTITION p2023 WITH TABLE orders_archive_2023;

-- 分析分区
ALTER TABLE orders ANALYZE PARTITION p2024;

-- 检查分区
ALTER TABLE orders CHECK PARTITION p2024;

-- 修复分区
ALTER TABLE orders REPAIR PARTITION p2024;

-- 查看分区信息
SELECT
    partition_name,
    table_rows,
    ROUND(data_length / 1024 / 1024, 2) AS data_mb,
    ROUND(index_length / 1024 / 1024, 2) AS index_mb
FROM information_schema.partitions
WHERE table_schema = 'mydb' AND table_name = 'orders'
ORDER BY partition_ordinal_position;
```

## 4. 限制与最佳实践

### 4.1 分区表的限制

| 限制 | 说明 |
|------|------|
| 分区键 | 必须是主键/唯一索引的一部分 |
| 最大分区数 | 8192（但实际建议不超过 100） |
| 外键 | 分区表不支持外键 |
| 全文索引 | 分区表不支持全文索引 |
| 空间索引 | 分区表不支持空间索引 |
| 临时表 | 临时表不能分区 |

### 4.2 最佳实践

1. **分区适用于时序数据** — 日志、订单、监控数据
2. **分区键选择查询最频繁的过滤列** — 确保分区裁剪
3. **避免分区过多** — 超过 100 个分区会影响性能
4. **定期清理历史分区** — `DROP PARTITION` 比 `DELETE` 快得多
5. **分区表的查询必须包含分区键** — 否则全分区扫描
6. **考虑使用表分区替代分库分表** — 单机场景下更简单
