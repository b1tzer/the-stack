# 数据一致性

> ES 的数据一致性模型介于强一致和最终一致之间。理解它有助于避免"写入了但搜不到"的困惑。

## 1. 写入一致性

```text
写入请求 → Primary Shard 写入 → 复制到 Replica Shards
  → 默认：Primary + 所有 Replica 确认 → 返回成功
  → 可配置：Primary + quorum（多数）确认 → 返回成功
```

### 写入一致性参数

| 值 | 含义 |
|------|------|
| one | 只要 Primary 写入成功 |
| quorum | Primary + 多数 Replica 成功 |
| all | 所有 Shard 成功 |

```json
PUT /my-index/_doc/1?routing=user123&wait_for_active_shards=quorum
```

## 2. 读取一致性

读取请求可以发到 Primary 或 Replica：

```text
默认轮询策略：
  读请求 → Primary / Replica（轮流）
```

问题：Replica 可能还没同步最新数据，读到旧版本。

## 3. 近实时（NRT）

```text
写入 → Memory Buffer → Refresh(1s) → Segment → 可搜索
```

写入后最多 1 秒才能搜到。这是 ES 的设计取舍：**用实时性换取写入性能**。

## 4. 乐观并发控制

```json
// 使用 version 进行乐观锁
GET /my-index/_doc/1
// 返回 _version: 5

PUT /my-index/_doc/1?if_seq_no=5&if_primary_term=1
// 只有 seq_no 和 primary_term 匹配时才更新
```

## 5. 与 MySQL 一致性的对比

| 维度 | MySQL | Elasticsearch |
|------|-------|---------------|
| 写入后可读 | 立即（强一致） | 最多 1 秒（近实时） |
| 事务 | 完整 ACID | 无事务 |
| 适用场景 | 需要强一致的业务数据 | 搜索和分析（可接受短暂延迟） |

**架构建议**：MySQL 作为主数据存储，ES 作为搜索引擎。写入时先写 MySQL，再同步到 ES。
