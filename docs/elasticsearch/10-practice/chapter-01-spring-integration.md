# Spring Data Elasticsearch

## 1. 依赖

```xml
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-data-elasticsearch</artifactId>
</dependency>
```

## 2. 配置

```yaml
spring:
  elasticsearch:
    uris: http://localhost:9200
```

## 3. 实体

```java
@Document(indexName = "products")
public class Product {
    @Id
    private String id;
    
    @Field(type = FieldType.Text, analyzer = "ik_max_word")
    private String name;
    
    @Field(type = FieldType.Keyword)
    private String category;
    
    @Field(type = FieldType.Double)
    private Double price;
}
```

## 4. Repository

```java
public interface ProductRepository extends ElasticsearchRepository<Product, String> {
    List<Product> findByName(String name);
    List<Product> findByPriceBetween(Double min, Double max);
}
```

## 5. 搜索

```java
@Autowired
private ElasticsearchRestTemplate elasticsearchTemplate;

public List<Product> search(String keyword) {
    NativeQuery query = new NativeQueryBuilder()
        .withQuery(QueryBuilders.multiMatchQuery(keyword, "name", "description"))
        .build();
    return elasticsearchTemplate.search(query, Product.class);
}
```

## 6. 高级查询示例

```java
// 布尔组合查询
public Page<Product> searchProducts(String keyword, String category,
                                     Double minPrice, Double maxPrice,
                                     Pageable pageable) {
    NativeQueryBuilder builder = new NativeQueryBuilder();

    BoolQuery.Builder boolQuery = new BoolQuery.Builder();

    if (StringUtils.hasText(keyword)) {
        boolQuery.must(m -> m.multiMatch(q -> q
            .fields("name^2", "description")
            .query(keyword)
        ));
    }

    if (StringUtils.hasText(category)) {
        boolQuery.filter(f -> f.term(t -> t
            .field("category.keyword")
            .value(category)
        ));
    }

    if (minPrice != null || maxPrice != null) {
        boolQuery.filter(f -> f.range(r -> {
            r.field("price");
            if (minPrice != null) r.gte(JsonData.of(minPrice));
            if (maxPrice != null) r.lte(JsonData.of(maxPrice));
            return r;
        }));
    }

    builder.withQuery(boolQuery.build()._toQuery());
    builder.withPageable(pageable);

    return elasticsearchTemplate.search(builder.build(), Product.class);
}
```

## 7. 聚合查询示例

```java
// 按分类统计商品数量和平均价格
public Map<String, Object> getCategoryStats() {
    NativeQuery query = new NativeQueryBuilder()
        .withAggregation("categories", Aggregation.of(a -> a
            .terms(t -> t.field("category.keyword").size(20))
            .aggregations("avg_price", Aggregation.of(aa -> aa
                .avg(avg -> avg.field("price"))
            ))
        ))
        .withMaxResults(0)
        .build();

    SearchHits<Product> hits = elasticsearchTemplate.search(query, Product.class);
    // 解析聚合结果...
}
```

## 8. 最佳实践

- 使用 `@Document(indexName = "xxx")` 注解定义索引映射
- 实体类字段使用 `@Field` 注解指定类型和分词器
- Repository 方法名查询适合简单场景，复杂查询使用 `NativeQuery`
- 批量操作使用 `bulkIndex()` 方法
- 生产环境配置连接池和超时参数
- 使用 `@Setting` 注解配置索引设置（分片数、副本数等）

