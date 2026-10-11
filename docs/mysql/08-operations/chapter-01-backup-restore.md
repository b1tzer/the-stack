# 备份恢复

> 本页完成备份、恢复和恢复验证；Redo Log 与 Binlog 在恢复中的职责见[存储与日志](../02-storage-and-logging/chapter-04-redo-log.md)。

## 先定义恢复目标

备份只有经过恢复验证才算有效。设计策略前先确定：

- **RPO**：可接受丢失多少时间内的数据，决定 Binlog 归档和备份频率。
- **RTO**：业务需要在多长时间内恢复，决定备份类型、资源和演练方式。
- **恢复范围**：需要整实例、单库、单表，还是只回放指定时间点的数据。

下文命令以 MySQL 8.0、InnoDB 和 Percona XtraBackup 为例。使用其他备份工具时，先核对工具与服务端版本的兼容矩阵。

## 逻辑备份

### 导出一致性快照

`--single-transaction` 只对支持一致性快照的事务引擎提供在线一致性备份，核心场景是 InnoDB。它不保护 MyISAM 等非事务表；这些表必须锁表或停机后再备份。不要把 `--single-transaction` 当成“任意表都能无锁一致备份”。

```bash
# 凭据放在权限受限的 option file 中，避免出现在进程列表里
mysqldump \
  --defaults-extra-file=/root/.my-backup.cnf \
  --single-transaction \
  --set-gtid-purged=OFF \
  --source-data=2 \
  --routines --events \
  --databases mydb > /backup/mydb.sql
```

示例中的 `--set-gtid-purged=OFF` 适用于把逻辑备份恢复到独立验证环境。若目标实例需要继承或保留 GTID 状态，应根据复制拓扑选择相应参数，并在预发布环境验证导入结果。

### 恢复与隔离验证

逻辑备份可能包含 `DROP DATABASE`、`CREATE DATABASE` 和 `USE`。恢复前确认目标实例，不要把文件直接导入生产实例：

```bash
# 先恢复到隔离实例，检查完整性和应用行为
mysql \
  --defaults-extra-file=/root/.my-restore.cnf \
  < /backup/mydb.sql

mysql \
  --defaults-extra-file=/root/.my-restore.cnf \
  -e "SELECT COUNT(*) FROM mydb.orders;"
```

若只备份单表且文件不含建库语句，需要在目标库中先执行 `CREATE DATABASE` 和 `USE`，否则可能导入错误的默认数据库。

## 物理备份

### 创建与准备备份

```bash
xtrabackup \
  --defaults-file=/etc/mysql/backup.cnf \
  --backup \
  --target-dir=/backup/mysql/20240101

# 在备份副本上准备恢复文件，不修改生产数据目录
xtrabackup \
  --defaults-file=/etc/mysql/restore.cnf \
  --prepare \
  --target-dir=/backup/mysql/20240101
```

备份完成后检查退出码和日志，不要只根据目录是否生成来判断成功。

### 安全恢复数据目录

`--copy-back` 会写入服务端数据目录。恢复期间必须停止 MySQL，并确认：

1. 当前服务已停止；
2. 目标数据目录为空，或已经按恢复手册完成迁移和备份；
3. 恢复目录已完成 `--prepare`；
4. 文件属主、权限和 SELinux/AppArmor 上下文符合平台要求。

```bash
systemctl stop mysql

xtrabackup \
  --defaults-file=/etc/mysql/restore.cnf \
  --copy-back \
  --target-dir=/backup/mysql/20240101

# 属主和目录位置按操作系统与安装方式确认
chown -R mysql:mysql /var/lib/mysql

systemctl start mysql
tail -n 100 /var/log/mysql/error.log
```

在生产环境执行前，至少在同版本空实例上演练一次。不要为了省时间跳过“停止服务”和“确认目标目录状态”。

## 时间点恢复

### 记录全量备份位置

恢复到任意时间点需要同时保留全量备份和连续的 Binlog。全量导出或复制前，记录服务端位置：

```sql
SHOW BINARY LOGS;
SHOW MASTER STATUS;
```

不同版本的语句名称可能不同；连接的账号需要具备相应权限。记录的信息应与备份文件、Binlog 文件和执行时间一起保存，不能只依赖文件修改时间推断先后关系。

### 回放 Binlog

```bash
mysqlbinlog \
  --start-position=4 \
  --stop-position=1578 \
  /var/lib/mysql/mysql-bin.000123 \
  | mysql --defaults-extra-file=/root/.my-restore.cnf
```

也可使用 `--start-datetime` 和 `--stop-datetime`，但时间受 Binlog 事件时间、服务器时区和时钟偏差影响。范围边界包含大量事件时，应先输出到文件人工核对，再对隔离实例执行。

恢复完成后应立即生成新的全量备份，并从恢复点继续归档 Binlog。

## 增量备份与恢复链

### 建立依赖关系

```bash
xtrabackup --defaults-file=/etc/mysql/backup.cnf \
  --backup --target-dir=/backup/mysql/full-20240101

xtrabackup --defaults-file=/etc/mysql/backup.cnf \
  --backup \
  --incremental-basedir=/backup/mysql/full-20240101 \
  --target-dir=/backup/mysql/inc-20240102

xtrabackup --defaults-file=/etc/mysql/backup.cnf \
  --backup \
  --incremental-basedir=/backup/mysql/inc-20240102 \
  --target-dir=/backup/mysql/inc-20240103
```

每个增量备份都依赖一个明确的基础备份。恢复链是“全量 → 一级增量 → 后续增量 → Binlog”，不能只按目录名或 `mtime` 排序猜测。

### 依次准备增量

```bash
xtrabackup --prepare --apply-log-only \
  --target-dir=/backup/mysql/full-20240101

xtrabackup --prepare --apply-log-only \
  --target-dir=/backup/mysql/full-20240101 \
  --incremental-dir=/backup/mysql/inc-20240102

xtrabackup --prepare \
  --target-dir=/backup/mysql/full-20240101 \
  --incremental-dir=/backup/mysql/inc-20240103
```

最后一个增量准备时去掉 `--apply-log-only`，让工具完成恢复链。执行前从备份元数据读取依赖关系；工具版本不同，参数组合也可能不同。

### 保留期必须覆盖依赖链

删除全量或增量前，先验证每个待删除对象不被仍在保留期内的恢复链或 Binlog 依赖。例如增量备份保留 7 天、对应全量保留 30 天时，必须保证：

- 每个增量对应的全量和更早增量仍存在；
- 从最早保留增量对应的全量到当前时间，链路连续；
- Binlog 起点不早于最早仍需回放的备份位置。

清理脚本应从生成的清单或备份元数据计算依赖，而不是直接执行 `find ... -mtime +N -exec rm`。

## 恢复验证

### 验证逻辑备份

```bash
# 在隔离实例恢复后再验证，不要在源实例直接导入
mysql --defaults-extra-file=/root/.my-restore.cnf \
  -e "SELECT COUNT(*) FROM mydb.orders;"

mysql --defaults-extra-file=/root/.my-restore.cnf \
  -e "CHECK TABLE mydb.orders;"
```

行数只能发现粗粒度差异。还应检查关键表校验和、约束、对象定义、随机业务记录和最近事务。

### 验证物理备份

准备阶段必须正常结束；随后在隔离实例启动服务，检查错误日志、复制状态、核心表和应用只读查询。仅看到 `completed OK` 不等于业务可恢复。

### 演练标准

每次策略变更至少验证：

1. 从指定全量和增量恢复到隔离实例；
2. 回放 Binlog 到目标时间点；
3. 比较源与目标的关键业务结果；
4. 记录实际 RPO、RTO、存储占用和人工步骤；
5. 对应用执行冒烟测试。

## 最佳实践

1. **以恢复目标设计策略**：先确定 RPO、RTO 和恢复范围，再选择频率与工具。
2. **分离备份与恢复路径**：恢复使用独立账号、目标目录和凭据，避免误写生产。
3. **连续归档 Binlog**：全量备份之间必须有完整日志，才能恢复到故障时间点。
4. **维护显式依赖清单**：记录基础备份、增量链、Binlog、校验和和工具版本。
5. **保留多份并异地保存**：至少区分本地快速恢复副本与离线或异地副本。
6. **加密并限制访问**：备份常包含完整数据，应加密传输、静态存储并最小化凭据。
7. **监控备份和归档**：任务失败、空间不足和日志断档都应告警。
8. **定期执行恢复演练**：没有在隔离环境恢复成功的备份，不计入可用备份。
