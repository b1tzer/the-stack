# Controller

## 1. Controller 职责

- 分区 Leader 选举
- 分区副本分配
- Topic 创建/删除
- Broker 上下线处理

## 2. Controller 选举

- 通过 ZooKeeper 选举
- 每个 Broker 竞争 /controller 节点
- 第一个创建成功的成为 Controller

## 3. Controller 通知

```
Broker 上下线 → ZooKeeper 通知 → Controller 处理 → 更新元数据
```

## 4. Controller 问题

- 单点故障风险
- 重启时需要加载全量元数据
- KRaft 模式解决此问题

## 5. Controller 选举详解

```
Broker 启动
    │
    ▼
尝试在 ZooKeeper 创建 /controller 临时节点
    │
    ├── 成功 → 成为 Controller
    │
    └── 失败（节点已存在）→ 监听 /controller 节点变化
            │
            ▼
        Controller 宕机 → 临时节点自动删除
            │
            ▼
        所有 Broker 收到通知 → 重新竞争
```

## 6. Controller 核心职责详解

### 6.1 分区 Leader 选举
```
Broker 宕机
    │
    ▼
ZooKeeper 通知 Controller
    │
    ▼
Controller 检查受影响的分区
    │
    ▼
从 ISR 中选择新 Leader
    │
    ▼
通知所有 Broker 更新元数据
```

### 6.2 Topic 管理
```java
// Controller 处理 Topic 创建请求
// 1. 在 ZooKeeper 中创建 /brokers/topics/[topic] 节点
// 2. 分配分区和副本
// 3. 通知相关 Broker 创建日志目录
// 4. 更新元数据缓存
```

## 7. Controller 通知机制

Controller 通过 ZooKeeper 的 Watch 机制监听以下事件：

| 监听路径 | 事件 |
|----------|------|
| /brokers/ids/* | Broker 上下线 |
| /brokers/topics/* | Topic 创建/删除 |
| /admin/reassign_partitions | 分区重分配 |
| /admin/preferred_replica_election | Leader 选举 |

## 8. Controller 性能问题

**单线程处理瓶颈**：
- Controller 使用单线程处理所有事件通知。
- 大量 Broker 同时上下线时，处理速度慢。
- Topic 数量多时，元数据更新耗时长。

**优化方案**：
- 减少 Topic 数量，使用多级 Topic 结构。
- 避免频繁的分区重分配。
- 升级到 KRaft 模式（多 Controller 并行处理）。

## 9. 最佳实践

1. **监控 Controller 状态**：`kafka-metadata.sh` 查看当前 Controller 信息。
2. **避免 Controller 所在 Broker 过载**：Controller 需要处理额外的元数据请求，建议分配独立资源。
3. **及时处理 Controller 切换**：Controller 切换期间，分区 Leader 选举会暂停，影响写入和读取。
4. **考虑迁移到 KRaft**：KRaft 模式下 Controller 支持多节点冗余，性能更好。
