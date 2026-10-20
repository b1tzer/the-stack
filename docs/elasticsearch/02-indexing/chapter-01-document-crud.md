# 文档 CRUD

## 1. 索引文档

三种写入操作的语义区别：

- `PUT /my-index/_doc/1`：创建或**全量替换**指定 ID 的文档。使用已有 ID 时会覆盖整个 `_source`，而非仅修改指定字段。
- `PUT /my-index/_create/1`：仅在文档不存在时创建，已存在时返回 409 冲突。
- `POST /my-index/_update/1`：执行局部更新。`doc` 方式只合并指定的字段；`script` 方式按脚本逻辑修改 `_source`，修改范围由脚本决定，不保证未指定字段保持不变。

全量替换不只是更新指定字段，而是用新文档整体替换原有 `_source`。例如原文档含 `name`、`age`、`email`，若只提交 `name`、`age`，原有 `email` 不会保留。全量替换适用于调用方掌握完整目标文档的场景；若只持有变更字段，应使用 Update API，避免意外覆盖其他字段。

```bash
# 全量替换（覆盖写入）
PUT /my-index/_doc/1
{
  "name": "张三",
  "age": 25,
  "email": "zhangsan@example.com"
}

# 仅创建（已存在则冲突）
PUT /my-index/_create/1
{
  "name": "张三",
  "age": 25
}

# 自动生成 ID
POST /my-index/_doc
{
  "name": "李四",
  "age": 30
}
```

## 2. 获取文档

```bash
GET /my-index/_doc/1

# 获取特定字段
GET /my-index/_doc/1?_source=name,age
```

## 3. 更新文档

```bash
# 部分更新
POST /my-index/_update/1
{
  "doc": { "age": 26 }
}

# 脚本更新
POST /my-index/_update/1
{
  "script": {
    "source": "ctx._source.age += params.age",
    "params": { "age": 1 }
  }
}
```

Update API 的局部更新不是直接修改 Lucene 索引中的单个字段，而是读取现有 `_source`、应用局部文档或脚本，再重新索引更新后的文档。因此频繁更新大型文档仍会产生较高的写入开销，应结合文档大小、更新频率和查询需求设计数据模型。普通的 `doc` 更新默认要求目标文档存在，文档不存在时不会自动创建；需要在不存在时创建，应显式使用 `doc_as_upsert` 或 `upsert`（见第 6 节）。

## 4. Bulk API

Bulk 请求中的每个操作独立执行，**不提供跨操作的原子性与自动回滚保证**。单个操作失败不会回滚其他已执行的操作；但若多个操作作用于同一文档，前序操作的结果可能影响后续操作。即使 HTTP 返回成功状态，响应中也可能包含失败项，客户端必须检查 `errors` 并逐项处理 `items`，不能仅凭 HTTP 状态码判断全部成功。

Bulk 请求体使用 NDJSON（`Content-Type: application/x-ndjson`），而不是 JSON 数组。每个操作占一行元数据；`index`、`create`、`update` 通常还需紧随一行文档或更新内容，`delete` 则无需数据行。请求体最后必须保留换行符。

```bash
POST /_bulk
{"index": {"_index": "my-index", "_id": "1"}}
{"name": "张三", "age": 25}
{"update": {"_index": "my-index", "_id": "1"}}
{"doc": {"age": 26}}
{"delete": {"_index": "my-index", "_id": "2"}}
```

响应中 `errors: true` 表示至少有一个操作失败，需遍历 `items` 定位失败项：

```json
{
  "errors": true,
  "items": [
    { "index":  { "_id": "1", "status": 201 } },
    { "update": { "_id": "1", "status": 200 } },
    { "delete": {
        "_id": "2",
        "status": 404,
        "error": {
          "type": "document_missing_exception",
          "reason": "[_doc]: document missing"
        }
    }}
  ]
}
```

重试 Bulk 失败项前，应先判断失败原因与操作语义。`document_missing_exception` 表示目标文档不存在，直接重放通常不会使文档自动出现，需检查文档是否存在、是否应创建；`version_conflict_engine_exception` 表示版本冲突，需结合场景处理：`retry_on_conflict` 只适用于 Update 操作内部的冲突重试，不是 Bulk 级通用参数，其余冲突应按操作类型与业务语义决定是否重试，不能无判断地重放原请求；`mapper_parsing_exception` 需修正数据或 Mapping 后再提交。对 429 等过载响应可采用带随机抖动的指数退避重试。重试前还要确认操作的幂等性：对同一文档重复执行 `index` 可能覆盖期间写入的新内容，重复执行递增脚本可能再次累加计数。

## 5. 条件更新与乐观锁

`if_seq_no` 与 `if_primary_term` 用于**客户端乐观并发控制**：客户端读取文档时记录其 `_seq_no` 和 `_primary_term`，提交修改时携带这些值作为条件。只有当条件与当前文档版本匹配时写入才会执行；若期间发生冲突（`_seq_no` 或 `_primary_term` 不匹配，通常返回 HTTP 409），由客户端根据业务语义决定重新读取、重新计算，或将冲突交由上层处理。

`retry_on_conflict` 则用于 **Update API 的服务端自动重试**：当 Update API 内部的读-改-写过程检测到版本冲突时，自动重新读取最新文档、重新执行更新逻辑并写入，发生冲突后最多重试 N 次（初次尝试不计入）。它适合希望在并发更新下重新计算结果的场景，但不等于客户端请求的通用重试机制，也不能替代业务幂等性设计。

示例中的 `5` 和 `1` 是读取文档时获得的实际值，不能固定照抄。

```bash
# 客户端乐观锁：基于读取时的 seq_no 和 primary_term 条件写入
POST /my-index/_update/1?if_seq_no=5&if_primary_term=1
{
  "doc": { "age": 27 }
}

# 服务端自动重试：Update API 内部冲突时自动重试
POST /my-index/_update/1?retry_on_conflict=3
{
  "script": {
    "source": "ctx._source.views += params.inc",
    "params": { "inc": 1 }
  }
}
```

## 6. Upsert（存在则更新，不存在则插入）

```bash
POST /my-index/_update/999
{
  "doc": { "name": "新用户", "age": 18 },
  "doc_as_upsert": true
}
```

`doc_as_upsert: true` 表示目标文档不存在时，用 `doc` 中的内容创建文档；存在时则执行局部更新。若插入内容与更新内容不同，可用 `upsert` 单独指定插入文档：

```bash
POST /my-index/_update/999
{
  "doc": { "age": 18 },
  "upsert": { "name": "新用户", "age": 18 }
}
```

Upsert 仍受并发冲突与 Mapping 校验约束，不能替代业务层的幂等性设计。

## 7. 最佳实践

- Bulk 批次大小通过压测确定，可从 5~15MB 起步测试，逐步增大请求体并观察吞吐、写入延迟与 429 响应；单次请求不要超过 HTTP 请求体限制（默认 100MB，实际以集群 `http.max_content_length` 配置为准）
- 读取文档时用 `_source` 过滤可减少响应体积，但不改变文档存储内容，也不等于存储优化
- 文档可能不存在且需要创建时，用 Upsert 避免客户端先查询再决定写入方式
- 自动生成 ID 适合日志类数据，业务数据建议指定 ID
- 需要隐藏已删除数据时，可用 `is_deleted` 字段做逻辑删除，相关查询须统一过滤。逻辑删除不等于历史版本留存或审计记录，需追溯删除前数据时应另设版本留存、审计日志或备份；是否物理删除应结合数据保留期限、存储成本与合规要求决定

## 8. 延伸阅读

- 字段类型与写入行为的关系见 [Mapping 设计](../02-indexing/chapter-02-mapping.md)
- 文档写入流程与近实时可见性见 [写入流程](../05-distributed-internals/chapter-04-write-path.md)
- 分片路由与主副本关系见 [分片机制](../05-distributed-internals/chapter-02-sharding.md)
