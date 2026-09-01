# Buffer Pool

> 一条 `SELECT` 的快慢，很大程度取决于它要的数据页在不在内存里。在内存，是纳秒级的事；不在，就要等一次磁盘随机读。InnoDB 用 Buffer Pool 把「最可能被再访问」的数据页留在内存，而「怎么判断哪些页该留、哪些页该淘汰」这件事，是它比操作系统页面缓存做得更精细的地方。

## 1. 从一次随机读的代价说起

数据库查询的性能瓶颈，绝大多数时候不是 CPU，而是磁盘 IO。一次内存访问约 100 纳秒，而一次机械硬盘的随机读约 10 毫秒，SSD 也要约 0.1 毫秒——**差了四到六个数量级**。

这意味着：一条 SQL 要读的数据页如果已经在内存里，几乎不花时间；如果每次都要从磁盘读，再快的索引也快不起来。Buffer Pool 存在的全部意义，就是把「反复要读的页」钉在内存里，让绝大多数读操作命中内存，而不是磁盘。

## 2. Buffer Pool 的读写单位：16KB 页

InnoDB 不按「行」而是按「页」读写磁盘。默认页大小 `innodb_page_size = 16KB`，聚簇索引的数据页和二级索引的索引页，都以这个单位被整体读入 Buffer Pool。

这样做的原因是磁盘的顺序读远快于随机读：一次读 16KB 和一次读 1 行，磁盘寻道时间差不多，但前者一次能装下几百行。页越大，单次 IO 的「有效载荷」越高。

```sql
SHOW VARIABLES LIKE 'innodb_page_size';  -- 默认 16384（16KB）
```

页的内部布局（File Header、Page Directory、User Records 等）在 [数据页](./chapter-01-data-page.md) 展开，这里只需记住：**Buffer Pool 是一块内存，里面装的全是 16KB 的页。**

## 3. Buffer Pool 内部的三张链表

Buffer Pool 不是一块无序的内存。InnoDB 用三张链表管理其中的页：

| 链表 | 作用 |
| :-- | :-- |
| **Free List** | 空闲页链表。刚启动时全挂这里，用完一个取一个 |
| **LRU List** | 所有已缓存页，按「最近访问时间」排序。淘汰就从这里选 |
| **Flush List** | 脏页链表。被修改过但还没写回磁盘的页，按修改时间排序 |

三张链表解决三个不同的问题：Free List 回答「去哪找空页」，LRU List 回答「内存满了淘汰谁」，Flush List 回答「哪些脏页该刷盘」。其中最难、也最值得讲透的是 LRU List 的淘汰策略。

## 4. 为什么不能直接用 LRU

朴素的 LRU 是：最近访问的页放链表头部，内存满了就淘汰尾部的页。这个策略在大多数场景够用，但有两个 InnoDB 特有的场景会把它打垮。

**场景一：预读污染。** InnoDB 发现你在顺序扫描时，会「预读」——把当前页后面的若干页也一起读进来，赌你接着会访问它们。如果赌错了，这些预读进来的页根本没人访问，却挤占了 LRU 头部，把真正的热数据顶到尾部。

**场景二：全表扫描污染。** 一条 `SELECT * FROM big_table` 会把整张表几十万页依次读进内存。这些页每页只被访问一次，如果每次都进 LRU 头部，扫完一张表，Buffer Pool 里装的就全是「以后再也不会访问」的垃圾页，之前缓存的热数据全被挤掉。

两个场景的本质相同：**「只访问一次的页」混进了「会反复访问的页」，把 LRU 的头部污染了。** InnoDB 的对策，是把 LRU 链表从一段改成两段。

## 5. 分区 LRU：young 区与 old 区

InnoDB 的 LRU 链表被切成两段：

```text
┌─────────────────────────────────────────┐
│  young 区（约 5/8）  热数据，反复被访问      │  ← 链表头部
├─────────────────────────────────────────┤
│  old 区（约 3/8）    新读入的页、冷数据      │  ← 链表尾部
└─────────────────────────────────────────┘
```

核心规则有两条：

1. **新读入的页放在 old 区头部，而不是 young 区头部。**
2. **页在 old 区停留超过 `innodb_old_blocks_time`（默认 1000ms）后，再次被访问才晋升到 young 区头部。**

为什么这两条能挡住污染？把全表扫描代入：扫描读进来的页全部落在 old 区头部，它们在被读一次之后，很可能在 1 秒内就被后续读进来的页推到 old 区尾部，最终被淘汰。**因为它们从没在 old 区停留超过 1 秒，所以永远没有资格晋升 young 区**，young 区里的热数据分毫未动。

反过来，一个真正热门的页（比如频繁按主键查询的那一页），第一次读进 old 区后，1 秒之后又被访问，就晋升到 young 区，从此被 LRU 正常保护。

```ini
innodb_old_blocks_pct  = 37     # old 区占比（37% ≈ 3/8）
innodb_old_blocks_time = 1000   # old 区停留阈值，单位毫秒
```

::: tip 两个参数怎么调
- `innodb_old_blocks_pct` 调大，old 区变大，抗全表扫描污染的能力更强，但热数据能占的空间变小。默认 37 对大多数 OLTP 是合理的。
- 如果业务有定期的批量扫描（报表、备份），可以临时把 `innodb_old_blocks_time` 调大（如 5000），让扫描进来的页更难晋升，进一步保护热数据；扫描结束再调回。
:::

## 6. 命中率：Buffer Pool 健康度的唯一指标

判断 Buffer Pool 够不够大，不看它占了多少内存，看命中率。

```sql
SHOW GLOBAL STATUS LIKE 'Innodb_buffer_pool_read%';
```

两个关键值：

- `Innodb_buffer_pool_read_requests`：逻辑读次数，即「读页」的总请求数；
- `Innodb_buffer_pool_reads`：物理读次数，即「内存没有、真正从磁盘读」的次数。

```text
命中率 = 1 - reads / read_requests
```

生产环境这个值应稳定在 99% 以上。低于 99%，说明 Buffer Pool 太小，频繁发生物理读，该加大 `innodb_buffer_pool_size`。

## 7. 参数与实例拆分

```ini
innodb_buffer_pool_size     = 4G   # 建议物理内存的 50%~70%
innodb_buffer_pool_instances = 8   # 多实例减少锁竞争
```

两个点值得展开：

**大小。** Buffer Pool 不是越大越好。超过物理内存会导致操作系统换页，反而更慢；留出内存给连接线程、排序缓冲区、操作系统本身。经验值是物理内存的 50%~70%，但前提是命中率达标——命中率已经 99.9%，再加内存也没有收益。

**实例拆分。** Buffer Pool 只有一个实例时，所有线程读写它都要抢一把全局锁，高并发下这把锁成为瓶颈。`innodb_buffer_pool_instances` 把 Buffer Pool 切成多个独立实例，各自维护自己的 LRU/Free/Flush 链表，锁竞争被分摊。经验规则：Buffer Pool 小于 8GB 时一个实例即可，大于 8GB 时按 CPU 核数拆分。

## 8. Change Buffer：写操作的第二处缓冲

Buffer Pool 解决「读」的缓存问题，Change Buffer 解决「写」的一部分。

修改一行数据时，除了改聚簇索引，还要同步维护这条记录上的**二级索引**。如果某个二级索引页恰好不在内存里，朴素的做法是把它从磁盘读进来再改。Change Buffer 提供了另一条路：**先不读，把「对那个索引页的修改」记录在 Change Buffer 里，等这个索引页之后真的被读进内存时，再把攒下的修改一次性合并（merge）上去。**

```text
朴素做法：写 → 读二级索引页 → 改 → 刷盘
Change Buffer：写 → 记录修改 → 索引页之后被读时再 merge
```

省下的是一次「为了写而读」的磁盘 IO。对写多读少、二级索引多的表，收益显著。

**为什么只对非唯一二级索引生效？**

- 聚簇索引不行：行数据本身就存在聚簇索引页上，改了行必然要动聚簇索引页，没有「延迟合并」的空间；
- 唯一索引不行：插入新值时必须立即读索引页校验「唯一性」是否被违反，没法延迟。

所以 Change Buffer 只服务「非唯一二级索引」。

```sql
SHOW VARIABLES LIKE 'innodb_change_buffer%';
-- innodb_change_buffer_max_size：Change Buffer 占 Buffer Pool 的最大比例，默认 25
-- innodb_change_buffering：缓存哪些操作，默认 all（inserts/deletes/purges/changes 都缓存）
```

::: tip 什么时候该调
写密集、二级索引多的场景（日志表、流水表），可以把 `innodb_change_buffer_max_size` 提到 40~50。但 Change Buffer 本质上是用内存换「延后合并」，如果表读也很频繁，merge 会被迫频繁发生，收益下降——所以读多写少的场景保持默认即可。
:::

## 9. 自适应哈希索引（AHI）

B+ 树的等值查询要沿着树从根走到叶子，路径上有多次比较。如果某个索引页被频繁地做等值查询，InnoDB 会「记住」这个模式，为它额外建一张内存哈希表，后续同样的等值查询直接用哈希定位，从「走树」的 O(log N) 降到「查哈希」的 O(1)。

这个「自动监控、自动建、自动用」的过程，就是 Adaptive Hash Index 的「自适应」含义。

```sql
SHOW VARIABLES LIKE 'innodb_adaptive_hash_index%';
-- innodb_adaptive_hash_index：是否启用，默认 ON
-- innodb_adaptive_hash_index_parts：哈希分区数，默认 8
```

AHI 只对**等值查询**有效，范围查询（`>`, `BETWEEN`）无法用哈希，仍走 B+ 树。它的代价是：哈希表本身要占内存，且维护哈希表需要额外加锁。在高并发写入场景下，AHI 的锁竞争可能成为新的瓶颈，此时应当关闭：

```sql
SET GLOBAL innodb_adaptive_hash_index = OFF;
```

## 10. 预热：重启后的性能爬坡

Buffer Pool 在内存里，数据库一重启就全空了。重启后的一段时间，命中率从 0 开始爬升，大量查询被迫物理读，表现为「刚重启完特别慢」。

InnoDB 的解决办法是把「哪些页是热点」记下来：

```sql
-- 关机时把热页列表 dump 到磁盘，启动时按列表加载回来
SHOW VARIABLES LIKE 'innodb_buffer_pool_dump_at_shutdown';  -- 默认 ON
SHOW VARIABLES LIKE 'innodb_buffer_pool_load_at_startup';   -- 默认 ON
SHOW VARIABLES LIKE 'innodb_buffer_pool_dump_pct';          -- 默认 25，只 dump 最热的 25% 页
```

默认只记录最热的 25% 页，是因为全量 dump 会让大内存实例的启动时间过长。可以在「启动快」和「预热全」之间权衡：内存大、业务高峰临近重启，可以临时调高 `innodb_buffer_pool_dump_pct` 到 50~75。

## 11. 最佳实践

1. **先看命中率，再定大小**：`Innodb_buffer_pool_reads / read_requests` 决定要不要加内存，而不是拍脑袋。
2. **命中率 99% 是底线**：低于它先查是不是有大查询、全表扫描在污染，而不是盲目加内存。
3. **Buffer Pool 占物理内存 50%~70%**：留出内存给连接、排序和操作系统。
4. **大于 8GB 就拆实例**：按 CPU 核数设置 `innodb_buffer_pool_instances`。
5. **写多读少、二级索引多，才调大 Change Buffer**；读多写少保持默认。
6. **高并发写入且 AHI 锁竞争明显时，关闭 AHI**。
7. **生产环境务必开启 dump/load 预热**，避免重启后长时间低命中率。
