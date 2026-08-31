# 集群模式

> 哨兵解决了高可用，但数据量大到单机装不下时，就需要把数据分片到多个节点。Redis Cluster 通过哈希槽把数据分散到多个主节点，同时支持水平扩展与自动故障转移。本章从分片原理、Gossip 协议、请求路由到扩缩容，完整讲解集群机制。

## 1. 分片原理

Redis Cluster 把整个键空间划分为 **16384 个哈希槽（slot）**，每个节点负责一部分槽。

### 1.1 槽的分配

```text
节点 A：slot 0 ~ 5460（5461 个槽）
节点 B：slot 5461 ~ 10922（5462 个槽）
节点 C：slot 10923 ~ 16383（5461 个槽）
```

### 1.2 key 到槽的映射

```text
槽号 = CRC16(key) % 16384
```

如果 key 包含 `{}`，只对 `{}` 内的内容计算哈希（哈希标签）：

```text
{user:1001}:name  → CRC16("user:1001") % 16384
{user:1001}:age   → CRC16("user:1001") % 16384
两者槽号相同
```

### 1.3 为什么是 16384

| 原因 | 说明 |
| :-- | :-- |
| 心跳包大小 | Gossip 心跳携带槽位图，16384 个槽用 2KB（16384/8=2048 字节）表示 |
| 节点数上限 | 官方建议节点数 ≤ 1000，16384 个槽足够分配 |
| 网络开销 | 槽数量过大时心跳包更大，节点通信开销增加 |

> 为什么不用 65536？作者 antirez 的解释：集群节点数不太可能超过 1000，16384 个槽已经足够，心跳包用 2KB 表示比 8KB 更高效。

## 2. Gossip 协议

节点之间通过 Gossip 协议交换集群状态。每个节点每秒随机选择几个节点发送 `PING`，接收方返回 `PONG`。

### 2.1 消息类型

| 消息 | 方向 | 内容 |
| :-- | :-- | :-- |
| `PING` | A → B | 发送 A 知道的集群状态（槽分配、节点信息） |
| `PONG` | B → A | 返回 B 知道的集群状态 |
| `MEET` | A → B | 新节点加入集群 |
| `FAIL` | 广播 | 通知所有节点某个节点已故障 |

### 2.2 消息体

Gossip 消息携带的信息：

```text
{
  "sender": "node-a",
  "slots": [0, 1, 2, ..., 5460],     // 负责的槽
  "cluster_state": "ok",
  "cluster_size": 3,
  "nodes": [                           // 已知的节点列表
    {"id": "node-a", "ip": "10.0.0.1", "port": 6379, "flags": "master"},
    {"id": "node-b", "ip": "10.0.0.2", "port": 6379, "flags": "master"},
    {"id": "node-c", "ip": "10.0.0.3", "port": 6379, "flags": "master"}
  ]
}
```

### 2.3 收敛速度

Gossip 是最终一致的：新状态需要几轮传播才能到达所有节点，节点越多、收敛越慢。具体耗时取决于节点规模、网络延迟与消息发送间隔，没有统一的固定数值。

## 3. 请求路由

### 3.1 MOVED（永久重定向）

客户端请求的 key 不在当前节点时，返回 `MOVED`：

```text
客户端 → 节点A：GET user:1001
节点A  → 客户端：-MOVED 3999 10.0.0.2:6379
客户端 → 节点B：GET user:1001（永久改道）
```

智能客户端会缓存「槽 → 节点」映射，后续请求直接路由到正确节点。

### 3.2 ASK（临时重定向）

槽迁移期间，key 可能在旧节点也可能在新节点：

```text
客户端 → 节点A：GET user:1001
节点A  → 客户端：-ASK 3999 10.0.0.2:6379
客户端 → 节点B：ASKING + GET user:1001（临时访问，不更新映射）
```

| 类型 | 场景 | 客户端行为 |
| :-- | :-- | :-- |
| MOVED | 槽已归属其他节点 | 更新本地映射，永久改道 |
| ASK | 槽正在迁移 | 临时访问一次，不更新映射 |

### 3.3 Jedis Cluster 客户端

```java
Set<HostAndPort> nodes = new HashSet<>();
nodes.add(new HostAndPort("10.0.0.1", 6379));
nodes.add(new HostAndPort("10.0.0.2", 6379));
nodes.add(new HostAndPort("10.0.0.3", 6379));

JedisCluster cluster = new JedisCluster(nodes);

// 自动路由到正确节点
cluster.set("user:1001:name", "张三");
String name = cluster.get("user:1001:name");

// 同槽多 key 操作
cluster.mset("{user:1001}:name", "张三", "{user:1001}:age", "25");
```

## 4. 故障检测

### 4.1 PFAIL → FAIL

```text
节点A → 节点B：PING
节点B → 节点A：...（超时无响应）
节点A 标记 B 为 PFAIL（疑似下线）

节点C → 节点B：PING
节点B → 节点C：...（超时无响应）
节点C 标记 B 为 PFAIL

当集群中超过半数主节点都标记 B 为 PFAIL → B 升级为 FAIL（确认下线）
```

| 阶段 | 说明 |
| :-- | :-- |
| PFAIL（疑似下线） | 单个节点认为目标下线 |
| FAIL（确认下线） | 超过半数主节点确认，广播 FAIL 消息 |

### 4.2 故障转移

从节点发现自己的主节点 FAIL 后，发起选举：

```text
1. 从节点向所有主节点请求投票
2. 获得超过半数主节点投票的从节点当选
3. 新主节点接管原主节点的所有槽
4. 新主节点广播自己的新身份
```

选举规则与哨兵类似：偏移量最大（数据最新）的从节点优先。

## 5. 扩缩容

### 5.1 添加节点

```bash
# 1. 启动新节点
redis-server --port 6380 --cluster-enabled yes

# 2. 加入集群
redis-cli --cluster add-node 10.0.0.4:6380 10.0.0.1:6379

# 3. 分配槽（从现有节点迁移）
redis-cli --cluster reshard 10.0.0.1:6379
# 交互式：迁多少个槽？→ 从哪些节点迁？→ 迁到哪个节点？
```

### 5.2 移除节点

```bash
# 1. 先迁走该节点的槽
redis-cli --cluster reshard 10.0.0.1:6379

# 2. 移除节点
redis-cli --cluster del-node 10.0.0.1:6379 <node-id>
```

### 5.3 槽迁移过程

```text
1. 目标节点：CLUSTER SETSLOT <slot> IMPORTING <source-node-id>（准备接收）
2. 源节点：CLUSTER SETSLOT <slot> MIGRATING <target-node-id>（准备发送）
3. 源节点：CLUSTER GETKEYSINSLOT <slot> <count>（获取槽内 key 列表）
4. 源节点：MIGRATE <target-ip> <port> "" 0 5000 KEYS key1 key2...（逐个迁移 key）
5. 所有节点：CLUSTER SETSLOT <slot> NODE <target-node-id>（更新槽归属）
```

为什么需要 `IMPORTING` / `MIGRATING` 两个状态同时存在？槽迁移不是原子的，key 逐个从源迁到目标，迁移过程中某个 key 可能还在源节点、也可能已到目标节点。源节点标记 `MIGRATING`：请求的 key 若还在本地就正常处理，不在则返回 `ASK` 指向目标节点；目标节点标记 `IMPORTING`：只有收到 `ASKING` 前缀的请求才允许查询该槽。双向状态让迁移期间的读写请求总能找到 key 当前所在的节点。

迁移期间，对该槽的请求遵循 ASK 规则。

## 6. 跨槽限制

集群下，多 key 命令要求所有 key 在同一个槽：

```bash
# 合法（同槽）
MGET {user:1001}:name {user:1001}:age

# 非法（跨槽）
MGET user:1001 user:1002   # ERR
```

涉及跨槽的解决方案：

| 方案 | 说明 |
| :-- | :-- |
| 哈希标签 | 相关 key 用 `{tag}` 强制同槽 |
| 应用层拆分 | 客户端按槽分组，分别发送 |
| 事务/Lua | 跨槽不支持，必须同槽 |

## 7. 三种方案选型

| 维度 | 主从 | 哨兵 | 集群 |
| :-- | :-- | :-- | :-- |
| 数据分片 | 否 | 否 | 是 |
| 自动故障转移 | 否 | 是 | 是 |
| 水平扩展 | 否 | 否 | 是 |
| 读写分离 | 是 | 是 | 支持 |
| 复杂度 | 低 | 中 | 高 |
| 适用场景 | 小规模、手动切换 | 小规模、高可用 | 大规模、需分片 |

选型建议：

| 场景 | 推荐 |
| :-- | :-- |
| 数据量 < 10GB、可接受手动切换 | 主从 |
| 数据量 < 10GB、要求高可用 | 哨兵 |
| 数据量 > 10GB、需要水平扩展 | 集群 |
