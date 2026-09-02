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

![SDS 结构内存布局](/redis/01-data-model-chapter-04-data-structures-3.svg)

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

### 1.3 空间预分配 {#sds-prealloc}

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

![quicklist 结构](/redis/01-data-model-chapter-04-data-structures-4.svg)

quicklist 是三层结构：`quicklist`（外层对象）→ `quicklistNode`（链表节点）→ `listpack`（连续内存存多个元素）。

```c
typedef struct quicklist {
    quicklistNode *head;
    quicklistNode *tail;
    unsigned long count;          // 所有 listpack 中元素总数
    unsigned long len;            // quicklistNode 数量
    int fill : 16;                // 节点大小上限（对应 list-max-listpack-size）
    unsigned int compress : 16;   // 中间节点压缩深度（对应 list-compress-depth）
} quicklist;
```

**为什么要「链表 + listpack」混合？** 纯链表的每个元素都单独 `malloc` 一个 `listNode`，指针开销大、内存碎片多；纯 listpack（一整块连续内存）虽然省内存，但中间插入、删除要移动后续所有元素，O(n)。quicklist 在两者之间取折中：链表保证两端 O(1)，listpack 把一批元素塞进连续内存降低指针开销。

**节点填满才分裂**：向 List 追加元素时，先塞进当前尾部 listpack；塞不下（超过节点大小上限）才新建一个 `quicklistNode`。避免了纯链表那样每插一个元素就 `malloc` 一次。

```bash
list-max-listpack-size -2   # 每个 listpack 节点最大 8KB（默认 -2）
list-compress-depth 0       # 中间节点 LZF 压缩深度（0=不压缩，默认）
```

**中间节点压缩**：List 最常用的是两端操作（`LPUSH`/`LPOP`/`RPUSH`/`RPOP`），中间元素很少被访问。`list-compress-depth` 指定两端各保留几个节点不压缩，其余中间节点用 LZF 压缩存储，进一步省内存；访问被压缩的节点时才解压。

![quicklist 三层结构与中间压缩](/redis/01-data-model-chapter-04-data-structures-9.svg)

## 3. 字典（dict）

字典是 Redis 最核心的结构——所有键值对都存在字典里。它是一个哈希表：用桶数组定位 key，用链表解决冲突，负载过高时通过渐进式 rehash 扩容。任何一次 `GET` / `SET` 都要先在这个字典里定位 key。

dict 同时承担三类职责：

| 职责 | 实例 | 说明 |
| :-- | :-- | :-- |
| 全局键空间 | `redisDb.dict` | 每个库的主字典，存全部 key → value |
| 过期字典 | `redisDb.expires` | 独立 dict，存 key → 过期时间戳（见[过期与淘汰](../02-standalone-core/chapter-06-expiration-eviction.md)） |
| 类型底层编码 | Set / Hash 的 hashtable 编码 | 元素多、非整数时，Set 和 Hash 内部就是一个 dict（见[对象系统与编码](./chapter-05-object-encoding.md)） |

注意区分两个名词：`dict` 是底层数据结构（`dict.c` 里的通用哈希表，用户不可见），`Hash` 是对外数据类型（`HSET` / `HGET` 命令族）。Hash 可能用 dict 作为底层编码，但并非必然——field 少、值小时用 listpack 编码（见[对象系统与编码](./chapter-05-object-encoding.md)），此时底层不是 dict；反过来，`redisDb.dict`、`redisDb.expires` 都是 dict，却都不是 Hash 类型。

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
    unsigned long used;    // 已存放的键值对数量
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

核心设计：`ht[2]` 两个哈希表，正常时只用 `ht[0]`，第二个表是留出来给 rehash 当"新房"用的，平时闲置；`rehashidx` 记录迁移进度，为 `-1` 表示不在 rehash。这两个字段如何配合，见 [3.4](#rehash-how)。

![字典结构](/redis/01-data-model-chapter-04-data-structures-5.svg)

### 3.2 一次查找的流程

以 `GET user:1001` 为例，dict 定位 key 的完整链路：

```text
1. 计算哈希值
   hash = dictType->hashFunction("user:1001")
   // Redis 默认用 SipHash，把任意长度的 key 映射成一个 64 位整数

2. 定位桶下标
   index = hash & sizemask
   // sizemask = size - 1，size 恒为 2 的幂
   // 因此 hash & sizemask 等价于 hash % size，但位运算更快

3. 取到桶内链表
   entry = ht[0].table[index]
   // 桶内是 dictEntry 单链表，链地址法解决哈希冲突

4. 遍历链表找 key
   先比指针，再逐字节比较 key 内容
   // key == he->key 时直接命中（同一个对象）
   // 指针不同才调用 dictCompareKeys 完整比较内容
```

`SET` 与 `GET` 共用这条链路，区别只在第 4 步之后：命中则更新 value，未命中则头插新节点。

两个细节值得注意：

**为什么用 `& sizemask` 而不是 `%`？** Redis 的桶数 `size` 永远是 2 的幂，`hash & (size - 1)` 与 `hash % size` 结果相同。

二者性能并不等价。整数除法（取模的底层指令）延迟约 12~80 个时钟周期，位运算 `and` 为 1 个周期（[Agner Fog《Instruction Tables》](https://www.agner.org/optimize/instruction_tables.pdf)实测值）。不过这一差距只在除数是运行时变量时成立：若除数是编译期常量，编译器会直接把 `%` 编译成等价的 `&`，二者汇编一致。Redis 的 `size` 正是运行时变量，编译器无法代劳，因此把桶数固定为 2 的幂、用 `&` 计算下标，既保证正确性，也避开了慢速除法。这是「用 2 的幂换取更快的下标计算」的取舍。

**为什么先比指针、再比内容？** `dictEntry` 里不存哈希值，遍历链表时先 `key == he->key` 判断是否同一个对象，相等直接命中；指针不同才调用 `dictCompareKeys` 逐字节比较内容。这样把昂贵的字符串比较次数降到最低。

### 3.3 为什么必须 rehash

![渐进式 rehash](/redis/01-data-model-chapter-04-data-structures-1.svg)

rehash 表面是「把数据从 ht[0] 搬到 ht[1]」，本质要回答三个「为什么」。

**为什么必须扩容？** dict 用链地址法解决冲突，**负载因子 = `used / size`（已存键值对数 / 桶总数）**。当 `used` 远大于 `size`，每个桶挂的链表变长，查找从 O(1) 退化成 O(链表长度)。扩容让桶变多、链表变短，把查找拉回 O(1)。

**为什么必须缩容？** 大量 key 被删除后，桶多、数据少，负载因子掉到 0.1 以下，空桶浪费内存。缩容回收多余桶。

**为什么必须渐进式，而非一次性搬完？** Redis 是单线程。若一次性把几百万个 key 从 ht[0] 搬到 ht[1]，主线程会阻塞数百毫秒甚至数秒，期间无法响应任何命令。渐进式把「一次性大迁移」拆成「每次增删改查顺带搬一个桶」，把长停顿摊薄成无数次可忽略的微小停顿，服务始终可用。

### 3.4 渐进式 rehash 的实现 {#rehash-how}

三个「为什么」共同决定了 rehash 的形态：`ht[2]` 双表让新旧数据在迁移期间并存，`rehashidx` 记录「搬到哪了」，迁移因此可以随时暂停、随时继续。

**触发条件**：

```text
负载因子 ≥ 1（没有 BGSAVE 时）
负载因子 > 5（有 BGSAVE 时，避免 rehash 与 fork 同时进行）
负载因子 < 0.1（缩容）
```

**迁移步骤**：

```text
1. 分配 ht[1]（大小为 ht[0] 的两倍，或第一个 ≥ used*2 的 2^n）
2. rehashidx = 0（开始迁移）
3. 每次对字典的增删改查，额外迁移 ht[0] 中 rehashidx 位置的一个桶
4. rehashidx++，直到所有桶迁移完毕
5. 释放 ht[0]，ht[1] 变为 ht[0]，新建空 ht[1]
```

**迁移期间的查询与插入**：

```text
查询 key：先查 ht[0]，没找到再查 ht[1]
插入 key：直接插入 ht[1]（新数据不进 ht[0]）
```

> 渐进式 rehash 期间，字典同时使用两个哈希表：查找时两个表都查，插入时只进新表。这保证了 rehash 过程中不丢数据、不阻塞服务。

## 4. 跳表（skiplist）

跳表是 ZSet 的底层结构之一（当元素较多时），支持 O(log n) 的范围查询。

![跳表结构](/redis/01-data-model-chapter-04-data-structures-2.svg)

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

`span` 字段不是装饰，它支撑了 `ZRANK` / `ZREVRANK` 排名命令。如果没有 `span`，要算某个成员的排名只能从头逐个遍历计数，复杂度 O(n)；有了 `span`，查找路径上累加各层跨度即可，复杂度 O(log n)。

查找 `ZRANK rank 40` 时，从最高层开始向下跳，每跨过一个节点就把该层的 `span` 累加进排名：

```text
从 header 出发：
  第 3 层：跳到 30（span 累计 1）
  第 3 层：跳到 50（超过 40，回退）
  第 2 层：从 30 跳到 40（span 累计 +1）
最终 rank = 2（40 是第 3 名，从 0 起算）
```

`span` 之所以能支撑排名，是因为它记录的是「当前层从本节点到下一个节点之间跨越了多少个节点」，而非简单的指针距离。层数越低跨越越少，累加结果就是精确排名。

### 4.2 层高随机化

每个节点的层数是随机的，概率为：

```text
P(level ≥ 1) = 1
P(level ≥ 2) = 1/4
P(level ≥ 3) = 1/16
...
P(level ≥ n) = 1/4^(n-1)
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

::: tip 延伸：跳表可视化动画
- [VisuAlgo - Skip List](https://visualgo.net/zh)（进入后选择「跳表」模块，可交互观察插入、查找、删除过程）
- [Skip List Visualizer](https://alltools.dev/tools/visualizations/skip-list-visualizer)（独立跳表演示，可调参数 p 观察层级分布）
:::

## 5. 整数集合（intset）

Set 有两种底层编码：元素多或含非整数时用 hashtable 编码，元素少且全是整数时用 intset。

intset 解决的是内存问题。hashtable 编码本质是 dict（见第 3 节），每存一个整数都要分配一个 `dictEntry`，含 key 指针、value、next 指针，单个整数就要数十字节开销。intset 用连续数组紧凑存储整数，没有指针、没有桶数组，在小整数集合场景下显著省内存。

### 5.1 结构

```c
typedef struct intset {
    uint32_t encoding;  // 元素编码：16/32/64 位
    uint32_t length;    // 元素数量
    int8_t contents[];  // 有序整数数组
} intset;
```

`contents` 声明为 `int8_t` 只是占位，实际每个元素的宽度由 `encoding` 决定：16 位时 2 字节、32 位时 4 字节、64 位时 8 字节。

三个特点都服务于「省内存」这一个目标：

| 特点 | 作用 |
| :-- | :-- |
| 连续数组 | 无指针、无链表，免去 hashtable 的指针和桶开销 |
| 自适应编码 | 全是小整数时用 16 位而非 64 位，进一步压缩 |
| 有序 | 支持二分查找 O(log n)，省内存不牺牲查找性能 |

![整数集合结构](/redis/01-data-model-chapter-04-data-structures-6.svg)

### 5.2 只升级，不降级 {#intset-upgrade}

intset 的编码升级是**单向**的：一旦因为存入大整数从 16 位升到 32 位（或 64 位），之后即使删掉那个大整数，编码也不会降回 16 位。

```bash
SADD nums 1 3 5        # 全是小整数，encoding = 16 位
SADD nums 70000        # 超出 16 位范围，整体升级为 32 位
SREM nums 70000        # 删掉大整数后，encoding 仍是 32 位，不回退
```

![intset 编码升级](/redis/01-data-model-chapter-04-data-structures-8.svg)

为什么只升不降？降级需要把整个 `contents` 数组重新拷贝一遍（从 4 字节元素缩成 2 字节），而 intset 本身只服务于「数量少」的集合——超过 `set-max-intset-entries`（默认 512）就会转成 hashtable。在元素这么少的前提下，省下的内存微乎其微，却要付出一次全量拷贝的代价，得不偿失。

> 换句话说：intset 的生命周期里，编码只会因为「装不下」而升，不会因为「空出来」而降。这是用「少量内存冗余」换「避免频繁拷贝」的取舍。

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

![ziplist 连锁更新 vs listpack](/redis/01-data-model-chapter-04-data-structures-7.svg)

## 7. 小结

| 结构 | 用途 | 核心优势 |
| :-- | :-- | :-- |
| SDS | String 底层 | O(1) 长度、二进制安全、预分配 |
| quicklist | List 底层 | 链表 + 连续内存，两端 O(1) |
| dict | 所有键值对 | 渐进式 rehash，不阻塞 |
| skiplist | ZSet 底层 | O(log n) 范围查询，实现简单 |
| intset | Set（纯小整数） | 有序数组，自动升级编码 |
| listpack | Hash/ZSet/Set（小数据） | 连续内存，无连锁更新 |

::: info 📖 延伸阅读
- [小林coding - Redis 数据结构](https://xiaolincoding.com/redis/data_struct/data_struct.html)：全结构图解，含 SDS、字典、跳表、quicklist、listpack 等新旧版本对照
- [腾讯云 - 为了拿捏 Redis 数据结构，我画了 40 张图](https://cloud.tencent.com/developer/article/1909810)：完整图解系列
:::
