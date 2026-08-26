# 表空间

## 1. 类型

| 表空间 | 文件 | 说明 |
|--------|------|------|
| 系统表空间 | ibdata1 | 数据字典、Undo Log、Change Buffer |
| 独立表空间 | .ibd | 每个表一个文件 |
| 通用表空间 | 自定义 | 用户创建的共享表空间 |
| 临时表空间 | ibtmp1 | 临时表 |
| Undo 表空间 | undo_001/002 | Undo Log 存储 |

## 2. 配置

```ini
# 独立表空间（默认开启）
innodb_file_per_table = 1

# 系统表空间大小
innodb_data_file_path = ibdata1:1G:autoextend
```

## 3. 段、区、页

```
表空间
├── 段 (Segment)
│   ├── 数据段（叶子节点）
│   └── 索引段（非叶子节点）
│       └── 区 (Extent) = 1MB = 64个页
│           └── 页 (Page) = 16KB
```

## 4. 表空间文件结构

**系统表空间 (ibdata1)：**
```
ibdata1
├── 数据字典 (Data Dictionary)
├── Change Buffer
├── Doublewrite Buffer
├── Undo Log (MySQL 5.6 之前)
└── 用户数据 (innodb_file_per_table=OFF 时)
```

**独立表空间 (.ibd)：**
```
users.ibd
├── FSP Header (表空间头部)
├── XDES Entry (区描述符)
├── INDEX Page (B+ 树索引页)
│   ├── Root Page
│   ├── Non-leaf Pages
│   └── Leaf Pages (实际数据)
└── Free Extents (空闲区)
```

## 5. 表空间管理操作

```sql
-- 查看表空间大小
SELECT
    table_name,
    ROUND(data_length / 1024 / 1024, 2) AS data_mb,
    ROUND(index_length / 1024 / 1024, 2) AS index_mb,
    ROUND(data_free / 1024 / 1024, 2) AS free_mb
FROM information_schema.tables
WHERE table_schema = 'mydb'
ORDER BY data_length + index_length DESC;

-- 查看表空间文件
SELECT space, name, size * 16 / 1024 AS size_mb
FROM information_schema.innodb_tablespaces
WHERE name LIKE 'mydb/%';

-- MySQL 8.0 表空间加密
ALTER TABLE users ENCRYPTION='Y';

-- 查看加密状态
SELECT space, name, flag,
    CASE WHEN flag & 8192 THEN 'Encrypted' ELSE 'Not Encrypted' END AS encryption
FROM information_schema.innodb_tablespaces;
```

## 6. 碎片与空间回收

**碎片产生原因：**
- 大量 DELETE 操作后，页面有空闲空间但无法被其他表使用
- 页分裂导致空间利用率下降
- UPDATE 操作导致行迁移

```sql
-- 查看碎片大小
SELECT
    table_name,
    ROUND(data_free / 1024 / 1024, 2) AS fragment_mb
FROM information_schema.tables
WHERE table_schema = 'mydb' AND data_free > 0
ORDER BY data_free DESC;

-- 回收碎片（会锁表，大表慎用）
OPTIMIZE TABLE users;
-- 或者在线方式（MySQL 5.6+）
ALTER TABLE users ENGINE=InnoDB;  -- 实际上是重建表
```

## 7. 独立表空间 vs 系统表空间

| 特性 | 独立表空间 | 系统表空间 |
|------|-----------|----------|
| 文件数量 | 每表一个 .ibd | 共享 ibdata1 |
| 空间回收 | DROP TABLE 可回收 | 不可回收，只增不减 |
| 备份灵活性 | 可单表备份 | 必须整库备份 |
| 管理复杂度 | 文件多，管理复杂 | 文件少，管理简单 |
| 推荐 | ✅ 生产环境推荐 | 仅特殊场景 |

## 8. 最佳实践

1. **始终开启 `innodb_file_per_table = 1`** — 独立表空间便于管理和回收
2. **定期检查碎片率** — 超过 30% 考虑 OPTIMIZE
3. **监控 ibdata1 大小** — 不要让它无限增长
4. **生产环境使用表空间加密** — 满足数据安全合规要求
5. **避免使用共享表空间存储用户数据**

