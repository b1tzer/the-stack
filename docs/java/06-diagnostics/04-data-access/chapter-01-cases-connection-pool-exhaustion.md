# 数据访问案例：连接池耗尽

> **案例说明：** 本页日期、业务背景、指标和工具输出均为构造或匿名化教学数据；除引用一手资料外，不应视为可核验的真实事件。排查方法与命令仍需结合目标 JDK、连接池版本和生产变更流程验证。

这组案例关注「获取连接超时」和「连接池缓慢耗尽」。连接池耗尽是症状，根因可能是慢 SQL 占住连接、事务持有过长或连接泄漏。先确认连接是被占住还是没归还，再决定去哪一层。

## 案例一：慢 SQL 占满连接池 {#case-1}

### 1.1 事故背景

某交易服务在报表查询上线后，核心下单接口开始间歇性报 `CannotGetJdbcConnectionException: Timeout waiting for connection`，但数据库 CPU 并不高。

### 1.2 第一步：看连接池状态

以 Druid 为例，通过监控或 Arthas 观察：

```bash
# 活跃连接数、等待线程数、等待时间（字段名随版本变化，先核对实际返回）
# ActiveCount 接近 MaxActive，WaitingThreadCount 持续不为 0
```

`ActiveCount` 打满、`WaitingThreadCount` 持续增长，说明连接被借出后长时间不归还。数据库 CPU 不高却占满连接，指向「少量慢查询长时间持有连接」。

### 1.3 第二步：定位占住连接的 SQL

```bash
# 看当前正在执行的 SQL 与耗时（示例，具体以数据库为准）
# 例如 MySQL: SHOW PROCESSLIST 中 State 为 'Sending data' 且 Time 持续增长
```

`SHOW PROCESSLIST` 显示几条报表 SQL 的 `Time` 已达数十秒，且来自新上线的报表接口。这些慢查询把连接长期占住，下游下单请求拿不到连接。

### 1.4 根因与修复

根因是报表慢 SQL 占满连接池，拖垮了共用同一池的核心接口，不是数据库算力不足。修复是把报表查询迁到独立连接池/只读从库，并给核心接口的连接获取加超时与熔断。教训是看到连接池耗尽先看「谁占住了连接」，而不是先加池大小。

## 案例二：事务边界过大导致连接被持有 {#case-2}

### 2.1 事故背景

某服务在大事务改造后偶发连接等待超时，慢查询日志里却找不到明显慢 SQL。

### 2.2 第一步：看连接持有时间分布

```java
// 反例：把远程调用放进事务
@Transactional
public void placeOrder(Order order) {
    orderMapper.insert(order);
    // ❌ 事务内调用外部风控，耗时数秒，连接在此期间被持有
    riskClient.check(order);
    inventoryMapper.deduct(order);
}
```

事务开启后，连接在整个方法返回前都不会归还池。方法里混入了外部调用，连接被白白持有数秒。

### 2.3 第二步：缩短事务边界

```java
public void placeOrder(Order order) {
    RiskResult risk = riskClient.check(order);   // 事务外先完成远程调用
    orderMapper.insert(order);                    // 事务仅包裹必要 DB 操作
    inventoryMapper.deduct(order);
}
```

把远程调用移出事务后，单连接持有时间从数秒降到毫秒级，等待线程数回落。

### 2.4 根因与修复

根因是事务边界过大，连接被非 DB 操作占用。修复是缩小事务范围，只在真正需要原子性的 DB 操作上加事务。这类问题在慢查询日志里看不到，必须看连接持有时间。

## 案例三：连接泄漏缓慢耗尽 {#case-3}

### 3.1 事故背景

某服务运行数天后 fd 与活跃连接数缓慢增长，最终无法获取连接。重启后恢复。

### 3.2 第一步：对比池内借出与系统连接

```bash
# 系统连接数
ss -tan | grep 3306 | wc -l
# 池内 ActiveCount（示例，字段名随版本变化）
```

两者同步缓慢增长且 ActiveCount 不随业务结束回落，说明连接借出后没归还池。

### 3.3 第二步：看归还路径

```java
// 反例：异常分支跳过 close
Connection conn = dataSource.getConnection();
try {
    return doWork(conn);
} catch (SQLException e) {
    // ❌ 没 conn.close()，连接泄漏
    throw e;
}
// 正确：try-with-resources 或在 finally 中 close
```

异常路径漏掉 `close()`，连接既不归还池也不关闭，随异常频率缓慢泄漏。

### 3.4 根因与修复

根因是连接未归还，修复是统一用 try-with-resources。这个案例与网络侧的 fd 泄漏表象相似，但归因在连接池而非 socket 关闭，排查时先看「池内借出数」是否对得上系统连接。

> **返回：** [数据访问诊断总览](./index.md)
> **下一页：** [慢 SQL 案例](./chapter-02-cases-slow-sql.md)
