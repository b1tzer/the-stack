# 多集群拓扑：为什么需要跨集群复制

单集群 Kafka 已经能满足绝大多数业务规模。真正把用户推向多集群的，从来不是"性能不够"，而是四类无法用单集群回答的问题：

- **一个机房 / 一个 region 挂了，业务能不能继续跑？**
- **跨地域访问延迟高，能否让每个 region 消费者读本地副本？**
- **合规要求某类数据不能出境 / 出 region，能否只把脱敏后的数据复制到中心集群？**
- **多个边缘集群产生数据，如何汇聚到中心做统计分析？**

这四个问题对应四种典型拓扑。选错拓扑会让整套复制方案在切换时集体失灵。

## 1. 四种典型拓扑

### 1.1 Active-Standby（灾备）

主集群承担 100% 生产流量，Standby 集群通过复制持续同步。正常情况下 Standby 只是"接盘位"，不对外提供读。当主集群不可用（机房故障、网络分区、误操作）时，业务切到 Standby。

```text
      producer                 consumer
         │                        │
         ▼                        ▼
   ┌─────────────┐   MM2    ┌─────────────┐
   │   Primary   │─────────▶│   Standby   │
   │   (active)  │          │  (passive)  │
   └─────────────┘          └─────────────┘
```

**关键决策**：

- Standby **只读**——写入被禁止，避免脑裂后合并数据无从下手。
- RPO（可容忍数据丢失）= 复制延迟，通常几百毫秒到几秒。
- RTO（切换时间）= 检测故障 + 切流量 + consumer offset 重定位。offset 翻译是这里的技术难点，详见 [§3 offset translation](./chapter-03-offset-translation.md)。

**适用场景**：金融、电商这类要求单点故障不丢业务的核心域。团队 SRE 能力足够、有独立灾备演练流程时首选。

### 1.2 Active-Active（双活）

两个集群同时接收生产流量，互相复制。任一集群故障时另一个可以承担全部流量。

```text
   ┌─────────────┐    MM2    ┌─────────────┐
   │   us-east   │ ────────▶ │   us-west   │
   │  (active)   │ ◀──────── │  (active)   │
   └─────────────┘    MM2    └─────────────┘
        ▲                          ▲
        │                          │
    east producers            west producers
```

**关键决策**：

- **循环防护**是硬要求。`us-east` 的 topic `orders` 复制到 `us-west` 后叫 `us-east.orders`；`us-west` 的 `orders` 复制到 `us-east` 后叫 `us-west.orders`。MM2 的 `DefaultReplicationPolicy` 就是靠前缀切断循环——一个已有前缀的 topic 永远不会被再次复制。
- **每个 region 的应用只写本地 topic、订阅本地 + 远端前缀 topic**。全球视图 = 本地 + 所有远端前缀 topic 的联合视图。
- **数据一致性不是强的**。同一时刻两侧看到的数据可能相差数秒。如果业务需要"全球唯一订单号"、"全球计数器"这类强一致语义，Active-Active 不合适。

**适用场景**：跨地域用户就近读写、要求任一 region 挂掉都不影响。典型如全球化的 SaaS、CDN 上报。

### 1.3 Hub-and-Spoke（星型汇聚）

多个边缘集群（spoke）单向复制到一个中心集群（hub），中心做统一分析、归档、二次分发。

```text
   ┌──────────┐  ┌──────────┐  ┌──────────┐
   │ edge-BJ  │  │ edge-SH  │  │ edge-GZ  │
   └────┬─────┘  └────┬─────┘  └────┬─────┘
        │             │             │
        └────MM2──────┼───MM2───────┘
                      ▼
                ┌──────────┐
                │ central  │
                └──────────┘
```

**关键决策**：

- 只从边缘复制到中心，中心不回写边缘。
- 边缘和中心可以用不同的存储配置——边缘保留 3 天用于本地实时业务，中心保留 30 天用于分析。
- 中心集群规模会明显大于任一边缘集群，容量规划需要按"所有边缘之和"设计。

**适用场景**：IoT 数据聚合、多机房日志入湖、跨国公司数据回流到总部。

### 1.4 Stretch Cluster（拉伸集群）

严格来说这不算"多集群"——它是把**单个 Kafka 集群**的 broker 部署到多个可用区（AZ），依赖 Kafka 自身的副本机制而不是 MirrorMaker 做跨区容灾。

```text
   ┌─────────── Kafka Cluster ────────────┐
   │                                       │
   │  ┌───AZ1───┐  ┌───AZ2───┐  ┌───AZ3───┐│
   │  │ broker1 │  │ broker2 │  │ broker3 ││
   │  │ broker4 │  │ broker5 │  │ broker6 ││
   │  └─────────┘  └─────────┘  └─────────┘│
   └───────────────────────────────────────┘
```

**关键决策**：

- 副本因子 ≥ 3，`min.insync.replicas = 2`，配合 `broker.rack` 让副本必须分布在不同 AZ。
- 依赖 AZ 之间**低延迟低丢包**（通常同 region 内、< 5 ms RTT）。跨 region 拉伸会让 ISR 变得极不稳定。
- KIP-392（Kafka 2.4+）之后 consumer 可以按 `client.rack` 从最近的副本 fetch，减轻跨 AZ 流量。

**适用场景**：同 region 内多 AZ 容灾，能容忍单 AZ 故障。这是 AWS MSK、Confluent Cloud 的默认部署形态。

## 2. 四种拓扑的横向对比

| 维度 | Active-Standby | Active-Active | Hub-and-Spoke | Stretch Cluster |
| :-- | :-- | :-- | :-- | :-- |
| 集群数量 | 2（1 写 1 备） | 2+（都写） | N+1 | 1（跨 AZ） |
| 数据流向 | 单向 | 双向 | 边缘→中心 | 集群内部副本 |
| RPO | 复制延迟 | 复制延迟 | 复制延迟 | 0（同步副本） |
| RTO | 分钟级 | 秒级 | 不适用 | 秒级（Leader 重选举） |
| 循环风险 | 无 | 必须靠前缀防护 | 无 | 不适用 |
| 一致性 | 主-备最终一致 | 两侧最终一致 | 中心最终一致 | 强一致（ISR） |
| 依赖 MirrorMaker | 是 | 是 | 是 | 否 |
| 典型跨机房距离 | 任意 | 任意 | 任意 | 同 region 内 |
| 复杂度 | 中 | 高 | 中 | 低 |

## 3. 选型决策树

```text
              需要跨 region 容灾？
                    │
        ┌───────────┴───────────┐
        否                       是
        │                       │
   同 region 内多 AZ？         用户是否分散多 region？
        │                       │
   Stretch Cluster    ┌─────────┴─────────┐
                     是                    否
                     │                    │
             读写就近？            核心域 or 分析？
                     │                    │
              Active-Active     ┌─────────┴────────┐
                              核心域              分析
                                │                  │
                       Active-Standby      Hub-and-Spoke
```

## 4. 与 Cluster Linking / Confluent Replicator 的关系

MirrorMaker 2 不是唯一选择：

| 工具 | 定位 | 是否开源 |
| :-- | :-- | :-- |
| **MirrorMaker 2** | Apache Kafka 官方，基于 Kafka Connect | 是（Apache 2.0） |
| **Confluent Replicator** | Confluent 商业版，UI + exactly-once | 否 |
| **Confluent Cluster Linking** | Broker 原生跨集群订阅，无 Connect 中转 | 部分开源 |
| **Uber uReplicator** | Uber 自研，早期为解决 MM1 局限 | 是 |
| **LinkedIn Brooklin** | LinkedIn 自研，多源多目标数据管道 | 是 |

社区开源选择基本只有 MirrorMaker 2。以下章节都聚焦 MM2。

## 5. 本目录导航

| 章节 | 主题 |
| :-- | :-- |
| [§2 MirrorMaker 2 架构与配置](./chapter-02-mirrormaker2.md) | 三个 Connector、内部 topic、`DefaultReplicationPolicy` |
| [§3 Offset 翻译与消费者切换](./chapter-03-offset-translation.md) | `offset-syncs` / `checkpoints` 机制、`RemoteClusterUtils` |
| [§4 灾备演练与切换流程](./chapter-04-dr-drill.md) | Runbook、切流量顺序、回切策略 |
