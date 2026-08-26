---
doc_id: pg-JSONB高级用法
title: JSONB 高级用法
---

# JSONB 高级用法

> **核心问题**：PG 的 JSONB 有哪些操作符？如何建索引？与 MySQL 的 JSON 有什么区别？什么场景适合用 JSONB？

## 1. 它解决了什么问题？

现代应用中，很多数据结构是半结构化的（如用户配置、商品属性、日志元数据），用传统的关系表设计需要大量的 EAV（Entity-Attribute-Value）表或频繁的 ALTER TABLE。JSONB 让你在关系型数据库中**原生存储和查询 JSON 数据**，兼具灵活性和查询性能。

**与 MySQL JSON 的核心区别**：PG 的 JSONB 是**二进制存储**，支持 GIN 索引，查询性能远优于 MySQL 的文本存储 JSON。

# 一、JSON vs JSONB

| 对比项 | JSON | JSONB |
|--------|------|-------|
| 存储格式 | 文本（保留原始格式） | 二进制（解析后存储） |
| 写入速度 | 快（不需要解析） | 稍慢（需要解析为二进制） |
| 查询速度 | 慢（每次查询都要解析） | **快**（已预解析） |
| 支持索引 | ❌ | ✅ GIN 索引 |
| 保留键顺序 | ✅ | ❌ |
| 保留重复键 | ✅ | ❌（保留最后一个） |
| **推荐使用** | 仅需存储不查询时 | **绝大多数场景** |

> **结论**：除非有特殊需求（如保留 JSON 原始格式），否则**一律使用 JSONB**。

# 二、JSONB 操作符

## 2. 提取操作符

```sql
-- 创建示例表
CREATE TABLE products (
    id SERIAL PRIMARY KEY,
    name TEXT,
    attrs JSONB  -- 商品属性（半结构化）
);

INSERT INTO products (name, attrs) VALUES 
('iPhone 15', '{"brand": "Apple", "price": 7999, "colors": ["黑色", "白色", "蓝色"], "specs": {"cpu": "A17", "ram": "8GB"}}'),
('Galaxy S24', '{"brand": "Samsung", "price": 6999, "colors": ["黑色", "紫色"], "specs": {"cpu": "骁龙8Gen3", "ram": "12GB"}}');

-- -> 提取 JSON 对象（返回 JSONB 类型）
SELECT attrs -> 'brand' FROM products;          -- "Apple"（带引号，JSONB 类型）

-- ->> 提取文本值（返回 TEXT 类型）
SELECT attrs ->> 'brand' FROM products;         -- Apple（不带引号，TEXT 类型）

-- #> 按路径提取 JSON 对象
SELECT attrs #> '{specs, cpu}' FROM products;   -- "A17"

-- #>> 按路径提取文本值
SELECT attrs #>> '{specs, cpu}' FROM products;  -- A17

-- 提取数组元素（索引从 0 开始）
SELECT attrs -> 'colors' -> 0 FROM products;    -- "黑色"
SELECT attrs -> 'colors' ->> 1 FROM products;   -- 白色
```

## 3. 包含与存在操作符

```sql
-- @> 包含（左边包含右边）
SELECT * FROM products WHERE attrs @> '{"brand": "Apple"}';

-- <@ 被包含（左边被右边包含）
SELECT * FROM products WHERE '{"brand": "Apple", "price": 7999}' @> attrs;

-- ? 键是否存在
SELECT * FROM products WHERE attrs ? 'brand';

-- ?| 任一键存在
SELECT * FROM products WHERE attrs ?| array['brand', 'weight'];

-- ?& 所有键都存在
SELECT * FROM products WHERE attrs ?& array['brand', 'price'];
```

## 4. 修改操作符

```sql
-- || 合并（新增或覆盖字段）
UPDATE products SET attrs = attrs || '{"weight": "187g"}' WHERE name = 'iPhone 15';

-- - 删除键
UPDATE products SET attrs = attrs - 'weight' WHERE name = 'iPhone 15';

-- #- 按路径删除
UPDATE products SET attrs = attrs #- '{specs, ram}' WHERE name = 'iPhone 15';

-- jsonb_set 设置嵌套字段的值
UPDATE products SET attrs = jsonb_set(attrs, '{specs, storage}', '"256GB"') WHERE name = 'iPhone 15';
```

# 三、JSONB 索引

## 5. GIN 索引

```sql
-- 默认 GIN 索引（支持 @>、?、?|、?& 操作符）
CREATE INDEX idx_products_attrs ON products USING GIN (attrs);

-- 查询自动使用 GIN 索引
EXPLAIN SELECT * FROM products WHERE attrs @> '{"brand": "Apple"}';
-- Bitmap Index Scan on idx_products_attrs

-- jsonb_path_ops 操作符类（只支持 @>，但索引更小、更快）
CREATE INDEX idx_products_attrs_path ON products USING GIN (attrs jsonb_path_ops);
```

| GIN 操作符类 | 支持的操作符 | 索引大小 | 适用场景 |
|-------------|------------|---------|---------|
| 默认（jsonb_ops） | `@>`、`?`、`?|`、`?&` | 较大 | 需要键存在性查询 |
| jsonb_path_ops | 仅 `@>` | **更小** | 只需要包含查询 |

## 6. 表达式索引

```sql
-- 对 JSONB 中的特定字段建 B-tree 索引（适合等值和范围查询）
CREATE INDEX idx_products_brand ON products ((attrs ->> 'brand'));
CREATE INDEX idx_products_price ON products (((attrs ->> 'price')::numeric));

-- 查询时使用表达式索引
SELECT * FROM products WHERE attrs ->> 'brand' = 'Apple';
SELECT * FROM products WHERE (attrs ->> 'price')::numeric > 5000;
```

> **选择建议**：
> - 需要 `@>` 包含查询 → GIN 索引
> - 需要特定字段的等值/范围查询 → 表达式 B-tree 索引
> - 两者可以共存

# 四、JSONB 聚合与查询技巧

## 7. 展开数组

```sql
-- jsonb_array_elements 展开 JSONB 数组为多行
SELECT name, jsonb_array_elements_text(attrs -> 'colors') AS color
FROM products;
-- iPhone 15 | 黑色
-- iPhone 15 | 白色
-- iPhone 15 | 蓝色
-- Galaxy S24 | 黑色
-- Galaxy S24 | 紫色

-- 查询包含特定颜色的商品
SELECT DISTINCT name FROM products, 
    jsonb_array_elements_text(attrs -> 'colors') AS color
WHERE color = '黑色';
```

## 8. 聚合为 JSONB

```sql
-- jsonb_agg 将多行聚合为 JSONB 数组
SELECT jsonb_agg(name) FROM products;
-- ["iPhone 15", "Galaxy S24"]

-- jsonb_object_agg 将多行聚合为 JSONB 对象
SELECT jsonb_object_agg(name, attrs ->> 'price') FROM products;
-- {"iPhone 15": "7999", "Galaxy S24": "6999"}
```

## 9. jsonb_each 遍历键值对

```sql
-- 将 JSONB 对象展开为键值对
SELECT key, value FROM products, jsonb_each(attrs -> 'specs') 
WHERE name = 'iPhone 15';
-- cpu  | "A17"
-- ram  | "8GB"
```

# 五、实战场景

## 10. 场景1：商品 SKU 属性（半结构化）

```sql
-- 不同品类的商品有不同的属性，用 JSONB 存储灵活属性
CREATE TABLE sku (
    id BIGSERIAL PRIMARY KEY,
    product_name TEXT NOT NULL,
    category TEXT NOT NULL,
    attrs JSONB NOT NULL DEFAULT '{}'
);

-- 手机：有 CPU、内存、存储
INSERT INTO sku (product_name, category, attrs) VALUES 
('iPhone 15', '手机', '{"cpu": "A17", "ram": "8GB", "storage": "256GB"}');

-- 服装：有尺码、颜色、材质
INSERT INTO sku (product_name, category, attrs) VALUES 
('T恤', '服装', '{"size": "XL", "color": "黑色", "material": "纯棉"}');

-- 建 GIN 索引，支持灵活查询
CREATE INDEX idx_sku_attrs ON sku USING GIN (attrs);

-- 查询所有 8GB 内存的手机
SELECT * FROM sku WHERE category = '手机' AND attrs @> '{"ram": "8GB"}';
```

## 11. 场景2：用户配置（键值对存储）

```sql
CREATE TABLE user_settings (
    user_id BIGINT PRIMARY KEY,
    settings JSONB NOT NULL DEFAULT '{}'
);

-- 更新单个配置项（不影响其他配置）
UPDATE user_settings 
SET settings = settings || '{"theme": "dark", "language": "zh-CN"}'
WHERE user_id = 1;

-- 读取单个配置项
SELECT settings ->> 'theme' FROM user_settings WHERE user_id = 1;
```

## 12. 场景3：日志元数据

```sql
CREATE TABLE audit_logs (
    id BIGSERIAL PRIMARY KEY,
    action TEXT NOT NULL,
    metadata JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 不同类型的操作有不同的元数据
INSERT INTO audit_logs (action, metadata) VALUES 
('login', '{"ip": "192.168.1.1", "device": "Chrome/Windows"}'),
('order_create', '{"order_id": 12345, "amount": 99.9, "items": ["SKU001", "SKU002"]}');

-- 按元数据查询
SELECT * FROM audit_logs WHERE metadata @> '{"ip": "192.168.1.1"}';
```

# 六、JSONB vs 关系表：如何选择？

| 考虑因素 | 用 JSONB | 用关系表 |
|---------|---------|---------|
| 数据结构 | 半结构化、字段不固定 | 结构固定、字段明确 |
| 查询模式 | 按键值对查询 | 复杂 JOIN、聚合 |
| 数据完整性 | 不需要严格约束 | 需要外键、NOT NULL 等约束 |
| 性能要求 | GIN 索引满足需求 | 需要精确的 B-tree 索引 |
| 典型场景 | 商品属性、用户配置、日志元数据 | 订单、用户、账户等核心业务表 |

> **最佳实践**：核心业务数据用关系表，灵活扩展属性用 JSONB。两者可以在同一张表中共存。

# 七、常见问题

**Q：PG 的 JSONB 和 MySQL 的 JSON 有什么区别？**

> PG 的 JSONB 是二进制存储，支持 GIN 索引，查询性能远优于 MySQL 的文本存储 JSON。PG 的 JSONB 操作符更丰富（`@>`、`?`、`||`、`-` 等），MySQL 主要通过函数操作 JSON（`JSON_EXTRACT`、`JSON_SET` 等）。

**Q：什么时候用 GIN 索引，什么时候用表达式索引？**

> GIN 索引适合 `@>` 包含查询（如"查询所有包含某个属性的记录"）；表达式 B-tree 索引适合特定字段的等值/范围查询（如"查询价格大于 5000 的商品"）。如果两种查询都有，可以同时建两种索引。

**Q：JSONB 字段能加约束吗？**

> 可以使用 CHECK 约束验证 JSONB 的结构：
> ```sql
> ALTER TABLE products ADD CONSTRAINT check_attrs 
> CHECK (attrs ? 'brand' AND attrs ? 'price');
> ```
> 但无法像关系表那样定义外键。如果需要严格的数据完整性，核心字段应该用关系列。

**Q：JSONB 的 `->` 和 `->>` 有什么区别？**

> `->` 返回 JSONB 类型（带引号），适合继续链式操作；`->>` 返回 TEXT 类型（不带引号），适合最终取值或与字符串比较。WHERE 条件中通常用 `->>` 或 `@>`。
