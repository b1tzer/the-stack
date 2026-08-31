# 主从复制

> 主从复制是 Redis 高可用的基础：主节点写入，从节点读取，主节点故障时从节点可以提升为主节点。

## 1. 复制原理

```text
全量复制（首次连接）：
  Slave → Master: PSYNC ? -1
  Master → Slave: FULLRESYNC <runid> <offset>
  Master: 执行 BGSAVE → 生成 RDB → 发送给 Slave
  Slave: 加载 RDB
  Master: 发送 RDB 期间的增量命令
  Slave: 同步完成

增量复制（断线重连）：
  Slave → Master: PSYNC <runid> <offset>
  Master: 从 repl_backlog 中找回 offset 之后的命令
  Master → Slave: 发送增量命令
```

## 2. 复制积压缓冲区（repl_backlog）

```bash
repl-backlog-size 1mb  # 默认1MB
```

- 断线重连时，如果 offset 在 backlog 内 → 增量复制
- 如果 offset 不在 backlog → 全量复制
- **建议设大一些**（如 256MB），减少全量复制

## 3. 主从延迟

```text
Master 写入 → 异步复制到 Slave → Slave 有短暂延迟
```

- 主从之间是异步复制，不保证强一致
- 写后立即从 Slave 读可能读到旧数据
- 解决方案：关键读走 Master，或使用 WAIT 命令

```java
// 等待至少1个从节点确认
jedis.set("key", "value");
jedis.waitReplicas(1, 1000);  // 1个副本，超时1秒
```

## 4. 主从拓扑

```text
一主一从：
  Master → Slave

一主多从：
  Master → Slave1
        → Slave2
        → Slave3

级联复制：
  Master → Slave1 → Slave2
                → Slave3
```

## 5. 主从切换

```bash
# 手动切换（在 Slave 上执行）
REPLICAOF NO ONE  # 提升为 Master

# 其他 Slave 指向新 Master
REPLICAOF new_master_ip 6379
```

手动切换复杂且容易出错 → 使用 Sentinel 自动化。
