---
doc_id: pg-partitioning
title: 表分区
---

# 表分区

> **核心问题**：什么时候用分区？范围分区、列表分区、哈希分区怎么用？

## 1. 范围分区

```sql
CREATE TABLE orders (
    id BIGSERIAL,
    user_id BIGINT,
    amount DECIMAL(10,2),
    created_at TIMESTAMP
) PARTITION BY RANGE (created_at);

CREATE TABLE orders_2024 PARTITION OF orders
    FOR VALUES FROM ('2024-01-01') TO ('2025-01-01');
CREATE TABLE orders_2025 PARTITION OF orders
    FOR VALUES FROM ('2025-01-01') TO ('2026-01-01');
```

## 2. 列表分区

```sql
CREATE TABLE users (
    id BIGSERIAL,
    name VARCHAR(50),
    region VARCHAR(20)
) PARTITION BY LIST (region);

CREATE TABLE users_north PARTITION OF users FOR VALUES IN ('north');
CREATE TABLE users_south PARTITION OF users FOR VALUES IN ('south');
```

## 3. 哈希分区

```sql
CREATE TABLE logs (
    id BIGSERIAL,
    message TEXT
) PARTITION BY HASH (id);

CREATE TABLE logs_0 PARTITION OF logs FOR VALUES WITH (MODULUS 4, REMAINDER 0);
CREATE TABLE logs_1 PARTITION OF logs FOR VALUES WITH (MODULUS 4, REMAINDER 1);
```

## 4. 分区裁剪

```sql
-- 只扫描相关分区
EXPLAIN SELECT * FROM orders WHERE created_at = '2024-06-01';
-- 输出：orders_2024
```

## 5. 自动创建分区（pg_partman）

```sql
-- 使用 pg_partman 扩展自动管理分区
CREATE EXTENSION pg_partman;

SELECT partman.create_parent(
    p_parent_table := 'public.orders',
    p_control := 'created_at',
    p_type := 'range',
    p_interval := '1 month',
    p_premake := 3  -- 提前创建 3 个未来分区
);

-- 运行分区维护（通常通过 pg_cron 定时执行）
SELECT partman.run_maintenance();
```

## 6. 分区表的索引

```sql
-- 在父表上创建索引会自动在所有分区上创建
CREATE INDEX idx_orders_user_id ON orders(user_id);

-- 分区表上创建唯一索引（必须包含分区键）
CREATE UNIQUE INDEX idx_orders_id_created ON orders(id, created_at);
```

## 7. 分区合并与拆分

```sql
-- 合并分区
ALTER TABLE orders DETACH PARTITION orders_2024;
-- 手动合并数据后重新附加
ALTER TABLE orders ATTACH PARTITION orders_2024
    FOR VALUES FROM ('2024-01-01') TO ('2025-01-01');

-- 拆分分区
ALTER TABLE orders DETACH PARTITION orders_2024;
CREATE TABLE orders_2024_h1 PARTITION OF orders
    FOR VALUES FROM ('2024-01-01') TO ('2024-07-01');
CREATE TABLE orders_2024_h2 PARTITION OF orders
    FOR VALUES FROM ('2024-07-01') TO ('2025-01-01');
```

## 8. 旧分区处理

```sql
-- 快速删除旧数据（比 DELETE 快得多）
ALTER TABLE orders DETACH PARTITION orders_2023;
DROP TABLE orders_2023;  -- 瞬间完成
```

## 9. 分区最佳实践

| 实践 | 说明 |
| :-- | :-- |
| **分区键选择** | 选择查询频率最高的过滤条件（通常是时间或地区） |
| **分区粒度** | 时间分区建议月分区（日分区过多，年分区过少） |
| **索引策略** | 分区表索引应该包含分区键，支持分区裁剪 |
| **自动管理** | 使用 pg_partman 自动创建和清理分区 |
| **旧分区处理** | 旧分区可以 DETACH 后归档或删除，比 DELETE 快得多 |
| **唯一约束** | 分区表的唯一索引必须包含分区键 |

> **什么时候用分区**：表超过 1 亿行、需要快速删除旧数据、查询总带有时间/地区过滤条件。分区不是万能的，小表分区反而增加复杂度。
