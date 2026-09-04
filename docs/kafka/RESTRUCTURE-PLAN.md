# Kafka 文档重构方案

## 一、现状诊断

### 文件清单（52 篇 Markdown）

```txt
01-basics/          4 篇（概览、术语、架构、选型）
02-producer/        5 篇（API、分区、ACK/重试、批量压缩、事务）
03-consumer/        5 篇（API、消费者组、Offset、Rebalance、优化）
04-schema/          4 篇（概览、序列化、Registry、演进）
05-storage-internals/ 5 篇（日志分段、Page Cache、副本、Controller、KRaft）
06-reliability/     4 篇（ACK、Exactly Once、消息顺序、数据保留）
07-streams/         5 篇（概览、操作、窗口、状态存储、Exactly Once）
08-connect/         4 篇（基础、配置、插件、监控）
09-operations/      4 篇（集群管理、监控、安全、排查）
10-multi-cluster/   4 篇（场景、MirrorMaker2、Offset 转换、容灾演练）
11-practice/        7 篇（安装、第一个应用、第一个生产、Spring、模式、性能调优、AdminClient）
reference/          2 篇（命令、参数）
```

### 核心问题

| 问题 | 表现 | 影响 |
| :-- | :-- | :-- |
| **按组件分目录** | 01~11 是 Kafka 的内部架构图，不是开发者的学习路径 | 读者不知道该去哪找答案 |
| **同一概念散落多处** | ACK 在 02-producer + 06-reliability 两处讲；ISR/LEO/HW 在术语、架构、副本、可靠性四处出现 | 读完任何一篇都不完整，需自己拼凑 |
| **深度断崖** | 从 basics 直接跳到 RecordBatch 61 字节头部 + 源码类名 | 普通开发者读完基础篇后无法继续 |
| **只讲机制不讲问题** | 副本机制讲了 Leader Epoch 调用链，但不讲"什么情况下会遇到"+"怎么排查" | 读完不知道什么时候用 |
| **长文堆砌** | 副本机制一篇涵盖 LEO/HW、Follower 同步、Leader Epoch、ISR、选举、KIP-392、KIP-966、监控 | 认知负担过重 |
| **排查章节太薄** | troubleshooting 只有 10 个问题，每个 2~3 行 | 真正遇到问题时不够用 |
| **缺少学习路径** | 没有任何入口告诉读者"你应该按什么顺序读" | 读者随机打开，建立不了系统认知 |

## 二、重构原则

1. **按开发者问题域分目录**，不按 Kafka 组件分目录
2. **每个概念只在一个地方完整讲解**，其他地方用链接引用
3. **每篇文档只解决一个核心问题**，控制篇幅
4. **机制 + 问题 + 排查 三位一体**，不做纯机制说明书
5. **区分"理解篇"和"排查篇"**，两类文档写法不同

## 三、新目录结构

```txt
docs/kafka/
├── _intro/                          # 入口与导航
│   ├── what-is-kafka.md             # Kafka 是什么（合并现有 overview + 术语 + 架构）
│   ├── learning-path.md             # 学习路径导航（按角色：新手/开发者/运维）
│   └── mq-comparison.md             # 消息队列选型（保留现有）
│
├── _core/                           # 核心概念（每个概念只在此讲一次）
│   ├── partition-and-offset.md      # 分区与 Offset：存储模型的基石
│   ├── producer-internals.md        # 生产者内部机制：发送流程、批量、压缩
│   ├── consumer-group.md            # 消费者组：Rebalance、Coordinator、分配策略
│   ├── replication-and-isr.md       # 副本与 ISR：Leader/Follower、LEO/HW、同步机制
│   ├── ack-and-idempotence.md       # ACK 与幂等：三种模式、幂等原理、事务
│   ├── schema-and-serialization.md  # Schema 与序列化：为什么需要 Schema Registry
│   ├── data-retention.md            # 数据保留：删除策略、压缩策略
│   └── controller-and-kraft.md      # Controller 与 KRaft：元数据管理的演进
│
├── reliability/                     # 可靠性：消息不丢、不重、有序
│   ├── message-loss.md              # 消息丢失：三个环节各自怎么丢、怎么防
│   ├── message-dedup.md             # 消息去重：幂等生产者 + 事务 + 消费端去重
│   ├── message-ordering.md          # 消息顺序：单分区有序、全局有序的代价
│   └── exactly-once.md              # Exactly Once：事务的完整机制与适用边界
│
├── performance/                     # 性能：吞吐、延迟、扩展
│   ├── why-kafka-is-fast.md         # 为什么快：顺序写、零拷贝、批处理、页缓存
│   ├── throughput-tuning.md         # 吞吐调优：生产者/消费者/Broker 三端参数
│   ├── partition-sizing.md          # 分区数选择：经验公式、过多的代价、扩展风险
│   └── compression-tradeoff.md      # 压缩权衡：算法选择、端到端压缩、CPU vs 带宽
│
├── troubleshooting/                 # 排查：遇到问题怎么定位和解决
│   ├── consumer-lag.md              # 消费者 Lag 过大：原因分析、扩容策略、Fetch 调优
│   ├── isr-shrink.md                # ISR 频繁收缩：网络、磁盘、GC、参数调优
│   ├── message-loss-debug.md        # 消息丢失排查：三个环节逐一检查
│   ├── high-latency.md              # 高延迟排查：Broker/网络/Consumer 三端定位
│   ├── disk-space.md                # 磁盘空间不足：保留策略、手动清理、容量规划
│   └── broker-failure.md            # Broker 故障：启动失败、Controller 故障、Recovery
│
├── operations/                      # 运维：集群管理与日常维护
│   ├── cluster-management.md        # 集群管理：扩缩容、分区重分配、滚动升级
│   ├── monitoring.md                # 监控体系：核心 JMX 指标、告警阈值、监控工具
│   ├── security.md                  # 安全配置：SASL/SSL/ACL
│   └── multi-cluster.md             # 多集群：MirrorMaker2、容灾、Offset 转换
│
├── streams/                         # Kafka Streams
│   ├── streams-basics.md            # Streams 基础：KStream/KTable/GlobalKTable
│   ├── streams-operations.md        # 流操作：Filter/Map/Join/Aggregate
│   ├── streams-windowing.md         # 窗口：Tumbling/Sliding/Session
│   ├── streams-state-store.md       # 状态存储：RocksDB、Changelog、容错
│   └── streams-exactly-once.md      # Streams Exactly Once
│
├── connect/                         # Kafka Connect
│   ├── connect-basics.md            # Connect 基础：Source/Sink、Worker、Task
│   ├── connect-config.md            # 配置与调优：转换器、SMT、错误处理
│   ├── connect-plugins.md           # 常用插件：Debezium、JDBC、S3
│   └── connect-monitoring.md        # Connect 监控：状态、指标、故障排查
│
├── practice/                        # 实战
│   ├── first-app.md                 # 第一个 Kafka 应用
│   ├── spring-kafka.md              # Spring Kafka 集成
│   └── common-patterns.md           # 常见使用模式
│
└── reference/                       # 参考（字节级细节、命令手册）
    ├── record-batch-format.md       # RecordBatch v2 字节布局（从 storage-internals 迁入）
    ├── log-segment.md               # 日志分段与索引（从 storage-internals 迁入）
    ├── commands.md                  # 命令手册（保留现有）
    └── parameters.md                # 参数手册（保留现有）
```

## 四、概念归属映射

每个概念只在一个地方完整讲解，其他地方用链接引用：

| 概念 | 归属文档 | 原来散落在 |
| :-- | :-- | :-- |
| Partition / Offset / Segment | `_core/partition-and-offset.md` | 术语、架构、日志分段 |
| Leader / Follower / ISR / LEO / HW | `_core/replication-and-isr.md` | 术语、架构、副本机制、可靠性 |
| ACK 三种模式 | `_core/ack-and-idempotence.md` | 02-producer/03 + 06-reliability/01 |
| 幂等生产者 (PID + Seq) | `_core/ack-and-idempotence.md` | 02-producer/03 + 06-reliability/02 |
| 事务 (Transaction Coordinator) | `reliability/exactly-once.md` | 02-producer/05 + 06-reliability/02 |
| Consumer Group / Rebalance | `_core/consumer-group.md` | 03-consumer/02 + 03-consumer/04 |
| Offset 管理 | `troubleshooting/consumer-lag.md` + `_core/consumer-group.md` | 03-consumer/03 |
| Controller / KRaft | `_core/controller-and-kraft.md` | 05-storage-internals/04 + 05 |
| Leader Epoch | `_core/replication-and-isr.md` | 05-storage-internals/03 |
| RecordBatch 字节布局 | `reference/record-batch-format.md` | 05-storage-internals/01 |
| 日志分段与索引 | `reference/log-segment.md` | 05-storage-internals/01 |
| Schema / Schema Registry | `_core/schema-and-serialization.md` | 04-schema 全部 4 篇 |
| 数据保留策略 | `_core/data-retention.md` | 06-reliability/04 |

## 五、迁移对照表

现有文件 → 新位置：

| 现有文件 | 处理方式 | 新位置 |
| :-- | :-- | :-- |
| `01-basics/chapter-01-overview.md` | 合并 | `_intro/what-is-kafka.md` |
| `01-basics/chapter-02-terminology.md` | 拆分，术语融入各核心概念文档 | 各 `_core/` 文档 |
| `01-basics/chapter-03-architecture.md` | 合并 | `_intro/what-is-kafka.md` |
| `01-basics/chapter-04-mq-comparison.md` | 保留 | `_intro/mq-comparison.md` |
| `02-producer/chapter-01-producer-basics.md` | 合并 | `_core/producer-internals.md` |
| `02-producer/chapter-02-partition-strategy.md` | 合并 | `_core/partition-and-offset.md` + `performance/partition-sizing.md` |
| `02-producer/chapter-03-acks-retries.md` | 合并 | `_core/ack-and-idempotence.md` |
| `02-producer/chapter-04-batch-compression.md` | 合并 | `_core/producer-internals.md` + `performance/compression-tradeoff.md` |
| `02-producer/chapter-05-transaction-producer.md` | 合并 | `reliability/exactly-once.md` |
| `03-consumer/chapter-01-consumer-basics.md` | 合并 | `_core/consumer-group.md` |
| `03-consumer/chapter-02-consumer-group.md` | 合并 | `_core/consumer-group.md` |
| `03-consumer/chapter-03-offset-management.md` | 合并 | `_core/consumer-group.md` + `troubleshooting/consumer-lag.md` |
| `03-consumer/chapter-04-rebalance-strategy.md` | 合并 | `_core/consumer-group.md` |
| `03-consumer/chapter-05-consumer-optimization.md` | 合并 | `performance/throughput-tuning.md` + `troubleshooting/consumer-lag.md` |
| `04-schema/chapter-01-schema-overview.md` | 合并 | `_core/schema-and-serialization.md` |
| `04-schema/chapter-02-serializers.md` | 合并 | `_core/schema-and-serialization.md` |
| `04-schema/chapter-03-schema-registry.md` | 合并 | `_core/schema-and-serialization.md` |
| `04-schema/chapter-04-schema-evolution.md` | 合并 | `_core/schema-and-serialization.md` |
| `05-storage-internals/chapter-01-log-segment.md` | 迁入参考 | `reference/log-segment.md` |
| `05-storage-internals/chapter-02-page-cache.md` | 合并 | `performance/why-kafka-is-fast.md` |
| `05-storage-internals/chapter-03-replication.md` | 拆分 | `_core/replication-and-isr.md`（机制）+ `reference/`（源码细节） |
| `05-storage-internals/chapter-04-controller.md` | 合并 | `_core/controller-and-kraft.md` |
| `05-storage-internals/chapter-05-kraft.md` | 合并 | `_core/controller-and-kraft.md` |
| `06-reliability/chapter-01-acks.md` | 合并 | `_core/ack-and-idempotence.md` + `reliability/message-loss.md` |
| `06-reliability/chapter-02-exactly-once.md` | 合并 | `reliability/exactly-once.md` |
| `06-reliability/chapter-03-message-ordering.md` | 保留 | `reliability/message-ordering.md` |
| `06-reliability/chapter-04-data-retention.md` | 合并 | `_core/data-retention.md` |
| `07-streams/*` | 保留结构 | `streams/*` |
| `08-connect/*` | 保留结构 | `connect/*` |
| `09-operations/chapter-01-cluster-management.md` | 保留 | `operations/cluster-management.md` |
| `09-operations/chapter-02-monitoring.md` | 保留 | `operations/monitoring.md` |
| `09-operations/chapter-03-security.md` | 保留 | `operations/security.md` |
| `09-operations/chapter-04-troubleshooting.md` | 拆分 | 各 `troubleshooting/*` 文档 |
| `10-multi-cluster/*` | 合并 | `operations/multi-cluster.md` |
| `11-practice/chapter-01-installation.md` | 删除或移入 README | — |
| `11-practice/chapter-02-first-app.md` | 保留 | `practice/first-app.md` |
| `11-practice/chapter-03-first-production.md` | 合并 | `practice/common-patterns.md` |
| `11-practice/chapter-04-spring-integration.md` | 已有链接 | `practice/spring-kafka.md` |
| `11-practice/chapter-05-common-patterns.md` | 保留 | `practice/common-patterns.md` |
| `11-practice/chapter-06-performance-tuning.md` | 合并 | `performance/throughput-tuning.md` |
| `11-practice/chapter-07-admin-client.md` | 合并 | `operations/cluster-management.md` |
| `reference/commands.md` | 保留 | `reference/commands.md` |
| `reference/parameters.md` | 保留 | `reference/parameters.md` |

## 六、文档写法模板

### 核心概念文档（`_core/`）写法

```txt
1. 这个概念解决什么问题（一句话）
2. 核心机制（原理、数据结构、执行流程）
3. 关键行为与边界（什么时候出问题、为什么会出）
4. 链接：相关的排查文档、性能文档
```

### 可靠性文档（`reliability/`）写法

```txt
1. 问题场景：什么情况下会出这个问题
2. 现象：出了问题的表现是什么
3. 根因：为什么会产生
4. 解决方案：怎么防、怎么查
5. 配置清单：推荐的配置组合
```

### 排查文档（`troubleshooting/`）写法

```txt
1. 现象描述：你看到了什么
2. 快速判断：30 秒内定位方向
3. 逐步排查：具体的命令和操作
4. 常见根因：Top 3 原因及对应解法
5. 预防措施：怎么让它不再发生
```

### 参考文档（`reference/`）写法

```txt
1. 纯技术细节：字节布局、源码分析、API 签名
2. 不需要解释"为什么"，只需要"是什么"
3. 面向需要深入底层的读者
```

## 七、学习路径

`_intro/learning-path.md` 将提供三条路径：

### 新手路径（建立心智模型）

```txt
what-is-kafka → partition-and-offset → producer-internals
→ consumer-group → replication-and-isr → ack-and-idempotence
```

### 开发者路径（解决实际问题）

```txt
message-loss → message-dedup → message-ordering
→ throughput-tuning → partition-sizing → consumer-lag
```

### 运维路径（保障生产稳定）

```txt
monitoring → isr-shrink → high-latency → disk-space
→ broker-failure → cluster-management → multi-cluster
```

## 八、执行计划

| 阶段 | 内容 | 状态 |
| :-- | :-- | :-- |
| 1 | 创建 `_intro/`：what-is-kafka、learning-path、mq-comparison | ✅ 完成 |
| 2 | 创建 `_core/`：8 篇核心概念文档 | ✅ 完成 |
| 3 | 创建 `reliability/`：4 篇可靠性文档 | ✅ 完成 |
| 4 | 创建 `performance/`：4 篇性能文档 | ✅ 完成 |
| 5 | 创建 `troubleshooting/`：6 篇排查文档 | ✅ 完成 |
| 6 | 创建 `reference/`：record-batch-format、log-segment | ✅ 完成 |
| 7 | 更新 VitePress 侧边栏配置 | ✅ 完成 |
| 8 | 删除旧目录，更新所有内部链接 | ⏳ 待执行 |
