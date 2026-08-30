# 性能工程

> 一个接口响应时间从 50ms 飙到 2s，CPU 使用率从 30% 涨到 95%，你该如何系统性地定位问题？性能工程的核心问题是：**如何建立指标体系、用正确的方法定位瓶颈、用科学的流程持续优化？**

## 1. 性能指标体系

### 1.1 四个黄金信号（Google SRE）

Google 在《Site Reliability Engineering》中提出四个黄金信号，是衡量服务健康的基本框架：

| 信号 | 含义 | 度量方式 | 示例 |
|------|------|---------|------|
| **Latency** | 请求耗时 | P50/P95/P99 | P99 < 200ms |
| **Throughput** | 吞吐量 | QPS/TPS | 峰值 10000 QPS |
| **Error Rate** | 错误率 | 失败请求占比 | < 0.1% |
| **Saturation** | 资源饱和度 | CPU/内存/线程池/连接池使用率 | CPU < 70% |

### 1.2 延迟的百分位数

平均值（Average）会掩盖长尾问题。假设 100 个请求中 99 个 10ms、1 个 5000ms，平均值 59.9ms 看起来很好，但那个 5s 的请求对用户是灾难。

```text
延迟分布示例（1000 个请求）：

  请求数
  800 |████████████████████
  600 |████████████████████
  400 |████████████████████
  200 |████████████████████████████
    0 └────────────────────────────────→ 延迟
      10ms   50ms  100ms  200ms  1000ms
      |← P50 →|← P95 →|← P99 →|
```

| 百分位 | 含义 | 典型 SLA |
|--------|------|---------|
| P50 | 50% 的请求在此时间内完成 | 内部监控 |
| P95 | 95% 的请求在此时间内完成 | 一般业务 |
| P99 | 99% 的请求在此时间内完成 | 核心交易 |
| P999 | 99.9% 的请求在此时间内完成 | 金融级 |

### 1.3 延迟的组成

一个请求的延迟不仅仅是代码执行时间：

```text
总延迟 = 网络传输 + 排队等待 + 业务处理 + I/O 等待
          ~5ms      变化大      应优化      最大变量
```

```java
// 用 Micrometer 记录各阶段耗时
Timer.Sample sample = Timer.start(registry);

// 数据库查询
Timer.Sample dbSample = Timer.start(registry);
List<Order> orders = orderRepo.findByUserId(userId);
dbSample.stop(registry.timer("order.db.query"));

// 缓存查询
Timer.Sample cacheSample = Timer.start(registry);
User user = cache.get(userId);
cacheSample.stop(registry.timer("order.cache.query"));

sample.stop(registry.timer("order.api.total"));
```

## 2. 性能分析方法

### 2.1 工具全景

| 类别 | 工具 | 用途 | 特点 |
|------|------|------|------|
| **在线诊断** | Arthas | 线上 JVM 实时诊断 | 无需重启，低开销 |
| **Profiling** | async-profiler | CPU/内存火焰图 | 低开销，支持 Java 原生栈 |
| **Profiling** | JProfiler | CPU/内存/线程分析 | GUI 界面，功能全面 |
| **Benchmark** | JMH | 微基准测试 | 消除 JIT 优化干扰 |
| **压测** | JMeter | HTTP/TCP 压测 | GUI + 脚本，功能丰富 |
| **压测** | wrk | HTTP 压测 | 轻量高性能 |
| **监控** | Prometheus + Grafana | 指标采集与展示 | 时序数据库 + 可视化 |
| **追踪** | SkyWalking / Jaeger | 分布式链路追踪 | 可视化调用链 |

### 2.2 Arthas：线上诊断利器

Arthas 是阿里开源的 Java 诊断工具，可以 attach 到运行中的 JVM 进行诊断：

```bash
# 启动 Arthas
java -jar arthas-boot.jar

# 查看最繁忙的线程
thread -n 3

# 监控方法耗时（每 5 秒统计一次）
monitor -c 5 com.example.service.OrderService createOrder

# 跟踪方法调用链路及耗时
trace com.example.service.OrderService createOrder

# 反编译运行中的类（确认代码版本）
jad com.example.service.OrderService

# 查看方法参数/返回值/异常
watch com.example.service.OrderService createOrder '{params, returnObj, throwExp}'
```

### 2.3 async-profiler：CPU 火焰图

火焰图的横轴是采样占比（越宽说明耗时越多），纵轴是调用栈深度：

```bash
# 采集 CPU 火焰图（30 秒）
./profiler.sh -d 30 -f cpu_flame.html -o flamegraph <pid>

# 采集内存分配火焰图
./profiler.sh -d 30 -e alloc -f alloc_flame.html -o flamegraph <pid>

# 采集锁竞争火焰图
./profiler.sh -d 30 -e lock -f lock_flame.html -o flamegraph <pid>
```

```text
火焰图阅读方法（ASCII 示意）：

     ┌──────────────────────────────────────────┐
     │           JVM Thread.run                 │ ← 顶层：入口
     ├──────────────────────────────────────────┤
     │     OrderService.createOrder()           │
     ├──────────┬───────────────────────────────┤
     │ DB Query │     Cache.get()               │ ← 宽的 = 热点
     │  (60%)   │       (30%)                   │
     ├──────────┼──────────┬────────────────────┤
     │ JDBC     │ Redis    │ Serialization      │
     └──────────┴──────────┴────────────────────┘
      横轴宽度 = CPU 采样占比，越宽越需要优化
```

### 2.4 JMH：微基准测试

JMH（Java Microbenchmark Harness）是 OpenJDK 官方的基准测试框架，消除 JIT 预热、死代码消除等干扰：

```java
@BenchmarkMode(Mode.AverageTime)
@OutputTimeUnit(TimeUnit.NANOSECONDS)
@Warmup(iterations = 3, time = 1)
@Measurement(iterations = 5, time = 1)
@Fork(2)
@State(Scope.Benchmark)
public class StringConcatBenchmark {

    private String a = "hello";
    private String b = "world";

    @Benchmark
    public String concatOperator() {
        return a + b;  // StringBuilder（JIT 优化后）
    }

    @Benchmark
    public String stringBuilder() {
        return new StringBuilder().append(a).append(b).toString();
    }

    @Benchmark
    public String stringFormat() {
        return String.format("%s%s", a, b);
    }
}
```

运行结果示例：

```text
Benchmark                   Mode  Cnt    Score    Error  Units
concatOperator              avgt   10   18.342 ±  0.521  ns/op
stringBuilder               avgt   10   17.891 ±  0.443  ns/op
stringFormat                avgt   10   68.215 ±  1.876  ns/op  ← 慢 3-4 倍
```

### 2.5 压测方法论

```text
压测流程：

  环境准备 → 基线测试 → 梯度加压 → 瓶颈定位 → 优化 → 回归验证
     │           │           │           │         │        │
   与生产同配置  单线程RT    逐步加QPS   找到拐点   改代码    重测对比
```

```bash
# wrk 压测示例：4 线程 200 连接，持续 60 秒
wrk -t4 -c200 -d60s --latency http://localhost:8080/api/orders

# 输出示例：
# Latency Distribution:
#    50%   45.32ms
#    75%   68.21ms
#    90%  102.45ms
#    99%  256.78ms
```

## 3. JVM 性能诊断实战

### 3.1 场景一：CPU 100%

**症状**：机器 CPU 使用率持续 100%，接口超时。

**诊断步骤**：

```bash
# Step 1: 找到 CPU 最高的 Java 进程
top -c   # 按 P 排序，找到 PID

# Step 2: 找到该进程中 CPU 最高的线程
top -Hp <pid>   # 按 P 排序，找到线程 TID

# Step 3: 将 TID 转为十六进制
printf "0x%x\n" <tid>   # 输出如 0x1a2b

# Step 4: 用 jstack 导出线程栈，搜索该十六进制
jstack <pid> | grep -A 30 "nid=0x1a2b"
```

常见原因：

| 原因 | 线程栈特征 | 解决方案 |
|------|-----------|---------|
| 死循环 | 同一业务方法反复出现 | 检查循环退出条件 |
| 正则回溯 | `Pattern.matcher` / `Matcher.find` | 优化正则表达式 |
| 频繁 Full GC | `VM Thread` 占 CPU | 排查内存泄漏 |
| 死锁 | `BLOCKED` 状态，waiting for monitor | 重构锁顺序 |

### 3.2 场景二：内存泄漏

**症状**：堆内存持续增长，最终 OOM。

```bash
# Step 1: 导出堆转储
jmap -dump:live,format=b,file=heap.hprof <pid>

# Step 2: 用 MAT (Memory Analyzer Tool) 分析
# 打开 heap.hprof → Leak Suspects Report
```

MAT 分析的核心视图：

```text
┌─────────────────────────────────────────┐
│  Leak Suspects (内存泄漏嫌疑)            │
├─────────────────────────────────────────┤
│  Problem Suspect 1:                     │
│  512MB (78%) occupied by                │
│  java.util.HashMap$Node[]               │
│  ← com.example.cache.LocalCache.data    │
│                                          │
│  Problem Suspect 2:                     │
│  128MB (19%) occupied by                │
│  byte[] (线程池队列堆积)                  │
└─────────────────────────────────────────┘
```

常见内存泄漏模式：

```java
// ❌ 泄漏1：静态 Map 不断增长
public class UserService {
    private static final Map<String, User> cache = new HashMap<>();
    public void login(User user) {
        cache.put(user.getToken(), user);  // 只 put 不 remove
    }
}

// ❌ 泄漏2：未关闭的资源
public List<Order> query(String sql) {
    Connection conn = dataSource.getConnection();
    PreparedStatement ps = conn.prepareStatement(sql);
    ResultSet rs = ps.executeQuery();
    // 如果这里抛异常，conn/ps/rs 都不会关闭
    return mapResults(rs);
}

// ✅ 正确：try-with-resources
public List<Order> query(String sql) {
    try (Connection conn = dataSource.getConnection();
         PreparedStatement ps = conn.prepareStatement(sql);
         ResultSet rs = ps.executeQuery()) {
        return mapResults(rs);
    }
}
```

### 3.3 场景三：频繁 GC

**症状**：接口延迟毛刺，GC 日志显示频繁 Full GC。

```bash
# 实时观察 GC 情况
jstat -gcutil <pid> 1000 20

# 输出示例：
#  S0     S1     E      O      M     CCS    YGC   YGCT    FGC   FGCT
#  0.00  45.23  67.89  89.12  95.34  91.78   342   3.456   12   8.234
#                                              ↑年轻代GC  ↑Full GC 12次
```

GC 调优思路：

```text
频繁 Young GC          频繁 Full GC
  │                       │
  ▼                       ▼
新生代太小？             老年代对象太多？
  │                       │
  ▼                       ▼
增大 -Xmn              排查内存泄漏
或调整 -XX:NewRatio      或增大 -Xmx
```

### 3.4 场景四：接口变慢

**症状**：某个接口从 50ms 逐渐增长到 2s，但 CPU/内存正常。

**诊断方法**：分布式链路追踪（Tracing）

```text
Trace ID: abc-123-def
┌────────────────────────────────────────────────────┐
│ API Gateway          5ms                            │
│ └─ Order Service     15ms                           │
│    ├─ MySQL Query    1200ms  ← 瓶颈！慢查询         │
│    ├─ Redis Get      2ms                            │
│    └─ HTTP call      30ms                           │
│       └─ User Service  25ms                         │
└────────────────────────────────────────────────────┘
```

定位到 MySQL 慢查询后：

```sql
-- 用 EXPLAIN 分析执行计划
EXPLAIN SELECT * FROM orders WHERE user_id = 123 AND status = 'PAID';

-- 发现全表扫描，添加索引
ALTER TABLE orders ADD INDEX idx_user_status (user_id, status);
```

## 4. 优化方法论

### 4.1 性能优化的六步循环

```text
    ┌──→ 发现问题 ──→ 定位瓶颈 ──→ 提出假设 ──┐
    │                                          │
    │                                          ▼
    持续监控 ←── 验证效果 ←── 实施改动
```

| 步骤 | 方法 | 关键原则 |
|------|------|---------|
| **发现** | 监控告警、用户反馈、压测报告 | 用数据说话，不用感觉 |
| **定位** | Profiling、Tracing、日志分析 | 定位到具体方法/SQL/配置 |
| **假设** | 基于数据推测根因 | 一次只改一个变量 |
| **改动** | 代码优化、配置调整、架构变更 | 最小化变更范围 |
| **验证** | 压测对比、A/B 测试 | 对比改动前后的指标 |
| **监控** | 持续观测，防止劣化 | 设置告警阈值 |

### 4.2 SQL 慢查询诊断：EXPLAIN 实战

一个接口慢，你用 Arthas trace 了一下，发现 80% 的时间花在一条 SQL 上。这条 SQL 为什么慢？答案在 `EXPLAIN` 的输出里。很多开发者看到 EXPLAIN 的十几列就头大，其实只需要关注四列。

```sql
EXPLAIN SELECT * FROM orders WHERE user_id = 123 AND status = 'PAID';
```

EXPLAIN 输出的关键列：

| 列 | 含义 | 关注点 |
|----|------|--------|
| `type` | 访问类型 | `ALL`(全表扫描) < `index` < `range` < `ref` < `eq_ref` < `const` |
| `rows` | 预估扫描行数 | 越小越好，全表扫描可能显示百万行 |
| `key` | 实际使用的索引 | `NULL` 表示没用索引 |
| `Extra` | 额外信息 | `Using filesort`、`Using temporary` 是性能红灯 |

**反面示例 vs 正面示例**：

```sql
-- ❌ 反面：type=ALL，全表扫描，rows=500000
EXPLAIN SELECT * FROM orders WHERE user_id = 123;
-- 没有索引，扫描 50 万行

-- 加索引
ALTER TABLE orders ADD INDEX idx_user_id (user_id);

-- ✅ 正面：type=ref，使用索引，rows=3
EXPLAIN SELECT * FROM orders WHERE user_id = 123;
-- 只扫描 3 行
```

**Extra 列的红灯信号**：

| Extra 值 | 含义 | 解决方案 |
|----------|------|---------|
| `Using filesort` | 额外排序操作 | 检查 ORDER BY 是否命中索引 |
| `Using temporary` | 使用临时表 | 检查 GROUP BY / DISTINCT 是否合理 |
| `Using index` | 覆盖索引（✅ 好信号） | 查询列全在索引中，无需回表 |

**经验法则**：`type` 至少达到 `range` 级别，`rows` 控制在千以内，避免 `Using filesort` 和 `Using temporary`。

### 4.3 没有测量就没有优化

```java
// ❌ 错误：凭感觉优化
// "我觉得这里可以优化" → 改代码 → 发布 → 不知道有没有效果

// ✅ 正确：先测量，再优化，再验证
// 1. 测量基线：P99 = 200ms，QPS = 5000
// 2. Profiling 定位：60% 时间在 JSON 序列化
// 3. 假设：换用 Jackson-afterburner 可以加速
// 4. 改动：引入 jackson-afterburner 模块
// 5. 验证：P99 = 120ms，QPS = 8000，提升 40%
// 6. 监控：观察一周，确认无劣化
```

### 4.4 优化的层次

从高到低，优化的收益递减但难度递增：

```text
优化层次（从上到下，收益递减）：

┌─────────────────────────────────────────┐
│  架构优化     缓存/异步/分库分表          │ ← 收益最大
├─────────────────────────────────────────┤
│  算法优化     O(n²) → O(n log n)        │
├─────────────────────────────────────────┤
│  I/O 优化     批量操作/连接池/零拷贝      │
├─────────────────────────────────────────┤
│  并发优化     线程池调优/锁优化/无锁设计   │
├─────────────────────────────────────────┤
│  代码优化     对象复用/减少拷贝/内联      │ ← 收益最小
├─────────────────────────────────────────┤
│  JVM 调优     GC 策略/堆大小/JIT 参数    │ ← 最后手段
└─────────────────────────────────────────┘
```

### 4.5 常见优化 Checklist

| 层次 | 优化项 | 预期收益 |
|------|--------|---------|
| **缓存** | 热点数据加 Redis 缓存 | 减少 80% 数据库查询 |
| **异步** | 非关键路径改为消息驱动 | 降低接口 RT 30-50% |
| **批量** | N+1 查询改为批量查询 | DB 操作减少 90% |
| **索引** | 慢 SQL 加索引 | 查询耗时降低 95% |
| **池化** | 连接池/线程池/对象池 | 减少创建销毁开销 |
| **序列化** | JSON → Protobuf / Hessian | 序列化耗时降低 50-70% |
| **压缩** | 响应体 Gzip 压缩 | 网络传输减少 60-80% |

### 4.6 性能优化的反模式

```text
❌ 过早优化："代码还没写完就开始调优"
   → 先让功能正确，再用数据驱动优化

❌ 凭经验优化："我以前这样做有用"
   → 每个系统不同，必须测量验证

❌ 局部优化：花一周把 JSON 序列化从 5ms 优化到 2ms
   → 瓶颈在数据库查询 500ms，优化序列化没有意义

❌ 只看平均值：平均 RT 50ms 看起来很好
   → P99 可能是 2s，1% 的用户在承受糟糕体验

❌ 忽视基线：优化完不记录基线数据
   → 下次劣化时无法判断是新问题还是回归
```

> 前几章覆盖了从架构到性能的完整知识体系。下一章是终章——三个真实案例（秒杀、Feed 流、分布式事务），把前八章的技术组合运用，展示"面对真实场景该怎么设计"。
