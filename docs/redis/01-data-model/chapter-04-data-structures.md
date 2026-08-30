# 底层数据结构

> Redis 对外暴露多种数据类型，对内则由一套底层数据结构支撑：SDS、链表、字典、跳表、整数集合、压缩列表。这些结构的选择只有一个目标——在内存占用与操作性能之间取得平衡。理解它们，才能解释 Redis 内存为什么省、操作为什么快。

## 1. SDS：动态字符串

Redis 没有直接使用 C 语言的字符串（以 `\0` 结尾的字符数组），而是自建了 SDS（Simple Dynamic String）。

### 1.1 结构

```c
struct __attribute__ ((__packed__)) sdshdr8 {
    uint8_t len;       // 已用长度
    uint8_t alloc;     // 分配的总空间（不含头和 \0）
    unsigned char flags; // 类型标识（低3位表示sdshdr类型）
    char buf[];        // 字节数组
};
```

Redis 7.0 有5种 SDS 类型（sdshdr5/8/16/32/64），按字符串长度自动选择：

| 类型 | len 范围 | 说明 |
| :-- | :-- | :-- |
| sdshdr5 | 0~31 | 最短，flags 和 buf 合并 |
| sdshdr8 | 0~255 | 最常用 |
| sdshdr16 | 0~65535 | 中等长度 |
| sdshdr32 | 0~4GB | 长字符串 |
| sdshdr64 | >4GB | 超长字符串 |

### 1.2 相对 C 字符串的优势

| 能力 | C 字符串 | SDS |
| :-- | :-- | :-- |
| 获取长度 | O(n)，需遍历到 `\0` | O(1)，直接读 len |
| 二进制安全 | 遇到 `\0` 截断 | 以 len 记录长度，可存任意字节 |
| 缓冲区溢出 | 需手动检查长度 | 扩容前自动检查 alloc |
| 内存分配 | 每次修改都要重新分配 | 空间预分配 + 惰性释放 |

### 1.3 空间预分配

SDS 扩容时会多分配一些空间，减少后续修改的内存分配次数：

```text
修改后 len < 1MB → alloc = len * 2（翻倍预分配）
修改后 len ≥ 1MB → alloc = len + 1MB（固定预分配 1MB）
```

惰性释放：缩短字符串时不立即回收空间，而是更新 len，等下次修改时再决定是否回收。

## 2. 链表与 quicklist

### 2.1 双向链表

Redis 的 List 底层最初是双向链表：

```c
typedef struct listNode {
    struct listNode *prev;
    struct listNode *next;
    void *value;
} listNode;

typedef struct list {
    listNode *head;
    listNode *tail;
    unsigned long len;
    // ... 迭代器、复制、释放函数
} list;
```

纯链表的问题：每个节点单独分配内存，指针开销大（prev+next 16字节/节点），内存碎片多。

### 2.2 quicklist：链表 + listpack

Redis 7.0 的 List 底层是 quicklist——一个双向链表，每个节点是一个连续内存的 listpack：

```text
quicklist（链表）
  ├── 节点1（listpack，存多个元素）
  ├── 节点2（listpack，存多个元素）
  └── 节点3（listpack，存多个元素）
```

quicklist 的优势：两端操作 O(1)（链表特性），节点内连续内存（缓存友好），比纯链表省内存。

```bash
# 配置 listpack 节点大小
list-max-listpack-size -2   # -2=每个节点最大 8KB（默认）
```

## 3. 字典（dict）

字典是 Redis 最核心的结构——所有键值对都存在字典里。

### 3.1 结构

```c
typedef struct dict {
    dictType *type;
    void *privdata;
    dictht ht[2];          // 两个哈希表（rehash 用）
    long rehashidx;        // rehash 进度（-1 表示不在 rehash）
    // ...
} dict;

typedef struct dictht {
    dictEntry **table;     // 桶数组
    unsigned long size;    // 桶数量
    unsigned long sizemask; // size - 1，用于取模
    unsigned long used;    // 已使用桶数
} dictht;

typedef struct dictEntry {
    void *key;
    union {
        void *val;
        uint64_t u64;
        int64_t s64;
        double d;
    } v;
    struct dictEntry *next;  // 链地址法解决冲突
} dictEntry;
```

核心设计：`ht[2]` 两个哈希表，正常时只用 `ht[0]`，rehash 时两个都用。

### 3.2 渐进式 rehash

当哈希表的负载因子（used/size）过高或过低时，Redis 触发 rehash，把 `ht[0]` 的数据逐步迁移到 `ht[1]`：

```text
触发条件：
  负载因子 > 1（没有 BGSAVE 时）
  负载因子 > 5（有 BGSAVE 时，避免 rehash 与 fork 同时进行）
  负载因子 < 0.1（缩容）

rehash 过程：
  1. 分配 ht[1]（大小为 ht[0] 的两倍或第一个 ≥ used*2 的 2^n）
  2. rehashidx = 0（开始迁移）
  3. 每次对字典的增删改查操作，额外迁移 ht[0] 中 rehashidx 位置的一个桶
  4. rehashidx++，直到所有桶迁移完毕
  5. 释放 ht[0]，ht[1] 变为 ht[0]，新建空 ht[1]
```

渐进式 rehash 的价值：把一次性大操作拆成多次小操作，每次只迁移一个桶，避免一次性迁移导致的长耗时阻塞。

### 3.3 rehash 期间的查询

```text
查询 key：
  先查 ht[0]，没找到再查 ht[1]

插入 key：
  直接插入 ht[1]（新数据不进 ht[0]）
```

> 渐进式 rehash 期间，字典同时使用两个哈希表。查找时两个表都查，插入时只进新表。这保证了 rehash 过程中不丢数据、不阻塞服务。

## 4. 跳表（skiplist）

跳表是 ZSet 的底层结构之一（当元素较多时），支持 O(log n) 的范围查询。

### 4.1 结构

```c
typedef struct zskiplistNode {
    sds ele;                  // 成员名
    double score;             // 分值
    struct zskiplistNode *backward; // 后退指针（用于逆序遍历）
    struct zskiplistLevel {
        struct zskiplistNode *forward; // 前进指针
        unsigned long span;            // 跨度（用于计算排名）
    } level[];                // 柔性数组，层数随机
} zskiplistNode;

typedef struct zskiplist {
    zskiplistNode *header, *tail;
    unsigned long length;
    int level;                // 当前最大层数
} zskiplist;
```

### 4.2 层高随机化

每个节点的层数是随机的，概率为：

```text
P(level = 1) = 1
P(level = 2) = 1/4
P(level = 3) = 1/16
...
P(level = n) = 1/4^(n-1)
```

层数越高概率越低，形成「金字塔」结构——底层密集、高层稀疏。这保证了跳表的平均查找效率为 O(log n)。

### 4.3 跳表 vs 红黑树

| 维度 | 跳表 | 红黑树 |
| :-- | :-- | :-- |
| 查找 | O(log n) | O(log n) |
| 范围查询 | O(log n + k)（天然支持） | 需要中序遍历 |
| 实现复杂度 | 简单 | 复杂（旋转、染色） |
| 内存 | 指针较多 | 指针较少 |
| 并发 | 局部锁即可 | 全局锁 |

Redis 选择跳表的原因：实现简单、范围查询天然支持（`ZRANGEBYSCORE`）、比红黑树更容易维护。

## 5. 整数集合（intset）

intset 是 Set 的底层编码（当元素全是整数且数量少时）：

```c
typedef struct intset {
    uint32_t encoding;  // 元素编码：16/32/64 位
    uint32_t length;    // 元素数量
    int8_t contents[];  // 有序整数数组
} intset;
```

特点：有序数组、二分查找 O(log n)、自动升级编码（存入更大整数时从16位升级到32位）。

## 6. listpack（压缩列表替代）

Redis 7.0 用 listpack 替代了 ziplist。listpack 解决了 ziplist 的「连锁更新」问题。

### 6.1 ziplist 的连锁更新问题

ziplist 每个节点的 `previous_entry_length` 记录前一个节点的长度（1字节或5字节）。当某个节点从短变长（跨越254字节阈值），后续所有节点的 `previous_entry_length` 都要从1字节扩展到5字节，可能引发连锁反应。

```text
连锁更新：节点A变长 → 节点B的prevlen扩展 → 节点B变长 → 节点C的prevlen扩展 → ...
最坏情况：O(n^2) 时间复杂度
```

### 6.2 listpack 的改进

listpack 去掉了 `previous_entry_length`，每个节点记录自己的长度而非前一个节点的长度：

```text
listpack 节点：[encoding][data][self-len]
```

节点长度变化只影响自己，不会波及其他节点，彻底消除连锁更新。

## 7. 小结

| 结构 | 用途 | 核心优势 |
| :-- | :-- | :-- |
| SDS | String 底层 | O(1) 长度、二进制安全、预分配 |
| quicklist | List 底层 | 链表 + 连续内存，两端 O(1) |
| dict | 所有键值对 | 渐进式 rehash，不阻塞 |
| skiplist | ZSet 底层 | O(log n) 范围查询，实现简单 |
| intset | Set（纯小整数） | 有序数组，自动升级编码 |
| listpack | Hash/ZSet/Set（小数据） | 连续内存，无连锁更新 |
