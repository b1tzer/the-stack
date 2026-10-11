# 整体架构

## 1. 架构总览

### 1.1 三层架构

![MySQL 三层架构：连接层负责认证与连接管理，服务层包含解析器、优化器、执行器，存储引擎层提供 InnoDB 等引擎](/mysql/01-basics-chapter-02-layers.svg)

从上到下依次是三层：连接层负责认证、线程池和连接管理；服务层负责 SQL 解析、优化和执行，内部包含解析器、优化器、执行器；存储引擎层提供 InnoDB、MyISAM、Memory 等可替换的插件式实现。

### 1.2 SQL 执行流程

![一条 SQL 的执行流水线：Client 经连接器、解析器、优化器、执行器到达存储引擎](/mysql/01-basics-chapter-02-sql-pipeline.svg)

执行顺序为：Client → 连接器 → 解析器 → 优化器 → 执行器 → 存储引擎。各阶段的中间产物依次是 SQL 文本、语法树、执行计划，最终由存储引擎返回行数据。

### 1.3 InnoDB 架构

![InnoDB 架构：内存结构与磁盘结构，页经预读加载进内存，脏页异步刷盘](/mysql/01-basics-chapter-02-innodb.svg)

内存结构包括 Buffer Pool、Change Buffer、Adaptive Hash Index 和 Log Buffer；磁盘结构包括系统表空间、独立表空间（.ibd）、Redo Log 和 Undo Log。磁盘上的页通过预读加载进内存，内存中的脏页再异步刷回磁盘。

## 2. 各层详解

### 2.1 连接层详解

![连接建立过程：客户端经 TCP 三次握手、身份验证、读取 mysql.user 权限、分配线程后进入会话就绪](/mysql/01-basics-chapter-02-connection.svg)

连接过程：
1. **TCP 三次握手**建立网络连接
2. **身份验证**：校验用户名、密码、Host
3. **权限获取**：读取 mysql.user 表的权限信息
4. **分配线程**：每个连接对应一个线程（或线程池复用）

```sql
-- 查看当前连接
SHOW PROCESSLIST;

-- 查看连接相关状态
SHOW GLOBAL STATUS LIKE 'Threads%';
-- Threads_connected: 当前连接数
-- Threads_running: 当前活跃线程数
-- Threads_created: 已创建线程数（过大说明 thread_cache_size 不够）
-- Threads_cached: 缓存中的线程数

-- 查看最大连接数
SHOW VARIABLES LIKE 'max_connections';
```

### 2.2 服务层详解

**解析器（Parser）：**
- 词法分析：将 SQL 拆分为 Token
- 语法分析：生成语法树（Parse Tree）
- 语义分析：检查表、列是否存在，权限是否足够

**优化器（Optimizer）：**
- 基于成本模型选择最优执行计划
- 决定表的连接顺序
- 选择使用哪个索引
- 决定是否使用索引下推（ICP）

**执行器（Executor）：**
- 调用存储引擎接口获取数据
- 执行过滤、排序、聚合等操作
- 返回结果集

### 2.3 存储引擎层

```sql
-- 查看当前默认引擎
SHOW VARIABLES LIKE 'default_storage_engine';

-- 查看表使用的引擎
SELECT table_name, engine FROM information_schema.tables
WHERE table_schema = 'mydb';

-- 修改表引擎
ALTER TABLE myisam_table ENGINE = InnoDB;
```

**InnoDB 核心特性总结：**
| 特性 | 说明 |
| :-- | :-- |
| 事务支持 | 完整的 ACID 支持 |
| 行级锁 | 高并发下的细粒度锁 |
| MVCC | 多版本并发控制，读不阻塞写 |
| 外键 | 支持外键约束（但生产环境建议不用） |
| 崩溃恢复 | Redo Log 保证数据不丢失 |
| 聚簇索引 | 数据按主键物理排序存储 |

## 3. 内存与磁盘交互

![读路径与写路径：读从磁盘加载页到 Buffer Pool 再返回客户端；写先在 Buffer Pool 修改，顺序写 Redo Log，经 Checkpoint 异步刷盘](/mysql/01-basics-chapter-02-rw-paths.svg)

- 读路径：磁盘 → Buffer Pool（内存）→ 返回客户端。
- 写路径：客户端 → Buffer Pool → Redo Log（顺序写）→ Checkpoint → 刷盘（随机写）。

**关键设计思想：**
- 将随机写转为顺序写（Redo Log）
- 利用内存缓存减少磁盘 IO
- Checkpoint 机制异步刷新脏页
