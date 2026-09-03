# 灾备演练与切换流程

> 前置知识：[§2 MM2 架构](./chapter-02-mirrormaker2.md)、[§3 Offset 翻译](./chapter-03-offset-translation.md)。本文只讲**真正切换那一刻的操作序列**——大多数灾备事故不是"MM2 没配置好"，而是"事到临头顺序错了"。

灾备的目标不是"复制部署完成"，而是"在演练里验证过切换能在既定 RTO 内完成"。演练本身就是可复用的 runbook。

## 1. 前置准备清单

在做第一次切换演练前，以下都要落地。缺一项就先补齐。

**基础设施**：

- Primary 与 Backup 集群独立部署，至少不在同一机房 / 可用区。
- MM2 集群独立部署（不要和任一 Kafka 集群共宿主机）。
- MM2 到 Backup 的网络延迟 < 到 Primary 的延迟（部署位置**贴近目标**）。

**配置侧**：

- `replication.factor >= 3`、`checkpoints/heartbeats/offset-syncs.topic.replication.factor = 3`。
- `emit.checkpoints.interval.seconds` 调到 10 秒。
- Active-Standby 场景开启 `sync.group.offsets.enabled=true`。
- 关键 topic 的 `min.insync.replicas=2`。

**监控侧**（详见 §6）：

- 端到端复制延迟（heartbeat topic timestamp 差）
- offset-syncs / checkpoints topic 的写入速率
- MM2 Connector 的 `status=RUNNING`

**业务侧**：

- 所有生产者 / 消费者知道 Backup 的 bootstrap.servers。
- Backup 集群预先创建好业务需要的 ACL、Schema Registry 已切换或联邦。
- 应用配置支持热切换 bootstrap.servers（配置中心 / 环境变量下发）。

## 2. 常规切换流程（Active-Standby）

**背景**：Primary 集群故障（机房断电、大规模网络分区、集群不可写），需切到 Backup。

### 步骤 1：确认切换触发条件

**判定标准**（任一满足）：

- Primary 集群完全无响应超过 5 分钟（先看是否是网络抖动）
- Primary broker 半数以上不可用且预计恢复时间 > SLA 允许的 RTO
- 数据面已损坏（`unclean.leader.election` 发生后数据不一致）

**执行前**：先在监控看板确认 Backup 集群健康、MM2 上一次 checkpoint 时间在允许范围（比如 1 分钟内）。

### 步骤 2：切断 Primary（防脑裂）

如果 Primary 只是网络分区、broker 还在跑，切换后老生产者继续写 Primary 会造成两侧数据分叉。做法：

- 网络层：在 LB / DNS / 网关层封锁到 Primary 的连接
- 或应用层：通过配置中心把 bootstrap 强制指向 Backup

**目的是让 Primary 变成"不可写"**，不需要真的关机。

### 步骤 3：停止 MM2 复制到 Backup

```bash
# 停止 MM2 集群
systemctl stop mirror-maker

# 或者只 pause 相关 Connector
curl -X PUT http://mm2-worker:8083/connectors/primary->backup.MirrorSourceConnector/pause
```

**原因**：切换后 Backup 变成新的主集群，如果 MM2 还在跑，Primary 里残留的还没复制完的消息会继续追加到 Backup，与新写入的消息交错，造成 offset 混乱。

### 步骤 4：确认 offset 已同步

如果开启了 `sync.group.offsets.enabled=true`，检查 Backup 上 `__consumer_offsets` 是否有目标 group 的最新记录：

```bash
kafka-consumer-groups.sh \
  --bootstrap-server kafka-backup:9092 \
  --describe --group order-service
```

看到的 `CURRENT-OFFSET` 应接近 Primary 挂之前的最后一次提交。如果差得多，说明 checkpoints 还没来得及同步，需要人工用 `RemoteClusterUtils` 补一次。

### 步骤 5：切生产者到 Backup

配置中心下发新的 `bootstrap.servers = kafka-backup:9092`。生产者应用热重载（不重启也可以，只要客户端支持配置刷新）。

**验证**：`kafka-console-consumer.sh` 观察 Backup 上业务 topic 有新消息写入。

### 步骤 6：切消费者到 Backup

三种 offset 起点方案任选：

- 有 `sync.group.offsets`：直接改 bootstrap，Backup 上 `__consumer_offsets` 已有起点。
- 无 `sync.group.offsets` 但有 checkpoints：应用启动时调 `RemoteClusterUtils.translateOffsets` 手工 seek。
- 都没有：`auto.offset.reset=latest`，接受历史丢失；或 `earliest`，接受重复消费 + 幂等。

**验证**：`kafka-consumer-groups.sh --describe` 观察 LAG 从当前值开始正常下降。

### 步骤 7：宣告切换完成

监控 5 分钟以上，确认：

- 生产成功率恢复正常
- 消费 LAG 稳定或下降
- 无异常报警

**RTO 目标**：从步骤 1 触发到步骤 7 完成，一般应在 15 分钟内。演练能达到 5 分钟以内的团队才算合格。

## 3. 回切流程（Failback）

Primary 恢复后要不要切回来？两种策略：

**策略 A：不回切**。Primary 恢复后作为新的 Backup。运维复杂度低，缺点是每次故障后角色互换，机房间流量分布慢慢偏离规划。

**策略 B：回切**。Primary 恢复后主动切回。步骤是"切换流程"的镜像，但**要多一步同步反向数据**：

```txt
故障期间 Backup 累积的新数据
        │
        ▼
反向复制到 Primary（新增一条 backup → primary 的 flow）
        │
        ▼
   数据追平后
        │
        ▼
   按 §2 的顺序反向切一次
```

反向 flow 平时不 enable。真要用时临时打开：

```properties
# 临时打开反向复制，等追平后再切
backup->primary.enabled = true
backup->primary.topics  = orders,payments,inventory-.*
```

**注意**：反向复制过来的 topic 在 Primary 上叫 `backup.orders`——回切后要么应用适配前缀，要么用 `IdentityReplicationPolicy`（但要小心循环）。

## 4. Runbook 模板

一份可打印的 A4 单页 runbook 应该包含：

```markdown
## 切换到 Backup - 一页速查

### 触发条件（任一）
- [ ] Primary 完全无响应 > 5 min
- [ ] Primary broker 半数以上不可用
- [ ] Primary 数据不一致（unclean election 事件）

### 联系人
- Kafka on-call: <电话>
- DBA on-call:   <电话>
- 通信渠道:      <IM 群号>

### 执行步骤
1. [ ] 监控确认 Backup 健康、MM2 last checkpoint < 1 min
2. [ ] 网关封锁到 Primary 的连接
3. [ ] `systemctl stop mirror-maker` (MM2 集群 3 台)
4. [ ] `kafka-consumer-groups.sh --describe` 检查 offset
5. [ ] 配置中心下发 bootstrap = kafka-backup:9092
6. [ ] 观察 producer 写入 Backup 成功
7. [ ] 应用重启（或热重载）触发 consumer 切换
8. [ ] `kafka-consumer-groups.sh --describe` 观察 LAG 下降
9. [ ] 5 分钟观察期，无异常则宣告完成

### 命令速查
kafka-consumer-groups.sh --bootstrap-server kafka-backup:9092 \
  --describe --group <group-id>

kafka-topics.sh --bootstrap-server kafka-backup:9092 \
  --describe --topic <topic-name>
```

## 5. 演练频率与验收

生产集群建议按以下节奏：

| 周期 | 内容 | 目的 |
| :-- | :-- | :-- |
| 每季度 | 完整切换演练（`ChaosMonkey` 关 Primary） | 验证 runbook 可执行 |
| 每月 | 只跑 §2 步骤 4~6（不真断 Primary） | 验证 offset 同步链路 |
| 每周 | 监控告警联调（模拟 MM2 停止告警） | 验证告警能到人 |

**演练验收标准**：从"触发决策"到"业务恢复"总用时 ≤ RTO 目标。

## 6. 监控关键指标

以下指标必须上告警。数据来自 [KIP-382 的 metrics 定义](https://cwiki.apache.org/confluence/display/KAFKA/KIP-382%3A+MirrorMaker+2.0)：

| 指标 | 说明 | 告警阈值 |
| :-- | :-- | :-- |
| `replication-latency-ms-max` | 端到端复制延迟最大值 | > 30s 持续 5 min |
| `record-age-ms-max` | 消息从 produce 到被 MM2 消费的时间 | > 60s |
| MirrorSourceConnector `status` | Connector 状态 | ≠ RUNNING |
| MirrorCheckpointConnector `checkpoint-latency-ms` | Checkpoint 端到端延迟 | > 1 min |
| MM2 → Backup 网络 RTT | Ping 延迟 | 突增 5×基线 |
| Backup 端 `<source>.<topic>` 分区数 | 与 Primary 是否一致 | 不一致立即告警 |

## 7. 常见教训

**教训一：演练与真实故障最大的差异是"决策时间"**。演练时大家都知道要切；真实故障里，团队会花大量时间讨论"是切还是等 Primary 恢复"。runbook 里的触发条件要写得让 on-call 敢在 5 分钟内拍板。

**教训二：忘记切 Schema Registry**。Kafka 切了，Schema Registry 没切——反序列化全部失败。Schema Registry 也需要跨集群方案（联邦 / 主备）。

**教训三：MM2 在故障期间没停**。切完之后 MM2 还在从"半死"的 Primary 拉消息追加到 Backup，会污染新数据。切换步骤里"停 MM2"必须在"切 Producer"之前。

**教训四：应用 hardcode bootstrap 地址**。任何一个组件把 bootstrap 写死在代码里都会成为切换失败的单点。所有客户端必须走配置中心或环境变量。
