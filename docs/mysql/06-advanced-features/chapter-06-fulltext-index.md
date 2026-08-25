# 全文索引 (Full-Text Index)

## 1. 概述

全文索引用于在大量文本中快速搜索关键词，比 LIKE '%keyword%' 快几个数量级。

```sql
-- ❌ LIKE 无法使用索引
SELECT * FROM articles WHERE content LIKE '%MySQL%';

-- ✅ 全文索引
SELECT * FROM articles WHERE MATCH(content) AGAINST('MySQL');
```

## 2. 创建全文索引

```sql
-- 建表时创建
CREATE TABLE articles (
    id INT PRIMARY KEY AUTO_INCREMENT,
    title VARCHAR(200),
    content TEXT,
    FULLTEXT INDEX ft_title (title),
    FULLTEXT INDEX ft_content (content),
    FULLTEXT INDEX ft_title_content (title, content)  -- 联合全文索引
) ENGINE=InnoDB;

-- 对已有表添加
ALTER TABLE articles ADD FULLTEXT INDEX ft_title (title);
ALTER TABLE articles ADD FULLTEXT INDEX ft_content (content);
```

## 3. 搜索语法

### 3.1 自然语言模式

```sql
-- 默认模式，按相关性排序
SELECT *, MATCH(title, content) AGAINST('MySQL 优化') AS score
FROM articles
WHERE MATCH(title, content) AGAINST('MySQL 优化')
ORDER BY score DESC;

-- 停用词（如 the, is, at）会被忽略
-- 短词（默认 < 3 字符）会被忽略
```

### 3.2 布尔模式

```sql
-- 更灵活的搜索
SELECT * FROM articles
WHERE MATCH(title, content) AGAINST('+MySQL -PostgreSQL' IN BOOLEAN MODE);

-- 操作符说明
-- +  必须包含
-- -  必须不包含
-- *  通配符（后缀）
-- "" 精确短语
-- >  提高相关性
-- <  降低相关性
-- ~  取反（默认行为）

-- 示例
'+MySQL +优化'           -- 必须同时包含 MySQL 和优化
'+MySQL -PostgreSQL'     -- 包含 MySQL 但不包含 PostgreSQL
'"MySQL 8.0"'            -- 精确匹配 "MySQL 8.0"
'+MySQL*'                -- 匹配 MySQL 开头的词
```

### 3.3 查询扩展模式

```sql
-- 先搜索关键词，再用结果中的词扩展搜索
SELECT * FROM articles
WHERE MATCH(title, content) AGAINST('MySQL' WITH QUERY EXPANSION);
-- 适合搜索结果太少的情况
```

## 4. 中文全文索引

### 4.1 问题

InnoDB 默认的全文索引使用 ngram 解析器处理 CJK（中日韩）字符。

```sql
-- MySQL 8.0 默认支持中文（ngram 解析器）
-- 查看配置
SHOW VARIABLES LIKE 'ngram_token_size';  -- 默认 2
```

### 4.2 配置中文分词

```sql
-- 修改 my.cnf
[mysqld]
ngram_token_size = 2  -- 2 字符为一个词

-- 重启后创建索引
ALTER TABLE articles ADD FULLTEXT INDEX ft_content (content) WITH PARSER ngram;
```

### 4.3 中文搜索示例

```sql
-- 创建表
CREATE TABLE articles (
    id INT PRIMARY KEY AUTO_INCREMENT,
    title VARCHAR(200),
    content TEXT,
    FULLTEXT INDEX ft_title_content (title, content) WITH PARSER ngram
) ENGINE=InnoDB;

-- 搜索
SELECT * FROM articles
WHERE MATCH(title, content) AGAINST('数据库优化');

-- 布尔模式
SELECT * FROM articles
WHERE MATCH(title, content) AGAINST('+数据库 +优化' IN BOOLEAN MODE);
```

## 5. 性能优化

### 5.1 索引维护

```sql
-- 查看索引大小
SELECT 
    table_name,
    index_name,
    stat_value * @@innodb_page_size / 1024 / 1024 AS size_mb
FROM mysql.innodb_index_stats
WHERE stat_name = 'size' AND index_name LIKE 'ft_%';

-- 优化索引（重建）
ALTER TABLE articles DROP INDEX ft_content;
ALTER TABLE articles ADD FULLTEXT INDEX ft_content (content) WITH PARSER ngram;
```

### 5.2 查询优化

```sql
-- ✅ 只返回需要的列
SELECT id, title, MATCH(title, content) AGAINST('MySQL') AS score
FROM articles
WHERE MATCH(title, content) AGAINST('MySQL');

-- ✅ 限制结果数量
SELECT * FROM articles
WHERE MATCH(title, content) AGAINST('MySQL')
LIMIT 10;

-- ✅ 结合其他条件
SELECT * FROM articles
WHERE MATCH(title, content) AGAINST('MySQL')
  AND created_at >= '2024-01-01'
  AND status = 1;
```

## 6. 全文索引 vs 其他方案

| 方案 | 优势 | 劣势 | 适用场景 |
|------|------|------|---------|
| 全文索引 | 无需额外服务，SQL 集成 | 中文分词较弱 | 简单文本搜索 |
| Elasticsearch | 强大的分词和搜索 | 需要同步数据 | 复杂搜索需求 |
| Redis | 极快 | 功能简单 | 标签搜索 |
| Solr | 功能丰富 | 重量级 | 企业级搜索 |

## 7. 注意事项

```sql
-- 1. 全文索引只支持 InnoDB 和 MyISAM
-- 2. 不支持索引前缀
-- 3. 停用词列表可自定义
-- 4. 最小词长由 ft_min_word_len 控制

-- 查看停用词
SELECT * FROM information_schema.innodb_ft_default_stopword;

-- 自定义停用词表
[mysqld]
innodb_ft_server_stopword_table = 'db/stopword_table'
```

## 8. 实战示例：文章搜索系统

```sql
-- 表结构
CREATE TABLE articles (
    id INT PRIMARY KEY AUTO_INCREMENT,
    title VARCHAR(200) NOT NULL,
    content TEXT NOT NULL,
    category_id INT,
    status TINYINT DEFAULT 1,
    view_count INT DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FULLTEXT INDEX ft_search (title, content) WITH PARSER ngram,
    INDEX idx_category_status (category_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 搜索 SQL
SELECT 
    id,
    title,
    LEFT(content, 200) AS summary,
    MATCH(title, content) AGAINST('MySQL 优化' IN BOOLEAN MODE) AS relevance
FROM articles
WHERE MATCH(title, content) AGAINST('+MySQL +优化' IN BOOLEAN MODE)
  AND status = 1
ORDER BY relevance DESC
LIMIT 20;
```
