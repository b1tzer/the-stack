---
doc_id: pg-jsonb
title: JSONB 高级用法
---

# JSONB 高级用法

> **核心问题**：PG 的 JSONB 有哪些操作符？如何建索引？与 MySQL 的 JSON 有什么区别？

## 1. JSON vs JSONB

| 对比项 | JSON | JSONB |
| :-- | :-- | :-- |
| 存储格式 | 文本（保留原始格式） | 二进制（解析后存储） |
| 写入速度 | 快（不需要解析） | 稍慢（需要解析为二进制） |
| 查询速度 | 慢（每次查询都要解析） | **快**（已预解析） |
| 支持索引 | ❌ | ✅ GIN 索引 |
| 保留键顺序 | ✅ | ❌ |
| **推荐使用** | 仅需存储不查询时 | **绝大多数场景** |

> **结论**：除非有特殊需求（如保留 JSON 原始格式），否则**一律使用 JSONB**。

## 2. JSONB 操作符

```sql
-- 创建示例表
CREATE TABLE products (
    id SERIAL PRIMARY KEY,
    name TEXT,
    attrs JSONB
);

INSERT INTO products (name, attrs) VALUES 
('iPhone 15', '{"brand": "Apple", "price": 7999, "colors": ["黑色", "白色", "蓝色"], "specs": {"cpu": "A17", "ram": "8GB"}}');

-- -> 提取 JSON 对象（返回 JSONB 类型）
SELECT attrs -> 'brand' FROM products;          -- "Apple"

-- ->> 提取文本值（返回 TEXT 类型）
SELECT attrs ->> 'brand' FROM products;         -- Apple

-- #> 按路径提取 JSON 对象
SELECT attrs #> '{specs, cpu}' FROM products;   -- "A17"

-- #>> 按路径提取文本值
SELECT attrs #>> '{specs, cpu}' FROM products;  -- A17

-- @> 包含
SELECT * FROM products WHERE attrs @> '{"brand": "Apple"}';

-- ? 键是否存在
SELECT * FROM products WHERE attrs ? 'brand';

-- ?| 任一键存在
SELECT * FROM products WHERE attrs ?| array['brand', 'weight'];

-- ?& 所有键都存在
SELECT * FROM products WHERE attrs ?& array['brand', 'price'];

-- || 合并（新增或覆盖字段）
UPDATE products SET attrs = attrs || '{"weight": "187g"}' WHERE id = 1;

-- - 删除键
UPDATE products SET attrs = attrs - 'weight' WHERE id = 1;

-- #- 按路径删除
UPDATE products SET attrs = attrs #- '{specs, ram}' WHERE id = 1;

-- jsonb_set 设置嵌套字段的值
UPDATE products SET attrs = jsonb_set(attrs, '{specs, storage}', '"256GB"') WHERE id = 1;
```

## 3. JSONB 索引

```sql
-- 默认 GIN 索引（支持 @>、?、?|、?& 操作符）
CREATE INDEX idx_products_attrs ON products USING GIN (attrs);

-- jsonb_path_ops 操作符类（只支持 @>，但索引更小、更快）
CREATE INDEX idx_products_attrs_path ON products USING GIN (attrs jsonb_path_ops);

-- 对 JSONB 中的特定字段建 B-tree 索引
CREATE INDEX idx_products_brand ON products ((attrs ->> 'brand'));
CREATE INDEX idx_products_price ON products (((attrs ->> 'price')::numeric));
```

| GIN 操作符类 | 支持的操作符 | 索引大小 | 适用场景 |
| :-- | :-- | :-- | :-- |
| 默认（jsonb_ops） | `@>`、`?`、`?|`、`?&` | 较大 | 需要键存在性查询 |
| jsonb_path_ops | 仅 `@>` | **更小** | 只需要包含查询 |

> **选择建议**：需要 `@>` 包含查询 → GIN 索引；需要特定字段的等值/范围查询 → 表达式 B-tree 索引。两者可以共存。

## 4. 聚合与展开

```sql
-- jsonb_array_elements 展开 JSONB 数组为多行
SELECT name, jsonb_array_elements_text(attrs -> 'colors') AS color
FROM products;

-- jsonb_agg 将多行聚合为 JSONB 数组
SELECT jsonb_agg(name) FROM products;

-- jsonb_object_agg 将多行聚合为 JSONB 对象
SELECT jsonb_object_agg(name, attrs ->> 'price') FROM products;

-- jsonb_each 遍历键值对
SELECT key, value FROM products, jsonb_each(attrs -> 'specs') 
WHERE name = 'iPhone 15';
```

## 5. 实战场景

### 5.1 商品 SKU 属性

```sql
CREATE TABLE sku (
    id BIGSERIAL PRIMARY KEY,
    product_name TEXT NOT NULL,
    category TEXT NOT NULL,
    attrs JSONB NOT NULL DEFAULT '{}'
);

CREATE INDEX idx_sku_attrs ON sku USING GIN (attrs);

-- 查询所有 8GB 内存的手机
SELECT * FROM sku WHERE category = '手机' AND attrs @> '{"ram": "8GB"}';
```

### 5.2 用户配置

```sql
CREATE TABLE user_settings (
    user_id BIGINT PRIMARY KEY,
    settings JSONB NOT NULL DEFAULT '{}'
);

-- 更新单个配置项（不影响其他配置）
UPDATE user_settings 
SET settings = settings || '{"theme": "dark", "language": "zh-CN"}'
WHERE user_id = 1;
```

## 6. JSONB vs 关系表：如何选择？

| 考虑因素 | 用 JSONB | 用关系表 |
| :-- | :-- | :-- |
| 数据结构 | 半结构化、字段不固定 | 结构固定、字段明确 |
| 查询模式 | 按键值对查询 | 复杂 JOIN、聚合 |
| 数据完整性 | 不需要严格约束 | 需要外键、NOT NULL 等约束 |
| 典型场景 | 商品属性、用户配置、日志元数据 | 订单、用户、账户等核心业务表 |

> **最佳实践**：核心业务数据用关系表，灵活扩展属性用 JSONB。

## 7. 常见问题

**Q：PG 的 JSONB 和 MySQL 的 JSON 有什么区别？**

> PG 的 JSONB 是二进制存储，支持 GIN 索引，查询性能远优于 MySQL 的文本存储 JSON。PG 的 JSONB 操作符更丰富，MySQL 主要通过函数操作 JSON。

**Q：`->` 和 `->>` 有什么区别？**

> `->` 返回 JSONB 类型（带引号），适合继续链式操作；`->>` 返回 TEXT 类型（不带引号），适合最终取值。WHERE 条件中通常用 `->>` 或 `@>`。
