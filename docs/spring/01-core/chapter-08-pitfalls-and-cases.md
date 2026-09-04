# 踩坑案例集

> 本章不讲新原理，只做一件事：把社区里被反复讨论、反复踩的真实坑，按「现象 → 排查 → 根因 → 解法 → 关联知识点」拆给你看。每个案例都能追溯到前面某一章的某个小节，读不懂就回去翻。
>
> `@Transactional` 失效的坑（自调用、异常类型、多线程）已并入 [事务管理](../04-data-access/chapter-04-transaction.md) §4；`@Async` 失效（含循环依赖场景）已并入 [异步处理](../07-async-and-messaging/chapter-02-async.md) §2，本章不再重复。

## 1. @Configuration vs @Component——单例悄悄失效

### 1.1 现象

![Configuration vs Component](/spring/pitfall-config-vs-component.svg)

```java
@Component  // ← 用了 @Component 而不是 @Configuration
public class DataSourceConfig {

    @Bean
    public DataSource dataSource() {
        return new HikariDataSource();
    }

    @Bean
    public JdbcTemplate jdbcTemplate() {
        return new JdbcTemplate(dataSource());  // 调用同类的 @Bean 方法
    }
}
```

运行时发现容器里有两个 `HikariDataSource` 实例，连接池翻倍，数据库连接数超限。

### 1.2 根因

`@Component` 上的 `@Bean` 方法之间是普通的 Java 方法调用，没有代理拦截。`jdbcTemplate()` 里调 `dataSource()`，每次都 `new` 一个新的 `HikariDataSource`，单例语义丢失。

`@Configuration` 会触发 CGLIB 增强（[IoC 容器](./chapter-02-ioc-container.md#config-class-processor)），生成子类重写 `@Bean` 方法，第二次调用直接返回容器里的缓存实例。

### 1.3 解法

```java
@Configuration  // ← 改成 @Configuration
public class DataSourceConfig {
    // ...
}
```

或者用方法参数注入（不依赖 CGLIB）：

```java
@Component
public class DataSourceConfig {
    @Bean
    public JdbcTemplate jdbcTemplate(DataSource dataSource) {
        return new JdbcTemplate(dataSource);  // 容器注入，保证单例
    }
}
```

**经验法则：有 `@Bean` 方法互相调用的配置类，必须用 `@Configuration`。**

## 2. @Value 注入 null——配置属性找不到

### 2.1 现象

```java
@Service
public class PayService {
    @Value("${pay.alipay.app-id}")
    private String appId;  // 运行时为 null
}
```

`application.yml` 里明明配了 `pay.alipay.app-id`，但注入是 null，不报错。

### 2.2 排查清单

| 检查项 | 怎么查 |
| :-- | :-- |
| 属性名拼写 | 大小写、中划线 vs 驼峰 |
| 多环境覆盖 | `application-dev.yml` 是否覆盖了 `application.yml` 的值 |
| 配置文件位置 | `classpath:/` vs `file:` vs `config/` |
| 非 Spring 管理的对象 | 手动 `new` 的类，`@Value` 不生效 |
| 启动类缺少 `@PropertySource` | 非 Spring Boot 项目需要手动声明 |

最常见的根因有两种：

**根因 A：属性名不一致**

```yaml
# yml 里用了驼峰
pay:
  alipay:
    appId: xxx   # ← appId

# 代码里用了中划线
@Value("${pay.alipay.app-id}")  # ← app-id，对不上
```

YAML 里 `appId` 和 `app-id` 在 Spring Boot 的 relaxed binding 下都能读到，但 `@Value` 不走 relaxed binding，必须严格匹配。

**根因 B：对象不在容器里**

```java
PayService service = new PayService();  // 手动 new
// service.appId == null，因为没走容器
```

### 2.3 解法

- 属性名严格一致（推荐用中划线 `app-id`，跟 Spring Boot 默认风格对齐）
- 确保类被 `@Component` / `@Service` 管理
- 非 Boot 项目加 `@PropertySource("classpath:application.properties")`
- 测试环境用 `@TestPropertySource` 或 `@SpringBootTest`

## 3. @ConditionalOnBean 不生效——Bean 扫描顺序问题

### 3.1 现象

```java
@Configuration
public class CacheConfig {
    @Bean
    @ConditionalOnBean(RedisConnectionFactory.class)  // 期望：有 Redis 连接工厂才创建
    public CacheManager redisCacheManager() {
        return new RedisCacheManager();
    }
}
```

`RedisConnectionFactory` 已经通过 `@Configuration` 定义了，但 `redisCacheManager` 始终不创建。

### 3.2 根因

`@ConditionalOnBean` 在 BeanDefinition 注册阶段就执行判断（[条件装配](./chapter-07-conditional-profile.md) §1），此时只查 `BeanDefinitionRegistry` 里**已注册**的 BeanDefinition。

如果 `RedisConnectionFactory` 的定义在 `CacheConfig` 之后才被扫描到，判断时它还不在注册表里，条件就不满足。

Spring 的扫描顺序受 `@ComponentScan` 的 `basePackages`、类的包路径、文件系统排序等多种因素影响，**不能依赖扫描顺序保证 `@ConditionalOnBean` 生效**。

### 3.3 解法

「有 Bean 才创建」的正确做法取决于真实意图：

| 真实意图 | 正确写法 | 说明 |
| :-- | :-- | :-- |
| 确实依赖该 Bean，缺了就该报错 | 方法参数直接注入 `redisCacheManager(RedisConnectionFactory factory)` | 最常见场景，Spring 保证注入 |
| 有则用、无则降级 | `ObjectProvider<RedisConnectionFactory>` + `getIfAvailable()` | 需要可选依赖时 |
| 是否启用由配置决定 | `@ConditionalOnProperty(name="spring.cache.type", havingValue="redis")` | 用配置开关，不靠扫描顺序 |
| 可复用框架 / Starter | 做成 `@AutoConfiguration` + `AutoConfiguration.imports`，配合 `@AutoConfigureAfter` | 仅框架场景 |

**经验法则：`@ConditionalOnBean` 只能可靠地用在自动配置类上。用户普通 `@Configuration` 里用它判断「另一个 Bean 是否存在」，本质不可靠。**

## 4. prototype Bean 的 @PreDestroy 不触发

### 4.1 现象

![prototype @PreDestroy](/spring/pitfall-prototype-scope.svg)

```java
@Component
@Scope("prototype")
public class ReportGenerator {
    private FileOutputStream fos;

    @PostConstruct
    public void init() throws FileNotFoundException {
        fos = new FileOutputStream("/tmp/report.csv");  // 初始化：打开文件
    }

    @PreDestroy
    public void cleanup() throws IOException {
        fos.close();  // 销毁：关闭文件
    }
}
```

`@PostConstruct` 正常执行，但 `@PreDestroy` 从不执行，文件句柄泄漏。

### 4.2 根因

Spring 容器对 prototype Bean 的管理边界是：**创建时管，销毁时不管**。

- singleton Bean：容器持有引用，关闭时逐一回调 `@PreDestroy`
- prototype Bean：容器创建后就交出去了，不持有引用，不知道何时销毁，也不回调 `@PreDestroy`

这不是 bug，是作用域的定义（[IoC 容器](./chapter-02-ioc-container.md#singleton-vs-prototype)）。

### 4.3 解法

| 方案 | 做法 |
| :-- | :-- |
| 改用 singleton（如果状态可共享） | 去掉 `@Scope("prototype")` |
| 自己管理生命周期 | 让调用方负责关闭，或实现 `DisposableBean` 手动调用 |
| 用 `ObjectFactory` / `Provider` | `@Autowired ObjectProvider<ReportGenerator>`，每次 `getObject()` 拿新实例，释放由调用方负责 |

**经验法则：prototype Bean 不能依赖容器销毁。持有资源（连接、文件、锁）的类要么用 singleton，要么自己管生命周期。**

## 5. 案例索引

| 案例 | 涉及知识点 |
| :-- | :-- |
| 1. @Configuration vs @Component | [IoC 容器](./chapter-02-ioc-container.md#config-class-processor) §6.1 CGLIB 增强 |
| 2. @Value 注入 null | [条件装配](./chapter-07-conditional-profile.md#environment) §4 属性来源 |
| 3. @ConditionalOnBean 不生效 | [条件装配](./chapter-07-conditional-profile.md) §1 BeanDefinition 注册阶段 |
| 4. prototype @PreDestroy 不触发 | [IoC 容器](./chapter-02-ioc-container.md#singleton-vs-prototype) §5.1 作用域 |
