# JVM 案例：GC、资源与综合诊断

> **案例说明：** 本页日期、业务背景、指标和工具输出均为构造或匿名化教学数据；除引用一手资料外，不应视为可核验的真实事件。排查方法与命令仍需结合目标 JDK、系统和生产变更流程验证。

这组案例覆盖老年代持续晋升、连接池耗尽以及 Arthas 与 JFR 的组合排查，重点是从症状回到资源和执行链路。

## 背靠背 Full GC —— 双十一订单服务蜕变

### 构造的案例场景

2025 年双十一，某电商订单服务在零点过后 8 分钟，P99 从 80ms 飙升到 3200ms，CPU 从 35% 跳涨到 92%。JVM 配置：堆 8G（`-Xms8g -Xmx8g`），新生代 2G，使用 G1。应用基于 Spring Boot 3.2 + JDK 21。

这不是内存泄漏——`jstat` 显示 Full GC 后老年代确实有回收，但很快又被打满，形成「背靠背 Full GC」——一次 Full GC 刚结束，新涌入的请求对象又迅速填满老年代，触发下一次。

### 第一步：读 GC 日志

将 GC 日志导入 GCViewer 做趋势分析，发现一个关键模式：**每次 Young GC 稳定晋升约 180~220MB 对象到老年代。** 对于 6G 的老年代，这意味着约 30 次 Young GC 就能打满。老年代一旦接近上限，G1 的 Mixed GC 来不及回收，退化触发 Full GC。Full GC 虽然能回收掉这些对象（老年代从 6G 降到 4G），但大促流量下新请求又迅速涌入——15 秒后晋升曲线重新启动，形成「背靠背 Full GC」。

### 第二步：抓堆 dump 看晋升了什么

在 Full GC 前后分别抓 dump 比对差异：

```bash
jmap -dump:format=b,file=/tmp/heap_before.hprof <pid>
jmap -dump:format=b,file=/tmp/heap_after.hprof <pid>
```

用 MAT 的 Histogram 对比，发现持续存活的对象主要是 `OrderDTO`（订单传输对象）、`OrderItemDTO[]`（订单明细数组）、请求级 `HashMap$Node`。这些对象的特点是：**在处理链路期间存活，但事务提交后应该被回收。** 那为什么它们没被 Young GC 回收掉，而是晋升到了老年代？

### 第三步：检查晋升原因

异常晋升的根因是大促场景下请求处理链路过长：反序列化 → 校验 → 库存扣减 → 写库 → 发送 MQ → 构建响应。这套链路耗时远超日常，每次 Young GC 时大量请求的中间对象尚未走到生命周期终点——Young GC 判定它们还活着，只能把它们往老年代搬。

这种情况在小新生代 + 长请求链路下会被急剧放大：高并发时每次 Young GC 之间积压了几十个请求的中间对象，累计活对象量轻易超过 Survivor 区的容纳能力，导致**提前晋升（Premature Promotion）**——本质上属于短命对象，但因为「来不及死」而被错误地判为长命对象送进了老年代。

### 第四步：调优方案

问题本质：**年轻代太小 + Survivor 区太小，导致短命对象被错误晋升。**

```bash
# 调优前
-Xms8g -Xmx8g -Xmn2g -XX:+UseG1GC -XX:MaxGCPauseMillis=200

# 调优后
-Xms8g -Xmx8g
-XX:+UseG1GC
-XX:MaxGCPauseMillis=200
-XX:G1NewSizePercent=10            # 年轻代下限 10%（800MB）
-XX:G1MaxNewSizePercent=40          # 年轻代上限 40%（3.2GB）——关键改动
-XX:MaxTenuringThreshold=15         # 最大晋升年龄
-XX:InitiatingHeapOccupancyPercent=45  # 堆占用 45% 就开始并发标记
-XX:G1HeapRegionSize=4m            # Region 大小
-Xlog:gc*=info:file=gc.log:time
```

**核心改动：**
1. `G1MaxNewSizePercent=40`：让 G1 在高负载时把年轻代动态扩展到 3.2GB（之前固定 2G），给短命对象更多「生存空间」
2. `InitiatingHeapOccupancyPercent=45`：让 G1 在老年代占用 45% 时就启动并发标记（之前默认 45% 没事，但默认的 Mixed GC 触发时机太晚——等到老年代接近满才做）
3. 去掉 `-Xmn2g`——G1 下不建议固定新生代大小，应让它自适应

### 调优效果

| 指标 | 调优前 | 调优后 |
| :-- | :-- | :-- |
| Full GC 频率 | 每 15~25 秒 1 次 | 0 次 / 小时 |
| Young GC 停顿 | 80~150ms | 20~45ms |
| 接口 P99 | 3200ms | 85ms |
| 老年代使用率 | 96%~99% | 42%~58% |
| 对象晋升速率 | 200MB / Young GC | 15~30MB / Young GC |

### 总结：如何判断「晋升过快」vs「内存泄漏」

| 特征 | 晋升过快 | 内存泄漏 |
| :-- | :-- | :-- |
| Full GC 后的老年代 | 明显下降（如 6G→4G） | 基本不降（6G→5.9G） |
| MAT 分析 | 热点对象类型正常，只是量大 | 特定类型持续增长 |
| 修复方向 | 调整年轻代/Survivor/晋升阈值 | 代码层修复引用 |
| 是否重启有效 | 无效（流量恢复后重现） | 暂时有效（需要时间重新堆积） |

## 连接池耗尽 —— 200 个线程全卡在 getConnection()

### 事故背景

一个 Spring Boot 微服务（订单系统），Tomcat 默认 200 线程，HikariCP 默认 10 连接。某天下午 3 点，监控显示该服务所有节点从 Eureka 掉线，接口全部超时——但进程还在，端口也正常监听。

这是典型的「服务假死」——进程活着，但无法处理任何新请求。

### 第一步：看线程栈

```bash
jstack <pid> > thread.dump
```

用 `fastthread.io` 或直接 grep 分析：

```bash
grep "java.lang.Thread.State" thread.dump | sort | uniq -c | sort -rn
```

```txt
189 BLOCKED        ← 189 个线程被阻塞！
 11 RUNNABLE
```

189 个线程的栈几乎完全一样：

```txt
"http-nio-8080-exec-37" #57 daemon prio=5
   java.lang.Thread.State: BLOCKED
    at com.zaxxer.hikari.pool.HikariPool.getConnection(HikariPool.java:200)
    - waiting to lock <0x00000007aab00000> (a com.zaxxer.hikari.pool.HikariPool)
    at com.zaxxer.hikari.HikariDataSource.getConnection(HikariDataSource.java:128)
    at org.springframework.jdbc.datasource.DataSourceUtils.doGetConnection(DataSourceUtils.java:116)
    at org.mybatis.spring.SqlSessionUtils.getSqlSession(SqlSessionUtils.java:90)
    at com.example.order.service.OrderService.createOrder(OrderService.java:45)
```

189 个 Tomcat 线程全部阻塞在 `HikariPool.getConnection()` 上——等一个数据库连接。

### 第二步：看谁占着连接

搜 `HikariPool` 相关线程，找持有锁的那个：

```txt
"http-nio-8080-exec-28" #48 daemon prio=5
   java.lang.Thread.State: RUNNABLE
    at java.net.SocketInputStream.socketRead0(Native Method)
    at java.net.SocketInputStream.socketRead(SocketInputStream.java:115)
    ...
    at com.mysql.cj.protocol.a.TextResultsetReader.read(TextResultsetReader.java:68)
    at com.example.order.service.OrderService.createOrder(OrderService.java:52)
    - locked <0x00000007aab00000> (a com.zaxxer.hikari.pool.HikariPool)
```

exec-28 持有 HikariPool 的锁，并在 `socketRead0` 上——它在等数据库返回。这是一个慢查询。

### 第三步：查数据库端

```sql
-- MySQL 查看当前正在执行的查询
SHOW FULL PROCESSLIST;
```

```txt
| Id  | User | Host            | db    | Command | Time | State        | Info                        |
| 108 | app  | 10.0.1.5:45231  | order | Query   | 284  | Sending data | SELECT * FROM orders WHERE...|
| 109 | app  | 10.0.1.5:45232  | order | Sleep   | 0    |              | NULL                        |
| 110 | app  | 10.0.1.5:45233  | order | Sleep   | 0    |              | NULL                        |
| ... | ...  | ...             | ...   | ...     | ...  | ...          | ...                         |
| 117 | app  | 10.0.1.5:45239  | order | Sleep   | 0    |              | NULL                        |
```

10 个连接：1 个在执行慢查询（跑了 284 秒），9 个在 Sleep。但 Sleep 的连接怎么不归还到池子？

### 第四步：查代码

```java
@Service
public class OrderService {

    @Transactional  // ← 注意这个注解
    public OrderDTO createOrder(CreateOrderRequest request) {
        // 1. 先从数据库查用户信息
        User user = userDao.findById(request.getUserId());

        // 2. 调用第三方风控接口（HTTP 调用，耗时 2~5 秒）
        RiskResult risk = riskService.check(user, request);

        // 3. 调用第三方库存服务
        boolean available = inventoryService.checkStock(request.getSkuId());

        // 4. 最后写数据库
        orderDao.insert(order);
        orderItemDao.batchInsert(items);
    }
}
```

`@Transactional` 包裹了整个方法。进入方法时 Spring 从事务管理器获取一个数据库连接，绑定到当前线程。**只要还没退出 `createOrder` 方法，连接就不会归还连接池**——即使线程大部分时间在等风控接口的 HTTP 响应。

这就是 Sleep 连接不释放的原因：**事务还在进行中，连接被「租」出去了，但没干活。**

### 第五步，修复

**短期止血——调大连接池：**

```yaml
spring:
  datasource:
    hikari:
      maximum-pool-size: 30          # 从 10 调到 30
      minimum-idle: 5
      connection-timeout: 3000       # 获取连接超时 3 秒，快速失败
      idle-timeout: 600000
      max-lifetime: 1800000
```

**长期治本——把慢操作移出事务：**

```java
@Service
public class OrderService {

    // 预先调用外部服务（不在事务中）
    public OrderDTO createOrder(CreateOrderRequest request) {
        User user = userDao.findById(request.getUserId());

        // 非事务操作：提前调用外部服务
        RiskResult risk = riskService.check(user, request);
        boolean available = inventoryService.checkStock(request.getSkuId());

        if (!risk.isPassed() || !available) {
            throw new BusinessException("订单校验失败");
        }

        // 只把数据库操作放在事务中
        return doCreateOrderInTransaction(request, user);
    }

    @Transactional
    private OrderDTO doCreateOrderInTransaction(CreateOrderRequest request, User user) {
        Order order = buildOrder(request, user);
        orderDao.insert(order);
        orderItemDao.batchInsert(buildItems(request, order));
        return OrderDTO.from(order);
    }
}
```

核心原则：**事务 = 持有连接。不要在事务里做非数据库操作。** 特别是：
- HTTP 调用（风控、通知、短信）
- 文件读写
- 复杂计算
- 消息队列发送（除非需要事务消息）

### 连接池泄漏的诊断信号

| 信号 | 工具 | 含义 |
| :-- | :-- | :-- |
| 大量线程 BLOCKED 在 `getConnection()` | `jstack` | 连接池耗尽 |
| `HikariPool` 的 `ActiveConnections` = `maximumPoolSize` | Actuator `/actuator/metrics` | 所有连接都在用 |
| `PendingConnections` > 0 | Actuator | 有线程在等连接 |
| 数据库侧有大量 `Sleep` 连接 | `SHOW PROCESSLIST` | 连接被持有但不干活 |
| 连接获取超时异常 | 日志 `Connection is not available` | 等太久 |

### 估算连接需求并识别长事务

连接池配置的「魔法数字」不是随便设的。一条经验法则：

```txt
连接池最大连接数 ≈ 期望并发事务数 × 1.2

期望并发事务数 = 业务 QPS × 平均事务耗时（秒）
```

例如：QPS 100，平均事务 0.05 秒 → 并发事务数 = 100 × 0.05 = 5，连接池设 6~8 就够了。

但如果有长事务（2 秒+），并发事务数 = 100 × 2 = 200，需要 240 个连接——这就超过了数据库的承受能力。**解决方案不是加连接，是缩短事务。**

## Arthas + JFR 综合诊断 —— 接口从 50ms 变成 3000ms 的全链路追踪

### 事故背景

某数据查询服务，上线新版本后，`/api/report/query` 接口 P99 从 50ms 暴涨到 3000ms。代码 diff 看起来很正常——只是加了一个「字段过滤」功能。压测环境 Jmeter 跑 200 QPS，没有异常。
生产环境跑 100 QPS，每隔几秒就有一次超时。

### 第一步：Arthas trace 定位耗时点

```bash
# 连接 Arthas
curl -O https://arthas.aliyun.com/arthas-boot.jar
java -jar arthas-boot.jar

# 追踪方法调用链
trace com.example.report.ReportController query -n 5 --skipJDKMethod false
```

输出：

```txt
`---ts=2025-11-11 10:30:15;thread_name=http-nio-8080-exec-12;id=2a;
    `---[98.23% 2890.123ms] ReportController:query()
        +---[0.12% 3.456ms] RequestValidator:validate()
        +---[2.34% 67.891ms] ReportDao:fetchRawData()       ← 正常
        +---[0.08% 2.312ms] DataAggregator:aggregate()
        `---[97.58% 2820.234ms] FieldFilter:apply()         ← 这里！2.8 秒！
```

`FieldFilter.apply()` 吃了 97.58% 的时间。让人困惑——「字段过滤」只是一个遍历字段名、按白名单过滤的操作，怎么会花 2.8 秒？

### 第二步：Arthas watch 看入参

```bash
watch com.example.report.FieldFilter apply '{params, returnObj, throwExp}' -x 3
```

输出：

```txt
params[0]: FieldFilterConfig{
  whitelist=["id","name","amount","createTime","updateTime","category","tags"],
  inputFields: ["id","name","amount","createTime","updateTime","description","status","category","tags","version","createdBy","updatedBy","deletedAt"],
  dataRows: 15000 rows × 12 columns
}
```

15000 行数据，每行 12 个字段。看起来不大。那为什么要 2.8 秒？

### 第三步：JFR 精确采样

Arthas 只能看到「这个调用花了 2.8 秒」，但看不到 CPU 在这 2.8 秒里具体做了什么。用 JFR 精确采样：

```bash
# 启动 JFR 录制 60 秒
jcmd <pid> JFR.start name=fieldfilter settings=profile duration=60s filename=/tmp/report.jfr
```

将 `report.jfr` 拉到本地用 JMC（JDK Mission Control）打开。

在 JMC 的「Method Profiling」面板中，`FieldFilter.apply()` 的 CPU 采样显示：

```txt
FieldFilter.apply()                   98.2%  CPU
  └─ FieldFilter.isFieldAllowed()    97.8%  CPU
       └─ String.matches()           97.6%  CPU
            └─ Pattern.compile()     97.5%  CPU
```

热点不在匹配本身，而在 `String.matches()` 内部每次调用都会执行 `Pattern.compile()` 编译正则——15000 行 × 12 列 = 180,000 次编译，累积耗时约 2.8 秒。

### 第四步：看代码

```java
public class FieldFilter {
    private static final String WHITELIST_PATTERN =
        "^id|name|amount|createTime|updateTime|category|tags|description|status|version|createdBy|updatedBy|deletedAt$";

    public List<Map<String, Object>> apply(FieldFilterConfig config, List<Map<String, Object>> dataRows) {
        List<Map<String, Object>> result = new ArrayList<>();
        for (Map<String, Object> row : dataRows) {
            Map<String, Object> filtered = new HashMap<>();
            for (Map.Entry<String, Object> entry : row.entrySet()) {
                if (isFieldAllowed(entry.getKey())) {        // ← 每次循环都调
                    filtered.put(entry.getKey(), entry.getValue());
                }
            }
            result.add(filtered);
        }
        return result;
    }

    private boolean isFieldAllowed(String fieldName) {
        return fieldName.matches(WHITELIST_PATTERN);          // ← 罪魁祸首
    }
}
```

问题分析：
1. `String.matches()` 每次调用都会 `Pattern.compile()` 编译正则——15000 × 12 = 180,000 次编译
2. 正则 `^id|name|amount|...|deletedAt$` 也是错误的——`^` 只作用于 `id`，`$` 只作用于 `deletedAt`，中间的字段是裸匹配
3. 用正则做白名单匹配是性能最差的方式——`HashSet.contains()` 才是 O(1)

### 第五步，修复

```java
public class FieldFilter {
    private static final Set<String> WHITELIST = Set.of(
        "id", "name", "amount", "createTime", "updateTime",
        "category", "tags", "description", "status",
        "version", "createdBy", "updatedBy", "deletedAt"
    );

    private boolean isFieldAllowed(String fieldName) {
        return WHITELIST.contains(fieldName);   // O(1)，180000 倍提升
    }
}
```

修复后 Arthas trace 验证：

```txt
`---ts=2025-11-11 11:05:30;thread_name=http-nio-8080-exec-8;
    `---[100% 52.341ms] ReportController:query()
        +---[0.45% 0.234ms] RequestValidator:validate()
        +---[65.12% 34.123ms] ReportDao:fetchRawData()
        +---[1.23% 0.642ms] DataAggregator:aggregate()
        `---[0.58% 0.302ms] FieldFilter:apply()           ← 从 2.8 秒降到 0.3 毫秒
```

### 第六步：用 JFR 做基线对比

修复前后各录制一份 JFR，在 JMC 中对比：

| 指标 | 修复前 | 修复后 |
| :-- | :-- | :-- |
| HTTP 请求平均响应 | 2890ms | 52ms |
| `FieldFilter.apply()` CPU 占比 | 97.5% | 0.5% |
| GC 停顿总时间（60 秒窗口） | 12.3 秒 | 0.8 秒 |
| 对象分配速率 | 450MB/s | 45MB/s |

还有一个意外收获：修复后 GC 压力也降了 10 倍——因为 `String.matches()` 每次调用都会在内部 `Pattern.compile()` 创建临时对象，180,000 次调用产生的垃圾让 Young GC 频率暴增。

### 总结：Arthas vs JFR 的选择

| 场景 | 推荐工具 | 原因 |
| :-- | :-- | :-- |
| 快速看哪个方法慢 | Arthas `trace` | 实时、直观 |
| 看方法入参/返回值 | Arthas `watch` | 精确到每次调用 |
| 确认线上代码版本 | Arthas `jad` | 反编译运行时字节码 |
| CPU 采样找热点 | JFR | 低开销、全 JVM 视角 |
| GC 事件分析 | JFR + GC 日志 | 时间线 + 原因 |
| 锁竞争分析 | JFR | `jdk.JavaMonitorWait` 事件 |
| 内存分配热点 | JFR | `jdk.ObjectAllocationInNewTLAB` / `jdk.ObjectAllocationOutsideTLAB` |

**黄金组合：Arthas 快速定位 + JFR 精确量化。** Arthas 告诉你「哪个方法慢了」，JFR 告诉你「它在等什么、分配了什么、锁了什么」。两者互补，缺一不可。

> **回到诊断入口：** [JVM 线上诊断](./chapter-01-jvm-diagnostics.md)。案例中的分配和回收机制见[垃圾回收](../../02-jvm-runtime/chapter-04-gc.md)，资源泄漏边界见[堆外内存](../../02-jvm-runtime/chapter-06-offheap-memory.md)。
