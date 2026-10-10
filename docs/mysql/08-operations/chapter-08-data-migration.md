# 数据迁移

> 本页处理跨实例、跨版本和上云迁移；复制协议见[复制与扩展架构](../07-replication-and-architecture/chapter-01-binlog-replication.md)，整机备份恢复见[备份恢复](./chapter-01-backup-restore.md)。

## 先确定迁移方式

迁移方式由数据量、可停机时间、RPO/RTO、版本差异和目标环境限制共同决定。

| 方式 | 适用场景 | 主要代价 |
| :-- | :-- | :-- |
| 逻辑导出导入 | 数据量较小、结构需调整、可接受较长窗口 | 导出导入耗时，导入期间依赖应用侧一致性控制 |
| 物理恢复 | 同版本或工具兼容、希望缩短全量恢复时间 | 对文件格式、数据目录和工具兼容性要求高 |
| 复制 + 切换 | 可持续写入、需要较短停写窗口 | 必须处理 Binlog、GTID、结构兼容和切换回滚 |
| 云厂商迁移服务 | 跨云、需要托管校验与任务监控 | 受目标云服务、网络和计费约束 |

先列出源库与目标库的版本、引擎、字符集、对象清单、数据量、峰值 QPS、允许停写时间和回滚窗口。把“总行数”作为参考项，不作为唯一验收条件。

## 选择迁移工具

### mysqldump

适合中小数据量、以逻辑对象迁移为主的任务。

```bash
mysqldump \
  --defaults-extra-file=/root/.my-backup.cnf \
  --single-transaction \
  --routines --events \
  --databases mydb > /backup/mydb.sql

mysql --defaults-extra-file=/root/.my-restore.cnf < /backup/mydb.sql
```

`--single-transaction` 主要为 InnoDB 提供一致快照；含 MyISAM 等非事务表时，需要锁表或安排停写窗口。

### mydumper 与 myloader

按表并行导出和导入，适合希望缩短大库逻辑迁移窗口的场景。并行度不是越高越好，应以源库负载、网络、目标库写入能力和磁盘吞吐压测结果为准。

```bash
mydumper --host source.example --user backup \
  --database mydb --threads 8 --output-dir /backup/mydb

myloader --host target.example --user restore \
  --directory /backup/mydb --threads 8
```

命令选项会随工具版本变化，执行前用 `--help` 核对当前版本。

### MySQL Shell Utilities

适合 MySQL 8.0 及以上环境的并行逻辑导出和导入。

```bash
mysqlsh backup@source.example -- util dumpInstance /backup/instance \
  --threads=8 --bytesPerChunk=256M

mysqlsh restore@target.example -- util loadDump /backup/instance \
  --threads=8 --updateGtidSet=replace
```

`--updateGtidSet=replace` 只有在复制和 GTID 规划已经明确时才可使用。不要在未验证目标 GTID 状态时机械套用。

### 复制与专用迁移服务

需要接近在线切换时，使用 Binlog 复制、MySQL Group Replication/Clone，或目标云提供的数据传输服务。专用服务可以减少任务编排工作，但仍需验证对象兼容、主从延迟、切换和回滚。

## 执行迁移场景

### 逻辑迁移

1. 在源库建立一致性快照，同时保留 Binlog 起点。
2. 把数据导入目标库。
3. 若源库在导出后仍接收写入，根据起点回放增量变更。
4. 暂停写入后，确认剩余增量为 0，再完成数据和对象校验。
5. 切换连接并保留可回滚窗口。

对象清单至少覆盖表、索引、视图、存储过程、函数、触发器、事件、权限和定时任务。只导出表数据会遗漏这些对象。

### 通过复制迁移

#### 前提条件

- 源库启用 Binlog，并设置唯一 `server_id`。
- 双方网络连通，复制账号遵循最小权限。
- 字符集、排序规则、SQL Mode、时区和认证插件经过兼容性检查。
- 若使用 `SOURCE_AUTO_POSITION=1`，源库和目标库都必须已开启 GTID，且满足 `gtid_mode=ON`、`enforce_gtid_consistency=ON` 的前提。未满足时应使用明确的 Binlog 文件和位置。

```sql
-- 目标库配置复制。凭据放在安全位置，不直接写入代码仓库
CHANGE REPLICATION SOURCE TO
    SOURCE_HOST='192.0.2.10',
    SOURCE_USER='repl',
    SOURCE_PASSWORD='replace-with-secret',
    SOURCE_AUTO_POSITION=1;

START REPLICA;

SHOW REPLICA STATUS\G
```

确认 `IO_Thread` 和 `SQL_Thread` 均为 `Yes`，`Seconds_Behind_Source` 收敛到 0，并比较双方 GTID 已执行集合。只看“线程为 Yes”不足以证明数据已追平。

#### 切换步骤

1. 暂停向源库写入，等待复制延迟收敛到 0。
2. 执行结构、数据、对象和核心业务查询校验。
3. 记录源库最终 GTID 或 Binlog 位置。
4. 切换应用连接到目标库，并执行关键链路冒烟测试。
5. 若验证失败且没有目标侧写入，可切回源库；否则进入变更回滚流程。
6. 稳定运行后停止旧复制，再按策略清理旧环境。

不要在复制仍有延迟或目标库正在被业务写入时直接切回源库，这会造成数据覆盖或丢失。

### 跨版本迁移

以 MySQL 5.7 迁移到 8.0 为例，至少检查：

- 已移除或改变的 SQL 特性、保留字、默认 `sql_mode` 和默认排序规则；
- 存储过程、触发器、视图、事件和应用 SQL 的兼容性；
- 认证插件与客户端驱动是否支持 `caching_sha2_password`；
- 查询缓存相关配置和依赖 8.0 已不支持行为的代码；
- 8.0 预留系统表、关键字及数据类型变更。

`utf8mb4` 能统一表达更广泛的 Unicode 字符，建议新系统采用；它是兼容性与容量规划建议，不是所有迁移都必须立即执行的硬性前提。已有 `utf8` 数据可在迁移前评估目标排序规则、索引长度和应用输出行为。

跨版本复制只能在文档明确支持的方向和组合上进行。不能假设任意旧版本都能直接作为新版本从库。

### 上云迁移

云迁移通常可选择云厂商 DTS/DMS、逻辑迁移或目标服务支持的物理导入。选择前确认：

- 网络带宽、专线或隧道的吞吐与费用；
- 云服务是否允许 Binlog、事件、触发器和存储过程；
- 全量与增量任务的切换、校验和回滚能力；
- 云侧账号、KMS、VPC 和审计要求。

无论使用哪种服务，最终都应在目标环境完成数据校验和应用验证，不能把“任务显示完成”当作迁移完成。

## 验证与切换

### 数据校验

`information_schema.tables.TABLE_ROWS` 对 InnoDB 通常是估算值，适合评估规模，不适合做精确一致性核对。

```sql
-- 精确计数可能扫描整表；按业务窗口选择要核对的表
SELECT COUNT(*) FROM mydb.orders;

-- 按主键桶抽样，避免 ORDER BY RAND() 触发全表扫描和排序
SELECT id, order_no, status, updated_at
FROM mydb.orders
WHERE MOD(id, 997) = 0
ORDER BY id
LIMIT 100;
```

结合以下证据判断：

1. 关键表的精确行数或分片行数；
2. 最大/最小主键、时间范围和关键字段汇总值；
3. `pt-table-checksum` 或迁移服务的数据校验结果；
4. 存储过程、视图、权限等对象定义差异；
5. 核心业务读写链路的结果一致性。

### 切换与回滚条件

只有同时满足以下条件才切流：

- 源库已暂停写入或增量已确认追平；
- 数据校验和对象校验通过；
- 目标库容量、复制、备份和监控正常；
- 应用回滚配置、负责人和观察时间已经准备就绪。

切换后观察错误率、连接数、慢查询、主从延迟和核心业务指标。发现结构性错误时，不能仅切回连接就宣布回滚；必须确认目标库写入如何处理，避免双写数据分叉。

## 最佳实践

1. **先迁移演练再迁生产**：记录真实耗时、资源峰值和人工步骤。
2. **把增量处理写入方案**：明确增量来源、停止点和收敛判定。
3. **保持短写入窗口**：分批预热，切换前只保留必要的最终停写。
4. **校验对象而不只校验行数**：权限、索引、视图和定时任务同样影响业务。
5. **保留可执行回滚路径**：回滚必须包含目标侧写入的处理方式。
6. **迁移期间加强监控**：跟踪源库负载、复制延迟、目标资源和应用指标。
7. **完成后再清理旧环境**：确认稳定期、备份和回滚窗口结束后再删除数据。
