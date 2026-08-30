# Controller

> Controller 是 Kafka 集群的大脑，负责分区 Leader 选举、元数据管理和集群事件处理。本章讲清 Controller 的职责、选举机制，以及 KRaft 模式下的演进。

## 1. Controller 职责

| 职责 | 说明 |
| :-- | :-- |
| 分区 Leader 选举 | Broker 宕机时从 ISR 中选出新 Leader |
| 元数据管理 | 维护 Topic、分区、副本的分配信息 |
| Topic 管理 | 创建/删除 Topic，更新分区配置 |
| Broker 管理 | 处理 Broker 上下线事件 |
| 分区重分配 | 执行 `kafka-reassign-partitions` |

## 2. ZooKeeper 模式下的 Controller

### 2.1 选举

```text
Broker 启动
    │
    ▼
尝试在 ZooKeeper 创建 /controller 临时节点
    │
    ├── 成功 → 成为 Controller
    │
    └── 失败（已存在）→ 监听 /controller 变化
            │
            ▼
        Controller 宕机 → 临时节点删除
            │
            ▼
        所有 Broker 收到通知 → 重新竞争
```

### 2.2 事件监听

Controller 通过 ZooKeeper Watch 监听集群事件：

| 监听路径 | 事件 |
| :-- | :-- |
| `/brokers/ids/*` | Broker 上下线 |
| `/brokers/topics/*` | Topic 创建/删除 |
| `/admin/reassign_partitions` | 分区重分配 |
| `/admin/preferred_replica_election` | Leader 选举 |

### 2.3 单点问题

ZooKeeper 模式下 Controller 是单点：

| 问题 | 说明 |
| :-- | :-- |
| 单点故障 | Controller 宕机后重新选举期间，分区 Leader 选举暂停 |
| 单线程处理 | 所有事件串行处理，大量 Broker 同时上下线时处理慢 |
| 元数据加载慢 | 重启时需要从 ZooKeeper 加载全量元数据 |

## 3. Controller 处理流程

### 3.1 Broker 宕机处理

```text
Broker2 宕机
    │
    ▼
ZooKeeper 通知 Controller（/brokers/ids/2 临时节点删除）
    │
    ▼
Controller 检查 Broker2 上的所有 Leader 副本
    │
    ▼
对每个受影响的分区，从 ISR 中选择新 Leader
    │
    ▼
更新元数据缓存
    │
    ▼
发送 UpdateMetadata 请求给所有 Broker
    │
    ▼
新 Leader 开始处理读写请求
```

### 3.2 Topic 创建

```text
客户端发送 CreateTopics 请求
    │
    ▼
Controller 在 ZooKeeper 中创建 /brokers/topics/[topic]
    │
    ▼
分配分区和副本（按分配策略）
    │
    ▼
通知相关 Broker 创建日志目录
    │
    ▼
更新元数据缓存，返回响应
```

## 4. KRaft 模式下的 Controller

KRaft 用 Raft 协议替代 ZooKeeper，Controller 支持多节点冗余：

| 维度 | ZooKeeper 模式 | KRaft 模式 |
| :-- | :-- | :-- |
| Controller 数量 | 1 个（单点） | 3~5 个（Raft 共识） |
| 元数据存储 | ZooKeeper | `__cluster_metadata` Topic |
| 选举协议 | ZooKeeper 临时节点 | Raft 共识 |
| 启动速度 | 慢（加载 ZK 数据） | 快（本地日志恢复） |
| 分区上限 | ~20 万 | ~200 万 |

### 4.1 KRaft Controller 架构

```text
┌─────────────────────────────────────────┐
│         KRaft Controller Quorum         │
│                                         │
│  Controller 1 ←──Raft──→ Controller 2   │
│       ↑                      ↑          │
│       └──────Raft────────────┘          │
│              Controller 3               │
│                                         │
│         __cluster_metadata              │
│         （Raft 日志复制）                │
└─────────────────────────────────────────┘
          │         │         │
          ▼         ▼         ▼
      Broker 1  Broker 2  Broker 3
```

### 4.2 Raft 共识

KRaft 使用 Raft 协议保证元数据一致性：

```text
1. Leader 选举：Controller 节点通过 Raft 选出 Leader
2. 日志复制：Leader 把元数据变更写入 Raft 日志，复制到 Follower
3. 提交：多数派确认后，日志提交，元数据生效
4. Follower 同步：Follower 从 Leader 拉取已提交的日志
```

## 5. 最佳实践

1. **监控 Controller 状态**：`kafka-metadata.sh` 查看当前 Controller 信息。
2. **新项目用 KRaft**：去掉 ZooKeeper 依赖，Controller 多节点冗余。
3. **KRaft Controller 至少 3 个**：Raft 共识需要多数派存活。
4. **Controller 与 Broker 分离部署**：大型集群建议分开，避免资源竞争。
5. **监控 Controller 切换耗时**：切换期间分区 Leader 选举暂停，影响读写。
