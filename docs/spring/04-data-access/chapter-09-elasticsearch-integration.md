# Elasticsearch 集成（Spring Data Elasticsearch）

> 本章是「Spring 中使用 Elasticsearch」的唯一权威章节。Elasticsearch 原生机制（倒排索引、Mapping、查询 DSL、聚合）见 [Elasticsearch 专项](../../elasticsearch/01-basics/chapter-01-overview)。

## 1. 依赖与配置 {#es-dependency}

```xml
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-data-elasticsearch</artifactId>
</dependency>
```

```yaml
spring:
  elasticsearch:
    uris: http://localhost:9200
```

## 2. 实体与 Repository {#es-entity}

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

```java
public interface ProductRepository extends ElasticsearchRepository<Product, String> {
    List<Product> findByName(String name);
    List<Product> findByPriceBetween(Double min, Double max);
}
```

## 3. 搜索 {#es-search}

```java
@Autowired
private ElasticsearchOperations elasticsearchOperations;

public List<Product> search(String keyword) {
    NativeQuery query = new NativeQueryBuilder()
        .withQuery(QueryBuilders.multiMatchQuery(keyword, "name", "description"))
        .build();
    SearchHits<Product> hits = elasticsearchOperations.search(query, Product.class);
    return hits.stream().map(SearchHit::getContent).toList();
}
```

## 4. 高级查询与聚合 {#es-advanced}

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

    SearchHits<Product> hits = elasticsearchOperations.search(builder.build(), Product.class);
    return SearchHitSupport.searchPageFor(hits, pageable)
            .map(SearchHit::getContent);
}
```

聚合查询：

```java
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

    SearchHits<Product> hits = elasticsearchOperations.search(query, Product.class);
    // 解析聚合结果...
    return Map.of();
}
```

## 5. 常见坑 {#es-pitfalls}

- 实体类字段必须用 `@Field` 注解指定类型与分词器，否则 Mapping 默认行为可能不符合预期。
- Repository 方法名查询适合简单场景，复杂查询用 `NativeQuery`。
- 批量写入用 `bulkIndex`，逐条 `save` 会带来不必要的网络往返。
- 生产环境需配置连接超时与连接池参数。
