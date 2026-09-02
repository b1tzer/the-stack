---
doc_id: pg-specialized
title: 专业扩展概览
---

# 专业扩展概览

> **核心问题**：PostGIS、TimescaleDB、pgvector 分别解决什么问题？

## 1. PostGIS — 地理信息

```sql
CREATE EXTENSION postgis;

-- 创建空间表
CREATE TABLE places (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100),
    geom GEOMETRY(Point, 4326)
);

-- 插入
INSERT INTO places (name, geom) 
VALUES ('北京', ST_SetSRID(ST_MakePoint(116.4074, 39.9042), 4326));

-- 空间索引
CREATE INDEX idx_places_geom ON places USING GIST (geom);

-- 距离查询（5公里范围内）
SELECT name,
    ST_Distance(geom::geography,
        ST_SetSRID(ST_MakePoint(116.4, 39.9), 4326)::geography) AS distance_meters
FROM places
WHERE ST_DWithin(geom::geography,
    ST_SetSRID(ST_MakePoint(116.4, 39.9), 4326)::geography, 5000)
ORDER BY distance_meters;

-- 最近邻查询（KNN）
SELECT name,
    ST_Distance(geom::geography,
        ST_SetSRID(ST_MakePoint(116.4, 39.9), 4326)::geography) AS dist
FROM places
ORDER BY geom <-> ST_SetSRID(ST_MakePoint(116.4, 39.9), 4326)
LIMIT 5;
```

## 2. TimescaleDB — 时序数据

```sql
CREATE EXTENSION timescaledb;

-- 创建时序表
CREATE TABLE metrics (
    time TIMESTAMPTZ NOT NULL,
    device_id INT,
    temperature DOUBLE PRECISION,
    humidity DOUBLE PRECISION
);

-- 转换为 hypertable
SELECT create_hypertable('metrics', 'time');

-- 自动压缩旧数据（30天后）
ALTER TABLE metrics SET (
    timescaledb.compress,
    timescaledb.compress_segmentby = 'device_id'
);
SELECT add_compression_policy('metrics', INTERVAL '30 days');

-- 自动删除旧数据（保留 1 年）
SELECT add_retention_policy('metrics', INTERVAL '1 year');
```

## 3. pgvector — 向量搜索与 AI 应用

> **2024-2026 最热方向**：很多团队从独立向量数据库（Milvus、Pinecone）回流到 PG + pgvector，因为“数据同步延迟、跨库关联查询、运维成本翻倍”的问题太痛了。

### 3.1 安装与基本用法

```sql
CREATE EXTENSION vector;

-- 创建向量表
CREATE TABLE documents (
    id SERIAL PRIMARY KEY,
    content TEXT,
    metadata JSONB DEFAULT '{}',
    embedding vector(1536)  -- OpenAI text-embedding-ada-002 维度
);

-- 插入向量数据
INSERT INTO documents (content, embedding) VALUES
    ('PostgreSQL 是最先进的开源数据库', '[0.1, -0.2, 0.3, ...]'),
    ('MySQL 是最流行的开源数据库', '[0.15, -0.18, 0.25, ...]');
```

### 3.2 距离度量选择

| 度量 | 操作符 | 索引操作类 | 适用场景 |
|------|--------|-----------|----------|
| 余弦距离 | `<=>` | `vector_cosine_ops` | 文本相似度（推荐） |
| L2 距离 | `<->` | `vector_l2_ops` | 图像特征匹配 |
| 内积 | `<#>` | `vector_ip_ops` | 推荐系统 |

### 3.3 向量索引

```sql
-- HNSW 索引（推荐：查询快，精度高，构建慢）
CREATE INDEX ON documents USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 200);

-- IVFFlat 索引（适合大数据量，构建快，精度略低）
CREATE INDEX ON documents USING ivfflat (embedding vector_cosine_ops)
    WITH (lists = 100);
```

| 索引类型 | 构建速度 | 查询速度 | 精度 | 内存占用 | 适用规模 |
|---------|---------|---------|------|---------|----------|
| HNSW | 慢 | 极快 | 高 | 高 | < 1000 万行 |
| IVFFlat | 快 | 快 | 中 | 中 | > 1000 万行 |

### 3.4 相似度搜索

```sql
-- 余弦相似度搜索
SELECT
    content,
    1 - (embedding <=> '[0.1, -0.2, 0.3, ...]') AS similarity
FROM documents
ORDER BY embedding <=> '[0.1, -0.2, 0.3, ...]'
LIMIT 10;

-- 带过滤条件的向量搜索
SELECT content, 1 - (embedding <=> query_vec) AS similarity
FROM documents
WHERE metadata @> '{"category": "database"}'
ORDER BY embedding <=> query_vec
LIMIT 5;

-- 设置 HNSW 搜索精度（ef_search 越大精度越高，速度越慢）
SET hnsw.ef_search = 100;
```

### 3.5 RAG 架构实战

```sql
-- 完整的 RAG 知识库表设计
CREATE TABLE knowledge_base (
    id SERIAL PRIMARY KEY,
    source VARCHAR(100),       -- 来源：文档、网页、FAQ
    title TEXT,
    content TEXT,
    chunk_index INT,           -- 分块序号
    embedding vector(1536),
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP DEFAULT NOW()
);

-- 混合搜索：向量 + 全文检索
SELECT
    content,
    1 - (embedding <=> $1) AS vector_score,
    ts_rank(to_tsvector('chinese', content), to_tsquery('chinese', $2)) AS text_score,
    (1 - (embedding <=> $1)) * 0.7 + ts_rank(...) * 0.3 AS combined_score
FROM knowledge_base
WHERE to_tsvector('chinese', content) @@ to_tsquery('chinese', $2)
ORDER BY combined_score DESC
LIMIT 5;
```

### 3.6 pgvector vs 独立向量数据库

| 对比项 | pgvector (PG) | Milvus | Pinecone |
|--------|--------------|--------|----------|
| 部署复杂度 | 极低（一个扩展） | 高（独立集群） | 低（SaaS） |
| 与关系数据关联 | 天然支持 | 需要同步 | 需要同步 |
| 数据一致性 | ACID 保证 | 最终一致 | 最终一致 |
| 向量搜索性能 | 优秀 | 优秀 | 优秀 |
| 运维成本 | 低（复用 PG） | 高 | 低（付费） |
| 适用规模 | < 1 亿向量 | > 1 亿向量 | 任意 |

> **结论**：如果你已经在用 PG，且向量规模 < 1 亿，pgvector 是最优选择——零额外运维成本，数据天然一致。

## 4. 选择建议

| 扩展 | 适用场景 | 核心能力 |
|------|---------|---------|
| PostGIS | 地理信息系统、LBS 应用 | 空间查询、距离计算、地理围栏 |
| TimescaleDB | IoT、监控、日志等时序数据 | 自动分区、压缩、数据生命周期管理 |
| pgvector | AI/ML 向量检索、RAG | 向量相似度搜索、HNSW/IVFFlat 索引 |
