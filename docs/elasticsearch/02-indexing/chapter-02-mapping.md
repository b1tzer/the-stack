---
doc_id: es-Mapping映射设计
title: ES Mapping 设计：字段类型决定查询能力
---

# ES Mapping 设计：字段类型决定查询能力

## 1. 核心字段类型对比

| 类型 | 用途 | 是否分词 | 适用场景 | 为什么这样设计 |
| :-- | :-- | :-- | :-- | :-- |
| `text` | 全文检索 | ✅ 是 | 文章内容、商品描述 | 分词后建立倒排索引，支持任意词项查找 |
| `keyword` | 精确匹配 | ❌ 否 | 状态码、标签、ID | 不分词，整体作为词项，支持精确匹配和聚合 |
| `integer/long` | 数值 | ❌ 否 | 价格、数量、年龄 | 数值类型支持范围查询和排序 |
| `date` | 日期 | ❌ 否 | 创建时间、更新时间 | 日期类型支持时间范围查询 |
| `nested` | 嵌套对象 | - | 订单中的商品列表 | 普通对象数组会被扁平化，nested 保留对象边界 |

## 2. 工作中常见错误（深度分析）

```json
// ❌ 错误：对 text 类型做精确匹配（无法精确匹配）
{
  "query": {
    "term": { "title": "Java工程师" }
  }
}
// 原因：title 是 text 类型，"Java工程师"已被分词为["Java","工程师"]
// term 查询需要完整词项，"Java工程师"在词典中不存在，所以查不到

// ✅ 正确：text 用 match，keyword 用 term
// Mapping 中同时定义两种类型（multi-field）
{
  "mappings": {
    "properties": {
      "title": {
        "type": "text",
        "analyzer": "ik_max_word",
        "fields": {
          "keyword": { "type": "keyword" }  // title.keyword 用于精确匹配
        }
      }
    }
  }
}
```

## 3. 动态 Mapping 的坑

> **动态 Mapping 的坑**：ES 会自动推断字段类型，但可能推断错误（如把数字字符串推断为 long），且 **Mapping 一旦创建不可修改**，只能重建索引（reindex）。**生产环境务必手动定义 Mapping**。

> **为什么 Mapping 不可修改**：字段类型决定了数据的存储方式和索引结构，修改类型需要重新索引所有数据，ES 不支持在线修改，只能重建。

## 4. 常见错误汇总

| 错误场景 | 原因 | 解决方案 |
| :-- | :-- | :-- |
| 对 text 字段用 term 精确匹配，查不到数据 | text 字段已被分词，term 需要完整词项 | 使用 `field.keyword` 做精确匹配 |
| 动态 Mapping 字段类型被错误推断 | ES 自动推断，如 "123" 被推断为 long | 生产环境手动定义 Mapping |