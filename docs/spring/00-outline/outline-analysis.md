# Spring 专题大纲分析与优化方案

## 一、现有大纲总览

| 章 | 目录 | 主题 | 章节数 | 行数 | 深度评价 |
|:--|:--|:--|:--|:--|:--|
| 01-core | 核心原理 | IoC / 生命周期 / DI / AOP / 循环依赖 / 条件装配 / 踩坑 | 8 | ~2300 | ★★★★★ 深入源码，质量最高 |
| 02-web | Web 开发 | MVC / 校验 / 拦截器 / WebFlux / WebSocket / SSE / 文件 | 8 | ~3100 | ★★★★ 完整，WebFlux 深度好 |
| 03-data-access | 数据访问 | JDBC / MyBatis / JPA / 事务 / 多数据源 / Flyway / R2DBC | 7 | ~2100 | ★★★☆ MyBatis 和事务偏薄 |
| 04-spring-boot | Spring Boot | 自动配置 / Starter / 配置 / Actuator / DevTools / API文档 / 启动 / 调优 / 部署 | 9 | ~2200 | ★★★ 内容偏浅，不少只有骨架 |
| 05-security | 安全 | 架构 / 认证 / 授权 / 最佳实践 | 4 | ~1500 | ★★★ 架构章深入，其余偏薄 |
| 06-advanced | 高级特性 | 事件 / 异步 / 定时 / 缓存 / 消息 / i18n / 分布式锁 / Quartz / 邮件 / Batch | 10 | ~2700 | ★★ 内容参差，多数偏浅 |
| 07-microservices | 微服务 | 架构 / 治理 / 网关 / 负载均衡 / 熔断 / 配置中心 / 分布式事务 | 7 | ~3600 | ★★★ 治理和网关深入 |
| 08-testing | 测试 | 单元测试 / 集成测试 / Testcontainers | 3 | ~630 | ★★ 内容最少，缺实战深度 |

**总计：56 章，约 18000 行**

---

## 二、问题诊断

### 1. 结构性问题

| 问题 | 说明 |
|:--|:--|
| **章节缺失** | `02-web` 缺 `chapter-02`（编号跳了），说明曾经规划过但未写或被删除 |
| **粒度不均** | `01-core` 有 8 章讲透一件事；`06-advanced` 有 10 章但每章只铺骨架不讲透 |
| **分类逻辑混乱** | `06-advanced` 是个大杂烩——事件/异步/缓存/分布式锁/Batch/邮件，彼此没有递进关系 |
| **安全位置不当** | 安全（05）夹在 Boot 和 Advanced 之间，学习路径不自然。安全应在 Web 之后、Boot 之后或独立专题 |
| **微服务越界** | Nacos Config、Sentinel、Seata 这些是 Spring Cloud Alibaba 生态，不是 Spring 本身。混在一起容易误导 |

### 2. 内容质量问题

| 问题 | 涉及章节 | 说明 |
|:--|:--|:--|
| **内容空壳化** | 06-advanced 多数章节 | 代码片段+表格堆砌，缺乏「为什么」和「踩坑」，读完不会用 |
| **缺乏对比引导** | 03-data-access | MyBatis vs JPA vs JdbcTemplate 怎么选？没有决策框架 |
| **缺少实战串联** | 08-testing | 只讲 API 用法，没讲「测试什么」「怎么设计测试用例」「Mock 策略」 |
| **可观测性不足** | 04-spring-boot/actuator | 把日志/指标/链路追踪塞在一章里太拥挤，应拆开 |
| **缺少 REST 全链路** | 02-web | 没有 RESTful API 设计、内容协商、异常处理全局方案 |
| **缺少 GraalVM/Native** | 04-spring-boot | Spring Boot 3.x 的原生镜像支持是重要新特性，完全缺失 |

### 3. 学习路径问题

现有顺序：Core → Web → Data → Boot → Security → Advanced → Microservices → Testing

问题：
- Boot 放在 Data 之后，但 Boot 的自动配置是理解 Data/Security 的前置知识
- Testing 放最后，但测试驱动开发应该是贯穿全程的
- Advanced 是个「不知道放哪就扔这里」的垃圾桶分类

---

## 三、优化方案

### 核心原则

1. **每个 h3 标题对应一个可验证的学习效果**——读完这一节，你应该能做一件具体的事
2. **浅的砍掉，深的保留**——宁可 40 章写透，不要 60 章铺骨架
3. **重排学习路径**——Boot 前置，Security 独立，Advanced 拆散归位
4. **补充缺失链路**——REST 全链路、可观测性三支柱、GraalVM、测试驱动

### 优化后的章结构

| 章 | 主题 | 章节数 | 与原版对比 |
|:--|:--|:--|:--|
| 01-core | Spring 核心原理 | 8 | 保留，微调 |
| 02-spring-boot | Spring Boot 原理与配置 | 7 | 前移，合并精简 |
| 03-web | Web 开发全链路 | 9 | 补 REST 设计、全局异常 |
| 04-data-access | 数据访问与事务 | 8 | 补 MyBatis 深入、事务实战 |
| 05-security | 安全 | 5 | 补 OAuth2/OIDC 完整链路 |
| 06-observability | 可观测性 | 4 | 新增，从 actuator 拆出 |
| 07-async-and-messaging | 异步与消息 | 5 | 从 Advanced 拆出 |
| 08-testing | 测试 | 5 | 大幅扩充 |
| 09-distributed | 分布式系统 | 6 | 从 Advanced + Microservices 重组 |
| 10-production | 生产化与部署 | 4 | 从 Boot 拆出 + 新增 GraalVM |

**总计：61 章（原 56 章，净增 5 章，但删除空壳章节后实际内容更紧凑）**

---

## 四、优化后完整大纲（h3 粒度）

> 以下每一节标注了 **预期效果**：读完这一节后，读者应该能做到什么。

---

### 第 01 章：Spring 核心原理（IoC / AOP / 生命周期）

> 定位：整个专题的地基。不讲 Boot、不讲 Web，只讲容器本身。

#### 1.1 Spring 核心概览

##### 1.1.1 为什么会有 Spring

**效果**：能说清楚 EJB 2.x 的四个痛点，以及 Spring 用 IoC + AOP 替代 EJB 的因果链。

##### 1.1.2 版本演进与时代问题

**效果**：看到任何一个 Spring 版本号，能说出它回应了什么时代问题（XML→注解→Java Config→Boot→响应式）。

##### 1.1.3 框架版图与模块分层

**效果**：能画出 spring-core / spring-beans / spring-context 的依赖方向，解释 BeanFactory vs ApplicationContext 的区别。

##### 1.1.4 知识地图：本专题的主线

**效果**：能按「IoC → 生命周期 → DI → 循环依赖 → AOP → 条件装配」的顺序串起整章逻辑。

#### 1.2 IoC 容器

##### 1.2.1 控制反转的本质

**效果**：能用「谁来创建依赖」一句话解释 IoC，能对比传统方式和 IoC 方式在可替换性、可测试性、生命周期上的差异。

##### 1.2.2 BeanFactory 与 ApplicationContext

**效果**：能说出 BeanFactory 是懒加载、ApplicationContext 是预加载，能解释 ApplicationContext 多出来的四个能力（事件、国际化、资源、注解配置）。

##### 1.2.3 refresh() 十二步

**效果**：能按顺序说出 refresh() 的关键步骤（准备 BeanFactory → 执行 BeanFactoryPostProcessor → 注册 BeanPostProcessor → 实例化单例 → 发布事件），知道每步的作用。

##### 1.2.4 BeanDefinition：从注解到元数据

**效果**：能解释 @Service 怎么变成 BeanDefinition，PropertySourcesPlaceholderConfigurer 在哪个阶段解析 ${} 占位符。

#### 1.3 Bean 完整生命周期

##### 1.3.1 三阶段骨架

**效果**：能说出「实例化 → 属性填充 → 初始化」三阶段各自做什么，关键方法是什么。

##### 1.3.2 初始化回调的执行顺序

**效果**：能按顺序列出 Aware → BeanPostProcessor.before → @PostConstruct → InitializingBean.afterPropertiesSet → 自定义 init → BeanPostProcessor.after，能解释为什么这个顺序是固定的。

##### 1.3.3 销毁回调与优雅停机

**效果**：能说出 @PreDestroy → DisposableBean.destroy → 自定义 destroy 的顺序，能解释 SmartLifecycle 如何参与优雅停机。

##### 1.3.4 源码级拆解：两个 PostProcessor

**效果**：能解释 ApplicationContextAwareProcessor 和 AutowiredAnnotationBeanPostProcessor 分别在生命周期的哪个阶段做了什么。

#### 1.4 依赖注入

##### 1.4.1 三种注入方式对比

**效果**：能从「字段不可变性」「依赖必须存在」「可测试性」「启动期发现」四个维度对比构造器/Setter/字段注入，能说出构造器注入是默认选择的决定性理由。

##### 1.4.2 @Autowired vs @Resource

**效果**：能说出 @Autowired 按类型匹配、@Resource 按名称匹配，能解释多实现场景下两种注解的行为差异。

##### 1.4.3 @Qualifier 与自定义限定符

**效果**：能在多实现场景下用 @Qualifier 精确指定注入目标，能自定义组合注解替代 @Qualifier。

##### 1.4.4 ObjectProvider 延迟注入

**效果**：能用 ObjectProvider 解决「依赖可能不存在」的场景，能解释它和 @Autowired(required=false) 的区别。

#### 1.5 AOP 面向切面编程

##### 1.5.1 横切关注点与切面

**效果**：能说出 AOP 解决的核心问题（横切逻辑复用），能用「切点挑方法、通知定义逻辑、两者组成切面」一句话串起五个核心术语。

##### 1.5.2 五种通知类型

**效果**：能写出 Before / AfterReturning / AfterThrowing / After / Around 五种通知，能说出 Around 最灵活的原因（能拦截、改参数、改返回值）。

##### 1.5.3 切点表达式

**效果**：能写 execution / @annotation / @within / args 四种切点表达式，能解释 designators 的组合规则。

##### 1.5.4 JDK 动态代理 vs CGLIB

**效果**：能说出 JDK 代理基于接口、CGLIB 基于继承，能解释 Spring Boot 默认用 CGLIB 的原因（@Configuration 类需要子类化），能说出 final 类/method 不能被代理的限制。

##### 1.5.5 AOP 失效的四种场景

**效果**：能识别自调用、private 方法、final 类、未被容器管理的类这四种 AOP 失效场景，能给出对应的解法。

#### 1.6 循环依赖与三级缓存

##### 1.6.1 循环依赖的卡点

**效果**：能解释构造器注入为什么直接报错、字段注入为什么能「建出来」，能说出卡点在「实例化」和「属性填充」之间。

##### 1.6.2 提前暴露机制

**效果**：能解释「先交半成品、后补成品」的思路，能说出实例化完成后引用存进了哪里。

##### 1.6.3 三个 Map 的流水线

**效果**：能画出 singletonObjects → earlySingletonObjects → singletonFactories 的查询和升级路径，能解释为什么是三级不是两级（延迟 AOP 代理决策）。

##### 1.6.4 @Lazy 破解循环依赖

**效果**：能用 @Lazy 注入代理对象打破循环依赖，能解释它和三级缓存方案的区别（@Lazy 延迟到首次调用，三级缓存在属性填充阶段就解开）。

#### 1.7 条件装配与 Profile

##### 1.7.1 @Conditional 原理

**效果**：能说出条件评估发生在 BeanDefinition 注册阶段（比实例化更早），能解释 ConfigurationPhase 的两个取值分别评估什么。

##### 1.7.2 常用条件注解

**效果**：能用 @ConditionalOnClass / @ConditionalOnMissingBean / @ConditionalOnProperty 实现「用户没配时给默认值，用户自己配了就让路」。

##### 1.7.3 @Profile 按环境切换

**效果**：能用 spring.profiles.active 和 @Profile 实现 dev/test/prod 环境隔离，能解释 @Profile 在条件装配中的特殊地位。

#### 1.8 踩坑案例集

##### 1.8.1 @Transactional 自调用失效

**效果**：能识别「同类方法自调用导致 @Transactional 静默失效」的现象，能用拆类/自注入/AopContext 三种方案修复。

##### 1.8.2 @Transactional 异常类型不匹配

**效果**：能说出默认只回滚 RuntimeException、IOException 不会触发回滚，能用 rollbackFor=Exception.class 修复。

##### 1.8.3 AOP 代理对象比较

**效果**：能解释为什么 `obj1.getClass() != obj2.getClass()` 在 AOP 代理场景下可能为 true，能用 AopUtils.getTargetClass() 获取真实类型。

##### 1.8.4 Bean 覆盖导致注入错误

**效果**：能识别「同类型多 Bean 导致 NoUniqueBeanDefinitionException」的场景，能用 @Primary / @Qualifier / @Resource 解决。

---

### 第 02 章：Spring Boot 原理与配置

> 定位：从「会用 Boot」到「理解 Boot 为什么这样设计」。放在核心原理之后、Web 之前，因为 Boot 的自动配置是后续所有章节的前置知识。

#### 2.1 自动配置原理

##### 2.1.1 @SpringBootApplication 拆解

**效果**：能说出 @SpringBootApplication = @SpringBootConfiguration + @EnableAutoConfiguration + @ComponentScan，能解释每个注解做了什么。

##### 2.1.2 自动配置的加载流程

**效果**：能按「spring.factories / AutoConfiguration.imports → @Conditional 过滤 → 排序 → 注册 Bean」的流程解释自动配置，能画出流程图。

##### 2.1.3 条件装配在 Boot 中的应用

**效果**：能解释 @ConditionalOnClass / @ConditionalOnMissingBean 如何实现「用户配了就让路」，能读懂一个 Starter 的自动配置源码。

#### 2.2 Starter 机制

##### 2.2.1 Starter 的目录结构

**效果**：能说出 Starter = 自动配置类 + META-INF 配置文件 + 传递依赖，能解释为什么 Starter 本身不含代码。

##### 2.2.2 自定义 Starter 实战

**效果**：能从零创建一个自定义 Starter，包含 @AutoConfiguration 类、@ConfigurationProperties 属性绑定、条件装配。

##### 2.2.3 Starter 版本管理与依赖冲突

**效果**：能解释 spring-boot-dependencies 的 BOM 管理机制，能用 mvn dependency:tree 排查版本冲突。

#### 2.3 外部化配置

##### 2.3.1 配置优先级链

**效果**：能按顺序列出命令行 → 环境变量 → profile yml → 默认 yml → @PropertySource 的优先级，能解释高优先级覆盖低优先级的规则。

##### 2.3.2 @ConfigurationProperties 绑定

**效果**：能用 @ConfigurationProperties 把 yml 配置绑定到 POJO，能支持嵌套结构、集合、校验（@Validated）。

##### 2.3.3 多环境 Profile

**效果**：能用 spring.profiles.active / spring.profiles.include / spring.config.activate.on-profile 实现多环境隔离。

##### 2.3.4 配置加密与敏感信息保护

**效果**：能用 Jasypt 或环境变量注入保护数据库密码等敏感配置，能说出为什么不能把密码写在 yml 里。

#### 2.4 Spring Boot 启动流程

##### 2.4.1 一个 run 拆成四段

**效果**：能说出「准备阶段 → 装配阶段 → 收尾阶段 → 退出阶段」各自做什么，知道 refresh() 前后两段的关键动作。

##### 2.4.2 启动参数与 ApplicationArguments

**效果**：能解释 main(String[] args) 里的 args 怎么被解析成 ApplicationArguments，能用 --key=value 传参并用 @Value 或 CommandLineRunner 读取。

##### 2.4.3 启动失败诊断

**效果**：能用 FailureAnalysis 和 boot-configure-debug-log 排查启动失败原因，能识别常见的 BeanCreationException / NoSuchBeanDefinitionException。

##### 2.4.4 优雅停机

**效果**：能配置 server.shutdown=graceful + spring.lifecycle.timeout-per-shutdown-phase，能解释 SmartLifecycle 回调的执行顺序。

#### 2.5 可观测性基础（Actuator）

##### 2.5.1 Actuator 端点

**效果**：能说出 /health /info /metrics /env /beans /conditions 六个核心端点的作用，能配置端点暴露策略。

##### 2.5.2 健康检查与自定义 Indicator

**效果**：能写一个自定义 HealthIndicator 检查外部依赖（Redis / 数据库 / 下游服务），能解释 /health 聚合多个 Indicator 的机制。

##### 2.5.3 Micrometer 指标集成

**效果**：能用 MeterRegistry 注册自定义 Counter / Timer / Gauge，能解释 Spring Boot 自动注册的 JVM / HTTP / 数据库指标。

#### 2.6 开发效率工具

##### 2.6.1 DevTools 热部署

**效果**：能解释 DevTools 双 ClassLoader 原理，能配置 LiveReload 实现代码修改后自动刷新。

##### 2.6.2 API 文档自动生成（springdoc-openapi）

**效果**：能用 springdoc-openapi 自动生成 OpenAPI 3.0 文档，能配置分组、安全方案、自定义 Schema。

#### 2.7 构建与部署

##### 2.7.1 Fat Jar 的结构

**效果**：能解释 spring-boot-maven-plugin 的 repackage 目标如何把普通 jar 改造成可执行 fat jar，能画出 fat jar 的目录结构。

##### 2.7.2 多模块工程打包

**效果**：能组织一个 Spring Boot 多模块工程（parent + api + service + web），能解决 repackage 重复执行的问题。

##### 2.7.3 Docker 容器化

**效果**：能写一个分层 Dockerfile（依赖层 / 资源层 / 代码层），能解释分层构建如何利用 Docker 缓存加速部署。

##### 2.7.4 GraalVM 原生镜像

**效果**：能用 spring-boot-maven-plugin 的 process-aot + native 编译原生镜像，能说出 AOT 处理做了什么（提前生成 Bean 定义、反射配置），能识别常见的原生镜像兼容性问题。

---

### 第 03 章：Web 开发全链路

> 定位：从 HTTP 请求进来到响应出去的完整旅程。覆盖同步 MVC 和响应式 WebFlux 两条路线。

#### 3.1 Spring MVC 核心

##### 3.1.1 从 Servlet 到 DispatcherServlet

**效果**：能画出 Tomcat → Filter → DispatcherServlet → HandlerMapping → Controller 的请求链路，能说出 Servlet 规范和前端控制器模式的关系。

##### 3.1.2 DispatcherServlet.doDispatch 源码

**效果**：能按顺序说出 doDispatch 的四步：getHandler → getHandlerAdapter → handle → processDispatchResult，能解释每步做了什么。

##### 3.1.3 HandlerMapping 与 HandlerAdapter

**效果**：能解释 @RequestMapping 怎么被 RequestMappingHandlerMapping 注册、怎么被 RequestMappingHandlerAdapter 执行，能说出两者配对的机制。

#### 3.2 参数解析与返回值处理

##### 3.2.1 HandlerMethodArgumentResolver

**效果**：能说出 @RequestParam / @PathVariable / @RequestBody / @ModelAttribute 分别由哪个 Resolver 处理，能自定义一个 ArgumentResolver。

##### 3.2.2 返回值处理与 HttpMessageConverter

**效果**：能解释 @ResponseBody 怎么通过 HttpMessageConverter 把对象转成 JSON，能配置自定义的 ObjectMapper。

##### 3.2.3 内容协商

**效果**：能配置 ContentNegotiationStrategy 实现同一 URL 根据 Accept 头返回 JSON / XML，能解释 suffix 匹配和 parameter 匹配。

#### 3.3 参数校验（Bean Validation）

##### 3.3.1 声明式校验

**效果**：能用 @Valid + @NotBlank / @Email / @Size / @Pattern 声明校验规则，能说出 @Valid 和 @Validated 的区别。

##### 3.3.2 分组校验与嵌套校验

**效果**：能用 groups 实现「创建时必须有 name、更新时可以没有」的分组校验，能用 @Valid 实现嵌套对象递归校验。

##### 3.3.3 自定义校验注解

**效果**：能从零创建一个自定义校验注解（如 @IdCard），包含注解定义 + ConstraintValidator 实现。

#### 3.4 全局异常处理

##### 3.4.1 @ExceptionHandler 与 @ControllerAdvice

**效果**：能用 @RestControllerAdvice + @ExceptionHandler 实现全局异常拦截，能按异常类型返回不同 HTTP 状态码和错误体。

##### 3.4.2 统一错误响应体设计

**效果**：能设计一个标准的错误响应体（code / message / details / traceId），能用 ErrorResponse 接口（Spring 6）统一格式。

##### 3.4.3 异常处理的优先级

**效果**：能说出「Controller 内 @ExceptionHandler → @ControllerAdvice → /error → 默认白页」的兜底链路，能解释同级 @ControllerAdvice 的 @Order 排序规则。

#### 3.5 拦截器与过滤器

##### 3.5.1 Filter vs Interceptor 执行顺序

**效果**：能画出 Filter → DispatcherServlet → Interceptor.preHandle → Controller → Interceptor.postHandle → Interceptor.afterCompletion → Filter 返回 的完整链路，能说出两者的关键区别。

##### 3.5.2 实战：请求日志与耗时统计

**效果**：能用 HandlerInterceptor 记录每个请求的 URL、方法、参数、耗时，能用 MDC 传递 traceId。

##### 3.5.3 实战：CORS 与 CSRF 防护

**效果**：能配置 CORS 允许跨域请求，能解释 CSRF 攻击原理和 Token 防护方案。

#### 3.6 RESTful API 设计

##### 3.6.1 REST 语义与资源建模

**效果**：能按 REST 约束设计 URL（名词复数、层级关系、HTTP 动词语义），能说出 Richardson 成熟度模型的三个级别。

##### 3.6.2 HATEOAS 与超媒体

**效果**：能用 Spring HATEOAS 在响应中嵌入相关资源链接，能解释 HATEOAS 在 REST 成熟度模型中的位置。

##### 3.6.3 API 版本控制

**效果**：能用 URL 路径（/v1/users）、请求头（X-API-Version）、媒体类型（Accept: application/vnd.app.v1+json）三种方式实现版本控制，能说出各自的优劣。

#### 3.7 文件上传与下载

##### 3.7.1 单文件与多文件上传

**效果**：能用 MultipartFile 实现文件上传，能配置大小限制、类型校验、存储路径。

##### 3.7.2 大文件流式处理

**效果**：能用 StreamingResponseBody 实现大文件下载不撑爆内存，能实现断点续传（Range 请求）。

##### 3.7.3 对象存储集成

**效果**：能用 AWS S3 SDK 或 MinIO 实现文件上传到对象存储，能生成预签名 URL 实现安全下载。

#### 3.8 WebFlux 响应式编程

##### 3.8.1 阻塞模型的瓶颈

**效果**：能画出 MVC「一请求一线程」和 WebFlux「事件驱动」的对比图，能说出阻塞模型在 IO 等待时浪费线程的根因。

##### 3.8.2 Reactor 核心类型

**效果**：能用 Mono / Flux 创建、组合、转换异步序列，能解释背压（backpressure）机制。

##### 3.8.3 WebFlux 注解模式与函数式模式

**效果**：能用 @RestController 写响应式接口，能用 RouterFunction + HandlerFunction 写函数式路由。

##### 3.8.4 MVC vs WebFlux 选型

**效果**：能从「团队熟悉度」「依赖是否阻塞」「并发量级」三个维度做选型决策，能说出「混用阻塞依赖会退化」的陷阱。

#### 3.9 实时通信：WebSocket 与 SSE

##### 3.9.1 WebSocket 与 STOMP

**效果**：能用 @EnableWebSocketMessageBroker 配置 STOMP 端点，能实现群聊广播和点对点消息。

##### 3.9.2 SSE（Server-Sent Events）

**效果**：能用 SseEmitter 或 Flux<ServerSentEvent> 实现服务端单向推送，能说出 SSE vs WebSocket 的选型依据。

---

### 第 04 章：数据访问与事务

> 定位：Spring 对数据层的抽象。覆盖 JDBC、MyBatis、JPA 三条路线，以及事务管理和数据库迁移。

#### 4.1 Spring 数据访问抽象

##### 4.1.1 独立使用 vs Spring 整合

**效果**：能对比独立使用 MyBatis 的 6 步模板代码和 Spring 整合后一个 @Autowired 的差异，能说出 Spring 消除了哪些样板代码。

##### 4.1.2 JdbcTemplate 基础

**效果**：能用 JdbcTemplate 完成 CRUD 操作，能用 NamedParameterJdbcTemplate 避免 SQL 注入，能解释 Spring 对 SQLException 的统一转换。

##### 4.1.3 数据源配置与连接池

**效果**：能配置 HikariCP 连接池的核心参数（maximum-pool-size / connection-timeout / max-lifetime），能说出参数调优的基本原则。

#### 4.2 MyBatis 集成

##### 4.2.1 Mapper 接口与 XML 映射

**效果**：能用 @Mapper + @Select / @Insert / @Update / @Delete 注解写 CRUD，能用 XML 映射文件写复杂 SQL。

##### 4.2.2 动态 SQL

**效果**：能用 <if> / <choose> / <foreach> / <where> / <set> 写动态 SQL，能解释 MyBatis 的 OGNL 表达式。

##### 4.2.3 MyBatis-Plus 增强

**效果**：能用 BaseMapper + QueryWrapper / LambdaQueryWrapper 实现零 SQL CRUD，能用分页插件实现物理分页。

##### 4.2.4 SqlSessionTemplate 与线程安全

**效果**：能解释 SqlSessionTemplate 为什么线程安全（代理模式 + 每次调用获取新 SqlSession），能说出 Spring 整合后一级缓存「失效」的原因。

##### 4.2.5 MyBatis 拦截器与插件

**效果**：能写一个 MyBatis Interceptor 实现 SQL 耗时日志，能解释 Interceptor 的四大拦截点（Executor / StatementHandler / ParameterHandler / ResultSetHandler）。

#### 4.3 Spring Data JPA

##### 4.3.1 实体定义与关联映射

**效果**：能用 @Entity / @Table / @Id / @GeneratedValue 定义实体，能用 @OneToMany / @ManyToOne / @ManyToMany 映射关联关系。

##### 4.3.2 Repository 接口

**效果**：能用 JpaRepository 的方法命名查询、@Query JPQL 查询、@Modifying 更新操作，能解释方法名解析规则。

##### 4.3.3 Specification 动态查询

**效果**：能用 Specification + Criteria API 实现多条件动态查询，能组合 and / or / like / between 条件。

##### 4.3.4 审计功能

**效果**：能用 @CreatedBy / @CreatedDate / @LastModifiedBy / @LastModifiedDate 实现自动审计字段填充。

#### 4.4 MyBatis vs JPA 选型

##### 4.4.1 两条路线的本质差异

**效果**：能说出 MyBatis 是「SQL 映射器」（手写 SQL）、JPA 是「对象关系映射」（自动生成 SQL），能解释这导致的灵活性 vs 开发效率差异。

##### 4.4.2 决策框架

**效果**：能从「团队 SQL 能力」「查询复杂度」「是否需要精细 SQL 调优」「项目规模」四个维度做选型，能给出「简单 CRUD 用 JPA、复杂查询用 MyBatis」的具体判断标准。

#### 4.5 事务管理

##### 4.5.1 @Transactional 基础

**效果**：能用 @Transactional(rollbackFor=Exception.class) 声明事务，能解释事务管理器（PlatformTransactionManager）的工作原理。

##### 4.5.2 传播行为

**效果**：能说出 REQUIRED / REQUIRES_NEW / NESTED 三种常用传播行为的区别，能用具体场景解释「嵌套事务的保存点」机制。

##### 4.5.3 隔离级别与并发问题

**效果**：能说出四种隔离级别分别解决了脏读/不可重复读/幻读中的哪些问题，能解释 MySQL 默认 REPEATABLE_READ 和 Oracle 默认 READ_COMMITTED 的差异。

##### 4.5.4 @Transactional 失效场景

**效果**：能识别方法非 public、自调用、异常被 catch、抛出非 RuntimeException 四种失效场景，能给出修复方案。

##### 4.5.5 编程式事务

**效果**：能用 TransactionTemplate 或 TransactionManager 手动控制事务边界，能说出编程式事务适用的场景（部分回滚、嵌套事务精细控制）。

#### 4.6 多数据源

##### 4.6.1 AbstractRoutingDataSource

**效果**：能用 AbstractRoutingDataSource + ThreadLocal 实现动态数据源切换，能用自定义 @DS 注解声明式切换。

##### 4.6.2 读写分离

**效果**：能用 AOP + 动态数据源实现读操作走从库、写操作走主库，能解释主从延迟导致的数据不一致问题。

##### 4.6.3 分库分表方案

**效果**：能说出 ShardingSphere-JDBC 的分库分表原理（客户端分片），能配置分片规则和广播表。

#### 4.7 数据库迁移

##### 4.7.1 Flyway

**效果**：能用 V{版本号}__{描述}.sql 命名规范管理 DDL 变更，能配置 baseline-on-migrate 处理已有数据库。

##### 4.7.2 Liquibase

**效果**：能用 changelog XML/YAML 管理 DDL 变更，能说出 Flyway（纯 SQL）vs Liquibase（声明式）的选型依据。

#### 4.8 响应式数据访问（R2DBC）

##### 4.8.1 非阻塞数据库访问

**效果**：能说出 JDBC 的阻塞模型如何抵消 WebFlux 的非阻塞优势，能解释 R2DBC 的事件驱动连接模型。

##### 4.8.2 Spring Data R2DBC 实战

**效果**：能用 ReactiveCrudRepository 完成 CRUD，能用 DatabaseClient 执行自定义 SQL，能说出 R2DBC 的限制（无 JPA 级联、无延迟加载）。

---

### 第 05 章：安全

> 定位：从认证到授权的完整安全链路。独立成章，不和 Spring Boot 混在一起。

#### 5.1 安全架构概览

##### 5.1.1 认证 vs 授权

**效果**：能用「认证=你是谁、授权=你能做什么」一句话区分两个概念，能说出 Spring Security 的 Filter Chain 架构。

##### 5.1.2 Spring Security 过滤器链

**效果**：能画出请求经过 SecurityFilterChain 的流程（UsernamePasswordAuthenticationFilter → ... → ExceptionTranslationFilter → FilterSecurityInterceptor），能解释每个核心 Filter 的职责。

##### 5.1.3 SecurityFilterChain 配置

**效果**：能用 HttpSecurity 配置 URL 权限规则、登录方式、登出、CSRF，能解释 authorizeHttpRequests vs authorizeRequests 的区别。

#### 5.2 身份认证

##### 5.2.1 表单登录

**效果**：能用 formLogin() 配置自定义登录页、成功/失败处理器，能用 UserDetailsService 加载用户信息。

##### 5.2.2 JWT 认证

**效果**：能用 JWT 实现无状态认证（签发 / 验证 / 刷新），能用 OncePerRequestFilter 实现 JWT 过滤器。

##### 5.2.3 OAuth 2.0 / OIDC

**效果**：能用 spring-security-oauth2-client 实现第三方登录（GitHub / Google），能说出 Authorization Code Grant 流程。

##### 5.2.4 认证方案选型

**效果**：能从「有状态 vs 无状态」「单体 vs 微服务」「内部系统 vs 开放平台」三个维度选型（Session / JWT / OAuth2）。

#### 5.3 授权模型

##### 5.3.1 RBAC 基于角色的访问控制

**效果**：能用 @PreAuthorize("hasRole('ADMIN')") 实现方法级权限控制，能设计用户-角色-权限三表模型。

##### 5.3.2 自定义权限评估

**效果**：能实现 PermissionEvaluator 接口做数据级权限控制（如「只能编辑自己创建的订单」）。

##### 5.3.3 ABAC 基于属性的访问控制

**效果**：能用 Spring EL 表达式实现基于请求参数、时间、IP 等属性的动态权限判断。

#### 5.4 数据安全

##### 5.4.1 密码加密

**效果**：能用 BCryptPasswordEncoder 存储密码，能说出为什么不能用 MD5/SHA 做密码哈希（无盐、无迭代）。

##### 5.4.2 敏感数据加密存储

**效果**：能用 Jasypt 或自定义 AttributeConverter 实现数据库字段加密，能管理加密密钥。

#### 5.5 安全最佳实践

##### 5.5.1 CSRF 防护

**效果**：能解释 CSRF 攻击原理，能配置 CookieCsrfTokenRepository 实现前后端分离的 CSRF 防护。

##### 5.5.2 CORS 跨域配置

**效果**：能用 CorsConfigurationSource 精细控制允许的源、方法、头，能解释 CORS preflight 请求。

##### 5.5.3 安全响应头

**效果**：能配置 Content-Security-Policy / X-Frame-Options / Strict-Transport-Security 等安全头，能解释每个头防御的攻击类型。

---

### 第 06 章：可观测性

> 定位：从 Actuator 拆出来的独立章节，覆盖日志、指标、链路追踪三大支柱。

#### 6.1 日志体系

##### 6.1.1 SLF4J + Logback 配置

**效果**：能配置 logback-spring.xml 实现按级别分文件、按日期滚动、异步写入，能解释 SLF4J 门面模式。

##### 6.1.2 结构化日志（JSON 格式）

**效果**：能用 LogstashEncoder 输出 JSON 格式日志，能嵌入 traceId / userId 等业务字段，便于 ELK 解析。

##### 6.1.3 MDC 与日志上下文

**效果**：能用 MDC 在请求链路中传递 traceId / userId / requestId，能解释 MDC 基于 ThreadLocal 的原理和异步场景下的丢失问题。

#### 6.2 指标监控

##### 6.2.1 Micrometer 核心概念

**效果**：能说出 Meter / Tag / MeterRegistry 三个核心概念，能解释 Micrometer 作为「指标领域的 SLF4J」的门面作用。

##### 6.2.2 自定义业务指标

**效果**：能用 Counter / Timer / Gauge / DistributionSummary 注册自定义业务指标（如订单创建数、支付耗时、队列积压量）。

##### 6.2.3 Prometheus + Grafana 集成

**效果**：能配置 /actuator/prometheus 端点暴露指标，能用 PromQL 查询指标，能搭建 Grafana Dashboard。

#### 6.3 链路追踪

##### 6.3.1 分布式追踪原理

**效果**：能解释 Trace / Span / Context Propagation 三个核心概念，能画出一个跨服务请求的 Span 树。

##### 6.3.2 Micrometer Tracing + Zipkin

**效果**：能用 spring-boot-starter-actuator + micrometer-tracing-bridge-brave 集成 Zipkin，能配置采样率和上报地址。

##### 6.3.3 日志-指标-追踪三者关联

**效果**：能用 traceId 把日志、指标、链路追踪关联起来，能说清楚「从告警到定位根因」的排查路径。

#### 6.4 生产问题排查

##### 6.4.1 线上 CPU 飙高排查

**效果**：能用 jstack + top -Hp + arthas 定位 CPU 飙高的线程和代码位置。

##### 6.4.2 内存泄漏排查

**效果**：能用 jmap + MAT 分析堆内存，能识别常见的内存泄漏场景（ThreadLocal 未清理、静态集合无限增长、连接未关闭）。

##### 6.4.3 接口慢查询排查

**效果**：能用链路追踪定位慢 Span，能结合数据库慢查询日志和连接池监控找到瓶颈。

---

### 第 07 章：异步与消息

> 定位：从 Advanced 拆出的「非同步处理」专题，覆盖事件、异步、定时、缓存、消息五个相关主题。

#### 7.1 Spring 事件机制

##### 7.1.1 自定义事件与监听

**效果**：能用 ApplicationEvent + @EventListener 实现发布-订阅模式，能解释同步事件和 @Async 异步事件的区别。

##### 7.1.2 事件的事务边界

**效果**：能用 @TransactionalEventListener(phase=AFTER_COMMIT) 实现「事务提交后才发事件」，能解释 BEFORE_COMMIT / AFTER_COMMIT / AFTER_ROLLBACK 的区别。

##### 7.1.3 事件 vs 消息队列选型

**效果**：能说出事件（进程内、同步/异步、无持久化）和消息队列（跨进程、异步、持久化）的适用边界。

#### 7.2 异步处理

##### 7.2.1 @Async 基础

**效果**：能用 @Async + 自定义线程池实现方法异步执行，能解释为什么不能用默认的 SimpleAsyncTaskExecutor。

##### 7.2.2 线程池调优

**效果**：能配置 ThreadPoolTaskExecutor 的核心参数（corePoolSize / maxPoolSize / queueCapacity / rejectedHandler），能说出每个参数对吞吐量和响应时间的影响。

##### 7.2.3 异步异常处理

**效果**：能用 AsyncUncaughtExceptionHandler 处理 void 返回值的异步方法异常，能用 CompletableFuture 的 exceptionally 处理有返回值的异步方法。

##### 7.2.4 @Async 失效场景

**效果**：能识别自调用、非 public 方法、未启用 @EnableAsync 三种失效场景。

#### 7.3 定时任务

##### 7.3.1 @Scheduled 基础

**效果**：能用 fixedRate / fixedDelay / cron 三种方式配置定时任务，能解释 fixedRate 和 fixedDelay 的区别。

##### 7.3.2 Cron 表达式

**效果**：能写常用 cron 表达式（每天凌晨2点、每小时、工作日9点），能解释 Spring cron 和 Linux cron 的差异（Spring 有秒和星期字段）。

##### 7.3.3 线程池与并发控制

**效果**：能配置 SchedulingConfigurer 自定义定时任务线程池，能解释默认单线程池导致的任务阻塞问题。

##### 7.3.4 Quartz 动态定时任务

**效果**：能用 Quartz 实现运行时动态创建/暂停/恢复定时任务，能配置集群模式实现分布式调度。

#### 7.4 缓存抽象

##### 7.4.1 @Cacheable / @CacheEvict / @CachePut

**效果**：能用注解声明缓存策略，能解释三个注解的触发时机和区别。

##### 7.4.2 缓存管理器与 Redis 集成

**效果**：能用 RedisCacheManager 配置 Redis 作为缓存后端，能配置过期策略和序列化方式。

##### 7.4.3 缓存穿透/击穿/雪崩

**效果**：能解释缓存穿透（查不存在的数据）、击穿（热点 key 过期）、雪崩（大量 key 同时过期）的原理和防护方案。

##### 7.4.4 自定义缓存 Key 生成策略

**效果**：能用 SpEL 表达式自定义 Key，能实现 KeyGenerator 接口处理复杂场景。

#### 7.5 消息集成

##### 7.5.1 Kafka 集成

**效果**：能用 KafkaTemplate 发送消息、@KafkaListener 消费消息，能配置分区策略和消费者组。

##### 7.5.2 RabbitMQ 集成

**效果**：能用 RabbitTemplate + @RabbitListener 实现消息发送和消费，能配置死信队列和延迟消息。

##### 7.5.3 消息可靠性保证

**效果**：能说出「生产者确认 → 持久化 → 消费者手动 ACK → 幂等消费」的全链路可靠性保证方案。

---

### 第 08 章：测试

> 定位：从「会写测试」到「会设计测试策略」。大幅扩充，覆盖单元测试、集成测试、契约测试。

#### 8.1 测试策略

##### 8.1.1 测试金字塔

**效果**：能画出测试金字塔（单元 → 集成 → E2E），能说出每层的占比、速度、成本和覆盖范围。

##### 8.1.2 测试什么、不测什么

**效果**：能识别哪些代码值得测（业务逻辑、边界条件、异常路径）、哪些不值得测（getter/setter、框架代码、纯配置）。

##### 8.1.3 Mock vs Stub vs Spy

**效果**：能区分 Mock（验证交互）、Stub（返回预设值）、Spy（包装真实对象），能根据场景选择合适的替身。

#### 8.2 单元测试

##### 8.2.1 JUnit 5 核心

**效果**：能用 @Test / @BeforeEach / @AfterEach / @ParameterizedTest 写测试，能用 @DisplayName 提高可读性。

##### 8.2.2 Mockito 实战

**效果**：能用 when().thenReturn() / verify() / @Mock / @InjectMocks 写 Mock 测试，能解释 Mockito 的两种 Mock 模式（默认返回 null/0 vs RETURNS_DEEP_STUBS）。

##### 8.2.3 测试 Service 层

**效果**：能为一个 Service 类设计完整的测试用例：正常路径、边界条件、异常路径、依赖交互验证。

#### 8.3 集成测试

##### 8.3.1 @SpringBootTest 配置

**效果**：能用 @SpringBootTest(webEnvironment=RANDOM_PORT) 启动完整容器，能用 @AutoConfigureMockMvc 测试 Controller。

##### 8.3.2 MockMvc 实战

**效果**：能用 MockMvc.perform() 测试 GET/POST/PUT/DELETE 请求，能验证状态码、响应体、Header。

##### 8.3.3 测试切片

**效果**：能用 @WebMvcTest / @DataJpaTest / @JsonTest 只加载需要的组件，能解释测试切片如何加速测试执行。

#### 8.4 数据库测试

##### 8.4.1 @DataJpaTest 与嵌入式数据库

**效果**：能用 @DataJpaTest + H2 测试 Repository 层，能配置 @Sql 初始化测试数据。

##### 8.4.2 Testcontainers

**效果**：能用 Testcontainers 启动真实 MySQL/Redis 容器做集成测试，能解决 H2 方言差异导致的测试失真问题。

##### 8.4.3 测试数据管理

**效果**：能用 @Transactional + @Rollback 实现测试数据自动清理，能用 @Sql / @SqlGroup 管理复杂测试数据。

#### 8.5 契约测试与 API 测试

##### 8.5.1 REST Assured

**效果**：能用 REST Assured 写可读性高的 API 测试，能验证 JSON Schema、响应时间、Header。

##### 8.5.2 Spring Cloud Contract（概览）

**效果**：能说出消费者驱动契约测试（CDC）的核心思想，能解释它如何解决微服务间的接口兼容性问题。

---

### 第 09 章：分布式系统

> 定位：从 Advanced 和 Microservices 重组的分布式专题。聚焦 Spring 生态下的分布式问题解法。

#### 9.1 分布式锁

##### 9.1.1 分布式锁三要素

**效果**：能说出互斥、防死锁、可重入三个要素，能解释为什么单机锁在集群下无效。

##### 9.1.2 Redis 分布式锁（Redisson）

**效果**：能用 RedissonClient.getLock() 实现分布式锁，能解释 Lua 脚本保证原子性的原理。

##### 9.1.3 ZooKeeper 分布式锁

**效果**：能用 Curator 的 InterProcessMutex 实现分布式锁，能对比 Redis（高性能）和 ZooKeeper（强一致性）的选型。

#### 9.2 分布式事务

##### 9.2.1 CAP 与 BASE 理论

**效果**：能解释 CAP 三选二的约束，能说出 BASE（基本可用、软状态、最终一致性）是对 CAP 的工程妥协。

##### 9.2.2 Seata AT 模式

**效果**：能解释 Seata AT 模式的「一阶段提交 + 二阶段回滚」原理，能说出全局锁的作用。

##### 9.2.3 SAGA 模式

**效果**：能解释 SAGA 的「正向操作 + 补偿操作」模式，能对比 SAGA 和 2PC 的优劣。

##### 9.2.4 最终一致性方案

**效果**：能用 RocketMQ 事务消息实现最终一致性，能解释「本地消息表 + 消息队列」的可靠事件模式。

#### 9.3 服务调用

##### 9.3.1 OpenFeign 声明式调用

**效果**：能用 @FeignClient 声明远程接口，能配置 FallbackFactory 实现降级。

##### 9.3.2 WebClient 响应式调用

**效果**：能用 WebClient 调用外部 API，能处理超时、重试、错误，能对比 RestTemplate / Feign / WebClient 三种方案。

#### 9.4 服务容错

##### 9.4.1 熔断器（Circuit Breaker）

**效果**：能用 Resilience4j 的 @CircuitBreaker 实现熔断，能说出 CLOSED → OPEN → HALF_OPEN 三种状态的转换条件。

##### 9.4.2 限流与降级

**效果**：能用 @RateLimiter / @Bulkhead 实现限流和舱壁隔离，能配置 fallback 方法实现优雅降级。

##### 9.4.3 重试与超时

**效果**：能用 @Retry 配置指数退避重试，能用 @TimeLimiter 配置超时控制，能解释重试风暴的风险。

#### 9.5 配置中心

##### 9.5.1 Nacos Config

**效果**：能用 Nacos 集中管理配置，能用 @RefreshScope 实现配置热更新。

##### 9.5.2 配置版本管理与灰度发布

**效果**：能用 Nacos 的配置版本回滚和灰度发布功能，能说出配置变更的风险控制策略。

#### 9.6 API 网关

##### 9.6.1 Spring Cloud Gateway

**效果**：能用 Route + Predicate + Filter 三元组配置路由规则，能实现路径重写和负载均衡。

##### 9.6.2 网关过滤器

**效果**：能写 GlobalFilter 实现认证校验、请求日志、限流，能解释 Gateway Filter 的执行顺序。

---

### 第 10 章：生产化与部署

> 定位：从 Boot 拆出的「上线最后一公里」，覆盖性能调优、容器化、原生镜像。

#### 10.1 连接池与容器调优

##### 10.1.1 HikariCP 参数调优

**效果**：能根据并发量和数据库承受能力计算 maximum-pool-size，能配置 connection-timeout / max-lifetime 避免连接泄漏。

##### 10.1.2 Tomcat 线程池调优

**效果**：能配置 server.tomcat.threads.max / min-spare / accept-count，能说出线程池大小和连接池大小的配合原则。

##### 10.1.3 JVM 参数调优

**效果**：能配置堆大小（-Xmx）、GC 策略（G1/ZGC）、元空间大小，能用 GC 日志分析内存行为。

#### 10.2 容器化部署

##### 10.2.1 分层 Dockerfile

**效果**：能写一个利用 Spring Boot 分层机制的 Dockerfile（依赖层 / 资源层 / 代码层），能解释分层如何减少镜像传输量。

##### 10.2.2 Docker Compose 编排

**效果**：能用 Docker Compose 编排应用 + MySQL + Redis + RabbitMQ，能配置健康检查和启动顺序依赖。

#### 10.3 GraalVM 原生镜像

##### 10.3.1 AOT 处理原理

**效果**：能解释 Spring AOT 如何在编译时生成 Bean 定义、反射配置、代理类，能说出 AOT 和 JIT 的根本区别。

##### 10.3.2 Native 编译实战

**效果**：能用 native-maven-plugin 编译原生镜像，能解决常见的反射/资源/代理兼容性问题。

##### 10.3.3 原生镜像 vs JVM 模式

**效果**：能从启动时间、内存占用、峰值吞吐量、构建时间四个维度对比原生镜像和 JVM 模式，能说出各自的适用场景。

#### 10.4 CI/CD 流水线

##### 10.4.1 GitHub Actions 自动化

**效果**：能配置 GitHub Actions 实现 push → 测试 → 构建 → 推送镜像 → 部署的完整流水线。

##### 10.4.2 蓝绿部署与滚动更新

**效果**：能说出蓝绿部署（两套环境切换）和滚动更新（逐步替换实例）的区别，能用 Kubernetes 配置滚动更新策略。

---

## 五、与原大纲的映射关系

| 原版章节 | 优化后归属 | 变化说明 |
|:--|:--|:--|
| 01-core 全部 | 01-core | 保留，微调措辞 |
| 02-web 全部 | 03-web | 补 REST 设计、全局异常、内容协商 |
| 03-data-access 全部 | 04-data-access | 补 MyBatis 深入、事务实战、选型对比 |
| 04-spring-boot/autoconfiguration | 02-spring-boot | 前移 |
| 04-spring-boot/starter | 02-spring-boot | 前移 |
| 04-spring-boot/configuration | 02-spring-boot | 前移 |
| 04-spring-boot/actuator | 02-spring-boot + 06-observability | 拆分，基础留 Boot，深入移到可观测性 |
| 04-spring-boot/devtools | 02-spring-boot | 前移 |
| 04-spring-boot/api-doc | 02-spring-boot | 前移 |
| 04-spring-boot/startup | 02-spring-boot | 前移 |
| 04-spring-boot/production-tuning | 10-production | 拆出 |
| 04-spring-boot/build-deploy | 10-production | 拆出，补 Docker/GraalVM |
| 05-security 全部 | 05-security | 补 OAuth2、数据安全 |
| 06-advanced/event | 07-async-and-messaging | 重组 |
| 06-advanced/async | 07-async-and-messaging | 重组 |
| 06-advanced/scheduling | 07-async-and-messaging | 重组 |
| 06-advanced/caching | 07-async-and-messaging | 重组 |
| 06-advanced/messaging | 07-async-and-messaging | 重组 |
| 06-advanced/i18n | ❌ 删除 | 内容太浅，不单独成章 |
| 06-advanced/distributed-lock | 09-distributed | 重组 |
| 06-advanced/quartz | 07-async-and-messaging | 合并到定时任务 |
| 06-advanced/mail | ❌ 删除 | 内容太浅，适合放到 Cookbook 而非专题 |
| 06-advanced/spring-batch | ❌ 删除 | 够独立成专题，不适合塞在 Advanced 里 |
| 07-microservices/microservice-pattern | 09-distributed | 重组 |
| 07-microservices/service-discovery | 09-distributed | 拆散到配置中心、服务调用 |
| 07-microservices/api-gateway | 09-distributed | 重组 |
| 07-microservices/load-balancing | 09-distributed/服务调用 | 合并 |
| 07-microservices/circuit-breaker | 09-distributed/服务容错 | 合并 |
| 07-microservices/config-center | 09-distributed | 重组 |
| 07-microservices/distributed-transaction | 09-distributed | 重组 |
| 08-testing 全部 | 08-testing | 大幅扩充 |

---

## 六、删除的章节与理由

| 删除章节 | 理由 |
|:--|:--|
| 06-advanced/i18n | 只有配置文件示例，没有深度，适合速查手册不适合专题 |
| 06-advanced/mail | 同上，Spring Mail 的用法 3 页就够，不值得 200 行 |
| 06-advanced/spring-batch | 内容足够独立成专题（Job / Step / Reader / Processor / Writer / 跳过与重试），塞在 Advanced 里既放不下又挤占篇幅 |
