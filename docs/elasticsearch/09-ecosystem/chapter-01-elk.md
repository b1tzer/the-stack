# ELK Stack

## 1. 架构

```txt
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
    index => "logs-%{+yyyy.MM.dd}"
  }
}
```

## 3. Filebeat 配置

```yaml
filebeat.inputs:
  - type: filestream
    id: app-logs
    paths:
      - /var/log/*.log
    parsers:
      - multiline:
          type: pattern
          pattern: '^\d{4}-\d{2}-\d{2}'
          negate: true
          match: after

output.elasticsearch:
  hosts: ["localhost:9200"]
  index: "filebeat-%{+yyyy.MM.dd}"
```

Filebeat 推荐使用 `filestream` 输入（`log` 输入自 7.16 起弃用、9.0 起默认禁用），多行日志通过 `parsers` 里的 `multiline` 完成合并。自定义 `index` 会覆盖默认索引名，此时需协调 ILM、索引模板与写别名，避免索引名与生命周期策略冲突。详见 [索引生命周期管理](../02-indexing/chapter-05-index-management.md)。

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

  # Java 异常堆栈等多行日志应在 Filebeat 端用 multiline 合并后再送入；
  # Logstash 的 multiline 是 codec 而非 filter，不能在这里按行合并。

  # GeoIP 解析
  if [client_ip] {
    geoip { source => "client_ip" }
  }

  # 日期解析：默认写入 @timestamp，字段缺失或格式不匹配时产生 _dateparsefailure 标签
  date {
    match => ["timestamp", "ISO8601", "yyyy-MM-dd HH:mm:ss"]
  }
}

output {
  elasticsearch {
    hosts => ["es01:9200", "es02:9200"]
    index => "app-logs-%{+yyyy.MM.dd}"
    user => "elastic"
    password => "${ES_PASSWORD}"
  }
}
```

## 6. ELK 架构选型

| 架构 | 适用场景 | 说明 |
| :-- | :-- | :-- |
| Filebeat → ES | 简单日志采集 | 轻量，无需 Logstash |
| Filebeat → Logstash → ES | 需要复杂处理 | Logstash 做过滤和转换 |
| Filebeat → Kafka → Logstash → ES | 大规模日志 | Kafka 削峰填谷 |
| Filebeat → Kafka → Kafka Connect → ES | 大规模，无需复杂处理 | 跳过 Logstash，由 Kafka Connect 写入 ES |

## 7. 最佳实践

- 日志采集使用 Filebeat，比 Logstash 资源消耗小
- 大规模场景引入 Kafka 作为缓冲层，它提供缓冲与解耦，不自动保证端到端不丢数据
- 索引按日期滚动：`logs-yyyy.MM.dd`，配合 ILM 自动清理
- Logstash 多实例部署，经 Kafka 分区与消费组横向扩展，并行度受分区数约束
- 高可用部署通常 3 个 master-eligible 节点起步，是否配置专用 Master 节点取决于集群规模与负载
