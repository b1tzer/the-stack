# 外部化配置

## 1. 配置来源

### 1.1 配置优先级

命令行参数 > 系统环境变量 > application-{profile}.yml > application.yml > @PropertySource

这条优先级链的底层是 Spring 的 `Environment` 抽象：

- `Environment`（`org.springframework.core.env.Environment`）是配置的统一入口，通过 `getProperty(key)` 读取任意配置项。
- `PropertySource`（`org.springframework.core.env.PropertySource`）表示一个配置源。命令行参数、系统环境变量、每个 yml 文件，各对应一个 `PropertySource`。
- 这些 `PropertySource` 组成一个有序的 `PropertySources` 列表，`getProperty` 从头到尾依次查找，先找到的就返回。

所以上面那张优先级表，本质就是 `PropertySources` 列表的排列顺序：排在前面的 `PropertySource` 先被查询，先到先得。

子接口 `ConfigurableEnvironment` 允许增删 `PropertySource`，§3.2 的自定义配置源正是通过它把新配置源挂进这个列表。

### 1.2 多环境 Profile

同一份代码部署到开发、测试、生产环境时，只有少数配置不同（端口、数据库地址、日志级别）。Profile 用 `application-{profile}.yml` 按环境拆分配置，运行时用 `spring.profiles.active` 指定激活哪一份：

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

`spring.profiles.active=dev` 时，Spring 同时加载 `application.yml`（公共配置）和 `application-dev.yml`（dev 专属配置），后者覆盖前者同名项。

### 1.3 @PropertySource：引入外部配置文件

`@PropertySource` 的职责很窄：把一个外部 `.properties` 文件读进 `Environment`，让 `@Value` 和 `@ConfigurationProperties` 能取到里面的值。它只负责"把这个文件挂到配置链上"，不负责绑定。

#### 1.3.1 基本用法

```java
@Configuration
@PropertySource("classpath:custom.properties")
public class AppConfig {
    @Value("${custom.timeout}")
    private int timeout;
}
```

`custom.properties` 里的 `custom.timeout=30` 会被读进 `Environment`，`@Value` 取到 `30`。

#### 1.3.2 它在配置链上的位置

回顾 §1.1 的优先级：`@PropertySource` 引入的文件排在 `application.yml` 之后、默认值之前。同名配置下，`application.yml` 会覆盖 `custom.properties`。想让它的优先级更高，默认机制做不到。

#### 1.3.3 两个容易踩的坑

- **Spring Boot 不需要 `@PropertySource` 加载 `application.properties`**——Boot 会自动加载它，`@PropertySource` 只用来引入额外的、非默认命名的文件。这是它和原生 Spring 的最大区别。
- **`@PropertySource` 默认只支持 `.properties`，不支持 YAML**。要加载 `.yml`，得自定义 `PropertySourceFactory`，或者直接用 `spring.config.import` 代替。

#### 1.3.4 选型：`@PropertySource` 还是 `spring.config.import`

`spring.config.import`（见 §1.4）是 Boot 2.4 之后的推荐方式，功能更强：支持 YAML、`optional:` 前缀、多文件导入。`@PropertySource` 的适用场景收窄到两点——非 Boot 环境，或者需要把某个配置文件与特定 `@Configuration` 类绑在一起。Boot 项目里，优先 `spring.config.import`。

### 1.4 spring.config.import 配置导入

`spring.config.import`（Boot 2.4+）把额外的配置文件合并进当前配置，是 `@PropertySource` 的推荐替代（见 §1.3.4）。它支持 `classpath:` 与 `file:` 两种位置，`optional:` 前缀表示文件缺失时不报错：

```yaml
# application.yml
spring:
  config:
    import:
      - classpath:common-datasource.yml
      - optional:classpath:local-config.yml  # optional 表示文件不存在也不报错
      - file:./external-config.yml           # 外部文件
```

## 2. 配置绑定

### 2.1 @ConfigurationProperties 绑定

`@ConfigurationProperties` 把一组 `app.*` 前缀的配置项批量绑定到一个 POJO 上，比逐个写 `@Value("${app.name}")` 省事。它通过 setter 注入值，因此 POJO 需要 getter/setter：

```java
@ConfigurationProperties(prefix = "app")
public class AppProperties {
    private String name;
    private List<String> servers;
    // getters/setters
}
```

绑定后，`app.name`、`app.servers[0]` 这类配置项会自动映射到对应字段。与 `@Value` 的对比见 §2.4。

### 2.2 校验

`@ConfigurationProperties` 支持 JSR-303 校验注解，在绑定时自动验证配置值：

```java
@ConfigurationProperties(prefix = "my.app")
@Validated
public class MyAppProperties {

    @NotBlank(message = "应用名称不能为空")
    private String name;

    @Min(value = 1, message = "版本号必须大于 0")
    private int majorVersion;

    @Size(min = 1, max = 100, message = "功能列表长度 1-100")
    private List<String> features;

    @Email(message = "管理员邮箱格式不正确")
    private String adminEmail;

    // getter/setter
}
```

启动时如果配置值不满足校验规则，会抛出 `BindException`，应用无法启动——这比运行时空指针好得多。

### 2.3 配置绑定到 Record

Java 16+ 可以用 `Record` 承接配置绑定。与 POJO 不同，`Record` 走构造器绑定，字段不可变、无需 setter：

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

### 2.4 @ConfigurationProperties vs @Value

| 特性 | @ConfigurationProperties | @Value |
| :-- | :-----------------------: | :-----: |
| 松散绑定 | ✅ `pool-size` → `poolSize` | ❌ |
| 元数据提示 | ✅ IDE 自动补全 | ❌ |
| 校验 @Validated | ✅ | ❌ |
| 复杂类型（List/Map） | ✅ | ⚠️ 需 SpEL |
| 默认值 | 字段初始值 | `${key:default}` |

::: warning setter 是必须的
`@ConfigurationProperties` 的 setter 方法是必须的——Spring 通过 setter 注入值，不是通过字段反射。如果你的 POJO 没有 setter，绑定不会生效。
:::

## 3. 配置的安全与扩展

### 3.1 配置加密（Jasypt）

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

方案对比：

| 方案 | 安全性 | 复杂度 | 适用场景 |
| :-- | :-----: | :-----: | :-- |
| 环境变量 | ✅ 高 | 低 | Docker / K8s |
| Jasypt | ✅ 中 | 中 | 传统部署 |
| Vault（HashiCorp） | ✅ 高 | 高 | 企业级密钥管理 |
| K8s Secret | ✅ 高 | 中 | Kubernetes 环境 |

::: warning 主密钥安全
不要把 Jasypt 的主密钥也写在 `application.yml` 里——这就等于把保险箱钥匙放在保险箱上面。主密钥必须通过环境变量或启动参数注入。
:::

### 3.2 自定义配置源

当配置不在文件里、而在数据库中时，可以自定义 `PropertySource` 从数据库读取。它承接 §1.1 的抽象：自定义一个 `PropertySource` 子类，再通过 `EnvironmentPostProcessor` 把它挂进 `ConfigurableEnvironment` 的 `PropertySources` 列表：

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

**最佳实践：**

1. **敏感信息永远不要提交到 Git**——用环境变量、Secret 或 Jasypt 加密
2. **Profile 配置只放差异部分**——公共配置放 `application.yml`
3. **`@ConfigurationProperties` 优于 `@Value`**——类型安全、支持嵌套、IDE 提示
4. **配置变更要有版本管理**——配合 Nacos Config 实现配置回滚
5. **合理使用 `spring.config.import`**——按模块拆分配置文件
