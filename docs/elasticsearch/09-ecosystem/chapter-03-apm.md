# APM 应用性能监控

## 1. APM 概述

APM（Application Performance Monitoring）用于监控应用程序的性能，包括请求延迟、错误率、数据库查询等。

```
应用服务 → APM Agent → APM Server → Elasticsearch → Kibana APM UI
```

## 2. APM 组件

| 组件 | 说明 |
| :-- | :-- |
| **APM Agent** | 嵌入应用中的 SDK，自动采集性能数据 |
| **APM Server** | 接收 Agent 数据，处理后写入 ES |
| **Elasticsearch** | 存储 APM 数据 |
| **Kibana APM UI** | 可视化展示 |

## 3. 安装 APM Server

```yaml
# apm-server.yml
apm-server:
  host: "0.0.0.0:8200"

output.elasticsearch:
  hosts: ["http://localhost:9200"]
  username: "elastic"
  password: "${ES_PASSWORD}"

setup.kibana:
  host: "http://localhost:5601"
```

## 4. Java Agent 配置

```bash
# 下载 Agent
curl -L -O https://artifacts.elastic.co/downloads/apm-agent/elastic-apm-agent-1.44.0.jar

# 启动应用时加载 Agent
java -javaagent:/path/to/elastic-apm-agent-1.44.0.jar \
  -Delastic.apm.service_name=my-service \
  -Delastic.apm.server_urls=http://localhost:8200 \
  -Delastic.apm.application_packages=com.example \
  -jar my-app.jar
```

### 4.1 Spring Boot 配置

```yaml
# application.yml
elastic:
  apm:
    service_name: my-spring-app
    server_urls: http://localhost:8200
    application_packages: com.example
    enable_instrumentation: true
    capture_body: all
```

## 5. Python Agent

```python
# 安装
pip install elastic-apm

# Flask 应用
import elasticapm
from elasticapm.contrib.flask import ElasticAPM

app = Flask(__name__)
apm = ElasticAPM(app,
    service_name='my-flask-app',
    server_url='http://localhost:8200',
)

# 手动追踪
@elasticapm.capture_span('custom_operation', 'custom')
def my_function():
    pass
```

## 6. APM 数据类型

| 数据类型 | 说明 |
| :-- | :-- |
| **Transaction** | 请求级别的性能数据（HTTP 请求、消息处理） |
| **Span** | 事务中的子操作（数据库查询、外部调用） |
| **Error** | 应用异常和错误 |
| **Metric** | 系统和应用指标 |

## 7. Kibana APM UI

- **服务概览**：所有服务的延迟、吞吐量、错误率
- **事务详情**：单个请求的完整调用链路
- **Span 分析**：每个子操作的耗时分布
- **错误追踪**：异常堆栈和发生频率
- **依赖分析**：服务间依赖关系图

## 8. 自定义追踪

```java
// Java - 手动创建 Span
Span span = ElasticApm.currentSpan();
span.setName("custom-redis-operation");
span.setType("db");
span.setSubtype("redis");
try {
    // 业务逻辑
} finally {
    span.end();
}
```

## 9. 最佳实践

- 生产环境所有核心服务部署 APM Agent
- 设置合理的采样率（如 10%），避免数据量过大
- 使用 `transaction_sample_rate` 控制采样
- APM 数据保留策略建议 7~30 天
- 监控 APM Server 自身的性能
- 使用告警功能及时发现性能异常
