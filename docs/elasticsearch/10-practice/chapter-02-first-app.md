# 第一个 Elasticsearch 应用

> 创建索引、导入数据、搜索查询的完整流程。

## 运行前提

- Elasticsearch 8.x，已安装 [IK 分词插件](../02-indexing/chapter-04-chinese-analysis.md)，插件版本需与 ES 版本一致
- Spring Boot 通过 BOM 管理 Spring Data Elasticsearch 版本，客户端与服务端的兼容性需按所选版本组合确认

## 1. 创建索引

```bash
PUT /products
{
  "settings": {
    "number_of_shards": 1,
    "number_of_replicas": 0,
    "analysis": {
      "analyzer": {
        "ik_max": { "type": "custom", "tokenizer": "ik_max_word" }
      }
    }
  },
  "mappings": {
    "properties": {
      "name": { "type": "text", "analyzer": "ik_max" },
      "category": { "type": "keyword" },
      "price": { "type": "float" },
      "description": { "type": "text", "analyzer": "ik_max" },
      "created_at": { "type": "date" }
    }
  }
}
```

未单独指定 `search_analyzer`，查询侧默认复用 `ik_max` 的细粒度分词。

## 2. 导入数据

```bash
POST _bulk
{ "index": { "_index": "products", "_id": "1" } }
{ "name": "iPhone 15", "category": "手机", "price": 7999, "description": "苹果最新旗舰手机", "created_at": "2026-01-01" }
{ "index": { "_index": "products", "_id": "2" } }
{ "name": "MacBook Pro", "category": "电脑", "price": 14999, "description": "专业级笔记本电脑", "created_at": "2026-01-15" }
```

HTTP 状态码成功不代表每条文档都写入成功，需检查响应顶层的 `errors` 字段，为 `true` 时遍历 `items` 定位失败项。

## 3. 搜索

```bash
# 全文搜索
GET /products/_search
{ "query": { "match": { "description": "手机" } } }

# 过滤
GET /products/_search
{
  "query": {
    "bool": {
      "must": [{ "match": { "name": "iPhone" } }],
      "filter": [{ "range": { "price": { "gte": 5000, "lte": 10000 } } }]
    }
  }
}

# 聚合
GET /products/_search
{
  "aggs": {
    "by_category": {
      "terms": { "field": "category" },
      "aggs": { "avg_price": { "avg": { "field": "price" } } }
    }
  }
}
```

## 4. Spring Boot 集成

```xml
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-data-elasticsearch</artifactId>
</dependency>
```

```java
@Document(indexName = "products")
public class Product {
    @Id private String id;
    @Field(type = FieldType.Text, analyzer = "ik_max") private String name;
    @Field(type = FieldType.Keyword) private String category;
    @Field(type = FieldType.Float) private Float price;
}

public interface ProductRepository extends ElasticsearchRepository<Product, String> {
    List<Product> findByCategory(String category);
    List<Product> findByNameContaining(String name);
}
```

`@Field(analyzer = "ik_max")` 依赖 §1 预先创建的索引：实体注解只声明字段使用该分析器，分析器定义来自索引 settings，应用启动前需先执行创建索引请求，或通过 `@Setting` 声明同等的分析器配置。
