# JVM 调优

> 连接池和线程池调的是应用层资源，JVM 调的是运行时资源。一个 Spring Boot 应用跑得好不好，堆大小、GC 策略、容器内存配合，三件事决定生死。这一章讲清楚生产环境的 JVM 参数怎么设、OOM 怎么排查。

## 1. 生产环境 JVM 参数

```bash
java -Xms2g -Xmx2g \
     -XX:+UseG1GC \
     -XX:MaxGCPauseMillis=200 \
     -XX:+HeapDumpOnOutOfMemoryError \
     -XX:HeapDumpPath=/var/log/app/heapdump.hprof \
     -jar app.jar
```

五个参数，每个都有明确的"为什么"：

| 参数 | 为什么这么设 |
| :-- | :-- |
| `-Xms2g -Xmx2g` | 初始和最大堆设为相同值，避免运行时动态扩缩带来的停顿 |
| `-XX:+UseG1GC` | G1 是 Java 9+ 默认回收器，适合大堆（4G+）和低延迟场景 |
| `-XX:MaxGCPauseMillis=200` | 告诉 G1 目标停顿时间，它会自动调整回收策略 |
| `-XX:+HeapDumpOnOutOfMemoryError` | OOM 时自动 dump 堆，事后分析的唯一依据 |
| `-XX:HeapDumpPath` | 指定 dump 路径，避免写到容器临时目录被清理 |

---

## 2. 堆内存怎么设

### 2.1 经验起点

`-Xmx` 不要拍脑袋设。两条依据：

1. **看容器内存**：`-Xmx ≤ 容器内存限制 × 60%`。JVM 堆外内存（Metaspace、线程栈、直接缓冲区）通常占堆的 30%-50%，再加上 OS 本身需要内存。
2. **看对象存活量**：堆大小 ≥ 2 × 同时存活的对象总大小。堆太小会导致频繁 GC，堆太大会导致单次 GC 停顿变长。

### 2.2 容器环境的内存配合

K8s 或 Docker 部署时，JVM 堆、堆外内存、系统预留三者之和不能超过容器 memory limits：

```text
容器 memory limits ≥ JVM -Xmx × 1.5
```

反过来说，给定容器 limits，堆最大能设多少：

```text
-Xmx ≤ 容器 memory limits / 1.5
```

| 容器 limits | 推荐 -Xmx | 原因 |
| :-- | :-- | :-- |
| 512MB | 256MB | 堆外约 128MB + 系统预留 |
| 1GB | 512MB | 堆外约 256MB + 系统预留 |
| 2GB | 1GB | 堆外约 512MB + 系统预留 |
| 4GB | 2GB | 堆外约 1GB + 系统预留 |

设错了会怎样：`-Xmx` 设得太大，堆外内存 + 堆超过容器 limits，OS 的 OOM Killer 直接杀进程，JVM 来不及 dump，日志里只有 `Killed` 一行。

### 2.3 线程栈内存

每个线程默认占 1MB 栈内存（`-Xss1m`）。Tomcat 200 线程 = 200MB。如果容器内存紧张，可以降到 512KB：

```bash
java -Xss512k -Xmx1g -jar app.jar
```

但不要低于 256KB，否则深度调用会 StackOverflowError。

---

## 3. GC 策略选择

### 3.1 G1 回收器（推荐）

Java 9+ 默认，适合绝大多数场景：

```bash
-XX:+UseG1GC
-XX:MaxGCPauseMillis=200        # 目标停顿时间
-XX:G1HeapRegionSize=16m        # Region 大小（堆的 1/2000 ~ 1/32）
-XX:InitiatingHeapOccupancyPercent=45  # 堆使用率超过 45% 触发并发标记
```

G1 的核心思想是把堆分成很多 Region，每次只回收部分 Region（而不是整个堆），从而控制停顿时间。

### 3.2 其他回收器

| 回收器 | 参数 | 适用场景 |
| :-- | :-- | :-- |
| G1 | `-XX:+UseG1GC` | 通用，推荐 |
| ZGC | `-XX:+UseZGC` | 超低延迟（<10ms），Java 15+ 生产可用 |
| Shenandoah | `-XX:+UseShenandoahGC` | 超低延迟，Red Hat 开发 |
| Serial | `-XX:+UseSerialGC` | 单核、小堆、嵌入式 |

生产环境不要用 Parallel GC（`-XX:+UseParallelGC`），它追求吞吐量但停顿时间不可控。

---

## 4. OOM 排查

### 4.1 三类 OOM

```text
java.lang.OutOfMemoryError: Java heap space        → 堆内存不足
java.lang.OutOfMemoryError: Metaspace               → 类元数据区不足
java.lang.OutOfMemoryError: unable to create new native thread  → 线程数超限
```

### 4.2 Heap OOM 排查

拿到 heap dump 后，用 MAT（Eclipse Memory Analyzer）或 VisualVM 打开：

```bash
# 1. 找到大对象
jmap -histo:live <pid> | head -20

# 2. 分析 dump 文件
# MAT 会自动生成 Leak Suspects 报告
# 关注 "Problem Suspect" 里的大对象和引用链
```

常见根因：

| 根因 | 现象 | 解决 |
| :-- | :-- | :-- |
| 内存泄漏 | 某个对象数量持续增长 | 检查集合类（Map/List）是否有元素只加不删 |
| 大查询 | 一次查出几十万条数据 | 分页查询，或用流式处理 |
| 缓存未设上限 | 缓存对象无限增长 | 设置最大条数或过期时间 |
| 连接泄漏 | 数据库连接对象堆积 | 检查连接是否正确关闭 |

### 4.3 Metaspace OOM

Metaspace 存储类的元数据。大量动态生成类（CGLIB 代理、反射、Groovy 脚本）会撑爆它：

```bash
# 增大 Metaspace
-XX:MaxMetaspaceSize=256m

# 查看 Metaspace 使用情况
jcmd <pid> VM.metaspace
```

### 4.4 线程数 OOM

每个线程占 1MB 栈内存。32 位系统下，用户态内存空间约 3GB，理论上限约 3000 线程；64 位系统受限于物理内存和 `ulimit -u`：

```bash
# 查看系统线程限制
ulimit -u

# 查看 Java 进程线程数
jstack <pid> | grep 'tid=' | wc -l
```

---

## 5. GC 日志

GC 日志是调优的基础数据，不开就只能猜：

```bash
# Java 17+ 统一日志框架
-Xlog:gc*:file=/var/log/app/gc.log:time,uptime,level,tags:filecount=5,filesize=50m

# Java 8-16
-XX:+PrintGCDetails -XX:+PrintGCDateStamps -Xloggc:/var/log/app/gc.log
```

关键指标：

| 指标 | 健康范围 | 超出说明 |
| :-- | :-- | :-- |
| Young GC 频率 | 每秒 1-2 次 | 频率太高说明对象创建太快或年轻代太小 |
| Full GC 频率 | 每小时 < 1 次 | 频繁说明老年代不足或有内存泄漏 |
| 单次 GC 停顿 | < 200ms | 超过说明堆太大或需要换回收器 |

---

## 6. 调优 checklist

- [ ] `-Xms` 和 `-Xmx` 设为相同值
- [ ] 容器 memory limits ≥ `-Xmx` × 1.5
- [ ] 开启 `-XX:+HeapDumpOnOutOfMemoryError`
- [ ] 开启 GC 日志
- [ ] 线上观察 GC 频率和停顿时间
- [ ] Full GC 频繁时分析 heap dump，排查内存泄漏
