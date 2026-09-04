# 工具链速查

## 构建工具

| 工具 | 说明 | 常用命令 |
| :-- | :-- | :-- |
| Maven | XML 配置，约定优于配置 | `mvn clean package`、`mvn dependency:tree` |
| Gradle | Groovy/Kotlin DSL，灵活高效 | `gradle build`、`gradle dependencies` |

## 代码质量

| 工具 | 说明 | 集成方式 |
| :-- | :-- | :-- |
| SonarQube | 代码质量平台 | Maven 插件 / CI 集成 |
| SpotBugs | 静态分析 | Maven 插件 |
| Checkstyle | 代码风格检查 | Maven 插件 |
| PMD | 代码规范检查 | Maven 插件 |

## 测试工具

| 工具 | 说明 |
| :-- | :-- |
| JUnit 5 | 单元测试框架 |
| Mockito | Mock 框架 |
| Testcontainers | 集成测试容器化 |
| WireMock | HTTP Mock |
| AssertJ | 流式断言 |
| Awaitility | 异步测试 |

## CI/CD

| 工具 | 说明 |
| :-- | :-- |
| Jenkins | 自动化服务器 |
| GitHub Actions | GitHub 原生 CI |
| GitLab CI | GitLab 原生 CI |
| ArgoCD | GitOps 持续部署 |

## 容器与编排

| 工具 | 说明 |
| :-- | :-- |
| Docker | 容器化 |
| Docker Compose | 多容器编排 |
| Kubernetes | 容器编排平台 |
| Helm | K8s 包管理 |

## API 文档

| 工具 | 说明 |
| :-- | :-- |
| Swagger/OpenAPI | API 规范 |
| Knife4j | Swagger 增强 UI |
| SpringDoc | OpenAPI 3 + Spring Boot |
| Postman | API 测试与文档 |

## 监控

| 工具 | 说明 |
| :-- | :-- |
| Prometheus | 指标采集 |
| Grafana | 可视化面板 |
| ELK Stack | 日志收集分析 |
| SkyWalking | APM 链路追踪 |
| Micrometer | 应用指标门面 |
