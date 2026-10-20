# 集群管理

> 集群管理覆盖 Topic 生命周期、配置调整、分区迁移与容量扩缩容。分区重平衡、Leader 选举等机制原理见 [副本复制与 ISR](../02-core/chapter-04-replication-and-isr.md) 与 [Controller 与 KRaft](../02-core/chapter-08-controller-and-kraft.md)；本文只写怎么配、怎么查、怎么调。

## 1. Topic 管理

```bash
# 创建 Topic
kafka-topics.sh --create --topic my-topic --partitions 3 --replication-factor 3 --bootstrap-server localhost:9092

# 查看 Topic
kafka-topics.sh --describe --topic my-topic --bootstrap-server localhost:9092

# 增加分区（只能增不能减）
kafka-topics.sh --alter --topic my-topic --partitions 6 --bootstrap-server localhost:9092

# 删除 Topic
kafka-topics.sh --delete --topic my-topic --bootstrap-server localhost:9092
```

增加分区不会迁移已有消息，但会改变默认分区器对 Key 的映射：同一个 Key 在扩容前后的消息可能进入不同分区，而 Kafka 只保证单个分区内的顺序，不保证跨分区顺序。依赖同一 Key 消息顺序的业务，应在扩容前评估影响，见 [分区与 Offset](../02-core/chapter-01-partition-and-offset.md)。另外，使用 `auto.offset.reset=latest` 的消费者，在新分区被分配前产生的消息可能被跳过，扩容前应一并评估。

## 2. 配置管理

Topic 级配置用 `kafka-configs.sh` 查看与修改。Topic 未显式设置某项时，Kafka 使用该项对应的 Broker 默认值；支持动态集群默认配置的项目，还需考虑动态默认值。删除 Topic 级覆盖后，配置恢复为适用的默认值，而不一定是某个固定常量。

```bash
# 查看 Topic 配置
kafka-configs.sh --describe --entity-type topics --entity-name my-topic \
    --bootstrap-server localhost:9092

# 修改保留时间（24 小时）
kafka-configs.sh --alter --entity-type topics --entity-name my-topic \
    --add-config retention.ms=86400000 --bootstrap-server localhost:9092

# 修改最大消息大小（10 MiB）
kafka-configs.sh --alter --entity-type topics --entity-name my-topic \
    --add-config max.message.bytes=10485760 --bootstrap-server localhost:9092

# 删除配置（恢复默认）
kafka-configs.sh --alter --entity-type topics --entity-name my-topic \
    --delete-config retention.ms --bootstrap-server localhost:9092
```

## 3. 分区重分配

分区重分配把分区及其副本从一组 Broker 迁到另一组，用于均衡负载、替换故障磁盘或配合扩缩容。完整流程是：生成计划 → 检查并执行 → 验证。

```bash
# 1. 准备待迁移的 Topic 列表
cat > topics-to-move.json << 'EOF'
{"version": 1, "topics": [{"topic": "my-topic"}]}
EOF

# 2. 生成候选方案，输出含当前分配与建议分配，先保存供人工检查
kafka-reassign-partitions.sh --generate \
    --topics-to-move-json-file topics-to-move.json \
    --broker-list 1,2,3 \
    --bootstrap-server localhost:9092 > reassignment-output.txt

# 3. 从输出中取出 Proposed partition reassignment configuration 后面的 JSON，
#    单独保存为 reassignment-plan.json，并核对每个分区的目标副本列表
kafka-reassign-partitions.sh --execute \
    --reassignment-json-file reassignment-plan.json \
    --bootstrap-server localhost:9092

# 4. 验证重分配是否完成
kafka-reassign-partitions.sh --verify \
    --reassignment-json-file reassignment-plan.json \
    --bootstrap-server localhost:9092
```

`--generate` 的输出包含当前分配与建议分配两段说明性文字，不是可直接执行的纯 JSON。必须先取出 `Proposed partition reassignment configuration` 后面的 JSON 单独保存，再喂给 `--execute`，否则会因文件格式错误而失败；提取后确认保存的是标题后完整的 JSON 对象、`partitions` 中的目标副本列表完整。重分配期间目标副本尚未追上 Leader 时，分区可能暂时处于欠副本状态，应结合重分配进度与 ISR 变化判断是否正常；若欠副本持续存在或离线分区增加，应暂停后续扩缩容或新的重分配操作，先检查正在进行的任务与分区状态，再决定继续、调整还是取消，见 [ISR 频繁收缩](../05-troubleshooting/chapter-02-isr-shrink.md)。`--broker-list` 中的编号是 Broker `broker.id`（或 KRaft 节点 id），不是主机名。

## 4. 集群扩缩容

扩缩容前先确认集群没有离线分区、持续欠副本或进行中的重分配任务，并核对目标 Broker 的磁盘容量、网络与副本放置约束。集群已有复制异常时，不应直接叠加大规模迁移，应先确认异常范围与剩余副本可用性，再决定是否继续。

### 4.1 扩容（添加 Broker）

```bash
# 1. 启动新 Broker
kafka-server-start.sh config/server-new.properties

# 2. 生成候选方案（broker-list 包含新 Broker），输出保存供检查
# topics.json 内容同上文 topics-to-move.json
kafka-reassign-partitions.sh --generate \
    --topics-to-move-json-file topics.json \
    --broker-list 1,2,3,4 \
    --bootstrap-server localhost:9092 > plan-output.txt

# 3. 取出建议的 JSON 保存为 plan.json，核对后执行
kafka-reassign-partitions.sh --execute \
    --reassignment-json-file plan.json \
    --bootstrap-server localhost:9092

# 4. 验证
kafka-reassign-partitions.sh --verify \
    --reassignment-json-file plan.json \
    --bootstrap-server localhost:9092
```

新 Broker 加入后，已有分区的副本不会自动迁入该节点。若扩容目的是增加容量或分摊负载，需按各 Broker 的磁盘占用、分区数量与流量分布制定重分配计划，不能只按 Broker 数量平均分配。生成与提取执行文件的注意事项见上文第 3 节。

### 4.2 缩容（移除 Broker）

```bash
# 1. 盘点待移除 Broker 上的全部分区副本，把需要迁移的所有 Topic 写入 topics.json
#    （topics.json 只含 my-topic 时，其他 Topic 的副本不会自动迁走）
# 2. 生成候选方案（broker-list 不包含待移除的 Broker）
kafka-reassign-partitions.sh --generate \
    --topics-to-move-json-file topics.json \
    --broker-list 1,2,3 \
    --bootstrap-server localhost:9092 > plan-output.txt

# 3. 取出建议的 JSON 保存为 plan.json，核对目标副本列表后执行
kafka-reassign-partitions.sh --execute \
    --reassignment-json-file plan.json \
    --bootstrap-server localhost:9092

# 4. 验证重分配任务完成
kafka-reassign-partitions.sh --verify \
    --reassignment-json-file plan.json \
    --bootstrap-server localhost:9092

# 5. 确认待移除 Broker 已不出现在任何分区的副本列表中
kafka-topics.sh --describe --bootstrap-server localhost:9092

# 6. 关闭旧 Broker
kafka-server-stop.sh
```

`--generate` 按 Topic 生成方案，会重新安排该 Topic 的全部分区，而不只迁走待移除 Broker 上的副本，因此生成后要检查全部目标分配，确认没有引入不必要的副本迁移。关闭 Broker 前必须确认该节点已不再承载任何分区副本，且重分配任务已完成。若仍有副本留在该节点，停机可能使相关分区欠副本；剩余可用副本不足时还可能导致分区离线。不要仅凭 `--execute` 返回成功就停机。

## 5. Leader 重平衡

分区默认按 preferred replica 选举 Leader。Broker 重启或重分配后，Leader 可能长期堆在少数 Broker 上，可用自动或手动方式拉回。

```properties
# server.properties：自动重平衡
auto.leader.rebalance.enable=true
leader.imbalance.per.broker.percentage=10
leader.imbalance.check.interval.seconds=300
```

```bash
# 手动触发 preferred replica 选举（全部分区）
kafka-leader-election.sh --election-type preferred --all-topic-partitions \
    --bootstrap-server localhost:9092
```

`leader.imbalance.per.broker.percentage=10` 控制 Broker 上 Leader 失衡的容许比例，Controller 按 `leader.imbalance.check.interval.seconds` 指定的周期检查，超过阈值时才触发自动平衡。这项操作只调整 Leader 分布，不重新分配副本，也不能修复 ISR 异常。手动触发前先确认相关分区的 preferred replica 已在 ISR 中；若不在 ISR 中，这次选举无法把 Leader 切到该副本，应先排查副本同步问题，而不是把首选副本选举当作修复副本落后的手段。

## 6. 集群健康检查

日常巡检可先看欠副本、离线分区与消费 Lag：

```bash
#!/bin/bash
# kafka-health-check.sh
BOOTSTRAP="localhost:9092"

echo "=== Broker 状态 ==="
kafka-broker-api-versions.sh --bootstrap-server $BOOTSTRAP

echo ""
echo "=== Under Replicated Partitions ==="
kafka-topics.sh --describe --under-replicated-partitions --bootstrap-server $BOOTSTRAP

echo ""
echo "=== 离线分区 ==="
kafka-topics.sh --describe --unavailable-partitions --bootstrap-server $BOOTSTRAP

echo ""
echo "=== 消费者组 Lag ==="
kafka-consumer-groups.sh --list --bootstrap-server $BOOTSTRAP | while read group; do
    echo "Group: $group"
    kafka-consumer-groups.sh --describe --group "$group" --bootstrap-server $BOOTSTRAP
done
```

以上脚本只用于快速查看集群状态，不替代生产监控告警，也不等于健康检查通过：`kafka-broker-api-versions.sh` 查询的是各 Broker 支持的 API 版本，不能据此判定所有 Broker 都正常；欠副本与离线分区在正常集群中应为零。消费 Lag 应结合增长趋势与业务处理能力判断，具体排查见 [消费者 Lag 过大](../05-troubleshooting/chapter-01-consumer-lag.md)。持续监控方案见 [监控](chapter-01-monitoring.md)。
