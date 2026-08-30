# Starter 机制

## 1. Starter 结构

```
my-starter/
├── src/main/java/
│   └── com/example/autoconfigure/
│       └── MyAutoConfiguration.java
├── src/main/resources/
│   └── META-INF/
│       └── spring/
│           └── org.springframework.boot.autoconfigure.AutoConfiguration.imports
└── pom.xml
```

## 2. 自定义 Starter

```java
@AutoConfiguration
@ConditionalOnClass(MyService.class)
@EnableConfigurationProperties(MyProperties.class)
public class MyAutoConfiguration {
    @Bean
    @ConditionalOnMissingBean
    public MyService myService(MyProperties properties) {
        return new MyService(properties);
    }
}
```

## 3. spring.factories vs AutoConfiguration.imports

| 版本 | 方式 |
|------|------|
| Spring Boot 2.x | META-INF/spring.factories |
| Spring Boot 2.7 | 两种都支持（过渡期） |
| Spring Boot 3.x | 只支持 META-INF/spring/.../AutoConfiguration.imports |

::: warning 升级踩坑
Boot 2.7 起 `spring.factories` 已 deprecated，Boot 3.0 起不再读取 `EnableAutoConfiguration` 条目。升级时务必迁移注册文件。
:::

## 3.1 Starter 的三个组成部分

一个完整的 Starter 由三部分组成：

| 组成部分 | 职责 | 示例 |
|---------|------|------|
| **传递依赖（pom.xml）** | 聚合引入功能所需的所有 JAR | `spring-boot-starter-web` 聚合了 Spring MVC + Tomcat + Jackson |
| **自动配置类** | 通过 `@Conditional` 决定是否注册 Bean | `DataSourceAutoConfiguration` |
| **配置属性类** | 通过 `@ConfigurationProperties` 绑定用户配置 | `DataSourceProperties` |

pom.xml 中必须包含的依赖：

```xml
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
    <!-- 配置元数据生成（IDE 提示用，不传递给使用者） -->
    <dependency>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-configuration-processor</artifactId>
        <optional>true</optional>
    </dependency>
</dependencies>
```

常见 Starter 分类：

| Starter | 功能 | 引入的核心依赖 |
|---------|------|--------------|
| `spring-boot-starter-web` | Web 应用 | Spring MVC + Tomcat + Jackson |
| `spring-boot-starter-data-jpa` | JPA 持久化 | Hibernate + Spring Data |
| `spring-boot-starter-security` | 安全框架 | Spring Security |
| `spring-boot-starter-test` | 测试 | JUnit + Mockito + AssertJ |
| `spring-boot-starter-actuator` | 监控端点 | Micrometer + Actuator |

## 4. Starter 实战

### 4.1 自定义 Starter 完整示例（分布式锁）

```java
// 锁服务接口
public interface DistributedLock {
    boolean tryLock(String key, long timeout, TimeUnit unit);
    void unlock(String key);
}

// 基于 Redis 的实现
public class RedisDistributedLock implements DistributedLock {

    private final StringRedisTemplate redisTemplate;

    public RedisDistributedLock(StringRedisTemplate redisTemplate) {
        this.redisTemplate = redisTemplate;
    }

    @Override
    public boolean tryLock(String key, long timeout, TimeUnit unit) {
        return Boolean.TRUE.equals(redisTemplate.opsForValue()
            .setIfAbsent("lock:" + key, "1", timeout, unit));
    }

    @Override
    public void unlock(String key) {
        redisTemplate.delete("lock:" + key);
    }
}
```

```java
// 属性配置类
@ConfigurationProperties(prefix = "distributed.lock")
public class DistributedLockProperties {

    /** 锁前缀 */
    private String prefix = "dl:";

    /** 默认超时时间（秒） */
    private long defaultTimeout = 30;

    // getter/setter
}
```

```java
// 自动配置类
@AutoConfiguration(after = RedisAutoConfiguration.class)
@ConditionalOnClass(StringRedisTemplate.class)
@EnableConfigurationProperties(DistributedLockProperties.class)
public class DistributedLockAutoConfiguration {

    @Bean
    @ConditionalOnMissingBean
    public DistributedLock distributedLock(StringRedisTemplate redisTemplate) {
        return new RedisDistributedLock(redisTemplate);
    }
}
```

注册文件 `META-INF/spring/org.springframework.boot.autoconfigure.AutoConfiguration.imports`：

```text
com.example.autoconfigure.DistributedLockAutoConfiguration
```

Maven 配置：

```xml
<!-- distributed-lock-spring-boot-starter/pom.xml -->
<dependencies>
    <dependency>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-starter-data-redis</artifactId>
        <optional>true</optional>
    </dependency>
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

使用方只需一行依赖：

```xml
<dependency>
    <groupId>com.example</groupId>
    <artifactId>distributed-lock-spring-boot-starter</artifactId>
    <version>1.0.0</version>
</dependency>
```

### 4.2 Starter 的自动配置测试

```java
@SpringBootTest
@Import(DistributedLockAutoConfiguration.class)
class DistributedLockAutoConfigurationTest {

    @Autowired
    private ApplicationContext context;

    @Test
    void shouldCreateLockBean() {
        assertTrue(context.containsBean("distributedLock"));
        assertInstanceOf(RedisDistributedLock.class, context.getBean(DistributedLock.class));
    }

    @Test
    void shouldNotCreateWhenRedisTemplateMissing() {
        // 模拟没有 RedisTemplate 的情况
        AnnotationConfigApplicationContext ctx = new AnnotationConfigApplicationContext();
        ctx.register(DistributedLockAutoConfiguration.class);
        ctx.refresh();
        assertFalse(ctx.containsBean("distributedLock"));
    }
}
```

### 4.3 spring.factories（Spring Boot 2.x 兼容）

```properties
# META-INF/spring.factories
org.springframework.boot.autoconfigure.EnableAutoConfiguration=\
  com.example.autoconfigure.DistributedLockAutoConfiguration
```

**最佳实践：**

1. **Starter 只做依赖聚合**——不要在 Starter 模块中写代码，逻辑放在 autoconfigure 模块
2. **`@ConditionalOnMissingBean` 是标配**——让用户可以轻松覆盖默认实现
3. **提供配置元数据**——`spring-boot-configuration-processor` 自动生成 `spring-configuration-metadata.json`，IDE 可以提示配置项
4. **测试自动配置**——确保条件注解正确工作，不会误注册 Bean
5. **命名规范**：官方用 `spring-boot-starter-xxx`，第三方用 `xxx-spring-boot-starter`，不要混淆

## 5. Starter 版本管理与依赖冲突

引入多个 Starter 后，最常见的问题是依赖版本冲突，表现为 `NoSuchMethodError` 或 `ClassNotFoundException`。

### 5.1 BOM 版本管理

Spring Boot 的父 POM 已经管理了大量依赖版本，不需要手动指定：

```xml
<parent>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-parent</artifactId>
    <version>3.2.0</version>
</parent>

<dependencies>
    <dependency>
        <groupId>com.fasterxml.jackson.core</groupId>
        <artifactId>jackson-databind</artifactId>
        <!-- 版本由 spring-boot-dependencies BOM 管理，无需指定 -->
    </dependency>
</dependencies>
```

### 5.2 排查依赖冲突

```bash
# 查看依赖树
mvn dependency:tree

# 过滤特定依赖
mvn dependency:tree -Dincludes=com.fasterxml.jackson.core

# 查看冲突详情
mvn dependency:tree -Dverbose
```

### 5.3 解决冲突的两种方式

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

::: warning 常见症状
`NoSuchMethodError` 和 `ClassNotFoundException` 是依赖冲突的典型症状。先用 `mvn dependency:tree -Dverbose` 找到冲突的 jar，再用 `<exclusion>` 或 `<dependencyManagement>` 解决。不要盲目升级版本。
:::
