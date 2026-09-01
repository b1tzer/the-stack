# 线上问题案例集

> 学完高可用三章，得到的是一套「现象 → 机制」的判断框架：为什么网络抖动一下服务就全挂、为什么 failover 明明成功了反而更糟、为什么一个节点的迁移能拖垮整个平台。这些看似玄学的线上现象，都能在复制同步、故障转移、集群机制里找到确定解释。本章收集 3 个国外知名企业的公开事故，每个案例回答三件事——现象是什么、根因落在哪个知识点、怎么处理和预防。

## 1. 知识地图：高可用能解释哪些生产问题

3 个案例的根因全部落在前三章的知识点上。先建立映射，再逐个展开：

![高可用知识点与生产问题映射](/redis/04-high-availability-chapter-04-production-cases-1.svg)

| 知识点 | 生产问题 | 案例 |
| :-- | :-- | :-- |
| 全量同步（[主从复制 §2](./chapter-01-replication.md#full-sync)） | 网络分区恢复后全量重同步压垮主库 | [案例一](#case-1) |
| 故障转移（[哨兵 §4](./chapter-02-sentinel.md#failover) / [集群 §4.2](./chapter-03-cluster.md#cluster-failover)） | failover 后无 writable primary，全局不可写 | [案例二](#case-2) |
| 故障转移缺陷（[哨兵 §4](./chapter-02-sentinel.md#failover)） | 节点迁移触发 failover 缺陷，级联故障 | [案例三](#case-3) |

## 2. 案例一：Twilio 主从网络分区，全量重同步压垮主库 {#case-1}

### 2.1 现象

2013 年 7 月 18 日，Twilio 的计费系统出现故障。系统用 Redis 存储账户余额，一次网络分区把 Redis 主库与所有从库隔离。

Twilio 没有提升新主库，写请求仍打到原主库——这本是保一致性的正确选择。但当主库重新对从库可见时，所有从库同时发起全量重同步（full resync），瞬间压垮主库，依赖 Redis 的服务全部失败。

运维重启主库以应对高负载。重启后，主库加载了一份错误的配置文件，进入只读模式。所有账户余额显示为 0 且只读，每次 API 调用都触发自动充值，导致 1.1% 的客户在 40 分钟内被重复扣费。

### 2.2 根因

两个机制叠加，缺一不可。

**全量重同步风暴**（见[主从复制 §5.2](./chapter-01-replication.md#full-sync-storm)）。网络分区恢复后，所有从库的复制偏移量都已落后，同时向主库发起全量同步。全量同步要主库 fork 子进程生成 RDB 并逐个发送，N 个从库就是 N 份 RDB 同时生成与传输，主库既要处理正常请求又要承担 N 倍磁盘 IO 与网络带宽，瞬间过载。这正是[主从复制 §2](./chapter-01-replication.md#full-sync) 讲的全量同步的 fork 代价被放大。

**重启加载错误配置**。主库重启后进入只读模式，业务层的自动充值逻辑把「余额 0 + 只读」误判为「需要充值」，反复扣款。这属于配置管理与业务侧幂等缺失，不是 Redis 本身的故障。

### 2.3 处理与预防

- 限制同时全量同步的从库数（哨兵 `parallel-syncs`），让重同步错峰执行，避免风暴。
- 调大复制缓冲区（见[主从复制 §2.3](./chapter-01-replication.md#repl-buffer)），减少全量同步的发生概率。
- 配置文件版本化、变更走审批，重启前校验加载的是正确配置。
- 业务侧的自动充值要有幂等与熔断，不能把「只读」或「余额 0」误判为「余额不足」。

## 3. 案例二：GitHub Actions 集群 failover 后无 writable primary {#case-2}

### 3.1 现象

2026 年 3 月 5 日，GitHub Actions 出现服务降级。负责 workflow 任务队列协调的 Redis 集群做基础设施更新时，负载均衡器被引入错误配置，内部流量被路由到错误主机。

随后 Redis 主节点发生自动 failover，failover「技术上完成」了，但一个潜伏的配置缺陷让集群在 failover 后没有任何可写的主节点。结果 95% 的 workflow 无法在 5 分钟内启动，平均延迟 30 分钟，10% 直接以基础设施错误失败。

### 3.2 根因

根因是[故障转移 §4](./chapter-02-sentinel.md#failover) 与[集群模式 §4.2](./chapter-03-cluster.md#cluster-failover) 讲到的 failover 路径里的潜伏缺陷。

failover 本身完成了，但完成的集群状态没有可写主节点——写请求全部失败。这是「故障转移路径里的 bug」：正常路径天天测，故障转移路径一年才走一次，配置从未在真实 failover 状态下验证过。

次要因素：单一 Redis 集群承担所有 Actions 任务队列协调，没有按 workload 分片，一处失败即全局瘫痪。复制滞后也让 failover 无法干净完成，从库提升后继承的是不完整的队列状态。

### 3.3 处理与预防

- failover 路径要在生产级负载下演练，不能只在安静维护窗口测试。
- 队列按 runner 类型、组织层级分片，单分片失败只降级部分容量，而非 95% 全部阻塞。
- 加死信队列，失败的分发任务落盘重试，而不是静默丢弃。
- 预留足够的从库 headroom，让 failover 在负载下也能完成，而非只适用于空闲状态。

## 4. 案例三：Discord 节点迁移触发 failover 缺陷，级联故障 {#case-3}

### 4.1 现象

2017 年 10 月 13 日 14:01，Google Cloud Platform 自动迁移了 Discord API 服务所用高可用集群中的一个 Redis 主节点。迁移导致该节点错误下线，迫使集群 rebalance，触发了 Discord API 处理 Redis failover 的已知缺陷。

解决这个局部故障后，其他服务上未被注意的问题又引发了实时系统的级联故障。最终工程团队被迫完全重启服务，数百万客户端在 20 分钟内重连。

### 4.2 根因

根因是[故障转移 §4](./chapter-02-sentinel.md#failover) 的 failover 处理缺陷。

主节点被云平台自动迁移、错误下线，集群进入 rebalance，failover 代码却有一个团队早就知道、但一直排在「未来几周」的缺陷，无法正确处理新主节点。局部故障由此放大。

另一个被此次故障暴露的，是一个此前未知的缓存 misconfiguration，让部分节点的行为进一步恶化，最终把局部 API 故障拖成整个实时系统的级联失败。

### 4.3 处理与预防

- 已知的 failover 缺陷要提升修复优先级，不能长期挂在「未来几周」。
- 加强 failover 相关信号的监控与告警，级联发生前留出排查时间。
- 定期审查配置（尤其是边缘缓存规则），避免被突发故障连带暴露。

## 5. 小结与检查清单

3 个案例的共同点：问题不在 Redis 高可用机制本身，而在 failover 路径没被验证、全量同步没被限流、配置变更没被管控。

| 检查项 | 说明 |
| :-- | :-- |
| 限制同时全量同步的从库数 | 避免网络恢复后的重同步风暴 |
| failover 路径在负载下演练 | 不在安静窗口测试 |
| 集群按 workload 分片 | 单点失败不放大为全局瘫痪 |
| 配置文件版本化 + 变更审批 | 重启不加载错误配置 |
| 业务侧幂等与熔断 | 「只读」不被误判为「余额不足」 |

## 6. 参考资料

- [The Network is Reliable](https://queue.acm.org/detail.cfm?id=2655736)（案例一，Twilio，Kyle Kingsbury）
- [Multiple services are affected, service degradation](https://www.githubstatus.com/incidents/g5gnt5l5hf56)（案例二，GitHub）
- [Unavailable Guilds & Connection Issues](https://discordstatus.com/incidents/qk9cdgnqnhcn)（案例三，Discord）
