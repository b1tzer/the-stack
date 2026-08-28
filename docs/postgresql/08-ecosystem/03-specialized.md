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

## 3. pgvector — 向量搜索

```sql
CREATE EXTENSION vector;

-- 创建向量表
CREATE TABLE documents (
    id SERIAL PRIMARY KEY,
    content TEXT,
    embedding vector(1536)  -- OpenAI embedding 维度
);

-- 创建向量索引（HNSW，推荐）
CREATE INDEX ON documents USING hnsw (embedding vector_cosine_ops);

-- 相似度搜索（余弦距离）
SELECT content, 1 - (embedding <=> '[0.1, 0.2, ...]') AS similarity
FROM documents
ORDER BY embedding <=> '[0.1, 0.2, ...]'
LIMIT 10;
```

## 4. 选择建议

| 扩展 | 适用场景 | 核心能力 |
|------|---------|---------|
| PostGIS | 地理信息系统、LBS 应用 | 空间查询、距离计算、地理围栏 |
| TimescaleDB | IoT、监控、日志等时序数据 | 自动分区、压缩、数据生命周期管理 |
| pgvector | AI/ML 向量检索、RAG | 向量相似度搜索、HNSW/IVFFlat 索引 |
