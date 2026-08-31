# 日志分段

> Kafka 的消息存储在日志分段（Log Segment）中。理解 Segment 是理解 Kafka 高性能的钥匙。

## 1. 存储结构

```text
Topic: orders (3 partitions)
  ├── Partition 0
  │     ├── 00000000000000000000.log  (Segment 0: offset 0-999)
  │     ├── 00000000000000000000.index
  │     ├── 00000000000000000000.timeindex
  │     ├── 00000000000000001000.log  (Segment 1: offset 1000-1999)
  │     ├── 00000000000000001000.index
  │     └── 00000000000000001000.timeindex
  ├── Partition 1
  └── Partition 2
```

每个 Partition 由多个 Segment 组成。每个 Segment 包含三个文件：

| 文件 | 说明 |
|------|------|
| .log | 实际消息数据 |
| .index | offset → 物理位置的映射（稀疏索引） |
| .timeindex | 时间戳 → offset 的映射 |

## 2. Segment 的设计动机

为什么不把所有消息放在一个大文件里？

```text
单文件问题：
  ├─ 删除旧消息需要重写整个文件
  ├─ 查找 offset 需要从头扫描
  └─ 文件太大，操作系统 mmap 效率下降

分段设计：
  ├─ 删除旧消息：直接删除整个 Segment 文件
  ├─ 查找 offset：二分定位 Segment + 索引定位
  └─ 每个 Segment 大小可控（默认 1GB）
```

## 3. 写入流程

```text
Producer 发送消息
  → 追加到当前活跃 Segment 的 .log 文件末尾
  → 更新 .index 稀疏索引
  → 更新 .timeindex
  → 返回 ack
```

**关键**：写入是顺序追加（append-only），磁盘顺序写的速度接近内存。这是 Kafka 高吞吐的根本原因。

## 4. 稀疏索引

.index 文件不是每条消息都建索引，而是每隔一定字节建一个索引项（默认 4KB）。

```text
.index 文件：
  offset 0     → 物理位置 0
  offset 100   → 物理位置 4096
  offset 200   → 物理位置 8192
  ...

查找 offset 150：
  1. 二分查找 .index → 找到 offset 100 → 物理位置 4096
  2. 从 4096 开始顺序扫描 .log → 找到 offset 150
```

## 5. Segment 滚动

当活跃 Segment 达到以下条件时，创建新 Segment：

| 参数 | 默认值 | 说明 |
|------|--------|------|
| log.segment.bytes | 1GB | Segment 最大大小 |
| log.roll.hours | 168 (7天) | Segment 最大时间 |
| log.roll.ms | - | Segment 最大时间（毫秒） |

## 6. 消息保留与清理

```text
保留策略：
  ├─ 按时间：log.retention.hours = 168（7天）
  ├─ 按大小：log.retention.bytes = -1（不限制）
  └─ 两者取先满足的

清理方式：
  ├─ delete：直接删除整个 Segment
  └─ compact：保留每个 key 的最新值（日志压缩）
```

### 6.1 日志压缩（Log Compaction）

```text
原始日志：
  key1:v1, key2:v1, key1:v2, key3:v1, key2:v2

压缩后：
  key1:v2, key3:v1, key2:v2
```

保留每个 key 的最新值，删除旧值。适用于需要保留最新状态的场景（如数据库变更日志）。

## 7. 零拷贝（Zero Copy）

Kafka 使用 `sendfile()` 系统调用将数据直接从磁盘发送到网络，跳过用户态：

```text
传统方式：
  磁盘 → 内核缓冲区 → 用户态缓冲区 → 内核发送缓冲区 → 网卡

零拷贝：
  磁盘 → 内核缓冲区 → 网卡
```

减少了两次内存拷贝和两次上下文切换。这是 Kafka 高吞吐的另一个关键。
