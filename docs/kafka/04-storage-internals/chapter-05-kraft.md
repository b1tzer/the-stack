# KRaft 模式

## 1. 什么是 KRaft

Kafka Raft，去除 ZooKeeper 依赖，使用 Raft 协议管理元数据。

## 2. 优势

- 简化部署（无需 ZooKeeper）
- 更快的启动和恢复
- 更好的扩展性
- 降低运维复杂度

## 3. 配置

```properties
# KRaft 模式
process.roles=broker,controller
node.id=1
controller.quorum.voters=1@localhost:9093
```

## 4. 迁移

```bash
# 从 ZooKeeper 迁移到 KRaft
kafka-storage.sh random-uuid
kafka-storage.sh format -t <uuid> -c server.properties
kafka-server-start.sh server.properties
```

## 5. 版本支持

- Kafka 3.3+：KRaft 生产就绪
- Kafka 4.0：默认 KRaft，移除 ZooKeeper

## 6. KRaft 架构详解

```
┌─────────────────────────────────────────────┐
│                KRaft Cluster                │
│                                             │
│  ┌─────────────┐  ┌─────────────┐          │
│  │ Controller 1│  │ Controller 2│  ...      │
│  │ (Raft Voter)│  │ (Raft Voter)│          │
│  └──────┬──────┘  └──────┬──────┘          │
│         │                │                  │
│         └───────┬────────┘                  │
│                 ▼                            │
│         Raft 共识协议                        │
│         __cluster_metadata                  │
│                 │                            │
│         ┌──────┼──────┐                     │
│         ▼      ▼      ▼                     │
│  ┌────────┐ ┌────────┐ ┌────────┐          │
│  │Broker 1│ │Broker 2│ │Broker 3│          │
│  └────────┘ └────────┘ └────────┘          │
└─────────────────────────────────────────────┘
```

## 7. KRaft 与 ZooKeeper 模式对比

| 特性 | ZooKeeper 模式 | KRaft 模式 |
|------|---------------|------------|
| 元数据存储 | ZooKeeper 集群 | __cluster_metadata Topic |
| Controller 数量 | 1 个（单点） | 3+ 个（Raft 共识） |
| 启动速度 | 慢（加载 ZK 数据） | 快（本地日志恢复） |
| 分区上限 | ~20 万 | ~200 万 |
| 运维复杂度 | 高（维护 ZK 集群） | 低（只需 Kafka） |
| 故障恢复 | 慢（重新加载元数据） | 快（Raft 日志回放） |

## 8. 迁移步骤详解

### 8.1 全新部署
```bash
# 1. 生成集群 UUID
UUID=$(kafka-storage.sh random-uuid)

# 2. 格式化存储目录
kafka-storage.sh format -t $UUID -c config/kraft/server.properties

# 3. 启动 Broker
kafka-server-start.sh config/kraft/server.properties
```

### 8.2 从 ZooKeeper 迁移
```bash
# 1. 配置 KRaft 模式
# 在 server.properties 中添加：
# process.roles=broker,controller
# node.id=<unique-id>
# controller.quorum.voters=1@controller1:9093,2@controller2:9093,3@controller3:9093
# controller.listener.names=CONTROLLER
# listeners=PLAINTEXT://:9092,CONTROLLER://:9093

# 2. 使用迁移工具
kafka-metadata-shell.sh --snapshot /path/to/zk/snapshot

# 3. 逐个 Broker 迁移
# 先迁移 Controller，再迁移 Broker
```

## 9. KRaft 配置详解

```properties
# 角色配置
process.roles=broker,controller  # 同时充当 Broker 和 Controller
# 或分离部署：
# process.roles=controller       # 纯 Controller 节点

# 节点 ID
node.id=1

# Quorum 配置（至少 3 个节点）
controller.quorum.voters=1@controller1:9093,2@controller2:9093,3@controller3:9093

# 监听器配置
listeners=PLAINTEXT://:9092,CONTROLLER://:9093
controller.listener.names=CONTROLLER
advertised.listeners=PLAINTEXT://broker1:9092
```

## 10. 最佳实践

1. **新项目直接使用 KRaft**：无需部署 ZooKeeper，运维更简单。
2. **Controller 节点至少 3 个**：Raft 共识需要多数派存活，3 个节点可容忍 1 个故障。
3. **Controller 与 Broker 分离部署**：大型集群建议 Controller 和 Broker 分开，避免资源竞争。
4. **监控 Quorum 状态**：使用 `kafka-metadata.sh --status` 检查 Raft 集群健康状态。
