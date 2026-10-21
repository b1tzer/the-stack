# 灾备演练与切换流程

> 前置知识：[§2 MM2 架构](./chapter-02-mirrormaker2.md)、[§3 Offset 翻译](./chapter-03-offset-translation.md)。本文覆盖切换、回切与演练流程，重点讲切换前的写入隔离、消费位点恢复，以及切换后的业务验证。灾备事故往往不在 MM2 配置，而在切换那一刻的操作顺序。

灾备的目标不是"复制部署完成"，而是"在演练里验证过切换能在既定 RTO 内完成"。MM2 部署完成只代表复制链路就绪，只有经过切换演练，验证了数据恢复点、业务恢复时间和回切流程，才能确认方案满足既定 RPO 与 RTO。演练步骤与验收结果应沉淀进 runbook。

## 1. 前置准备清单

在做第一次切换演练前，先把以下条件落地。其中"基础设施"与"配置侧"缺失会直接影响切换安全，"业务侧"未就绪会导致切换后业务不可用。

**基础设施**：

- Primary 与 Backup 集群独立部署，至少不在同一机房 / 可用区。
- MM2 集群独立部署（不要和任一 Kafka 集群共宿主机）。
- MM2 部署在贴近目标集群的一侧（官方推荐把 MM2 放在目标集群附近），同时保证到源、目标两侧的网络满足复制吞吐与延迟要求。部署位置结合跨机房带宽、网络稳定性与目标集群写入能力确定，不单纯以两侧 RTT 大小关系作为标准。

**配置侧**：

- 业务 topic 与 MM2 内部 topic（`checkpoints`、`heartbeats`、`offset-syncs`）的副本数按集群规模与故障域设置，常见生产取 3，前提是集群有足够 broker 且副本能分散到预期故障域。这几个内部 topic 的副本数是各自独立的配置项，不存在一个合并的 `checkpoints/heartbeats/offset-syncs.topic.replication.factor` 属性。
- `emit.checkpoints.interval.seconds`：常见默认 60 秒，可缩短到 10 秒以更频繁生成 checkpoint。它只决定 checkpoint 生成频率，不能保证故障时位点丢失窗口不超过该周期，实际恢复点仍受复制延迟与位点映射影响。
- Active-Standby 场景开启 `sync.group.offsets.enabled=true`。
- 关键 topic 的 `min.insync.replicas=2`，并配套生产者 `acks=all`（[ISR 与副本机制](../02-core/chapter-04-replication-and-isr.md#isr-definition)）。`min.insync.replicas` 主要约束 `acks=all` 请求所需的最小 ISR 数量，生产者用 `acks=1` 时得不到同等的写入确认保障。副本数、`min.insync.replicas` 与生产者 `acks` 应作为一组检查项，通过故障演练验证。

**监控侧**（详见 §6，通用告警与看板搭建见[监控体系](../06-operations/chapter-01-monitoring.md)）：

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

先区分两个概念，切换决策必须同时以二者为准：

- **RTO**：业务允许多长时间不恢复。
- **RPO**：业务允许丢失多长时间范围内的数据。

**判定标准**（任一满足，均为团队按业务评估的阈值，不是 Kafka 的通用判断）：

- Primary 集群完全无响应超过 5 分钟（先排除网络抖动；5 分钟是示例参数，需按业务 RTO 与故障检测时间评估）。
- Primary 无法承接业务写入、且预计恢复时间 > SLA 允许的 RTO。注意"broker 半数以上不可用"不等于集群不可写，是否还能写入取决于分区 Leader、ISR 与业务所需分区是否可用。

发生 `unclean.leader.election`（参见[Unclean Leader 选举](../02-core/chapter-04-replication-and-isr.md#unclean-leader-election)）不是直接切换的充分条件。它说明非 ISR 副本被选为 Leader、可能丢失已确认但未复制的记录，应作为触发数据完整性评估的信号：结合选举前后日志与业务数据确认是否发生实际丢失、影响范围多大。评估发现数据风险或业务影响达到预定阈值，再进入切换决策，而不是看到事件就切。

**切换决策记录**：确认业务影响、预计恢复时间、Backup 的复制进度和可接受的数据损失范围，记录决策时间与批准人。若无法确认 Backup 数据状态，先评估恢复方案，不把切换本身当作数据恢复的保证。

**执行前**：先在监控看板确认 Backup 集群健康，并核对 MM2 最近一次 checkpoint 的生成时间（示例：1 分钟内生成过 checkpoint）。

### 步骤 2：切断 Primary（防脑裂）

如果 Primary 只是网络分区、broker 还在跑，切换后老生产者继续写 Primary 会造成两侧数据分叉。做法：

- 网络层：在 LB / DNS / 网关层封锁到 Primary 的连接
- 或应用层：通过配置中心把 bootstrap 强制指向 Backup

目标是建立单写入边界：停止或隔离所有指向 Primary 的业务写入路径，并验证旧主不再接受业务写入。仅修改 DNS、负载均衡或配置中心不构成充分证明，还需检查直连地址、已有连接与其他写入入口。无法确认旧主已被可靠隔离前，不应让 Backup 进入正式写入状态。隔离与客户端切换是两件事：前者防止继续写旧主，后者让应用开始连 Backup。

### 步骤 3：停止 MM2 复制到 Backup

```bash
# 停止 MM2 集群（按实际部署方式执行，systemctl 仅适用于用它管理 MM2 的环境）
systemctl stop mirror-maker

# 或者只 pause 实际配置中的源到目标 Connector（URL 要加引号，否则 -> 会被 shell 当成重定向）
curl -X PUT \
  'http://mm2-worker:8083/connectors/<connector-name>/pause'

# 检查暂停是否生效
curl 'http://mm2-worker:8083/connectors/<connector-name>/status'
```

`<connector-name>` 要替换为实际名称，不能照抄示例。pause 是异步操作，REST API 返回成功不代表所有 Task 已进入 PAUSED 状态，正在处理的任务可能还需时间完成暂停。多个 Connect Worker 场景下，应确认相关 Connector 及其 Task 均已进入预期状态、且目标集群不再收到该复制方向的新记录，再进入下一步。注意直接 `systemctl stop` 会停掉该 MM2 服务承载的所有复制方向，不只 Primary → Backup。

**原因**：切换后 Backup 变成新的主集群。此时要保证的是旧方向的复制不会再改变新主的数据流，以及旧主不再接受业务写入。旧主里尚未复制完的消息是否还要继续复制，取决于切换策略与恢复点判断，不能一概描述成"新旧消息交错导致 offset 混乱"——旧消息被追加本身并不必然导致 offset 混乱，真正的风险是旧主数据越过切换边界进入新主。

### 步骤 4：确认目标集群消费位点

跨集群的 offset 不能直接按数值比较：MM2 复制到 Backup 的记录，其本地 offset 与源集群 offset 未必相同，需要靠 checkpoint 的位点映射换算。另外，`sync.group.offsets.enabled=true` 只会在目标集群没有该 group 的活跃消费者时才自动同步位点，它不保证故障发生时目标上一定有最新位点。

确认步骤：

1. 先确认目标消费组在 Backup 上没有活跃消费者。
2. 用 `kafka-consumer-groups.sh` 检查该 group 的提交位点（`__consumer_offsets` 是 Kafka 内部 topic，日常检查应通过 consumer-groups 工具，而不是直接读它）：

```bash
kafka-consumer-groups.sh \
  --bootstrap-server kafka-backup:9092 \
  --describe --group order-service
```

输出看不到提交位点时，先区分是消费组不存在、没有有效已提交 offset、仍有活跃消费者，还是目标集群缺少完整 checkpoint 映射，这几种情况的处理方式不同，不要合并成"位点缺失或过旧"。

3. 结合最新 checkpoint 与位点映射，判断消费起点是否符合预期。若目标位点缺失或过旧，在启动消费者前用 `RemoteClusterUtils.translateOffsets` 获取转换后的位点，并核对 topic、partition 与消费起点。`translateOffsets` 是位点转换工具而非任意补齐命令，它依赖已有 checkpoint，调用成功也不代表映射覆盖了所有需要恢复的分区。转换结果还要进一步确认每个分区都有可用映射、转换后的 offset 在目标分区有效范围内，且业务能接受该起点可能带来的重放或遗漏。无法确认时，不要直接启动生产消费。

### 步骤 5：切生产者到 Backup

配置中心下发新的 `bootstrap.servers = kafka-backup:9092`。生产者应用热重载（不重启也可以，只要客户端支持配置刷新）。

**验证**：`kafka-console-consumer.sh` 观察 Backup 上业务 topic 有新消息写入。

### 步骤 6：切消费者到 Backup

三种 offset 起点方案任选（详见 [§3 Consumer 切换](./chapter-03-offset-translation.md#consumer-switch)）：

- 有 `sync.group.offsets`：改 bootstrap 前仍需确认目标集群存在有效提交位点、且该位点符合恢复策略。配置开启只代表启用了自动同步机制，不代表同步一定成功，也不代表同步出的位点就是源集群的最新消费进度。
- 无 `sync.group.offsets` 但有 checkpoints：应用启动时调 `RemoteClusterUtils.translateOffsets` 手工 seek。
- 都没有：先评估目标集群已有数据范围、业务是否允许重放，再决定消费起点，不要默认选 `latest` 或 `earliest`。`auto.offset.reset` 只在没有有效提交位点时才生效：`latest` 会跳过目标集群中已存在、但业务尚未处理的记录；`earliest` 可能重放已在源集群处理过、且仍保留在目标集群的记录，是否重放取决于目标集群实际存有哪些记录。需要重放时，配合业务幂等或去重机制，并验证其实际覆盖范围——幂等机制有其边界，不能默认业务天然幂等。

**验证**：`kafka-consumer-groups.sh --describe` 观察 LAG 从当前值开始正常下降（[Lag 排查](../05-troubleshooting/chapter-01-consumer-lag.md)）。

### 步骤 7：宣告切换完成

监控 5 分钟以上，确认：

- 生产成功率恢复正常
- 消费 LAG 稳定或下降
- 无异常报警

**停止条件与回退条件**：观察期内若 Backup 写入失败、关键分区缺失、消费位点无法确认，或业务错误率持续高于阈值，应停止后续流量扩展并启动预案。尤其注意：切换后出现异常时，不能简单把 bootstrap.servers 改回 Primary——此时 Backup 可能已产生新业务数据，直接回切会造成两侧数据分叉。任何回切都必须先处理反向数据同步。

**RTO 目标**：从步骤 1 触发到步骤 7 完成，一般应在 15 分钟内。是否达标以既定的 RTO/RPO 与演练验收标准为准。

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

"数据追平"要有可执行的定义，不能只靠"监控显示复制延迟低"判断——延迟低只说明观测到的时延小，不等于所有分区都没有积压或复制失败。追平需同时满足：

- 明确最后写入边界：确定故障期间 Backup 最后一笔业务写入发生在哪条记录，并说明何时停止写入。
- 反向复制覆盖了所有需要恢复的 topic 与 partition，且每个关键分区的必要记录都已复制到 Primary，以分区复制进度或业务数据核对结果为准，不能只凭复制延迟低或 topic 存在判断。
- 已核对关键业务数据，确认不存在尚未复制到 Primary 的记录。

反向 flow 平时不 enable。真要用时临时打开：

```properties
# 临时打开反向复制，等追平后再切
backup->primary.enabled = true
backup->primary.topics  = orders,payments,inventory-.*
```

完成反向复制追平后，先隔离 Backup 的写入，再把生产者和消费者切回 Primary。切换完成前，Backup 仍是唯一允许业务写入的主集群；确认 Primary 已正常承接生产流量后，再调整常态复制方向。

**注意**：反向复制过来的 topic 在 Primary 上叫 `backup.orders`——回切后要么应用适配前缀，要么用 `IdentityReplicationPolicy`（但要小心循环，并额外审查 topic 命名冲突）。

## 4. Runbook 模板

一份可打印的 A4 单页 runbook 应该包含：

```markdown
## 切换到 Backup - 一页速查

### 触发条件（任一）
- [ ] Primary 完全无响应 > 5 min（示例阈值，按业务 RTO 评估）
- [ ] Primary 无法承接业务写入且预计恢复时间 > RTO
- [ ] 发生 unclean election，已评估数据丢失风险

### 联系人
- Kafka on-call: <电话>
- DBA on-call:   <电话>
- 通信渠道:      <IM 群号>

### 执行步骤
1. [ ] 监控确认 Backup 健康、MM2 last checkpoint < 1 min
2. [ ] 网关封锁到 Primary 的连接，并验证 Primary 已停止接受业务写入
3. [ ] 按实际部署方式停止 MM2（systemctl stop mirror-maker 或 pause 对应 Connector）
4. [ ] 核对关键 topic 复制进度，确认目标消费位点符合恢复策略
5. [ ] `kafka-consumer-groups.sh --describe` 检查 offset（先确认目标 group 无活跃消费者）
6. [ ] 配置中心下发 bootstrap = kafka-backup:9092
7. [ ] 观察 producer 写入 Backup 成功
8. [ ] 应用重启（或热重载）触发 consumer 切换，确认消费起点符合恢复策略后再启动
9. [ ] `kafka-consumer-groups.sh --describe` 观察 LAG 下降
10. [ ] 5 分钟观察期，无异常则宣告完成

### 命令速查
kafka-consumer-groups.sh --bootstrap-server kafka-backup:9092 \
  --describe --group <group-id>

kafka-topics.sh --bootstrap-server kafka-backup:9092 \
  --describe --topic <topic-name>
```

## 5. 演练频率与验收

演练频率应根据业务 RTO/RPO、变更频率、故障影响范围与合规要求确定。以下节奏可作为起始计划，再按演练结果调整：

| 周期 | 内容 | 目的 |
| :-- | :-- | :-- |
| 每季度 | 完整切换演练（用故障注入工具关闭或隔离 Primary，故障注入不等于关闭整个集群） | 验证 runbook 可执行 |
| 每月 | 只跑 §2 步骤 4~6（不真断 Primary） | 验证 offset 同步链路 |
| 每周 | 监控告警联调（模拟 MM2 停止告警） | 验证告警能到人 |

**演练验收标准**：从"触发决策"到"业务恢复"总用时 ≤ RTO 目标，且数据损失在可接受的 RPO 范围内。

## 6. 监控关键指标

以下指标应上告警，数据来自 [KIP-382 的 metrics 定义](https://cwiki.apache.org/confluence/display/KAFKA/KIP-382%3A+MirrorMaker+2.0)。告警阈值以业务允许的 RPO/RTO 和正常负载下的基线为依据，并通过演练验证，不宜当成统一套用的固定标准。仅看到 Connector 处于 RUNNING 不能证明复制链路正常，还需直接检查关键业务 topic 是否存在复制失败或持续积压：

| 指标 | 说明 | 告警阈值 |
| :-- | :-- | :-- |
| `replication-latency-ms-max` | 按 topic、partition 维度采集的端到端复制延迟最大值，不是全链路所有业务数据的最大丢失窗口 | > 30s 持续 5 min（示例阈值） |
| `record-age-ms-max` | 消息在 MM2 读取时的年龄，依赖记录时间戳，不等同于真实网络传输时间 | > 60s（示例阈值） |
| MirrorSourceConnector `status` | 通过 Kafka Connect REST API 查询的运行状态，不是 KIP-382 定义的 JMX 指标 | ≠ RUNNING |
| MirrorCheckpointConnector `checkpoint-latency-ms` | checkpoint 端到端延迟，不等于目标消费位点落后或业务复制延迟 | > 1 min |
| 关键 topic 复制进度 | 每个关键分区的复制是否失败、是否持续积压，能否满足恢复要求 | 有分区复制失败或持续积压即告警 |
| Backup 端 `<source>.<topic>` 分区数 | 与 Primary 是否一致（仅针对已纳入复制范围的 topic） | 不一致立即告警 |

## 7. 常见教训

**教训一：演练与真实故障最大的差异是"决策时间"**。演练时大家都知道要切；真实故障里，团队会花大量时间讨论"是切还是等 Primary 恢复"。runbook 里的触发条件要写得让 on-call 敢在 5 分钟内拍板，同时记录决策时间，事后核查是否超出 RTO。

**教训二：忘记切 Schema Registry**。Kafka 切了，Schema Registry 没切，如果生产或消费依赖的注册表在切换后不可用、或缺少所需 Schema，相关消息的序列化/反序列化可能失败。是否受影响取决于应用的序列化方式、Schema 缓存与 Schema ID 兼容策略，不是必然全部失败，但需要切换前验证 Schema 可访问性与 ID 兼容性。

**教训三：无法动态切换连接地址的组件会成为切换障碍**。bootstrap 写死在代码里的组件，灾备切换时要么改配置重发、要么改代码，会拖慢恢复。所有客户端应走配置中心或环境变量，并验证配置刷新与重连机制。
