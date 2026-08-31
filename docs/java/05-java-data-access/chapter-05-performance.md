# 数据访问性能优化

> 一个接口 200ms，优化 SQL 后降到 150ms，还是慢。瓶颈不在 SQL，在连接池——200 个请求排队等 10 个连接，每个等 50ms。数据库连接的创建有多昂贵？HikariCP 为什么比 DBCP 快 3 倍？批处理和链路分析怎么用？本章从连接池原理到实战排查，建立一套数据访问层的性能优化方法论。

## 1. 连接池：HikariCP

### 1.1 为什么需要连接池

每次执行 SQL 之前，如果都要经历一次完整的连接建立过程，代价是这样的：

```text
客户端                           数据库服务器
  |                                |
  |------ TCP 三次握手 ------------>|  ~1-5ms（同机房）
  |------ TLS 握手（可选）---------->|  ~5-20ms
  |<----- 数据库认证挑战 ------------|
  |------ 认证响应 ---------------->|  ~1-3ms
  |<----- 认证成功 -----------------|
  |                               |
  |------ SQL 执行 --------------->|
  |<----- 结果返回 -----------------|
  |                               |
  |------ 关闭连接 ---------------->|  资源回收
```

一次简单的 `SELECT` 查询，真正的 SQL 执行可能只需要 1ms，但建立连接就要花费 5-30ms。如果每个请求都新建连接再销毁，数据库服务器会被连接风暴压垮——每秒数千次认证请求，内存和文件描述符迅速耗尽。

**连接池的本质**：预先创建一批连接，应用需要时借出，用完归还。把「建连 → 用 → 关闭」变成了「借 → 用 → 还」。

### 1.2 HikariCP 核心参数

HikariCP 是 Spring Boot 2.x 起的默认连接池，以极致的性能和简洁的设计著称。它的快来自两个关键设计：用 `ConcurrentBag` 替代传统的锁竞争，用 `javassist` 字节码生成替代 JDK 动态代理。

以下是核心参数的调优指南：

| 参数 | 含义 | 默认值 | 建议值 | 调优说明 |
|------|------|--------|--------|----------|
| `maximumPoolSize` | 最大连接数 | 10 | CPU核数×2+磁盘数 | PostgreSQL 官方公式；MySQL 通常 10-30 足够 |
| `minimumIdle` | 最小空闲连接数 | 等于 maximumPoolSize | 等于 maximumPoolSize | 保持连接池满载，避免突发流量时临时建连 |
| `connectionTimeout` | 获取连接最大等待时间 | 30000ms | 30000ms（30s） | 太短会在高峰时误报，太长会让请求堆积 |
| `idleTimeout` | 空闲连接存活时间 | 600000ms（10min） | 根据业务调整 | 低峰时回收多余连接，配合 minimumIdle 使用 |
| `maxLifetime` | 连接最大存活时间 | 1800000ms（30min） | 小于数据库的 wait_timeout | 避免数据库侧主动断连导致的异常 |
| `leakDetectionThreshold` | 连接泄漏检测阈值 | 0（禁用） | 60000ms（60s） | 开发/测试环境开启，生产环境按需 |
| `validationTimeout` | 连接有效性检测超时 | 5000ms | 1000-3000ms | 心跳检测的超时，通常不需要调 |

**关键原则**：连接池不是越大越好。每个连接都会占用数据库的内存和线程资源。一个 100 连接的池，对数据库来说是 100 个并发工作线程——如果数据库 CPU 已经打满，再多连接只是让排队更长。

```text
                应用连接池                    数据库
         ┌─────────────────┐           ┌──────────────┐
         │ ● ● ● ● ● ● ● ●│  连接 1~N │  Worker 线程  │
         │  ○  ○  ○  ○     │ ────────→ │  1  2  3  4  │
         │  (空闲连接)      │           │  CPU + 内存   │
         └─────────────────┘           └──────────────┘
              ↑ 问题：池太大 → 数据库过载
              ↑ 问题：池太小 → 应用排队等待
```

### 1.3 连接池监控

HikariCP 通过 JMX 暴露指标，Spring Boot Actuator 也能采集：

```java
@Component
public class ConnectionPoolMonitor {

    @Autowired
    private DataSource dataSource;

    @Scheduled(fixedRate = 30000) // 每30秒采集一次
    public void logPoolStats() {
        HikariDataSource hds = (HikariDataSource) dataSource;
        HikariPoolMXBean pool = hds.getHikariPoolMXBean();

        log.info("连接池状态: active={}, idle={}, waiting={}, total={}",
            pool.getActiveConnections(),
            pool.getIdleConnections(),
            pool.getThreadsAwaitingConnection(),
            pool.getTotalConnections());
    }
}
```

关键监控指标：

| 指标 | 含义 | 告警阈值 |
|------|------|----------|
| `activeConnections` | 正在使用的连接数 | 持续 > 80% 池容量 |
| `threadsAwaitingConnection` | 等待连接的线程数 | > 0 持续超过 5s |
| `connectionTimeoutRate` | 获取连接超时率 | > 1% |
| `connectionCreationTime` | 创建连接耗时 | > 1s |

## 2. 批处理

### 2.1 逐条操作的代价

考虑一个导入 10000 条记录的场景。逐条插入的执行流程：

```java
// ❌ 反面教材：逐条插入
for (User user : userList) {
    userMapper.insert(user);  // 每次：网络往返 + 事务提交
}
```

```text
时间轴（每次 insert ~5ms 网络 + ~2ms 事务）：

请求1  ████▓▓  请求2  ████▓▓  请求3  ████▓▓  ...  请求N  ████▓▓
     网络往返  事务      网络往返  事务      网络往返  事务

总耗时 = 10000 × 7ms = 70 秒
```

每次插入都是一次完整的网络往返加一次事务提交。10000 条数据，70 秒才能跑完——而且数据库的 redo log 刷盘次数也是 10000 次。

### 2.2 JDBC Batch

JDBC 的批处理机制将多条 SQL 合并为一次网络传输：

```java
// ✅ JDBC 批量插入
public void batchInsert(List<User> users) throws SQLException {
    String sql = "INSERT INTO users (name, email, age) VALUES (?, ?, ?)";

    try (Connection conn = dataSource.getConnection();
         PreparedStatement ps = conn.prepareStatement(sql)) {

        conn.setAutoCommit(false);
        int count = 0;

        for (User user : users) {
            ps.setString(1, user.getName());
            ps.setString(2, user.getEmail());
            ps.setInt(3, user.getAge());
            ps.addBatch();  // 加入批次，不立即发送

            if (++count % 1000 == 0) {
                ps.executeBatch();  // 每1000条执行一次
                conn.commit();
            }
        }

        // 处理剩余的
        ps.executeBatch();
        conn.commit();
    }
}
```

```text
时间轴（批量模式）：

┌──────────────────────────────────────┐
│  批次1 (1000条)  │  批次2  │ ... │ 批次10 │
│   ~20ms          │  ~20ms  │     │ ~20ms  │
└──────────────────────────────────────┘

总耗时 ≈ 200ms（对比逐条：70,000ms）
提升：350 倍
```

### 2.3 MyBatis 批量操作

MyBatis 提供了两种批处理方式：

**方式一：foreach 拼接 SQL**

```xml
<!-- 一次 INSERT 多行，受限于 max_allowed_packet -->
<insert id="batchInsert" parameterType="list">
    INSERT INTO users (name, email, age) VALUES
    <foreach collection="list" item="u" separator=",">
        (#{u.name}, #{u.email}, #{u.age})
    </foreach>
</insert>
```

```sql
-- 生成的 SQL：
INSERT INTO users (name, email, age) VALUES
  ('Alice', 'alice@test.com', 25),
  ('Bob', 'bob@test.com', 30),
  ('Charlie', 'charlie@test.com', 28);
```

**方式二：ExecutorType.BATCH**

```java
// 使用 SqlSession 的 BATCH 模式
try (SqlSession session = sqlSessionFactory.openSession(ExecutorType.BATCH, false)) {
    UserMapper mapper = session.getMapper(UserMapper.class);

    for (int i = 0; i < users.size(); i++) {
        mapper.insert(users.get(i));

        if ((i + 1) % 500 == 0) {
            session.flushStatements();  // 刷新批次
            session.clearCache();       // 防止内存溢出
        }
    }

    session.flushStatements();
    session.commit();
}
```

两种方式的对比：

| 特性 | foreach 拼接 | ExecutorType.BATCH |
|------|-------------|-------------------|
| 网络往返 | 1 次 | N/batchSize 次 |
| SQL 长度限制 | 受 max_allowed_packet 限制 | 无特殊限制 |
| 内存占用 | 低 | 较高（缓存 Statement） |
| 适用场景 | 小批量（< 1000 条） | 大批量（万级以上） |
| 错误处理 | 整批失败 | 可定位到具体批次 |

## 3. 数据访问链路分析

### 3.1 全链路视角

一次数据访问请求的完整链路：

![db-performance-overview](/java/db-performance-overview.svg)
```

**每一层都可能是瓶颈**。很多开发者一遇到慢查询就盯着 SQL 优化，但实际上：

- Controller 层：反序列化一个巨大的 JSON 可能耗时数百毫秒
- Service 层：事务中夹杂了远程调用，连接被长时间占用
- DAO 层：N+1 查询问题，看似简单的操作背后是 100 次数据库往返
- 连接池：所有请求排队等连接
- 数据库：全表扫描、锁等待、磁盘 I/O

### 7.3.2 各层监控要点

```java
// 使用 Micrometer + AOP 监控每层耗时
@Aspect
@Component
public class DaoMetricsAspect {

    private final Timer daoTimer;

    public DaoMetricsAspect(MeterRegistry registry) {
        this.daoTimer = Timer.builder("dao.execution.time")
            .description("DAO 层执行耗时")
            .tag("layer", "dao")
            .register(registry);
    }

    @Around("execution(* com.example.repository.*.*(..))")
    public Object measureDaoTime(ProceedingJoinPoint pjp) throws Throwable {
        return daoTimer.record(() -> {
            try {
                return pjp.proceed();
            } catch (Throwable t) {
                throw new RuntimeException(t);
            }
        });
    }
}
```

关键监控维度：

| 层级 | 监控指标 | 工具 |
|------|----------|------|
| Controller | 接口 RT、QPS、错误率 | Prometheus + Grafana |
| Service | 事务时长、业务异常率 | AOP + Micrometer |
| DAO | SQL 执行时间、结果集大小 | p6spy、MyBatis 拦截器 |
| 连接池 | 活跃连接数、等待线程数 | HikariCP JMX |
| Database | 慢查询日志、锁等待、缓冲命中率 | MySQL Performance Schema |

## 7.4 常见问题排查

### 7.4.1 慢查询

**症状**：接口 RT 突然飙升，数据库 CPU 飙高。

**排查流程**：

```sql
-- 1. 找到慢查询
SHOW PROCESSLIST;  -- 查看当前正在执行的 SQL

-- 2. 分析执行计划
EXPLAIN SELECT * FROM orders
WHERE user_id = 123 AND status = 'PAID'
ORDER BY create_time DESC;

-- 3. 检查索引使用情况
+----+-------------+--------+------+---------------+------+---------+------+-------+-----------------------------+
| id | select_type | table  | type | possible_keys | key  | key_len | ref  | rows  | Extra                       |
+----+-------------+--------+------+---------------+------+---------+------+-------+-----------------------------+
|  1 | SIMPLE      | orders | ALL  | NULL          | NULL | NULL    | NULL | 98765 | Using where; Using filesort |
+----+-------------+--------+------+---------------+------+---------+------+-------+-----------------------------+
-- type=ALL → 全表扫描！rows=98765 → 扫了近10万行
```

**解决方案**：

```sql
-- 添加复合索引
ALTER TABLE orders ADD INDEX idx_user_status_time (user_id, status, create_time);

-- 再次 EXPLAIN，确认 type 变为 ref，rows 大幅下降
EXPLAIN SELECT * FROM orders
WHERE user_id = 123 AND status = 'PAID'
ORDER BY create_time DESC;
```

### 7.4.2 连接耗尽

**症状**：大量请求超时，日志出现 `Connection is not available, request timed out`。

**排查步骤**：

```text
1. 检查连接池状态
   active = maximumPoolSize  → 池已满
   waiting > 0               → 有线程在排队

2. 检查是否有连接泄漏
   启用 leakDetectionThreshold = 60000
   日志会打印：Connection leak detection triggered for ...,
   stack trace follows:

3. 定位泄漏代码
   常见原因：
   - 手动获取 Connection 后未在 finally 中关闭
   - 使用 @Transactional 但方法内抛出未捕获异常
   - 异步任务中使用了主线程的事务连接
```

连接泄漏的典型代码：

```java
// ❌ 泄漏示例
public void badExample() {
    Connection conn = dataSource.getConnection();
    // 如果这里抛异常，连接永远不会归还
    doSomething(conn);
    conn.close();
}

// ✅ 正确写法
public void goodExample() {
    try (Connection conn = dataSource.getConnection()) {
        doSomething(conn);
    } // 自动 close，即使抛异常也会归还连接池
}
```

### 7.4.3 死锁

**症状**：数据库日志出现 `Deadlock found when trying to get lock`。

**死锁的典型场景**：

```text
事务 A                          事务 B
─────                          ─────
UPDATE account SET              UPDATE account SET
  balance = balance - 100         balance = balance + 100
WHERE id = 1;                   WHERE id = 2;
  → 锁定 id=1 ✓                  → 锁定 id=2 ✓

UPDATE account SET              UPDATE account SET
  balance = balance + 100         balance = balance - 100
WHERE id = 2;                   WHERE id = 1;
  → 等待 id=2 锁 ✗ (被B持有)      → 等待 id=1 锁 ✗ (被A持有)

           死锁！ 💀
```

**解决方案**：统一加锁顺序。

```java
// ✅ 始终按 id 从小到大的顺序加锁
public void transfer(int fromId, int toId, BigDecimal amount) {
    int first = Math.min(fromId, toId);
    int second = Math.max(fromId, toId);

    // 先锁 id 小的，再锁 id 大的
    accountDao.lock(first);
    accountDao.lock(second);

    try {
        // 执行转账逻辑
    } finally {
        accountDao.unlock(second);
        accountDao.unlock(first);
    }
}
```

### 7.4.4 问题排查对照表

| 问题 | 可能原因 | 排查方向 | 解决方案 |
|------|----------|----------|----------|
| 接口 RT 高 | SQL 全表扫描 | EXPLAIN 分析执行计划 | 添加合适索引 |
| 接口 RT 高 | N+1 查询 | 开启 SQL 日志统计查询次数 | 使用 JOIN 或批量查询 |
| 连接超时 | 连接池太小 | 查看 activeConnections | 增大 maximumPoolSize |
| 连接超时 | 连接泄漏 | leakDetectionThreshold | 用 try-with-resources |
| 连接超时 | 慢 SQL 占用连接过久 | SQL 耗时监控 | 优化 SQL 或加超时 |
| 死锁 | 交叉加锁 | 数据库死锁日志 | 统一加锁顺序 |
| 内存溢出 | 大量数据一次性加载 | 查看 ResultSet 大小 | 分页查询或流式处理 |
| 数据库 CPU 高 | 缺少索引 | 慢查询日志 + EXPLAIN | 补索引或改写 SQL |
| 数据库 CPU 高 | 复杂 JOIN | 执行计划分析 | 拆分查询或反范式化 |
| 连接抖动 | maxLifetime 太大 | 数据库 wait_timeout 对比 | 设为 wait_timeout 的 80% |

## 7.5 数据访问最佳实践总结

经过本章的学习，我们可以提炼出六条数据访问层的核心实践：

**1. 永远使用连接池**

连接池不是可选项，它是生产级应用的基础设施。即使是最简单的 CRUD 应用，直接创建连接也会在并发场景下崩溃。

**2. 参数化查询，杜绝拼接**

```java
// ❌ SQL 注入风险 + 无法复用执行计划
String sql = "SELECT * FROM users WHERE name = '" + name + "'";

// ✅ 安全 + 执行计划可缓存
String sql = "SELECT * FROM users WHERE name = ?";
ps.setString(1, name);
```

**3. 索引是双刃剑**

索引加速读，拖慢写。不要给每个字段都加索引——聚焦 `WHERE`、`JOIN`、`ORDER BY` 中的高频字段。一个 5 列的复合索引，如果查询只用到前 2 列，它依然有效（最左前缀原则）。

**4. 控制事务粒度**

```java
// ❌ 事务中包含远程调用
@Transactional
public void badExample() {
    User user = userDao.findById(id);
    emailService.sendEmail(user);  // 外部服务，可能超时
    userDao.update(user);
    // 事务持有了连接 = 外部调用的全部耗时
}

// ✅ 缩小事务范围
public void goodExample() {
    User user = userDao.findById(id);  // 事务外读取
    emailService.sendEmail(user);       // 事务外调用
    updateUser(user);                   // 只在必要时开启事务
}

@Transactional
public void updateUser(User user) {
    userDao.update(user);
}
```

**5. 批处理替代逐条操作**

导入、同步、报表生成等场景，批量操作的性能优势是数量级的。记住：网络往返的延迟比 SQL 执行本身贵得多。

**6. 监控是优化的前提**

没有数据，优化就是盲人摸象。至少监控以下三样东西：

- **慢查询日志**：找出最慢的 SQL
- **连接池指标**：确认池大小是否合理
- **接口 RT 分布**：发现性能拐点

```text
优化飞轮：

  监控  →  发现瓶颈  →  分析原因  →  优化  → 验证效果 → 监控
    ↑                                              │
    └──────────────────────────────────────────────┘
```
