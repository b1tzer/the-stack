# Buffer Pool

## 1. 作用

Buffer Pool 是 InnoDB 最重要的内存结构，用于缓存数据页和索引页。

## 2. LRU 算法

```
┌─────────────────────┐
│   Young 区 (5/8)     │  热数据，最近访问
├─────────────────────┤
│   Old 区 (3/8)       │  冷数据，新读入的页
└─────────────────────┘

新页 → Old 区头部 → 超过 1s 再访问 → 移到 Young 区
```

## 3. 核心参数

```ini
innodb_buffer_pool_size = 4G          # 建议物理内存的 70%
innodb_buffer_pool_instances = 8      # 多实例减少锁竞争
innodb_old_blocks_pct = 37            # Old 区比例
innodb_old_blocks_time = 1000         # 移到 Young 区的等待时间(ms)
```

## 4. 监控

```sql
SHOW ENGINE INNODB STATUS;

-- Buffer Pool 命中率
SHOW GLOBAL STATUS LIKE 'Innodb_buffer_pool_read%';
-- 命中率 = 1 - Innodb_buffer_pool_reads / Innodb_buffer_pool_read_requests
```

## 5. Change Buffer

Change Buffer 是 Buffer Pool 的一部分，用于缓存对**非唯一二级索引**页的修改操作（INSERT/UPDATE/DELETE）。

**工作原理：**
```
当修改的二级索引页不在 Buffer Pool 中时：
1. 不立即从磁盘读取索引页
2. 将修改操作记录到 Change Buffer
3. 后台线程异步合并（merge）到实际索引页
```

```sql
-- 查看 Change Buffer 状态
SHOW ENGINE INNODB STATUS;  -- 在 INSERT BUFFER AND ADAPTIVE HASH INDEX 部分

-- 相关参数
SHOW VARIABLES LIKE 'innodb_change_buffer%';
-- innodb_change_buffer_max_size: Change Buffer 占 Buffer Pool 的最大比例（默认 25%）
-- innodb_change_buffering: 缓存哪些操作（默认 all）
```

**适用场景：**
- 写多读少的场景（如日志表）
- 非唯一二级索引的批量写入

**不适用场景：**
- 唯一索引（需要立即读取校验唯一性）
- 读多写少的场景（合并收益不大）

## 6. 自适应哈希索引 (AHI)

AHI 是 InnoDB 自动监控索引搜索模式，在内存中建立哈希索引以加速等值查询。

```sql
-- 查看 AHI 状态
SHOW ENGINE INNODB STATUS;  -- 在 ADAPTIVE HASH INDEX 部分

-- 相关参数
SHOW VARIABLES LIKE 'innodb_adaptive_hash_index%';
-- innodb_adaptive_hash_index: 是否启用（默认 ON）
-- innodb_adaptive_hash_index_parts: AHI 分区数（默认 8）
```

**AHI 工作原理：**
1. InnoDB 监控索引页的访问模式
2. 如果某个索引页被频繁以等值查询访问，自动构建哈希索引
3. 后续等值查询直接通过哈希定位，O(1) 时间复杂度

**何时关闭 AHI：**
- 高并发写入场景（AHI 锁竞争可能成为瓶颈）
- 使用 `SET GLOBAL innodb_adaptive_hash_index = OFF;`

## 7. Buffer Pool 预热

数据库重启后 Buffer Pool 为空，需要预热以恢复性能。

```sql
-- MySQL 8.0 自动预热（dump/restore）
SHOW VARIABLES LIKE 'innodb_buffer_pool_dump_at_shutdown';  -- 默认 ON
SHOW VARIABLES LIKE 'innodb_buffer_pool_load_at_startup';   -- 默认 ON
SHOW VARIABLES LIKE 'innodb_buffer_pool_dump_pct';          -- 默认 25%

-- 手动触发预热
SET GLOBAL innodb_buffer_pool_dump_now = ON;  -- 导出热点页列表
SET GLOBAL innodb_buffer_pool_load_now = ON;  -- 加载热点页

-- 查看预热进度
SHOW STATUS LIKE 'Innodb_buffer_pool_load%';
```

**最佳实践：**
- 将 `innodb_buffer_pool_dump_pct` 设置为 50-75，加快预热速度
- 大内存实例（>64GB）可适当降低，减少启动时间

## 8. 最佳实践总结

| 场景 | 建议 |
|------|------|
| Buffer Pool 大小 | 物理内存的 50%-70% |
| Buffer Pool 实例数 | ≥ 8GB 时设为多个实例（CPU 核数以内） |
| Change Buffer | 写密集场景可提高到 50% |
| AHI | 默认开启，高并发写入时可关闭 |
| 预热 | 生产环境务必开启 dump/load |

