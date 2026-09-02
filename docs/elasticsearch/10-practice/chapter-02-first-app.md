# 第一个 Elasticsearch 应用

> 创建索引、导入数据、搜索查询的完整流程。

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

## 2. 导入数据

```bash
POST _bulk
{ "index": { "_index": "products", "_id": "1" } }
{ "name": "iPhone 15", "category": "手机", "price": 7999, "description": "苹果最新旗舰手机", "created_at": "2026-01-01" }
{ "index": { "_index": "products", "_id": "2" } }
{ "name": "MacBook Pro", "category": "电脑", "price": 14999, "description": "专业级笔记本电脑", "created_at": "2026-01-15" }
```

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
