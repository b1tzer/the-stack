---
doc_id: pg-concurrency-patterns
title: 并发控制实践
---

# 并发控制实践

> **核心问题**：如何处理热点行？如何实现乐观锁？如何防止重复下单？

## 1. 热点行处理

```sql
-- 使用 SELECT FOR UPDATE
BEGIN;
SELECT balance FROM accounts WHERE id = 1 FOR UPDATE;
UPDATE accounts SET balance = balance - 100 WHERE id = 1;
COMMIT;
```

## 2. 乐观锁

```sql
-- 使用版本号
CREATE TABLE products (
    id SERIAL PRIMARY KEY,
    name TEXT,
    stock INT DEFAULT 100,
    version INT DEFAULT 0
);

-- 扣减库存（乐观锁）
UPDATE products
SET stock = stock - 1, version = version + 1
WHERE id = 1 AND stock > 0 AND version = 5;

-- 检查影响行数，0 表示冲突需要重试
```

## 3. 防止重复下单

```sql
-- 方案1：唯一约束（最简单）
CREATE TABLE orders (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL,
    product_id BIGINT NOT NULL,
    idempotency_key VARCHAR(64) UNIQUE,  -- 幂等键
    amount DECIMAL(10,2),
    created_at TIMESTAMP DEFAULT NOW()
);

INSERT INTO orders (user_id, product_id, idempotency_key, amount)
VALUES (1, 100, 'order-20240615-001', 99.9)
ON CONFLICT (idempotency_key) DO NOTHING;

-- 方案2：咨询锁
BEGIN;
SELECT pg_advisory_xact_lock(user_id);  -- 用户级别互斥
INSERT INTO orders (user_id, product_id, amount) VALUES (1, 100, 99.9);
COMMIT;
```

## 4. 批量更新

```sql
-- 使用 CTE 批量更新
WITH batch AS (
    SELECT id FROM orders WHERE status = 'pending' LIMIT 1000
)
UPDATE orders SET status = 'processing' 
WHERE id IN (SELECT id FROM batch);
```

## 5. 分布式 ID 生成

```sql
-- 方案1：序列（Sequence）
CREATE SEQUENCE order_id_seq;
SELECT nextval('order_id_seq');

-- 方案2：UUID
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
INSERT INTO orders (id, user_id) VALUES (uuid_generate_v4(), 1);
```

## 6. 并发安全的计数器

```sql
-- ✅ UPDATE 本身是原子操作，不会丢失更新
UPDATE counters SET value = value + 1 WHERE name = 'page_views'
RETURNING value;

-- ✅ 高并发场景：使用 CTE 批量计数
WITH new_counts AS (
    SELECT name, count(*) AS cnt
    FROM page_view_logs
    WHERE created_at > (SELECT MAX(last_processed) FROM counter_sync)
    GROUP BY name
)
UPDATE counters c
SET value = c.value + nc.cnt
FROM new_counts nc
WHERE c.name = nc.name;
```

## 7. 读写分离

```sql
-- 查看复制延迟
SELECT
    client_addr,
    state,
    sent_lsn,
    replay_lsn,
    pg_wal_lsn_diff(sent_lsn, replay_lsn) AS lag_bytes
FROM pg_stat_replication;
```

应用层配置（Spring Boot）：
```yaml
spring:
  datasource:
    write:
      url: jdbc:postgresql://master:5432/mydb
    read:
      url: jdbc:postgresql://slave:5432/mydb
```
