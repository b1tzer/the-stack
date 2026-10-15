# 数据访问案例：慢 SQL

> **案例说明：** 本页日期、业务背景、指标和工具输出均为构造或匿名化教学数据；除引用一手资料外，不应视为可核验的真实事件。排查方法与命令仍需结合目标数据库版本和生产变更流程验证。

这组案例关注 SQL 延迟、执行计划变化与锁等待。应用日志报的 SQL 耗时和数据库自身看到的执行耗时不一定一致，差异常来自连接等待、网络往返或事务包裹。先判断慢在数据库还是应用侧，再深挖。

## 案例一：执行计划突变导致全表扫描 {#case-1}

### 1.1 事故背景

某查询接口在数据量增长后突然变慢，SQL 语句和索引都没有改过，上线数月一直正常。

### 1.2 第一步：拿真实执行计划

以 MySQL 为例：

```sql
EXPLAIN ANALYZE SELECT * FROM orders WHERE user_id = ? AND status = ?;
-- 或 EXPLAIN FORMAT=JSON ...（不同版本语法不同）
```

输出显示 `type=ALL`（全表扫描），而历史上是 `ref`。没有改 SQL，但优化器在新数据分布下选错了索引。

### 1.3 第二步：看统计信息与数据分布

```sql
-- 查看表行数与索引基数（示例）
SHOW TABLE STATUS LIKE 'orders';
SHOW INDEX FROM orders;
```

`user_id` 的选择性随业务变化大幅下降（某批刷单导致少量 user_id 占了大量行），优化器据此放弃索引。这不是 SQL 写错，是统计信息与实际分布脱节。

### 1.4 根因与修复

根因是数据分布变化触发执行计划回退到全表扫描。修复是更新统计信息（`ANALYZE TABLE`，具体以数据库为准），并评估更合适的复合索引或 SQL 改写。教训是「SQL 没动却变慢」要先看执行计划是否漂移，而不是默认加索引。

## 案例二：锁等待把单行更新拖慢 {#case-2}

### 2.1 事故背景

某库存扣减接口偶发超时，数据库整体负载不高，但个别 SQL 耗时长。

### 2.2 第一步：看锁等待

```sql
-- 查看当前锁等待（以 MySQL InnoDB 为例，视图名随版本变化）
SELECT * FROM performance_schema.data_lock_waits;
-- 或 SHOW ENGINE INNODB STATUS 看 TRANSACTIONS 段
```

存在事务 A 持有行锁未提交，事务 B 的更新被阻塞。阻塞方的事务持有了远超必要范围的锁。

### 2.3 第二步：回应用看事务边界

```java
// 反例：事务内做非必要操作，延长锁持有
@Transactional
public void deduct(Long skuId) {
    updateStock(skuId);              // 持行锁
    notifyExternal(skuId);           // ❌ 远程调用延长锁持有，他人更新被堵
}
```

把远程调用留在事务内，行锁被持有到远程调用结束，并发扣减时大量更新排队等锁。

### 2.4 根因与修复

根因是事务内远程调用延长了锁持有时间，导致锁等待雪崩。修复是把远程调用移出事务，缩短锁窗口。慢 SQL 日志只能看到更新慢，真正根因在锁等待，必须结合锁视图判断。

## 案例三：应用侧耗时混入 SQL 耗时 {#case-3}

### 3.1 事故背景

应用监控显示某 SQL 平均 800ms，但数据库端同类语句执行只需 50ms，差距无法解释。

### 3.2 第一步：拆开获取连接与执行

```java
long t0 = System.nanoTime();
Connection conn = dataSource.getConnection();   // 含获取连接等待
long t1 = System.nanoTime();
PreparedStatement ps = conn.prepareStatement(sql);
ResultSet rs = ps.executeQuery();
long t2 = System.nanoTime();
// 若 (t1 - t0) 远大于 (t2 - t1)，慢在等连接而非执行
```

拆分后发现 750ms 花在 `getConnection()`，真正执行只有 50ms。应用侧把「等待连接」算进了 SQL 耗时。

### 3.3 第二步：确认连接等待根因

```bash
# 连接池等待线程数与等待时间（示例）
# WaitingThreadCount 高、MaxWait 接近上限
```

连接等待高回指连接池供给问题，而不是 SQL 本身慢。这与 [连接池耗尽案例](./chapter-01-cases-connection-pool-exhaustion.md) 同源。

### 3.4 根因与修复

根因是连接池等待被误算进 SQL 耗时，误导了优化方向。修复是分别埋点连接获取与执行阶段，把「等连接」和「真执行」分开统计。教训是应用层 SQL 耗时指标必须扣除连接获取时间，否则会把池问题错判成数据库问题。

> **返回：** [数据访问诊断总览](./index.md)
> **上一页：** [连接池耗尽案例](./chapter-01-cases-connection-pool-exhaustion.md)
