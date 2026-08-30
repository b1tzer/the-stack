# 生产问题排查

> **一句话总结**：监控告警 CPU 90%+、内存持续增长、接口响应慢——这些生产问题你不能只靠重启解决。jstack、jmap、Arthas、MAT 是你的手术刀。

## 1. CPU 飙高排查

### 1.1 排查步骤

```bash
# Step 1: 找到 CPU 最高的 Java 进程
top -c
# 记下进程 PID，比如 12345

# Step 2: 找到该进程中 CPU 最高的线程
top -Hp 12345
# 记下线程 PID，比如 12367

# Step 3: 线程 PID 转 16 进制
printf "%x\n" 12367
# 输出: 304f

# Step 4: 在 jstack 中查找该线程
jstack 12345 | grep -A 30 "nid=0x304f"
```

### 1.2 一键排查脚本

```bash
#!/bin/bash
# cpu-diagnosis.sh — CPU 飙高一键排查

PID=$1
if [ -z "$PID" ]; then
    echo "Usage: $0 <java-pid>"
    exit 1
fi

echo "=== CPU Top 10 线程 ==="
top -Hp $PID -b -n 1 | head -17

echo ""
echo "=== 高 CPU 线程堆栈 ==="
for tid in $(top -Hp $PID -b -n 1 | tail -n +8 | head -10 | awk '{print $1}'); do
    hex_tid=$(printf "%x" $tid)
    echo "--- Thread $tid (0x$hex_tid) ---"
    jstack $PID | grep -A 20 "nid=0x$hex_tid" | head -25
    echo ""
done
```

### 1.3 Arthas 更强大的排查

```bash
# 下载并启动 Arthas
curl -O https://arthas.aliyun.com/arthas-boot.jar
java -jar arthas-boot.jar 12345

# 查看最繁忙的线程
thread -n 5       # 显示 CPU 占用最高的 5 个线程

# 查看某个线程的堆栈
thread 123        # 查看线程 ID 为 123 的堆栈

# 查看方法耗时
trace com.myapp.service.OrderService createOrder

# 监控方法调用
watch com.myapp.service.OrderService createOrder '{params, returnObj, throwExp}'
```

### 1.4 常见 CPU 飙高原因

| 原因 | 特征 | 解决方案 |
|------|------|----------|
| 死循环 | 堆栈卡在同一行代码 | 修复循环条件 |
| 正则回溯 | `Pattern.compile` 相关堆栈 | 优化正则表达式 |
| 频繁 Full GC | CPU 高 + GC 日志有大量 Full GC | 增大堆内存 / 修复内存泄漏 |
| 序列化/反序列化 | JSON/XML 处理堆栈 | 换用更快的序列化库 |
| 加密/解密 | `Cipher` 相关堆栈 | 异步处理 / 硬件加速 |

> **踩坑提醒**：`jstack` 在某些 JVM 版本下会触发 Full GC（安全点），如果线上流量很大，建议用 Arthas 的 `thread` 命令代替。另外，如果 CPU 飙高是由 GC 引起的，`jstack` 看到的线程堆栈可能全是 GC 线程——先看 GC 日志确认。

## 2. 内存泄漏排查

### 2.1 排查步骤

```bash
# Step 1: 确认内存使用情况
jmap -heap 12345
# 查看堆使用率，如果 Old 区持续增长 → 可能有泄漏

# Step 2: 查看对象分布
jmap -histo:live 12345 | head -30
# 查看实例数最多的类，如果某个类实例数异常多 → 嫌疑对象

# Step 3: 导出堆内存快照
jmap -dump:live,format=b,file=heap.hprof 12345

# Step 4: 用 MAT 分析
# 下载 Eclipse Memory Analyzer: https://www.eclipse.org/mat/
# 打开 heap.hprof，查看 Dominator Tree 和 Leak Suspects
```

### 2.2 启动时自动 dump（推荐）

```bash
# JVM 参数：OOM 时自动 dump
java -XX:+HeapDumpOnOutOfMemoryError \
     -XX:HeapDumpPath=/data/heap-dumps/ \
     -XX:+UseG1GC \
     -Xms2g -Xmx2g \
     -jar myapp.jar
```

### 2.3 常见内存泄漏场景

```java
// ❌ 场景 1: ThreadLocal 泄漏
public class UserContext {
    private static final ThreadLocal<User> CURRENT_USER = new ThreadLocal<>();

    public static void setUser(User user) {
        CURRENT_USER.set(user);
    }

    // 忘记调用 remove() → 线程复用时旧对象无法回收
    public static void clear() {
        CURRENT_USER.remove();  // ✅ 必须在请求结束时调用
    }
}

// ❌ 场景 2: 静态集合不断增长
public class CacheManager {
    private static final Map<String, Object> CACHE = new HashMap<>();

    public void put(String key, Object value) {
        CACHE.put(key, value);  // 永远不会被 GC
    }
}

// ✅ 修复：使用带过期的缓存
public class CacheManager {
    private final Cache<String, Object> cache = Caffeine.newBuilder()
        .maximumSize(10000)
        .expireAfterWrite(Duration.ofMinutes(30))
        .build();

    public void put(String key, Object value) {
        cache.put(key, value);
    }
}

// ❌ 场景 3: 数据库连接未关闭
public List<Order> findOrders() {
    Connection conn = dataSource.getConnection();
    PreparedStatement ps = conn.prepareStatement("SELECT * FROM orders");
    ResultSet rs = ps.executeQuery();
    // 如果中间抛异常，连接永远不会关闭！
    List<Order> orders = mapResults(rs);
    rs.close();
    ps.close();
    conn.close();
    return orders;
}

// ✅ 修复：try-with-resources
public List<Order> findOrders() {
    try (Connection conn = dataSource.getConnection();
         PreparedStatement ps = conn.prepareStatement("SELECT * FROM orders");
         ResultSet rs = ps.executeQuery()) {
        return mapResults(rs);
    }
}
```

### 2.4 MAT 分析技巧

| MAT 功能 | 用途 |
|----------|------|
| Leak Suspects Report | 自动分析泄漏嫌疑对象 |
| Dominator Tree | 按占用内存排序，找大对象 |
| Histogram | 按类统计实例数 |
| OQL | SQL 风格查询堆内存 |

```sql
-- OQL 示例：查找大于 1MB 的 byte 数组
SELECT * FROM byte[] b WHERE b.@retainedHeapSize > 1048576

-- 查找所有未关闭的 InputStream
SELECT * FROM java.io.FileInputStream WHERE in.@retainedHeapSize > 0
```

> **踩坑提醒**：`jmap -dump:live` 会触发 Full GC（因为 `live` 参数需要标记存活对象），线上大堆内存 dump 可能导致 STW 几秒到几十秒。生产环境建议用 `jcmd <pid> GC.heap_dump heap.hprof` 代替，或者直接用 Arthas 的 `heapdump` 命令。

## 3. 接口慢查询排查

### 3.1 排查路径

```
用户反馈慢
  │
  ▼
链路追踪（Zipkin/Jaeger）
  │ 看到总耗时 5s，其中 DB 查询 4.5s
  ▼
慢查询日志（MySQL）
  │ 找到具体 SQL：SELECT * FROM orders WHERE status=?
  │ 执行计划：全表扫描，rows=500000
  ▼
根因：status 列没有索引
```

### 3.2 链路追踪定位慢 Span

```java
@Service
@RequiredArgsConstructor
public class OrderService {

    private final Tracer tracer;
    private final OrderRepository orderRepository;

    public List<Order> searchOrders(OrderQuery query) {
        // 创建自定义 Span
        Span dbSpan = tracer.nextSpan().name("db-query-orders").start();
        try (Tracer.SpanInScope ws = tracer.withSpan(dbSpan)) {
            dbSpan.tag("query.status", query.getStatus());
            dbSpan.tag("query.limit", String.valueOf(query.getLimit()));

            List<Order> results = orderRepository.findByCriteria(query);

            dbSpan.tag("result.count", String.valueOf(results.size()));
            return results;
        } finally {
            dbSpan.end();
        }
    }
}
```

### 3.3 数据库慢查询日志

```sql
-- MySQL 开启慢查询日志
SET GLOBAL slow_query_log = ON;
SET GLOBAL long_query_time = 1;        -- 超过 1 秒记录
SET GLOBAL log_queries_not_using_indexes = ON;
```

```yaml
# application.yml — 连接池监控
spring:
  datasource:
    hikari:
      register-mbeans: true
      metrics-tracker-factory: com.zaxxer.hikari.metrics.micrometer.MicrometerMetricsTrackerFactory
```

### 3.4 慢查询优化 Checklist

| 检查项 | 方法 | 阈值 |
|--------|------|------|
| 是否有索引 | `EXPLAIN SELECT ...` | `type` 不应是 `ALL` |
| 扫描行数 | `rows` 列 | 应远小于总行数 |
| 是否有 filesort | `Extra` 列 | 避免 `Using filesort` |
| 是否有临时表 | `Extra` 列 | 避免 `Using temporary` |
| 连接池等待 | `hikaricp_connections_pending` | 应为 0 |
| 连接获取时间 | 日志/链路追踪 | 应 < 10ms |

```sql
-- EXPLAIN 分析示例
EXPLAIN SELECT * FROM orders WHERE status = 'PENDING' AND created_at > '2024-01-01';

-- 输出：
-- type: ALL          ← 全表扫描，危险！
-- rows: 500000       ← 扫描 50 万行
-- key: NULL          ← 没用索引

-- 修复：添加复合索引
ALTER TABLE orders ADD INDEX idx_status_created (status, created_at);

-- 再次 EXPLAIN：
-- type: ref          ← 索引查找
-- rows: 1200         ← 只扫描 1200 行
-- key: idx_status_created
```

> **踩坑提醒**：HikariCP 的 `connection-timeout` 默认是 30 秒——如果连接池耗尽，请求会卡 30 秒才超时。生产环境建议设为 3-5 秒，并监控 `hikaricp_connections_pending` 指标。如果 `pending` 持续 > 0，说明连接池太小或有连接泄漏。
