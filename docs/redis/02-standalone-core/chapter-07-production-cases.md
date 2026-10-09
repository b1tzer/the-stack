# 单机核心生产案例

> 学完单机核心六章，得到的是一套「现象 → 机制」的判断框架：CPU 为什么突然 100%、为什么每隔十几分钟卡顿一次、为什么宕机重启后起不来、为什么数据莫名消失。本章收集 6 个公开事故或技术复盘，每个案例回答三件事——现象是什么、根因落在哪个知识点、怎么处理和预防。

## 1. 知识地图：单机核心能解释哪些生产问题

6 个案例的根因全部落在前六章的知识点上。先建立映射，再逐个展开：

![单机核心知识点与生产问题映射](/redis/02-standalone-core-chapter-07-production-cases-1.svg)

| 知识点 | 生产问题 | 案例 |
| :-- | :-- | :-- |
| 单线程模型，命令串行执行 | 慢命令阻塞、实例挂起 | [案例一](#case-1) |
| 慢查询日志与命令统计 | 定位「看不见的慢命令」 | [案例二](#case-2) |
| fork 写时复制 + 透明大页 | BGSAVE 卡顿、内存暴涨 | [案例三](#case-3) |
| AOF 追加写与损坏修复 | 宕机重启失败、数据截断 | [案例四](#case-4) |
| 惰性删除 + 定期删除 | 集中过期 CPU 飙升 | [案例五](#case-5) |
| maxmemory 与淘汰策略 | 淘汰误伤、数据丢失 | [案例六](#case-6) |

## 2. 案例一：AWS MemoryDB 被 KEYS 阻塞，整个实例挂起 {#case-1}

### 2.1 现象

Ray 项目用 AWS MemoryDB（单节点、单分片）作为 GCS（全局控制服务）的外部存储，与集群部署在同一 VPC。稳定运行数周后，MemoryDB 突然开始拒绝连接，所有 head 节点在连接时崩溃。

AWS 支持排查后给出结论：存在长时运行的 `KEYS` 命令阻塞了单线程引擎，实例长时间无法处理任何连接。

### 2.2 根因

根因在 Redis 的单线程模型（见[线程模型 §1](./chapter-01-thread-model.md#single-thread)）：命令执行是单线程的，同一时刻只有一个命令在执行。

`KEYS pattern` 是 O(N) 全量扫描——遍历整个键空间做模式匹配，N 是键的总数。键数量一大，这一条命令就占住唯一的执行线程，其余所有命令——包括建立新连接——全部排队等待，对外表现就是「拒绝连接」。这正是[线程模型 §1](./chapter-01-thread-model.md#single-thread) 点名的边界：「慢命令会阻塞所有其他请求」。

这个案例由 AWS 官方支持确认，是「`KEYS` 阻塞单线程」这一根因的权威佐证。

### 2.3 处理与预防

- 用 `SCAN` 分批迭代替代 `KEYS`；大集合用 `SSCAN` / `HSCAN`，禁止全量 `SMEMBERS` / `HGETALL`。
- `rename-command KEYS ""` 禁用危险命令，或从代码里彻底移除 `KEYS` 调用。
- 监控 `SLOWLOG` 与 `INFO commandstats` 的 `cmdstat_keys`，生产环境出现非零调用即为红旗。

## 3. 案例二：慢查询日志定位「看不见的慢命令」 {#case-2}

### 3.1 现象

周一早晨，大量用户反馈页面加载极慢。登录服务器查看，Redis 调用时间严重超时，高速缓存反而成了短板。监控显示 CPU 飙到 100%，QPS 从 1000 多升到 6000，连接数从 0 升到 3000——都远低于极限值，却出现命令排队积压。

关键疑点：应用层根本没有暴露 `KEYS` 接口，业务代码里找不到慢命令的来源。

### 3.2 根因

排查落在[命令执行与 RESP §5](./chapter-02-command-resp.md#slowlog) 的慢查询日志上，它是排查性能问题的第一手资料。

第一步看 `SLOWLOG GET`，发现慢查询前十名全部是 `keys *`，单条耗时严重。第二步看 `INFO commandstats`，复盘记录的 `usec_per_call` 为 3740 微秒，即约 3.74 毫秒——仍明显高于同一实例上的其他命令。

两个信息结合，定位到问题不在本应用：是另一个应用配置错误，把连接指到了这台 Redis，用 `keys *` 大量爬数据。修正该配置后，问题解决。

这个案例的价值在于展示**定位手段**：慢查询日志记录了「执行耗时超过阈值」的命令，`INFO commandstats` 提供了「每个命令类型的累计调用次数与耗时」，二者配合能在不翻业务代码的情况下，把一个「看不见来源」的慢命令揪出来。

### 3.3 处理与预防

- 根据业务延迟目标和命令分布设置 `slowlog-log-slower-than`，并为 `slowlog-max-len` 留出足够容量；示例值需要通过压测和历史数据校准。
- 监控 `cmdstat_*` 的 `usec_per_call` 趋势，命令耗时漂移在阻塞前就能被看到。
- 高危命令（`KEYS`、`FLUSHALL`、`MONITOR`）用 `rename-command` 或 ACL 禁用。

## 4. 案例三：BGSAVE 的 fork 卡顿与 THP 内存放大 {#case-3}

### 4.1 现象

两类现象，同一个机制的两个侧面，常被混为一谈。

**侧面一：周期性卡顿。** 某 Redis 主从（4.0 版本），开发反馈每隔 10 多分钟出现一次卡顿，普通调用耗时约 1 秒后自动恢复，get/set 都受影响。查 QPS、CPU 无异常，`slowlog` 没有吻合时间点的慢查询，`evicted_keys` 一直是 0。

**侧面二：BGSAVE 期间内存暴涨。** 一个 30GB 的单节点，BGSAVE 触发后 `rdb_last_cow_size` 飙升到 20-25GB，系统总内存从 30GB 涨到 55GB，触发 swap，P99 延迟从 1ms 飙到 100ms+。

### 4.2 根因

两个侧面都源于 [持久化：fork 与写时复制](./chapter-05-persistence.md#fork-cow) 的机制。

**侧面一是 fork 本身的阻塞。** BGSAVE 通过 `fork()` 创建子进程，fork 要复制父进程的页表，页表大小随内存规模线性增长。那个 4.0 实例 RSS 已达 16GB、页表 33MB，`latest_fork_usec` 实测 1014778 微秒——约 1 秒，正好与每 15 分钟一次 BGSAVE、应用每 10 多分钟一次卡顿吻合。fork 期间主线程停顿，所有请求排队。是否达到严重程度应以业务延迟预算判断，而不是套用统一毫秒阈值（见 [持久化：查看 fork 耗时](./chapter-05-persistence.md#fork-usec)）。

**侧面二是透明大页（THP）对 COW 的放大。** THP 开启时内核以 2MB 大页分配内存。fork 后父进程即使只修改少量字节，也可能复制整个 2MB 页，而不是普通 4KB 页——按页大小计算粒度相差 512 倍。写越频繁，子进程复制越多，内存越逼近翻倍。这正是 [持久化：fork 的代价](./chapter-05-persistence.md#fork-cost) 点名的透明大页风险。

### 4.3 处理与预防

| 现象 | 手段 |
| :-- | :-- |
| fork 耗时高（卡顿） | 按实测页表和延迟预算拆分实例；错开写入高峰；评估副本分担持久化任务 |
| THP 放大 COW（内存暴涨） | `echo never > /sys/kernel/mm/transparent_hugepage/enabled` 并持久化 |

- 监控 `latest_fork_usec` 的趋势和分位变化，告警阈值由业务延迟预算与历史基线确定。
- 确认 `vm.overcommit_memory=1`，否则 fork 可能因内存保守校验而失败。
- 根据写入率、数据规模和 fork 期间的 COW 实测预留内存，不使用固定比例代替容量测试。

## 5. 案例四：Cisco AOF 损坏，redis 服务无法启动 {#case-4}

### 5.1 现象

Cisco CyberVision Center 的 `redis.service` 进入 failed 状态，连带 `marmotd`、`backend` 等服务一起宕机。日志报：

```txt
Bad file format reading the append only file: make a backup of your AOF file, then use ./redis-check-aof --fix <filename>
```

### 5.2 根因

AOF 记录状态变化（见[持久化：AOF 原理](./chapter-05-persistence.md#aof-principle)）。宕机或磁盘异常发生在「命令写到一半」时，AOF 文件末尾会残留一条不完整的命令。

Redis 启动时先校验 AOF 完整性，发现格式错误就**拒绝加载**、进程退出——宁可起不来，也不服务一份不一致的数据。这就是[持久化：文件损坏修复](./chapter-05-persistence.md#aof-repair) 讲的场景。

这个案例由 Cisco 官方支持文档记录，与国内常见的「磁盘故障 → AOF 损坏」根因一致，但给出了完整的官方修复链路。

### 5.3 处理与预防

处理顺序必须「先备份、再修复」：

```bash
cp /data/redis/appendonly.aof /data/redis/appendonly.aof.bak   # 先备份
redis-check-aof --fix /data/redis/appendonly.aof                # 截断损坏点之后
```

修复原理是扫描文件、找到第一个格式错误的位置、截断其后所有内容，因此**损坏点之后的数据会丢失**。

- `appendfsync everysec` 通常提供秒级恢复点，比 `no` 更易规划，但实际丢失范围仍取决于故障类型、文件系统、磁盘和恢复流程。
- 开启混合持久化（`aof-use-rdb-preamble yes`），恢复更快。
- 持久化文件定期异地备份；主从 + 哨兵做冗余，不把持久化当唯一保底。

## 6. 案例五：整点过期风暴，CPU 飙升 {#case-5}

### 6.1 现象

2023 年 8 月 16 日 00:00，Redis 集群 CPU 使用率超过 75%，持续报警数分钟。监控显示业务流量和 QPS 与前一天持平，没有变化；但命令分布监控里出现大量 `unlink` 命令，时间点与 CPU 飙升完全吻合。

### 6.2 根因

大量数据在 00:00 这个时间点同时过期，触发了[过期与淘汰 §1.3](./chapter-06-expiration-eviction.md#active-expire) 的定期删除风暴。

Redis 的过期清理靠「惰性删除 + 定期删除」配合。定期删除在**主线程**里执行：随机抽样 20 个键，删掉已过期的；默认 effort 下，残留比例仍高于 10% 就继续扫描，同时受 CPU 时间预算约束。当海量键集中过期时，抽样几乎每轮都能命中过期键，清理循环持续占用主线程，批量 `unlink` 命令集中产生，CPU 被清理任务占满，正常读写被延迟。

这正是[过期与淘汰 §1.6](./chapter-06-expiration-eviction.md#production-notes) 点名的「大量键同时过期，触发定期删除风暴，CPU 飙升」。

### 6.3 处理与预防

- **TTL 加随机偏移**：批量写缓存时由客户端或 Lua 计算随机秒数，再把结果作为 `EXPIRE key seconds` 的参数，避免整点集中过期。
- Redis 7.0+ 开启 `lazyfree-lazy-expire yes`，让过期键的内存释放异步化，避免主线程卡在删除上。
- 调 `active-expire-effort` 需谨慎：调高提升扫描强度，但会持续占用更多 CPU。
- 监控 `expired_keys` 速率与 `expired_stale_perc`，集中过期前就能预警。

## 7. 案例六：volatile-lru 误伤，数据莫名消失 {#case-6}

### 7.1 现象

2024 年 10 月，某团队部署了新的淘汰策略配置（本意是 `volatile-ttl`，脚本里误写成了 `volatile-lru`）。当天流量因营销活动激增 300%，内存占用冲到 98%，Redis 开始淘汰键。47 秒内，12.7GB 活跃用户会话数据被清空，1023 名付费用户被意外登出，产生 4.2 万美元的 SLA 赔偿。

### 7.2 根因

根因是[过期与淘汰 §2.2](./chapter-06-expiration-eviction.md#eviction-policies) 的淘汰策略选错，叠加 LRU 算法本身的缺陷（见[过期与淘汰 §2.5](./chapter-06-expiration-eviction.md#lru-vs-lfu)）。

`volatile-lru` 的语义是「只在**有 TTL 的键**里淘汰最近最少使用的」。会话数据设了很长的 TTL（数天），本不该被快速清空。但 LRU 只看「最近一次访问时间」，不看「剩余 TTL」也不看「访问频率」：写尖峰时内存瞬间打满，一个「TTL 还剩 24 小时、但 10 分钟没被访问」的会话键，会被优先于「TTL 只剩 1 秒、但刚被访问」的键淘汰。

[过期与淘汰 §2.5](./chapter-06-expiration-eviction.md#lru-vs-lfu) 已经点出这个缺陷：LRU 会把「偶然访问过的键」误判为「新」的，反之也会把「暂时没被访问但还重要」的键误判为「旧」的。配置一旦选错，淘汰就变成了对活跃数据的批量误删。

### 7.3 处理与预防

- 缓存数据与不可丢的永久数据**分开部署**：缓存实例用 `allkeys-lru` / `allkeys-lfu`，永久数据实例用 `noeviction`。
- 单一实例混用时要明确 `volatile-*` 的范围：只给「可丢」的键设 TTL，永久数据不设 TTL。
- 需要按剩余时间淘汰时用 `volatile-ttl`，别和 `volatile-lru` 混。
- 淘汰策略变更走配置评审 + 灰度验证，淘汰行为在低负载下从不触发，容易漏测。
- 关键数据做持久化 + 定期备份，淘汰造成的数据丢失无法回滚。

## 8. 小结与检查清单

6 个案例的共同点：问题不在 Redis 本身，而在「误用了机制」——选错了命令、漏看了指标、忽略了内核参数、配错了策略。

| 检查项 | 说明 |
| :-- | :-- |
| 禁用 `KEYS` 等 O(N) 命令 | 用 `SCAN` 分批替代 |
| 配好慢查询日志并监控 | 慢命令在阻塞前就被发现 |
| 评估透明大页（THP）配置 | 避免 2MB 页粒度放大 fork/COW 写入 |
| 监控 `latest_fork_usec` | 结合业务延迟预算识别 fork 对请求的影响 |
| 持久化前先备份再修复 | `redis-check-aof --fix` 会截断数据 |
| TTL 加随机偏移 | 避免整点过期风暴 |
| 淘汰策略与数据分级匹配 | 可丢的用 `allkeys-*`，不可丢的分开部署 |

## 9. 参考资料

除官方文档、状态页和 issue 外，下列链接属于二手复盘或社区文章；文中的精确数字以原始材料为准，不应视为 Redis 官方基准。

- [Long-running redis KEYS command caused external MemoryDB storage to hang](https://github.com/ray-project/ray/issues/32537)（案例一，AWS MemoryDB）
- [记一次线上 Redis 高负载排查经历](https://blog.csdn.net/weixin_36380516/article/details/112386620)（案例二）
- [故障分析 | bgsave 导致 redis 定期卡顿案例一则](https://cloud.tencent.com/developer/article/2008586)（案例三，爱可生开源社区）
- [fork() 的致命陷阱：被 THP 放大 512 倍的 COW 性能黑洞](https://blog.csdn.net/qq_26134615/article/details/162727542)（案例三）
- [Troubleshoot Redis Service Failure](https://www.cisco.com/c/en/us/support/docs/security/cyber-vision/220709-troubleshoot-redis-service-failure.html)（案例四，Cisco）
- [Redis 大量数据集中过期导致 CPU 使用率高原理分析](http://weikeqin.com/2024/02/24/redis-data-expiration-resulting-in-high-cpu-usage/)（案例五）
- [How Midnight Key Expiration Spiked Redis CPU and the Optimizations That Fixed It](https://www.besthub.dev/articles/how-midnight-key-expiration-spiked-redis-cpu-and-the-optimizations-that-fixed-it-6086107821bd)（案例五）
- [Postmortem: How a Redis 7.4 Eviction Policy Caused Data Loss for 1k Users](https://www.johal.in/postmortem-redis-74-eviction-policy-caused-data-loss)（案例六）
- [Redis Volatile-lru Eviction Causing Unexpected Key Loss During Write Spikes](https://companions.bot/posts/46a99d99-dddd-4eb3-bd69-3cd3e43b51b3)（案例六）
