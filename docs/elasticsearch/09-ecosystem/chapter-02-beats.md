# Beats 数据采集

## 1. Beats 概述

Beats 是 Elastic Stack 的轻量级数据采集器，用于将数据发送到 Elasticsearch 或 Logstash。

| Beat | 用途 | 数据源 |
| :-- | :-- | :-- |
| **Filebeat** | 日志文件采集 | 日志文件 |
| **Metricbeat** | 系统和服务指标 | CPU、内存、服务 |
| **Heartbeat** | 健康检查 | URL、TCP 端口 |
| **Auditbeat** | 审计数据 | 系统审计日志 |
| **Packetbeat** | 网络流量 | 网络数据包 |
| **Winlogbeat** | Windows 事件 | Windows 事件日志 |

## 2. Filebeat

### 2.1 安装与配置

```yaml
# filebeat.yml
filebeat.inputs:
  - type: log
    enabled: true
    paths:
      - /var/log/nginx/access.log
    fields:
      app: nginx
      log_type: access
    multiline:
      pattern: '^\d{4}-\d{2}-\d{2}'
      negate: true
      match: after

  - type: log
    enabled: true
    paths:
      - /var/log/app/*.log
    json.keys_under_root: true
    json.add_error_key: true

output.elasticsearch:
  hosts: ["http://localhost:9200"]
  index: "filebeat-%{[agent.version]}-%{+yyyy.MM.dd}"
  username: "elastic"
  password: "${ES_PASSWORD}"

setup.kibana:
  host: "http://localhost:5601"
```

### 2.2 Module 配置

```bash
# 启用 nginx 模块
filebeat modules enable nginx

# 启用 system 模块
filebeat modules enable system
```

```yaml
# modules.d/nginx.yml
- module: nginx
  access:
    enabled: true
    var.paths: ["/var/log/nginx/access.log"]
  error:
    enabled: true
    var.paths: ["/var/log/nginx/error.log"]
```

## 3. Metricbeat

```yaml
# metricbeat.yml
metricbeat.modules:
  - module: system
    metricsets: ["cpu", "memory", "network", "filesystem"]
    period: 10s

  - module: nginx
    metricsets: ["stubstatus"]
    hosts: ["http://localhost:80"]

  - module: mysql
    metricsets: ["status"]
    hosts: ["tcp(localhost:3306)/"]
    username: root
    password: "${MYSQL_PASSWORD}"

output.elasticsearch:
  hosts: ["http://localhost:9200"]
  index: "metricbeat-%{+yyyy.MM.dd}"
```

## 4. Heartbeat

```yaml
# heartbeat.yml
heartbeat.monitors:
  - type: http
    urls: ["http://localhost:8080/health"]
    schedule: "@every 30s"
    timeout: 10s

  - type: tcp
    hosts: ["localhost:9200"]
    schedule: "@every 30s"

output.elasticsearch:
  hosts: ["http://localhost:9200"]
```

## 5. Beats → Logstash → ES

```yaml
# filebeat.yml
output.logstash:
  hosts: ["localhost:5044"]
  loadbalance: true
```

```ruby
# logstash.conf
input {
  beats { port => 5044 }
}
filter {
  if [fields][app] == "nginx" {
    grok {
      match => { "message" => "%{COMBINEDAPACHELOG}" }
    }
  }
}
output {
  elasticsearch {
    hosts => ["localhost:9200"]
    index => "%{[fields][app]}-%{+YYYY.MM.dd}"
  }
}
```

## 6. 最佳实践

- 日志采集使用 Filebeat，资源消耗比 Logstash 小
- 使用 Module 简化常见日志的采集配置
- 大规模场景使用 Kafka 作为中间缓冲
- 配置 `multiline` 处理多行日志（如 Java 异常堆栈）
- 使用 `fields` 添加元数据字段
- 监控 Beats 自身的运行状态
