# 字符集与排序规则

## 1. 字符集与排序规则基础

### 1.1 字符集基础

```sql
-- 查看支持的字符集
SHOW CHARACTER SET;

-- 常用字符集
-- utf8mb3: UTF-8 编码，最多 3 字节（不支持 emoji）
-- utf8mb4: UTF-8 编码，最多 4 字节（推荐）
-- latin1: 西欧字符
```

### 1.2 utf8 vs utf8mb4

```sql
-- MySQL 中的 utf8 实际是 utf8mb3（3 字节）
-- emoji 和部分生僻字需要 4 字节
-- 结论：永远使用 utf8mb4

CREATE TABLE example (
    name VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
) DEFAULT CHARSET=utf8mb4;
```

### 1.3 排序规则 (Collation)

```sql
-- 查看字符集的排序规则
SHOW COLLATION LIKE 'utf8mb4%';

-- 常见排序规则
-- utf8mb4_general_ci: 通用，不区分大小写，性能好
-- utf8mb4_unicode_ci: Unicode 标准，更准确
-- utf8mb4_0900_ai_ci: MySQL 8.0 默认，基于 Unicode 9.0
-- utf8mb4_bin: 二进制比较，区分大小写
```

### 1.4 排序规则对索引的影响

```sql
-- 不同排序规则会导致索引失效
SELECT * FROM users WHERE name = 'test';
-- 如果列是 utf8mb4_general_ci，查询是 utf8mb4_bin，索引失效

-- 联合查询时注意排序规则一致性
SELECT a.name FROM table_a a
JOIN table_b b ON a.name = b.name;
-- 两表的 name 列排序规则必须一致，否则无法使用索引
```

## 2. 字符集配置与转换

### 2.1 服务端与客户端字符集

```sql
-- 查看当前字符集设置
SHOW VARIABLES LIKE 'character_set%';
SHOW VARIABLES LIKE 'collation%';

-- 关键参数
-- character_set_server: 服务端默认字符集
-- character_set_client: 客户端字符集
-- character_set_connection: 连接字符集
-- character_set_results: 结果集字符集

-- 设置连接字符集
SET NAMES utf8mb4;
```

### 2.2 字符集转换问题

```sql
-- 乱码通常原因：
-- 1. 客户端与服务端字符集不一致
-- 2. 存储时截断（utf8mb3 存 emoji）
-- 3. 连接字符集未设置

-- 最佳实践
[character-set-server=utf8mb4
collation-server=utf8mb4_0900_ai_ci]
```

### 2.3 修改已有表的字符集

```sql
-- 修改表字符集
ALTER TABLE users CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- 修改列字符集
ALTER TABLE users MODIFY name VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- 注意：大表修改需要 pt-osc 或 gh-ost
```

## 3. 最佳实践

| 场景 | 推荐 |
|------|------|
| 新项目 | utf8mb4_0900_ai_ci (MySQL 8.0+) |
| 兼容旧系统 | utf8mb4_unicode_ci |
| 需要区分大小写 | utf8mb4_bin |
| 邮箱/用户名比较 | utf8mb4_general_ci |
