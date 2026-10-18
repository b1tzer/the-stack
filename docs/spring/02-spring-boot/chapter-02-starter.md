# Starter 机制

> 一个 Starter 是「依赖集合 + 自动配置类」的打包方案：引入一个功能需要哪些 JAR、版本是否兼容，都封装在一个依赖里解决。本章讲清 Starter 的构成、如何注册自动配置类、以及引入多个 Starter 后的依赖治理。

## 1. 注册自动配置类：spring.factories vs AutoConfiguration.imports

| 版本 | 方式 |
| :-- | :-- |
| Spring Boot 2.0~2.6 | META-INF/spring.factories |
| Spring Boot 2.7 | 两种都支持，spring.factories 的自动配置注册方式已弃用 |
| Spring Boot 3.x | 只支持 META-INF/spring/org.springframework.boot.autoconfigure.AutoConfiguration.imports |

::: warning 升级踩坑
Boot 2.7 起 `spring.factories` 中的自动配置注册方式已弃用，Boot 3.0 起不再从 `spring.factories` 读取 `EnableAutoConfiguration` 条目。升级时务必把自动配置类迁移到 `AutoConfiguration.imports`。
:::

## 2. Starter 的三个组成部分

| 组成部分 | 职责 | 示例 |
| :-- | :-- | :-- |
| **传递依赖（pom.xml）** | 聚合引入功能所需的所有 JAR | `spring-boot-starter-web` 聚合 Spring MVC + Tomcat + Jackson |
| **自动配置类** | 通过 `@Conditional` 决定是否注册 Bean | `DataSourceAutoConfiguration` |
| **配置属性类** | 通过 `@ConfigurationProperties` 绑定用户配置 | `DataSourceProperties` |

三者分工：依赖负责「引入什么」，自动配置类负责「注册什么」，属性类负责「值从哪来」。自动配置类的原理见 [自动配置](./chapter-01-autoconfiguration.md)，这里不重复。

## 3. 自定义 Starter 完整实战（分布式锁）

为聚焦 Starter 结构，下面示例把 autoconfigure 逻辑与 Starter 放在同一个模块。生产项目应按 §6 拆成 Starter 模块 + autoconfigure 模块，由 Starter 依赖后者。

```java
// 锁服务接口
public interface DistributedLock {
    boolean tryLock(String key, long timeout, TimeUnit unit);
    void unlock(String key);
}

// 基于 Redis 的实现（简化示例：省略持有者标识校验与原子释放）
public class RedisDistributedLock implements DistributedLock {

    private final StringRedisTemplate redisTemplate;
    private final DistributedLockProperties properties;

    public RedisDistributedLock(StringRedisTemplate redisTemplate, DistributedLockProperties properties) {
        this.redisTemplate = redisTemplate;
        this.properties = properties;
    }

    @Override
    public boolean tryLock(String key, long timeout, TimeUnit unit) {
        return Boolean.TRUE.equals(redisTemplate.opsForValue()
            .setIfAbsent(properties.getPrefix() + key, "1", timeout, unit));
    }

    // 简化实现：直接删键，未校验持有者。锁过期后旧持有者可能误删新持有者的锁，
    // 生产环境需写入唯一持有者标识，并用 Lua 脚本原子校验后再释放。
    @Override
    public void unlock(String key) {
        redisTemplate.delete(properties.getPrefix() + key);
    }
}
```

```java
// 属性配置类
@ConfigurationProperties(prefix = "distributed.lock")
public class DistributedLockProperties {

    /** 锁前缀 */
    private String prefix = "dl:";

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
    @ConditionalOnBean(StringRedisTemplate.class)
    public DistributedLock distributedLock(StringRedisTemplate redisTemplate, DistributedLockProperties properties) {
        return new RedisDistributedLock(redisTemplate, properties);
    }
}
```

注册文件 `META-INF/spring/org.springframework.boot.autoconfigure.AutoConfiguration.imports`：

```txt
com.example.autoconfigure.DistributedLockAutoConfiguration
```

Maven 配置：

```xml
<!-- distributed-lock-spring-boot-starter/pom.xml -->
<dependencies>
    <dependency>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-starter-data-redis</artifactId>
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

## 4. 自动配置的测试

```java
class DistributedLockAutoConfigurationTest {

    private final ApplicationContextRunner contextRunner = new ApplicationContextRunner()
            .withConfiguration(AutoConfigurations.of(DistributedLockAutoConfiguration.class));

    @Test
    void shouldCreateLockBean() {
        contextRunner
                .withBean(StringRedisTemplate.class)
                .run(context -> {
                    assertTrue(context.containsBean("distributedLock"));
                    assertInstanceOf(RedisDistributedLock.class, context.getBean(DistributedLock.class));
                });
    }

    @Test
    void shouldNotCreateWhenRedisTemplateMissing() {
        contextRunner
                .run(context -> assertFalse(context.containsBean("distributedLock")));
    }
}
```

## 5. 版本管理与依赖冲突

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

## 6. 最佳实践

1. **Starter 只做依赖聚合**——不要在 Starter 模块中写代码，逻辑放在 autoconfigure 模块
2. **`@ConditionalOnMissingBean` 是标配**——让用户可以覆盖默认实现
3. **提供配置元数据**——`spring-boot-configuration-processor` 自动生成 `spring-configuration-metadata.json`，IDE 可以提示配置项
4. **测试自动配置**——确保条件注解正确工作，不会误注册 Bean
5. **命名规范**——官方用 `spring-boot-starter-xxx`，第三方用 `xxx-spring-boot-starter`
