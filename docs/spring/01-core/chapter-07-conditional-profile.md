# 条件装配与 Profile

> 条件装配让 Bean 的注册依赖一个运行时条件，满足才注册，不满足就不进容器。Spring Boot 的自动配置靠它实现「用户没配时给默认值，用户自己配了就不再重复注册」。

## 1. 什么是条件装配

条件装配让 Bean 的注册依赖一个运行时条件。条件不满足，Bean 就不注册：

```java
@Configuration
public class AppConfig {
    @Bean
    @Conditional(LinuxCondition.class)
    public DataSource linuxDataSource() { /* Linux 数据源 */ }
}

public class LinuxCondition implements Condition {
    @Override
    public boolean matches(ConditionContext context, AnnotatedTypeMetadata metadata) {
        return context.getEnvironment()
            .getProperty("os.name").contains("Linux");
    }
}
```

`matches` 返回 `true` 才注册这个 Bean。判断发生在 Bean 实例化之前，不满足条件的 Bean 根本不进容器。

判断的精确时机是 **BeanDefinition 注册阶段**，比实例化更早。`ConfigurationClassPostProcessor` 解析 `@Configuration` 类时，分两个 phase 触发条件评估，统一收口在 `ConditionEvaluator#shouldSkip`：

```java
// ConditionEvaluator#shouldSkip：返回 true 就跳过对应的类或方法定义
public boolean shouldSkip(AnnotatedTypeMetadata metadata, ConfigurationPhase phase) {
    // 收集 @Conditional 注解，逐个调用 Condition#matches 求值
}
```

`ConfigurationPhase` 只有两个取值：

| Phase | 评估对象 | 典型注解 |
| :-- | :-- | :-- |
| `PARSE_CONFIGURATION` | `@Configuration` 类本身 | 类级别 `@ConditionalOnClass`、`@ConditionalOnMissingClass` |
| `REGISTER_BEAN` | `@Bean` 方法 | `@ConditionalOnMissingBean`、`@ConditionalOnProperty` |

类级别的条件在 `ConfigurationClassParser` 解析配置类时先评估，方法级别的条件在 `ConfigurationClassBeanDefinitionReader` 读取 `@Bean` 定义时再评估。两次都调用 `shouldSkip`，返回 `true` 就跳过这个类或方法对应的 BeanDefinition，实例化根本不会发生。

## 2. 常用条件注解

手写 `Condition` 太啰嗦，Spring Boot 预置了一组语义化注解，覆盖绝大多数场景：

| 注解 | 满足条件 |
| :-- | :-- |
| `@ConditionalOnClass` | 类路径存在指定类 |
| `@ConditionalOnMissingClass` | 类路径不存在指定类 |
| `@ConditionalOnBean` | 容器存在指定 Bean |
| `@ConditionalOnMissingBean` | 容器不存在指定 Bean |
| `@ConditionalOnProperty` | 配置属性满足条件 |
| `@ConditionalOnResource` | 存在指定资源文件 |

## 3. @Profile：按环境切换

`@Profile` 是条件装配的一个特例，按激活的环境注册 Bean：

```java
@Configuration
public class DataSourceConfig {
    @Bean
    @Profile("dev")
    public DataSource devDataSource() { /* 开发环境数据源 */ }

    @Bean
    @Profile("prod")
    public DataSource prodDataSource() { /* 生产环境数据源 */ }
}
```

```bash
java -jar app.jar --spring.profiles.active=prod
```

`@Profile("!dev")` 表示非开发环境生效，`@Profile("production")` 可以激活一组 Bean。

## 4. 属性来源{#environment}

`@Profile` 和 `@ConditionalOnProperty` 的 `matches` 内部都调 `context.getEnvironment().getProperty(...)`。`Environment` 把所有配置来源（命令行参数 > JVM 系统属性 > 系统环境变量 > `application-{profile}.properties` > `application.properties` > `@PropertySource`）串成一条有序链，查找时从头到尾遍历，第一个命中就返回。这就是命令行参数能覆盖配置文件的原因。属性来源与 `@Value` 占位符解析的完整机制，属于外部化配置的范畴，条件装配只用到它的读值能力，本文不再展开。

## 5. 典型场景

### 5.1 用户优先：@ConditionalOnMissingBean

自动配置的核心原则是「用户优先」——框架提供默认实现，用户一旦自己定义，框架就退让：

```java
@Configuration
public class CacheAutoConfiguration {
    @Bean
    @ConditionalOnMissingBean(CacheManager.class)  // 用户没定义才生效
    public CacheManager defaultCacheManager() {
        return new ConcurrentMapCacheManager();
    }
}
```

用户自己定义了一个 `CacheManager`，框架的默认实现就不会注册，两者不冲突。

### 5.2 功能开关：@ConditionalOnProperty

用配置项控制功能启停。条件是启动时评估的，改配置后需重启应用才生效——不用改代码、不用重新打包：

```java
@Configuration
public class FeatureConfig {
    @Bean
    @ConditionalOnProperty(name = "feature.payment.enabled", havingValue = "true")
    public PaymentGateway paymentGateway() {
        return new AlipayGateway();
    }
}
```

```yaml
feature:
  payment:
    enabled: false  # 关闭支付功能
```

### 5.3 多条件组合

一个 Bean 的注册往往要同时满足多个条件，注解可以叠加：

```java
@Configuration
public class DataSourceAutoConfig {
    @Bean
    @ConditionalOnClass(name = "com.mysql.cj.jdbc.Driver")
    @ConditionalOnProperty(prefix = "spring.datasource", name = "url")
    @ConditionalOnMissingBean(DataSource.class)
    public DataSource mysqlDataSource() {
        // 类路径有 MySQL 驱动 + 配了 url + 用户没定义 DataSource 才注册
    }
}
```

三个条件必须同时满足才注册，任何一个不满足，Bean 就被跳过。

## 6. 使用清单

| 场景 | 选择 |
| :-- | :-- |
| 按环境切换实现 | `@Profile("dev")` |
| 框架兜底、用户优先 | `@ConditionalOnMissingBean` |
| 功能开关 | `@ConditionalOnProperty` |
| 依赖某个类是否存在 | `@ConditionalOnClass` / `@ConditionalOnMissingClass` |
| 复杂自定义条件 | 实现 `Condition`，再组合成自定义注解 |
| Profile 命名 | 用 `dev` / `test` / `staging` / `prod`，不自造名称 |
