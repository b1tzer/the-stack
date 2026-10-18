# Redis 概览与定位

## 1. 什么是 Redis

Redis（Remote Dictionary Server）是一个开源的内存数据结构存储系统，以键值对组织数据，主要在内存中完成读写，同时支持 RDB 快照与 AOF 日志持久化。它的本质是一个**数据结构服务器**：value 不只是普通字符串，而可以是 String、Hash、List、Set、ZSet 等多种数据结构，并针对每种结构提供原子操作命令。

```txt
key  →  value（value 可以是多种数据结构）

"user:123"        →  "{name:'张三', age:25}"     String
"user:123:info"   →  {name, age, email}          Hash
"news:list"       →  [文章3, 文章2, 文章1]         List
"user:123:tags"   →  {Java, 后端, 分布式}          Set
"leaderboard"     →  {张三:100, 李四:200}          ZSet
```

Redis 官方对它的定位是「内存数据结构服务器」，广泛用作缓存、消息队列、分布式锁、排行榜等。它常被放在 MySQL 这类持久化数据库之前，利用内存的高速访问缓解数据库压力。

## 2. 核心特性

| 特性 | 说明 |
| :-- | :-- |
| 访问性能 | 主要在内存执行，吞吐和延迟还受命令复杂度、网络、持久化配置与客户端使用方式影响 |
| 数据结构丰富 | 5 种基础类型，以及 BitMap、HyperLogLog、Geo、Stream 等高级能力，覆盖多数业务场景 |
| 原子性 | 单条命令原子执行；多命令要整体原子时需事务或 Lua 脚本，仅靠应用层依次执行不保证原子性 |
| 持久化 | 提供 RDB 快照与 AOF 日志两种持久化方式 |
| 高可用与扩展 | 主从复制负责数据复制，Sentinel 负责监控与故障转移，Cluster 负责数据分片及分片内故障转移 |
| 功能扩展 | 支持事务、Lua 脚本、发布订阅、Pipeline 等 |

## 3. 适用场景与反模式

**适合的场景**：

| 场景 | 说明 |
| :-- | :-- |
| 缓存 | 热点数据缓存，缓解数据库压力 |
| 排行榜 | ZSet 按 score 排序，适合按分值排序的场景 |
| 计数器 | INCR 等命令原子更新；涉及限额判断时需把判断与更新作为整体设计 |
| 分布式锁 | SET key token NX PX 原子加锁并设过期时间；释放需校验持有标识，避免删掉他人新锁 |
| 消息队列 | List 阻塞弹出、Stream 消费者组 |
| 会话存储 | 共享 Session，TTL 自动过期 |

**反模式**（不该把 Redis 当作）：

| 反模式 | 原因 |
| :-- | :-- |
| 关系型主库替代 | 内存容量有限、单位成本高，不适合无条件替代关系型数据库 |
| 强一致存储 | 异步复制与故障切换可能丢失已确认写入，无法直接提供线性一致性 |
| 大文件存储 | 大对象增加内存与网络开销，部分操作可能阻塞；文件内容适合放对象存储，Redis 只存引用 |
| 关系型查询 | 无 SQL、无复杂关联查询能力 |

## 4. 与 Memcached 对比

Memcached 是另一款常见的内存缓存，二者常被放在一起比较：

| 对比项 | Redis | Memcached |
| :-- | :-- | :-- |
| 数据类型 | 5 种基础 + 4 种高级 | 仅 String |
| 持久化 | 支持 RDB/AOF | 不支持 |
| 集群 | 原生支持主从/哨兵/集群 | 需客户端实现分片 |
| 线程模型 | 命令执行单线程，网络 I/O 支持多线程 | 多线程处理客户端请求 |
| 功能 | 事务、Lua、订阅、Pipeline | 无 |

选择标准：需要丰富数据结构、持久化、高可用时选 Redis；仅做简单 KV 缓存、且对数据结构和持久化无需求时，Memcached 才进入考虑范围。

### 4.1 性能对比的方法

Redis 自带 `redis-benchmark` 工具，模拟 N 个客户端并发发送 M 个请求。测试结果随版本、硬件、网络、持久化配置、客户端数和 pipeline 批量大小变化，引用时必须同时记录这些条件。

直接对比不同系统的单一基准数字意义有限：客户端实现、协议、请求并发、pipeline 和数据分布都会影响结果，架构差异也不能直接推出特定工作负载下的性能优劣。

> 性能数据高度依赖硬件、网络、版本与测试方法。严谨选型应基于与业务接近的读写比例、数据分布和并发模型复测，并保留完整实验条件，而非引用单一横评数字。

## 5. 版本演进与许可证

### 5.1 发版节奏

Redis 计划每年发布一个主版本，每个主版本约半年后跟一个次版本。最新的稳定版本获得完整支持，此前的次版本和上一个主版本仅做维护性修补（关键 bug 与安全漏洞）。发布与维护策略可能调整，生产选型应以官方发布说明和支持政策为准，不单凭版本号推断支持状态。

| 版本 | 发布时间 | 标志性变化 |
| :-- | :-- | :-- |
| 1.0 | 2009 | 首次发布，基础数据类型 |
| 2.6 | 2012 | Lua 脚本 |
| 3.0 | 2015 | Redis Cluster 分片 |
| 4.0 | 2017 | 模块系统、混合持久化 |
| 5.0 | 2018 | Streams 数据类型 |
| 6.0 | 2020 | RESP3、ACL、多线程 I/O |
| 7.0 | 2022 | Functions、Multi-part AOF |
| 8.0 | 2025 | 模块并入核心、Vector Set |

本书以 **Redis 7.4.11** 为主要验证版本，并保留 6.0、7.0 和 7.2 中仍然适用的机制说明。6.0 起支持多线程网络 IO（命令执行仍单线程），7.0 引入 Functions、MP-AOF。自 7.4 起 Redis 切换为 RSALv2 + SSPLv1 双协议，社区出现 Valkey 等开源分支；使用 8.x 前应核对新特性、配置默认值和许可证变化。

### 5.2 版本与许可证

2024 年起 Redis 的许可证经历了一次影响深远的变化，不同版本范围对应不同许可证。下表概括 Redis 官方发行版的许可证变化，第三方发行版与托管服务可能有不同条款：

| 版本范围 | 许可证 |
| :-- | :-- |
| ≤ 7.2 | BSD-3-Clause |
| 7.4 ~ 7.8 | RSALv2 / SSPLv1 二选一 |
| ≥ 8.0 | RSALv2 / SSPLv1 / AGPLv3 三选一 |

## 6. 项目起源与发展

Redis 的起点是一个真实的生产瓶颈，而非预先规划的产品。

### 6.1 起因：LLOOGG 的性能瓶颈

2009 年，意大利西西里岛的工程师 Salvatore Sanfilippo（网名 antirez）在为自己的创业项目 **LLOOGG** 做实时网站访问统计。LLOOGG 为每个接入的网站维护一个「最新 N 条访问记录」列表：新访问进来时把记录推入列表尾部，列表超长时再把最早的记录弹出。

这套「推入 + 弹出」操作当时跑在 MySQL 上。LLOOGG 的访问量越大、要维护的列表越多，这套基于磁盘存储的实现逐渐难以满足实时性能要求。当时 LLOOGG 没有盈利模式，antirez 不愿直接升级服务器，于是决定自己写一个内存数据库原型：以列表为基本类型，对列表两端做 O(1) 的推入和弹出，数据放内存而非硬盘。

### 6.2 从 Tcl 原型到 C 实现

antirez 先用 Tcl 写了一个约 300 行的原型验证想法，随后用 C 重写，并加上基于子进程的持久化——这就是后来 RDB 快照的思路。2009 年 2 月，项目以 **Redis**（REmote DIctionary Server，远程字典服务）之名开源，并在 Hacker News 上发布。

> Redis 默认端口 6379 并非随意挑选：在老式电话键盘上，6379 对应「MERZ」，即 antirez 创业公司 Merzia 的前四个字母。

### 6.3 从一人维护到公司赞助

Redis 前 11 年基本由 antirez 一人主导，他是事实上的 BDFL（终身仁慈独裁者）——功能的取舍、bug 的修复方式、设计的权衡主要由他拍板。另一位核心贡献者 Pieter Noordhuis 也深度参与开发。

随着项目流行，Redis 的开发获得了一系列公司赞助：

| 时间 | 赞助方 | 说明 |
| :-- | :-- | :-- |
| 2010 ~ 2013 | VMware | antirez 与 Pieter Noordhuis 先后加入，全职开发 |
| 2013 ~ 2015 | Pivotal | VMware 分拆出的公司继续赞助 |
| 2015 起 | Redis Labs（后更名 Redis） | 商业化公司接手赞助 |

早期采用者包括 GitHub（用它做 Resque 队列）、Instagram（存储数亿个简单键值对）、Twitter（trending topics 等），Redis 由此在社区快速传播。

## 7. 项目治理与现状

### 7.1 antirez 卸任

2020 年 6 月，维护 Redis 11 年的 antirez 宣布卸任维护者。他在博客《The end of the Redis adventure》里给出的理由是：他更想写代码、做创造性的工作，而不是陷入一个大型项目的日常维护。卸任后他仍是社区成员和 Redis 技术顾问委员会成员。

### 7.2 从 BDFL 到社区驱动 Core Team

antirez 卸任后，Redis 的规模已无法继续用「一人拍板」的 BDFL 模式运转。接手的两位长期贡献者 Yossi Gottlieb 和 Oran Agra 提出了一套「轻治理」模式：由一个小型 Core Team 根据成员的参与度和贡献选出，共同决策，取代 BDFL。

### 7.3 现在的维护者是谁

目前 Redis 的开源项目由 **Redis 公司**（原名 Redis Labs，2021 年更名）主要赞助和维护。这家公司 2011 年以 Garantia Data 之名成立，专做 Redis 相关的商业服务。Core Team 成员主要来自 Redis 公司，也有来自云厂商的贡献者。

2024 年 12 月，antirez 以「Redis 布道者」身份回归 Redis 公司，不再负责日常维护，转向技术布道和新特性设计（如 Vector Set）。

## 8. 参考资料

- Redis 官方基准测试：[How fast is Redis?](https://redis.io/docs/latest/operate/oss_and_stack/management/optimization/benchmarks/)
- Redis 官方博客：[New Governance for Redis](https://redis.io/blog/new-governance-for-redis)
- Redis 官方博客：[Thank You, Salvatore Sanfilippo](https://redis.io/blog/thank-you-salvatore-sanfilippo)
- Wikipedia：[Redis](https://en.wikipedia.org/wiki/Redis)
- endoflife.date：[Redis 版本与支持策略](https://endoflife.date/redis)
- Redis 官方许可证说明：[Licenses](https://redis.io/legal/licenses/)
- The Register：[Database maestro Antirez says arrivederci to Redis](https://www.theregister.com/2020/06/30/redis_creator_antirez_quits)
