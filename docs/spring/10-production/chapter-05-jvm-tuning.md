# JVM 调优

> 连接池、线程池调好后，吞吐量的下一个瓶颈往往在 JVM 本身：堆太小频繁 Full GC，堆太大单次停顿过长，GC 策略选错让延迟失控。本章讲生产环境的 JVM 参数、GC 选型、日志与监控。连接池与线程池的调优见 [连接池与容器调优](./chapter-01-pool-tuning.md)。

## 1. 生产环境推荐参数

```bash
java -jar app.jar \
  # 堆内存
  -Xms4g \                          # 初始堆大小（建议 = Xmx，避免动态扩缩）
  -Xmx4g \                          # 最大堆大小（物理内存的 50-75%）
  -Xmn2g \                          # 新生代大小（堆的 1/3 到 1/2）

  # 元空间（替代 PermGen）
  -XX:MetaspaceSize=256m \
  -XX:MaxMetaspaceSize=512m \

  # GC 策略 —— G1（推荐，Java 11+ 默认）
  -XX:+UseG1GC \
  -XX:MaxGCPauseMillis=200 \        # 目标最大 GC 停顿时间（ms）
  -XX:G1HeapRegionSize=8m \         # G1 区域大小
  -XX:InitiatingHeapOccupancyPercent=45 \  # 触发并发标记的堆占用率
  -XX:G1ReservePercent=15 \         # 预留内存防止 to-space 溢出

  # GC 日志（Java 11+ 统一格式）
  -Xlog:gc*:file=/var/log/app/gc.log:time,uptime,level,tags:filecount=10,filesize=50M \

  # OOM 处理
  -XX:+HeapDumpOnOutOfMemoryError \
  -XX:HeapDumpPath=/var/log/app/heapdump.hprof \
  -XX:+ExitOnOutOfMemoryError \      # OOM 后退出（配合 K8s 重启策略）

  # 性能优化
  -XX:+UseStringDeduplication \      # 字符串去重（G1 专属）
  -XX:+OptimizeStringConcat \        # 优化字符串拼接
  -XX:+AlwaysPreTouch \              # 启动时预分配内存（减少首次 GC 延迟）
  -Djava.security.egd=file:/dev/urandom  # 加速随机数生成
```

## 2. GC 策略选型

| GC 策略 | 适用场景 | 最大停顿 | 吞吐量 | 内存效率 |
|---------|---------|---------|--------|---------|
| **G1** | 通用场景（推荐默认） | 可控（~200ms） | 高 | 中等 |
| **ZGC** | 超低延迟（Java 15+） | <10ms | 中等 | 较低 |
| **Shenandoah** | 超低延迟（RedHat） | <10ms | 中等 | 较低 |
| **Parallel** | 吞吐优先（批处理） | 不可控 | 最高 | 高 |

```bash
# 如果需要极致低延迟，使用 ZGC（Java 17+）
java -jar app.jar \
  -Xms4g -Xmx4g \
  -XX:+UseZGC \
  -XX:+ZGenerational \              # Java 21+ 分代 ZGC
  -XX:SoftMaxHeapSize=4g \
  -Xlog:gc*:file=/var/log/app/gc.log:time,uptime,level,tags
```

## 3. GC 日志分析

```text
# 正常 GC 日志示例（G1）
[gc] GC(42) Pause Young (Concurrent Start) (G1 Evacuation Pause) 1024M->256M(4096M) 45.123ms

关键指标：
- 1024M->256M：GC 前 → GC 后的堆使用量
- 4096M：总堆大小
- 45.123ms：GC 停顿时间

告警阈值建议：
- Young GC 停顿 > 100ms：关注
- Full GC 停顿 > 1s：严重
- Full GC 频率 > 1次/小时：排查内存泄漏
```

## 4. JVM 监控

```java
@Component
@Slf4j
public class JvmMonitor {

    @Scheduled(fixedRate = 60000)
    public void report() {
        MemoryMXBean memory = ManagementFactory.getMemoryMXBean();
        MemoryUsage heap = memory.getHeapMemoryUsage();
        MemoryUsage nonHeap = memory.getNonHeapMemoryUsage();

        List<GarbageCollectorMXBean> gcBeans = ManagementFactory.getGarbageCollectorMXBeans();

        log.info("JVM Heap: {}/{} MB ({}%), NonHeap: {} MB",
                heap.getUsed() / 1024 / 1024,
                heap.getMax() / 1024 / 1024,
                heap.getUsed() * 100 / heap.getMax(),
                nonHeap.getUsed() / 1024 / 1024);

        for (GarbageCollectorMXBean gc : gcBeans) {
            log.info("GC [{}]: count={}, time={}ms",
                    gc.getName(), gc.getCollectionCount(), gc.getCollectionTime());
        }
    }
}
```

**踩坑提醒：**

- `-Xms` 和 `-Xmx` 设成一样，避免 JVM 运行时动态扩缩堆大小触发 Full GC。
- 不要迷信「大堆 = 好」，堆越大 Full GC 停顿越长，4-8GB 是多数 Web 应用的甜区。
- 生产环境必须开启 GC 日志和 HeapDump，出了问题没有日志就是盲人摸象。
