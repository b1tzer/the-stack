# 异步复制

> MySQL 主从复制是最基础的高可用方案。理解复制原理，才能理解延迟、数据不一致等问题的根因。

## 1. 复制原理

```text
Master                          Slave
  │                               │
  ├─ 写入 Binlog ──────────────▶  │
  │                               ├─ IO Thread 读取 Binlog
  │                               ├─ 写入 Relay Log
  │                               ├─ SQL Thread 执行 Relay Log
  │                               └─ 数据同步完成
```

三个线程：
- **Master Binlog Dump Thread**：发送 Binlog 给 Slave
- **Slave IO Thread**：接收 Binlog，写入 Relay Log
- **Slave SQL Thread**：执行 Relay Log 中的 SQL

## 2. 复制格式

| 格式 | 说明 | 优缺点 |
|------|------|--------|
| STATEMENT | 记录 SQL 语句 | 日志小，但函数（NOW()）可能不一致 |
| ROW | 记录行变更 | 日志大，但数据一致性好 |
| MIXED | 自动选择 | 折中方案 |

**推荐 ROW 格式**：数据一致性最好。

## 3. 主从延迟

### 延迟原因

- Slave 单线程执行 Relay Log（5.7+ 支持多线程）
- Master 写入量大
- Slave 硬件性能差
- 网络延迟

### 查看延迟

```sql
SHOW SLAVE STATUS\G
-- Seconds_Behind_Master: 0 表示无延迟
```

### 减少延迟

```sql
-- 开启多线程复制（5.7+）
slave_parallel_workers = 4
slave_parallel_type = LOGICAL_CLOCK
```

## 4. 半同步复制

```text
Master 写入 Binlog → 等待至少一个 Slave 确认收到 → 返回客户端
```

比异步复制更可靠，但延迟更高。

```sql
-- Master 端
INSTALL PLUGIN rpl_semi_sync_master SONAME 'semisync_master.so';
SET GLOBAL rpl_semi_sync_master_enabled = 1;

-- Slave 端
INSTALL PLUGIN rpl_semi_sync_slave SONAME 'semisync_slave.so';
SET GLOBAL rpl_semi_sync_slave_enabled = 1;
```

## 5. 复制拓扑

| 拓扑 | 说明 | 适用场景 |
|------|------|----------|
| 一主一从 | 最简单 | 小规模 |
| 一主多从 | 读扩展 | 读多写少 |
| 级联复制 | Master → Slave → Slave | 大规模，减少 Master 压力 |
| 双主复制 | 互为主从 | 高可用（需处理冲突） |

## 6. GTID 复制

```sql
-- 基于事务 ID 而非文件+偏移量
gtid_mode = ON
enforce_gtid_consistency = ON
```

GTID 让复制更简单：不需要手动指定 Binlog 文件和位置，自动定位。
