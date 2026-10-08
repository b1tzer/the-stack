# JVM 案例：CPU 与内存泄漏

> 凌晨 3 点，监控告警：支付网关 CPU 774%，支付成功率从 99.98% 跌到 12.3%。`top -Hp` → `jstack` → 线程栈全指着 `Pattern.matches()`——正则表达式回溯了 1.9 亿次，一个请求能吃掉全部 CPU。三个小时后，另一台机器 Metaspace OOM，Spring Cloud Gateway 在 K8s 上滚动重启，17 分钟内 14.7 万笔订单创建失败。排查方向从「流量太大」180 度转向「一行正则烧了银行」，从「堆不够用」转向「类加载器没释放」。排障现场最残酷的不是找不到根因——是你找到了，但已经在错误的道路上跑了三个小时。

## 案例 1：正则灾难性回溯 —— 一行正则烧了银行

### 1.1 事故背景

2024 年 6 月，广州某股份制银行核心支付网关集群，3 台 Pod 同时 CPU 100%。支付成功率从 99.98% 跌到 12.3%，平均延迟从 320ms 飙升到 8.4 秒，Kafka 消费积压暴涨 4200 倍，17 分钟内约 14.7 万笔订单创建失败。

你可能会想：银行系统应该很稳定。但事实是，越是核心系统，越容易在角落藏一颗「性能炸弹」——平时流量小不触发，大促、结算日高峰一到，炸给你看。

### 1.2 第一步：确认谁在烧 CPU

```bash
# 1. 找吃 CPU 的 Java 进程
top -c
# PID=24789, CPU=774%

# 2. 找到最忙的线程
top -Hp 24789
# 多个线程 CPU 都在 95% 以上——不是一两个线程的问题

# 3. 把最忙的线程 ID 转十六进制
printf "%x\n" 24901
# 输出: 6145

# 4. 在线程栈中定位
jstack 24789 | grep -A 30 "0x6145"
```

输出让人瞬间清醒：

```txt
"http-nio-8080-exec-3" #42 prio=5 os_prio=0 cpu=954832.45ms
   java.lang.Thread.State: RUNNABLE
    at java.util.regex.Pattern$Curly.match(Pattern.java:4367)
    at java.util.regex.Pattern$Curly.match(Pattern.java:4367)
    at java.util.regex.Pattern$GroupHead.match(Pattern.java:4731)
    at java.util.regex.Pattern$Loop.match(Pattern.java:4875)
    at java.util.regex.Pattern$GroupTail.match(Pattern.java:4792)
    at java.util.regex.Pattern$Curly.match(Pattern.java:4367)
    ... （疯狂递归回溯）
    at com.bank.payment.validator.PaymentValidator.validate(PaymentValidator.java:78)
```

栈顶全是 `Pattern$Curly.match` 的递归。这不是正常匹配——这是灾难性回溯（Catastrophic Backtracking）。

### 1.3 第二步：翻出那行正则

```java
// PaymentValidator.java:78
public class PaymentValidator {
    private static final Pattern MERCHANT_ID_PATTERN =
        Pattern.compile("^(M|MERCHANT|MERCH_)?([A-Z0-9]+)+$");

    public boolean validate(String input) {
        return MERCHANT_ID_PATTERN.matcher(input).matches();
    }
}
```

这行正则的问题在于 `([A-Z0-9]+)+`——**嵌套量词**。当输入能在前半段匹配 `[A-Z0-9]+` 但结尾不满足 `$` 锚点时（比如 `"ABCDEFGHIJKLMNOPQRSTUVWXYZ!"`，全大写但结尾有个 `!`），灾难性回溯被触发。

正则引擎的匹配过程：

```txt
^([A-Z0-9]+)+$ 匹配 "ABCDEFGHIJKLMNOPQRSTUVWXYZ!"

步骤1：内层 [A-Z0-9]+ 贪婪匹配全部 26 个大写字母
步骤2：$ 锚点要求输入结束，但下一个字符是 ! → 失败
步骤3：回溯——放弃最后一个字母 Z，内层 [A-Z0-9]+ 匹配 25 个字母
步骤4：外层 + 尝试再匹配一次，内层 [A-Z0-9]+ 匹配 Z
步骤5：$ 锚点看到 ! → 又失败
步骤6：回溯——尝试不同的分组方式
       26 个字母可以分成：(26)(0) → (25,1) → (24,2) → (24,1,1) → (23,3) → ...
       分组方案数 = 2^(N-1)，N=26 时约 3300 万种
```

每次 `matches()` 失败前，正则引擎都会穷举完所有可能的分组方式才放弃。`+` 在这里不是"匹配 0 个字符"（`+` 最少匹配 1 次），而是**外层 `+` 反复调度内层 `[A-Z0-9]+` 以不同长度贪婪匹配**，产生的组合爆炸。

注意：如果输入第一个字符就不匹配 `[A-Z0-9]`（比如全小写的 `"merchant_abcdefghijk"`），`matches()` 在第一步就返回 false，**不会回溯**。灾难性回溯的前提是前半段能匹配上、结尾锚点失败——让引擎在分组方式里穷举。

### 1.4 第三步：量化回溯成本

用一段简单的 Java 代码验证：

```java
public static void main(String[] args) {
    Pattern evil = Pattern.compile("^([A-Z0-9]+)+$");
    String base = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

    for (int i = 10; i <= 30; i++) {
        String input = base.substring(0, i) + "!";  // 结尾加一个非法字符
        long start = System.nanoTime();
        evil.matcher(input).matches();
        long cost = (System.nanoTime() - start) / 1_000_000;
        System.out.printf("长度 %d → %d ms%n", i, cost);
    }
}
```

输出：

```txt
长度 10 → 1 ms
长度 15 → 5 ms
长度 20 → 160 ms
长度 25 → 5200 ms     ← 5 秒！
长度 26 → 11000 ms    ← 11 秒！
长度 27 → 23800 ms    ← 24 秒！
```

长度为 20 时一个请求就要 160ms。这个接口 QPS 300，意味着 48 个线程同时在回溯——CPU 瞬间打满。长度每增加 1，时间翻倍——这就是指数级增长在真实系统里的代价。

### 1.5 第四步：根因与修复

**为什么之前没暴露？** 支付网关的请求中，merchantId 之前一直是大写字母+数字，正好匹配 `[A-Z0-9]+`，正则秒过。问题爆发是因为新增了一个第三方渠道，传的 merchantId 带了小写字母——不匹配的输入触发了最坏情况。

**修复方案（三层防御）：**

```java
// 第一层：去掉嵌套量词，用精确模式
private static final Pattern MERCHANT_ID_PATTERN =
    Pattern.compile("^(M|MERCHANT|MERCH_)?[A-Z0-9]{1,20}$");  // 精确长度上限

// 第二层：加超时控制（Java 没有原生支持，用守护线程打断）
public boolean validateWithTimeout(String input) {
    Future<Boolean> future = executor.submit(() ->
        MERCHANT_ID_PATTERN.matcher(input).matches());
    try {
        return future.get(100, TimeUnit.MILLISECONDS);
    } catch (TimeoutException e) {
        future.cancel(true);
        log.error("正则匹配超时，输入长度: {}", input.length());
        return false;  // 超时直接拒绝
    }
}

// 第三层：输入预检——先做轻量级校验，不合法直接返回
public boolean validate(String input) {
    if (input == null || input.length() > 50) return false;
    // 只要包含小写字母，直接拒绝，不需要正则
    if (input.chars().anyMatch(Character::isLowerCase)) return false;
    return MERCHANT_ID_PATTERN.matcher(input).matches();
}
```

### 1.6 总结：为什么这道题会考倒一群人

1. **正则写对了逻辑但写错了性能**——`([A-Z]+)+` 看起来和 `[A-Z]+` 一样，但嵌套量词的灾难性回溯在特定输入下是灾难。
2. **正常输入下测不出来**——符合预期的 merchantId 都秒过，只有「异常输入」才暴露。
3. **不止是 Java 的问题**——Python、JavaScript、PHP、Go 的 `regexp` 包都有同样的问题。ReDoS（Regular expression Denial of Service）是 OWASP 十大 Web 安全风险中「注入」类的一个子类。

**排查此类问题的信号：**
- `jstack` 中大量线程栈顶有 `java.util.regex.Pattern` 方法
- CPU 高但 `vmstat` 显示 context switch 不高（不是锁竞争）
- 线程状态全部 `RUNNABLE`（线程确实在工作，只是在做无意义的工作）

## 案例 2：本地缓存无上限 —— 把整个订单表装进内存

### 2.1 事故背景

某电商平台订单服务，双十一大促压测期间，服务运行 30 分钟后接口响应时间从 80ms 飙升到 3200ms。`jstat -gcutil` 显示 Full GC 每 15~25 秒触发一次，每次耗时 1.8~3.2 秒。老年代使用率始终在 96%~99%。

### 2.2 第一步：确认是内存泄漏还是堆配置不够

```bash
jstat -gcutil <pid> 1000 10
```

输出：

```txt
  S0     S1     E      O      M     YGC     YGCT    FGC    FGCT     GCT
  0.00  98.23  45.12  96.87  94.21  1234   45.234   89   156.234  201.468
  0.00   0.00  87.34  97.12  94.22  1235   45.256   90   158.012  203.268
  0.00  99.45  12.45  97.98  94.18  1236   45.278   91   160.123  205.401
```

关键发现：老年代（O）每次 Full GC 后几乎不降——从 97.12% → 97.98%。如果是堆配置不够，Full GC 后应该有明显下降。**不降，就是泄漏。**

### 2.3 第二步：抓 dump 分析

```bash
jmap -dump:format=b,file=/tmp/order_heap.hprof <pid>
```

将 `order_heap.hprof` 拉到本地用 MAT 打开。

**Leak Suspects Report 直接指认凶手：**

```txt
Problem Suspect 1:
  One instance of "java.util.concurrent.ConcurrentHashMap" loaded by
  "jdk.internal.loader.ClassLoaders$AppClassLoader"
  occupies 2,004,582,912 (78.32%) bytes.

  The memory is accumulated in one instance of
  "java.util.concurrent.ConcurrentHashMap$Node[]"
  loaded by "<system class loader>".

  Details:
  → com.example.order.cache.OrderCacheManager.CACHE
    (static field, OrderCacheManager.java:15)
```

一个静态 `ConcurrentHashMap`，占了堆的 78%，2GB。

### 2.4 第三步：Dominator Tree 确认

```txt
Class Name                                    | Shallow Heap | Retained Heap
java.lang.Thread @ main                       | 48 B         | 2,323 MB
├─ com.example.order.cache.OrderCacheManager  | 32 B         | 2,005 MB
│  └─ CACHE: ConcurrentHashMap               | 64 B         | 2,005 MB
│     ├─ [entry] orderId=20241111001...       | 2.1 KB
│     ├─ [entry] orderId=20241111002...       | 2.1 KB
│     └─ ... (共计 980,000+ 条目)
```

`OrderCacheManager.CACHE` 的 Retained Heap = 2GB，持有近 100 万条订单对象。每个订单对象约 2KB（包含商品明细、用户信息、物流状态等）。

### 2.5 第四步：看代码

```java
public class OrderCacheManager {
    private static final Map<String, OrderDTO> CACHE = new ConcurrentHashMap<>();

    public static void addToCache(String orderId, OrderDTO order) {
        CACHE.put(orderId, order);  // 只增不减
    }

    public static OrderDTO getFromCache(String orderId) {
        return CACHE.get(orderId);
    }

    // 没有任何清理逻辑！没有 TTL！没有容量上限！
}
```

缓存设计的初衷是减少数据库查询，提高订单详情接口的响应速度。但只实现了「加缓存」，没有实现「过期淘汰」。大促期间订单量是平时的 20 倍，缓存 30 分钟就膨胀到 100 万条。

### 2.6 第五步：修复

```java
import com.github.benmanes.caffeine.cache.Cache;
import com.github.benmanes.caffeine.cache.Caffeine;
import java.util.concurrent.TimeUnit;

public class OrderCacheManager {
    private static final Cache<String, OrderDTO> CACHE = Caffeine.newBuilder()
        .maximumSize(10_000)                                     // 最多 1 万条
        .expireAfterWrite(10, TimeUnit.MINUTES)                  // 10 分钟过期
        .removalListener((key, value, cause) -> {
            log.debug("缓存淘汰: key={}, cause={}", key, cause);
        })
        .recordStats()                                            // 开启统计
        .build();

    public static void addToCache(String orderId, OrderDTO order) {
        CACHE.put(orderId, order);
    }

    public static OrderDTO getFromCache(String orderId) {
        return CACHE.getIfPresent(orderId);
    }
}
```

### 2.7 修复后验证

```bash
jstat -gcutil <pid> 1000 10
```

```txt
  S0     S1     E      O      M     YGC     YGCT    FGC    FGCT     GCT
  45.12  0.00  32.45  38.21  45.23   123    2.345     0    0.000   2.345
```

老年代使用率稳定在 38%，Full GC 消失。接口 P99 从 3200ms 回落到 85ms。

### 2.8 总结

| 信号 | 含义 |
| :-- | :-- |
| 老年代持续上涨、Full GC 后不降 | 内存泄漏，不是堆不够 |
| MAT Leak Suspects 指向静态 Map | 无界缓存 |
| Dominator Tree 确认保留量 | 定量证据：多少对象、多少内存 |
| 代码审查发现只 put 不 remove | 设计缺陷：缓存无淘汰策略 |

**教训：** 任何本地缓存都必须有 TTL 和容量上限。`ConcurrentHashMap` 不是缓存——它只是一个线程安全的 Map。做缓存用 Caffeine、Guava Cache，或者 Redis。**用 Map 当缓存 = 把应用当操作系统。**

## 案例 3：CGLIB 动态代理未复用 —— 爆掉 256MB Metaspace

### 3.1 事故背景

某报表服务上线一个月后，频繁出现 `java.lang.OutOfMemoryError: Metaspace`，服务不定时重启。查看监控发现 Metaspace 使用量从 45MB 单调增长到 256MB，Full GC 无法回收。接口每次调用后 `jcmd <pid> VM.class_stats | wc -l` 显示类数量增加约 1000 个——且永不回落。

### 3.2 第一步：确认是 Metaspace 问题

```bash
jstat -gc <pid> 1000 5
```

关注 `MU`（Metaspace Used）和 `MC`（Metaspace Capacity）列：

```txt
Timestamp        S0C    S1C    S0U    S1U      EC       EU        OC         OU       MC     MU
104568.1         0.0   5120.0  0.0   5120.0 204800.0 102400.0  614400.0   307200.0  217088.0 208654.0
104569.1         0.0   5120.0  0.0   5120.0 204800.0 112400.0  614400.0   310000.0  218112.0 210954.0
104570.1         0.0   5120.0  0.0   5120.0 204800.0  98400.0  614400.0   315000.0  220160.0 213771.0
104571.1         0.0   5120.0  0.0   5120.0 204800.0 108000.0  614400.0   312000.0  222208.0 216854.0
104572.1         0.0   5120.0  0.0   5120.0 204800.0 101200.0  614400.0   318000.0  224256.0 220128.0
```

MU 每秒涨约 2MB，MC 随之膨胀。Full GC 后 MU 不降——类没有被卸载。

### 3.3 第二步：统计加载了哪些类

```bash
jcmd <pid> VM.class_stats | head -30
```

输出：

```txt
Index  Super  InstBytes  KlassBytes  annotations  CpAll  MethodCount  Bytecodes  MethodAll  ROAll   RWAll   Total   ClassName
1       -1     0          352         0             0      0            0          0          24      16      40      [Ljava.lang.Object;
...
12345   12344  0          1456        0             6240   24           12340      145600     10240   165840  176080  com.example.report.EnhancerByCGLIB$$d34db33f
12346   12344  0          1456        0             6240   24           12340      145600     10240   165840  176080  com.example.report.EnhancerByCGLIB$$c7be8a12
12347   12344  0          1456        0             6240   24           12340      145600     10240   165840  176080  com.example.report.EnhancerByCGLIB$$f9a21e5d
...（几万个 CGLIB 代理类）
```

几万个 `EnhancerByCGLIB$$xxxxxxxx`，每个约 172KB。用 Arthas 看类加载器：

```bash
arthas> classloader
```

```txt
 name                                                    numberOfInstances  loadedCountTotal
 net.sf.cglib.core.AbstractClassGenerator$EnhancerKey    1                  45231
 net.sf.cglib.core.AbstractClassGenerator$EnhancerKey    1                  43892
 net.sf.cglib.core.AbstractClassGenerator$EnhancerKey    1                  42176
 ... 每次 Enhancer.create() 产生一个新的类加载器，每个加载了几万个类
```

正常情况下，CGLIB 应当通过 `Enhancer` 的内部缓存复用同一个代理类，只产生少量类加载器。这里却有几个万个——这是典型的**类加载器泄漏导致的 Metaspace 无法释放**。
```java
@Service
public class ReportService {

    public byte[] generateReport(String templateName, Map<String, Object> params) {
        // 问题：每次请求都 new 一个 Enhancer 并生成新代理类
        Enhancer enhancer = new Enhancer();
        enhancer.setSuperclass(ReportTemplate.class);
        enhancer.setCallback((MethodInterceptor) (obj, method, args, proxy) -> {
            // AOP 逻辑——为报表模板方法增加日志和监控
            long start = System.currentTimeMillis();
            Object result = proxy.invokeSuper(obj, args);
            log.info("报表生成耗时: {}ms", System.currentTimeMillis() - start);
            return result;
        });

        ReportTemplate proxy = (ReportTemplate) enhancer.create();  // 每次生成一个新类！
        return proxy.render(templateName, params);
    }
}
```

CGLIB 的 `Enhancer.create()` 每次调用都会生成一个新的代理类。类名如 `ReportTemplate$$EnhancerByCGLIB$$d34db33f`，由当前的 `Enhancer` 对象和 `Callback` 决定命名。每次 `new Enhancer()` + 不同的 `MethodInterceptor` 匿名类 → CGLIB 生成不同的代理类名并创建独立的类加载器 → 新类被加载到 Metaspace → Metaspace 持续增长。

每次报表请求调用一次 `generateReport()` → 加载约 1000 个类（代理类 + 方法访问器 + 反射辅助类等）→ 永不卸载。

### 第四步：为什么类无法卸载？

JVM 卸载一个类的条件非常苛刻：该类的所有实例已被回收、该类的 `ClassLoader` 不可达、没有对该类的 `java.lang.reflect` 引用。CGLIB 每次 `create()` 生成的代理类被各自的类加载器持有强引用，只要类加载器还活着，它加载的所有类就全部占据 Metaspace 无法被 GC。

### 第五步：修复

```java
@Service
public class ReportService {

    // 缓存：同一个 MethodInterceptor 只生成一次代理类
    private static final Enhancer ENHANCER = new Enhancer();
    private static volatile ReportTemplate PROXY_TEMPLATE;

    static {
        ENHANCER.setSuperclass(ReportTemplate.class);
        ENHANCER.setCallback((MethodInterceptor) (obj, method, args, proxy) -> {
            long start = System.currentTimeMillis();
            Object result = proxy.invokeSuper(obj, args);
            log.info("报表生成耗时: {}ms", System.currentTimeMillis() - start);
            return result;
        });
        PROXY_TEMPLATE = (ReportTemplate) ENHANCER.create();
    }

    public byte[] generateReport(String templateName, Map<String, Object> params) {
        return PROXY_TEMPLATE.render(templateName, params);  // 复用同一个代理实例
    }
}
```

关键变化：`Enhancer` 只创建一次，代理类只生成一次，所有请求复用同一个代理实例。

### 修复后验证

```bash
# 观察 Metaspace
jstat -gc <pid> 1000 5
```

```txt
MU 稳定在 48MB，不再增长
```

类数量：
```bash
jcmd <pid> VM.class_stats | wc -l
# 输出: 5236（正常水平，且不再增长）
```

### 总结

| 排查维度 | Metaspace OOM | 堆 OOM |
| :-- | :-- | :-- |
| 监控指标 | `jstat -gc` 的 MU 持续增长 | `jstat -gc` 的 OU 持续增长 |
| Full GC 效果 | MC/MU 不降 | OC/OU 不降 |
| 类数量 | `jcmd VM.class_stats \| wc -l` 持续增长 | 正常 |
| MAT 分析入口 | Class Loader Explorer | Leak Suspects / Histogram |
| 常见根因 | CGLIB、FastJSON ASM、Groovy、JSP 热部署 | 无界缓存、ThreadLocal 未 remove、连接未关闭 |

**教训：** CGLIB 代理类要缓存复用。`Enhancer.create()` 不是「创建对象」，是「生成类 + 创建对象」。前者消耗 Metaspace（元空间），后者消耗堆。堆 GC 能回收对象，但类的卸载条件非常苛刻——需要 ClassLoader 不可达、且所有实例已回收、且没有反射引用。

另外：生产环境**必须**设置 `-XX:MaxMetaspaceSize=256m`。JDK 8+ 的 Metaspace 默认无上限（受限于物理内存），设置这个参数能让你在泄漏发生时拿到 OOM dump 而不是让整个机器被拖死。
