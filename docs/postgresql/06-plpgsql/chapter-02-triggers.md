---
doc_id: pg-triggers
title: 触发器
---

# 触发器

> **核心问题**：如何使用触发器？BEFORE/AFTER 触发器有什么区别？如何实现审计日志？

## 1. 基本触发器

```sql
-- 自动更新 updated_at 字段
CREATE OR REPLACE FUNCTION update_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_update_timestamp
    BEFORE UPDATE ON users
    FOR EACH ROW
    EXECUTE FUNCTION update_timestamp();
```

## 2. 审计日志触发器

```sql
CREATE OR REPLACE FUNCTION audit_trigger_func()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        INSERT INTO audit_log (table_name, operation, new_data, changed_at)
        VALUES (TG_TABLE_NAME, 'INSERT', to_jsonb(NEW), NOW());
        RETURN NEW;
    ELSIF TG_OP = 'UPDATE' THEN
        INSERT INTO audit_log (table_name, operation, old_data, new_data, changed_at)
        VALUES (TG_TABLE_NAME, 'UPDATE', to_jsonb(OLD), to_jsonb(NEW), NOW());
        RETURN NEW;
    ELSIF TG_OP = 'DELETE' THEN
        INSERT INTO audit_log (table_name, operation, old_data, changed_at)
        VALUES (TG_TABLE_NAME, 'DELETE', to_jsonb(OLD), NOW());
        RETURN OLD;
    END IF;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_audit
    AFTER INSERT OR UPDATE OR DELETE ON users
    FOR EACH ROW
    EXECUTE FUNCTION audit_trigger_func();
```

## 3. 条件触发器

```sql
-- 只在特定列变化时触发
CREATE OR REPLACE FUNCTION notify_price_change()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.price IS DISTINCT FROM NEW.price THEN
        PERFORM pg_notify('price_change',
            json_build_object('id', NEW.id, 'old_price', OLD.price, 'new_price', NEW.price)::text);
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```

## 4. 触发器 + NOTIFY 实现实时通知

```sql
-- 当订单状态变化时通知应用
CREATE OR REPLACE FUNCTION notify_order_change()
RETURNS TRIGGER AS $$
BEGIN
    PERFORM pg_notify('order_changes', json_build_object(
        'operation', TG_OP,
        'order_id', NEW.id,
        'status', NEW.status,
        'user_id', NEW.user_id
    )::text);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_order_notify
    AFTER INSERT OR UPDATE ON orders
    FOR EACH ROW
    EXECUTE FUNCTION notify_order_change();
```

## 5. 触发器变量

| 变量 | 说明 |
| :-- | :-- |
| `NEW` | INSERT/UPDATE 时的新行数据 |
| `OLD` | UPDATE/DELETE 时的旧行数据 |
| `TG_OP` | 操作类型：'INSERT'、'UPDATE'、'DELETE' |
| `TG_TABLE_NAME` | 触发器所在的表名 |
| `TG_WHEN` | 'BEFORE'、'AFTER'、'INSTEAD OF' |

## 6. BEFORE vs AFTER 触发器

| 类型 | 时机 | 可修改 NEW | 典型用途 |
| :-- | :-- | :-- | :-- |
| BEFORE | 在操作执行前 | ✅ 可以 | 数据验证、自动填充字段 |
| AFTER | 在操作执行后 | ❌ 不可以 | 审计日志、通知、级联操作 |

## 7. 注意事项

- 触发器中的异常会回滚整个事务
- 触发器执行有性能开销，避免在高频表上使用过多触发器
- 触发器的执行顺序：BEFORE → 行操作 → AFTER
- 同一表上多个同类型触发器按字母顺序执行
