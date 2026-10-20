# Beats 数据采集

## 1. Beats 概述

Beats 是 Elastic Stack 的轻量级数据采集器，用于将数据发送到 Elasticsearch 或 Logstash。本文示例以 Filebeat 8.x 为准，旧的 `log` input 自 7.16 起弃用、9.0 默认禁用，应改用 `filestream` input。

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
  - type: filestream
    id: nginx-access
    enabled: true
    paths:
      - /var/log/nginx/access.log
    fields:
      app: nginx
      log_type: access

  - type: filestream
    id: app-json
    enabled: true
    paths:
      - /var/log/app/*.json
    parsers:
      - ndjson:
          add_error_key: true

  - type: filestream
    id: app-error
    enabled: true
    paths:
      - /var/log/app/error.log
    parsers:
      - multiline:
          type: pattern
          pattern: '^\d{4}-\d{2}-\d{2}'
          negate: true
          match: after

output.elasticsearch:
  hosts: ["http://localhost:9200"]
  # 8.x 默认启用 ILM 与数据流，此时自定义 index 被忽略，写入目标由数据流名称决定，
  # 索引模板负责映射与设置，ILM 负责生命周期；下方 index 仅在 setup.ilm.enabled: false 时生效。
  index: "filebeat-%{[agent.version]}-%{+yyyy.MM.dd}"
  # elastic 为超级用户，仅本地演示；生产环境应使用专用账号并启用 HTTPS
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
  # 同 Filebeat，默认 ILM 启用时 index 被忽略，写入目标由数据流名称决定
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
      tag_on_failure => ["_nginx_grok_failure"]
    }
    date {
      match => [ "timestamp", "dd/MMM/yyyy:HH:mm:ss Z" ]
    }
  }
}
output {
  elasticsearch {
    hosts => ["localhost:9200"]
    index => "%{[fields][app]}-%{+yyyy.MM.dd}"
  }
}
```

`%{COMBINEDAPACHELOG}` 面向 Apache combined 格式，Nginx 使用兼容的 `log_format` 时才能复用，否则需按实际格式调整。grok 匹配失败时事件仍会进入输出，只是被打上 `_nginx_grok_failure` 标签，需在 Kibana 中监控该标签以发现解析失败。date filter 把日志发生时间写入 `@timestamp`，否则按日期滚动的索引会落在采集时间而非日志时间。索引日期格式用小写 `yyyy`（日历年），大写 `YYYY` 是周归属年。动态索引依赖 `[fields][app]`，该字段缺失或值异常会产生意外索引名。

## 6. 最佳实践

- 一般场景下日志采集优先用 Filebeat，资源消耗通常比 Logstash 小
- 使用 Module 简化常见日志的采集配置
- 大规模场景用 Kafka 缓冲与解耦，但不自动提供端到端不丢保证
- 配置 `multiline` 处理多行日志（如 Java 异常堆栈）
- 使用 `fields` 添加元数据字段
- 监控 Beats 自身的运行状态
- Filebeat 的读取进度记录在 registry 文件，重启后从上次位置续采，但不构成端到端无丢失、无重复保证
- 下游不可用时事件先进入内存队列（默认），需要持久化可启用磁盘队列，两者容量都有限
