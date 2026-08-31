# Redis 概览与定位

> Redis 是一个基于内存的数据结构服务器。理解它的定位，是正确使用它的前提——先看清它是什么、擅长什么、不该用来做什么，再进入细节。

## 1. 什么是 Redis

Redis（Remote Dictionary Server）是一个开源的键值对存储系统，数据保存在内存中，读写速度远超基于磁盘的数据库。它的本质是一个**数据结构服务器**：value 不只是普通字符串，而可以是 String、Hash、List、Set、ZSet 等多种数据结构，并针对每种结构提供原子操作命令。

```text
key  →  value（value 可以是多种数据结构）

"user:123"        →  "{name:'张三', age:25}"     String
"user:123:info"   →  {name, age, email}          Hash
"news:list"       →  [文章3, 文章2, 文章1]         List
"user:123:tags"   →  {Java, 后端, 分布式}          Set
"leaderboard"     →  {张三:100, 李四:200}          ZSet
```

Redis 官方对它的定位是「内存数据结构服务器」，广泛用作缓存、消息队列、分布式锁、排行榜等。它常被放在 MySQL 这类持久化数据库之前，利用内存的高速访问缓解数据库压力。

## 2. 诞生背景与作者

Redis 的起点是一个真实的生产瓶颈，而非预先规划的产品。

### 2.1 起因：LLOOGG 的性能瓶颈

2009 年，意大利西西里岛的工程师 Salvatore Sanfilippo（网名 antirez）在为自己的创业项目 **LLOOGG** 做实时网站访问统计。LLOOGG 为每个接入的网站维护一个「最新 N 条访问记录」列表：新访问进来时把记录推入列表尾部，列表超长时再把最早的记录弹出。

这套「推入 + 弹出」操作当时跑在 MySQL 上。MySQL 每次推入、弹出都要读写硬盘，而 LLOOGG 的用户越多、要维护的列表就越多，性能最终受制于硬盘 I/O。当时 LLOOGG 没有盈利模式，antirez 不愿直接升级服务器，于是决定自己写一个内存数据库原型：以列表为基本类型，对列表两端做 O(1) 的推入和弹出，数据放内存而非硬盘。

### 2.2 从 Tcl 原型到 C 实现

antirez 先用 Tcl 写了一个约 300 行的原型验证想法，随后用 C 重写，并加上基于子进程的持久化——这就是后来 RDB 快照的思路。2009 年 2 月，项目以 **Redis**（REmote DIctionary Server，远程字典服务）之名开源，并在 Hacker News 上发布。

> Redis 默认端口 6379 并非随意挑选：在老式电话键盘上，6379 对应「MERZ」，即 antirez 创业公司 Merzia 的前四个字母。

### 2.3 谁在主导：从一人维护到公司赞助

Redis 前 11 年基本由 antirez 一人主导，他是事实上的 BDFL（终身仁慈独裁者）——功能的取舍、bug 的修复方式、设计的权衡都由他最终拍板。另一位核心贡献者 Pieter Noordhuis 也深度参与开发。

随着项目流行，Redis 的开发获得了一系列公司赞助：

| 时间 | 赞助方 | 说明 |
| :-- | :-- | :-- |
| 2010 ~ 2013 | VMware | antirez 与 Pieter Noordhuis 先后加入，全职开发 |
| 2013 ~ 2015 | Pivotal | VMware 分拆出的公司继续赞助 |
| 2015 起 | Redis Labs（后更名 Redis） | 商业化公司接手赞助 |

早期采用者包括 GitHub（用它做 Resque 队列）、Instagram（存储数亿个简单键值对）、Twitter（trending topics 等），Redis 由此在社区快速传播。

## 3. 核心特性

| 特性 | 说明 |
| :-- | :-- |
| 快 | 纯内存操作，单机 QPS 轻松突破 10 万 |
| 数据结构丰富 | 5 种基础类型 + 4 种高级类型，覆盖绝大多数业务场景 |
| 原子操作 | 命令由单线程执行，单条命令天然原子，无并发竞争 |
| 持久化 | 提供 RDB 快照与 AOF 日志两种持久化方式 |
| 高可用 | 主从复制、哨兵、集群三种方案逐级演进 |
| 功能扩展 | 支持事务、Lua 脚本、发布订阅、Pipeline 等 |

## 4. 版本演进与发版节奏

### 4.1 发版节奏

Redis 计划每年发布一个主版本，每个主版本约半年后跟一个次版本。最新的稳定版本获得完整支持，此前的次版本和上一个主版本仅做维护性修补（关键 bug 与安全漏洞）。

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

本书聚焦 **Redis 6.0 ~ 7.2**。6.0 起支持多线程网络 IO（命令执行仍单线程），7.0 引入 Functions 和 MP-AOF，7.2 彻底用 listpack 替代 ziplist。自 7.4 起 Redis 切换为 RSALv2 + SSPLv1 双协议，社区出现 Valkey 等开源分支。

### 4.2 版本与许可证

2024 年起 Redis 的许可证经历了一次影响深远的变化，不同版本范围对应不同许可证：

| 版本范围 | 许可证 |
| :-- | :-- |
| ≤ 7.2 | BSD-3-Clause |
| 7.4 ~ 7.8 | RSALv2 / SSPLv1 二选一 |
| ≥ 8.0 | RSALv2 / SSPLv1 / AGPLv3 三选一 |

## 5. 项目治理与现状

### 5.1 antirez 卸任

2020 年 6 月，维护 Redis 11 年的 antirez 宣布卸任维护者。他在博客《The end of the Redis adventure》里给出的理由是：他更想写代码、做创造性的工作，而不是陷入一个大型项目的日常维护。卸任后他仍是社区成员和 Redis 技术顾问委员会成员。

### 5.2 从 BDFL 到社区驱动 Core Team

antirez 卸任后，Redis 的规模已无法继续用「一人拍板」的 BDFL 模式运转。接手的两位长期贡献者 Yossi Gottlieb 和 Oran Agra 提出了一套「轻治理」模式：由一个小型 Core Team 根据成员的参与度和贡献选出，共同决策，取代 BDFL。

### 5.3 现在的维护者是谁

目前 Redis 的开源项目由 **Redis 公司**（原名 Redis Labs，2021 年更名）主导。这家公司 2011 年以 Garantia Data 之名成立，专做 Redis 相关的商业服务。Core Team 成员主要来自 Redis 公司，也有来自云厂商的贡献者。

2024 年 11 月，antirez 以「Redis 布道者」身份回归 Redis 公司，不再负责日常维护，转向技术布道和新特性设计（如 Vector Set）。

## 6. 适用场景与反模式

**适合的场景**：

| 场景 | 说明 |
| :-- | :-- |
| 缓存 | 热点数据缓存，缓解数据库压力 |
| 排行榜 | ZSet 按 score 排序，天然适配 |
| 计数器 | INCR 原子自增，无并发问题 |
| 分布式锁 | SET NX PX 原子加锁 |
| 消息队列 | List 阻塞弹出、Stream 消费者组 |
| 会话存储 | 共享 Session，TTL 自动过期 |

**反模式**（不该把 Redis 当作）：

| 反模式 | 原因 |
| :-- | :-- |
| 主数据库 | 内存容量有限，数据量大时成本高 |
| 强一致存储 | 主从复制异步，可能丢少量数据 |
| 大文件存储 | 大 Key 阻塞命令执行、占用带宽 |
| 关系型查询 | 无 SQL、无复杂关联查询能力 |

## 7. 与 Memcached 对比

Memcached 是另一款常见的内存缓存，二者常被放在一起比较：

| 对比项 | Redis | Memcached |
| :-- | :-- | :-- |
| 数据类型 | 5 种基础 + 4 种高级 | 仅 String |
| 持久化 | 支持 RDB/AOF | 不支持 |
| 集群 | 原生支持主从/哨兵/集群 | 需客户端实现分片 |
| 线程模型 | 单线程 + IO 多路复用 | 多线程 |
| 功能 | 事务、Lua、订阅、Pipeline | 无 |

选择标准：需要丰富数据结构、持久化、高可用时选 Redis；仅做简单 KV 缓存、追求极致简洁时 Memcached 才进入考虑范围。

### 7.1 性能基准对比

Redis 自带 `redis-benchmark` 工具，模拟 N 个客户端并发发送 M 个请求。官方文档给出的参考值：50 并发、10 万请求、3 字节负载下，`SET` 约 18 万次/秒、`LPUSH` 约 18.8 万次/秒；开启 pipelining（`-P 16`）后可达 `SET` 153 万次/秒、`GET` 181 万次/秒。

与 Memcached 的性能差异随硬件、负载、版本而变，但有两点相对稳定：

1. **简单 GET/SET、单命令场景**：Memcached 的多线程架构在纯键值读写上占优，吞吐量可高出约 20% ~ 40%。
2. **pipelining、复杂结构、写密集场景**：Redis 凭借协议与数据结构优势反超。

| 场景 | Redis | Memcached |
| :-- | :-- | :-- |
| 简单 SET（256B） | 约 15 万 ops/s | 约 20 万 ops/s |
| 简单 GET（256B） | 约 18 万 ops/s | 约 25 万 ops/s |
| pipelined GET ×10 | 约 80 万 ops/s | 约 75 万 ops/s |
| p50 延迟（GET） | 约 0.12 ms | 约 0.09 ms |

> 📌 性能数据高度依赖硬件、网络、版本与测试方法。上表取自第三方横评的综合量级，仅用于建立直觉，不构成绝对结论；严谨选型应基于真实负载用 `redis-benchmark` 复测。

## 8. 参考资料

- Redis 官方基准测试：[How fast is Redis?](https://redis.io/docs/latest/operate/oss_and_stack/management/optimization/benchmarks/)
- Redis 官方博客：[New Governance for Redis](https://redis.io/blog/new-governance-for-redis)
- Redis 官方博客：[Thank You, Salvatore Sanfilippo](https://redis.io/blog/thank-you-salvatore-sanfilippo)
- Wikipedia：[Redis](https://en.wikipedia.org/wiki/Redis)
- endoflife.date：[Redis 版本与支持策略](https://endoflife.date/redis)
- The Register：[Database maestro Antirez says arrivederci to Redis](https://www.theregister.com/2020/06/30/redis_creator_antirez_quits)
