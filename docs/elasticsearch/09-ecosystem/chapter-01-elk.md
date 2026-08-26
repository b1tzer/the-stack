# ELK Stack

## 1. 架构

```
App/Filebeat → Logstash → Elasticsearch → Kibana
    ↑            ↑            ↑            ↑
  采集         处理         存储/搜索    可视化
```

## 2. Logstash 配置

```ruby
input {
  beats {
    port => 5044
  }
}

filter {
  grok {
    match => { "message" => "%{COMBINEDAPACHELOG}" }
  }
  date {
    match => [ "timestamp", "dd/MMM/yyyy:HH:mm:ss Z" ]
  }
}

output {
  elasticsearch {
    hosts => ["localhost:9200"]
    index => "logs-%{+YYYY.MM.dd}"
  }
}
```

## 3. Filebeat 配置

```yaml
filebeat.inputs:
  - type: log
    paths:
      - /var/log/*.log

output.elasticsearch:
  hosts: ["localhost:9200"]
  index: "filebeat-%{+yyyy.MM.dd}"
```

## 4. Kibana

- 访问 `http://localhost:5601`
- 创建 Index Pattern
- 可视化分析

## 5. Logstash 高级配置

```ruby
input {
  beats { port => 5044 }
  kafka {
    bootstrap_servers => "kafka:9092"
    topics => ["app-logs"]
    codec => json
  }
}

filter {
  # 解析 JSON 日志
  if [message] =~ /^\{/ {
    json { source => "message" }
  }

  # 解析 Java 异常堆栈
  multiline {
    pattern => "^%{TIMESTAMP_ISO8601}"
    negate => true
    what => "previous"
  }

  # GeoIP 解析
  if [client_ip] {
    geoip { source => "client_ip" }
  }

  # 日期解析
  date {
    match => ["timestamp", "ISO8601", "yyyy-MM-dd HH:mm:ss"]
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

## 6. ELK 架构选型

| 架构 | 适用场景 | 说明 |
|------|---------|------|
| Filebeat → ES | 简单日志采集 | 轻量，无需 Logstash |
| Filebeat → Logstash → ES | 需要复杂处理 | Logstash 做过滤和转换 |
| Filebeat → Kafka → Logstash → ES | 大规模日志 | Kafka 削峰填谷 |
| Filebeat → Kafka → ES | 大规模，简单处理 | 跳过 Logstash |

## 7. 最佳实践

- 日志采集使用 Filebeat，比 Logstash 资源消耗小
- 大规模场景引入 Kafka 作为缓冲层
- 索引按日期滚动：`logs-YYYY.MM.dd`，配合 ILM 自动清理
- Logstash 多实例部署，通过 Kafka 实现负载均衡
- 生产环境 ES 集群至少 3 节点，配置专用 Master 节点

