---
doc_id: pg-read-write-split
title: 读写分离架构搭建
---

# 读写分离架构搭建

> **核心问题**：单库扛不住读写压力时，如何通过主从复制实现读写分离？从库延迟导致"写后读"不一致怎么办？连接池该怎么配？故障切换如何实现？

## 1. 架构设计

典型的 PostgreSQL 读写分离架构：

```txt
┌─────────────┐     ┌─────────────┐     ┌──────────────┐
│  Spring Boot │────→│  PgBouncer  │────→│  Primary     │
│  应用 (写)    │     │  连接池      │     │  (主库)       │
└─────────────┘     └─────────────┘     └──────┬───────┘
                                                │ WAL 流复制
┌─────────────┐     ┌─────────────┐     ┌──────▼───────┐
│  Spring Boot │────→│  PgBouncer  │────→│  Standby     │
│  应用 (读)    │     │  连接池      │     │  (从库)       │
└─────────────┘     └─────────────┘     └──────────────┘
```

**核心组件职责**：

| 组件 | 职责 | 典型配置 |
| :-- | :-- | :-- |
| Primary | 处理所有写操作 | `max_connections = 200` |
| Standby | 处理只读查询 | `hot_standby = on` |
| PgBouncer | 连接池化，减少连接开销 | `pool_mode = transaction` |
| 应用层 | 路由读写请求到不同数据源 | Spring `AbstractRoutingDataSource` |

## 2. 流复制搭建完整步骤

### 2.1 环境准备

假设两台机器：
- 主库：`192.168.1.10` (pg-primary)
- 从库：`192.168.1.11` (pg-standby)
- PostgreSQL 版本：16

```bash
# 两台机器都安装 PostgreSQL 16
sudo apt install postgresql-16 -y
```

### 2.2 主库配置

**Step 1：创建复制用户**

```sql
-- 在主库执行
CREATE ROLE replicator WITH REPLICATION LOGIN PASSWORD 'StrongPassword123!';
```

**Step 2：修改 `postgresql.conf`**

```ini
# 监听地址（允许从库连接）
listen_addresses = '*'

# WAL 配置
wal_level = replica                    # 最低要求，logical 也行
max_wal_senders = 5                    # 最大并发 WAL 发送进程数
wal_keep_size = 1GB                    # 保留的 WAL 大小（防止从库落后太多）
synchronous_standby_names = ''         # 空=异步复制（性能优先）

# 归档配置（可选，生产建议开启）
archive_mode = on
archive_command = 'cp %p /var/lib/postgresql/archive/%f'

# 连接配置
max_connections = 200
```

**Step 3：修改 `pg_hba.conf`**

```ini
# TYPE  DATABASE  USER         ADDRESS           METHOD
host    replication  replicator  192.168.1.11/32  scram-sha-256
```

**Step 4：重启主库**

```bash
sudo systemctl restart postgresql
```

### 2.3 从库搭建

**Step 1：基础备份（pg_basebackup）**

```bash
# 在从库机器上执行
sudo -u postgres pg_basebackup \
    -h 192.168.1.10 \
    -U replicator \
    -p 5432 \
    -D /var/lib/postgresql/16/main \
    -Fp \
    -Xs \
    -P \
    -R   # 自动生成 standby.signal 和 recovery 配置
```

> **关键参数说明**：
> - `-Fp`：plain 格式，直接拷贝数据目录
> - `-Xs`：stream 方式传输 WAL
> - `-R`：自动创建 `standby.signal` 文件并设置 `primary_conninfo`

**Step 2：验证从库配置**

```bash
# 检查 standby.signal 是否存在
ls -la /var/lib/postgresql/16/main/standby.signal

# 检查 postgresql.auto.conf 中的主库连接信息
cat /var/lib/postgresql/16/main/postgresql.auto.conf
# 应包含：primary_conninfo = 'host=192.168.1.10 port=5432 user=replicator password=...'
```

**Step 3：修改从库配置**

```ini
# postgresql.conf（从库）
hot_standby = on                       # 允许在恢复中执行查询
max_connections = 200                   # 应与主库一致或更大
hot_standby_feedback = on              # 防止主库清理从库还需要的行
```

**Step 4：启动从库**

```bash
sudo systemctl start postgresql
```

### 2.4 验证复制状态

```sql
-- 在主库执行
SELECT
    client_addr,
    state,
    sent_lsn,
    write_lsn,
    flush_lsn,
    replay_lsn,
    pg_wal_lsn_diff(sent_lsn, replay_lsn) AS replay_lag_bytes
FROM pg_stat_replication;
```

```sql
-- 在从库执行
SELECT pg_is_in_recovery();  -- 应返回 true
```

## 3. PgBouncer 配置详解

### 3.1 为什么需要连接池？

PostgreSQL 每个连接是一个 OS 进程（fork 模型），连接创建开销约 5-10ms。当应用连接数 > 200 时，连接管理本身成为瓶颈。

PgBouncer 作为轻量级连接池中间件，核心价值：

- **连接复用**：1000 个应用连接 → 50 个数据库连接
- **排队控制**：避免数据库过载
- **快速故障转移**：应用只需重连 PgBouncer

### 3.2 三种池化模式

| 模式 | 连接生命周期 | 适用场景 | 是否支持 prepared statements |
| :-- | :-- | :-- | :-- |
| `session` | 连接保持到客户端断开 | 简单场景，兼容性最好 | 支持 |
| `transaction` | 事务结束即归还连接 | **推荐**，性价比最高 | PG 16+ 支持 |
| `statement` | 每条 SQL 结束即归还 | 极少使用，破坏事务原子性 | 不支持 |

> **Java 应用推荐 `transaction` 模式**：Spring 的 `@Transactional` 天然对应事务粒度。但注意：`SET` 命令、`LISTEN/NOTIFY`、`prepared statement` 在 `transaction` 模式下有限制。

### 3.3 PgBouncer 配置文件

```ini
; /etc/pgbouncer/pgbouncer.ini

[databases]
; 主库（写）
ecommerce_write = host=192.168.1.10 port=5432 dbname=ecommerce
; 从库（读）
ecommerce_read  = host=192.168.1.11 port=5432 dbname=ecommerce

[pgbouncer]
listen_addr = 0.0.0.0
listen_port = 6432
auth_type = scram-sha-256
auth_file = /etc/pgbouncer/userlist.txt

; 池化模式
pool_mode = transaction

; 连接池大小
default_pool_size = 25          ; 每个用户-数据库对的最大连接数
min_pool_size = 5               ; 最小保持连接数
reserve_pool_size = 5           ; 突发流量的保留连接
reserve_pool_timeout = 3        ; 等待多久启用保留连接（秒）

; 超时配置
server_idle_timeout = 300       ; 空闲服务端连接超时
client_idle_timeout = 0         ; 客户端空闲超时（0=禁用）
server_connect_timeout = 5      ; 连接主库超时
server_login_retry = 3          ; 登录重试间隔

; 连接限制
max_client_conn = 1000          ; 最大客户端连接数
max_db_connections = 50         ; 单个数据库最大连接

; 日志
log_connections = 1
log_disconnections = 1
log_pooler_errors = 1
stats_period = 60

; 管理
admin_users = pgbouncer_admin
```

```ini
; /etc/pgbouncer/userlist.txt
"replicator" "SCRAM-SHA-256$4096:..."
"app_user"   "SCRAM-SHA-256$4096:..."
```

> **`default_pool_size` 计算公式**：`(CPU核数 * 2 + 磁盘数) * 节点数`。8 核 1 SSD 的数据库，建议 `default_pool_size = 20-30`。

## 4. 应用层实现：Spring Boot 多数据源

### 4.1 配置文件

```yaml
# application.yml
spring:
  datasource:
    write:
      url: jdbc:postgresql://pgbouncer-write:6432/ecommerce_write
      username: app_user
      password: ${DB_PASSWORD}
      hikari:
        maximum-pool-size: 20
        minimum-idle: 5
        connection-timeout: 3000
        pool-name: writePool
    read:
      url: jdbc:postgresql://pgbouncer-read:6432/ecommerce_read
      username: app_user
      password: ${DB_PASSWORD}
      hikari:
        maximum-pool-size: 30
        minimum-idle: 10
        connection-timeout: 3000
        pool-name: readPool
```

### 4.2 动态数据源路由

```java
/**
 * 数据源上下文：用 ThreadLocal 标记当前请求需要读还是写
 */
public class DataSourceContext {
    private static final ThreadLocal<String> CONTEXT = new ThreadLocal<>();

    public static void useWrite() { CONTEXT.set("write"); }
    public static void useRead()  { CONTEXT.set("read"); }
    public static void clear()    { CONTEXT.remove(); }
    public static String get()    { return CONTEXT.get(); }
}

/**
 * 动态数据源：根据 DataSourceContext 决定用哪个数据源
 */
public class ReadWriteRoutingDataSource extends AbstractRoutingDataSource {
    @Override
    protected Object determineCurrentLookupKey() {
        return DataSourceContext.get();
    }
}
```

### 4.3 AOP 自动路由

```java
/**
 * 只读注解：标记在方法或类上，自动走从库
 */
@Target({ElementType.METHOD, ElementType.TYPE})
@Retention(RetentionPolicy.RUNTIME)
public @interface ReadOnly {}

/**
 * AOP 切面：自动切换数据源
 */
@Aspect
@Component
@Order(Ordered.HIGHEST_PRECEDENCE)  // 必须在 @Transactional 之前执行
public class DataSourceAspect {

    @Before("@annotation(readOnly) || @within(readOnly)")
    public void switchToRead(ReadOnly readOnly) {
        DataSourceContext.useRead();
    }

    @Before("@annotation(org.springframework.transaction.annotation.Transactional)")
    public void switchToWrite() {
        DataSourceContext.useWrite();
    }

    @After("@annotation(readOnly) || @within(readOnly) || @annotation(org.springframework.transaction.annotation.Transactional)")
    public void clear() {
        DataSourceContext.clear();
    }
}
```

### 4.4 Service 层使用

```java
@Service
public class OrderService {

    @Transactional  // 自动走主库
    public Order createOrder(CreateOrderRequest req) {
        // ... 创建订单逻辑
    }

    @ReadOnly  // 自动走从库
    public Page<Order> listUserOrders(Long userId, Pageable pageable) {
        return orderRepository.findByUserId(userId, pageable);
    }

    @ReadOnly
    public OrderStatistics getStatistics(LocalDate from, LocalDate to) {
        return orderRepository.getStatistics(from, to);
    }
}
```

## 5. 一致性问题处理

读写分离最大的痛点：**写入主库后立即从从库读，可能读到旧数据**（复制延迟）。

### 5.1 方案一：强制走主库（简单可靠）

```java
/**
 * 强制走主库的注解
 */
@Target(ElementType.METHOD)
@Retention(RetentionPolicy.RUNTIME)
public @interface ForceMaster {}

// 使用场景：创建订单后立即查询
@Transactional
public Order createAndReturn(CreateOrderRequest req) {
    Order order = createOrder(req);
    // 写操作已在主库事务中，但为了确保一致性
    DataSourceContext.useWrite();
    return orderRepository.findById(order.getId()).orElseThrow();
}
```

### 5.2 方案二：延迟读（接受短暂不一致）

```java
// 适用于：对一致性要求不高的场景（如列表页）
@ReadOnly
public List<Order> listRecentOrders(Long userId) {
    // 即使读到 1 秒前的数据，用户体验也可接受
    return orderRepository.findTop20ByUserIdOrderByCreatedAtDesc(userId);
}
```

### 5.3 方案三：基于 LSN 的一致性读（精确控制）

```sql
-- 写入后获取当前 LSN
SELECT pg_current_wal_lsn();

-- 在从库检查是否已回放到该 LSN
SELECT pg_last_wal_replay_lsn();
```

```java
/**
 * 写入后等待从库追上，再读从库
 */
public Order createOrderAndWaitRead(CreateOrderRequest req) {
    // 1. 写入主库
    Order order = createOrder(req);

    // 2. 获取主库当前 LSN
    String masterLsn = jdbcTemplate.queryForObject(
        "SELECT pg_current_wal_lsn()::text", String.class);

    // 3. 轮询从库，等待回放追上（超时 3 秒）
    DataSourceContext.useRead();
    long deadline = System.currentTimeMillis() + 3000;
    while (System.currentTimeMillis() < deadline) {
        String standbyLsn = readJdbcTemplate.queryForObject(
            "SELECT pg_last_wal_replay_lsn()::text", String.class);
        if (compareLsn(standbyLsn, masterLsn) >= 0) {
            break;
        }
        Thread.sleep(100);
    }

    // 4. 从从库读取
    return orderRepository.findById(order.getId()).orElseThrow();
}
```

> **实际建议**：90% 的场景用方案一（强制走主库）足够。只有在读 QPS 极高、必须分摊到从库时，才考虑方案三。

## 6. 故障切换方案

### 6.1 手动切换（pg_ctl promote）

```bash
# 1. 停止主库（或主库已宕机）

# 2. 提升从库为主库
sudo -u postgres pg_ctl promote -D /var/lib/postgresql/16/main

# 3. 验证从库已提升
psql -c "SELECT pg_is_in_recovery();"  -- 应返回 false

# 4. 修改 PgBouncer 指向新的主库
# 在 pgbouncer.ini 中将 ecommerce_write 指向 192.168.1.11
# 执行 RELOAD 命令
psql -p 6432 -U pgbouncer_admin pgbouncer -c "RELOAD;"
```

### 6.2 自动切换（Patroni）

生产环境推荐使用 Patroni 实现自动故障转移：

```yaml
# /etc/patroni/patroni.yml（简化版）
scope: pg-cluster
name: node-1

restapi:
  listen: 0.0.0.0:8008

etcd3:
  hosts: 192.168.1.100:2379

bootstrap:
  dcs:
    ttl: 30
    loop_wait: 10
    retry_timeout: 10
    maximum_lag_on_failover: 1048576  # 1MB，超过此延迟不允许切换

postgresql:
  listen: 0.0.0.0:5432
  data_dir: /var/lib/postgresql/16/main
  authentication:
    replication:
      username: replicator
      password: StrongPassword123!
    superuser:
      username: postgres
      password: AdminPass123!
```

**Patroni 故障转移流程**：

```txt
主库宕机 → etcd 检测 TTL 过期 → Patroni 选举新主
→ 从库 promote → 更新 etcd 中 leader 信息
→ PgBouncer 通过 consul-template 自动更新配置
```

## 7. 监控指标

### 7.1 复制延迟监控

```sql
-- 主库：查看所有从库的复制状态
SELECT
    client_addr,
    application_name,
    state,
    sync_state,
    pg_size_pretty(pg_wal_lsn_diff(pg_current_wal_lsn(), replay_lsn)) AS replay_lag,
    replay_lag AS replay_lag_time
FROM pg_stat_replication;
```

```sql
-- 从库：查看恢复延迟
SELECT
    now() - pg_last_xact_replay_timestamp() AS replication_lag;
```

### 7.2 PgBouncer 监控

```sql
-- 连接池状态
SHOW POOLS;

-- 关键指标
-- cl_active:   活跃客户端连接
-- cl_waiting:  等待中的客户端连接（> 0 说明池不够用）
-- sv_active:   活跃服务端连接
-- sv_idle:     空闲服务端连接

-- 连接统计
SHOW STATS;

-- 关键指标
-- avg_xact_time: 平均事务耗时
-- avg_query_time: 平均查询耗时
-- bytes_received/sent: 流量
```

### 7.3 Prometheus + Grafana 监控配置

```yaml
# postgres_exporter 配置
DATA_SOURCE_NAME: "postgresql://monitor:xxx@192.168.1.10:5432/postgres?sslmode=disable"
```

**关键告警规则**：

```yaml
# 复制延迟 > 10 秒
- alert: PgReplicationLag
  expr: pg_replication_lag > 10
  for: 1m
  labels:
    severity: warning

# 从库落后 > 100MB
- alert: PgReplicationLagBytes
  expr: pg_wal_lsn_diff(pg_current_wal_lsn, pg_last_wal_replay_lsn) > 104857600
  for: 2m
  labels:
    severity: critical
```

## 8. 常见坑与解决方案

### 坑 1：`transaction` 模式下 prepared statement 失效

**现象**：Spring Boot 使用 `PREPARE` 优化查询，在 PgBouncer `transaction` 模式下报 `prepared statement does not exist`。

**解决**：

```yaml
# 方案 A：禁用 Spring 的 prepared statement 缓存
spring:
  datasource:
    hikari:
      data-source-properties:
        prepareThreshold: 0

# 方案 B：升级 PgBouncer 1.21+ 支持协议级别 prepared statement
```

### 坑 2：`SET` 命令不生效

**现象**：`SET search_path = 'myschema'` 在事务结束后丢失。

**解决**：使用 `SET LOCAL`（事务级别）或在连接字符串中指定 `options`：

```ini
# PgBouncer 数据库配置
ecommerce = host=... options='-c search_path=myschema'
```

### 坑 3：从库长时间查询阻塞 vacuum

**现象**：从库上的大查询阻止主库清理旧版本（行膨胀）。

**解决**：

```sql
-- 从库配置
hot_standby_feedback = on          -- 告诉主库最老的活跃事务
max_standby_streaming_delay = 30s  -- 超过此延迟取消从库查询
max_standby_archive_delay = 60s
```

### 坑 4：连接池耗尽

**现象**：应用报 `Connection is not available, request timed out`。

**排查**：

```sql
-- 检查是否有长时间运行的事务
SELECT pid, now() - xact_start AS xact_duration, state, query
FROM pg_stat_activity
WHERE xact_start IS NOT NULL
ORDER BY xact_duration DESC
LIMIT 10;
```

**解决**：

```java
// 设置事务超时
@Transactional(timeout = 30)  // 30 秒超时
public void longRunningTask() { ... }
```

## 总结

| 层级 | 关键配置 | 目的 |
| :-- | :-- | :-- |
| 数据库 | `wal_level = replica` | 启用流复制 |
| 连接池 | `pool_mode = transaction` | 高效连接复用 |
| 应用 | `@ReadOnly` + 动态路由 | 自动读写分离 |
| 一致性 | 强制走主库 / LSN 等待 | 解决写后读问题 |
| 高可用 | Patroni + etcd | 自动故障转移 |
| 监控 | `pg_stat_replication` + Prometheus | 延迟告警 |

读写分离不是银弹——它增加了架构复杂度，引入了一致性问题。在单库能扛住时（< 5000 QPS），先别急着拆。当读压力确实成为瓶颈时，按本文步骤搭建，可以平稳过渡。
