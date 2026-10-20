# 工具链速查

## 构建工具

| 工具 | 说明 | 常用命令 |
| :-- | :-- | :-- |
| Maven | XML 配置，约定优于配置，固定生命周期 | `mvn clean package`、`mvn dependency:tree` |
| Gradle | Groovy/Kotlin DSL，任务图与增量构建、构建缓存 | `gradle build`、`gradle dependencies` |

## 代码质量

| 工具 | 说明 | 集成方式 |
| :-- | :-- | :-- |
| SonarQube | 代码质量平台，自身执行分析并支持质量门禁 | Maven 插件 / CI 集成 |
| SpotBugs | 字节码层缺陷模式分析 | Maven 插件 |
| Checkstyle | 编码规范检查 | Maven 插件 |
| PMD | 规则驱动的代码缺陷检测 | Maven 插件 |

## 测试工具

| 工具 | 说明 |
| :-- | :-- |
| JUnit 5 | 单元测试框架 |
| Mockito | Mock 框架 |
| Testcontainers | 为测试启动真实依赖服务容器 |
| WireMock | HTTP Mock |
| AssertJ | 流式断言 |
| Awaitility | 异步条件验证 |

## CI/CD

| 工具 | 说明 |
| :-- | :-- |
| Jenkins | 流水线执行，自托管 |
| GitHub Actions | 流水线执行，GitHub 原生 |
| GitLab CI | 流水线执行，GitLab 原生 |
| ArgoCD | GitOps 持续交付 |

完整流水线阶段与部署策略见 [CI/CD 持续集成与持续交付](../06-engineering-practices/chapter-04-cicd.md)。

## 容器与编排

| 工具 | 说明 |
| :-- | :-- |
| Docker | 镜像构建与运行环境封装 |
| Docker Compose | 单机多容器编排 |
| Kubernetes | 容器编排平台 |
| Helm | K8s 应用打包与发布 |

## API 文档

| 工具 | 说明 |
| :-- | :-- |
| Swagger/OpenAPI | 接口描述规范（Swagger 为工具集） |
| Knife4j | Swagger 增强 UI |
| SpringDoc | 从 Spring 应用生成 OpenAPI 文档 |
| Postman | 接口调试与测试 |

## 监控

| 工具 | 说明 |
| :-- | :-- |
| Prometheus | 指标抓取与存储 |
| Grafana | 指标查询与可视化 |
| ELK Stack | 日志收集分析 |
| SkyWalking | APM 与分布式追踪 |
| Micrometer | 应用指标仪表化门面 |
