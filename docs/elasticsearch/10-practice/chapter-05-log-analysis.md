# 日志分析实战

## 1. 架构设计

```
应用服务 → Filebeat → Kafka → Logstash → Elasticsearch → Kibana
```

| 组件 | 作用 |
|------|------|
| **Filebeat** | 轻量级日志采集，部署在每台应用服务器 |
| **Kafka** | 消息缓冲，削峰填谷 |
| **Logstash** | 日志解析和转换 |
| **Elasticsearch** | 存储和搜索 |
| **Kibana** | 可视化分析 |

## 2. 日志规范

```json
{
  "@timestamp": "2024-01-15T10:30:00.123Z",
  "level": "ERROR",
  "service": "order-service",
  "trace_id": "abc123",
  "span_id": "span456",
  "message": "Failed to process order",
  "exception": "java.lang.NullPointerException",
  "stack_trace": "at com.example.OrderService.process(OrderService.java:42)",
  "user_id": "U001",
  "request_uri": "/api/orders",
  "response_time": 1500
}
```

## 3. 索引设计

```json
PUT /_index_template/app-logs
{
  "index_patterns": ["app-logs-*"],
  "template": {
    "settings": {
      "number_of_shards": 3,
      "number_of_replicas": 1,
      "index.lifecycle.name": "logs-policy",
      "index.lifecycle.rollover_alias": "app-logs",
      "index.codec": "best_compression"
    },
    "mappings": {
      "properties": {
        "@timestamp": { "type": "date" },
        "level": { "type": "keyword" },
        "service": { "type": "keyword" },
        "trace_id": { "type": "keyword" },
        "message": { "type": "text", "analyzer": "ik_max_word" },
        "exception": { "type": "keyword" },
        "response_time": { "type": "integer" }
      }
    }
  }
}
```

## 4. Logstash 日志解析

```ruby
input {
  kafka {
    bootstrap_servers => "kafka:9092"
    topics => ["app-logs"]
    codec => json
  }
}

filter {
  # 解析 Java 异常堆栈
  if [exception] {
    mutate {
      add_tag => ["exception"]
    }
  }

  # 响应时间分级
  if [response_time] {
    if [response_time] > 5000 {
      mutate { add_tag => ["slow"] }
    }
  }

  # 日期解析
  date {
    match => ["@timestamp", "ISO8601"]
    target => "@timestamp"
  }
}

output {
  elasticsearch {
    hosts => ["es01:9200", "es02:9200"]
    index => "app-logs-%{+YYYY.MM.dd}"
    user => "elastic"
    password => "${ES_PASSWORD}"
  }
}
```

## 5. 常用查询

```json
// 查询错误日志
GET /app-logs-*/_search
{
  "query": {
    "bool": {
      "filter": [
        { "term": { "level": "ERROR" } },
        { "range": { "@timestamp": { "gte": "now-1h" } } }
      ]
    }
  },
  "sort": [{ "@timestamp": "desc" }],
  "size": 50
}

// 按服务统计错误数量
GET /app-logs-*/_search
{
  "size": 0,
  "query": {
    "bool": {
      "filter": [
        { "term": { "level": "ERROR" } },
        { "range": { "@timestamp": { "gte": "now-24h" } } }
      ]
    }
  },
  "aggs": {
    "by_service": {
      "terms": { "field": "service" }
    }
  }
}

// 慢请求分析
GET /app-logs-*/_search
{
  "size": 0,
  "query": {
    "bool": {
      "filter": [
        { "range": { "response_time": { "gte": 5000 } } },
        { "range": { "@timestamp": { "gte": "now-1h" } } }
      ]
    }
  },
  "aggs": {
    "by_uri": {
      "terms": { "field": "request_uri.keyword" },
      "aggs": {
        "avg_response_time": { "avg": { "field": "response_time" } }
      }
    }
  }
}
```

## 6. Kibana 仪表板

| 可视化 | 用途 |
|--------|------|
| 错误率趋势 | 折线图，按时间统计错误数量 |
| 服务错误分布 | 饼图，各服务错误占比 |
| 响应时间分布 | 直方图，响应时间分布 |
| Top 慢请求 | 表格，最慢的 API 列表 |
| 日志量趋势 | 折线图，日志量变化趋势 |

## 7. 最佳实践

- 统一日志格式（JSON），便于解析
- 使用 trace_id 实现全链路追踪
- 日志级别严格区分（ERROR/WARN/INFO/DEBUG）
- 使用 ILM 策略自动管理索引生命周期
- 监控日志量异常（突然增加可能表示故障）
- 设置告警规则（错误率突增、响应时间超阈值）
