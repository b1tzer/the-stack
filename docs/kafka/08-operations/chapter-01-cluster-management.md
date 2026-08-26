# 集群管理

## 1. Topic 管理

```bash
# 创建 Topic
kafka-topics.sh --create --topic my-topic --partitions 3 --replication-factor 3 --bootstrap-server localhost:9092

# 查看 Topic
kafka-topics.sh --describe --topic my-topic --bootstrap-server localhost:9092

# 修改分区
kafka-topics.sh --alter --topic my-topic --partitions 6 --bootstrap-server localhost:9092

# 删除 Topic
kafka-topics.sh --delete --topic my-topic --bootstrap-server localhost:9092
```

## 2. 配置管理

```bash
# 查看配置
kafka-configs.sh --describe --entity-type topics --entity-name my-topic --bootstrap-server localhost:9092

# 修改配置
kafka-configs.sh --alter --entity-type topics --entity-name my-topic --add-config retention.ms=86400000 --bootstrap-server localhost:9092
```

## 3. 分区重分配

```bash
# 生成重分配计划
kafka-reassign-partitions.sh --generate --topics-to-move-json-file topics.json --broker-list 1,2,3 --bootstrap-server localhost:9092

# 执行重分配
kafka-reassign-partitions.sh --execute --reassignment-json-file plan.json --bootstrap-server localhost:9092
```

## 4. Topic 配置管理

```bash
# 查看 Topic 配置
kafka-configs.sh --describe --entity-type topics --entity-name my-topic \
    --bootstrap-server localhost:9092

# 修改保留时间
kafka-configs.sh --alter --entity-type topics --entity-name my-topic \
    --add-config retention.ms=86400000 --bootstrap-server localhost:9092

# 修改最大消息大小
kafka-configs.sh --alter --entity-type topics --entity-name my-topic \
    --add-config max.message.bytes=10485760 --bootstrap-server localhost:9092

# 删除配置（恢复默认）
kafka-configs.sh --alter --entity-type topics --entity-name my-topic \
    --delete-config retention.ms --bootstrap-server localhost:9092
```

## 5. 分区重分配详解

```bash
# 1. 生成重分配计划
cat > topics-to-move.json << 'EOF'
{"version": 1, "topics": [{"topic": "my-topic"}]}
EOF

kafka-reassign-partitions.sh --generate \
    --topics-to-move-json-file topics-to-move.json \
    --broker-list 1,2,3 \
    --bootstrap-server localhost:9092 > reassignment-plan.json

# 2. 执行重分配
kafka-reassign-partitions.sh --execute \
    --reassignment-json-file reassignment-plan.json \
    --bootstrap-server localhost:9092

# 3. 验证重分配
kafka-reassign-partitions.sh --verify \
    --reassignment-json-file reassignment-plan.json \
    --bootstrap-server localhost:9092
```

## 6. 集群扩缩容

### 6.1 扩容（添加 Broker）
```bash
# 1. 启动新 Broker
kafka-server-start.sh config/server-new.properties

# 2. 生成重分配计划（将部分分区迁移到新 Broker）
kafka-reassign-partitions.sh --generate \
    --topics-to-move-json-file topics.json \
    --broker-list 1,2,3,4  # 包含新 Broker
    --bootstrap-server localhost:9092

# 3. 执行重分配
kafka-reassign-partitions.sh --execute \
    --reassignment-json-file plan.json \
    --bootstrap-server localhost:9092
```

### 6.2 缩容（移除 Broker）
```bash
# 1. 生成重分配计划（将分区从旧 Broker 迁移走）
kafka-reassign-partitions.sh --generate \
    --topics-to-move-json-file topics.json \
    --broker-list 1,2,3  # 不包含要移除的 Broker
    --bootstrap-server localhost:9092

# 2. 执行重分配
kafka-reassign-partitions.sh --execute \
    --reassignment-json-file plan.json \
    --bootstrap-server localhost:9092

# 3. 验证所有分区已迁移
kafka-topics.sh --describe --bootstrap-server localhost:9092

# 4. 关闭旧 Broker
kafka-server-stop.sh
```

## 7. Leader 重平衡

```bash
# 自动重平衡（推荐）
# server.properties
auto.leader.rebalance.enable=true
leader.imbalance.per.broker.percentage=10

# 手动重平衡
kafka-preferred-replica-election.sh --bootstrap-server localhost:9092
```

## 8. 集群健康检查脚本

```bash
#!/bin/bash
# kafka-health-check.sh
BOOTSTRAP="localhost:9092"

echo "=== Broker 状态 ==="
kafka-broker-api-versions.sh --bootstrap-server $BOOTSTRAP | head -5

echo "\n=== Under Replicated Partitions ==="
kafka-topics.sh --describe --under-replicated --bootstrap-server $BOOTSTRAP

echo "\n=== 离线分区 ==="
kafka-topics.sh --describe --unavailable-partitions --bootstrap-server $BOOTSTRAP

echo "\n=== 消费者组 Lag ==="
kafka-consumer-groups.sh --list --bootstrap-server $BOOTSTRAP | while read group; do
    echo "Group: $group"
    kafka-consumer-groups.sh --describe --group $group --bootstrap-server $BOOTSTRAP 2>/dev/null | head -5
done
```

## 9. 最佳实践

1. **定期执行健康检查**：使用脚本自动化检查集群状态，及时发现问题。
2. **避免在线高峰期进行重分配**：分区重分配会占用大量网络和磁盘 I/O。
3. **使用 --throttle 限制重分配速度**：避免影响正常业务。
4. **备份元数据**：定期备份 ZooKeeper 或 KRaft 元数据。
