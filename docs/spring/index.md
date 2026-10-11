# Spring 知识库

本页负责选择入口。Spring 的背景、框架版图和知识地图由[第一篇概览](./01-core/chapter-01-spring-overview.md)完整说明。

## 从问题进入

| 你现在的问题 | 入口 |
| :-- | :-- |
| 不清楚 Bean 为什么能被创建和装配 | [Spring 核心原理概览](./01-core/chapter-01-spring-overview.md) |
| 不清楚某个配置为什么生效 | [自动配置原理](./02-spring-boot/chapter-01-autoconfiguration.md) |
| 要实现或排查一个 Web 接口 | [Spring MVC](./03-web/chapter-01-spring-mvc.md) |
| 事务没有回滚或边界不清 | [事务管理](./04-data-access/chapter-04-transaction.md) |
| 准备建立测试或生产检查流程 | [首次生产部署](./11-practice/chapter-03-first-production.md) |

## 按目录浏览

- **核心与 Boot**：[核心原理](./01-core/chapter-01-spring-overview.md)、[Spring Boot](./02-spring-boot/chapter-01-autoconfiguration.md)。
- **应用开发**：[Web](./03-web/chapter-01-spring-mvc.md)、[数据访问](./04-data-access/chapter-01-jdbc-template.md)、[安全](./05-security/chapter-01-security-architecture.md)。
- **生产工程**：[可观测性](./06-observability/chapter-01-logging.md)、[测试](./08-testing/chapter-01-unit-test.md)、[分布式系统](./09-distributed/chapter-01-distributed-lock.md)、[生产化](./10-production/chapter-01-pool-tuning.md)。
- **实践与查证**：[实践章节](./11-practice/chapter-01-build-deploy.md)、[参考手册](./reference/annotations.md)。

## 内容边界

Java 运行时机制放在 [Java 知识库](../java/index.md)，Redis、数据库等组件机制放在对应专题，业务场景中的组合方案放在[场景实战](../scenarios/index.md)。
