# Spring 技术体系

系统化的 Spring / Spring Boot 知识体系，从核心原理到微服务实战。

## 目录结构

### 01-核心原理
- [Spring 概览](01-core/chapter-01-spring-overview) — 生态全景、设计理念、模块划分
- [IoC 容器](01-core/chapter-02-ioc-container) — BeanFactory vs ApplicationContext
- [Bean 完整生命周期](01-core/chapter-03-bean-lifecycle) — 实例化到销毁的八阶段、初始化回调顺序
- [依赖注入](01-core/chapter-04-dependency-injection) — DI 类型、@Autowired 原理
- [循环依赖与三级缓存](01-core/chapter-05-circular-dependency) — 三级缓存、AOP 代理冲突、工程红线
- [AOP 面向切面编程](01-core/chapter-06-aop) — 原理、JDK Proxy vs CGLIB
- [条件装配与 Profile](01-core/chapter-07-conditional-profile) — @Conditional、多环境

### 02-Web开发
- [Spring MVC](02-web/chapter-01-spring-mvc) — 请求处理全流程、DispatcherServlet
- [RESTful API](02-web/chapter-02-rest-api) — 设计规范、内容协商、异常处理
- [参数校验与数据绑定](02-web/chapter-03-validation-binding) — Bean Validation
- [拦截器与过滤器](02-web/chapter-04-interceptor-filter) — Filter vs Interceptor
- [WebFlux 响应式编程](02-web/chapter-05-webflux) — Mono/Flux、RouterFunction

### 03-数据访问
- [JdbcTemplate](03-data-access/chapter-01-jdbc-template) — 基本使用
- [MyBatis 集成](03-data-access/chapter-02-mybatis-integration) — Mapper、MyBatis-Plus
- [Spring Data JPA](03-data-access/chapter-03-jpa) — Repository、Specification
- [事务管理](03-data-access/chapter-04-transaction) — 传播行为、隔离级别、失效场景
- [多数据源](03-data-access/chapter-05-multi-datasource) — 动态数据源、读写分离

### 04-Spring Boot
- [自动配置原理](04-spring-boot/chapter-01-autoconfiguration) — @EnableAutoConfiguration
- [Starter 机制](04-spring-boot/chapter-02-starter) — 自定义 Starter
- [外部化配置](04-spring-boot/chapter-03-configuration) — 多环境 Profile、配置加密
- [Actuator 监控](04-spring-boot/chapter-04-actuator) — 健康检查、指标收集
- [DevTools 热部署](04-spring-boot/chapter-05-devtools) — 原理与配置

### 05-安全
- [安全架构](05-security/chapter-01-security-architecture) — Filter Chain、AuthenticationManager
- [认证机制](05-security/chapter-02-authentication) — Session/JWT/OAuth2
- [授权模型](05-security/chapter-03-authorization) — RBAC、方法级安全
- [安全最佳实践](05-security/chapter-04-security-practice) — CSRF/CORS、安全头部

### 06-高级特性
- [事件机制](06-advanced/chapter-01-event) — ApplicationEvent、@EventListener
- [异步处理](06-advanced/chapter-02-async) — @Async、CompletableFuture
- [定时任务](06-advanced/chapter-03-scheduling) — @Scheduled、动态调度
- [缓存抽象](06-advanced/chapter-04-caching) — @Cacheable、CacheManager
- [消息集成](06-advanced/chapter-05-messaging) — Kafka、RabbitMQ
- [国际化](06-advanced/chapter-06-internationalization) — i18n

### 07-微服务
- [微服务架构模式](07-microservices/chapter-01-microservice-pattern) — DDD、设计原则
- [服务注册与发现](07-microservices/chapter-02-service-discovery) — Nacos、Eureka
- [API 网关](07-microservices/chapter-03-api-gateway) — Spring Cloud Gateway
- [负载均衡](07-microservices/chapter-04-load-balancing) — OpenFeign
- [熔断降级](07-microservices/chapter-05-circuit-breaker) — Resilience4j、Sentinel
- [配置中心](07-microservices/chapter-06-config-center) — Nacos Config、动态刷新

### 08-测试
- [单元测试](08-testing/chapter-01-unit-test) — JUnit 5、Mockito
- [集成测试](08-testing/chapter-02-integration-test) — @SpringBootTest、MockMvc
- [Testcontainers](08-testing/chapter-03-testcontainers) — 数据库测试
