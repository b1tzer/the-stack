# 开发运维陷阱

> Redis 踩坑大多来自「命令误用」与「配置不当」。本章汇总开发、运维、集群三方面的常见陷阱，并提供上线前检查清单。

## 1. 开发陷阱

### 1.1 KEYS 命令

```bash
# ❌ 生产环境使用 KEYS *
KEYS user:*   # 遍历所有 key，O(n)，阻塞主线程

# ✅ 用 SCAN 替代
SCAN 0 MATCH user:* COUNT 100
```

`KEYS` 会遍历整个键空间，key 数量百万级时可能阻塞数秒。单线程下这意味着所有客户端都在等待。

### 1.2 DEL 大 Key

```bash
# ❌ 同步删除大 Key
DEL biglist   # 一个有 100 万元素的 List，阻塞数秒

# ✅ 异步删除
UNLINK biglist  # 后台线程删除，不阻塞主线程
```

### 1.3 HGETALL 大 Hash

```bash
# ❌ 返回全部字段
HGETALL user:1001:profile   # 100 个 field

# ✅ 只取需要的字段
HGET user:1001:profile name age

# ✅ 或用 HSCAN 分批
HSCAN user:1001:profile 0 COUNT 20
```

### 1.4 String 存 JSON

```bash
# ❌ 整个对象存为 JSON 字符串
SET user:1001 '{"name":"张三","age":25,"email":"zhangsan@qq.com"}'
# 更新 age 需要全量覆盖，并发下互相覆盖

# ✅ 用 Hash 存字段
HSET user:1001 name "张三" age 25 email "zhangsan@qq.com"
HINCRBY user:1001 age 1   # 只更新 age
```

### 1.5 无 TTL 缓存

```bash
# ❌ 缓存 key 没有过期时间
SET cache:user:1001 "{...}"

# ✅ 设置合理 TTL
SET cache:user:1001 "{...}" EX 300
```

无 TTL 的 key 会永久占用内存，直到被淘汰策略踢出或手动删除。

### 1.6 短连接

```java
// ❌ 每次操作都新建连接
Jedis jedis = new Jedis("10.0.0.1", 6379);
jedis.get("key");
jedis.close();  // TCP 四次挥手

// ✅ 使用连接池
JedisPool pool = new JedisPool("10.0.0.1", 6379);
try (Jedis jedis = pool.getResource()) {
    jedis.get("key");
}
```

## 2. 运维陷阱

### 2.1 主节点不持久化

```bash
# ❌ 主节点关闭持久化，靠从节点持久化
save ""

# 问题：主节点宕机 → 哨兵提升从节点 → 但数据可能不全
# 正确：主节点必须开启持久化
save 900 1
save 300 10
```

### 2.2 不设 maxmemory

```bash
# ❌ 不设内存上限
# 问题：内存持续增长直到 OOM Killer

# ✅ 设上限 + 淘汰策略
maxmemory 4gb
maxmemory-policy allkeys-lru
```

### 2.3 透明大页（THP）

Linux 的 THP（Transparent Huge Pages）会导致 fork 性能下降：

```bash
# 检查 THP 状态
cat /sys/kernel/mm/transparent_hugepage/enabled
# [always] madvise never  ← 开启了

# 关闭 THP
echo never > /sys/kernel/mm/transparent_hugepage/enabled
```

> THP 导致 fork 时页表复制变慢，内存写入时 COW 复制的页更大。Redis 官方建议关闭 THP。

### 2.4 appendfsync always

```bash
# ❌ 每条命令都 fsync
appendfsync always   # 写入性能下降 10 倍以上

# ✅ 每秒 fsync
appendfsync everysec
```

### 2.5 单实例内存过大

```bash
# ❌ 单实例 50GB 数据
# 问题：fork 耗时 > 1 秒，期间阻塞所有请求

# ✅ 控制单实例 ≤ 10GB，用集群分片
maxmemory 10gb
```

## 3. 集群陷阱

### 3.1 跨槽多 key 命令

```bash
# ❌ 跨槽操作
MGET user:1001 user:1002   # 不同槽，报错

# ✅ 用哈希标签强制同槽
MGET {user:1001}:name {user:1001}:age
```

### 3.2 热 Key 集中

```bash
# ❌ 所有热 key 都在同一分片
# 导致该分片 QPS 远高于其他分片

# ✅ 本地缓存 + key 复制分散
SET hotkey:r1 value
SET hotkey:r2 value
SET hotkey:r3 value  # 分散到不同槽
```

### 3.3 大 Key 迁移

```bash
# ❌ 大 Key 在集群中迁移
# 导致迁移卡住，影响集群性能

# ✅ 先拆分大 Key，再迁移
```

## 4. 上线检查清单

| 类别 | 检查项 | 通过 |
| :-- | :-- | :-- |
| 内存 | `maxmemory` 已设且留有余量 | □ |
| 淘汰 | `maxmemory-policy` 符合业务 | □ |
| 持久化 | 主节点开启持久化 | □ |
| fsync | `appendfsync` 为 `everysec` | □ |
| 过期 | 缓存 key 都设置了 TTL | □ |
| 命令 | 无 KEYS、大 DEL 等危险命令 | □ |
| 连接 | 客户端使用连接池 | □ |
| THP | 透明大页已关闭 | □ |
| 监控 | 内存、延迟、命中率已接入告警 | □ |
| 高可用 | 哨兵/集群已配置 | □ |
| 大 Key | 已扫描并处理大 Key | □ |
| 热 Key | 已识别并做本地缓存或分散 | □ |

> 上线前的检查清单不是形式，而是把「踩过的坑」固化下来，避免重复犯错。
