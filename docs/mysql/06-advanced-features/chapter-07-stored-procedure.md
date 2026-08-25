# 存储过程、触发器与事件调度器

> ⚠️ **使用建议**：MySQL 中存储过程和触发器应谨慎使用，复杂逻辑建议放在应用层。以下内容主要用于面试知识储备和特定场景参考。

## 1. 存储过程

### 1.1 基本语法

```sql
-- 创建存储过程
DELIMITER //
CREATE PROCEDURE sp_get_user_orders(
    IN p_user_id INT,
    IN p_limit INT,
    OUT p_total INT
)
BEGIN
    -- 获取总数
    SELECT COUNT(*) INTO p_total
    FROM orders
    WHERE user_id = p_user_id;
    
    -- 返回结果集
    SELECT id, amount, status, created_at
    FROM orders
    WHERE user_id = p_user_id
    ORDER BY created_at DESC
    LIMIT p_limit;
END //
DELIMITER ;

-- 调用
CALL sp_get_user_orders(1, 10, @total);
SELECT @total;
```

### 1.2 参数类型

```sql
-- IN: 输入参数（默认）
CREATE PROCEDURE sp_in_example(IN p_id INT)
BEGIN
    SELECT * FROM users WHERE id = p_id;
END;

-- OUT: 输出参数
CREATE PROCEDURE sp_out_example(OUT p_count INT)
BEGIN
    SELECT COUNT(*) INTO p_count FROM users;
END;

-- INOUT: 输入输出参数
CREATE PROCEDURE sp_inout_example(INOUT p_value INT)
BEGIN
    SET p_value = p_value * 2;
END;
```

### 1.3 变量与流程控制

```sql
DELIMITER //
CREATE PROCEDURE sp_order_stats(
    IN p_user_id INT,
    OUT p_result VARCHAR(500)
)
BEGIN
    -- 声明变量
    DECLARE v_total INT DEFAULT 0;
    DECLARE v_paid INT DEFAULT 0;
    DECLARE v_unpaid INT DEFAULT 0;
    
    -- 赋值
    SELECT COUNT(*) INTO v_total FROM orders WHERE user_id = p_user_id;
    SELECT COUNT(*) INTO v_paid FROM orders WHERE user_id = p_user_id AND status = 'paid';
    SET v_unpaid = v_total - v_paid;
    
    -- 条件判断
    IF v_total = 0 THEN
        SET p_result = '无订单';
    ELSEIF v_unpaid > 0 THEN
        SET p_result = CONCAT('有 ', v_unpaid, ' 个未支付订单');
    ELSE
        SET p_result = '所有订单已支付';
    END IF;
END //
DELIMITER ;
```

### 1.4 游标

```sql
DELIMITER //
CREATE PROCEDURE sp_process_orders()
BEGIN
    DECLARE v_id INT;
    DECLARE v_amount DECIMAL(10,2);
    DECLARE v_done INT DEFAULT 0;
    
    -- 声明游标
    DECLARE cur_orders CURSOR FOR
        SELECT id, amount FROM orders WHERE status = 'pending';
    
    -- 声明结束处理
    DECLARE CONTINUE HANDLER FOR NOT FOUND SET v_done = 1;
    
    OPEN cur_orders;
    
    read_loop: LOOP
        FETCH cur_orders INTO v_id, v_amount;
        IF v_done THEN
            LEAVE read_loop;
        END IF;
        
        -- 处理每条记录
        UPDATE orders SET status = 'processing' WHERE id = v_id;
    END LOOP;
    
    CLOSE cur_orders;
END //
DELIMITER ;
```

### 1.5 异常处理

```sql
DELIMITER //
CREATE PROCEDURE sp_transfer(
    IN p_from INT,
    IN p_to INT,
    IN p_amount DECIMAL(10,2)
)
BEGIN
    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        SELECT '转账失败' AS result;
    END;
    
    START TRANSACTION;
    
    UPDATE accounts SET balance = balance - p_amount WHERE id = p_from;
    UPDATE accounts SET balance = balance + p_amount WHERE id = p_to;
    
    COMMIT;
    SELECT '转账成功' AS result;
END //
DELIMITER ;
```

## 2. 触发器

### 2.1 基本语法

```sql
-- BEFORE INSERT 触发器
CREATE TRIGGER trg_before_insert_order
BEFORE INSERT ON orders
FOR EACH ROW
BEGIN
    -- 自动生成订单号
    IF NEW.order_no IS NULL OR NEW.order_no = '' THEN
        SET NEW.order_no = CONCAT('ORD', DATE_FORMAT(NOW(), '%Y%m%d'), LPAD(NEW.id, 6, '0'));
    END IF;
    
    -- 自动设置创建时间
    SET NEW.created_at = NOW();
END;

-- AFTER UPDATE 触发器
CREATE TRIGGER trg_after_update_order
AFTER UPDATE ON orders
FOR EACH ROW
BEGIN
    -- 记录状态变更日志
    IF OLD.status != NEW.status THEN
        INSERT INTO order_logs (order_id, old_status, new_status, created_at)
        VALUES (NEW.id, OLD.status, NEW.status, NOW());
    END IF;
END;
```

### 2.2 触发器类型

```sql
-- BEFORE INSERT: 插入前
-- BEFORE UPDATE: 更新前
-- BEFORE DELETE: 删除前
-- AFTER INSERT: 插入后
-- AFTER UPDATE: 更新后
-- AFTER DELETE: 删除后

-- 查看触发器
SHOW TRIGGERS;
SELECT * FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = 'your_db';
```

### 2.3 实际场景

```sql
-- 场景1: 库存同步
CREATE TRIGGER trg_after_insert_order_item
AFTER INSERT ON order_items
FOR EACH ROW
BEGIN
    UPDATE products 
    SET stock = stock - NEW.quantity 
    WHERE id = NEW.product_id;
END;

-- 场景2: 统计缓存
CREATE TRIGGER trg_after_insert_comment
AFTER INSERT ON comments
FOR EACH ROW
BEGIN
    UPDATE articles 
    SET comment_count = comment_count + 1 
    WHERE id = NEW.article_id;
END;

-- 场景3: 数据校验
CREATE TRIGGER trg_before_insert_user
BEFORE INSERT ON users
FOR EACH ROW
BEGIN
    IF NEW.email NOT LIKE '%@%.%' THEN
        SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = '邮箱格式不正确';
    END IF;
END;
```

### 2.4 触发器的限制

```sql
-- 1. 不能在触发器中调用存储过程（MySQL 限制）
-- 2. 不能使用事务控制语句（COMMIT/ROLLBACK）
-- 3. 触发器是行级的，不能使用 FOR EACH STATEMENT
-- 4. 外键级联操作不会触发触发器
-- 5. 临时表不能使用触发器
```

## 3. 事件调度器

### 3.1 启用事件调度器

```sql
-- 查看事件调度器状态
SHOW VARIABLES LIKE 'event_scheduler';

-- 开启事件调度器
SET GLOBAL event_scheduler = ON;

-- 或在 my.cnf 中配置
[mysqld]
event_scheduler = ON
```

### 3.2 创建事件

```sql
-- 一次性事件
CREATE EVENT evt_cleanup_logs
ON SCHEDULE AT CURRENT_TIMESTAMP + INTERVAL 1 HOUR
DO
    DELETE FROM logs WHERE created_at < DATE_SUB(NOW(), INTERVAL 30 DAY);

-- 周期性事件
CREATE EVENT evt_daily_cleanup
ON SCHEDULE EVERY 1 DAY
STARTS '2024-01-01 02:00:00'
DO
    DELETE FROM logs WHERE created_at < DATE_SUB(NOW(), INTERVAL 90 DAY);

-- 复杂逻辑事件
CREATE EVENT evt_monthly_report
ON SCHEDULE EVERY 1 MONTH
STARTS '2024-01-01 00:00:00'
DO
BEGIN
    INSERT INTO monthly_stats (month, user_count, order_count, total_amount)
    SELECT 
        DATE_FORMAT(NOW() - INTERVAL 1 MONTH, '%Y-%m'),
        COUNT(DISTINCT user_id),
        COUNT(*),
        SUM(amount)
    FROM orders
    WHERE created_at >= DATE_FORMAT(NOW() - INTERVAL 1 MONTH, '%Y-%m-01')
      AND created_at < DATE_FORMAT(NOW(), '%Y-%m-01');
END;
```

### 3.3 管理事件

```sql
-- 查看所有事件
SHOW EVENTS;
SELECT * FROM information_schema.EVENTS;

-- 修改事件
ALTER EVENT evt_daily_cleanup
ON SCHEDULE EVERY 12 HOUR;

-- 禁用事件
ALTER EVENT evt_daily_cleanup DISABLE;

-- 启用事件
ALTER EVENT evt_daily_cleanup ENABLE;

-- 删除事件
DROP EVENT IF EXISTS evt_daily_cleanup;
```

## 4. 为什么不推荐使用

| 问题 | 说明 |
|------|------|
| 调试困难 | 存储过程/触发器的调试工具有限 |
| 版本管理 | 难以纳入 Git 等版本控制 |
| 性能隐患 | 触发器可能隐藏性能问题 |
| 逻辑分散 | 业务逻辑分散在应用和数据库中 |
| 迁移困难 | 不同数据库的存储过程语法不兼容 |
| 测试困难 | 单元测试覆盖困难 |

## 5. 适用场景（仅限特定情况）

```
✅ 可以考虑使用：
- 简单的数据校验（触发器）
- 定期数据清理（事件调度器）
- 遗留系统维护（存储过程）
- DBA 运维脚本（存储过程）

❌ 不建议使用：
- 复杂业务逻辑
- 需要频繁变更的逻辑
- 需要高性能的场景
- 需要跨数据库移植的系统
```
