# 第 02 章：Spring Boot 原理与配置

## 2.1 自动配置原理

### 2.1.1 @SpringBootApplication 拆解

**一句话痛点：** 一个 `@SpringBootApplication` 注解干了三件事——你写的 `main` 方法之所以能启动整个应用，全靠它。

```java
@SpringBootApplication
public class MyApp {
    public static void main(String[] args) {
        SpringApplication.run(MyApp.class, args);
    }
}

// 等价于以下三个注解的组合
@SpringBootConfiguration
@EnableAutoConfiguration
@ComponentScan
public class MyApp { }
```

**三个注解各司其职：**

```java
// 1. @SpringBootConfiguration = @Configuration
//    表示当前类是一个配置类，可以定义 @Bean
@SpringBootConfiguration
public class MyApp {
    @Bean
    public ObjectMapper objectMapper() {
        return new ObjectMapper();
    }
}

// 2. @EnableAutoConfiguration：自动配置的入口
//    通过 @Import(AutoConfigurationImportSelector) 加载所有自动配置类
@Target(ElementType.TYPE)
@Retention(RetentionPolicy.RUNTIME)
@Import(AutoConfigurationImportSelector.class)
public @interface EnableAutoConfiguration {}

// 3. @ComponentScan：扫描当前包及子包的 @Component/@Service/@Repository
@ComponentScan(
    basePackages = "com.example",
    excludeFilters = @ComponentScan.Filter(
        type = FilterType.ANNOTATION,
        classes = Configuration.class
    )
)
```

**Spring Boot 2.7+ 的变化：**

| 版本 | 自动配置注册方式 |
|------|--------------|
| Boot 2.6 及以前 | `META-INF/spring.factories` |
| Boot 2.7 | 两种都支持（过渡期） |
| Boot 3.0+ | 只支持 `META-INF/spring/org.springframework.boot.autoconfigure.AutoConfiguration.imports` |

**踩坑提醒：** `@ComponentScan` 默认扫描的是 `@SpringBootApplication` 所在包及其子包。如果你的 Controller 在上层包，永远扫描不到——要么调整包结构，要么显式指定 `@ComponentScan(basePackages = "com")`。

---

### 2.1.2 自动配置的加载流程

**一句话痛点：** Spring Boot 能"自动"配置好 DataSource、Jackson、WebMvc，不是因为它猜对了你的需求，而是它加载了上百个候选配置类，再用条件注解过滤。

**完整加载流程：**

```
1. SpringApplication.run() 启动
2. 创建 ApplicationContext
3. refresh() 的第 5 步：invokeBeanFactoryPostProcessors()
4. ConfigurationClassPostProcessor 解析 @EnableAutoConfiguration
5. AutoConfigurationImportSelector 读取配置文件
   ├── Boot 2.x: META-INF/spring.factories
   └── Boot 3.x: META-INF/spring/org.springframework.boot.autoconfigure.AutoConfiguration.imports
6. 返回所有候选自动配置类（100+ 个）
7. 用 @Conditional 逐个过滤（条件不满足的直接移除）
8. 按 @Order / @AutoConfigureOrder 排序
9. 注册为 BeanDefinition
10. 后续正常实例化
```

```java
// AutoConfigurationImportSelector 的核心逻辑（简化）
public class AutoConfigurationImportSelector implements DeferredImportSelector {
    
    @Override
    public String[] selectImports(AnnotationMetadata metadata) {
        // 1. 读取所有候选配置
        List<String> configurations = getCandidateConfigurations(metadata, attributes);
        // → 从 spring.factories 或 AutoConfiguration.imports 读取
        
        // 2. 去重
        configurations = removeDuplicates(configurations);
        
        // 3. 排除用户指定的排除项
        configurations = getExclusions(metadata, attributes);
        
        // 4. @Conditional 过滤（在这一步完成）
        configurations = filter(configurations);
        
        // 5. 排序
        configurations = sort(configurations);
        
        return configurations.toArray(new String[0]);
    }
}
```

**踩坑提醒：** 自动配置的过滤发生在 `BeanDefinition` 注册阶段，不是 Bean 创建阶段。这意味着条件判断时 Bean 还没创建，你不能在 `@Conditional` 中依赖另一个 Bean 的运行时状态。

---

### 2.1.3 条件装配在 Boot 中的应用

**一句话痛点：** Spring Boot 自动配置的"智能"秘诀：你配了就让路，你没配就兜底。

```java
// Spring Boot 自动配置 DataSource 的例子（简化）
@AutoConfiguration
@ConditionalOnClass(DataSource.class)  // 类路径有 DataSource 类
@ConditionalOnMissingBean(DataSource.class)  // 容器中没有 DataSource Bean
@EnableConfigurationProperties(DataSourceProperties.class)
public class DataSourceAutoConfiguration {
    
    @Bean
    @ConditionalOnMissingBean
    public DataSource dataSource(DataSourceProperties properties) {
        // 自动创建 HikariCP 连接池
        return createDataSource(properties);
    }
}

// 用户自定义配置优先
@Configuration
public class MyDataSourceConfig {
    @Bean
    public DataSource dataSource() {
        // 用户自己配置了 DataSource
        // @ConditionalOnMissingBean 导致自动配置不生效
        return new HikariDataSource();
    }
}
```

**"用户优先"的实现原理：**

| 注解 | 含义 | 效果 |
|------|------|------|
| `@ConditionalOnMissingBean` | 容器没有时才生效 | 用户配了就让路 |
| `@ConditionalOnSingleCandidate` | 容器有唯一候选时生效 | 多实现时不生效 |
| `@ConditionalOnProperty` | 配置属性匹配时生效 | 功能开关 |

**自动配置的覆盖方式：**

```yaml
# 方式一：通过配置属性修改行为
spring:
  datasource:
    url: jdbc:mysql://my-server:3306/db
    hikari:
      maximum-pool-size: 20

# 方式二：排除特定自动配置
spring:
  autoconfigure:
    exclude:
      - org.springframework.boot.autoconfigure.jdbc.DataSourceAutoConfiguration
```

```java
// 方式三：注解排除
@SpringBootApplication(exclude = {DataSourceAutoConfiguration.class})
public class MyApp {}

// 方式四：自定义 Bean 直接覆盖
@Configuration
public class CustomConfig {
    @Bean
    @Primary
    public DataSource myDataSource() {
        // 自动配置会因 @ConditionalOnMissingBean 退出
        return buildCustomDataSource();
    }
}
```

**踩坑提醒：** 如果你用 `@ConditionalOnMissingBean` 排除了自动配置，但报错说找不到 DataSource，说明你的自定义 Bean 没有被正确注册。检查自定义配置类是否在 `@ComponentScan` 的扫描范围内。

---

## 2.2 Starter 机制

### 2.2.1 Starter 的目录结构

**一句话痛点：** 引入一个 `spring-boot-starter-web` 就能用 Spring MVC + Tomcat + Jackson，Starter 的秘密就在那几个文件里。

**Starter 的标准目录结构：**

```
my-spring-boot-starter/
├── pom.xml                          # 传递依赖
├── src/main/java/
│   └── com/example/starter/
│       ├── MyAutoConfiguration.java # 自动配置类
│       └── MyProperties.java        # 配置属性类
└── src/main/resources/
    └── META-INF/
        ├── spring/
        │   └── org.springframework.boot.autoconfigure.AutoConfiguration.imports
        └── spring.factories          # Boot 2.x 兼容
```

**Starter 的三个组成部分：**

```xml
<!-- pom.xml：引入传递依赖 -->
<dependencies>
    <!-- 框架核心依赖 -->
    <dependency>
        <groupId>com.example</groupId>
        <artifactId>my-library</artifactId>
        <version>1.0.0</version>
    </dependency>
    <!-- Spring Boot 相关依赖 -->
    <dependency>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-autoconfigure</artifactId>
    </dependency>
    <dependency>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-configuration-processor</artifactId>
        <optional>true</optional>
    </dependency>
</dependencies>
```

**常见 Starter 分类：**

| Starter | 功能 | 引入的核心依赖 |
|---------|------|--------------|
| `spring-boot-starter-web` | Web 应用 | Spring MVC + Tomcat + Jackson |
| `spring-boot-starter-data-jpa` | JPA 持久化 | Hibernate + Spring Data |
| `spring-boot-starter-security` | 安全框架 | Spring Security |
| `spring-boot-starter-test` | 测试 | JUnit + Mockito + AssertJ |
| `spring-boot-starter-actuator` | 监控端点 | Micrometer + Actuator |

**踩坑提醒：** Starter 命名规范：官方用 `spring-boot-starter-xxx`，第三方用 `xxx-spring-boot-starter`。不要自己造一个叫 `spring-boot-starter-xxx` 的第三方 Starter，会和官方混淆。

---

### 2.2.2 自定义 Starter 实战

**一句话痛点：** 你的公共库想让其他项目"引入即用"？那就把它封装成一个 Starter。

**Step 1：创建自动配置类**

```java
// my-spring-boot-starter/src/main/java/com/example/starter/MyServiceAutoConfiguration.java
@AutoConfiguration
@ConditionalOnClass(MyService.class)  // 类路径有 MyService 才生效
@EnableConfigurationProperties(MyServiceProperties.class)
public class MyServiceAutoConfiguration {
    
    @Bean
    @ConditionalOnMissingBean  // 用户可以自己覆盖
    public MyService myService(MyServiceProperties properties) {
        MyService service = new MyService();
        service.setTimeout(properties.getTimeout());
        service.setMaxRetries(properties.getMaxRetries());
        return service;
    }
    
    @Bean
    @ConditionalOnMissingBean
    public MyServiceHealthIndicator myServiceHealthIndicator(MyService service) {
        return new MyServiceHealthIndicator(service);
    }
}
```

**Step 2：创建配置属性类**

```java
@ConfigurationProperties(prefix = "my.service")
public class MyServiceProperties {
    /** 超时时间（毫秒） */
    private long timeout = 5000;
    
    /** 最大重试次数 */
    private int maxRetries = 3;
    
    /** 是否启用 */
    private boolean enabled = true;
    
    // getters & setters
}
```

**Step 3：注册自动配置**

```properties
# META-INF/spring/org.springframework.boot.autoconfigure.AutoConfiguration.imports
com.example.starter.MyServiceAutoConfiguration
```

**Step 4：使用 Starter**

```xml
<!-- 引入 Starter -->
<dependency>
    <groupId>com.example</groupId>
    <artifactId>my-spring-boot-starter</artifactId>
    <version>1.0.0</version>
</dependency>
```

```yaml
# 配置属性（IDE 自动提示，因为有 configuration-processor）
my:
  service:
    timeout: 10000
    max-retries: 5
```

```java
// 直接注入使用
@Service
public class OrderService {
    @Autowired
    private MyService myService; // 自动配置好的
    
    public void process() {
        myService.call();
    }
}
```

**踩坑提醒：** `spring-boot-configuration-processor` 只在编译时生成元数据 JSON（供 IDE 提示），不会影响运行时。但它必须标记为 `<optional>true</optional>`，否则会传递给使用 Starter 的项目。

---

### 2.2.3 Starter 版本管理与依赖冲突

**一句话痛点：** 引入了三个 Starter，Maven 依赖冲突报错 `NoSuchMethodError`——版本管理是 Starter 的命脉。

**BOM（Bill of Materials）管理：**

```xml
<!-- Spring Boot 项目的父 POM 已经管理了大量依赖版本 -->
<parent>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-parent</artifactId>
    <version>3.2.0</version>
</parent>

<!-- 不需要手动指定版本，父 POM 已管理 -->
<dependencies>
    <dependency>
        <groupId>com.fasterxml.jackson.core</groupId>
        <artifactId>jackson-databind</artifactId>
        <!-- 版本由 spring-boot-dependencies BOM 管理 -->
    </dependency>
</dependencies>
```

**排查依赖冲突：**

```bash
# 查看依赖树
mvn dependency:tree

# 过滤特定依赖
mvn dependency:tree -Dincludes=com.fasterxml.jackson.core

# 查看冲突
mvn dependency:tree -Dverbose
```

**解决冲突的方式：**

```xml
<!-- 方式一：在 dependencyManagement 中锁定版本 -->
<dependencyManagement>
    <dependencies>
        <dependency>
            <groupId>com.google.guava</groupId>
            <artifactId>guava</artifactId>
            <version>32.1.3-jre</version>
        </dependency>
    </dependencies>
</dependencyManagement>

<!-- 方式二：exclusion 排除传递依赖 -->
<dependency>
    <groupId>com.example</groupId>
    <artifactId>some-library</artifactId>
    <exclusions>
        <exclusion>
            <groupId>com.google.guava</groupId>
            <artifactId>guava</artifactId>
        </exclusion>
    </exclusions>
</dependency>
```

**踩坑提醒：** `NoSuchMethodError` 和 `ClassNotFoundException` 是依赖冲突的典型症状。先用 `mvn dependency:tree -Dverbose` 找到冲突的 jar，再用 `<exclusion>` 或 `<dependencyManagement>` 解决。不要盲目升级版本。

---

## 2.3 外部化配置

### 2.3.1 配置优先级链

**一句话痛点：** 同一个配置项在 `application.yml`、环境变量、命令行参数里都有值——Spring Boot 用优先级决定用哪个。

**优先级从高到低：**

| 优先级 | 配置来源 | 示例 |
|:-----:|---------|------|
| 1 | 命令行参数 | `--server.port=8080` |
| 2 | Java 系统属性 | `-Dserver.port=8080` |
| 3 | 环境变量 | `SERVER_PORT=8080` |
| 4 | `application-{profile}.yml` | `application-prod.yml` |
| 5 | `application.yml` | `application.yml` |
| 6 | `@PropertySource` | 自定义配置文件 |
| 7 | 默认属性 | `SpringApplication.setDefaultProperties()` |

```java
// 环境变量的命名规则：将 . 替换为 _，大写
// server.port → SERVER_PORT
// spring.datasource.url → SPRING_DATASOURCE_URL

// 命令行参数
java -jar app.jar --server.port=9090 --spring.profiles.active=prod

// Java 系统属性
java -Dserver.port=9090 -jar app.jar
```

**配置合并规则：**

```yaml
# application.yml（基础配置）
server:
  port: 8080
app:
  name: my-app

# application-prod.yml（生产环境覆盖）
server:
  port: 443
  ssl:
    enabled: true
```

结果：`server.port = 443`（prod 覆盖默认），`app.name = my-app`（继承默认）。

**踩坑提醒：** 环境变量 `SERVER_PORT=9090` 会覆盖 `application.yml` 中的 `server.port`。如果生产环境通过环境变量注入了错误的值，你在 yml 里改多少次都没用——先检查环境变量。

---

### 2.3.2 @ConfigurationProperties 绑定

**一句话痛点：** `@Value("${app.name}")` 一个一个注入太累——`@ConfigurationProperties` 可以把一整块配置绑定到一个 POJO。

```java
// application.yml
my:
  app:
    name: my-app
    version: 1.0.0
    features:
      - name: cache
        enabled: true
      - name: audit
        enabled: false
    database:
      url: jdbc:mysql://localhost:3306/db
      pool-size: 10
```

```java
// 绑定到 POJO
@ConfigurationProperties(prefix = "my.app")
public class MyAppProperties {
    
    private String name;
    private String version;
    private List<Feature> features = new ArrayList<>();
    private Database database = new Database();
    
    // getters & setters
    
    public static class Feature {
        private String name;
        private boolean enabled;
        // getters & setters
    }
    
    public static class Database {
        private String url;
        private int poolSize = 5; // 默认值
        // getters & setters
    }
}

// 启用绑定
@Configuration
@EnableConfigurationProperties(MyAppProperties.class)
public class AppConfig {}
```

**@Validated 校验：**

```java
@ConfigurationProperties(prefix = "my.app")
@Validated
public class MyAppProperties {
    
    @NotBlank(message = "应用名称不能为空")
    private String name;
    
    @Min(value = 1, message = "版本号必须大于 0")
    private int majorVersion;
    
    @Size(min = 1, max = 100, message = "功能列表长度 1-100")
    private List<Feature> features;
}
```

**@ConfigurationProperties vs @Value：**

| 特性 | @ConfigurationProperties | @Value |
|------|:-----------------------:|:-----:|
| 松散绑定 | ✅ `pool-size` → `poolSize` | ❌ |
| 元数据提示 | ✅ IDE 自动补全 | ❌ |
| 校验 @Validated | ✅ | ❌ |
| 复杂类型（List/Map） | ✅ | ⚠️ 需 SpEL |
| 默认值 | 字段初始值 | `${key:default}` |

**踩坑提醒：** `@ConfigurationProperties` 的 setter 方法是必须的——Spring 通过 setter 注入值，不是通过字段反射。如果你的 POJO 没有 setter，绑定不会生效。

---

### 2.3.3 多环境 Profile

**一句话痛点：** 开发、测试、生产三个环境，手动改配置文件容易出错——Profile 让你一套代码跑遍所有环境。

```yaml
# application.yml（通用配置）
spring:
  profiles:
    active: dev  # 默认激活 dev
    include: common  # 总是加载 application-common.yml

app:
  name: my-app
```

```yaml
# application-dev.yml
server:
  port: 8080
spring:
  datasource:
    url: jdbc:h2:mem:devdb
    driver-class-name: org.h2.Driver
logging:
  level:
    com.example: DEBUG
```

```yaml
# application-prod.yml
server:
  port: 443
  ssl:
    enabled: true
spring:
  datasource:
    url: jdbc:mysql://prod-server:3306/proddb
    hikari:
      maximum-pool-size: 20
logging:
  level:
    com.example: WARN
```

**Spring Boot 2.4+ 的 Profile 分组：**

```yaml
# application.yml
spring:
  config:
    activate:
      on-profile: prod  # 此文件只在 prod 环境激活
    import:
      - classpath:database-prod.yml  # 导入外部配置
      - optional:classpath:cache-prod.yml  # optional：文件不存在不报错
```

**激活 Profile 的方式（优先级从高到低）：**

```bash
# 1. 命令行参数
java -jar app.jar --spring.profiles.active=prod,monitoring

# 2. 环境变量
export SPRING_PROFILES_ACTIVE=prod

# 3. JVM 系统属性
java -Dspring.profiles.active=prod -jar app.jar

# 4. application.yml 中的 spring.profiles.active
```

**踩坑提醒：** `spring.profiles.include` 在 Boot 2.4 后被 `spring.config.import` 替代。旧项目的 Profile 迁移时需要特别注意这个变化。

---

### 2.3.4 配置加密与敏感信息保护

**一句话痛点：** 数据库密码明文写在 `application.yml` 里提交到 Git——这是安全事故的温床。

**方案一：环境变量（最简单）**

```yaml
# application.yml
spring:
  datasource:
    password: ${DB_PASSWORD}  # 从环境变量读取
```

```bash
# 部署时注入
export DB_PASSWORD=secret123
java -jar app.jar
```

**方案二：Jasypt 加密（透明解密）**

```xml
<!-- 引入 Jasypt -->
<dependency>
    <groupId>com.github.ulisesbocchio</groupId>
    <artifactId>jasypt-spring-boot-starter</artifactId>
    <version>3.0.5</version>
</dependency>
```

```yaml
# application.yml
spring:
  datasource:
    password: ENC(加密后的密文)

jasypt:
  encryptor:
    password: ${JASYPT_MASTER_KEY}  # 主密钥从环境变量获取
```

```java
// 生成加密密文
@SpringBootTest
public class JasyptTest {
    @Autowired
    private StringEncryptor encryptor;
    
    @Test
    public void encryptPassword() {
        String encrypted = encryptor.encrypt("my-secret-password");
        System.out.println("ENC(" + encrypted + ")");
        // 将输出粘贴到 application.yml
    }
}
```

**方案对比：**

| 方案 | 安全性 | 复杂度 | 适用场景 |
|------|:-----:|:-----:|---------|
| 环境变量 | ✅ 高 | 低 | Docker / K8s |
| Jasypt | ✅ 中 | 中 | 传统部署 |
| Vault（HashiCorp） | ✅ 高 | 高 | 企业级密钥管理 |
| K8s Secret | ✅ 高 | 中 | Kubernetes 环境 |

**踩坑提醒：** 不要把 Jasypt 的主密钥也写在 `application.yml` 里——这就等于把保险箱钥匙放在保险箱上面。主密钥必须通过环境变量或启动参数注入。

---

## 2.4 Spring Boot 启动流程

### 2.4.1 一个 run 拆成四段

**一句话痛点：** `SpringApplication.run()` 一行代码背后是几百行逻辑——理解四段式流程，启动报错时你就知道去哪里排查。

```java
public ConfigurableApplicationContext run(String... args) {
    // ═══ 第一段：准备阶段 ═══
    StopWatch stopWatch = new StopWatch();
    stopWatch.start();
    ConfigurableApplicationContext context = null;
    Collection<SpringBootExceptionReporter> exceptionReporters = new ArrayList<>();
    
    // 设置 headless 模式
    configureHeadlessProperty();
    
    // 获取 SpringApplicationRunListeners（通过 spring.factories）
    SpringApplicationRunListeners listeners = getRunListeners(args);
    listeners.starting(); // 通知：应用开始启动
    
    // ═══ 第二段：装配阶段 ═══
    // 准备 Environment（配置源、Profile）
    ApplicationArguments applicationArguments = new DefaultApplicationArguments(args);
    ConfigurableEnvironment environment = prepareEnvironment(listeners, applicationArguments);
    configureIgnoreBeanInfo(environment);
    
    // 打印 Banner
    Banner printedBanner = printBanner(environment);
    
    // 创建 ApplicationContext
    context = createApplicationContext();
    
    // 准备异常报告器
    exceptionReporters = getSpringFactoriesInstances(
        SpringBootExceptionReporter.class,
        new Class[] { ConfigurableApplicationContext.class }, context);
    
    // 准备 ApplicationContext（设置 Environment、注册 BeanFactoryPostProcessor）
    prepareContext(context, environment, listeners, applicationArguments, printedBanner);
    
    // ═══ 第三段：收尾阶段 ═══
    // 刷新容器（核心：执行 refresh() 十二步）
    refreshContext(context);
    
    // 刷新后回调
    afterRefresh(context, applicationArguments);
    stopWatch.stop();
    
    // 通知：启动完成
    listeners.started(context);
    
    // 调用 ApplicationRunner 和 CommandLineRunner
    callRunners(context, applicationArguments);
    
    // ═══ 第四段：退出阶段（异常时） ═══
    listeners.running(context);
    return context;
    
    // 如果启动失败：
    // handleRunFailure() → 调用 ExceptionReporters → 调用 listeners.failed()
}
```

**四段对照表：**

| 阶段 | 关键操作 | 踩坑点 |
|------|---------|--------|
| 准备 | 创建 StopWatch、获取 Listeners | spring.factories 配置错误 |
| 装配 | 创建 Environment、ApplicationContext | 配置文件找不到 |
| 收尾 | refresh()、callRunners | Bean 创建失败 |
| 退出 | 异常处理、FailureAnalysis | 错误信息被吞掉 |

**踩坑提醒：** 如果 `run()` 在 `refreshContext()` 阶段失败，Spring Boot 会尝试调用 `FailureAnalyzer` 提供友好错误信息。如果错误信息不够友好，可能是缺少对应的 `FailureAnalyzer` 实现。

---

### 2.4.2 启动参数与 ApplicationArguments

**一句话痛点：** 命令行传了 `--debug --server.port=9090 myarg`，怎么在代码里拿到这些参数？

```java
// 启动命令：java -jar app.jar --debug --server.port=9090 myarg

@Component
public class StartupArgsDemo implements ApplicationRunner {
    
    @Autowired
    private ApplicationArguments args;
    
    @Override
    public void run(ApplicationArguments applicationArguments) {
        // 获取选项参数（-- 开头的）
        Set<String> optionNames = args.getOptionNames();
        // → ["debug", "server.port"]
        
        List<String> portValues = args.getOptionValues("server.port");
        // → ["9090"]
        
        boolean debug = args.containsOption("debug");
        // → true
        
        // 获取非选项参数（普通参数）
        List<String> nonOptionArgs = args.getNonOptionArgs();
        // → ["myarg"]
        
        // 获取原始 args
        String[] sourceArgs = args.getSourceArgs();
        // → ["--debug", "--server.port=9090", "myarg"]
    }
}
```

**ApplicationRunner vs CommandLineRunner：**

```java
// ApplicationRunner：推荐，参数已解析
@Component
public class MyApplicationRunner implements ApplicationRunner {
    @Override
    public void run(ApplicationArguments args) {
        System.out.println("选项: " + args.getOptionNames());
    }
}

// CommandLineRunner：原始字符串数组
@Component
public class MyCommandLineRunner implements CommandLineRunner {
    @Override
    public void run(String... args) {
        System.out.println("原始参数: " + Arrays.toString(args));
    }
}

// 执行顺序：先 ApplicationRunner，再 CommandLineRunner
// 同类型内按 @Order 排序
```

**踩坑提醒：** `ApplicationRunner` 和 `CommandLineRunner` 的 `run()` 方法在 `ApplicationContext` 完全就绪后执行，可以安全地注入其他 Bean。但如果 `run()` 方法抛异常，应用会直接退出。

---

### 2.4.3 启动失败诊断

**一句话痛点：** Spring Boot 启动报了一屏错误，但真正的原因藏在最后几行——`FailureAnalyzer` 帮你提炼关键信息。

```java
// 自定义 FailureAnalyzer
@Component
public class DatabaseFailureAnalyzer 
        implements FailureAnalyzer<DataSourceBeanCreationException> {
    
    @Override
    public FailureAnalysis analyze(DataSourceBeanCreationException failure) {
        return new FailureAnalysis(
            // 错误描述
            "无法创建数据源。请检查数据库配置。\n" +
            "URL: " + failure.getDataSourceUrl(),
            // 解决建议
            "1. 检查 application.yml 中的 spring.datasource.url\n" +
            "2. 确认数据库服务是否启动\n" +
            "3. 检查网络连通性",
            failure  // 原始异常
        );
    }
}
```

**常见启动失败诊断：**

| 错误信息 | FailureAnalyzer | 常见原因 |
|---------|----------------|---------|
| `BeanCreationException` | `BeanCurrentlyInCreationFailureAnalyzer` | 循环依赖 |
| `DataSourceBeanCreationException` | `DataSourceBeanCreationFailureAnalyzer` | 数据库连不上 |
| `PortInUseException` | `PortFailureAnalyzer` | 端口被占用 |
| `NoUniqueBeanDefinitionException` | `NoSuchBeanDefinitionFailureAnalyzer` | 多实现未指定 |

**自定义启动失败处理：**

```java
// 监听启动失败事件
@Component
public class StartupFailureListener {
    
    @EventListener
    public void onApplicationEvent(ApplicationFailedEvent event) {
        Throwable exception = event.getException();
        // 记录到日志系统、发送告警
        log.error("应用启动失败", exception);
        alertService.sendAlert("应用启动失败: " + exception.getMessage());
    }
}
```

**踩坑提醒：** 启动失败时 Spring Boot 默认会打印 `FailureAnalyzer` 的分析结果，但如果你重写了 `SpringApplication.run()` 并 catch 了异常，`FailureAnalyzer` 就不会执行。

---

### 2.4.4 优雅停机

**一句话痛点：** 应用关闭时正在处理的请求被强制断开——优雅停机让现有请求处理完再关闭。

```yaml
# application.yml
server:
  shutdown: graceful  # 启用优雅停机（Boot 2.3+）

spring:
  lifecycle:
    timeout-per-shutdown-phase: 30s  # 等待超时时间
```

**优雅停机的工作流程：**

```
1. 收到 SIGTERM 信号（或调用 /actuator/shutdown）
2. 不再接受新请求
3. 等待正在处理的请求完成
4. 超时后强制关闭
5. 执行 @PreDestroy 和 SmartLifecycle.stop()
```

```java
// SmartLifecycle 精细控制停机顺序
@Component
public class MessageConsumerLifecycle implements SmartLifecycle {
    
    private volatile boolean running = false;
    private final ExecutorService executor = Executors.newFixedThreadPool(4);
    
    @Override
    public void start() {
        running = true;
        executor.submit(this::consumeMessages);
    }
    
    @Override
    public void stop(Runnable callback) {
        running = false;
        // 先停止消费
        executor.shutdown();
        try {
            // 等待当前消息处理完成
            if (!executor.awaitTermination(20, TimeUnit.SECONDS)) {
                executor.shutdownNow();
            }
        } catch (InterruptedException e) {
            executor.shutdownNow();
            Thread.currentThread().interrupt();
        }
        callback.run(); // 通知容器停止完成
    }
    
    @Override
    public boolean isRunning() {
        return running;
    }
    
    @Override
    public int getPhase() {
        return 10; // 值越小越先停止
    }
}
```

**停机顺序：**

| 阶段 | 操作 | Phase |
|------|------|:-----:|
| 1 | 停止消息消费者 | 10 |
| 2 | 停止定时任务 | 20 |
| 3 | 等待 HTTP 请求完成 | 30 |
| 4 | 关闭数据库连接池 | Integer.MAX_VALUE |

**踩坑提醒：** `server.shutdown=graceful` 只对 HTTP 请求有效。如果你有 WebSocket 连接、gRPC 流、Kafka 消费者等长连接，需要自己实现 `SmartLifecycle` 来配合优雅停机。

---

## 2.5 可观测性基础（Actuator）

### 2.5.1 Actuator 端点

**一句话痛点：** 应用跑起来了，但你不知道它内部状态如何——Actuator 给你一个"透视镜"。

```xml
<!-- 引入 Actuator -->
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-actuator</artifactId>
</dependency>
```

**核心端点一览：**

| 端点 | 路径 | 功能 | 默认暴露 |
|------|------|------|:-------:|
| 健康检查 | `/actuator/health` | 应用健康状态 | ✅ |
| 应用信息 | `/actuator/info` | 应用名称、版本 | ✅ |
| 指标 | `/actuator/metrics` | JVM、HTTP、自定义指标 | ❌ |
| 环境变量 | `/actuator/env` | 所有配置属性 | ❌ |
| Bean 列表 | `/actuator/beans` | 所有 Bean 信息 | ❌ |
| 条件评估 | `/actuator/conditions` | 自动配置生效/未生效原因 | ❌ |
| 配置属性 | `/actuator/configprops` | @ConfigurationProperties 绑定 | ❌ |
| 线程转储 | `/actuator/threaddump` | JVM 线程状态 | ❌ |
| 堆转储 | `/actuator/heapdump` | JVM 堆内存快照 | ❌ |

```yaml
# 暴露所有端点
management:
  endpoints:
    web:
      exposure:
        include: "*"
  endpoint:
    health:
      show-details: always  # 显示健康检查详情
```

**踩坑提醒：** 生产环境不要暴露 `env` 和 `configprops` 端点——它们会泄露数据库密码、API Key 等敏感信息。只暴露 `health`、`info`、`metrics`。

---

### 2.5.2 健康检查与自定义 Indicator

**一句话痛点：** `/actuator/health` 返回 `UP` 不代表你的业务真的健康——数据库连接池满了但 health 依然是 UP，因为你没有自定义检查。

```java
// 自定义健康检查
@Component
public class DatabaseHealthIndicator implements HealthIndicator {
    
    @Autowired
    private DataSource dataSource;
    
    @Override
    public Health health() {
        try (Connection conn = dataSource.getConnection()) {
            if (conn.isValid(3)) {
                return Health.up()
                    .withDetail("database", "MySQL")
                    .withDetail("connection_pool", getPoolStats())
                    .build();
            }
        } catch (SQLException e) {
            return Health.down()
                .withDetail("error", e.getMessage())
                .build();
        }
        return Health.down().build();
    }
    
    private Map<String, Object> getPoolStats() {
        // 返回连接池统计信息
        return Map.of(
            "active", 5,
            "idle", 15,
            "total", 20
        );
    }
}
```

**健康状态聚合：**

```yaml
# /actuator/health 响应示例
{
  "status": "UP",
  "components": {
    "db": {
      "status": "UP",
      "details": {
        "database": "MySQL",
        "connection_pool": {
          "active": 5,
          "idle": 15
        }
      }
    },
    "diskSpace": {
      "status": "UP",
      "details": {
        "free": "10GB",
        "threshold": "10MB"
      }
    },
    "customCheck": {
      "status": "DOWN"
    }
  }
}
```

**踩坑提醒：** `HealthIndicator` 的 `health()` 方法会在每次请求 `/actuator/health` 时调用。如果检查逻辑很重（如远程调用），考虑用 `@Scheduled` 缓存结果，避免每次请求都等待。

---

### 2.5.3 Micrometer 指标集成

**一句话痛点：** 不知道接口 QPS、不知道慢请求、不知道 JVM 内存——没有指标就是盲飞。

```xml
<!-- 引入 Micrometer -->
<dependency>
    <groupId>io.micrometer</groupId>
    <artifactId>micrometer-registry-prometheus</artifactId>
</dependency>
```

```java
// 自定义指标
@Component
public class OrderMetrics {
    
    private final Counter orderCounter;
    private final Timer orderTimer;
    private final AtomicInteger pendingOrders;
    
    public OrderMetrics(MeterRegistry registry) {
        // 计数器：统计订单总数
        this.orderCounter = Counter.builder("orders.created")
            .description("创建的订单总数")
            .tag("type", "online")
            .register(registry);
        
        // 计时器：统计处理耗时
        this.orderTimer = Timer.builder("orders.processing.time")
            .description("订单处理耗时")
            .publishPercentiles(0.5, 0.95, 0.99) // P50、P95、P99
            .register(registry);
        
        // 仪表盘：当前待处理订单数
        this.pendingOrders = registry.gauge("orders.pending",
            new AtomicInteger(0));
    }
    
    public void recordOrder() {
        orderCounter.increment();
    }
    
    public void recordProcessingTime(long durationMs) {
        orderTimer.record(durationMs, TimeUnit.MILLISECONDS);
    }
    
    public void incrementPending() {
        pendingOrders.incrementAndGet();
    }
    
    public void decrementPending() {
        pendingOrders.decrementAndGet();
    }
}
```

**Micrometer 三大指标类型：**

| 类型 | 用途 | 示例 |
|------|------|------|
| Counter | 只增不减的计数器 | 请求总数、错误总数 |
| Timer | 耗时统计 | 接口响应时间 |
| Gauge | 可增可减的瞬时值 | 内存使用、队列长度 |

**Prometheus 集成：**

```yaml
management:
  endpoints:
    web:
      exposure:
        include: prometheus,health,metrics
  metrics:
    tags:
      application: ${spring.application.name}
```

```yaml
# prometheus.yml
scrape_configs:
  - job_name: 'my-app'
    metrics_path: '/actuator/prometheus'
    static_configs:
      - targets: ['localhost:8080']
```

**踩坑提醒：** `Timer.record()` 的参数单位默认是纳秒（nanoseconds），如果你传的是毫秒，需要用 `record(durationMs, TimeUnit.MILLISECONDS)`。否则你的 P99 会显示为纳秒级别的"极快"响应。

---

## 2.6 开发效率工具

### 2.6.1 DevTools 热部署

**一句话痛点：** 改一行代码就要重启等 30 秒——DevTools 让你改完即生效。

```xml
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-devtools</artifactId>
    <optional>true</optional>
    <scope>runtime</scope>
</dependency>
```

**双 ClassLoader 原理：**

```
                    ┌─────────────────────┐
                    │   Base ClassLoader   │  ← 第三方 jar（不变）
                    │  （不重启不重新加载）  │
                    └─────────┬───────────┘
                              │
                    ┌─────────┴───────────┐
                    │  Restart ClassLoader │  ← 你的代码（改变时重新加载）
                    │ （代码变更时重新创建） │
                    └─────────────────────┘

当代码变更时：
1. Restart ClassLoader 被丢弃
2. 创建新的 Restart ClassLoader
3. Base ClassLoader 不变 → 第三方 jar 不需要重新加载
4. 结果：启动时间从 30s → 3s
```

```yaml
# DevTools 配置
spring:
  devtools:
    restart:
      enabled: true
      additional-paths: src/main/java  # 监控路径
      exclude: static/**,public/**      # 排除静态资源
    livereload:
      enabled: true  # 自动刷新浏览器
```

**触发重启的条件：**

| 变更类型 | 行为 |
|---------|------|
| Java 代码变更 | 自动重启（Restart ClassLoader） |
| 静态资源变更 | 自动刷新浏览器（LiveReload） |
| 配置文件变更 | 自动重启 |
| pom.xml 变更 | 需要手动重启 |

**踩坑提醒：** DevTools 只在开发环境生效（检测到 `ClassLoader` 不是 `LaunchedURLClassLoader` 时才激活）。生产环境即使引入了 DevTools 也不会有任何效果，但建议用 `<scope>runtime</scope>` 确保不参与编译。

---

### 2.6.2 API 文档自动生成

**一句话痛点：** 前后端对接时，API 文档总是和代码不一致——springdoc-openapi 让文档从代码自动生成，永远保持同步。

```xml
<dependency>
    <groupId>org.springdoc</groupId>
    <artifactId>springdoc-openapi-starter-webmvc-ui</artifactId>
    <version>2.3.0</version>
</dependency>
```

```java
// 全局配置
@Configuration
public class OpenApiConfig {
    
    @Bean
    public OpenAPI customOpenAPI() {
        return new OpenAPI()
            .info(new Info()
                .title("订单系统 API")
                .version("1.0.0")
                .description("订单系统接口文档")
                .contact(new Contact()
                    .name("开发团队")
                    .email("dev@example.com")))
            .addSecurityItem(new SecurityRequirement().addList("Bearer"))
            .components(new Components()
                .addSecuritySchemes("Bearer",
                    new SecurityScheme()
                        .type(SecurityScheme.Type.HTTP)
                        .scheme("bearer")
                        .bearerFormat("JWT")));
    }
}

// Controller 文档注解
@RestController
@RequestMapping("/api/orders")
@Tag(name = "订单管理", description = "订单的增删改查")
public class OrderController {
    
    @Operation(summary = "创建订单", description = "创建一个新的订单")
    @ApiResponse(responseCode = "201", description = "订单创建成功")
    @PostMapping
    public Order createOrder(
            @Parameter(description = "订单请求体", required = true)
            @RequestBody OrderRequest request) {
        return orderService.create(request);
    }
    
    @Operation(summary = "查询订单", description = "根据 ID 查询订单详情")
    @GetMapping("/{id}")
    public Order getOrder(
            @Parameter(description = "订单 ID", example = "1001")
            @PathVariable Long id) {
        return orderService.findById(id);
    }
}
```

**访问地址：**

| 工具 | 地址 |
|------|------|
| Swagger UI | `http://localhost:8080/swagger-ui.html` |
| OpenAPI JSON | `http://localhost:8080/v3/api-docs` |

**踩坑提醒：** 生产环境建议关闭 Swagger UI，避免暴露接口细节。可以通过 `springdoc.swagger-ui.enabled=false` 或 `@Profile("dev")` 限制。

---

## 2.7 构建与部署

### 2.7.1 Fat Jar 的结构

**一句话痛点：** `java -jar app.jar` 能直接运行，但 `unzip app.jar` 一看——这不是普通 jar，它是 Fat Jar。

**Fat Jar 的目录结构：**

```
app.jar
├── META-INF/
│   └── MANIFEST.MF
│       Main-Class: org.springframework.boot.loader.JarLauncher
│       Start-Class: com.example.MyApplication
│       Spring-Boot-Version: 3.2.0
├── org/springframework/boot/loader/
│   ├── JarLauncher.class
│   ├── LaunchedURLClassLoader.class
│   └── ...（Spring Boot Loader）
├── BOOT-INF/
│   ├── classes/
│   │   └── com/example/  ← 你的代码
│   └── lib/
│       ├── spring-core-6.1.0.jar
│       ├── spring-web-6.1.0.jar
│       └── ...（所有依赖 jar）
```

**repackage 原理：**

```xml
<!-- spring-boot-maven-plugin 的 repackage -->
<plugin>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-maven-plugin</artifactId>
    <executions>
        <execution>
            <goals>
                <goal>repackage</goal>  <!-- 核心：将 jar 重新打包为 Fat Jar -->
            </goals>
        </execution>
    </executions>
</plugin>
```

`repackage` 做了什么：
1. 将原始 jar 的内容移到 `BOOT-INF/classes/`
2. 将所有依赖 jar 移到 `BOOT-INF/lib/`
3. 写入 `MANIFEST.MF`，指定 `Main-Class` 为 `JarLauncher`
4. `JarLauncher` 创建自定义 `ClassLoader`，从 `BOOT-INF/` 加载类

**踩坑提醒：** `spring-boot-maven-plugin` 的 `repackage` goal 会替换原始 jar。如果你同时需要普通 jar（供其他项目依赖），需要配置两个 execution。

---

### 2.7.2 多模块工程打包

**一句话痛点：** 多模块项目中，只有 Web 模块需要打 Fat Jar，其他模块打普通 jar——配置错了就报 `no main manifest attribute`。

```xml
<!-- 父 POM -->
<modules>
    <module>my-app-common</module>
    <module>my-app-service</module>
    <module>my-app-web</module>  <!-- 只有这个打 Fat Jar -->
</modules>

<!-- my-app-common/pom.xml：普通 jar -->
<artifactId>my-app-common</artifactId>
<!-- 不需要 spring-boot-maven-plugin -->

<!-- my-app-service/pom.xml：普通 jar -->
<artifactId>my-app-service</artifactId>
<!-- 不需要 spring-boot-maven-plugin -->

<!-- my-app-web/pom.xml：Fat Jar -->
<artifactId>my-app-web</artifactId>
<build>
    <plugins>
        <plugin>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-maven-plugin</artifactId>
        </plugin>
    </plugins>
</build>
```

**踩坑提醒：** 如果 `spring-boot-maven-plugin` 放在父 POM 的 `<pluginManagement>` 里，所有子模块都会执行 repackage。应该只在 Web 模块的 `<plugins>` 中声明。

---

### 2.7.3 Docker 容器化

**一句话痛点：** 每次改一行代码就要重新构建整个 Docker 镜像（900MB）——分层 Dockerfile 让依赖层缓存命中，构建从 5 分钟降到 30 秒。

**分层 Dockerfile：**

```dockerfile
# 第一层：基础镜像
FROM eclipse-temurin:17-jre-jammy AS builder
WORKDIR /app

# 第二层：依赖层（不常变，缓存命中率高）
COPY target/dependency/BOOT-INF/lib /app/lib

# 第三层：应用代码（经常变）
COPY target/dependency/BOOT-INF/classes /app/classes

# 第四层：运行
FROM eclipse-temurin:17-jre-jammy
WORKDIR /app
COPY --from=builder /app/lib /app/lib
COPY --from=builder /app/classes /app/classes
ENTRYPOINT ["java", "-cp", "/app/classes:/app/lib/*", "com.example.MyApplication"]
```

**Spring Boot 分层工具：**

```bash
# 先解压 Fat Jar
mkdir -p target/dependency
cd target/dependency
jar -xf ../my-app-1.0.0.jar

# 查看分层
java -Djarmode=layertools -jar my-app-1.0.0.jar list
# → dependencies
# → spring-boot-loader
# → snapshot-dependencies
# → application
```

```dockerfile
# 使用 Spring Boot 分层
FROM eclipse-temurin:17-jre-jammy AS builder
WORKDIR /app
COPY target/my-app-1.0.0.jar app.jar
RUN java -Djarmode=layertools -jar app.jar extract

FROM eclipse-temurin:17-jre-jammy
WORKDIR /app
COPY --from=builder /app/dependencies/ ./
COPY --from=builder /app/spring-boot-loader/ ./
COPY --from=builder /app/snapshot-dependencies/ ./
COPY --from=builder /app/application/ ./
ENTRYPOINT ["java", "org.springframework.boot.loader.launch.JarLauncher"]
```

**踩坑提醒：** `COPY` 的顺序很重要——把变化频率低的层放前面（依赖），变化频率高的层放后面（代码），这样 Docker Build Cache 才能命中。

---

### 2.7.4 GraalVM 原生镜像

**一句话痛点：** Spring Boot 应用启动要 5 秒、内存占用 300MB——GraalVM 原生镜像让启动降到 0.1 秒、内存 50MB，但代价是构建时间长。

**AOT 处理原理：**

```
传统 JVM 模式：
  .java → .class → JVM 加载 → 反射/动态代理 → 运行
  （反射在运行时决定，无法提前优化）

GraalVM 原生镜像模式：
  .java → AOT 处理 → .class → Native Image 编译 → 原生可执行文件
  （AOT 提前分析所有反射、代理，生成初始化代码）
```

```xml
<!-- 引入 Native Build Tools -->
<plugin>
    <groupId>org.graalvm.buildtools</groupId>
    <artifactId>native-maven-plugin</artifactId>
    <version>0.9.28</version>
    <executions>
        <execution>
            <id>build-native</id>
            <goals>
                <goal>compile-no-fork</goal>
            </goals>
        </execution>
    </executions>
</plugin>
```

```bash
# 构建原生镜像
mvn -Pnative native:compile

# 运行
./target/my-app  # 启动时间 ~0.1s
```

**JVM vs Native 对比：**

| 特性 | JVM 模式 | GraalVM Native |
|------|:-------:|:--------------:|
| 启动时间 | 3-10 秒 | 0.05-0.5 秒 |
| 内存占用 | 200-500 MB | 30-80 MB |
| 峰值性能 | ✅ JIT 优化 | ⚠️ 无 JIT |
| 构建时间 | 30 秒 | 5-15 分钟 |
| 反射支持 | ✅ 原生 | ⚠️ 需配置 |
| 动态代理 | ✅ 原生 | ⚠️ 需配置 |

**Spring Boot 3.x 的 AOT 支持：**

```java
// Spring Boot 3.x 自动处理大部分 AOT 问题
// 但自定义反射需要手动声明
@RegisterReflectionForBinding({MyDto.class, AnotherDto.class})
@SpringBootApplication
public class MyApp {}
```

**踩坑提醒：** GraalVM Native Image 不支持所有 Java 特性——动态类加载、`synchronized` 块、某些序列化框架都不完全兼容。在引入 Native 之前，先检查你的依赖是否支持。
