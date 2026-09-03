# JVM 调优

## 1. JVM 内存配置

### 1.1 堆内存设置

```ini
# jvm.options
-Xms16g
-Xmx16g
```

| 规则 | 说明 |
| :-- | :-- |
| `-Xms` = `-Xmx` | 避免堆内存动态调整 |
| ≤ 物理内存的 50% | 留给文件系统缓存 |
| ≤ 32GB | 超过 32GB 压缩指针失效 |

### 1.2 为什么不超过 32GB

```txt
< 32GB：使用压缩指针（Compressed Oops），指针占 4 字节
> 32GB：使用普通指针，指针占 8 字节

32GB 堆 + 压缩指针 ≈ 48GB 堆 + 普通指针（实际可用内存相近）
```

## 2. GC 策略

### 2.1 G1GC（推荐）

```ini
# jvm.options
-XX:+UseG1GC
-XX:G1HeapRegionSize=4m
-XX:InitiatingHeapOccupancyPercent=30
-XX:MaxGCPauseMillis=200
```

### 2.2 GC 日志

```ini
-Xlog:gc*,gc+age=trace,safepoint:file=/var/log/elasticsearch/gc.log:utctime,pid,tags:filecount=32,filesize=64m
```

## 3. 内存使用分析

```json
// 查看 JVM 内存使用
GET /_nodes/stats/jvm

// 查看各索引内存使用
GET /_cat/indices?v&s=store.size:desc&h=index,store.size,pri.store.size
```

### 3.1 内存组成

| 组成部分 | 说明 | 建议 |
| :-- | :-- | :-- |
| **JVM 堆** | 索引缓冲、查询缓存等 | 物理内存的 50%，≤ 32GB |
| **文件系统缓存** | OS 缓存 Segment 文件 | 物理内存的 50% |
| **Lucene 代码** | 堆外内存 | 自动管理 |
| **网络缓冲** | 网络 IO 缓冲 | 自动管理 |

## 4. 常见内存问题

### 4.1 堆内存不足

```txt
症状：频繁 Full GC，查询/写入超时
原因：分片过多、查询结果集过大、聚合消耗内存
解决：
  1. 增加堆内存（不超过 32GB）
  2. 减少分片数量
  3. 优化查询（避免深度分页）
  4. 使用 filter context 减少评分计算
```

### 4.2 文件系统缓存不足

```txt
症状：查询延迟高，IO 等待时间长
原因：堆内存过大，挤压了文件系统缓存
解决：
  1. 减小堆内存，留给 OS 更多缓存
  2. 使用 SSD 提升 IO 性能
  3. 减少索引大小（压缩、归档旧数据）
```

## 5. 内存锁定

```yaml
# elasticsearch.yml
bootstrap.memory_lock: true
```

```bash
# /etc/security/limits.conf
elasticsearch soft memlock unlimited
elasticsearch hard memlock unlimited
```

防止 JVM 堆被 swap 到磁盘，严重影响性能。

## 6. 最佳实践

- 堆内存设置为物理内存的 50%，不超过 32GB
- `-Xms` 和 `-Xmx` 设为相同值
- 使用 G1GC 垃圾收集器
- 开启 GC 日志用于监控
- 启用 `memory_lock` 防止 swap
- 监控 GC 暂停时间，超过 1s 需要关注
- 预留足够的内存给文件系统缓存
