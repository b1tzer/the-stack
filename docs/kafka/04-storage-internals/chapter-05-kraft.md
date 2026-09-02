# KRaft 模式

> KRaft（Kafka Raft）是 Kafka 4.0 的默认模式，用 Raft 协议替代 ZooKeeper 管理元数据。本章讲清 KRaft 的架构、配置、迁移步骤，以及与 ZooKeeper 模式的对比。

> 本文讲 KRaft 架构与 Raft 共识原理；Controller 的职责与选举机制见 [Controller](./chapter-04-controller.md)。

## 1. 为什么要去掉 ZooKeeper

| 问题 | 说明 |
| :-- | :-- |
| 额外依赖 | 需要独立部署和维护 ZooKeeper 集群 |
| Controller 单点 | ZooKeeper 模式下 Controller 只有 1 个 |
| 启动慢 | Controller 重启需要从 ZooKeeper 加载全量元数据 |
| 分区上限 | ZooKeeper 不适合存储大量分区元数据（~20 万上限） |
| 一致性延迟 | ZooKeeper 的 Watch 机制有延迟 |

## 2. KRaft 架构

```text
┌─────────────────────────────────────────────────┐
│              KRaft Controller Quorum            │
│                                                 │
│  Controller 1 ◄────Raft 日志复制────► Controller 2
│       │                                      │    │
│       └──────────Raft 日志复制──────────────┘    │
│                    Controller 3                  │
│                                                 │
│              __cluster_metadata                 │
│              （存储所有元数据）                    │
└─────────────────────────────────────────────────┘
          │              │              │
          ▼              ▼              ▼
     Broker 1       Broker 2       Broker 3
```

核心组件：

| 组件 | 职责 |
| :-- | :-- |
| KRaft Controller | 3~5 个节点的 Raft 集群，管理元数据 |
| `__cluster_metadata` | 特殊 Topic，存储所有集群元数据（Topic/分区/副本分配） |
| Broker | 从 Controller 拉取元数据，处理客户端请求 |

### 2.1 为什么多数派提交才安全

Raft 的一致性靠「多数派确认」，而不是「全部节点确认」。假设 Quorum 有 3 个 Controller，只要 2 个（多数）落盘一条元数据变更，这条变更就算提交：

```text
3 个节点，多数派 = 2

场景：Leader 写入「创建 Topic X」的日志
  Leader 落盘 → 复制到 Follower1 落盘 → Follower2 尚未收到
  多数派（Leader + Follower1）已确认 → 提交成功
  此时 Follower2 故障，不影响一致性
```

为什么「多数」就够了？因为任意两次多数派集合必然相交。假设旧 Leader 已把某条日志提交给多数派 {A, B}，之后它宕机，新 Leader 必须赢得多数派选票才能上任——这个多数派里至少有一个节点包含旧日志，所以新 Leader 一定「见过」这条已提交日志，不会覆盖它，也不会丢失它。

这就是 Raft 用「多数派」而非「全部」的原因：既容忍少数节点故障，又保证任意两次提交互不矛盾。

## 3. 与 ZooKeeper 模式对比

| 特性 | ZooKeeper 模式 | KRaft 模式 |
| :-- | :-- | :-- |
| 元数据存储 | ZooKeeper 集群 | `__cluster_metadata` Topic |
| Controller 数量 | 1 个（单点） | 3+ 个（Raft 共识） |
| 启动速度 | 慢（加载 ZK 数据） | 快（本地日志恢复） |
| 分区上限 | ~20 万 | ~200 万 |
| 运维复杂度 | 高（维护 ZK 集群） | 低（只需 Kafka） |
| 故障恢复 | 慢（重新加载元数据） | 快（Raft 日志回放） |
| 部署依赖 | ZooKeeper + Kafka | 只需 Kafka |

### 3.1 为什么 KRaft 能支撑更多分区

分区上限的瓶颈在元数据写入路径，而不是存储容量：

```text
ZooKeeper 模式：
  元数据变更 → Controller 写 ZooKeeper → ZooKeeper 广播给 Broker
  问题：每次变更都是一次独立写事务，且所有写都经过 ZooKeeper 唯一 Leader

KRaft 模式：
  元数据变更 → KRaft Leader 写本地日志 → 复制给 Controller 节点
  Broker 从 Controller 拉取快照 + 增量日志
  问题：写入走 Kafka 自己的日志，顺序追加、批量复制
```

ZooKeeper 本质是通用协调服务，元数据以零散的 ZNode 键值存储，每次变更都单独走一次写事务。KRaft 把元数据当作「Kafka 自己的一条日志流」处理，顺序追加、批量复制，天然适合高频变更——所以分区上限能从约 20 万提升到约 200 万。

## 4. 配置详解

### 4.1 角色配置

```properties
# 同时充当 Broker 和 Controller（小规模部署）
process.roles=broker,controller

# 分离部署（大规模推荐）
# 节点1-3：纯 Controller
process.roles=controller
# 节点4-6：纯 Broker
process.roles=broker
```

### 4.2 节点配置

```properties
# 节点 ID（每个节点唯一）
node.id=1

# Quorum 配置（至少 3 个 Controller 节点）
controller.quorum.voters=1@controller1:9093,2@controller2:9093,3@controller3:9093

# 监听器
listeners=PLAINTEXT://:9092,CONTROLLER://:9093
controller.listener.names=CONTROLLER
advertised.listeners=PLAINTEXT://broker1:9092
```

### 4.3 存储配置

```bash
# 生成集群 UUID
UUID=$(kafka-storage.sh random-uuid)

# 格式化存储目录
kafka-storage.sh format -t $UUID -c config/kraft/server.properties

# 启动
kafka-server-start.sh config/kraft/server.properties
```

## 5. 迁移步骤

### 5.1 全新部署

```bash
# 1. 生成集群 UUID
UUID=$(kafka-storage.sh random-uuid)

# 2. 格式化存储目录（每个节点都要执行）
kafka-storage.sh format -t $UUID -c config/kraft/server.properties

# 3. 启动 Controller 节点
kafka-server-start.sh config/kraft/controller.properties

# 4. 启动 Broker 节点
kafka-server-start.sh config/kraft/server.properties
```

### 5.2 从 ZooKeeper 迁移

```bash
# 1. 升级到 Kafka 3.3+（支持 KRaft）
# 2. 配置 KRaft 模式（添加 KRaft 相关配置）
# 3. 使用迁移工具导出 ZooKeeper 元数据
# 4. 格式化 KRaft 存储
# 5. 逐个 Broker 迁移（先 Controller，后 Broker）
# 6. 验证集群状态
# 7. 关闭 ZooKeeper
```

> 从 ZooKeeper 迁移到 KRaft 是一个复杂的运维操作，建议在测试环境充分验证后再在生产环境执行。Kafka 4.0 已移除 ZooKeeper 支持，新项目直接用 KRaft。

## 6. 最佳实践

1. **新项目直接使用 KRaft**：无需部署 ZooKeeper，运维更简单。
2. **Controller 节点至少 3 个**：Raft 共识需要多数派存活，3 个节点可容忍 1 个故障。
3. **Controller 与 Broker 分离部署**：大型集群建议分开，避免资源竞争。
4. **监控 Quorum 状态**：`kafka-metadata.sh --status` 检查 Raft 集群健康。
5. **配置 `controller.quorum.voters`**：确保所有 Controller 节点都在列表中。
