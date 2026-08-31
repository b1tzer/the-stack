# 性能调优实战

## 1. 参数优化

```ini
# Buffer Pool
innodb_buffer_pool_size = 4G          # 物理内存的 70%

# 日志
innodb_log_file_size = 1G
innodb_flush_log_at_trx_commit = 1

# 连接
max_connections = 500
thread_cache_size = 64

# 查询缓存 (8.0 移除)
# 临时表
tmp_table_size = 64M
max_heap_table_size = 64M
```

## 2. 慢查询分析

```sql
-- 开启慢查询日志
SET GLOBAL slow_query_log = 1;
SET GLOBAL long_query_time = 1;

-- 分析
SELECT * FROM sys.statements_with_runtimes_in_95th_percentile LIMIT 10;
```

## 3. 索引优化

```sql
-- 查看索引使用情况
SELECT * FROM sys.schema_unused_indexes;
SELECT * FROM sys.schema_redundant_indexes;
```

## 4. 架构优化

- 读写分离
- 缓存（Redis）
- 分库分表
- 数据归档

## 5. 内存优化

```ini
# Buffer Pool 配置
innodb_buffer_pool_size = 12G          # 物理内存的 50%-70%
innodb_buffer_pool_instances = 8       # 多实例减少锁竞争

# 排序和连接缓冲
sort_buffer_size = 4M                  # 每个连接的排序缓冲
join_buffer_size = 4M                  # 每个连接的连接缓冲
read_buffer_size = 2M                  # 顺序读缓冲
read_rnd_buffer_size = 8M              # 随机读缓冲

# 临时表
tmp_table_size = 64M                   # 内存临时表大小
max_heap_table_size = 64M              # 内存表最大大小

# 线程缓存
thread_cache_size = 64                 # 线程复用
```

## 6. IO 优化

```ini
# InnoDB IO 配置
innodb_io_capacity = 2000              # SSD 建议 2000+
innodb_io_capacity_max = 4000          # 峰值 IO 能力
innodb_read_io_threads = 8             # 读线程数
innodb_write_io_threads = 8            # 写线程数
innodb_flush_method = O_DIRECT         # 跳过 OS 缓存

# Redo Log
innodb_log_file_size = 2G              # Redo Log 大小
innodb_log_buffer_size = 64M           # Log Buffer

# 刷盘策略
innodb_flush_log_at_trx_commit = 1     # 1=安全, 2=性能
sync_binlog = 1                        # 1=安全, 100=性能
```

## 7. 应用层优化

```java
// 1. 使用批量操作
// ❌ 逐条插入
for (User user : users) {
    jdbcTemplate.update("INSERT INTO users (name) VALUES (?)", user.getName());
}

// ✅ 批量插入
jdbcTemplate.batchUpdate("INSERT INTO users (name) VALUES (?)",
    new BatchPreparedStatementSetter() {
        @Override
        public void setValues(PreparedStatement ps, int i) throws SQLException {
            ps.setString(1, users.get(i).getName());
        }
        @Override
        public int getBatchSize() { return users.size(); }
    });

// 2. 使用缓存
@Service
public class UserService {
    @Cacheable(value = "users", key = "#id")
    public User getUserById(Long id) {
        return userRepository.findById(id).orElse(null);
    }
    
    @CacheEvict(value = "users", key = "#user.id")
    public void updateUser(User user) {
        userRepository.save(user);
    }
}

// 3. 分页查询优化
// ❌ 大偏移量
// Page<User> page = repository.findAll(PageRequest.of(10000, 10));

// ✅ 游标分页
@Query("SELECT u FROM User u WHERE u.id > :lastId ORDER BY u.id")
List<User> findByIdAfter(@Param("lastId") Long lastId, Pageable pageable);
```

## 8. 性能调优流程

```
1. 识别瓶颈
   ├── 慢查询日志分析
   ├── SHOW PROCESSLIST
   ├── Performance Schema
   └── OS 监控 (top, iostat, vmstat)

2. 分析原因
   ├── 缺少索引 → EXPLAIN
   ├── 锁等待 → data_lock_waits
   ├── 硬件瓶颈 → iostat, vmstat
   └── 配置不当 → SHOW VARIABLES

3. 制定方案
   ├── SQL 优化
   ├── 索引优化
   ├── 参数调优
   └── 架构优化

4. 实施验证
   ├── 测试环境验证
   ├── 灰度发布
   ├── 监控对比
   └── 回滚方案
```

## 9. 调优工具箱

| 工具 | 用途 |
|------|------|
| EXPLAIN | 查看执行计划 |
| EXPLAIN ANALYZE | 查看实际执行时间 |
| Optimizer Trace | 分析优化器决策 |
| pt-query-digest | 慢查询分析 |
| pt-online-schema-change | 在线 DDL |
| pt-table-checksum | 数据一致性校验 |
| sysbench | 基准测试 |
| mysqlslap | 压力测试 |
| Grafana + Prometheus | 监控可视化 |
| PMM (Percona) | 数据库监控平台 |

## 10. 最佳实践总结

| 层级 | 优化手段 | 效果 |
|------|---------|------|
| SQL 层 | EXPLAIN 分析、索引优化、避免全表扫描 | 10-1000 倍 |
| 索引层 | 覆盖索引、联合索引、清理无用索引 | 10-100 倍 |
| 参数层 | Buffer Pool、刷盘策略、连接池 | 2-10 倍 |
| 架构层 | 读写分离、缓存、分库分表 | 10-100 倍 |
| 硬件层 | SSD、更大内存、更快 CPU | 2-5 倍 |

