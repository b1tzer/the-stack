# 对象系统与编码

> Redis 对外提供五种核心数据类型 String、List、Hash、Set、ZSet，对内却各有多套底层编码。以 Hash 为例，数据量小时用紧凑的 listpack，数据量变大或元素变长时切换到 hashtable。类型对外的命令接口始终不变，但编码切换涉及新结构分配与数据迁移，会产生额外开销。理解编码切换的规则，才能解释 Redis 内存占用为什么省，也能在设计数据结构与成员值时避免触发不必要的编码升级。

## 1. 数据结构与编码

前一章讨论的是 Redis 的底层数据结构——各结构自身如何工作；本章讨论的是 `redisObject.encoding` 字段——Redis 在运行时为某个类型实际选用了哪种结构。

编码不是另一套结构，它只是标识当前采用哪种 [数据结构](./chapter-04-data-structures.md) 的编码标识：

- `encoding` = `intset` → 这个 Set 当前用整数集合实现
- `encoding` = `hashtable` → 这个 Set 当前用字典实现

数据结构回答「结构本身如何工作」，编码回答「这个类型此刻装配了哪种结构」。本文以 Redis 7.x 为基准，默认配置值以 7.0 为准，涉及版本差异处单独标注。

各编码全貌：

| 编码 | 所属类型 | 关键操作复杂度 | 空间特性 |
| :-- | :-- | :-- | :-- |
| `int` | String | O(1) | 整数直接编码在 ptr 字段，不分配 SDS |
| `embstr` | String | O(1) | 对象头 + SDS 连续分配，缓存友好 |
| `raw` | String | O(1) | 对象头 + SDS 分离分配 |
| `intset` | Set | 二分查找 O(log n)，插入/删除 O(n) | 最紧凑的有序整数数组 |
| `listpack` | Hash/ZSet（Set 自 7.2） | 查找 O(n)，插入/删除可能移动内存 | 连续内存，无连锁更新 |
| `quicklist` | List | 两端操作通常 O(1) | 链表 + listpack 节点 |
| `hashtable` | Hash/Set | 平均 O(1)，扩缩容有额外开销 | 标准哈希表 |
| `skiplist` | ZSet | 查找/插入 O(log n)，范围遍历另计 | 跳表 + 字典双结构 |

## 2. RedisObject：统一对象模型

Redis 的所有 value 都先包一层 `redisObject`，再指向真正的数据。这一层的作用是解耦：对外用 `type` 定义接口（命令按 `type` 校验合法性），对内用 `encoding` 决定实现（同一 `type` 可切换不同编码），两者独立变化。

```c
typedef struct redisObject {
    unsigned type:4;      // 类型：本文重点讨论的五种核心数据类型（String/Hash/List/Set/ZSet）
    unsigned encoding:4;  // 编码：int/embstr/raw/listpack/hashtable 等
    unsigned lru:24;      // LRU 时间戳（或 LFU 计数）
    int refcount;         // 引用计数
    void *ptr;            // 指向底层数据的指针
} robj;
```

`type`、`encoding`、`lru` 是位域（bit-field），`4 + 4 + 24 = 32` 位，合计 32 位；再加上 `refcount` 4 字节和 `ptr` 8 字节，在常见的 64 位构建下对象头占 **16 字节**。C 语言位域的实际内存布局由编译器和目标平台决定，这里以常见 64 位部署为准。

这 16 字节与 §3.2 embstr 的 44 字节阈值相关：16（对象头）+ 3（`sdshdr8` 头）+ 1（结尾 `\0`）= 20，44 + 20 = 64，恰好是一个 64 字节内存块的大小。这个换算能帮助理解阈值的由来，但实际分配开销还取决于分配器的大小分级。

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

`refcount` 支撑对象共享：Redis 启动时预创建 0~9999 共 10000 个整数对象（`OBJ_SHARED_INTEGERS`，不含负数）。多个 key 存储 0~9999 范围内相同的小整数、且走共享整数创建路径时，会指向同一个 `redisObject`，靠 `refcount` 计数管理生命周期。需要注意的是，当配置了 maxmemory 且采用 LRU/LFU 淘汰策略时，共享整数对象会被禁用，因为共享对象的访问时间字段无法被多个 key 独立跟踪。

需要修改值时，命令路径会先做对象分离或重新构造再写入，不会污染其他引用同一个对象的 key。

## 3. String 的三种编码

### 3.1 int 编码

当 value 符合 64 位有符号整数范围时，Redis 可以采用 int 编码，把整数值直接存在 `redisObject.ptr` 里（不分配 SDS）：

```txt
SET counter 1000
OBJECT ENCODING counter   # 返回 int
redisObject{type=String, encoding=int, ptr=1000}
```

int 编码是内部存储优化，不改变 String 对外的字符串语义，客户端读取时仍得到字符串形式的值。实际是否采用 int 编码，应以 `OBJECT ENCODING` 的返回为准，而不是仅凭值看起来像整数就推断。

### 3.2 embstr 编码

当 value 是字符串且长度 ≤ 44 字节时，`redisObject` 和 SDS 在一次 `malloc` 中连续分配：

```txt
redisObject | sdshdr8 | buf（≤ 44 字节）
← 一次 malloc →
```

embstr 的优势：一次内存分配（而非两次），对象头和数据连续（缓存友好），一次 `free` 就能释放。

为什么阈值恰好是 44 字节？在常见的 64 位部署中，`redisObject` 占 16 字节、`sdshdr8` 头部占 3 字节、字符串结尾的 `\0` 占 1 字节，合计 20 字节；44 + 20 = 64，恰好落在 jemalloc 等分配器的 64 字节 size class 内。这里的 44 字节指字符串内容长度，不含结尾 `\0`。该阈值受对象布局和分配器影响，Redis 3.2 之前为 39 字节，实际以目标版本的 `OBJECT ENCODING` 为准。

### 3.3 raw 编码 {#raw-encoding}

当 value 是字符串且长度 > 44 字节时，`redisObject` 和 SDS 分别分配：

```txt
redisObject          sdshdr + buf
  ↓ ptr ──────────→
← malloc 1 →        ← malloc 2 →
```

raw 并不只出现在长字符串上：短字符串在特定创建路径（如对 embstr 做修改）下也会转为 raw，因此不能仅凭字符串长度判断实际编码。

### 3.4 编码切换

```bash
SET a 1000          # int
OBJECT ENCODING a   # int

SET a "hello"       # embstr（≤ 44 字节）
SET a "很长的字符串..." # raw（> 44 字节）

# int 编码的 String 值做 APPEND，会转入字符串修改路径
SET a 1000          # int
APPEND a "abc"      # 转为 raw
```

> `embstr` 不可原地扩展，对它做任何修改（如 `APPEND`）都会先转为 `raw` 再修改。int 编码的值在 `APPEND` 后同样会转为 `raw`。

## 4. Hash 的编码切换 {#hash-encoding}

为什么同一份 Hash 数据要用两种编码？

- 紧凑编码（listpack）连续存储、无指针开销，但查询需线性扫描，元素一多就慢；
- hashtable 查询 O(1)，但有桶数组、节点指针等固定开销，元素少时反而浪费。

因此 Redis 在元素少时用紧凑编码省内存，元素多时切换 hashtable 保性能。切换条件由配置阈值规定，并不是运行时测量两种编码成本后计算出的动态交点。

### 4.1 listpack 编码（小数据）

```bash
# 默认：field 数量 ≤ 512 且 每个 field/value 长度 ≤ 64 字节时用 listpack
hash-max-listpack-entries 512
hash-max-listpack-value 64
```

`hash-max-listpack-entries` 限制的是 field 数量，`hash-max-listpack-value` 同时约束 field 和 value 的字符串长度，单位是字节而不是字符数。listpack 编码下，field 和 value 连续存储在一块内存里：

```txt
listpack: [len|field1][len|value1][len|field2][len|value2]...[end]
```

### 4.2 hashtable 编码（大数据）

超过阈值后切换为标准哈希表：

```bash
HSET user:1001 name "张三" age 25 email "zhangsan@qq.com"
OBJECT ENCODING user:1001   # listpack（3 个 field）

# 当 field 数量超过 512，或任一 field/value 长度超过 64 字节时，
# 自动切换为 hashtable
```

### 4.3 Hash 编码转换不可逆 {#irreversible}

Hash 一旦从 listpack 升级为 hashtable，即使后来删除 field 使数量低于阈值，也不会自动降回 listpack。配置阈值控制的是转换条件，Redis 并不会在每次数据量变化后重新选择最省内存的编码。

## 5. List 的编码

Redis 7.0 的 List 使用 quicklist 编码：quicklist 由多个节点组成，每个节点内部保存一个 listpack。

```bash
list-max-listpack-size -2   # 节点大小策略，-2 对应约 8 KiB 目标大小
list-compress-depth 0        # 不压缩（>0 时压缩两端以外的节点）
```

`list-max-listpack-size` 控制节点大小策略，`-2` 对应约 8 KiB 的目标大小，不是任何情况下都不超过的绝对上限；`list-compress-depth` 控制两端保留不压缩节点的深度，0 表示不压缩。

## 6. Set 的编码

Set 的编码随版本演进：Redis 7.0 只有 intset 与 hashtable 两种；7.2 起新增 listpack，作为两者之间的紧凑中间形态。三种编码的选用由成员内容、元素数量与配置阈值共同决定，并非固定的一级级升级。

### 6.1 intset 编码

当所有元素都是整数且数量 ≤ `set-max-intset-entries`（默认 512）时用 intset：

```bash
SADD tags 1 2 3 4 5   # 全是整数，用 intset
```

intset 是有序整数数组，二分查找 O(log n)，插入和删除可能需要移动数组元素。

### 6.2 listpack 编码（Redis 7.2 起）

Redis 7.2 起，Set 新增 listpack。当成员不能全部用整数表示时，若元素数量 ≤ `set-max-listpack-entries`（默认 128）且每个成员长度 ≤ `set-max-listpack-value`（默认 64 字节），用 listpack。intset 因加入非整数成员而转换时，也可能落到 listpack。

### 6.3 hashtable 编码

当元素数量超过相应阈值、或成员长度超过 `set-max-listpack-value` 时，用 hashtable。注意 intset 元素数量超过 `set-max-intset-entries` 时会直接转为 hashtable，并不先经过 listpack。在 Redis 7.0 中，只要不是全整数的 intset，就直接用 hashtable。

## 7. ZSet 的编码

### 7.1 listpack 编码

元素数量 ≤ `zset-max-listpack-entries`（默认 128）且每个成员字符串长度 ≤ `zset-max-listpack-value`（默认 64 字节）时用 listpack。长度限制针对成员字符串，不含 score（score 内部按数值处理）。

### 7.2 skiplist + dict 编码

超过阈值后切换为跳表 + 字典的双结构：

```c
typedef struct zset {
    dict *dict;       // 成员 → 分值的映射（O(1) 查分值）
    zskiplist *zsl;   // 跳表（按分值排序，O(log n) 范围查询）
} zset;
```

为什么需要两个结构？

| 结构 | 作用 | 复杂度 |
| :-- | :-- | :-- |
| dict | 根据成员查对应分值 | `ZSCORE` 平均 O(1) |
| skiplist | 按分值维护有序关系，支持排名与范围操作 | 定位 O(log n)，返回 M 个元素另计输出成本 |

dict 和 skiplist 会复用成员字符串（sds）的存储，避免重复保存同一份成员字符串，但跳表节点、字典条目本身仍有各自的结构开销，并非「不额外占用内存」。

## 8. 编码配置速查

| 配置 | 默认值 | 作用 |
| :-- | :-- | :-- |
| `hash-max-listpack-entries` | 512 | Hash 的 field 数量超过该值时切换为 hashtable |
| `hash-max-listpack-value` | 64 | Hash 的 field 或 value 长度超过该字节数时切换 |
| `set-max-intset-entries` | 512 | Set 使用 intset 时允许的元素数量上限 |
| `set-max-listpack-entries` | 128 | Set（7.2 起）使用 listpack 时的元素数量上限 |
| `set-max-listpack-value` | 64 | Set（7.2 起）使用 listpack 时的成员长度上限 |
| `zset-max-listpack-entries` | 128 | ZSet 元素数量超过该值时切换为 skiplist + dict |
| `zset-max-listpack-value` | 64 | ZSet 成员字符串长度超过该字节数时切换 |
| `list-max-listpack-size` | -2 | quicklist 节点大小策略，-2 对应约 8 KiB |

> 这些默认值针对 Redis 7.x。调整阈值本质是在内存占用与操作性能之间取舍，不存在对所有业务都适用的统一方向；调整前应结合实际数据规模、元素长度与访问模式，用 `OBJECT ENCODING` 和内存占用验证效果。
