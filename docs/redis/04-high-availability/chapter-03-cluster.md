# 集群

> Redis Cluster 将数据分片存储在多个节点上，实现水平扩展和高可用。

## 1. 数据分片

```text
16384 个哈希槽（Hash Slot）
  CRC16(key) % 16384 = 槽编号

Node 1: 槽 0-5460
Node 2: 槽 5461-10922
Node 3: 槽 10923-16383

key "user:1001" → CRC16("user:1001") % 16384 = 槽 5765 → Node 2
```

## 2. 集群架构

```text
┌─────────────────────────────────────────────┐
│              Redis Cluster                  │
│                                             │
│  Node 1 (Master)    Node 2 (Master)        │
│  槽 0-5460          槽 5461-10922          │
│    │                   │                    │
│  Node 1' (Slave)    Node 2' (Slave)        │
│                                             │
│  Node 3 (Master)                            │
│  槽 10923-16383                             │
│    │                                        │
│  Node 3' (Slave)                            │
└─────────────────────────────────────────────┘
```

每个 Master 有一个或多个 Slave。Master 故障时，Slave 自动提升。

## 3. MOVED 重定向

```text
Client → Node 1: GET user:1001
Node 1: 这个 key 在槽 5765，属于 Node 2
Node 1 → Client: MOVED 5765 node2:6379
Client → Node 2: GET user:1001
Node 2 → Client: "value"
```

智能客户端会缓存槽映射，后续请求直接发到正确节点。

## 4. ASK 重定向（槽迁移中）

```text
槽 5765 正在从 Node 1 迁移到 Node 2：
  Client → Node 1: GET user:1001
  Node 1: ASK 5765 node2:6379
  Client → Node 2: ASKING + GET user:1001
```

## 5. 集群限制

| 限制 | 说明 |
|------|------|
| 多 key 操作 | 必须在同一槽（用 {hashtag}） |
| 事务 | 只支持同槽的多 key 事务 |
| 数据库选择 | 只能用 db0 |
| Lua 脚本 | 所有 key 必须在同一槽 |

### hashtag

```bash
# {user} 相同的 key 会被分配到同一槽
SET {user}:1001:name "Alice"
SET {user}:1001:email "alice@example.com"
# 两个 key 的 hashtag 都是 "user" → 同一槽
```

## 6. 集群搭建

```bash
redis-cli --cluster create \
  node1:6379 node2:6379 node3:6379 \
  node1':6379 node2':6379 node3':6379 \
  --cluster-replicas 1
```

## 7. 扩缩容

```bash
# 添加节点
redis-cli --cluster add-node new_node:6379 existing_node:6379

# 分配槽
redis-cli --cluster reshard existing_node:6379

# 移除节点
redis-cli --cluster del-node node:6379 node_id
```
