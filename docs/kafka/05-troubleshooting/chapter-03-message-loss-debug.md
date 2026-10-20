# 消息丢失排查

> 消息丢失的排查需要按环节逐一检查。本文是一个实操排查指南。

## 1. 现象

- 消费者处理的消息数量少于生产者发送的数量
- 下游系统缺少预期的数据

## 2. 排查步骤

### Step 1：确认丢失环节

```bash
# 获取各分区 Offset 边界（log end offset），不是全局消息数量
kafka-run-class.sh kafka.tools.GetOffsetShell \
    --broker-list localhost:9092 --topic my-topic --time -1
```

GetOffsetShell 返回的是各分区的 Offset 边界，不是全局连续的消息计数，不能直接与生产者发送计数相减来定责。定位丢失环节需要端到端证据：

- 生产端：核对发送记录与发送回调，确认生产者是否收到成功确认（受 acks 语义约束，acks=0 时不等待 Broker 确认）
- Broker 侧：按分区核对消费者可见的记录，注意保留策略删除与日志压缩会改变可读记录数，不把 Offset 区间长度当作记录数
- 消费端：核对已提交 Offset、实际处理记录与下游持久化结果是否一致

### Step 2：检查生产端

```bash
kafka-topics.sh --describe --topic my-topic --bootstrap-server localhost:9092
```

检查项：

| 检查项 | 关注点 |
| :-- | :-- |
| Replication Factor | 部署配置，为 1 时无法抵御副本永久损坏，但大于 1 也不自动保证不丢 |
| ISR 列表长度 | 运行状态，短暂小于副本数不等于已丢数据，需观察变化趋势 |
| min.insync.replicas | 写入约束，需结合 acks=all 与写入时实际 ISR 数量判断 |

### Step 3：检查消费端

```bash
kafka-consumer-groups.sh --describe --group my-group --bootstrap-server localhost:9092
```

检查项：

| 信号 | 需要进一步核实 |
| :-- | :-- |
| CURRENT-OFFSET | 为 -1 通常表示该分区无可用已提交位置，新消费组、尚未提交都可能出现，不代表已丢失 |
| 提交时机 | 风险在于提交进度领先于业务实际处理完成的位置，而非自动提交本身 |

### Step 4：检查 Broker 日志

先确定缺失消息所在分区与时间窗口，再检索对应 Broker 的日志，核对 Leader 变更、ISR 收缩、写入失败是否发生在同一时间段：

```bash
grep -iE "unclean|NotEnoughReplicas" /var/kafka-logs/server.log
```

NotEnoughReplicas 说明写入被拒绝，不等于已丢数据；UncleanLeader 选举需与具体分区、Leader 变更时间和数据缺口关联。仅凭关键词命中不能下结论，日志无法确认时需进一步核对分区日志与业务消息 ID。

## 3. 可靠性配置核查

```properties
# 生产者
acks=all
enable.idempotence=true

# 消费者
enable.auto.commit=false
```

配置调整不能补回已经丢失的数据。分三处核查：

- 生产者：核对 `acks=all`、幂等配置及发送失败处理
- 现有 Topic：核对实际副本因子、`min.insync.replicas` 与当前 ISR，需要时单独执行副本扩容；`default.replication.factor` 只影响未显式指定副本因子的自动创建 Topic，不会改动已有 Topic
- Broker：核对 `unclean.leader.election.enable`，建议设为 false；这是以可用性为代价降低丢数据风险的选择，并非所有场景唯一正确的值

已确认存在数据缺口时，依据生产者记录、备份或上游数据源恢复，不能把参数调整当作数据恢复手段。

详见 [消息丢失](../03-reliability/chapter-01-message-loss.md)。
