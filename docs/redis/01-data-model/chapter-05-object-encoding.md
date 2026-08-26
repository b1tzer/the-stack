# 对象系统与编码

> Redis 对外暴露 5 种数据类型，对内却有多种底层编码。同一个 Hash，数据量小时用紧凑的 listpack，数据量大时切换到 hashtable——这一切对用户完全透明。理解编码切换的规则，才能解释 Redis 内存占用为什么省，也能避免设计 Key 时触发不必要的编码升级。

## 1. RedisObject：统一对象模型

Redis 用 `redisObject` 结构统一管理所有类型的 value，它把「类型」和「编码」解耦，实现了对外接口与对内实现的分离。

```c
typedef struct redisObject {
    unsigned type:4;      // 类型：String/Hash/List/Set/ZSet
    unsigned encoding:4;  // 编码：int/embstr/raw/listpack/hashtable 等
    unsigned lru:24;      // LRU 时间戳（或 LFU 计数）
    int refcount;         // 引用计数
    void *ptr;            // 指向底层数据的指针
} robj;
```

关键字段：

| 字段 | 作用 |
| :-- | :-- |
| `type` | 对外的数据类型（命令据此判断是否合法） |
| `encoding` | 对内的底层编码（决定数据如何存储） |
| `refcount` | 引用计数，用于内存回收与对象共享 |
| `ptr` | 指向实际的底层结构 |

`type` 与 `encoding` 的分离，是 Redis 能「小数据用紧凑结构、大数据换高性能结构」而对外接口不变的根本原因。

## 2. 编码切换的总原则

Redis 选择编码遵循一条核心原则：**小数据省内存，大数据重性能**。

| 数据量 | 编码方向 | 设计目标 |
| :-- | :-- | :-- |
| 小数据量 | 紧凑编码（listpack / intset） | 连续内存、缓存友好、内存极致压缩 |
| 大数据量 | 高性能编码（hashtable / skiplist） | O(1)/O(log n) 查找，用空间换时间 |

阈值（128 / 512 等）是工程经验值，可通过 `hash-max-listpack-entries` 等配置项调整。切换的触发条件随类型不同而不同，但逻辑一致：**元素数量或单元素长度超过阈值，就从紧凑编码升级到高性能编码**。

## 3. 编码全景

| 编码 | 所属类型 | 时间复杂度 | 空间特性 |
| :-- | :-- | :-- | :-- |
| `int` | String | O(1) | 最省，8 字节直接存整数 |
| `embstr` | String | O(1) | 对象头 + SDS 连续分配，缓存友好 |
| `raw` | String | O(1) | 对象头 + SDS 分离分配 |
| `intset` | Set | O(log n) | 最紧凑的有序整数数组 |
| `listpack` | Hash/ZSet（7.0 起） | O(n) | 连续内存，无级联更新 |
| `quicklist` | List | O(1) 两端 / O(n) 中间 | 链表 + listpack 节点 |
| `hashtable` | Hash/Set | O(1) | 查找最快、内存最费 |
| `skiplist` | ZSet | O(log n) | 范围查询友好 |

> 命名规律：`*list` / `*pack` 表示线性结构（省内存），`*table` / `*skip*` 表示索引结构（查得快）；小数据用前者、大数据用后者。

## 4. String 的三种编码

Redis 根据值的特性自动选择编码，遵循「能用整数不用字符串，能连续分配不分开分配」的原则：

| 编码 | 触发条件 | 设计原理 | 内存特点 |
| :-- | :-- | :-- | :-- |
| `int` | 值为整数且在 long 范围内 | 直接存二进制整数 | 最省（8 字节） |
| `embstr` | 字符串长度 ≤ 44 字节 | 对象头 + SDS 连续分配，一次内存操作 | 缓存友好（同一缓存行） |
| `raw` | 字符串长度 > 44 字节 | 对象头 + SDS 分开分配 | 内存占用稍多 |

44 字节的由来：RedisObject（16 字节）+ sdshdr8（3 字节）+ `\0`（1 字节）= 20 字节，64 字节缓存行减去 20 = 44 字节可用数据空间。长度 ≤ 44 字节时，对象头与数据可落在同一缓存行，访问更快。

## 5. 内存回收与对象共享

### 5.1 引用计数回收

`redisObject` 的 `refcount` 字段实现引用计数式内存回收：

```text
创建对象：refcount = 1
被引用：  refcount + 1
解除引用：refcount - 1
refcount 归 0：释放对象内存
```

这种方式让内存回收「即时」发生，对象不再被引用就立即释放，无需等待 GC。

### 5.2 对象共享

Redis 会预先创建 0~9999 的整数值对象，并在多个 key 引用相同整数时共享同一个对象，从而节省内存：

```text
SET a 100
SET b 100

a 和 b 的 value 指针 → 指向同一个整数对象（refcount = 2）
```

共享的前提是对象内容完全相等且不可变。Redis 只共享整数值对象，因为判断两个字符串是否相等需要遍历字符，成本高；而整数比较成本极低。

> 对象共享能显著降低「大量 key 存相同小整数」场景的内存占用，这也是计数器类场景 Redis 内存表现优秀的原因之一。

## 6. 编码切换的规则

1. **单向升级，从不降级**：一旦从紧凑编码升级到高性能编码，即使后续数据量减少也不会自动降级——避免频繁切换带来的性能抖动。要降级只能删除 Key 后重新写入。
2. **阈值可动态调整**：所有 `*-max-*` 配置项支持 `CONFIG SET` 动态调整、立即生效，但只影响新写入的数据。
3. **查看当前编码**：`OBJECT ENCODING key`，结合 `DEBUG OBJECT key` 可看更详细的内存信息（生产环境慎用 DEBUG）。
4. **内存节省幅度**：小数据量下，紧凑编码比 hashtable 节省 30%~70% 内存。

> 编码切换与过期删除、内存淘汰一起，构成了 Redis 内存管理的完整拼图，相关内容见第二卷。

## 7. 实操验证：编码切换的三条铁律

第 5.6 节讲了三条规则，这里逐条用命令验证，把「据说」变成「确实」。

### 7.1 验证一：44 字节的 embstr / raw 分界

```bash
SET s1 "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"     # 44 个 a
OBJECT ENCODING s1                # "embstr"

SET s2 "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"    # 45 个 a
OBJECT ENCODING s2                # "raw"
```

多一个字符，编码就从 `embstr` 跳到 `raw`，正好落在 44 字节的分界线上。

### 7.2 验证二：单向升级，从不降级

```bash
# 先造一个超过 128 字段的大 Hash，触发 hashtable
for i in $(seq 1 200); do redis-cli HSET big f$i $i > /dev/null; done
redis-cli OBJECT ENCODING big     # "hashtable"

# 删到只剩 2 个字段
for i in $(seq 1 198); do redis-cli HDEL big f$i > /dev/null; done
redis-cli OBJECT ENCODING big     # 仍是 "hashtable"，没有降回 listpack
```

> 这就是「不降级」：字段删到个位数，编码仍是 hashtable。想回到 listpack 只能 `DEL big` 后重新写入。

### 7.3 验证三：对象共享与引用计数

```bash
SET a 100
SET b 100
DEBUG OBJECT a                    # 看 refcount 字段
# Value at:0x... refcount:2 encoding:int ...
```

`a` 和 `b` 的值都是 100，指向同一个共享整数对象，所以 `refcount:2`。但字符串不共享：

```bash
SET x "hello"
SET y "hello"
DEBUG OBJECT x                    # refcount:1，字符串不共享
```

> `DEBUG OBJECT` 会阻塞且信息偏底层，只在本地调试环境使用，生产环境慎用。它能把 5.5 节的「对象共享」从文字变成可观测的证据。
