---
doc_id: pg-when-to-use-plpgsql
title: 何时使用存储过程
---

# 何时使用存储过程

> **核心问题**：什么时候该用存储过程？什么时候该在应用层处理？

## 1. 决策矩阵

| 场景 | 推荐方案 | 原因 |
| :-- | :-- | :-- |
| 复杂的数据校验 | BEFORE 触发器 | 数据库层保证数据完整性 |
| 审计日志 | AFTER 触发器 | 与业务逻辑解耦，不会遗漏 |
| 批量数据处理 | 存储过程 | 减少网络往返，可使用事务控制 |
| 简单 CRUD | 应用层代码 | 更易调试、版本控制、测试 |
| 复杂业务逻辑 | 应用层代码 | 更好的工具链、可测试性 |
| 数据库迁移 | 存储过程 | 保证数据一致性 |
| 定时维护任务 | pg_cron + 函数 | 数据库内部调度，无需外部依赖 |
| 实时通知 | 触发器 + NOTIFY | 低延迟，与写操作同步 |

## 2. 适合使用存储过程的场景

### 2.1 批量数据处理

```sql
-- 分批处理大量数据，支持中间 COMMIT
CREATE OR REPLACE PROCEDURE batch_archive()
LANGUAGE plpgsql AS $$
DECLARE
    batch_size INT := 5000;
    deleted INT;
BEGIN
    LOOP
        WITH batch AS (
            SELECT id FROM logs WHERE created_at < NOW() - INTERVAL '1 year'
            LIMIT batch_size
        )
        DELETE FROM logs WHERE id IN (SELECT id FROM batch);
        
        GET DIAGNOSTICS deleted = ROW_COUNT;
        COMMIT;  -- 每批提交，避免长事务
        
        EXIT WHEN deleted = 0;
        PERFORM pg_sleep(0.1);  -- 暂停，减轻 IO 压力
    END LOOP;
END;
$$;
```

### 2.2 复杂的数据完整性约束

```sql
-- 跨表的数据校验（CHECK 约束无法做到）
CREATE OR REPLACE FUNCTION check_order_inventory()
RETURNS TRIGGER AS $$
BEGIN
    IF (SELECT stock FROM products WHERE id = NEW.product_id) < NEW.quantity THEN
        RAISE EXCEPTION '库存不足：产品 % 库存 %，需要 %',
            NEW.product_id,
            (SELECT stock FROM products WHERE id = NEW.product_id),
            NEW.quantity;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```

### 2.3 数据库内部定时任务

```sql
-- 使用 pg_cron 定时执行维护函数
CREATE EXTENSION IF NOT EXISTS pg_cron;

SELECT cron.schedule('nightly-vacuum', '0 2 * * *', 'VACUUM ANALYZE');
SELECT cron.schedule('refresh-mv', '0 * * * *',
    'REFRESH MATERIALIZED VIEW CONCURRENTLY monthly_sales');
```

## 3. 不适合使用存储过程的场景

### 3.1 复杂业务逻辑

```
❌ 在存储过程中实现订单状态机、支付流程、业务规则引擎
✅ 在应用层实现，使用 ORM + 单元测试保证质量
```

原因：
- 存储过程难以调试和单测
- 版本控制困难（虽然可以用 Flyway/Liquibase 管理）
- 团队中不是所有开发者都熟悉 PL/pgSQL
- 难以做代码审查

### 3.2 简单的 CRUD 操作

```
❌ 为每个表写 INSERT/UPDATE/DELETE 存储过程
✅ 使用 ORM（JPA/MyBatis）直接操作
```

## 4. 触发器 vs 应用层回调

| 考虑因素 | 触发器 | 应用层回调 |
| :-- | :-- | :-- |
| 可靠性 | ✅ 数据库层保证，不会遗漏 | ❌ 可能因代码 bug 遗漏 |
| 可测试性 | ❌ 难以单测 | ✅ 容易单测 |
| 性能影响 | ⚠️ 每次写操作都有开销 | ⚠️ 额外的网络调用 |
| 调试难度 | ❌ 难以调试 | ✅ 容易调试 |
| 团队熟悉度 | ⚠️ 需要 PL/pgSQL 技能 | ✅ 通用技能 |

## 5. 最佳实践

1. **保持简单**：触发器只做简单的数据验证和自动填充，复杂逻辑放应用层
2. **避免嵌套触发器**：触发器 A 修改表 B，触发 B 的触发器修改表 C...容易产生难以追踪的问题
3. **文档化**：在表结构文档中注明所有触发器及其作用
4. **性能测试**：在高频写入的表上使用触发器前，先做性能测试
5. **使用存储过程处理批量操作**：利用 `COMMIT` 避免长事务
