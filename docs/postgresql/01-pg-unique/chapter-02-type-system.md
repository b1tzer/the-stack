---
doc_id: pg-type-system
title: PG 独有类型系统
---

# PG 独有类型系统

> **核心问题**：PostgreSQL 有哪些独有的数据类型？为什么说 PG 的类型系统是开源数据库里最丰富的？

## 1. 为什么 PG 的类型系统特殊？

大多数数据库只支持标准 SQL 类型（整数、字符串、日期、布尔）。PG 在此基础上提供了一整套**可扩展的类型体系**：

- **数组类型**：任何类型都能变成数组，不需要额外建表
- **范围类型**：表达时间区间、价格区间，支持"重叠""包含"等运算
- **枚举类型**：约束字段值只能是预定义集合
- **复合类型**：把多个字段打包成一个结构体，类似 Java 的 POJO
- **网络地址类型**：`INET`、`CIDR`，内置子网运算
- **UUID 类型**：128 位全局唯一标识符，原生支持

这些类型不只是"能存"，更重要的是**能建索引、能高效查询**。比如数组用 GIN 索引，范围类型用 GiST 索引，查询性能和普通字段一样好。

## 2. 数组类型

PG 的数组类型让你在一行里存多个值，不需要建关联表。这在处理标签、权限列表、多值属性时非常方便。

**与 MySQL 的区别**：MySQL 没有原生数组类型，通常用 JSON 数组或关联表实现。PG 的数组是一等公民，支持索引和丰富的数组操作符。

```sql
CREATE TABLE articles (
    id SERIAL PRIMARY KEY,
    title TEXT,
    tags TEXT[]  -- 字符串数组
);

-- 插入数组
INSERT INTO articles (title, tags) VALUES
    ('PostgreSQL 入门', ARRAY['database', 'postgresql', 'sql']),
    ('Java 并发编程', ARRAY['java', 'concurrency']);
```

### 数组操作符

| 操作符 | 含义 | 示例 |
| :-- | :-- | :-- |
| `@>` | 包含（左包含右） | `tags @> ARRAY['pg']` — tags 里包含 'pg' |
| `<@` | 被包含 | `ARRAY['pg'] <@ tags` |
| `&&` | 有交集 | `tags && ARRAY['java', 'pg']` — 有任一匹配 |
| `= ANY` | 等于数组中任一元素 | `'pg' = ANY(tags)` |

```sql
-- 包含查询（最常用）
SELECT * FROM articles WHERE tags @> ARRAY['postgresql'];

-- 交集查询
SELECT * FROM articles WHERE tags && ARRAY['java', 'python'];

-- 等值匹配
SELECT * FROM articles WHERE 'postgresql' = ANY(tags);

-- 数组函数
SELECT array_append(tags, 'new_tag') FROM articles WHERE id = 1;  -- 追加
SELECT array_remove(tags, 'sql') FROM articles WHERE id = 1;       -- 移除
SELECT array_length(tags, 1) FROM articles;                         -- 长度
SELECT unnest(tags) AS tag FROM articles WHERE id = 1;              -- 展开为行
```

### 数组索引

数组字段必须用 **GIN 索引**才能高效查询，否则会全表扫描：

```sql
CREATE INDEX idx_articles_tags ON articles USING GIN (tags);
```

> **适用场景**：标签系统、权限列表、多值属性。如果数组元素很多且需要频繁增删，考虑改用关联表（更灵活，但查询多一张 JOIN）。

## 3. 范围类型

范围类型表达一个**连续的区间**，内置了"包含""重叠""相邻"等运算。这比用两个字段（start_time, end_time）+ 手写比较条件优雅得多。

**内置范围类型**：

| 类型 | 含义 | 示例 |
| :-- | :-- | :-- |
| `int4range` | 整数范围 | `[1, 10)` |
| `int8range` | 大整数范围 | `[1, 1000000]` |
| `numrange` | 精确小数范围 | `[9.99, 29.99]` |
| `tsrange` | 时间戳范围（无时区） | `[2024-01-01, 2024-12-31)` |
| `tstzrange` | 时间戳范围（有时区） | — |
| `daterange` | 日期范围 | `[2024-01-01, 2024-12-31]` |

```sql
CREATE TABLE events (
    id SERIAL PRIMARY KEY,
    name TEXT,
    duration tsrange  -- 时间范围
);

INSERT INTO events (name, duration) VALUES
    ('团队周会', '[2024-06-15 09:00, 2024-06-15 10:30)'),
    ('产品评审', '[2024-06-15 14:00, 2024-06-15 16:00)');
```

### 范围操作符

| 操作符 | 含义 | 示例 |
| :-- | :-- | :-- |
| `@>` | 包含时间点 | `duration @> '2024-06-15 09:30'::timestamp` |
| `<@` | 被包含 | — |
| `&&` | 有重叠 | `duration && '[09:00, 11:00)'` — 有时间段冲突 |
| `-|-` | 相邻 | — |

```sql
-- 查询某个时间点正在进行的事件
SELECT * FROM events WHERE duration @> '2024-06-15 09:30'::timestamp;

-- 查询与某时间段有冲突的事件（排期检查）
SELECT * FROM events 
WHERE duration && '[2024-06-15 09:00, 2024-06-15 11:00)'::tsrange;

-- 范围索引（必须用 GiST）
CREATE INDEX idx_events_duration ON events USING GIST (duration);
```

> **适用场景**：会议室预定、酒店入住、优惠券有效期、价格区间。任何"从 A 到 B"的语义都可以用范围类型表达。

## 4. 枚举类型

枚举类型约束字段值只能是预定义的集合，类似 Java 的 `enum`。适合状态机、分类等**值域固定**的场景。

```sql
CREATE TYPE order_status AS ENUM (
    'pending', 'processing', 'shipped', 'delivered', 'cancelled'
);

CREATE TABLE orders (
    id SERIAL PRIMARY KEY,
    status order_status DEFAULT 'pending'
);
```

### 枚举的优缺点

| 优点 | 缺点 |
| :-- | :-- |
| 值域约束，写入非法值自动报错 | 修改枚举值需要 ALTER TYPE（有锁） |
| 存储效率高（内部是整数） | 删除枚举值不支持 |
| 排序按定义顺序 | 不如 CHECK 灵活 |

```sql
-- 添加枚举值（PG 10+）
ALTER TYPE order_status ADD VALUE 'returned' AFTER 'delivered';

-- 查询（按定义顺序排序）
SELECT * FROM orders ORDER BY status;
```

> **什么时候用枚举 vs CHECK 约束**：如果值域很少且基本不变（如订单状态），用枚举；如果值域可能频繁变化（如商品分类），用 CHECK 约束或关联表更灵活。

## 5. 复合类型

复合类型把多个字段打包成一个结构体，类似 Java 的 POJO / Record。适合表达地址、坐标、金额+币种等**固定结构的值对象**。

```sql
-- 创建复合类型
CREATE TYPE address AS (
    street TEXT,
    city TEXT,
    zip_code VARCHAR(10)
);

-- 使用复合类型作为列类型
CREATE TABLE customers (
    id SERIAL PRIMARY KEY,
    name TEXT,
    home_address address,
    work_address address
);

-- 插入（用 ROW 构造）
INSERT INTO customers (name, home_address)
VALUES ('张三', ROW('中关村大街1号', '北京', '100080'));

-- 访问复合类型字段（用 . 语法）
SELECT name, (home_address).city FROM customers;
```

> **与 JSONB 的选择**：复合类型结构固定，有类型检查，性能更好；JSONB 结构灵活，不需要预定义。如果字段结构确定且不会变，用复合类型；如果需要灵活性，用 JSONB。

## 6. 网络地址类型

PG 原生支持 `INET`（IP 地址）和 `CIDR`（网段），内置子网运算。做日志分析、权限控制、网络管理时非常方便。

```sql
CREATE TABLE access_logs (
    id SERIAL PRIMARY KEY,
    ip INET,
    created_at TIMESTAMP DEFAULT NOW()
);

INSERT INTO access_logs (ip) VALUES 
    ('192.168.1.100'),
    ('10.0.0.1');

-- 子网查询（不需要字符串函数）
SELECT * FROM access_logs WHERE ip <<= '192.168.1.0/24';  -- IP 在子网内
SELECT * FROM access_logs WHERE ip >>= '10.0.0.0/8';     -- IP 包含子网

-- 网络函数
SELECT host(ip),             -- 提取 IP 字符串
       network(ip),          -- 提取网络地址
       inet '192.168.1.100' - inet '192.168.1.1'  -- IP 差值
FROM access_logs;
```

> **与字符串存 IP 的区别**：用 `INET` 类型可以做正确的网络运算（子网匹配、IP 排序），字符串存 IP 做不了这些，排序也是字典序而非数值序。

## 7. UUID 类型

UUID 是 128 位全局唯一标识符，常用于分布式系统的主键，避免自增 ID 的冲突和可预测性问题。

```sql
-- PG 13+ 内置 gen_random_uuid()
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT
);

INSERT INTO users (name) VALUES ('张三') RETURNING id;
-- 返回类似: a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11
```

### UUID vs 自增 ID

| 对比项 | UUID | BIGSERIAL |
| :-- | :-- | :-- |
| 全局唯一 | ✅ 天然唯一 | ❌ 需要协调 |
| 分布式友好 | ✅ 各节点独立生成 | ❌ 需要中心化 |
| 可预测性 | 不可预测 | 可预测（安全隐患） |
| 索引性能 | 较差（随机写入） | 更好（顺序写入） |
| 存储大小 | 16 字节 | 8 字节 |
| 可读性 | 差 | 好 |

> **选型建议**：单体系统用 `BIGSERIAL`（性能好、可读）；分布式系统或需要隐藏业务量的场景用 UUID。如果用 UUID 做主键，建议配合 `uuid_generate_v7()`（PG 17+，时间有序 UUID）避免随机写入导致的 B-tree 索引页分裂。

## 8. 类型选择速查

| 场景 | 推荐类型 | 说明 |
| :-- | :-- | :-- |
| 金额 | `NUMERIC(p,s)` | 精确计算，无浮点误差 |
| 自增主键 | `BIGSERIAL` / `BIGINT` | 比 INTEGER 范围大（推荐 BIGINT） |
| 分布式主键 | `UUID` | 全局唯一，不需要协调 |
| 布尔值 | `BOOLEAN` | 存储效率高 |
| IP 地址 | `INET` | 支持网络运算和子网查询 |
| JSON 数据 | `JSONB` | 二进制存储，支持 GIN 索引 |
| 时间戳 | `TIMESTAMPTZ` | 带时区，避免时区陷阱 |
| 大文本 | `TEXT` | 无长度限制，性能与 VARCHAR 相同 |
| 标签/多值 | `TEXT[]` + GIN 索引 | 数组类型，查询效率高 |
| 时间区间 | `tsrange` / `daterange` | 范围类型，支持重叠/包含查询 |
| 状态机 | `ENUM` | 值域固定、排序可控 |
| 值对象 | 复合类型 / `JSONB` | 固定结构用复合类型，灵活结构用 JSONB |

## 9. 常见问题

**Q：JSONB 和数组怎么选？**

> 数组适合存同质的简单值列表（如标签 `TEXT[]`），查询用 `@>` 和 GIN 索引。JSONB 适合存结构化的键值对（如商品属性 `{"color":"red","size":"L"}`），查询用 `->`、`@>` 和 GIN 索引。如果需要存不同结构的嵌套数据，用 JSONB。

**Q：TIMESTAMP 和 TIMESTAMPTZ 怎么选？**

> **一律用 `TIMESTAMPTZ`**。它在存储时转为 UTC，读取时按会话时区显示，不会有歧义。`TIMESTAMP` 不带时区，容易在跨时区场景出 bug。

**Q：VARCHAR(n) 和 TEXT 怎么选？**

> 在 PG 里，`TEXT` 和 `VARCHAR(n)` 的存储和性能完全相同。`VARCHAR(n)` 的唯一价值是约束长度。建议**默认用 `TEXT`**，只在需要长度校验时用 `VARCHAR(n)`。
