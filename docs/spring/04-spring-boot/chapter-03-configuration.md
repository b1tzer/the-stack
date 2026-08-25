# 外部化配置

## 1. 配置优先级

命令行参数 > 系统环境变量 > application-{profile}.yml > application.yml > @PropertySource

## 2. 多环境 Profile

```yaml
# application.yml
spring:
  profiles:
    active: dev

# application-dev.yml
server:
  port: 8080

# application-prod.yml
server:
  port: 80
```

## 3. 配置加密

```java
@Configuration
public class EncryptConfig {
    @Bean
    public EnvironmentPostProcessor environmentPostProcessor() {
        return new EncryptEnvironmentPostProcessor();
    }
}
```

## 4. 配置绑定

```java
@ConfigurationProperties(prefix = "app")
public class AppProperties {
    private String name;
    private List<String> servers;
    // getters/setters
}
```

## 5. @PropertySource：引入外部配置文件

`@PropertySource` 的职责很窄：把一个外部 `.properties` 文件读进 `Environment`，让 `@Value` 和 `@ConfigurationProperties` 能取到里面的值。它只负责"把这个文件挂到配置链上"，不负责绑定。

### 5.1 基本用法

```java
@Configuration
@PropertySource("classpath:custom.properties")
public class AppConfig {
    @Value("${custom.timeout}")
    private int timeout;
}
```

`custom.properties` 里的 `custom.timeout=30` 会被读进 `Environment`，`@Value` 取到 `30`。

### 5.2 它在配置链上的位置

回顾 §1 的优先级：`@PropertySource` 引入的文件排在 `application.yml` 之后、默认值之前。同名配置下，`application.yml` 会覆盖 `custom.properties`。想让它的优先级更高，默认机制做不到。

### 5.3 两个容易踩的坑

- **Spring Boot 不需要 `@PropertySource` 加载 `application.properties`**——Boot 会自动加载它，`@PropertySource` 只用来引入额外的、非默认命名的文件。这是它和原生 Spring 的最大区别。
- **`@PropertySource` 默认只支持 `.properties`，不支持 YAML**。要加载 `.yml`，得自定义 `PropertySourceFactory`，或者直接用 `spring.config.import` 代替。

### 5.4 选型：`@PropertySource` 还是 `spring.config.import`

`spring.config.import`（见 §6.3）是 Boot 2.4 之后的推荐方式，功能更强：支持 YAML、`optional:` 前缀、多文件导入。`@PropertySource` 的适用场景收窄到两点——非 Boot 环境，或者需要把某个配置文件与特定 `@Configuration` 类绑在一起。Boot 项目里，优先 `spring.config.import`。

## 6. 配置高级场景

### 6.1 配置加密（Jasypt）

```xml
<dependency>
    <groupId>com.github.ulisesbocchio</groupId>
    <artifactId>jasypt-spring-boot-starter</artifactId>
    <version>3.0.5</version>
</dependency>
```

```yaml
# application.yml
jasypt:
  encryptor:
    password: ${JASYPT_PASSWORD}  # 加密密钥通过环境变量传入
    algorithm: PBEWithMD5AndDES

spring:
  datasource:
    password: ENC(加密后的密文)
    # 通过命令行生成密文：
    # java -cp jasypt-1.9.3.jar org.jasypt.intf.cli.JasyptPBEStringEncryptionCLI \n
#     input="yourPassword" password="secretKey" algorithm=PBEWithMD5AndDES
```

### 6.2 配置继承与覆盖

```text
配置加载顺序（高优先级覆盖低优先级）：
1. 命令行参数        --server.port=9090
2. 系统环境变量       SERVER_PORT=9090
3. application-{profile}.yml
4. application.yml
5. @PropertySource
6. 默认值

实际应用：
application.yml        → 公共配置（端口、应用名）
application-dev.yml    → 开发环境（H2 数据库、DEBUG 日志）
application-prod.yml   → 生产环境（MySQL、WARN 日志）
```

### 6.3 配置导入

```yaml
# application.yml
spring:
  config:
    import:
      - classpath:common-datasource.yml
      - optional:classpath:local-config.yml  # optional 表示文件不存在也不报错
      - file:./external-config.yml           # 外部文件
```

### 6.4 自定义配置源

```java
public class DatabasePropertySource extends PropertySource<DataSource> {

    public DatabasePropertySource(DataSource dataSource) {
        super("databasePropertySource", dataSource);
    }

    @Override
    public Object getProperty(String name) {
        // 从数据库查询配置
        try (Connection conn = source.getConnection()) {
            PreparedStatement ps = conn.prepareStatement(
                "SELECT config_value FROM sys_config WHERE config_key = ?");
            ps.setString(1, name);
            ResultSet rs = ps.executeQuery();
            if (rs.next()) {
                return rs.getString("config_value");
            }
        } catch (SQLException e) {
            // ignore
        }
        return null;
    }
}

// 注册自定义配置源
public class DatabaseEnvironmentPostProcessor implements EnvironmentPostProcessor {

    @Override
    public void postProcessEnvironment(ConfigurableEnvironment environment,
            SpringApplication application) {
        DataSource ds = createDataSource();
        environment.getPropertySources()
            .addLast(new DatabasePropertySource(ds));
    }
}
```

### 6.5 配置绑定到 Record

```java
// Java 16+ Record 类型安全绑定
@ConfigurationProperties(prefix = "app.cache")
public record CacheProperties(
    int maxSize,
    Duration ttl,
    boolean enabled,
    List<String> excludedKeys
) {}

// 使用
@Component
public class CacheManager {
    private final CacheProperties props;

    public CacheManager(CacheProperties props) {
        this.props = props;
    }
}
```

**最佳实践：**

1. **敏感信息永远不要提交到 Git**——用环境变量、Secret 或 Jasypt 加密
2. **Profile 配置只放差异部分**——公共配置放 `application.yml`
3. **`@ConfigurationProperties` 优于 `@Value`**——类型安全、支持嵌套、IDE 提示
4. **配置变更要有版本管理**——配合 Nacos Config 实现配置回滚
5. **合理使用 `spring.config.import`**——按模块拆分配置文件
