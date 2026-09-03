# Spring Boot 与自动配置

> Spring Boot 的诞生回答了一个核心问题：**如何让 Spring 应用从"能跑"到"开箱即用"？** 自动配置是回答这个问题的核心机制。本章先讲清为什么需要 Spring Boot，再拆解自动配置的实现原理。Starter、配置体系、内嵌容器、启动流程等其余能力，分别见后续章节。

## 1. 为什么需要 Spring Boot

### 1.1 传统 Spring 开发的痛点

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

### 1.2 三大痛点的对比

| 痛点 | 传统 Spring | Spring Boot |
| :-- | :-- | :-- |
| **配置方式** | 大量 XML 配置文件 | 零 XML，纯注解 + 自动配置 |
| **依赖管理** | 手动添加每个 JAR，处理版本冲突 | Starter 一站式引入，版本仲裁 |
| **Web 容器** | 外部安装 Tomcat，手动部署 WAR | 内嵌 Tomcat/Jetty，直接运行 JAR |
| **项目结构** | 需要遵循 Servlet 规范目录 | 约定目录结构，`main()` 启动 |
| **开发效率** | 搭建脚手架可能花费半天 | Spring Initializr 几秒钟生成 |

### 1.3 Spring Boot 的设计哲学

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

## 2. 自动配置原理

### 2.1 注解分类全景

开始拆 `@SpringBootApplication` 之前，先把 Spring Boot 的注解按职责归一次类。这一层分类能帮你回答两个问题：看到一个陌生注解时该往哪一类放，以及配置不生效时该从哪一类开始排查。

| 类别 | 代表注解 | 职责 | 最容易踩的坑 |
| :-- | :-- | :-- | :-- |
| **启动注解** | `@SpringBootApplication` | 标记启动类，同时开启扫描与自动配置 | 启动类没放在最外层包，导致部分组件扫不到 |
| **配置注解** | `@Configuration`、`@Bean`、`@Import`、`@PropertySource` | 声明 Bean 与配置来源 | `@Configuration` 里的 `@Bean` 方法互调走 CGLIB 代理，`@Component` 里则不走 |
| **条件注解** | `@Conditional`、`@ConditionalOnClass`、`@ConditionalOnMissingBean`、`@Profile` | 决定 Bean 是否注册 | 条件只在启动时评估一次，改配置不会热生效 |
| **属性绑定注解** | `@Value`、`@ConfigurationProperties`、`@EnableConfigurationProperties` | 把配置值注入字段 | `@Value` 无类型安全，嵌套对象用 `@ConfigurationProperties` |

四类是一条流水线：启动注解是入口，配置注解声明"容器里有什么"，条件注解决定"这个 Bean 要不要进容器"，属性绑定注解解决"Bean 里的值从哪来"。前两类回答"是什么"，后两类回答"何时、何值"。

### 2.2 @SpringBootApplication 拆解

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

### 2.3 自动配置的加载流程

Spring Boot 2.7+ 使用新的加载机制，整个流程如下：

```txt
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

这段流程背后的执行者是 `AutoConfigurationImportSelector`。它实现了 `DeferredImportSelector`，在 `selectImports` 中调用 `getAutoConfigurationEntry()`，后者完成两件事：从 `AutoConfiguration.imports` 读出全部候选类名，再逐个套用 `@Conditional` 过滤。过滤不是一次性完成的——每个候选类先按 `@AutoConfigureOrder`、`@AutoConfigureBefore`、`@AutoConfigureAfter` 排好序，再进入条件评估，这样「先注册的 Bean」能成为「后注册 Bean」条件判断的依据。

以 `DataSourceAutoConfiguration` 为例，看看条件注解如何工作：

```java
@AutoConfiguration(before = SqlInitializationAutoConfiguration.class)
@ConditionalOnClass({ DataSource.class, EmbeddedDatabaseType.class })   // classpath 上有 DataSource 与嵌入式数据库枚举才生效
@ConditionalOnMissingBean(type = "io.r2dbc.spi.ConnectionFactory")      // 未启用 R2DBC 才生效（避免与 R2DBC 冲突）
@EnableConfigurationProperties(DataSourceProperties.class)
public class DataSourceAutoConfiguration {

    @Configuration(proxyBeanMethods = false)
    @Conditional(EmbeddedDatabaseCondition.class)                       // 未显式配置连接池，且 classpath 存在 H2/HSQL/Derby
    @ConditionalOnMissingBean({ DataSource.class, XADataSource.class }) // 用户没有自定义 DataSource / XADataSource
    @Import(EmbeddedDataSourceConfiguration.class)
    protected static class EmbeddedDatabaseConfiguration {
        // 自动配置嵌入式数据库（H2/HSQL/Derby）
    }

    @Configuration(proxyBeanMethods = false)
    @Conditional(PooledDataSourceCondition.class)                       // 显式配置了 spring.datasource.type，或 classpath 上有 Hikari 等连接池
    @ConditionalOnMissingBean({ DataSource.class, XADataSource.class })
    protected static class PooledDataSourceConfiguration {
        // 自动配置连接池（默认 HikariCP）
    }
}
```

### 2.4 条件注解家族

Spring Boot 提供了一整套 `@Conditional` 注解，构成自动配置的"开关系统"：

| 注解 | 作用 | 典型场景 |
| :-- | :-- | :-- |
| `@ConditionalOnClass` | classpath 存在指定类 | 引入了 Jackson 才配置 JSON 序列化 |
| `@ConditionalOnMissingBean` | 容器中没有指定 Bean | 用户未自定义数据源才用默认的 |
| `@ConditionalOnProperty` | 配置文件中存在指定属性 | 配置了 `spring.redis.host` 才启用 Redis |
| `@ConditionalOnWebApplication` | 当前是 Web 应用 | MVC 配置只在 Web 环境生效 |
| `@ConditionalOnResource` | classpath 存在指定资源 | 有 `logback.xml` 才使用自定义日志 |
| `@ConditionalOnExpression` | SpEL 表达式为 true | 复杂条件组合 |

### 2.5 自动配置的核心流程图

![Spring Boot 自动配置的核心流程](/spring/autoconfiguration-flow.svg)

关键理解：**自动配置是"兜底"而非"强制"**。当开发者自己注册了同类型的 Bean 时，`@ConditionalOnMissingBean` 确保自动配置会"让路"。这就是"用户定义优先"原则。

## 3. 自动配置类的排序

自动配置类不是随便注册的，它们之间常有先后依赖。比如 `DataSourceAutoConfiguration` 必须在 MyBatis 的 `SqlSessionFactoryAutoConfiguration` 之前装配，否则 `SqlSessionFactory` 创建时拿不到 `DataSource`。Spring Boot 用三个注解表达这种顺序：

| 注解 | 作用 | 示例 |
| :-- | :-- | :-- |
| `@AutoConfigureOrder` | 显式指定一个整数值，值越小越先装配 | `@AutoConfigureOrder(Ordered.HIGHEST_PRECEDENCE)` |
| `@AutoConfigureBefore` | 声明本类必须在某类之前装配 | `@AutoConfiguration(before = XxxAutoConfiguration.class)` |
| `@AutoConfigureAfter` | 声明本类必须在某类之后装配 | `@AutoConfiguration(after = DataSourceAutoConfiguration.class)` |

`@AutoConfiguration` 注解本身带 `before` / `after` 属性，等价于独立的 `@AutoConfigureBefore` / `@AutoConfigureAfter`。排序发生在条件评估之前——顺序确定后，条件才逐个判断，这保证了「前一个自动配置是否生效」这个事实，能被后一个自动配置的条件感知到。

## 4. 本章知识地图

自动配置是 Spring Boot 的发动机，但不是孤立的。围绕它还有六个话题，各成一章：

- [Starter 机制](./chapter-02-starter.md)：自动配置的打包与依赖聚合方案
- [外部化配置](./chapter-03-configuration.md)：`@ConfigurationProperties` 与配置优先级
- [内嵌容器](./chapter-04-embedded-server.md)：自动配置的一个典型落点
- [启动流程与启动参数](./chapter-05-startup.md)：自动配置在 `refresh()` 中的执行时机
- [Actuator 监控](./chapter-06-actuator.md)：暴露自动配置的评估结果
- [DevTools 热部署](./chapter-07-devtools.md)：开发期的自动重启
