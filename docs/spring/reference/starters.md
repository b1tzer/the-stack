# Spring Boot Starter 速查

## 官方 Starter

| Starter | 说明 |
| :-- | :-- |
| `spring-boot-starter-web` | Web 应用（内嵌 Tomcat） |
| `spring-boot-starter-data-jpa` | JPA + Hibernate |
| `spring-boot-starter-data-redis` | Redis（Lettuce） |
| `spring-boot-starter-data-mongodb` | MongoDB |
| `spring-boot-starter-data-elasticsearch` | Elasticsearch |
| `spring-boot-starter-amqp` | RabbitMQ |
| `spring-boot-starter-kafka` | Kafka |
| `spring-boot-starter-security` | Spring Security |
| `spring-boot-starter-oauth2-client` | OAuth2 客户端 |
| `spring-boot-starter-oauth2-resource-server` | OAuth2 资源服务器 |
| `spring-boot-starter-validation` | 参数校验（Hibernate Validator） |
| `spring-boot-starter-cache` | 缓存抽象 |
| `spring-boot-starter-actuator` | 监控端点 |
| `spring-boot-starter-test` | 测试（JUnit + Mockito） |
| `spring-boot-starter-webflux` | 响应式 Web |
| `spring-boot-starter-websocket` | WebSocket |
| `spring-boot-starter-mail` | 邮件发送 |
| `spring-boot-starter-quartz` | Quartz 定时任务 |
| `spring-boot-starter-flyway` | 数据库迁移（Flyway） |
| `spring-boot-starter-liquibase` | 数据库迁移（Liquibase） |
| `spring-boot-starter-integration` | Spring Integration |

## 常用第三方 Starter

| Starter | 说明 |
| :-- | :-- |
| `mybatis-spring-boot-starter` | MyBatis |
| `mybatis-plus-boot-starter` | MyBatis-Plus |
| `pagehelper-spring-boot-starter` | PageHelper 分页 |
| `knife4j-openapi3-spring-boot-starter` | API 文档（Swagger 增强） |
| `springdoc-openapi-starter-webmvc-ui` | OpenAPI 3 文档 |
| `redisson-spring-boot-starter` | Redisson（分布式锁） |
| `xxl-job-spring-boot-starter` | XXL-JOB 分布式任务调度 |
| `spring-cloud-starter-gateway` | Spring Cloud Gateway |
| `spring-cloud-starter-openfeign` | OpenFeign 声明式调用 |
| `spring-cloud-starter-alibaba-nacos-discovery` | Nacos 服务发现 |
| `spring-cloud-starter-alibaba-nacos-config` | Nacos 配置中心 |
| `spring-cloud-starter-alibaba-sentinel` | Sentinel 限流降级 |

## Spring AI Starter

Spring AI 1.1.x 的坐标需要配合 `spring-ai-bom` 使用，不单独写版本号。完整说明见 [Spring AI 概览与工程接入](../12-ai/chapter-01-spring-ai-overview.md)。

| Starter | 说明 |
| :-- | :-- |
| `spring-ai-starter-model-openai` | OpenAI 及兼容协议的聊天、嵌入、图像模型 |
| `spring-ai-starter-model-anthropic` | Anthropic Claude |
| `spring-ai-starter-model-ollama` | 本地 Ollama 模型 |
| `spring-ai-starter-vector-store-pgvector` | PostgreSQL + pgvector 向量库 |
| `spring-ai-starter-vector-store-redis` | Redis 向量库 |
| `spring-ai-starter-model-chat-memory-repository-jdbc` | 对话记忆的 JDBC 存储 |
| `spring-ai-starter-mcp-client` | MCP 客户端（HTTP、STDIO） |
| `spring-ai-starter-mcp-server-webmvc` | MCP 服务端（WebMVC） |

Spring AI 2.0 要求 Spring Boot 4.x，并重命名了部分坐标（例如向量库 Advisor 改为 `spring-ai-vector-store-advisor`），升级前需对照官方升级说明。

## Actuator 端点

| 端点 | 说明 |
| :-- | :-- |
| `/actuator/health` | 健康检查 |
| `/actuator/info` | 应用信息 |
| `/actuator/metrics` | 指标数据 |
| `/actuator/env` | 环境变量 |
| `/actuator/configprops` | 配置属性 |
| `/actuator/beans` | Bean 列表 |
| `/actuator/mappings` | URL 映射 |
| `/actuator/loggers` | 日志级别 |
| `/actuator/threaddump` | 线程 dump |
| `/actuator/heapdump` | 堆 dump |
| `/actuator/prometheus` | Prometheus 格式指标 |
