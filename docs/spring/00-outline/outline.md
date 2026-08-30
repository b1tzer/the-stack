# Spring 专题大纲（优化版）

> 10 章 · 61 节 · 每节标注预期学习效果

---

## 第 01 章：Spring 核心原理（IoC / AOP / 生命周期）

### 1.1 Spring 核心概览

#### 1.1.1 为什么会有 Spring
> 能说清楚 EJB 2.x 的四个痛点，以及 Spring 用 IoC + AOP 替代 EJB 的因果链。

#### 1.1.2 版本演进与时代问题
> 看到任何 Spring 版本号，能说出它回应了什么时代问题（XML→注解→Java Config→Boot→响应式）。

#### 1.1.3 框架版图与模块分层
> 能画出 spring-core / spring-beans / spring-context 的依赖方向，解释 BeanFactory vs ApplicationContext 的区别。

#### 1.1.4 知识地图：本专题的主线
> 能按「IoC → 生命周期 → DI → 循环依赖 → AOP → 条件装配」的顺序串起整章逻辑。

### 1.2 IoC 容器

#### 1.2.1 控制反转的本质
> 能用「谁来创建依赖」一句话解释 IoC，能对比传统方式和 IoC 方式在可替换性、可测试性、生命周期上的差异。

#### 1.2.2 BeanFactory 与 ApplicationContext
> 能说出 BeanFactory 是懒加载、ApplicationContext 是预加载，能解释 ApplicationContext 多出来的四个能力。

#### 1.2.3 refresh() 十二步
> 能按顺序说出 refresh() 的关键步骤，知道每步的作用。

#### 1.2.4 BeanDefinition：从注解到元数据
> 能解释 @Service 怎么变成 BeanDefinition，PropertySourcesPlaceholderConfigurer 在哪个阶段解析占位符。

### 1.3 Bean 完整生命周期

#### 1.3.1 三阶段骨架
> 能说出「实例化 → 属性填充 → 初始化」三阶段各自做什么，关键方法是什么。

#### 1.3.2 初始化回调的执行顺序
> 能按顺序列出 Aware → BeanPostProcessor.before → @PostConstruct → InitializingBean → 自定义 init → BeanPostProcessor.after。

#### 1.3.3 销毁回调与优雅停机
> 能说出 @PreDestroy → DisposableBean → 自定义 destroy 的顺序，能解释 SmartLifecycle 如何参与优雅停机。

#### 1.3.4 源码级拆解：两个 PostProcessor
> 能解释 ApplicationContextAwareProcessor 和 AutowiredAnnotationBeanPostProcessor 分别在哪个阶段做了什么。

### 1.4 依赖注入

#### 1.4.1 三种注入方式对比
> 能从四个维度对比构造器/Setter/字段注入，能说出构造器注入是默认选择的决定性理由。

#### 1.4.2 @Autowired vs @Resource
> 能说出 @Autowired 按类型匹配、@Resource 按名称匹配，能解释多实现场景下的行为差异。

#### 1.4.3 @Qualifier 与自定义限定符
> 能在多实现场景下用 @Qualifier 精确指定注入目标，能自定义组合注解。

#### 1.4.4 ObjectProvider 延迟注入
> 能用 ObjectProvider 解决「依赖可能不存在」的场景，能解释它和 @Autowired(required=false) 的区别。

### 1.5 AOP 面向切面编程

#### 1.5.1 横切关注点与切面
> 能说出 AOP 解决的核心问题，能用一句话串起五个核心术语。

#### 1.5.2 五种通知类型
> 能写出五种通知，能说出 Around 最灵活的原因。

#### 1.5.3 切点表达式
> 能写 execution / @annotation / @within / args 四种切点表达式。

#### 1.5.4 JDK 动态代理 vs CGLIB
> 能说出 JDK 代理基于接口、CGLIB 基于继承，能解释 Spring Boot 默认用 CGLIB 的原因。

#### 1.5.5 AOP 失效的四种场景
> 能识别自调用、private 方法、final 类、未被容器管理四种失效场景，能给出对应解法。

### 1.6 循环依赖与三级缓存

#### 1.6.1 循环依赖的卡点
> 能解释构造器注入为什么直接报错、字段注入为什么能「建出来」。

#### 1.6.2 提前暴露机制
> 能解释「先交半成品、后补成品」的思路。

#### 1.6.3 三个 Map 的流水线
> 能画出三个 Map 的查询和升级路径，能解释为什么是三级不是两级。

#### 1.6.4 @Lazy 破解循环依赖
> 能用 @Lazy 注入代理对象打破循环依赖，能解释它和三级缓存方案的区别。

### 1.7 条件装配与 Profile

#### 1.7.1 @Conditional 原理
> 能说出条件评估发生在 BeanDefinition 注册阶段，能解释 ConfigurationPhase 的两个取值。

#### 1.7.2 常用条件注解
> 能用 @ConditionalOnClass / @ConditionalOnMissingBean / @ConditionalOnProperty 实现条件装配。

#### 1.7.3 @Profile 按环境切换
> 能用 spring.profiles.active 和 @Profile 实现 dev/test/prod 环境隔离。

### 1.8 踩坑案例集

#### 1.8.1 @Transactional 自调用失效
> 能识别自调用导致 @Transactional 静默失效的现象，能用三种方案修复。

#### 1.8.2 @Transactional 异常类型不匹配
> 能说出默认只回滚 RuntimeException，能用 rollbackFor 修复。

#### 1.8.3 AOP 代理对象比较
> 能解释为什么 getClass() 在 AOP 场景下可能不一致，能用 AopUtils.getTargetClass() 获取真实类型。

#### 1.8.4 Bean 覆盖导致注入错误
> 能识别 NoUniqueBeanDefinitionException 场景，能用 @Primary / @Qualifier / @Resource 解决。

---

## 第 02 章：Spring Boot 原理与配置

### 2.1 自动配置原理

#### 2.1.1 @SpringBootApplication 拆解
> 能说出 @SpringBootApplication = @SpringBootConfiguration + @EnableAutoConfiguration + @ComponentScan。

#### 2.1.2 自动配置的加载流程
> 能按「配置文件 → @Conditional 过滤 → 排序 → 注册 Bean」的流程解释自动配置。

#### 2.1.3 条件装配在 Boot 中的应用
> 能解释 @ConditionalOnClass / @ConditionalOnMissingBean 如何实现「用户配了就让路」。

### 2.2 Starter 机制

#### 2.2.1 Starter 的目录结构
> 能说出 Starter = 自动配置类 + META-INF 配置文件 + 传递依赖。

#### 2.2.2 自定义 Starter 实战
> 能从零创建一个自定义 Starter，包含 @AutoConfiguration 类和 @ConfigurationProperties 属性绑定。

#### 2.2.3 Starter 版本管理与依赖冲突
> 能解释 spring-boot-dependencies 的 BOM 管理机制，能用 dependency:tree 排查版本冲突。

### 2.3 外部化配置

#### 2.3.1 配置优先级链
> 能按顺序列出配置优先级，能解释高优先级覆盖低优先级的规则。

#### 2.3.2 @ConfigurationProperties 绑定
> 能用 @ConfigurationProperties 把 yml 配置绑定到 POJO，支持嵌套结构、集合、校验。

#### 2.3.3 多环境 Profile
> 能用 spring.profiles.active / include / config.activate.on-profile 实现多环境隔离。

#### 2.3.4 配置加密与敏感信息保护
> 能用 Jasypt 或环境变量注入保护敏感配置。

### 2.4 Spring Boot 启动流程

#### 2.4.1 一个 run 拆成四段
> 能说出「准备 → 装配 → 收尾 → 退出」四阶段各自做什么。

#### 2.4.2 启动参数与 ApplicationArguments
> 能解释 args 怎么被解析成 ApplicationArguments，能用 --key=value 传参。

#### 2.4.3 启动失败诊断
> 能用 FailureAnalysis 和 debug 日志排查启动失败原因。

#### 2.4.4 优雅停机
> 能配置 graceful shutdown，能解释 SmartLifecycle 回调的执行顺序。

### 2.5 可观测性基础（Actuator）

#### 2.5.1 Actuator 端点
> 能说出 /health /info /metrics /env /beans /conditions 六个核心端点的作用。

#### 2.5.2 健康检查与自定义 Indicator
> 能写一个自定义 HealthIndicator 检查外部依赖。

#### 2.5.3 Micrometer 指标集成
> 能用 MeterRegistry 注册自定义 Counter / Timer / Gauge。

### 2.6 开发效率工具

#### 2.6.1 DevTools 热部署
> 能解释 DevTools 双 ClassLoader 原理，能配置 LiveReload。

#### 2.6.2 API 文档自动生成（springdoc-openapi）
> 能用 springdoc-openapi 自动生成 OpenAPI 3.0 文档。

### 2.7 构建与部署

#### 2.7.1 Fat Jar 的结构
> 能解释 repackage 如何把普通 jar 改造成可执行 fat jar。

#### 2.7.2 多模块工程打包
> 能组织 Spring Boot 多模块工程，能解决 repackage 重复执行问题。

#### 2.7.3 Docker 容器化
> 能写分层 Dockerfile，能解释分层如何利用缓存加速部署。

#### 2.7.4 GraalVM 原生镜像
> 能用 AOT + native 编译原生镜像，能识别常见的兼容性问题。

---

## 第 03 章：Web 开发全链路

### 3.1 Spring MVC 核心

#### 3.1.1 从 Servlet 到 DispatcherServlet
> 能画出 Tomcat → Filter → DispatcherServlet → HandlerMapping → Controller 的请求链路。

#### 3.1.2 DispatcherServlet.doDispatch 源码
> 能按顺序说出 doDispatch 的四步，能解释每步做了什么。

#### 3.1.3 HandlerMapping 与 HandlerAdapter
> 能解释 @RequestMapping 怎么被注册和执行，能说出两者配对的机制。

### 3.2 参数解析与返回值处理

#### 3.2.1 HandlerMethodArgumentResolver
> 能说出 @RequestParam / @PathVariable / @RequestBody / @ModelAttribute 分别由哪个 Resolver 处理。

#### 3.2.2 返回值处理与 HttpMessageConverter
> 能解释 @ResponseBody 怎么通过 HttpMessageConverter 把对象转成 JSON。

#### 3.2.3 内容协商
> 能配置 ContentNegotiationStrategy 实现同一 URL 返回 JSON / XML。

### 3.3 参数校验（Bean Validation）

#### 3.3.1 声明式校验
> 能用 @Valid + 注解声明校验规则，能说出 @Valid 和 @Validated 的区别。

#### 3.3.2 分组校验与嵌套校验
> 能用 groups 实现不同场景的校验规则，能用 @Valid 实现嵌套对象递归校验。

#### 3.3.3 自定义校验注解
> 能从零创建一个自定义校验注解（如 @IdCard）。

### 3.4 全局异常处理

#### 3.4.1 @ExceptionHandler 与 @ControllerAdvice
> 能用 @RestControllerAdvice 实现全局异常拦截，能按异常类型返回不同 HTTP 状态码。

#### 3.4.2 统一错误响应体设计
> 能设计标准错误响应体（code / message / details / traceId）。

#### 3.4.3 异常处理的优先级
> 能说出 Controller 内 → @ControllerAdvice → /error → 默认白页 的兜底链路。

### 3.5 拦截器与过滤器

#### 3.5.1 Filter vs Interceptor 执行顺序
> 能画出完整的请求拦截链路，能说出两者的关键区别。

#### 3.5.2 实战：请求日志与耗时统计
> 能用 HandlerInterceptor 记录请求信息，能用 MDC 传递 traceId。

#### 3.5.3 实战：CORS 与 CSRF 防护
> 能配置 CORS 允许跨域，能解释 CSRF 攻击原理和防护方案。

### 3.6 RESTful API 设计

#### 3.6.1 REST 语义与资源建模
> 能按 REST 约束设计 URL，能说出 Richardson 成熟度模型的三个级别。

#### 3.6.2 HATEOAS 与超媒体
> 能用 Spring HATEOAS 在响应中嵌入相关资源链接。

#### 3.6.3 API 版本控制
> 能用 URL / Header / Media Type 三种方式实现版本控制，能说出各自优劣。

### 3.7 文件上传与下载

#### 3.7.1 单文件与多文件上传
> 能用 MultipartFile 实现文件上传，能配置大小限制和类型校验。

#### 3.7.2 大文件流式处理
> 能用 StreamingResponseBody 实现大文件下载，能实现断点续传。

#### 3.7.3 对象存储集成
> 能用 S3 SDK 或 MinIO 实现文件上传到对象存储。

### 3.8 WebFlux 响应式编程

#### 3.8.1 阻塞模型的瓶颈
> 能画出 MVC 和 WebFlux 的线程模型对比图。

#### 3.8.2 Reactor 核心类型
> 能用 Mono / Flux 创建、组合、转换异步序列，能解释背压机制。

#### 3.8.3 WebFlux 注解模式与函数式模式
> 能用 @RestController 写响应式接口，能用 RouterFunction 写函数式路由。

#### 3.8.4 MVC vs WebFlux 选型
> 能从三个维度做选型决策，能说出混用阻塞依赖的陷阱。

### 3.9 实时通信：WebSocket 与 SSE

#### 3.9.1 WebSocket 与 STOMP
> 能用 @EnableWebSocketMessageBroker 配置 STOMP 端点，能实现群聊和点对点消息。

#### 3.9.2 SSE（Server-Sent Events）
> 能用 SseEmitter 或 Flux 实现服务端单向推送，能说出 SSE vs WebSocket 的选型依据。

---

## 第 04 章：数据访问与事务

### 4.1 Spring 数据访问抽象

#### 4.1.1 独立使用 vs Spring 整合
> 能对比独立使用 MyBatis 的 6 步模板和 Spring 整合后一个 @Autowired 的差异。

#### 4.1.2 JdbcTemplate 基础
> 能用 JdbcTemplate 完成 CRUD，能解释 Spring 对 SQLException 的统一转换。

#### 4.1.3 数据源配置与连接池
> 能配置 HikariCP 核心参数，能说出参数调优的基本原则。

### 4.2 MyBatis 集成

#### 4.2.1 Mapper 接口与 XML 映射
> 能用注解和 XML 两种方式写 CRUD。

#### 4.2.2 动态 SQL
> 能用 <if> / <choose> / <foreach> / <where> / <set> 写动态 SQL。

#### 4.2.3 MyBatis-Plus 增强
> 能用 BaseMapper + LambdaQueryWrapper 实现零 SQL CRUD。

#### 4.2.4 SqlSessionTemplate 与线程安全
> 能解释 SqlSessionTemplate 为什么线程安全，能说出 Spring 整合后一级缓存「失效」的原因。

#### 4.2.5 MyBatis 拦截器与插件
> 能写一个 Interceptor 实现 SQL 耗时日志。

### 4.3 Spring Data JPA

#### 4.3.1 实体定义与关联映射
> 能用注解定义实体和映射关联关系。

#### 4.3.2 Repository 接口
> 能用方法命名查询、@Query JPQL 查询、@Modifying 更新。

#### 4.3.3 Specification 动态查询
> 能用 Specification + Criteria API 实现多条件动态查询。

#### 4.3.4 审计功能
> 能用 @CreatedBy / @CreatedDate 等注解实现自动审计字段填充。

### 4.4 MyBatis vs JPA 选型

#### 4.4.1 两条路线的本质差异
> 能说出 MyBatis 是「SQL 映射器」、JPA 是「对象关系映射」。

#### 4.4.2 决策框架
> 能从四个维度做选型，能给出具体判断标准。

### 4.5 事务管理

#### 4.5.1 @Transactional 基础
> 能用 @Transactional(rollbackFor=Exception.class) 声明事务。

#### 4.5.2 传播行为
> 能说出 REQUIRED / REQUIRES_NEW / NESTED 三种常用传播行为的区别。

#### 4.5.3 隔离级别与并发问题
> 能说出四种隔离级别分别解决了哪些并发问题。

#### 4.5.4 @Transactional 失效场景
> 能识别四种失效场景，能给出修复方案。

#### 4.5.5 编程式事务
> 能用 TransactionTemplate 手动控制事务边界。

### 4.6 多数据源

#### 4.6.1 AbstractRoutingDataSource
> 能用动态数据源实现运行时切换。

#### 4.6.2 读写分离
> 能用 AOP + 动态数据源实现读写分离。

#### 4.6.3 分库分表方案
> 能说出 ShardingSphere-JDBC 的分片原理。

### 4.7 数据库迁移

#### 4.7.1 Flyway
> 能用版本化 SQL 脚本管理 DDL 变更。

#### 4.7.2 Liquibase
> 能用 changelog 管理 DDL，能说出 Flyway vs Liquibase 的选型依据。

### 4.8 响应式数据访问（R2DBC）

#### 4.8.1 非阻塞数据库访问
> 能说出 JDBC 阻塞模型如何抵消 WebFlux 的非阻塞优势。

#### 4.8.2 Spring Data R2DBC 实战
> 能用 ReactiveCrudRepository 完成 CRUD，能说出 R2DBC 的限制。

---

## 第 05 章：安全

### 5.1 安全架构概览

#### 5.1.1 认证 vs 授权
> 能用一句话区分两个概念，能说出 Spring Security 的 Filter Chain 架构。

#### 5.1.2 Spring Security 过滤器链
> 能画出 SecurityFilterChain 的流程，能解释每个核心 Filter 的职责。

#### 5.1.3 SecurityFilterChain 配置
> 能用 HttpSecurity 配置 URL 权限、登录、登出、CSRF。

### 5.2 身份认证

#### 5.2.1 表单登录
> 能用 formLogin() 配置自定义登录页、成功/失败处理器。

#### 5.2.2 JWT 认证
> 能用 JWT 实现无状态认证（签发 / 验证 / 刷新）。

#### 5.2.3 OAuth 2.0 / OIDC
> 能用 spring-security-oauth2-client 实现第三方登录。

#### 5.2.4 认证方案选型
> 能从三个维度选型（Session / JWT / OAuth2）。

### 5.3 授权模型

#### 5.3.1 RBAC 基于角色的访问控制
> 能用 @PreAuthorize 实现方法级权限控制，能设计三表模型。

#### 5.3.2 自定义权限评估
> 能实现 PermissionEvaluator 做数据级权限控制。

#### 5.3.3 ABAC 基于属性的访问控制
> 能用 Spring EL 实现基于属性的动态权限判断。

### 5.4 数据安全

#### 5.4.1 密码加密
> 能用 BCrypt 存储密码，能说出为什么不能用 MD5。

#### 5.4.2 敏感数据加密存储
> 能用 Jasypt 或自定义 AttributeConverter 实现字段加密。

### 5.5 安全最佳实践

#### 5.5.1 CSRF 防护
> 能解释 CSRF 攻击原理，能配置 Token 防护。

#### 5.5.2 CORS 跨域配置
> 能用 CorsConfigurationSource 精细控制跨域。

#### 5.5.3 安全响应头
> 能配置 CSP / X-Frame-Options / HSTS，能解释每个头防御的攻击。

---

## 第 06 章：可观测性

### 6.1 日志体系

#### 6.1.1 SLF4J + Logback 配置
> 能配置 logback-spring.xml 实现分文件、滚动、异步写入。

#### 6.1.2 结构化日志（JSON 格式）
> 能用 LogstashEncoder 输出 JSON 格式日志，便于 ELK 解析。

#### 6.1.3 MDC 与日志上下文
> 能用 MDC 在请求链路中传递 traceId，能解释异步场景下的丢失问题。

### 6.2 指标监控

#### 6.2.1 Micrometer 核心概念
> 能说出 Meter / Tag / MeterRegistry 三个核心概念。

#### 6.2.2 自定义业务指标
> 能用 Counter / Timer / Gauge 注册自定义业务指标。

#### 6.2.3 Prometheus + Grafana 集成
> 能配置 /actuator/prometheus 端点，能搭建 Grafana Dashboard。

### 6.3 链路追踪

#### 6.3.1 分布式追踪原理
> 能解释 Trace / Span / Context Propagation 三个核心概念。

#### 6.3.2 Micrometer Tracing + Zipkin
> 能集成 Zipkin，能配置采样率和上报地址。

#### 6.3.3 日志-指标-追踪三者关联
> 能用 traceId 关联三大支柱，能说清楚排查路径。

### 6.4 生产问题排查

#### 6.4.1 线上 CPU 飙高排查
> 能用 jstack + arthas 定位 CPU 飙高的线程和代码。

#### 6.4.2 内存泄漏排查
> 能用 jmap + MAT 分析堆内存，能识别常见泄漏场景。

#### 6.4.3 接口慢查询排查
> 能用链路追踪定位慢 Span，能结合慢查询日志找瓶颈。

---

## 第 07 章：异步与消息

### 7.1 Spring 事件机制

#### 7.1.1 自定义事件与监听
> 能用 ApplicationEvent + @EventListener 实现发布-订阅模式。

#### 7.1.2 事件的事务边界
> 能用 @TransactionalEventListener 实现事务提交后才发事件。

#### 7.1.3 事件 vs 消息队列选型
> 能说出事件（进程内）和消息队列（跨进程）的适用边界。

### 7.2 异步处理

#### 7.2.1 @Async 基础
> 能用 @Async + 自定义线程池实现方法异步执行。

#### 7.2.2 线程池调优
> 能配置核心参数，能说出每个参数对吞吐量的影响。

#### 7.2.3 异步异常处理
> 能用 AsyncUncaughtExceptionHandler 和 CompletableFuture 处理异步异常。

#### 7.2.4 @Async 失效场景
> 能识别自调用、非 public、未启用 @EnableAsync 三种失效场景。

### 7.3 定时任务

#### 7.3.1 @Scheduled 基础
> 能用 fixedRate / fixedDelay / cron 三种方式配置定时任务。

#### 7.3.2 Cron 表达式
> 能写常用 cron 表达式，能解释 Spring cron 和 Linux cron 的差异。

#### 7.3.3 线程池与并发控制
> 能配置自定义定时任务线程池，能解释默认单线程池的阻塞问题。

#### 7.3.4 Quartz 动态定时任务
> 能用 Quartz 实现运行时动态管理定时任务，能配置集群模式。

### 7.4 缓存抽象

#### 7.4.1 @Cacheable / @CacheEvict / @CachePut
> 能用注解声明缓存策略，能解释三个注解的区别。

#### 7.4.2 缓存管理器与 Redis 集成
> 能用 RedisCacheManager 配置 Redis 缓存，能配置过期策略。

#### 7.4.3 缓存穿透/击穿/雪崩
> 能解释三种缓存问题的原理和防护方案。

#### 7.4.4 自定义缓存 Key 生成策略
> 能用 SpEL 或 KeyGenerator 自定义 Key。

### 7.5 消息集成

#### 7.5.1 Kafka 集成
> 能用 KafkaTemplate + @KafkaListener 实现消息收发。

#### 7.5.2 RabbitMQ 集成
> 能用 RabbitTemplate + @RabbitListener 实现消息收发，能配置死信队列。

#### 7.5.3 消息可靠性保证
> 能说出「生产者确认 → 持久化 → 消费者 ACK → 幂等消费」的全链路方案。

---

## 第 08 章：测试

### 8.1 测试策略

#### 8.1.1 测试金字塔
> 能画出测试金字塔，能说出每层的占比和覆盖范围。

#### 8.1.2 测试什么、不测什么
> 能识别哪些代码值得测、哪些不值得测。

#### 8.1.3 Mock vs Stub vs Spy
> 能区分三种替身，能根据场景选择。

### 8.2 单元测试

#### 8.2.1 JUnit 5 核心
> 能用 @Test / @BeforeEach / @ParameterizedTest 写测试。

#### 8.2.2 Mockito 实战
> 能用 when().thenReturn() / verify() / @Mock / @InjectMocks 写 Mock 测试。

#### 8.2.3 测试 Service 层
> 能为 Service 类设计完整测试用例：正常、边界、异常、交互验证。

### 8.3 集成测试

#### 8.3.1 @SpringBootTest 配置
> 能用 @SpringBootTest 启动完整容器测试。

#### 8.3.2 MockMvc 实战
> 能用 MockMvc 测试 Controller，验证状态码和响应体。

#### 8.3.3 测试切片
> 能用 @WebMvcTest / @DataJpaTest 只加载需要的组件。

### 8.4 数据库测试

#### 8.4.1 @DataJpaTest 与嵌入式数据库
> 能用 @DataJpaTest + H2 测试 Repository 层。

#### 8.4.2 Testcontainers
> 能用 Testcontainers 启动真实容器做集成测试。

#### 8.4.3 测试数据管理
> 能用 @Transactional + @Rollback 管理测试数据。

### 8.5 契约测试与 API 测试

#### 8.5.1 REST Assured
> 能用 REST Assured 写可读性高的 API 测试。

#### 8.5.2 Spring Cloud Contract（概览）
> 能说出 CDC 的核心思想，能解释它如何解决接口兼容性问题。

---

## 第 09 章：分布式系统

### 9.1 分布式锁

#### 9.1.1 分布式锁三要素
> 能说出互斥、防死锁、可重入三个要素。

#### 9.1.2 Redis 分布式锁（Redisson）
> 能用 Redisson 实现分布式锁，能解释 Lua 脚本保证原子性的原理。

#### 9.1.3 ZooKeeper 分布式锁
> 能用 Curator 实现分布式锁，能对比 Redis 和 ZooKeeper 的选型。

### 9.2 分布式事务

#### 9.2.1 CAP 与 BASE 理论
> 能解释 CAP 三选二的约束，能说出 BASE 是对 CAP 的工程妥协。

#### 9.2.2 Seata AT 模式
> 能解释 AT 模式的「一阶段提交 + 二阶段回滚」原理。

#### 9.2.3 SAGA 模式
> 能解释 SAGA 的「正向 + 补偿」模式，能对比 SAGA 和 2PC。

#### 9.2.4 最终一致性方案
> 能用 RocketMQ 事务消息实现最终一致性。

### 9.3 服务调用

#### 9.3.1 OpenFeign 声明式调用
> 能用 @FeignClient 声明远程接口，能配置 FallbackFactory 实现降级。

#### 9.3.2 WebClient 响应式调用
> 能用 WebClient 调用外部 API，能对比 RestTemplate / Feign / WebClient。

### 9.4 服务容错

#### 9.4.1 熔断器（Circuit Breaker）
> 能用 Resilience4j 实现熔断，能说出三种状态的转换条件。

#### 9.4.2 限流与降级
> 能用 @RateLimiter / @Bulkhead 实现限流和舱壁隔离。

#### 9.4.3 重试与超时
> 能用 @Retry 配置指数退避重试，能解释重试风暴的风险。

### 9.5 配置中心

#### 9.5.1 Nacos Config
> 能用 Nacos 集中管理配置，能用 @RefreshScope 实现热更新。

#### 9.5.2 配置版本管理与灰度发布
> 能用 Nacos 的版本回滚和灰度发布功能。

### 9.6 API 网关

#### 9.6.1 Spring Cloud Gateway
> 能用 Route + Predicate + Filter 配置路由规则。

#### 9.6.2 网关过滤器
> 能写 GlobalFilter 实现认证校验、请求日志、限流。

---

## 第 10 章：生产化与部署

### 10.1 连接池与容器调优

#### 10.1.1 HikariCP 参数调优
> 能根据并发量计算 maximum-pool-size，能配置连接泄漏防护。

#### 10.1.2 Tomcat 线程池调优
> 能配置线程池参数，能说出线程池和连接池的配合原则。

#### 10.1.3 JVM 参数调优
> 能配置堆大小、GC 策略、元空间大小，能用 GC 日志分析。

### 10.2 容器化部署

#### 10.2.1 分层 Dockerfile
> 能写利用 Spring Boot 分层机制的 Dockerfile。

#### 10.2.2 Docker Compose 编排
> 能用 Docker Compose 编排应用 + MySQL + Redis + MQ。

### 10.3 GraalVM 原生镜像

#### 10.3.1 AOT 处理原理
> 能解释 Spring AOT 如何在编译时生成 Bean 定义和反射配置。

#### 10.3.2 Native 编译实战
> 能用 native-maven-plugin 编译原生镜像，能解决兼容性问题。

#### 10.3.3 原生镜像 vs JVM 模式
> 能从四个维度对比，能说出各自的适用场景。

### 10.4 CI/CD 流水线

#### 10.4.1 GitHub Actions 自动化
> 能配置完整的 CI/CD 流水线。

#### 10.4.2 蓝绿部署与滚动更新
> 能说出两种部署策略的区别，能用 K8s 配置滚动更新。
