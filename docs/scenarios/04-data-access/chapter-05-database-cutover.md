# 应用平滑切换数据库

> 本场景给出一份可直接排期和演练的切库 runbook。目标是：应用持续读写时，把流量从源库切到目标库，同时避免写入丢失、双写和误回滚。示例使用 MySQL 8.0+、GTID 复制和配置中心路由。

## 设定示例和切换标准

先给场景一个明确边界，否则“平滑”无法验收。

| 项目 | 本文示例 | 实施时要替换为 |
| :-- | :-- | :-- |
| 应用 | 12 个 `order-service` 实例 | 实际实例数、服务名和负责人 |
| 其他写入方 | 1 个定时任务、1 个消息消费者 | 实际任务、CDC、报表和运维脚本 |
| 数据链路 | `source.example` 异步复制到 `target.example` | 实际拓扑、版本和复制方式 |
| 数据目标 | 已提交写入零丢失 | 实际 RPO |
| 写入窗口 | 目标 60 秒内完成冻结和切流 | 实际 RTO、SLO 和公告时间 |
| 回滚点 | 目标库第一笔业务写入 | 是否具备反向同步或合并能力 |

恢复点目标（RPO）表示允许丢失多少已提交数据；恢复时间目标（RTO）表示业务需要多久恢复。这里的 60 秒只是示例，必须通过演练确认，不能直接当作生产承诺。

平滑切换不等于零停顿。推荐流程是：

```text
源库写入
    ↓ 应用停止接收写入
排空事务
    ↓ 源库设置只读
目标库追平并完成校验
    ↓ 先锁住旧写入路径，再开放目标库写入
目标库写入
    ↓ 小流量验证
恢复全部流量
```

核心顺序是：**先阻止旧主写入，再开放新主写入**。任何让两个数据库同时接收业务写入的步骤，都必须有单独设计的双写、幂等和冲突处理方案。

## 选择应用路由方式

应用必须通过集中入口选择数据库，不能让每个实例各自修改配置。

| 路由方式 | 适用条件 | 切换时仍需做什么 |
| :-- | :-- | :-- |
| 数据库代理 | 所有应用连接都经过代理 | 排空代理中的旧连接，并用数据库只读状态兜底 |
| 配置中心 | 应用启动时读取并在运行时监听路由 | 所有实例确认路由版本，旧写入路径先被封锁 |
| DNS/VIP | 写流量经过统一地址 | 考虑缓存、TTL 和长连接，不能只修改一条 DNS 记录 |

本文使用配置中心示例。路由协议至少包含以下状态：

| 状态 | 读取位置 | 写入行为 |
| :-- | :-- | :-- |
| `SOURCE_WRITE` | 源库 | 写源库 |
| `DRAINING` | 源库 | 拒绝新写入，或写入持久化队列 |
| `TARGET_WRITE` | 目标库 | 写目标库 |
| `ROLLED_BACK` | 源库 | 写源库，仅用于目标库尚无业务写入时 |

配置中心应提供类似以下的查询和更新接口：

```http
GET /internal/db-route

HTTP/1.1 200 OK
Content-Type: application/json

{"version":41,"mode":"SOURCE_WRITE","expected":12,"acked":12}
```

```http
PUT /internal/db-route
Content-Type: application/json

{"version":42,"mode":"DRAINING"}
```

期望结果不是“配置已提交”，而是 **12/12 实例都已确认新版本**。如果系统没有集中路由和确认机制，应先补上，或改用数据库代理；逐台修改应用配置不满足安全切流条件。

## 准备环境

本节建议在切换前 7 天完成，最迟在正式切换前完成一次全流程演练。

### 1. 盘点所有写入方

建立下表并填写负责人、停止命令和恢复命令。

| 写入方 | 示例位置 | 停止方式 | 恢复方式 | 负责人 |
| :-- | :-- | :-- | :-- | :-- |
| 应用实例 | `order-service` × 12 | 路由切为 `DRAINING` | 路由切为 `TARGET_WRITE` | 应用负责人 |
| 定时任务 | `order-reconcile` | 调度平台暂停 | 按批次恢复 | 任务负责人 |
| 消息消费者 | `order-events` | 停止消费者并保留积压 | 消费目标库并确认幂等 | 消息负责人 |
| CDC/同步任务 | 业务日志同步 | 停止任务 | 明确是否切换为目标库 | 数据负责人 |
| 人工写入 | 运维窗口 | 关闭发布或收回入口 | 按新库权限开放 | 运维负责人 |

只关闭应用 HTTP 入口不算完成盘点。消息积压、定时任务和人工 SQL 都可能在切流后继续写源库。

### 2. 建立复制和校验链路

目标库先作为源库的只读副本运行。全量导入、增量追赶、对象校验和 GTID 配置见[数据迁移](../../mysql/08-operations/chapter-08-data-migration.md)。

使用全局事务标识符（GTID）时，源库和目标库都应满足 `gtid_mode=ON` 和 `enforce_gtid_consistency=ON`。先在两台服务器分别检查：

```bash
mysql --defaults-extra-file=/root/.my-source.cnf \
  -h source.example \
  -e "SELECT @@version, @@server_id, @@gtid_mode, @@read_only, @@super_read_only;"

mysql --defaults-extra-file=/root/.my-target.cnf \
  -h target.example \
  -e "SELECT @@version, @@server_id, @@gtid_mode, @@read_only, @@super_read_only;"
```

期望结果：

- 两台服务器的 `server_id` 不同；
- `gtid_mode` 和 `enforce_gtid_consistency` 均为 `ON`；
- 源库当前 `read_only=0`、`super_read_only=0`；
- 目标库当前为只读副本；
- option file 权限仅允许运维账号读取，不要把密码写入命令行。

`enforce_gtid_consistency` 不在上面的输出中，需要单独查询：

```bash
mysql --defaults-extra-file=/root/.my-source.cnf \
  -h source.example \
  -e "SELECT @@gtid_mode, @@enforce_gtid_consistency;"
```

### 3. 建立切换冒烟表

如果没有容易验证的业务写入，先在源库创建一张由复制同步到目标库的冒烟表：

```sql
CREATE TABLE IF NOT EXISTS mydb.cutover_smoke (
    request_id VARCHAR(64) NOT NULL,
    note VARCHAR(128) NOT NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (request_id)
) ENGINE=InnoDB;
```

正式演练和生产切换使用不同的 `request_id`。也可以用一个只在切换窗口执行的测试订单代替，但必须确保可查询、可清理且不会触发真实副作用。

### 4. 接入监控

切换前至少建立以下面板和告警：

- 应用错误率、写请求延迟、连接池等待和超时；
- 源库连接、长事务、锁等待和写入量；
- 目标库复制线程、延迟、复制错误、连接和磁盘；
- 消息积压、定时任务进度和业务对账差异。

指标口径见[监控、告警与慢查询](../../mysql/08-operations/chapter-03-monitoring.md)。

## 执行切换前检查

以下检查全部通过后，才进入写入冻结阶段。

### 1. 检查复制状态

在目标库执行：

```bash
mysql --defaults-extra-file=/root/.my-target.cnf \
  -h target.example \
  -e "SHOW REPLICA STATUS\G"
```

连续检查 3 次，每次间隔 5 秒：

```bash
for check in 1 2 3; do
  mysql --defaults-extra-file=/root/.my-target.cnf \
    -h target.example \
    -e "SHOW REPLICA STATUS\G" |
    grep -E "Replica_IO_Running|Replica_SQL_Running|Seconds_Behind_Source|Last_SQL_Error"
  sleep 5
done
```

每次都要满足：

- `Replica_IO_Running: Yes`
- `Replica_SQL_Running: Yes`
- `Seconds_Behind_Source: 0`
- `Last_SQL_Error` 为空

如果目标版本或导出工具使用不同字段名，以 `SHOW REPLICA STATUS\G` 的实际输出为准。

### 2. 检查 GTID 覆盖

先记录源库已执行的 GTID 集合：

```bash
mysql --defaults-extra-file=/root/.my-source.cnf \
  -h source.example \
  -N -e "SELECT @@gtid_executed;"
```

把输出值替换到下面的 `<source_gtid>`，在目标库执行：

```bash
mysql --defaults-extra-file=/root/.my-target.cnf \
  -h target.example \
  -e "SELECT GTID_SUBSET('<source_gtid>', @@gtid_executed) AS source_is_covered;"
```

期望输出：

```text
+-----------------------+
| source_is_covered     |
+-----------------------+
|                     1 |
+-----------------------+
```

结果为 0 表示源库存在目标库尚未包含的事务，禁止进入切换。

### 3. 核对关键数据

选择能在业务窗口内完成的关键表，分别在源库和目标库执行相同查询：

```bash
mysql --defaults-extra-file=/root/.my-source.cnf \
  -h source.example \
  -N -e "SELECT COUNT(*), MIN(id), MAX(id), SUM(amount_cents) FROM mydb.orders;"

mysql --defaults-extra-file=/root/.my-target.cnf \
  -h target.example \
  -N -e "SELECT COUNT(*), MIN(id), MAX(id), SUM(amount_cents) FROM mydb.orders;"
```

期望两组输出完全一致。`information_schema.tables.TABLE_ROWS` 是 InnoDB 估算值，不能作为最终核对结果。大表应提前建立分片计数、校验和或 `pt-table-checksum` 任务。

同时核对：

- 主键、唯一键和外键数量；
- 最近业务时间范围和关键状态分布；
- 视图、存储过程、事件和权限；
- 复制错误日志中最近一条成功事务之后的变化。

### 4. 冻结应用写入

把所有实例的路由切为 `DRAINING`：

```http
PUT /internal/db-route
Content-Type: application/json

{"version":42,"mode":"DRAINING"}
```

查询确认：

```http
GET /internal/db-route

HTTP/1.1 200 OK
Content-Type: application/json

{"version":42,"mode":"DRAINING","expected":12,"acked":12}
```

应用在 `DRAINING` 状态下应：

- 拒绝新的写请求，并返回可重试状态码，例如 HTTP 503 和 `Retry-After`；
- 或把写请求写入持久化队列；
- 停止定时任务和消息消费；
- 继续提供只读请求，或按产品公告进入维护状态。

不要把写请求只保存在进程内存中。进程重启或超时后，这些请求会消失。

### 5. 排空源库事务

检查活动事务：

```bash
mysql --defaults-extra-file=/root/.my-source.cnf \
  -h source.example \
  -e "SELECT trx_id, trx_state, trx_started, trx_query FROM information_schema.innodb_trx ORDER BY trx_started;"
```

检查 Metadata Lock：

```bash
mysql --defaults-extra-file=/root/.my-source.cnf \
  -h source.example \
  -e "SELECT * FROM performance_schema.metadata_locks WHERE OBJECT_SCHEMA = 'mydb';"
```

通过条件：

- `innodb_trx` 中没有来自应用账号的活动事务；
- 没有仍持有 `mydb` Metadata Lock 的旧查询；
- 应用写请求计数不再增长；
- 定时任务、消息消费者和 CDC 均已停止。

不要强行杀事务作为默认处理。先让事务自然结束；确认卡死时，由负责人评估回滚和业务补偿。

### 6. 用数据库只读状态封锁源库

应用路由已经冻结后，再增加数据库级保护：

```bash
mysql --defaults-extra-file=/root/.my-source.cnf \
  -h source.example \
  -e "SET GLOBAL super_read_only = ON; SELECT @@read_only, @@super_read_only;"
```

期望两个值都是 `1`。应用账号不得具备绕过只读限制的权限。

如果源库还承担组复制、级联复制或其他特殊角色，不能机械执行这条命令；先按实际拓扑确认只读状态不会破坏复制。此时也可以通过停用应用写账号或数据库代理下线旧写入路径实现同等保护。

## 执行切换

源库只读之后，按以下顺序执行。每一步都通过后再进入下一步。

| 顺序 | 操作 | 通过条件 | 失败时 |
| :-- | :-- | :-- | :-- |
| 1 | 应用进入 `DRAINING` | 12/12 实例确认，写请求不再增长 | 保持源库状态，不开放目标写入 |
| 2 | 定时任务、消息和 CDC 停止 | 所有任务状态为暂停，积压不再变化 | 继续排空，不开放目标写入 |
| 3 | 源库设置 `super_read_only` | `read_only=1`、`super_read_only=1` | 回到排空阶段 |
| 4 | 排空源库事务 | 无应用事务和旧 Metadata Lock | 继续等待或人工处理 |
| 5 | 目标库追平并完成 GTID、数据校验 | GTID 覆盖为 1，关键数据一致 | 回滚到源库写入状态 |
| 6 | 停止源库到目标库的复制通道 | 复制已确认停止，状态已记录 | 不开放目标写入 |
| 7 | 目标库解除只读 | 目标 `read_only=0`、`super_read_only=0` | 保持应用 `DRAINING` |
| 8 | 应用切为 `TARGET_WRITE` | 12/12 实例确认，所有写入进入目标库 | 停止恢复任务，按回滚条件处理 |
| 9 | 执行冒烟写入 | 目标库成功、源库无对应新记录 | 进入回滚判断 |
| 10 | 恢复任务和全部流量 | 指标、对账和业务链路正常 | 保持目标库为唯一写入方并处理异常 |

### 1. 最后追平目标库

源库已经只读、应用已经停止写入后，再次检查复制状态和 GTID 覆盖：

```bash
mysql --defaults-extra-file=/root/.my-target.cnf \
  -h target.example \
  -e "SHOW REPLICA STATUS\G"
```

如果任一条件不满足，保持应用 `DRAINING`，不要继续。可以在不改变业务状态的情况下回滚到源库。

### 2. 停止旧复制并开放目标库

本示例目标库只有一个来自源库的复制通道：

```bash
mysql --defaults-extra-file=/root/.my-target.cnf \
  -h target.example \
  -e "STOP REPLICA; SET GLOBAL super_read_only = OFF; SET GLOBAL read_only = OFF; SELECT @@read_only, @@super_read_only;"
```

期望两个只读值均为 `0`，且复制通道已停止。若目标库有多个复制通道，只停止来自旧源库的通道，不要误停仍需保留的上游或下游链路。

执行这条命令前，必须同时满足：

- 源库已被只读状态封锁；
- 应用仍在 `DRAINING`；
- GTID 和关键数据校验通过；
- 回滚负责人在线。

### 3. 切换应用路由

```http
PUT /internal/db-route
Content-Type: application/json

{"version":43,"mode":"TARGET_WRITE"}
```

确认：

```http
GET /internal/db-route

HTTP/1.1 200 OK
Content-Type: application/json

{"version":43,"mode":"TARGET_WRITE","expected":12,"acked":12}
```

只读请求也应根据业务一致性要求切到目标库。特别是“下单后立即查询订单”这类写后读请求，不能在写入切换后仍从旧源库读取。

### 4. 执行冒烟写入

使用本次切换唯一 ID，在目标库写入一条冒烟记录：

```bash
RUN_ID="cutover-$(date -u +%Y%m%dT%H%M%SZ)"

mysql --defaults-extra-file=/root/.my-target.cnf \
  -h target.example \
  -e "INSERT INTO mydb.cutover_smoke(request_id, note) VALUES ('${RUN_ID}', 'target-write-smoke');"

mysql --defaults-extra-file=/root/.my-target.cnf \
  -h target.example \
  -N -e "SELECT COUNT(*) FROM mydb.cutover_smoke WHERE request_id = '${RUN_ID}';"

mysql --defaults-extra-file=/root/.my-source.cnf \
  -h source.example \
  -N -e "SELECT COUNT(*) FROM mydb.cutover_smoke WHERE request_id = '${RUN_ID}';"
```

期望结果：

- 目标库查询为 `1`；
- 源库查询为 `0`；
- 源库 `super_read_only` 仍为 `1`；
- 没有应用实例报告正在写源库。

随后执行一条真实的业务测试，例如创建测试订单、提交、查询、取消，并记录关联 ID。测试数据要可追踪、可清理且不影响结算。

### 5. 恢复后台任务

按依赖顺序恢复：

1. 恢复消息消费者，确认积压从目标库消费；
2. 恢复定时任务；
3. 恢复 CDC 或下游同步；
4. 按实例批次恢复应用流量；
5. 最后恢复人工写入入口。

每恢复一类写入方，都观察错误率、延迟、连接和对账差异。不要同时恢复全部任务。

## 验证稳定期

至少覆盖一个业务高峰和一轮关键定时任务后再决定是否完成切换。

| 层级 | 检查项 | 通过标准 |
| :-- | :-- | :-- |
| 业务 | 写请求成功率、延迟、订单状态 | 符合切换前 SLO，无新增错误模式 |
| 应用 | 连接池、超时、重试、事务时长 | 无持续等待和重试增长 |
| 数据库 | 连接、慢查询、死锁、磁盘 | 无异常增长，容量有余量 |
| 数据 | 对账、序列号、重复键、消息积压 | 差异为 0 或有已批准的处理单 |
| 复制 | 旧链路状态 | 旧源库保持只读，无应用写入 |

出现连接、锁或慢查询问题时，从[常见问题与避坑指南](../../mysql/10-practice/chapter-04-common-issues.md)进入定位流程。

## 执行回滚

### 目标库尚无业务写入

只要目标库没有产生需要保留的业务写入，源库仍是完整数据源。目标库可以存在已经识别的冒烟记录；先删除这些测试数据，确认没有其他新增业务数据，再按以下顺序回滚：

1. 保持应用为 `DRAINING`；
2. 在目标库删除本次 `RUN_ID` 和其他已确认的测试记录，保留操作记录；
3. 确认目标库除测试写入外没有业务新增数据；
4. 如果目标库复制已停止，先启动目标库复制；
5. 解除源库只读：

```bash
mysql --defaults-extra-file=/root/.my-source.cnf \
  -h source.example \
  -e "SET GLOBAL super_read_only = OFF; SET GLOBAL read_only = OFF; SELECT @@read_only, @@super_read_only;"
```

6. 等待目标库追上源库，再次检查复制状态；
7. 将应用路由切回 `ROLLED_BACK`，并确认 12/12 实例确认；
8. 恢复源库写入，先恢复一个冒烟请求，再恢复定时任务和全部流量。

回滚完成的通过条件是：源库两个只读值均为 `0`，目标库没有被当作新主使用，应用全部写入源库，后台任务没有重复消费。

### 目标库已经产生业务写入

目标库出现第一笔业务写入后，源库已经落后。直接解除源库只读并切回应用会形成双写或覆盖目标数据。

此时不要执行上一节的回滚命令。只能选择切换前已经演练过的方案：

- 把目标库新增写入合并回源库，完成对账后再切回；
- 让目标库成为新主，反向把目标库复制到旧源库，确认旧源库覆盖目标库全部 GTID 后，再按一次新的切流流程把流量切回；
- 保留目标库为新主，通过数据修复工具处理当前故障，不执行回切。

反向切换也必须遵守“先阻止当前主库写入，再开放下一主库写入”。未排练的反向复制、手工挑 SQL 或直接解除旧库只读，都可能扩大数据分叉。

## 完成切换与清理

稳定期结束后：

1. 归档路由版本、切换时间、GTID/位点、校验结果和实际 RPO/RTO；
2. 保留源库完整备份，不立即删除数据；
3. 保留源库只读状态和审计日志；
4. 关闭旧写入账号和历史任务入口；
5. 至少保留一个审计窗口后再清理旧复制和旧库；
6. 清理冒烟数据前先确认没有下游引用。

备份和恢复步骤见[备份恢复](../../mysql/08-operations/chapter-01-backup-restore.md)。

## 切换检查单

### 切换前

- [ ] 写入方清单完整，负责人和停止方式已确认。
- [ ] 应用有集中路由、版本号和 100% 实例确认能力。
- [ ] 目标库复制连续 3 次无错误且延迟为 0。
- [ ] GTID 覆盖结果为 1。
- [ ] 关键表计数、汇总和对象校验一致。
- [ ] 源库和目标库监控、备份、磁盘告警可用。
- [ ] 回滚路径已排练，不可逆点已书面确认。

### 切换中

- [ ] 应用已全部进入 `DRAINING`。
- [ ] 定时任务、消息、CDC 和人工写入已停止。
- [ ] 源库 `read_only=1`、`super_read_only=1`。
- [ ] 源库没有活动应用事务和旧 Metadata Lock。
- [ ] 目标库最终校验通过。
- [ ] 旧复制停止后才开放目标库写入。
- [ ] 应用 12/12 确认 `TARGET_WRITE`。
- [ ] 冒烟写入只进入目标库。

### 切换后

- [ ] 业务、应用、数据库和对账指标进入稳定期。
- [ ] 后台任务按顺序恢复且没有重复消费。
- [ ] 源库保持只读，没有历史写入方绕过路由。
- [ ] 实际 RPO/RTO、GTID 和回滚结果已归档。
- [ ] 旧库在审计窗口结束前未删除。

若复制、对象或数据校验不通过，立即停止切流并保持应用 `DRAINING`。只有目标库尚未产生业务写入时，才可按“目标库尚无业务写入”章节回滚。
