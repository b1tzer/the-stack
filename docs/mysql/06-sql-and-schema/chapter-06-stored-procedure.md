# 存储过程、触发器与事件调度器

存储过程（Stored Procedure）、触发器（Trigger）、事件调度器（Event Scheduler）三者的共同点是「把逻辑放进数据库里」——由数据库自己保管代码、自己触发执行。它们本质上都是同一件事的不同触发时机：存储过程由客户端主动 `CALL` 调用，触发器在 DML 发生时自动执行，事件调度器则按时间表自动执行。

这套机制在 1990 年代的企业级应用里曾是主流：应用层薄、数据库层厚，业务规则、审计、报表全都写在数据库里。今天的技术栈基本反过来了，业务逻辑放在应用层已经成为默认选择。本文的目的不是推销数据库内逻辑，而是让你在读遗留代码、维护老系统、或面试被问到时能读得懂、写得对，同时清楚它们各自的边界与代价。

::: warning 版本要求
三类特性都出现得较早，在任何仍在维护的 MySQL 版本上都可用：

| 特性 | 起始版本 |
| :-- | :-- |
| 存储过程与存储函数 | 5.0 |
| 触发器（BEFORE / AFTER + INSERT / UPDATE / DELETE） | 5.0（DELETE 触发器等完整能力在 5.1 补齐） |
| 一表多触发器（同事件同时机可挂多个） | 5.7.2（配合 `FOLLOWS` / `PRECEDES` 控制顺序） |
| 事件调度器（Event Scheduler） | 5.1.6 |

版本兼容性不是这些特性的主要关注点，真正需要留心的是各版本对 `SIGNAL`、`RESIGNAL`、错误处理器、`CALL` 边界等语义细节的差异。跨大版本迁移遗留存储过程时建议在目标版本上做完整回归测试。
:::

## 1. 存储过程

存储过程是一段命名并保存在数据库中的 SQL 程序，通过 `CALL` 调用。它比单条 SQL 强的地方在于：支持变量、控制流、循环、游标、异常处理，还能接受输入参数并返回输出参数或结果集。

### 1.1 定义与调用

存储过程内部有多条语句，需要用 `BEGIN ... END` 包起来。而 MySQL 客户端默认用 `;` 作为语句分隔符，如果直接写会把 `BEGIN` 里的每个 `;` 当成语句结束，因此定义时必须先临时改分隔符：

```sql
DELIMITER //
CREATE PROCEDURE sp_get_user_orders(
    IN p_user_id INT,
    IN p_limit INT,
    OUT p_total INT
)
BEGIN
    SELECT COUNT(*) INTO p_total
    FROM orders
    WHERE user_id = p_user_id;

    SELECT id, amount, status, created_at
    FROM orders
    WHERE user_id = p_user_id
    ORDER BY created_at DESC
    LIMIT p_limit;
END //
DELIMITER ;

CALL sp_get_user_orders(1, 10, @total);
SELECT @total;
```

`DELIMITER //` 把语句分隔符临时改成 `//`，定义完再改回 `;`。`OUT` 参数在调用时用会话变量（`@total`）接收，调用后可以直接 `SELECT` 出来。

### 1.2 参数模式

MySQL 存储过程支持三种参数模式，语义与其它编程语言的按值/按引用类似：

- `IN` 是输入参数，也是默认值。调用方传进来的值可以在过程里读，但赋值不会传回去。
- `OUT` 是输出参数。调用方传入的初始值被忽略，过程里给它赋值，调用结束后调用方能读到。
- `INOUT` 双向。既能读初始值，也能把修改后的值传回给调用方。

绝大多数情况用 `IN` + 结果集就够了，只有明确需要单值返回时才用 `OUT`。

### 1.3 变量、控制流与游标

存储过程内的局部变量用 `DECLARE` 声明，必须在 `BEGIN` 块的开头、任何语句之前。控制流有 `IF ... ELSEIF ... END IF`、`CASE`、`WHILE`、`REPEAT`、`LOOP` 几种，语法与其它过程式语言类似。

游标（Cursor）用于逐行处理结果集。它的核心配套是 `CONTINUE HANDLER FOR NOT FOUND`——游标 fetch 到末尾时会抛出 `NOT FOUND` 条件，这个 handler 捕获它并设置一个「done」标志位，循环靠检查这个标志位退出：

```sql
DELIMITER //
CREATE PROCEDURE sp_process_orders()
BEGIN
    DECLARE v_id INT;
    DECLARE v_amount DECIMAL(10,2);
    DECLARE v_done INT DEFAULT 0;

    DECLARE cur_orders CURSOR FOR
        SELECT id, amount FROM orders WHERE status = 'pending';

    DECLARE CONTINUE HANDLER FOR NOT FOUND SET v_done = 1;

    OPEN cur_orders;
    read_loop: LOOP
        FETCH cur_orders INTO v_id, v_amount;
        IF v_done THEN
            LEAVE read_loop;
        END IF;

        UPDATE orders SET status = 'processing' WHERE id = v_id;
    END LOOP;
    CLOSE cur_orders;
END //
DELIMITER ;
```

游标看起来很像应用层的 `for row in rows`，但性能远不同——每一次 `FETCH` 都是一次数据库内部的状态推进，几千行以上的游标处理速度会明显低于「一次 `SELECT` 取回、应用层批量处理、一次 `UPDATE ... WHERE id IN (...)`」的写法。除非确实要逐行做不同逻辑，一般不推荐用游标。

### 1.4 异常处理

存储过程用 `DECLARE HANDLER` 声明异常处理器。`EXIT HANDLER` 触发后退出当前 `BEGIN` 块，`CONTINUE HANDLER` 触发后继续执行下一句。异常处理常用来做「事务里出错就回滚」这一类的模式：

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

`SQLEXCEPTION` 是最宽的一档，几乎所有错误码都会命中。也可以按具体 SQLSTATE 或 MySQL 错误码来匹配，做更精细的分流。

## 2. 触发器

触发器是绑定在表上、由 DML（`INSERT` / `UPDATE` / `DELETE`）自动激活的一段代码。它可以在事件发生之前（`BEFORE`）或之后（`AFTER`）执行，因此一张表最多能挂 6 种触发器：三种事件 × 两种时机。

### 2.1 NEW 与 OLD

触发器体内有两个隐式变量：`NEW` 表示新行、`OLD` 表示旧行。对 `INSERT` 触发器只有 `NEW`，对 `DELETE` 只有 `OLD`，`UPDATE` 两者都有。

`BEFORE` 触发器可以修改 `NEW` 的字段值，这个修改会作用到最终写入的数据；`AFTER` 触发器只能读，不能改。这个差异决定了它们的分工——数据整形（比如生成订单号、格式化字符串）必须放在 `BEFORE`，副作用型的操作（比如写审计日志、更新缓存表）放在 `AFTER`。

```sql
CREATE TRIGGER trg_before_insert_order
BEFORE INSERT ON orders
FOR EACH ROW
BEGIN
    IF NEW.order_no IS NULL OR NEW.order_no = '' THEN
        SET NEW.order_no = CONCAT('ORD', DATE_FORMAT(NOW(), '%Y%m%d'), LPAD(NEW.id, 6, '0'));
    END IF;
END;

CREATE TRIGGER trg_after_update_order
AFTER UPDATE ON orders
FOR EACH ROW
BEGIN
    IF OLD.status != NEW.status THEN
        INSERT INTO order_logs (order_id, old_status, new_status, created_at)
        VALUES (NEW.id, OLD.status, NEW.status, NOW());
    END IF;
END;
```

### 2.2 触发器的隐蔽陷阱

触发器最大的问题不是语法，而是它「隐身」。表结构里看不到、`SHOW CREATE TABLE` 看不到，只能通过 `SHOW TRIGGERS` 或查询 `information_schema.TRIGGERS` 才能发现。一个 DBA 或新来的工程师做 `INSERT` 调优，很可能完全没意识到这条语句其实还带着一串触发器逻辑。

具体的行为限制里，有几条容易踩坑：

**外键级联不激活触发器**。这是最常被误解的一条。当父表被 `DELETE` 而子表通过 `ON DELETE CASCADE` 被连带删除时，子表上的 `AFTER DELETE` 触发器**不会**执行——从 5.5 到 8.4 都如此。如果你想用触发器做审计日志，且删除路径可能来自级联，那么这个审计会静默丢失。绕过办法：要么把 `ON DELETE CASCADE` 去掉、在父表的 `BEFORE DELETE` 触发器里显式删子表，要么在应用层写审计。MySQL 9.7 引入了 `enable_cascade_triggers` 参数解决这个问题，但短期内绝大多数生产环境还是 8.0/8.4，这条陷阱仍然普遍存在。

**触发器里不能有事务控制语句**。`START TRANSACTION` / `COMMIT` / `ROLLBACK` 都禁止——触发器本身就在触发它的 DML 所在事务里，不能自己开或关事务。这也意味着任何隐式提交的语句（`CREATE TABLE`、`TRUNCATE`、`ALTER` 等 DDL）都不能出现在触发器里，会触发 `ERROR 1422`。

**可以 CALL 存储过程，但有限制**。触发器体内可以 `CALL` 一个存储过程，但被调用的过程不能返回结果集给客户端、不能使用动态 SQL（`PREPARE` / `EXECUTE`），也不能违反触发器自己的其他限制（比如不能有事务控制）。返回值只能通过 `OUT` / `INOUT` 参数拿。

**修改触发事件所在的同一张表会出错**。`UPDATE` 触发器里再对同表 `UPDATE`、或 `INSERT` 触发器里对同表 `INSERT`，会因递归被拒绝（`ERROR 1442`）。想在同一张表内联动，只能通过修改 `NEW` 达到目的。

### 2.3 常见场景

上面这些限制放在一起后，触发器实际能干的事就相当窄了——**数据整形**（`BEFORE` 里改 `NEW`）、**审计日志**（`AFTER` 里写另一张表）、**约束校验**（`BEFORE` 里 `SIGNAL SQLSTATE` 抛错阻断写入）这三类是主要的合理场景。

```sql
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

`SIGNAL SQLSTATE '45000'` 是自定义错误的常用写法，`45000` 是「未指定条件」的通用状态码，配合 `MESSAGE_TEXT` 抛给客户端。

## 3. 事件调度器

事件调度器是 MySQL 内置的定时任务机制。它像一个 `cron`：你在数据库里定义「什么时候执行、执行什么 SQL」，MySQL 自己按时触发。它跟 Linux 的 crontab 相比最大优势是「和数据在一起」，运维不需要额外维护一套调度系统；劣势是 MySQL 挂了任务就不跑，且不像 crontab 那样有丰富的分钟/星期级表达式。

事件默认关闭，需要显式开启：

```sql
SHOW VARIABLES LIKE 'event_scheduler';  -- OFF / ON
SET GLOBAL event_scheduler = ON;
```

生产环境应该在 `my.cnf` 里持久化配置 `event_scheduler = ON`，否则重启就失效。

事件分两种：一次性（`AT` 指定绝对时间）和周期性（`EVERY` 指定周期），最常见的用法是定期清理历史数据：

```sql
CREATE EVENT evt_daily_cleanup
ON SCHEDULE EVERY 1 DAY
STARTS CURRENT_TIMESTAMP + INTERVAL 1 DAY
DO
    DELETE FROM logs WHERE created_at < DATE_SUB(NOW(), INTERVAL 90 DAY);
```

`STARTS` 指定第一次执行时间，`ENDS` 可选，指定停止时间。事件的 SQL 体如果超过一句要用 `BEGIN ... END` 包起来，同样需要 `DELIMITER` 配合。

事件调度器有几个必须留意的坑：**主备切换后事件会重复跑**——如果主备都开着 `event_scheduler`，切换时新主的事件会立刻接管，可能与旧主还没结束的事件重复。生产环境的做法通常是：主库上事件设为 `ENABLE ON SLAVE`，或干脆只在主库开事件调度器、备库保持关闭。**长事件会阻塞后续调度**——事件是串行的，一个 1 小时执行完的日事件会推迟下次触发。**没有失败重试**，事件抛异常就直接跳过，需要靠错误日志或独立监控发现。

复杂调度场景（多机、失败重试、依赖编排）应该用外部调度器（XXL-Job、Airflow 等），事件调度器只适合「独立、幂等、耗时短、不重要」的清理型任务。

## 4. 为什么不推荐把逻辑放在数据库里

写完上面三节应该能感觉到，MySQL 的过程式能力是够用的——但「够用」并不等于「适合」。在今天的技术栈里，把业务逻辑放在数据库里几乎总是错的选择，具体理由值得展开：

**版本管理与 CI/CD 不友好**。应用代码可以走 Git、代码评审、CI 流水线、自动化测试、灰度发布这一整套现代工程实践。存储过程与触发器一旦创建就存在数据库元数据里，`ALTER PROCEDURE` 又是 DDL，跟应用发布节奏对不齐。团队里稍微跑一段时间，很快就会出现「线上和 Git 里的定义不一致」的情况，且几乎无从审计。

**调试与观测能力弱**。存储过程里出错，栈信息稀薄；触发器隐身，出问题定位需要额外的经验；事件调度器的错误只在 MySQL 错误日志里。相比之下应用层的日志、追踪、断点调试、单元测试都成熟得多。

**扩展方向错**。业务变复杂时，应用层可以横向扩容——起更多的 Pod、加更多的服务实例。而存储过程运行在数据库进程里，占用的是数据库的 CPU 与内存资源。当你依赖存储过程处理业务时，数据库就必然成为性能瓶颈，且很难通过传统手段（读写分离、分库分表）分摊。

**跨库迁移几乎不可能**。存储过程与触发器的语法各家数据库都不一样，MySQL 的写法迁到 PostgreSQL 或 Oracle 需要几乎重写。而应用层代码只要 SQL 保持 ANSI 兼容，切换数据库只是换 JDBC 驱动和连接串的事。

那什么情况下值得用？三类：**DBA 运维脚本**（备份、清理、批量修复），这些天然属于数据库运维范畴；**遗留系统维护**，已经写在存储过程里的逻辑没有必要非改到应用层，除非你正好在做那块的重构；**独立的定时清理任务**（用事件调度器执行 `DELETE ... WHERE created_at < ...`），足够简单又不涉及业务逻辑。

除此之外——包括那些「顺手用触发器同步一个统计字段」「用存储过程封装几个 UPDATE」的场景——都值得停下来问一句：这段逻辑放在应用层是不是更合适？大多数时候答案是肯定的。
