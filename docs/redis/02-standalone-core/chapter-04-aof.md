# AOF 持久化

> AOF（Append Only File）记录每一条写命令。比 RDB 更安全，但文件更大。

## 1. AOF 的工作原理

```text
Redis 执行写命令
  → 追加到 AOF 缓冲区
  → 根据 fsync 策略写入磁盘
  → AOF 文件持续增长
  → 触发重写（Rewrite）→ 压缩 AOF 文件
```

## 2. fsync 策略

| 策略 | 刷盘频率 | 数据安全 | 性能 |
|------|----------|----------|------|
| always | 每条命令刷盘 | 最安全 | 最差 |
| everysec | 每秒刷盘 | 最多丢1秒数据 | 好（推荐） |
| 由OS决定 | OS 控制 | 可能丢大量数据 | 最好 |

```bash
appendfsync everysec  # 推荐
```

## 3. AOF 重写

AOF 文件会持续增长（每条命令都记录）。重写将多条命令压缩为一条：

```text
原始 AOF：
  SET key1 a
  SET key1 b
  SET key1 c

重写后：
  SET key1 c  （只保留最终状态）
```

### 触发方式

```bash
# 手动触发
BGREWRITEAOF

# 自动触发
auto-aof-rewrite-percentage 100  # AOF 比上次重写增长100%
auto-aof-rewrite-min-size 64mb   # AOF 至少64MB才触发重写
```

### 重写过程

```text
1. Redis fork() 子进程
2. 子进程根据当前内存数据生成新 AOF
3. 子进程写入期间，父进程的新命令追加到旧 AOF + 重写缓冲区
4. 子进程完成 → 父进程将重写缓冲区追加到新 AOF
5. 替换旧 AOF
```

## 4. AOF 文件修复

```bash
# AOF 文件损坏时修复
redis-check-aof --fix appendonly.aof
```

## 5. RDB + AOF 混合持久化（4.0+）

```text
AOF 重写时：
  前半部分是 RDB 格式（快照）
  后半部分是 AOF 格式（增量命令）

恢复时：先加载 RDB 部分，再回放 AOF 部分
```

```bash
aof-use-rdb-preamble yes  # 开启混合持久化
```

## 6. 选型建议

| 场景 | 推荐 |
|------|------|
| 可容忍分钟级数据丢失 | RDB |
| 不能丢数据 | AOF (everysec) |
| 极端安全 | AOF (always) |
| 恢复速度优先 | RDB + AOF 混合 |
| 纯缓存（数据丢了重建） | 不持久化 |
