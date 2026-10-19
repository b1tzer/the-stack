# JVM 调优

## 1. JVM 内存配置

### 1.1 堆内存设置

```ini
# jvm.options.d/heap.options（自定义文件位置随安装方式变化）
-Xms16g
-Xmx16g
```

| 规则 | 说明 |
| :-- | :-- |
| `-Xms` = `-Xmx` | 避免堆内存动态调整 |
| ≤ 可用内存的 50% | 留给文件系统缓存 |
| 压缩指针阈值需验证 | 见 §1.2，26GB 多数系统安全 |

### 1.2 压缩指针与堆大小

压缩指针（Compressed Oops）在堆较小时把 64 位对象引用压缩为 32 位，降低指针开销、提升缓存效率。但压缩指针的生效边界不是固定的 32GB，它取决于 JVM 实现、堆布局与对象对齐。

```txt
Elasticsearch 官方经验值：
- 26GB 在大多数系统上是安全值
- 部分系统可达到 30GB
```

以运行时实际状态为准，用以下命令验证：

```json
GET /_nodes/_all/jvm
// 检查 jvm.using_compressed_ordinary_object_pointers 是否为 true
```

常见类比「32GB 堆（仍启用压缩指针）≈ 48GB 堆（普通指针）的实际可用内存」，仅用于直观理解指针开销，实际效果因 JVM 与堆布局而异，不能替代上面的运行时验证。

## 2. GC 策略

### 2.1 G1GC（推荐）

```ini
# Elasticsearch 默认已启用 G1GC，通常无需手工指定
-XX:+UseG1GC
# MaxGCPauseMillis 是目标暂停时间，不是保证值
-XX:MaxGCPauseMillis=200
```

手工调整参数应基于 GC 日志与压测证据，而非直接套用固定值。

### 2.2 GC 日志

Elasticsearch 默认已开启 GC 日志。仅当需要自定义路径或轮转策略时，才在 `jvm.options.d/` 添加下面的配置，否则自定义配置会与默认日志同时生效，造成重复输出。

```ini
# 自定义路径需确保目录存在且进程有写入权限
-Xlog:gc*,gc+age=trace,safepoint:file=/var/log/elasticsearch/gc.log:utctime,pid,tags:filecount=32,filesize=64m
```

## 3. 内存使用分析

```json
// 查看 JVM 统计信息（堆使用、GC 次数与耗时）
GET /_nodes/stats/jvm

// 查看各索引磁盘存储大小（store.size 是磁盘占用，非内存占用）
GET /_cat/indices?v&s=store.size:desc&h=index,store.size,pri.store.size
```

`/_nodes/stats/jvm` 返回的是 JVM 运行统计，不是 GC 日志内容；GC 日志需查看 §2.2 配置的文件。

### 3.1 内存组成

| 组成部分 | 说明 | 建议 |
| :-- | :-- | :-- |
| **JVM 堆** | 索引缓冲、查询缓存等 | 通常不超过可用内存的 50%，阈值见 §1.2 |
| **文件系统缓存** | OS 缓存 Segment 文件 | 占用剩余可用内存 |
| **原生内存（堆外）** | 内存映射文件、直接内存等 | 与堆分开核算，部分由 JVM 管理 |
| **网络缓冲** | 网络 IO 缓冲 | 自动管理 |

## 4. 常见内存问题

### 4.1 堆内存不足

```txt
症状：频繁 Full GC，查询/写入超时
可能原因：分片过多、查询结果集过大、聚合消耗内存
解决：
  1. 谨慎增大堆内存（先验证压缩指针状态，见 §1.2）
  2. 减少分片数量
  3. 优化查询（避免深度分页）
  4. 使用 filter context 减少评分计算
```

### 4.2 文件系统缓存不足

```txt
症状：查询延迟高，IO 等待时间长
可能原因：堆内存过大，挤压了文件系统缓存
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
# 传统 Linux 服务方式 /etc/security/limits.conf
elasticsearch soft memlock unlimited
elasticsearch hard memlock unlimited
# 容器或 systemd 环境需按对应进程限制配置
```

防止 JVM 堆被 swap 到磁盘，严重影响性能。设置后需确认启动日志中 memory lock 检查通过，而非仅以配置文件存在为成功依据。

## 6. 最佳实践

- 堆内存通常不超过可用内存的 50%，压缩指针阈值需验证（见 §1.2）
- `-Xms` 和 `-Xmx` 设为相同值
- 使用 G1GC 垃圾收集器，手工参数基于证据调整
- GC 日志默认已开启，必要时再自定义
- 启用 `memory_lock` 防止 swap，并确认检查通过
- 监控 GC 暂停时间，超过 1s 作为排查触发条件
- 预留足够的内存给文件系统缓存
