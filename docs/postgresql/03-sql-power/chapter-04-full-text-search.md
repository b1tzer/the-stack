---
doc_id: pg-full-text-search
title: 全文搜索
---

# 全文搜索

> **核心问题**：如何在 PostgreSQL 中实现全文搜索？如何支持中文分词？

## 1. 基本用法

```sql
-- 创建 tsvector
SELECT to_tsvector('english', 'The quick brown fox jumps over the lazy dog');

-- 查询
SELECT * FROM articles 
WHERE to_tsvector('english', content) @@ to_tsquery('english', 'quick & fox');
```

## 2. 中文分词

```sql
-- 安装 zhparser
CREATE EXTENSION zhparser;
CREATE TEXT SEARCH CONFIGURATION chinese (PARSER = zhparser);
ALTER TEXT SEARCH CONFIGURATION chinese ADD MAPPING FOR n,v,a,i,e,l WITH simple;

-- 使用
SELECT * FROM articles 
WHERE to_tsvector('chinese', content) @@ to_tsquery('chinese', '数据库');
```

## 3. GIN 索引

```sql
CREATE INDEX idx_articles_fts ON articles USING GIN (to_tsvector('english', content));
```

## 4. 模糊搜索（pg_trgm）

```sql
-- 安装 pg_trgm 扩展
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- 创建 GIN 索引
CREATE INDEX idx_articles_title_trgm ON articles USING GIN (title gin_trgm_ops);

-- 模糊查询（支持前后模糊，走索引）
SELECT * FROM articles WHERE title LIKE '%数据库%';
SELECT * FROM articles WHERE title % '数据库';  -- 相似度搜索

-- 相似度排序
SELECT title, similarity(title, '数据库入门') AS score
FROM articles
WHERE title % '数据库入门'
ORDER BY score DESC;
```

## 5. 多字段全文搜索

```sql
-- 合并多个字段的 tsvector
ALTER TABLE articles ADD COLUMN search_vector tsvector;

-- 生成搜索向量（标题权重 A，内容权重 B）
UPDATE articles SET search_vector =
    setweight(to_tsvector('chinese', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('chinese', coalesce(content, '')), 'B');

-- 创建 GIN 索引
CREATE INDEX idx_articles_search ON articles USING GIN (search_vector);

-- 查询（标题匹配优先级更高）
SELECT title, ts_rank(search_vector, query) AS rank
FROM articles, to_tsquery('chinese', '数据库 & 优化') AS query
WHERE search_vector @@ query
ORDER BY rank DESC;

-- 使用触发器自动更新搜索向量
CREATE OR REPLACE FUNCTION articles_search_trigger()
RETURNS trigger AS $$
BEGIN
    NEW.search_vector :=
        setweight(to_tsvector('chinese', coalesce(NEW.title, '')), 'A') ||
        setweight(to_tsvector('chinese', coalesce(NEW.content, '')), 'B');
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_articles_search
    BEFORE INSERT OR UPDATE ON articles
    FOR EACH ROW
    EXECUTE FUNCTION articles_search_trigger();
```

## 6. 高亮显示

```sql
-- ts_headline：高亮显示匹配的文本片段
SELECT
    title,
    ts_headline('chinese', content,
        to_tsquery('chinese', '数据库 & 优化'),
        'StartSel=<b>, StopSel=</b>, MaxFragments=3, MaxWords=30'
    ) AS highlighted
FROM articles
WHERE to_tsvector('chinese', content) @@ to_tsquery('chinese', '数据库 & 优化');
```

## 7. 短语搜索

```sql
-- 短语搜索（邻近匹配）
SELECT * FROM articles
WHERE to_tsvector('chinese', content) @@
    phraseto_tsquery('chinese', '数据库优化');

-- websearch_to_tsquery（PG 11+，支持 Google 风格搜索语法）
SELECT * FROM articles
WHERE to_tsvector('english', content) @@
    websearch_to_tsquery('english', '"quick fox" OR "lazy dog"');
```

## 8. 全文搜索 vs JSONB 查询

| 场景 | 全文搜索 | JSONB 查询 |
| :-- | :-- | :-- |
| 长文本搜索 | ✅ `tsvector` + `tsquery` | ❌ 不适合 |
| 结构化属性查询 | ❌ 不适合 | ✅ `@>` 操作符 |
| 模糊匹配 | ✅ `pg_trgm` | ❌ |
| 中文分词 | ✅ `zhparser` | ❌ |
| 排序相关性 | ✅ `ts_rank` | ❌ |

> **最佳实践**：长文本（文章、日志）用全文搜索；结构化属性（商品属性、用户配置）用 JSONB。两者可以在同一张表中共存。
