# 底层数据结构

> Redis 对外暴露多种数据类型，对内则由一套底层数据结构支撑：SDS、链表、字典、跳表、整数集合、压缩列表。这些结构的选择只有一个目标——在内存占用与操作性能之间取得平衡。理解它们，才能解释 Redis 内存为什么省、操作为什么快。

## 1. SDS：动态字符串

Redis 没有直接使用 C 语言的字符串（以 `\0` 结尾的字符数组），而是自建了 SDS（Simple Dynamic String）。

### 1.1 结构

```c
struct sdshdr {
    int len;      // 已用长度，O(1) 获取字符串长度
    int alloc;    // 分配的总空间，用于判断是否需要扩容
    char flags;   // SDS 类型标识（sdshdr5/8/16/32/64）
    char buf[];   // 字节数组，保存实际数据
};
```

### 1.2 相对 C 字符串的优势

| 能力 | C 字符串 | SDS |
| :-- | :-- | :-- |
| 获取长度 | O(n)，需遍历到 `\0` | O(1)，直接读 len |
| 二进制安全 | 遇到 `\0` 截断 | 以 len 记录长度，可存任意字节 |
| 缓冲区溢出 | 需手动检查长度 | 扩容前自动检查 alloc，不足则自动扩展 |
| 内存分配 | 每次修改都要重新分配 | 预留空间，减少分配次数 |

> 内存分配涉及系统调用，成本高。SDS 通过 `alloc` 预留额外空间，避免频繁分配。这也是「用 len 记录长度、靠 alloc 判断容量」的设计价值。

## 2. 链表与 quicklist

### 2.1 双向链表

Redis 的 List 底层是双向链表，每个节点保存一个元素，头尾各有一个哨兵，支持 O(1) 的头部/尾部插入与删除。

```text
head ⇄ node1 ⇄ node2 ⇄ node3 ⇄ tail
```

纯链表的问题是：每个节点单独分配内存，指针开销大、内存碎片多。于是 Redis 引入 quicklist。

### 2.2 quicklist：链表 + 压缩列表

quicklist 是一个双向链表，每个节点不再存单个元素，而是一个连续内存的 listpack（旧版为 ziplist）：

```text
quicklist（链表）
  └── 节点1（listpack，存多个元素）
  └── 节点2（listpack，存多个元素）
  └── 节点3（listpack，存多个元素）
```

- **宏观链表**：双向链表结构，支持 O(1) 头尾插入删除
- **微观压缩**：每个节点是连续内存的 listpack，保持紧凑优势
- **大小可配**：`list-max-listpack-size` 控制单个节点最大容量

quicklist 同时解决了纯链表的内存碎片问题与纯压缩列表的级联更新问题。

## 3. 字典：渐进式 rehash

字典是 Hash 类型数据量增大后的底层结构，也是 Set 的通用结构。它基于哈希表实现，核心设计是**渐进式 rehash**。

### 3.1 哈希表与键冲突

字典底层是哈希表，通过哈希函数把 key 映射到数组下标。不同 key 可能映射到同一位置（哈希冲突），Redis 用链地址法解决——同一位置的多个键用链表串起来。

```text
ht[0] 数组
  [0] → node(key1) → node(key2)   ← 冲突，链地址法
  [1] → null
  [2] → node(key3)
```

### 3.2 渐进式 rehash

当哈希表的装载因子过高或过低时，需要扩容或缩容。一次性 rehash 会阻塞服务，Redis 采用**渐进式 rehash**：维护两个哈希表 `ht[0]` 和 `ht[1]`，把迁移分摊到多次操作中。

![渐进式 rehash 过程](/redis/01-data-model-chapter-04-data-structures-1.svg)

执行步骤：

1. 触发 rehash 时，分配 `ht[1]`（容量为 `ht[0]` 的 2 倍）
2. 每次对字典做增删改查时，顺便把 `ht[0]` 的一小部分键迁移到 `ht[1]`
3. 迁移期间，查找先查 `ht[0]` 再查 `ht[1]`，新键直接写入 `ht[1]`
4. 全部迁移完成后，释放 `ht[0]`，`ht[1]` 成为新的 `ht[0]`

> 渐进式 rehash 的核心价值：把「一次性 O(n) 的阻塞操作」摊薄到「每次 O(1) 的增量操作」，避免大字典扩容时服务卡顿。

## 4. 跳表

跳表是 ZSet 数据量增大后的核心结构，也是面试高频考点。

### 4.1 多层索引

跳表在有序链表之上建立多层索引，查找时从高层开始，逐层向下定位目标。

![跳表多层索引结构](/redis/01-data-model-chapter-04-data-structures-2.svg)

查找从最高层开始，在当前层向右移动直到找到第一个大于等于目标值的节点，然后向下一层继续，重复直到找到目标或到达最底层。平均时间复杂度 O(log n)。

### 4.2 随机层数

跳表用概率平衡替代了红黑树的复杂旋转。Redis 采用 25% 的增长概率：

```java
// Redis 跳表层数随机算法（简化版）
int randomLevel() {
    int level = 1;
    while (Math.random() < 0.25 && level < MAX_LEVEL) {
        level++;
    }
    return level;
}
```

- 第 1 层 100% 节点都有，第 2 层约 25%，第 k 层约 1/4^(k-1)
- Redis 7.0 将增长概率从 50% 调整为 25%，节点更稀疏、内存更省，最大层数 32 层

### 4.3 跳表与红黑树

| 对比项 | 跳表 | 红黑树 |
| :-- | :-- | :-- |
| 查找复杂度 | O(log n) | O(log n) |
| 范围查询 | 定位后顺序遍历 | 需中序遍历 |
| 实现复杂度 | 简单（随机层数） | 复杂（旋转/变色） |
| 并发友好度 | 局部修改，锁粒度细 | 全局平衡，锁粒度粗 |

Redis 选跳表而非红黑树，核心原因是 ZSet 的高频操作是范围查询（`ZRANGEBYSCORE`），跳表定位后直接顺序遍历链表，而红黑树需要中序遍历。

## 5. 整数集合 intset

当 Set 中所有元素都是整数且数量不超过 512 时，使用 intset——一个有序整数数组，支持二分查找 O(log n)，内存极为紧凑。

```text
intset：[-5, 1, 3, 8, 20]（有序，二分查找）
```

一旦出现非整数元素，或元素数量超过 `set-max-intset-entries`（默认 512），就升级为 hashtable。intset 的优势在于：整数直接按二进制存储，无指针、无哈希表开销，内存占用远小于 hashtable。

## 6. 压缩列表与 listpack

紧凑编码的演进是 Redis 内部结构变化的主线之一。

### 6.1 ziplist 的级联更新

ziplist（压缩列表）是连续内存块存储多个元素的紧凑结构，内存极致压缩，但存在一个缺陷——**级联更新**：每个元素记录前驱长度，插入或删除某个元素可能触发后续所有元素的前驱长度字段连锁更新，最坏情况 O(n²)。

### 6.2 listpack 的改进

Redis 7.0 引入 listpack 全面替代 ziplist。核心改进是改用固定长度编码，单元素操作不影响邻居，彻底消除级联更新，同时保持内存紧凑优势。

| 特性 | ziplist（6.x） | listpack（7.0+） |
| :-- | :-- | :-- |
| 级联更新 | 有风险（最坏 O(n²)） | 彻底解决 |
| 内存效率 | 极致压缩 | 同等压缩率 |
| 插入/删除 | 可能 O(n²) | 稳定 O(n) |

> 版本细节：Redis 7.0 起 `OBJECT ENCODING` 返回 `listpack` 而非 `ziplist`，但配置项名（如 `hash-max-listpack-entries`）沿用旧风格，向后兼容。

## 7. 实操观察：一个命令看透底层编码

本章讲的结构不是「背下来的」，而是可以用 `OBJECT ENCODING` 直接验证的。开一个 `redis-cli`，创建不同类型的数据，看 Redis 实际用了哪种编码：

```bash
# String：短字符串走 embstr，整数走 int
SET s "hello"
OBJECT ENCODING s                # "embstr"
SET n 100
OBJECT ENCODING n                # "int"

# List：底层是 quicklist
RPUSH list 1 2 3
OBJECT ENCODING list             # "quicklist"

# Set：纯小整数走 intset
SADD set 1 2 3
OBJECT ENCODING set              # "intset"

# Hash：小数据量走 listpack
HSET h a 1
OBJECT ENCODING h                # "listpack"

# ZSet：小数据量同样走 listpack
ZADD z 1 "a"
OBJECT ENCODING z                # "listpack"
```

验证「紧凑编码 → 高性能编码」的切换（以 Hash 为例，默认阈值 128 个字段）：

```bash
# 一次性写入 200 个字段，触发从 listpack 升级为 hashtable
for i in $(seq 1 200); do redis-cli HSET big f$i $i > /dev/null; done
redis-cli OBJECT ENCODING big    # "hashtable"
```

> 这个小小的 `OBJECT ENCODING` 命令，是把第 4、5 章的抽象概念「落到眼前」的钥匙：你以为在存 Hash，Redis 心里想的是 listpack 还是 hashtable，一查便知。
