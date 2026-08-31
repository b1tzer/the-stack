# 对象系统与编码

> Redis 对外暴露 5 种数据类型，对内却有多种底层编码。同一个 Hash，数据量小时用紧凑的 listpack，数据量大时切换到 hashtable——这一切对用户完全透明。理解编码切换的规则，才能解释 Redis 内存占用为什么省，也能避免设计 Key 时触发不必要的编码升级。

## 1. 数据结构与编码

前一章讨论的是 Redis 的底层数据结构——也就是各种“零件”的真实形态；本章讨论的是 `redisObject.encoding` 字段——也就是 Redis 在运行时为某个类型实际选用了哪种零件。

编码不是另一套结构，它只是一个“指向第 4 章那些结构的选择器”：

- `encoding` = `intset` → 这个 Set 当前用整数集合实现
- `encoding` = `hashtable` → 这个 Set 当前用字典实现

数据结构回答的是「零件本身如何工作」；编码回答的是「这个类型此刻装配了哪种零件」。

各编码全貌：

| 编码 | 所属类型 | 时间复杂度 | 空间特性 |
| :-- | :-- | :-- | :-- |
| `int` | String | O(1) | 最省，8 字节直接存整数 |
| `embstr` | String | O(1) | 对象头 + SDS 连续分配，缓存友好 |
| `raw` | String | O(1) | 对象头 + SDS 分离分配 |
| `intset` | Set | O(log n) | 最紧凑的有序整数数组 |
| `listpack` | Hash/ZSet/Set | O(n) | 连续内存，无连锁更新 |
| `quicklist` | List | O(1) 两端 | 链表 + listpack 节点 |
| `hashtable` | Hash/Set | O(1) | 标准哈希表 |
| `skiplist` | ZSet | O(log n) | 跳表 + 字典双结构 |

## 2. RedisObject：统一对象模型

Redis 的所有 value 都先包一层 `redisObject`，再指向真正的数据。这一层的作用是解耦：对外用 `type` 定义接口（命令按 `type` 校验合法性），对内用 `encoding` 决定实现（同一 `type` 可切换不同编码），两者独立变化。

```c
typedef struct redisObject {
    unsigned type:4;      // 类型：String/Hash/List/Set/ZSet
    unsigned encoding:4;  // 编码：int/embstr/raw/listpack/hashtable 等
    unsigned lru:24;      // LRU 时间戳（或 LFU 计数）
    int refcount;         // 引用计数
    void *ptr;            // 指向底层数据的指针
} robj;
```

`type`、`encoding`、`lru` 是位域（bit-field），`4 + 4 + 24 = 32` 位，恰好拼成一个 `int`。整个对象头固定 **16 字节**：32 位位域 + `refcount` 4 字节 + `ptr` 8 字节。

这个 16 字节不是孤立数字——它直接决定了 §3.2 embstr 的 44 字节阈值：16（对象头）+ 3（`sdshdr8` 头）+ 1（结尾 `\0`）= 20，44 + 20 = 64，正好落在分配器一个 64 字节内存块内。对象头的设计约束着整个 String 编码的取舍。

关键字段：

| 字段 | 位数 | 作用 |
| :-- | :-- | :-- |
| `type` | 4 | 对外的数据类型，命令据此判断是否合法 |
| `encoding` | 4 | 对内的底层编码，决定数据如何存储 |
| `lru` | 24 | LRU 时间戳；LFU 模式下拆成 16 位时间 + 8 位频次 |
| `refcount` | 32 | 引用计数，用于内存回收与对象共享 |
| `ptr` | 64 | 指向实际的底层结构 |

`type` 和 `encoding` 各 4 位，最多表示 16 种取值，Redis 实际只用了其中几种，留有余量。

### 2.1 对象共享

`refcount` 支撑对象共享：Redis 启动时预创建 0~9999 共 10000 个整数对象（`OBJ_SHARED_INTEGERS`）。多个 key 存储相同的小整数时，指向同一个 `redisObject`，靠 `refcount` 计数管理生命周期。

```text
SET a 1000   → robj{type=String, encoding=int, ptr=1000, refcount=1}
SET b 1000   → 同一个 robj，refcount 加 1
SET c 1000   → 同一个 robj，refcount 加 1
```

共享对象是只读的：任何修改共享对象的命令，都会先拷贝一份私有副本再修改，不会污染其他 key 的值。

为什么只共享整数、不共享字符串？整数只有 0~9999 这 10000 个可能值，可以一次性预创建；且整数比较 O(1)，判断「是否已存在相同对象」代价极低。字符串有无限可能值、比较 O(n)，无法低成本验证是否已存在相同内容，共享的查找成本会抵消收益。

## 3. String 的三种编码

### 3.1 int 编码

当 value 是整数且可以用 `long` 表示时，直接存在 `redisObject.ptr` 里（不分配 SDS）：

```text
SET counter 1000
redisObject{type=String, encoding=int, ptr=1000}
```

### 3.2 embstr 编码

当 value 是字符串且长度 ≤ 44 字节时，`redisObject` 和 SDS 在一次 `malloc` 中连续分配：

```text
redisObject | sdshdr8 | buf（≤ 44 字节）
← 一次 malloc →
```

embstr 的优势：一次内存分配（而非两次），对象头和数据连续（缓存友好），一次 `free` 就能释放。

为什么阈值恰好是 44 字节？`redisObject` 占 16 字节、`sdshdr8` 头部占 3 字节、字符串结尾的 `\0` 占 1 字节，合计 20 字节。44 + 20 = 64，正好落在分配器一个 64 字节内存块内。把对象控制在 64 字节内，就能让「一次分配、一次释放」的收益最大化（该值在 Redis 3.2 之前是 39 字节，因当时的 SDS 头部为 8 字节）。

### 3.3 raw 编码 {#raw-encoding}

当 value 是字符串且长度 > 44 字节时，`redisObject` 和 SDS 分别分配：

```text
redisObject          sdshdr + buf
  ↓ ptr ──────────→
← malloc 1 →        ← malloc 2 →
```

### 3.4 编码切换

```bash
SET a 1000          # encoding: int
SET a "hello"       # encoding: embstr（≤ 44 字节）
SET a "很长的字符串..." # encoding: raw（> 44 字节）

# int 编码的 key 做 APPEND 变成字符串
SET a 1000          # int
APPEND a "abc"      # 变成 raw 或 embstr
```

> `embstr` 是只读的：对 `embstr` 编码的值做任何修改（如 `APPEND`），都会先转为 `raw` 编码再修改。

## 4. Hash 的编码切换 {#hash-encoding}

为什么同一份 Hash 数据要用两种编码？

- 紧凑编码（listpack）连续存储、无指针开销，但查询需线性扫描，元素一多就慢；
- hashtable 查询 O(1)，但有桶数组、节点指针等固定开销，元素少时反而浪费。

因此 Redis 在元素少时用紧凑编码省内存，元素多时切换 hashtable 保性能——阈值就是这两者的交点。

### 4.1 listpack 编码（小数据）

```bash
# 默认：元素 ≤ 128 个 且 每个值 ≤ 64 字节时用 listpack
hash-max-listpack-entries 128
hash-max-listpack-value 64
```

listpack 编码下，field 和 value 连续存储在一块内存里：

```text
listpack: [len|field1][len|value1][len|field2][len|value2]...[end]
```

### 4.2 hashtable 编码（大数据）

超过阈值后切换为标准哈希表：

```bash
HSET user:1001 name "张三" age 25 email "zhangsan@qq.com"
# 3 个 field，用 listpack

HSET user:1001 field1 "v1" field2 "v2" ... field200 "v200"
# 超过 128 个 field，自动切换为 hashtable
```

### 4.3 编码切换不可逆 {#irreversible}

一旦从 listpack 升级为 hashtable，即使后来删除元素使数量低于阈值，也不会降回 listpack。这是 Redis 的设计选择——避免频繁的编码切换开销。

## 5. List 的编码

Redis 7.0 的 List 统一使用 quicklist 编码：

```bash
list-max-listpack-size -2   # 每个 listpack 节点最大 8KB
list-compress-depth 0        # 不压缩（>0 时压缩两端以外的节点）
```

## 6. Set 的编码

### 6.1 intset 编码

当所有元素都是整数且数量 ≤ `set-max-intset-entries`（默认512）时用 intset：

```bash
SADD tags 1 2 3 4 5   # 全是整数，用 intset
```

### 6.2 listpack 编码

Redis 7.0 新增：元素非整数但数量少时用 listpack。

### 6.3 hashtable 编码

超过阈值或元素非整数时用 hashtable。

## 7. ZSet 的编码

### 7.1 listpack 编码

元素 ≤ `zset-max-listpack-entries`（默认128）且值 ≤ `zset-max-listpack-value`（默认64字节）时用 listpack。

### 7.2 skiplist + dict 编码

超过阈值后切换为跳表 + 字典的双结构：

```c
typedef struct zset {
    dict *dict;       // 成员 → 分值的映射（O(1) 查分值）
    zskiplist *zsl;   // 跳表（按分值排序，O(log n) 范围查询）
} zset;
```

为什么需要两个结构？

| 结构 | 用途 |
| :-- | :-- |
| dict | `ZSCORE` 命令：O(1) 查某个成员的分值 |
| skiplist | `ZRANGE`/`ZRANGEBYSCORE`：O(log n) 范围查询 |

两者通过指针共享同一个 `zskiplistNode`，不额外占用内存。

## 8. 编码配置速查

| 配置 | 默认值 | 说明 |
| :-- | :-- | :-- |
| `hash-max-listpack-entries` | 128 | Hash 超过此值切换为 hashtable |
| `hash-max-listpack-value` | 64 | Hash 值超过此字节数切换 |
| `set-max-intset-entries` | 512 | Set 超过此值切换 |
| `zset-max-listpack-entries` | 128 | ZSet 超过此值切换 |
| `zset-max-listpack-value` | 64 | ZSet 值超过此字节数切换 |
| `list-max-listpack-size` | -2 | List 每个节点最大 8KB |

> 这些阈值可以根据业务场景调整。如果确定某个 Hash 永远不超过 50 个 field，可以保持默认值。如果数据量可能很大，可以适当调低阈值，提前切换到高性能编码。
