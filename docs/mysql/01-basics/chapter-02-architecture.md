# 整体架构

## 1. 架构总览

### 1.1 三层架构

```
┌─────────────────┐
│   连接层         │  认证、线程池、连接管理
├─────────────────┤
│   服务层         │  SQL 解析、优化、执行
│   ├─ 解析器      │  语法分析、语义分析
│   ├─ 优化器      │  执行计划选择
│   └─ 执行器      │  调用存储引擎接口
├─────────────────┤
│   存储引擎层     │  InnoDB/MyISAM/Memory
└─────────────────┘
```

### 1.2 SQL 执行流程

```
Client → 连接器 → 查询缓存(8.0移除) → 解析器 → 优化器 → 执行器 → 存储引擎
```

### 1.3 InnoDB 架构

```
┌─────────────────────────────────────┐
│           InnoDB 存储引擎            │
├─────────────────────────────────────┤
│  内存结构                            │
│  ├─ Buffer Pool                     │
│  ├─ Change Buffer                   │
│  ├─ Adaptive Hash Index             │
│  └─ Log Buffer                      │
├─────────────────────────────────────┤
│  磁盘结构                            │
│  ├─ 系统表空间                       │
│  ├─ 独立表空间 (.ibd)                │
│  ├─ Redo Log                        │
│  └─ Undo Log                        │
└─────────────────────────────────────┘
```

## 2. 各层详解

### 2.1 连接层详解

```
客户端 → TCP/IP 连接 → 连接器（认证）→ 线程池 → 会话管理
```

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

```
读路径：
  磁盘 → Buffer Pool（内存）→ 返回客户端

写路径：
  客户端 → Buffer Pool → Redo Log（顺序写）→ Checkpoint → 刷盘（随机写）
```

**关键设计思想：**
- 将随机写转为顺序写（Redo Log）
- 利用内存缓存减少磁盘 IO
- Checkpoint 机制异步刷新脏页
