---
doc_id: pg-extension-system
title: 扩展机制与 LISTEN/NOTIFY
---

# 扩展机制与 LISTEN/NOTIFY

> **核心问题**：PostgreSQL 的扩展系统如何工作？常用扩展有哪些？LISTEN/NOTIFY 怎么用？

## 1. 扩展管理

```sql
-- 安装扩展
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- 查看已安装
SELECT * FROM pg_extension;

-- 查看可用扩展
SELECT * FROM pg_available_extensions ORDER BY name;

-- 卸载
DROP EXTENSION IF EXISTS "uuid-ossp";

-- 扩展升级
ALTER EXTENSION pg_stat_statements UPDATE;
```

## 2. 常用扩展

| 扩展 | 说明 | 用途 |
|------|------|------|
| uuid-ossp | UUID 生成 | 生成全局唯一 ID |
| pg_trgm | 模糊搜索 | 支持 LIKE 走索引 |
| btree_gist | GiST 索引支持 | 范围类型索引 |
| hstore | 键值对 | 简单 KV 存储 |
| pg_stat_statements | 查询统计 | 慢查询分析 |
| pgvector | 向量搜索 | AI/ML 向量检索 |
| pg_cron | 定时任务 | 数据库内部调度 |
| pg_partman | 分区管理 | 自动分区维护 |

## 3. pg_stat_statements

```sql
-- 安装（需要在 postgresql.conf 中配置 shared_preload_libraries）
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

-- 查看最慢的 SQL
SELECT
    calls,
    ROUND(mean_exec_time::numeric, 2) AS avg_ms,
    LEFT(query, 100) AS query
FROM pg_stat_statements
ORDER BY mean_exec_time DESC
LIMIT 10;

-- 重置统计
SELECT pg_stat_statements_reset();
```

## 4. pg_trgm（模糊搜索）

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- 创建 GIN 索引支持 LIKE 查询
CREATE INDEX idx_name_trgm ON users USING GIN (name gin_trgm_ops);

-- 模糊查询（走索引）
SELECT * FROM users WHERE name LIKE '%张三%';

-- 相似度搜索
SELECT name, similarity(name, '张三丰') AS score
FROM users
WHERE name % '张三丰'
ORDER BY score DESC;
```

## 5. pg_cron（定时任务）

```sql
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- 每天凌晨 2 点执行 VACUUM
SELECT cron.schedule('nightly-vacuum', '0 2 * * *', 'VACUUM ANALYZE');

-- 每小时刷新物化视图
SELECT cron.schedule('refresh-mv', '0 * * * *',
    'REFRESH MATERIALIZED VIEW CONCURRENTLY monthly_sales');

-- 查看定时任务
SELECT * FROM cron.job;

-- 删除定时任务
SELECT cron.unschedule('nightly-vacuum');
```

## 6. LISTEN/NOTIFY

```sql
-- 监听端
LISTEN my_channel;

-- 通知端
NOTIFY my_channel, 'Hello World';

-- 带 payload 的通知
NOTIFY order_channel, '{"order_id": 12345, "status": "shipped"}';
```

### 6.1 触发器 + NOTIFY 实现实时通知

```sql
CREATE OR REPLACE FUNCTION notify_order_change()
RETURNS TRIGGER AS $$
BEGIN
    PERFORM pg_notify('order_changes', json_build_object(
        'operation', TG_OP,
        'order_id', NEW.id,
        'status', NEW.status
    )::text);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_order_notify
    AFTER INSERT OR UPDATE ON orders
    FOR EACH ROW
    EXECUTE FUNCTION notify_order_change();
```

### 6.2 LISTEN/NOTIFY 的限制

| 限制 | 说明 | 替代方案 |
|------|------|----------|
| 会话级 | 连接断开后失效 | 使用消息队列（RabbitMQ/Kafka） |
| 不持久化 | 如果没有监听者，通知丢失 | 使用消息队列 |
| 8000 字节限制 | payload 最大 8000 字节 | 只发送通知，不发送数据 |

> **适用场景**：LISTEN/NOTIFY 适合简单的实时通知（缓存失效、UI 更新），不适合可靠的消息传递。
