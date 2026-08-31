# 映射

> Mapping 定义了文档的字段类型和索引方式。选错类型会导致搜索不准或性能问题。

## 1. 字段类型

| 类型 | 说明 | 示例 |
|------|------|------|
| text | 全文检索，会被分词 | 标题、描述 |
| keyword | 精确匹配，不分词 | 状态、标签、枚举 |
| long/integer/short/byte | 整数 | 数量、年龄 |
| double/float/half_float | 浮点数 | 价格、评分 |
| date | 日期 | 创建时间 |
| boolean | 布尔 | 是否启用 |
| object | 嵌套对象 | 地址信息 |
| nested | 嵌套数组（独立索引） | 评论列表 |
| geo_point | 地理坐标 | 经纬度 |
| ip | IP 地址 | 客户端 IP |

## 2. text vs keyword（最常混淆的类型）

| 维度 | text | keyword |
|------|------|---------|
| 分词 | ✅ 分词后存储 | ❌ 原始值存储 |
| match 查询 | ✅ | ❌ |
| term 查询 | ❌（匹配分词后的词项） | ✅ |
| 聚合 | ❌ | ✅ |
| 排序 | ❌ | ✅ |
| 适用场景 | 标题、描述、内容 | 状态、标签、ID |

**一个字段同时需要搜索和聚合**：使用 multi-field：

```json
{
  "title": {
    "type": "text",
    "fields": {
      "keyword": { "type": "keyword" }
    }
  }
}
// title 用于全文搜索，title.keyword 用于聚合和排序
```

## 3. 动态映射

ES 会自动推断字段类型：

| 数据 | 推断类型 |
|------|---------|
| "hello" | text + keyword |
| 123 | long |
| 12.5 | double |
| true | boolean |
| "2026-08-31" | date |

**问题**：动态映射可能不符合预期（如数字 ID 被映射为 long 而不是 keyword）。

## 4. 显式映射

```json
PUT /my-index
{
  "mappings": {
    "properties": {
      "title": { "type": "text", "analyzer": "ik_max_word" },
      "status": { "type": "keyword" },
      "price": { "type": "float" },
      "created_at": { "type": "date", "format": "yyyy-MM-dd HH:mm:ss" },
      "tags": { "type": "keyword" }
    }
  }
}
```

## 5. 映射不能修改

字段类型一旦创建就不能修改（只能添加新字段）。要修改类型，必须：

1. 创建新索引（新映射）
2. 用 Reindex API 迁移数据
3. 别名切换

```json
POST _reindex
{ "source": { "index": "old-index" }, "dest": { "index": "new-index" } }
```
