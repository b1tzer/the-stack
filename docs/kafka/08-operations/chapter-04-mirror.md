# 跨集群镜像

## 1. MirrorMaker2

```properties
# connect-mirror-maker.properties
clusters = east, west
east.bootstrap.servers = east-kafka:9092
west.bootstrap.servers = west-kafka:9092

east->west.enabled = true
west->east.enabled = true

# 主题重命名
replication.policy.class = org.apache.kafka.connect.mirror.IdentityReplicationPolicy
```

## 2. 使用场景

- 跨数据中心复制
- 灾难恢复
- 数据迁移

## 3. 配置

```bash
# 启动 MirrorMaker2
connect-mirror-maker.sh connect-mirror-maker.properties
```

## 4. 监控

```bash
# 查看复制状态
kafka-mirror-maker.sh --describe --bootstrap-server localhost:9092
```

## 5. MirrorMaker2 配置详解

```properties
# connect-mirror-maker.properties

# 集群配置
east.bootstrap.servers=east-kafka1:9092,east-kafka2:9092
west.bootstrap.servers=west-kafka1:9092,west-kafka2:9092

# 复制方向
east->west.enabled=true
west->east.enabled=false  # 单向复制

# 主题重命名策略
replication.policy.class=org.apache.kafka.connect.mirror.DefaultReplicationPolicy
replication.policy.separator=.

# 复制主题的命名格式
# 源集群：my-topic
# 目标集群：east.my-topic

# 排除内部主题
topics.exclude=.*\\.internal,.*\\.replica,__consumer_offsets

# 消费者组复制
group.enabled=true
group.exclude=.*\\.internal

# 同步间隔
sync.topic.configs.enabled=true
emit.heartbeats.enabled=true
emit.checkpoints.enabled=true
heartbeats.topic.replication.factor=1
checkpoints.topic.replication.factor=1
```

## 6. MirrorMaker2 与 MirrorMaker1 对比

| 特性 | MirrorMaker1 | MirrorMaker2 |
|------|--------------|--------------|
| 架构 | 独立进程 | 基于 Kafka Connect |
| 高可用 | 单点 | 分布式 |
| Offset 同步 | 不支持 | 支持 |
| 主题重命名 | 不支持 | 支持 |
| 消费者组同步 | 不支持 | 支持 |
| 监控 | 有限 | 丰富的 Connect 指标 |

> MM2 能同步 Offset，MM1 不能，根源在架构差异。MM1 只是一个独立的消费-生产进程：它消费源集群消息时产生的 Offset 只留在源集群的 `__consumer_offsets` 里，没有通道把它搬到目标集群。灾备切换后，目标集群的消费者拿不到可用的消费进度，只能从头或从最新位置开始消费。MM2 基于 Connect，额外内置了两个专用连接器——`MirrorCheckpointConnector` 定期读取源集群消费组的 Offset 并写入目标集群的 checkpoint 主题，`MirrorSourceConnector` 在复制消息的同时把源 Offset 翻译成目标集群的 Offset。也就是说，MM2 在复制「消息」之外，额外维护了一条复制「消费进度」的通道。

## 7. 跨集群复制场景

### 7.1 场景1：跨数据中心复制
```properties
# 配置双向复制
east->west.enabled=true
west->east.enabled=true

# 使用主题前缀避免循环复制
replication.policy.class=org.apache.kafka.connect.mirror.DefaultReplicationPolicy
```

双向复制时，从 east 复制到 west 的消息如果不标记来源，会被 west 当成自己的新消息再复制回 east，形成无限循环。`DefaultReplicationPolicy` 给复制来的主题加前缀（如 `east.my-topic`），再通过 `topics.exclude` 把带前缀的主题排除在反向复制之外，从而切断循环。

### 7.2 场景2：灾难恢复
```properties
# 配置单向复制（主集群 → 灾备集群）
primary->backup.enabled=true
backup->primary.enabled=false

# 灾备集群只读
# 激活灾备时，切换生产者到灾备集群
```

### 7.3 场景3：数据迁移
```properties
# 从旧集群迁移到新集群
old->new.enabled=true

# 迁移完成后，切换客户端到新集群
# 验证数据一致性后，关闭旧集群
```

## 8. MirrorMaker2 监控

```bash
# 查看复制状态
curl -s http://localhost:8083/connectors | jq .

# 查看特定 MirrorMaker 连接器状态
curl -s http://localhost:8083/connectors/east->west.MirrorHeartbeatConnector/status | jq .
curl -s http://localhost:8083/connectors/east->west.MirrorCheckpointConnector/status | jq .
curl -s http://localhost:8083/connectors/east->west.MirrorSourceConnector/status | jq .

# 关键监控指标
# - replication-latency-ms：复制延迟
# - replication-latency-records：复制记录数
# - checkpoint-latency-ms：Checkpoint 延迟
```

## 9. 其他复制工具

| 工具 | 说明 | 适用场景 |
|------|------|----------|
| MirrorMaker2 | 官方推荐，基于 Connect | 跨集群复制 |
| Uber uReplicator | Uber 开发，高可用 | 大规模复制 |
| LinkedIn Brooklin | LinkedIn 开发，实时复制 | 实时数据管道 |
| Confluent Replicator | 商业版，支持更多功能 | 企业级复制 |

## 10. 最佳实践

1. **使用 MirrorMaker2**：官方推荐，功能完善，社区活跃。
2. **监控复制延迟**：确保灾备集群的数据与主集群保持同步。
3. **避免循环复制**：使用主题前缀或排除规则，防止消息在集群间无限循环。
4. **定期测试灾备切换**：确保灾备集群可以在需要时正常接管业务。
