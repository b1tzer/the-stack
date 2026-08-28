---
doc_id: pg-type-system
title: PG 独有类型系统
---

# PG 独有类型系统

> **核心问题**：PostgreSQL 有哪些独有的数据类型？数组、范围、枚举、复合类型如何使用？

## 1. 数组类型

```sql
-- 数组操作
CREATE TABLE articles (
    id SERIAL PRIMARY KEY,
    title TEXT,
    tags TEXT[]
);

-- 插入数组
INSERT INTO articles (title, tags) VALUES
    ('PostgreSQL 入门', ARRAY['database', 'postgresql', 'sql']),
    ('Java 并发编程', ARRAY['java', 'concurrency']);

-- 数组查询
SELECT * FROM articles WHERE 'postgresql' = ANY(tags);
SELECT * FROM articles WHERE tags @> ARRAY['postgresql'];
SELECT * FROM articles WHERE tags && ARRAY['java', 'python'];

-- 数组函数
SELECT array_append(tags, 'new_tag') FROM articles WHERE id = 1;
SELECT array_remove(tags, 'sql') FROM articles WHERE id = 1;
SELECT array_length(tags, 1) FROM articles;
SELECT unnest(tags) AS tag FROM articles WHERE id = 1;

-- 数组索引
CREATE INDEX idx_articles_tags ON articles USING GIN (tags);
```

## 2. 范围类型

```sql
-- 内置范围类型
SELECT '[2024-01-01, 2024-12-31]'::daterange;
SELECT '[1, 10)'::int4range;

-- 范围查询
CREATE TABLE events (
    id SERIAL PRIMARY KEY,
    name TEXT,
    duration tsrange
);

INSERT INTO events (name, duration) VALUES
    ('会议', '[2024-06-15 09:00, 2024-06-15 10:30)');

-- 查询时间点所在的事件
SELECT * FROM events WHERE duration @> '2024-06-15 09:30'::timestamp;

-- 查询时间范围重叠的事件
SELECT * FROM events WHERE duration && '[2024-06-15 09:00, 2024-06-15 11:00)';

-- 范围索引
CREATE INDEX idx_events_duration ON events USING GIST (duration);
```

## 3. 枚举类型

```sql
-- 创建枚举类型
CREATE TYPE order_status AS ENUM ('pending', 'processing', 'shipped', 'delivered', 'cancelled');

-- 使用枚举
CREATE TABLE orders (
    id SERIAL PRIMARY KEY,
    status order_status DEFAULT 'pending'
);

INSERT INTO orders (status) VALUES ('pending');
UPDATE orders SET status = 'shipped' WHERE id = 1;

-- 查询枚举
SELECT * FROM orders WHERE status = 'pending';

-- 添加枚举值
ALTER TYPE order_status ADD VALUE 'returned' AFTER 'delivered';
```

## 4. 复合类型

```sql
-- 创建复合类型
CREATE TYPE address AS (
    street TEXT,
    city TEXT,
    zip_code VARCHAR(10)
);

-- 使用复合类型
CREATE TABLE customers (
    id SERIAL PRIMARY KEY,
    name TEXT,
    home_address address,
    work_address address
);

-- 插入复合类型数据
INSERT INTO customers (name, home_address)
VALUES ('张三', ROW('中关村大街1号', '北京', '100080'));

-- 访问复合类型字段
SELECT name, (home_address).city FROM customers;
```

## 5. 网络地址类型

```sql
-- INET：IP 地址
CREATE TABLE access_logs (
    id SERIAL PRIMARY KEY,
    ip INET,
    created_at TIMESTAMP DEFAULT NOW()
);

INSERT INTO access_logs (ip) VALUES ('192.168.1.100');
INSERT INTO access_logs (ip) VALUES ('10.0.0.1/24');

-- 网络查询
SELECT * FROM access_logs WHERE ip <<= '192.168.1.0/24';  -- 在子网内
SELECT * FROM access_logs WHERE ip >> '192.168.1.0/24';   -- 包含子网
```

## 6. UUID 类型

```sql
-- 安装 UUID 扩展
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 生成 UUID
SELECT uuid_generate_v4();        -- 随机 UUID
SELECT gen_random_uuid();          -- PG 13+ 内置

-- 使用 UUID 作为主键
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT
);

INSERT INTO users (name) VALUES ('张三') RETURNING id;
```

## 7. 类型选择建议

| 场景 | 推荐类型 | 说明 |
|------|----------|------|
| 金额 | `NUMERIC(p,s)` | 精确计算，无浮点误差 |
| 自增主键 | `BIGSERIAL` / `BIGINT` | 比 INTEGER 范围大 |
| 布尔值 | `BOOLEAN` | 存储效率高 |
| IP 地址 | `INET` | 支持网络运算 |
| UUID | `UUID` | 128 位，全局唯一 |
| JSON 数据 | `JSONB` | 二进制存储，支持索引 |
| 时间戳 | `TIMESTAMPTZ` | 带时区，避免时区问题 |
| 大文本 | `TEXT` | 无长度限制，性能与 VARCHAR 相同 |
