# MySQL 转 PostgreSQL

> 从 MySQL 迁移到 PostgreSQL 需要注意的关键差异。

## 语法差异速查

| MySQL | PostgreSQL | 说明 |
|-------|-----------|------|
| `AUTO_INCREMENT` | `SERIAL` 或 `GENERATED ALWAYS AS IDENTITY` | 自增主键 |
| `IFNULL(a, b)` | `COALESCE(a, b)` | NULL 替换 |
| `LIMIT 10` | `LIMIT 10` | 相同 |
| `LIMIT 10, 20` | `LIMIT 20 OFFSET 10` | 分页语法不同 |
| `GROUP_CONCAT(col)` | `STRING_AGG(col, ',')` | 分组拼接 |
| `NOW()` | `NOW()` 或 `CURRENT_TIMESTAMP` | 相同 |
| `ENGINE=InnoDB` | 不需要 | PG 只有默认存储引擎 |
| `UNSIGNED` | 无原生支持 | 用 `CHECK (col >= 0)` 约束 |
| `` `backtick` `` | `"double quote"` | 标识符引用 |
| `VARCHAR(255)` | `VARCHAR(255)` 或 `TEXT` | PG 中 TEXT 更常用 |
| `DATETIME` | `TIMESTAMP` | 日期时间类型 |
| `TINYINT(1)` | `BOOLEAN` | 布尔类型 |

## 迁移步骤

1. 导出 MySQL 结构和数据
2. 修改 DDL 语法（自增、引擎、类型）
3. 导入 PostgreSQL
4. 修改应用代码（SQL 方言差异）
5. 验证数据一致性
6. 切换数据源

## 工具推荐

- `pgloader`：自动化迁移工具，直接从 MySQL 拉取
- `mysqldump` + 手动转换：小表适用
