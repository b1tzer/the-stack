# 第4章 Spring Boot

> Spring Boot 的诞生回答了一个核心问题：**如何让 Spring 应用从"能跑"到"开箱即用"？** 本章将剖析 Spring Boot 如何通过自动配置、Starter 机制和统一配置体系，将开发者从繁琐的 XML 配置和依赖管理中解放出来，真正实现"约定优于配置"的理念。

## 4.1 为什么需要 Spring Boot

### 4.1.1 传统 Spring 开发的痛点

在 Spring Boot 出现之前，搭建一个 Spring Web 项目需要经历一条漫长而痛苦的路径。让我们先回顾这段"黑暗岁月"：

**第一步：手写 web.xml**

```xml
<!-- web.xml - 配置 DispatcherServlet -->
<servlet>
    <servlet-name>dispatcher</servlet-name>
    <servlet-class>
        org.springframework.web.servlet.DispatcherServlet
    </servlet-class>
    <init-param>
        <param-name>contextConfigLocation</param-name>
        <param-value>/WEB-INF/spring-mvc.xml</param-value>
    </init-param>
    <load-on-startup>1</load-on-startup>
</servlet>
<servlet-mapping>
    <servlet-name>dispatcher</servlet-name>
    <url-pattern>/</url-pattern>
</servlet-mapping>
```

**第二步：手写 Spring MVC 配置**

```xml
<!-- spring-mvc.xml -->
<context:component-scan base-package="com.example.controller"/>
<mvc:annotation-driven/>
<bean class="org.springframework.web.servlet.view.InternalResourceViewResolver">
    <property name="prefix" value="/WEB-INF/views/"/>
    <property name="suffix" value=".jsp"/>
</bean>
```

**第三步：手写数据源配置**

```xml
<!-- applicationContext.xml -->
<bean id="dataSource" class="com.zaxxer.hikari.HikariDataSource">
    <property name="driverClassName" value="com.mysql.cj.jdbc.Driver"/>
    <property name="jdbcUrl" value="jdbc:mysql://localhost:3306/mydb"/>
    <property name="username" value="root"/>
    <property name="password" value="123456"/>
</bean>
<bean id="sqlSessionFactory" class="org.mybatis.spring.SqlSessionFactoryBean">
    <property name="dataSource" ref="dataSource"/>
    <property name="mapperLocations" value="classpath:mapper/*.xml"/>
</bean>
```

**第四步：手动管理 Tomcat**

将打好的 WAR 包复制到 Tomcat 的 `webapps` 目录下，启动 Tomcat，祈祷没有 ClassNotFound 或版本冲突。

### 4.1.2 三大痛点的对比

| 痛点 | 传统 Spring | Spring Boot |
|------|-------------|-------------|
| **配置方式** | 大量 XML 配置文件 | 零 XML，纯注解 + 自动配置 |
| **依赖管理** | 手动添加每个 JAR，处理版本冲突 | Starter 一站式引入，版本仲裁 |
| **Web 容器** | 外部安装 Tomcat，手动部署 WAR | 内嵌 Tomcat/Jetty，直接运行 JAR |
| **项目结构** | 需要遵循 Servlet 规范目录 | 约定目录结构，`main()` 启动 |
| **开发效率** | 搭建脚手架可能花费半天 | Spring Initializr 几秒钟生成 |

### 4.1.3 Spring Boot 的设计哲学

Spring Boot 并非一个全新的框架，而是 **Spring 的"脚手架"**。它的核心设计原则是：

1. **约定优于配置（Convention over Configuration）**：提供合理的默认值，开发者只需覆盖差异部分
2. **开箱即用（Out of the Box）**：内嵌容器、自动配置、生产级监控，一行代码不写就能跑
3. **非侵入式（Unobtrusive）**：不强制使用特定 API，随时可以回退到原生 Spring

```java
// 最简单的 Spring Boot 应用 - 这就是一个完整的 Web 服务器
@SpringBootApplication
public class MyApplication {
    public static void main(String[] args) {
        SpringApplication.run(MyApplication.class, args);
    }
}
```

运行这段代码，一个内嵌 Tomcat 就启动了，默认监听 8080 端口。没有 XML，没有 WAR 部署，没有外部 Tomcat。

## 4.2 自动配置原理

### 4.2.1 注解分类全景

开始拆 `@SpringBootApplication` 之前，先把 Spring Boot 的注解按职责归一次类。这一层分类能帮你回答两个问题：看到一个陌生注解时该往哪一类放，以及配置不生效时该从哪一类开始排查。

| 类别 | 代表注解 | 职责 | 最容易踩的坑 |
| :-- | :-- | :-- | :-- |
| **启动注解** | `@SpringBootApplication` | 标记启动类，同时开启扫描与自动配置 | 启动类没放在最外层包，导致部分组件扫不到 |
| **配置注解** | `@Configuration`、`@Bean`、`@Import`、`@PropertySource` | 声明 Bean 与配置来源 | `@Configuration` 里的 `@Bean` 方法互调走 CGLIB 代理，`@Component` 里则不走 |
| **条件注解** | `@Conditional`、`@ConditionalOnClass`、`@ConditionalOnMissingBean`、`@Profile` | 决定 Bean 是否注册 | 条件只在启动时评估一次，改配置不会热生效 |
| **属性绑定注解** | `@Value`、`@ConfigurationProperties`、`@EnableConfigurationProperties` | 把配置值注入字段 | `@Value` 无类型安全，嵌套对象用 `@ConfigurationProperties` |

四类是一条流水线：启动注解是入口，配置注解声明"容器里有什么"，条件注解决定"这个 Bean 要不要进容器"，属性绑定注解解决"Bean 里的值从哪来"。前两类回答"是什么"，后两类回答"何时、何值"。

### 4.2.2 @SpringBootApplication 拆解

`@SpringBootApplication` 看起来是一个注解，实际上是三个注解的组合：

```java
@Target(ElementType.TYPE)
@Retention(RetentionPolicy.RUNTIME)
@SpringBootConfiguration      // 标记这是一个配置类（本质是 @Configuration）
@EnableAutoConfiguration      // 核心：启用自动配置
@ComponentScan                // 扫描当前包及子包的组件
public @interface SpringBootApplication { ... }
```

自动配置的魔法集中在 `@EnableAutoConfiguration` 上。

### 4.2.3 自动配置的加载流程

Spring Boot 2.7+ 使用新的加载机制，整个流程如下：

```text
启动 SpringApplication
    │
    ▼
读取 META-INF/spring/org.springframework.boot.autoconfigure.AutoConfiguration.imports
    │
    ▼
获取所有候选自动配置类（可能有上百个）
    │
    ▼
逐个检查 @Conditional 条件
    │
    ├── 条件满足 → 注册对应的 Bean
    │
    └── 条件不满足 → 跳过，不注册
```

以 `DataSourceAutoConfiguration` 为例，看看条件注解如何工作：

```java
@AutoConfiguration(before = SqlSessionFactoryAutoConfiguration.class)
@ConditionalOnClass(DataSource.class)              // classpath 有 DataSource 类才生效
@ConditionalOnSingleCandidate(DataSource.class)    // 容器中只有一个 DataSource 才生效
@EnableConfigurationProperties(DataSourceProperties.class)
public class DataSourceAutoConfiguration {

    @Configuration(proxyBeanMethods = false)
    @ConditionalOnMissingBean(DataSource.class)    // 容器中没有 DataSource 才创建
    protected static class EmbeddedDatabaseConfiguration {
        // 自动配置内嵌数据库（H2/Derby）
    }

    @Configuration(proxyBeanMethods = false)
    @ConditionalOnMissingBean(DataSource.class)    // 容器中没有 DataSource 才创建
    @ConditionalOnProperty(prefix = "spring.datasource",
                           name = "url")           // 配置了 url 属性才生效
    protected static class PooledDataSourceConfiguration {
        // 自动配置连接池（HikariCP）
    }
}
```

### 4.2.4 条件注解家族

Spring Boot 提供了一整套 `@Conditional` 注解，构成自动配置的"开关系统"：

| 注解 | 作用 | 典型场景 |
|------|------|----------|
| `@ConditionalOnClass` | classpath 存在指定类 | 引入了 Jackson 才配置 JSON 序列化 |
| `@ConditionalOnMissingBean` | 容器中没有指定 Bean | 用户未自定义数据源才用默认的 |
| `@ConditionalOnProperty` | 配置文件中存在指定属性 | 配置了 `spring.redis.host` 才启用 Redis |
| `@ConditionalOnWebApplication` | 当前是 Web 应用 | MVC 配置只在 Web 环境生效 |
| `@ConditionalOnResource` | classpath 存在指定资源 | 有 `logback.xml` 才使用自定义日志 |
| `@ConditionalOnExpression` | SpEL 表达式为 true | 复杂条件组合 |

### 4.2.5 自动配置的核心流程图

![springboot-startup](/spring/springboot-startup.svg)

关键理解：**自动配置是"兜底"而非"强制"**。当开发者自己注册了同类型的 Bean 时，`@ConditionalOnMissingBean` 确保自动配置会"让路"。这就是"用户定义优先"原则。

## 4.3 Starter 机制

### 4.3.1 什么是 Starter

一个 Starter 是 **"依赖集合 + 自动配置类"** 的打包方案。它解决的核心问题是：**引入一个功能需要哪些 JAR？它们的版本是否兼容？**

| Starter | 引入的核心依赖 | 自动配置的内容 |
|---------|---------------|---------------|
| `spring-boot-starter-web` | Spring MVC + 内嵌 Tomcat + Jackson | DispatcherServlet、JSON 序列化、错误页面 |
| `spring-boot-starter-data-redis` | Spring Data Redis + Lettuce | RedisTemplate、连接池 |
| `spring-boot-starter-security` | Spring Security | 认证过滤器链、默认登录页 |
| `spring-boot-starter-actuator` | Micrometer + Metrics | 健康检查、指标采集端点 |
| `spring-boot-starter-test` | JUnit 5 + Mockito + AssertJ | 测试上下文、Mock 支持 |

### 4.3.2 spring-boot-starter-web 拆解

让我们看看最常用的 `spring-boot-starter-web` 到底引入了什么：

```xml
<!-- spring-boot-starter-web 的 pom.xml 简化版 -->
<dependencies>
    <!-- Spring MVC -->
    <dependency>
        <groupId>org.springframework</groupId>
        <artifactId>spring-webmvc</artifactId>
    </dependency>
    <!-- 内嵌 Tomcat -->
    <dependency>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-starter-tomcat</artifactId>
    </dependency>
    <!-- Jackson JSON 处理 -->
    <dependency>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-starter-json</artifactId>
    </dependency>
    <!-- 核心启动器 -->
    <dependency>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-starter</artifactId>
    </dependency>
</dependencies>
```

只需在 `pom.xml` 中添加一个依赖：

```xml
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-web</artifactId>
</dependency>
```

Spring Boot 就会自动：
1. 配置 `DispatcherServlet` 并映射到 `/`
2. 内嵌 Tomcat 并监听 8080 端口
3. 配置 Jackson 进行 JSON 序列化/反序列化
4. 注册 `HttpMessageConverter`、`ExceptionHandler` 等基础设施

### 4.3.3 Starter 的类型

```text
spring-boot-starter-*
│
├── 官方 Starter（由 Spring 团队维护）
│   ├── spring-boot-starter-web
│   ├── spring-boot-starter-data-jpa
│   ├── spring-boot-starter-security
│   └── spring-boot-starter-actuator
│
├── 第三方 Starter（由社区维护）
│   ├── mybatis-spring-boot-starter
│   ├── druid-spring-boot-starter
│   └── knife4j-openapi3-spring-boot-starter
│
└── 自定义 Starter（开发者自己创建）
    └── 企业内部组件封装
```

**命名约定**：
- 官方 Starter：`spring-boot-starter-{功能名}`
- 第三方 Starter：`{框架名}-spring-boot-starter`

### 4.3.4 自定义 Starter 的结构

创建一个自定义 Starter 需要两个模块：

```text
my-spring-boot-starter（Starter 模块 - 纯依赖聚合）
└── pom.xml
        └── 引入 my-spring-boot-autoconfigure

my-spring-boot-autoconfigure（自动配置模块 - 核心逻辑）
├── pom.xml
├── src/main/java/
│   └── com/example/autoconfigure/
│       ├── MyService.java                 // 自动注册的 Bean
│       └── MyServiceAutoConfiguration.java // 自动配置类
└── src/main/resources/
    └── META-INF/spring/
        └── org.springframework.boot.autoconfigure.AutoConfiguration.imports
```

自动配置类示例：

```java
@AutoConfiguration
@ConditionalOnClass(MyService.class)              // 有 MyService 类才生效
@EnableConfigurationProperties(MyServiceProperties.class)
public class MyServiceAutoConfiguration {

    @Bean
    @ConditionalOnMissingBean                      // 用户没自定义才用默认的
    public MyService myService(MyServiceProperties properties) {
        MyService service = new MyService();
        service.setTimeout(properties.getTimeout());
        service.setRetries(properties.getRetries());
        return service;
    }
}
```

注册到 `AutoConfiguration.imports`：

```text
# META-INF/spring/org.springframework.boot.autoconfigure.AutoConfiguration.imports
com.example.autoconfigure.MyServiceAutoConfiguration
```

使用时只需一行依赖：

```xml
<dependency>
    <groupId>com.example</groupId>
    <artifactId>my-spring-boot-starter</artifactId>
    <version>1.0.0</version>
</dependency>
```

## 4.4 配置体系

### 4.4.1 配置文件的加载顺序

Spring Boot 支持多种配置源，按优先级从高到低排列：

```text
优先级（高 → 低）
│
├── 1. 命令行参数        --server.port=9090
├── 2. 系统环境变量       SERVER_PORT=9090
├── 3. application-{profile}.yml  （激活的 profile）
├── 4. application.yml           （主配置文件）
├── 5. @PropertySource 注解
└── 6. 默认值
```

高优先级的配置会覆盖低优先级的同名配置，这使得不同环境的差异配置变得简单。

### 4.4.2 application.yml 最佳实践

```yaml
# application.yml - 所有环境共享的配置
server:
  port: 8080
  servlet:
    context-path: /api

spring:
  application:
    name: user-service
  jackson:
    date-format: yyyy-MM-dd HH:mm:ss
    time-zone: Asia/Shanghai

# 自定义业务配置
myapp:
  jwt:
    secret: ${JWT_SECRET:defaultSecretForDev}
    expiration: 86400000
  upload:
    max-size: 10MB
    allowed-types: jpg,png,pdf
```

### 4.4.3 @ConfigurationProperties 类型安全绑定

相比 `@Value("${myapp.jwt.secret}")`，`@ConfigurationProperties` 提供了类型安全的绑定方式：

```java
@ConfigurationProperties(prefix = "myapp.jwt")
public class JwtProperties {

    /**
     * JWT 签名密钥
     */
    private String secret = "defaultSecret";

    /**
     * Token 过期时间（毫秒）
     */
    private long expiration = 86400000L;

    // getter/setter 省略
}
```

在配置类中启用：

```java
@Configuration
@EnableConfigurationProperties(JwtProperties.class)
public class AppConfig {
    // JwtProperties 会自动绑定 myapp.jwt.* 前缀的配置
}
```

**@Value 与 @ConfigurationProperties 对比**：

| 特性 | @Value | @ConfigurationProperties |
|------|--------|-------------------------|
| 松散绑定 | ❌ 仅精确匹配 | ✅ 支持 kebab-case / camelCase |
| SpEL 表达式 | ✅ 支持 `#{}` | ❌ 不支持 |
| 类型安全 | ❌ 运行时转换 | ✅ 编译期检查 |
| JSR-303 校验 | ❌ 不支持 | ✅ 支持 `@Validated` |
| 复杂类型 | ❌ 不适合嵌套对象 | ✅ 支持 List/Map/嵌套对象 |
| IDE 提示 | ❌ 无 | ✅ 配置元数据自动生成提示 |

复杂类型的绑定示例：

```java
@ConfigurationProperties(prefix = "myapp")
@Validated
public class MyAppProperties {

    @NotBlank
    private String appName;

    @Min(1)
    @Max(100)
    private int maxRetries = 3;

    private List<String> allowedOrigins = new ArrayList<>();

    private Map<String, DataSourceConfig> datasources = new HashMap<>();

    // 内部类
    public static class DataSourceConfig {
        private String url;
        private String username;
        private String password;
        // getter/setter
    }
    // getter/setter
}
```

对应的 YAML 配置：

```yaml
myapp:
  app-name: user-service
  max-retries: 5
  allowed-origins:
    - https://www.example.com
    - https://admin.example.com
  datasources:
    master:
      url: jdbc:mysql://master:3306/mydb
      username: root
      password: master123
    slave:
      url: jdbc:mysql://slave:3306/mydb
      username: readonly
      password: slave123
```

### 4.4.4 Profile 多环境配置

Profile 是 Spring Boot 实现多环境隔离的核心机制：

```text
src/main/resources/
├── application.yml              # 公共配置
├── application-dev.yml          # 开发环境
├── application-test.yml         # 测试环境
└── application-prod.yml         # 生产环境
```

**激活方式**（按优先级）：

```bash
# 方式1：命令行参数（最高优先级）
java -jar app.jar --spring.profiles.active=prod

# 方式2：环境变量
export SPRING_PROFILES_ACTIVE=prod

# 方式3：配置文件内指定
# application.yml
spring:
  profiles:
    active: dev
```

**Profile 专属配置示例**：

```yaml
# application-dev.yml
spring:
  datasource:
    url: jdbc:mysql://localhost:3306/dev_db
    username: dev
    password: dev123
  jpa:
    show-sql: true
    hibernate:
      ddl-auto: update

logging:
  level:
    root: DEBUG
    com.example: DEBUG
```

```yaml
# application-prod.yml
spring:
  datasource:
    url: jdbc:mysql://prod-db:3306/prod_db
    username: ${DB_USER}
    password: ${DB_PASSWORD}
  jpa:
    show-sql: false
    hibernate:
      ddl-auto: validate

logging:
  level:
    root: WARN
    com.example: INFO
```

**Profile 条件 Bean**：

```java
@Configuration
public class DataSourceConfig {

    @Bean
    @Profile("dev")
    public DataSource devDataSource() {
        // 开发环境使用 H2 内存数据库
        return new EmbeddedDatabaseBuilder()
            .setType(EmbeddedDatabaseType.H2)
            .addScript("schema.sql")
            .build();
    }

    @Bean
    @Profile("prod")
    public DataSource prodDataSource() {
        // 生产环境使用 HikariCP 连接池
        HikariDataSource ds = new HikariDataSource();
        ds.setJdbcUrl(env.getProperty("spring.datasource.url"));
        ds.setUsername(env.getProperty("spring.datasource.username"));
        ds.setPassword(env.getProperty("spring.datasource.password"));
        ds.setMaximumPoolSize(20);
        return ds;
    }
}
```

### 4.4.5 配置体系全景图

```text
┌─────────────────────────────────────────────────────────┐
│                    Spring Boot 配置体系                    │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ┌──────────────┐   ┌──────────────┐   ┌────────────┐  │
│  │  命令行参数    │   │  环境变量     │   │  配置文件   │  │
│  │  --key=value │   │  KEY=VALUE   │   │  .yml/.xml  │  │
│  └──────┬───────┘   └──────┬───────┘   └─────┬──────┘  │
│         │                  │                  │         │
│         └──────────┬───────┴──────────────────┘         │
│                    ▼                                    │
│         ┌─────────────────────┐                         │
│         │  Environment 对象    │                         │
│         │  (统一配置源)        │                         │
│         └─────────┬───────────┘                         │
│                   │                                     │
│         ┌─────────┴──────────┐                          │
│         ▼                    ▼                          │
│  ┌──────────────┐   ┌──────────────────────┐           │
│  │   @Value     │   │ @ConfigurationProperties │        │
│  │  逐个注入    │   │  批量绑定 + 类型安全      │       │
│  └──────────────┘   └──────────────────────┘           │
│                                                         │
│  Profile 过滤：application-{profile}.yml 只在激活时加载   │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

