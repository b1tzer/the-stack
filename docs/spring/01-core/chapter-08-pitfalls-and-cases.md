# 踩坑案例集

> 本章不讲新原理，只做一件事：把社区里被反复讨论、反复踩的真实坑，按「现象 → 排查 → 根因 → 解法 → 关联知识点」拆给你看。每个案例都能追溯到前面某一章的某个小节，读不懂就回去翻。

## 1. 案例 1：@Transactional 不生效——同类方法自调用

### 1.1 现象

![自调用失效](/spring/pitfall-self-invocation.svg)

```java
@Service
public class OrderService {

    public void createOrder() {
        // 业务逻辑...
        this.processPayment();  // 内部调用
    }

    @Transactional
    public void processPayment() {
        // 扣款 + 写库，期望事务保护
        paymentDao.deduct(amount);
        orderDao.updateStatus(orderId, "PAID");
    }
}
```

`processPayment()` 里如果 `orderDao.updateStatus` 抛异常，`paymentDao.deduct` 不会回滚。`@Transactional` 静默失效，不报错。

### 1.2 排查

在 `processPayment` 入口打断点，看 `this.getClass()`——是 `OrderService` 原始类，不是 `OrderService$$EnhancerBySpringCGLIB`。说明调用没走代理。

### 1.3 根因

Spring AOP 靠代理对象拦截方法调用。`this.processPayment()` 调的是目标对象自身的方法，绕过了代理，切面根本没介入。这不是 Spring 的 bug，是 Java 方法调用的基本规则：`this` 永远指向当前对象，不是代理。

这和 AOP 失效的四种情况（[AOP](./chapter-05-aop.md) §6.1 自调用）是同一个根因。

### 1.4 解法

| 方案 | 做法 | 适用场景 |
| :-- | :-- | :-- |
| 拆到不同类 | 把 `processPayment` 移到独立的 `@Service`，通过注入调用 | 新项目，结构清晰 |
| 自注入 | `@Autowired OrderService self;` → `self.processPayment()` | 遗留系统最小改动 |
| AopContext | `((OrderService) AopContext.currentProxy()).processPayment()` | 不改 Bean 结构，需 `@EnableAspectJAutoProxy(exposeProxy=true)` |

三种方案本质相同：让调用走代理对象而非 `this`。

## 2. 案例 2：@Transactional 不生效——异常类型不匹配

### 2.1 现象

```java
@Service
public class FileService {
    @Transactional
    public void importData(String path) throws IOException {
        List<String> lines = Files.readAllLines(Path.of(path));  // 可能抛 IOException
        for (String line : lines) {
            dataDao.insert(parse(line));
        }
    }
}
```

文件读取失败时 `IOException` 抛出，但已插入的数据不回滚。

### 2.2 根因

`@Transactional` 默认只对 `RuntimeException` 和 `Error` 回滚，`IOException` 是 Checked Exception，不在回滚范围。这是 Spring 事务的默认行为，不是 bug。

```java
// Spring 默认配置
@Transactional(rollbackFor = RuntimeException.class)  // 只回滚运行时异常
```

### 2.3 解法

方法级声明（只影响当前方法，所有版本可用）：

```java
@Transactional(rollbackFor = Exception.class)  // 所有异常都回滚
```

全局默认（改整个应用，Spring Framework 6.2 / Spring Boot 3.4+）：

```java
@Configuration
@EnableTransactionManagement(rollbackOn = RollbackOn.ALL_EXCEPTIONS)
public class TxConfig {
}
```

`rollbackOn` 是 `@EnableTransactionManagement` 在 Spring Framework 6.2 新增的属性，`RollbackOn` 枚举（`org.springframework.transaction.annotation.RollbackOn`）只有两个值：`RUNTIME_EXCEPTIONS`（默认）和 `ALL_EXCEPTIONS`。

Spring Boot 默认已自动开启事务管理，通常不需要写 `@EnableTransactionManagement`。要改全局回滚行为，就在任意 `@Configuration` 类上手动加这行——Boot 检测到用户声明后会让出自己的自动配置，以你写的 `rollbackOn` 为准。

两种写法怎么选：方法级 `rollbackFor` 意图明确、只影响单个方法，是新项目最稳的写法；全局开关适合统一治理存量项目，但它会让原本「Checked Exception 提交」的方法整体反转，改之前要先确认没有代码依赖旧的默认提交行为。

为什么默认是 `RuntimeException` 而不是 `Exception`？社区围绕这个问题讨论了很多年（[Issue #23473](https://github.com/spring-projects/spring-framework/issues/23473)）。官方没有直接改默认值——那会让存量应用的提交行为静默反转，属于破坏性变更——而是新增 `rollbackOn` 属性，让开发者显式选择。Kotlin 项目（异常不区分受检与否）官方建议直接切到 `ALL_EXCEPTIONS`。

## 3. 案例 3：@Async + 循环依赖——异步变同步

### 3.1 现象

![Async + 循环依赖](/spring/pitfall-async-circular.svg)

```java
@Service
public class OrderService {
    @Autowired
    private NotificationService notificationService;

    public void createOrder() {
        // ...
        notificationService.sendNotification(orderId);  // 期望异步
    }
}

@Service
public class NotificationService {
    @Autowired
    private OrderService orderService;

    @Async
    public void sendNotification(Long orderId) {
        // 发短信、发邮件，耗时操作
    }
}
```

这段代码在 Spring Boot 2.6 之前（或纯 Spring，默认允许循环依赖）启动不报错：`sendNotification` 标了 `@Async`，但监控发现它一直是同步执行，接口 P99 耗时翻倍。Boot 2.6 起默认禁止循环依赖，同样的代码启动时直接报循环依赖错误，走不到「异步变同步」这一步。

### 3.2 排查

1. 启动时没报错，两个 Bean 都创建成功（仅 Boot 2.6 之前 / 纯 Spring）
2. 在 `sendNotification` 里打印线程名：`main`，不是 `task-1`
3. 检查 `OrderService` 拿到的 `notificationService` 的类型——是原始对象，不是代理

### 3.3 根因

`OrderService` 和 `NotificationService` 存在循环依赖。三级缓存在提前暴露时调用 `getEarlyBeanReference`（[循环依赖与三级缓存](./chapter-06-circular-dependency.md) §4），但 `AsyncAnnotationBeanPostProcessor` **没有重写 `getEarlyBeanReference`**，所以提前拿到的是裸对象，没有 `@Async` 代理。

`@Transactional` 和 `@Aspect` 的处理器重写了这个方法，能安全参与循环依赖；`@Async` 没有。这是 Spring 的设计立场：循环依赖是坏味道，不值得为它改造所有处理器。Boot 2.6 默认禁止循环依赖，就是这个立场的落地。

### 3.4 解法

| 方案 | 做法 |
| :-- | :-- |
| 消除循环依赖（推荐） | 拆出公共组件，或用事件解耦 |
| 用 `@Lazy` 打破循环 | `@Lazy @Autowired NotificationService`，延迟到首次使用时才创建 |
| 开启 `allow-circular-references` | 不解决 `@Async` 失效：只把「启动报错」换成「启动成功但 `@Async` 静默失效」 |

**结论：循环依赖 + @Async = 定时炸弹。** 消除循环依赖是治本；`@Lazy` 能保住 `@Async` 生效，是可行的治标手段，但循环依赖仍在。

## 4. 案例 4：@Configuration vs @Component——单例悄悄失效

### 4.1 现象

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

### 4.2 根因

`@Component` 上的 `@Bean` 方法之间是普通的 Java 方法调用，没有代理拦截。`jdbcTemplate()` 里调 `dataSource()`，每次都 `new` 一个新的 `HikariDataSource`，单例语义丢失。

`@Configuration` 会触发 CGLIB 增强（[IoC 容器](./chapter-02-ioc-container.md) §5.1），生成子类重写 `@Bean` 方法，第二次调用直接返回容器里的缓存实例。

### 4.3 解法

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

## 5. 案例 5：@Value 注入 null——配置属性找不到

### 5.1 现象

```java
@Service
public class PayService {
    @Value("${pay.alipay.app-id}")
    private String appId;  // 运行时为 null
}
```

`application.yml` 里明明配了 `pay.alipay.app-id`，但注入是 null，不报错。

### 5.2 排查清单

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

### 5.3 解法

- 属性名严格一致（推荐用中划线 `app-id`，跟 Spring Boot 默认风格对齐）
- 确保类被 `@Component` / `@Service` 管理
- 非 Boot 项目加 `@PropertySource("classpath:application.properties")`
- 测试环境用 `@TestPropertySource` 或 `@SpringBootTest`

## 6. 案例 6：@ConditionalOnBean 不生效——Bean 扫描顺序问题

### 6.1 现象

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

### 6.2 根因

`@ConditionalOnBean` 在 BeanDefinition 注册阶段就执行判断（[条件装配](./chapter-07-conditional-profile.md) §1），此时只查 `BeanDefinitionRegistry` 里**已注册**的 BeanDefinition。

如果 `RedisConnectionFactory` 的定义在 `CacheConfig` 之后才被扫描到，判断时它还不在注册表里，条件就不满足。

Spring 的扫描顺序受 `@ComponentScan` 的 `basePackages`、类的包路径、文件系统排序等多种因素影响，**不能依赖扫描顺序保证 `@ConditionalOnBean` 生效**。

### 6.3 解法

| 方案 | 做法 |
| :-- | :-- |
| 用 `@ConditionalOnClass`（推荐） | 检查类路径上有没有某个类，不受扫描顺序影响 |
| 用 `@AutoConfigureAfter` | Boot 自动配置专用，显式指定加载顺序 |
| 合并到同一个 `@Configuration` | 让两个 Bean 在同一个类里定义，保证顺序 |

**经验法则：`@ConditionalOnBean` 适合「用户已经定义了某个 Bean，框架就退让」的场景（如 `@ConditionalOnMissingBean`），不适合「框架自己定义的 Bean 之间做条件判断」。**

## 7. 案例 7：prototype Bean 的 @PreDestroy 不触发

### 7.1 现象

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

### 7.2 根因

Spring 容器对 prototype Bean 的管理边界是：**创建时管，销毁时不管**。

- singleton Bean：容器持有引用，关闭时逐一回调 `@PreDestroy`
- prototype Bean：容器创建后就交出去了，不持有引用，不知道何时销毁，也不回调 `@PreDestroy`

这不是 bug，是作用域的定义（[Bean 生命周期](./chapter-03-bean-lifecycle.md) §9.1）。

### 7.3 解法

| 方案 | 做法 |
| :-- | :-- |
| 改用 singleton（如果状态可共享） | 去掉 `@Scope("prototype")` |
| 自己管理生命周期 | 让调用方负责关闭，或实现 `DisposableBean` 手动调用 |
| 用 `ObjectFactory` / `Provider` | `@Autowired ObjectProvider<ReportGenerator>`，每次 `getObject()` 拿新实例，释放由调用方负责 |

**经验法则：prototype Bean 不能依赖容器销毁。持有资源（连接、文件、锁）的类要么用 singleton，要么自己管生命周期。**

## 8. 案例 8：多线程下 @Transactional 失效

### 8.1 现象

![多线程事务失效](/spring/pitfall-thread-transaction.svg)

```java
@Service
public class BatchService {
    @Autowired
    private OrderDao orderDao;

    @Autowired
    private ExecutorService executor;

    @Transactional
    public void batchProcess(List<Order> orders) {
        List<Future<?>> futures = orders.stream()
            .map(order -> executor.submit(() -> {
                orderDao.insert(order);  // 子线程里操作
            }))
            .collect(Collectors.toList());

        // 等所有子任务完成
        futures.forEach(f -> { try { f.get(); } catch (Exception e) { throw new RuntimeException(e); } });

        // 如果某个子线程失败，主线程抛异常，但子线程的 insert 不会回滚
    }
}
```

子线程抛异常，主线程回滚了，但子线程已经提交的数据不回滚。

### 8.2 根因

Spring 事务绑定在 `ThreadLocal` 上（[事务管理](../04-data-access/chapter-04-transaction.md)），每个线程有自己的事务上下文。子线程拿不到主线程的事务，各自独立提交，不受主线程回滚影响。

```txt
主线程事务 ──────────────────────────────────── 回滚 ✅
  ├─ 子线程1: 独立事务 ──── 已提交 ❌ 不回滚
  ├─ 子线程2: 独立事务 ──── 已提交 ❌ 不回滚
  └─ 子线程3: 独立事务 ──── 异常但无事务 ❌
```

### 8.3 解法

| 方案 | 做法 | 适用场景 |
| :-- | :-- | :-- |
| 主线程统一操作（推荐） | 不开子线程，所有 DB 操作在主线程事务内完成 | 数据量不大 |
| 编程式事务 | 子线程里手动 `TransactionTemplate.execute()` | 子任务需要独立事务 |
| 两阶段提交 | 用消息队列 + 本地事务表 | 分布式场景 |

**经验法则：`@Transactional` 的边界就是当前线程。想跨线程共享事务，要么不用多线程，要么用编程式事务。**

## 9. 案例索引

| 案例 | 涉及知识点 |
| :-- | :-- |
| 1. @Transactional 自调用失效 | [AOP](./chapter-05-aop.md) §6.1 自调用 |
| 2. @Transactional 异常类型不匹配 | 事务回滚规则（Checked vs Unchecked） |
| 3. @Async + 循环依赖变同步 | [循环依赖](./chapter-06-circular-dependency.md) §4、§5 三级缓存与 @Async |
| 4. @Configuration vs @Component | [IoC 容器](./chapter-02-ioc-container.md) §5.1 CGLIB 增强 |
| 5. @Value 注入 null | [条件装配](./chapter-07-conditional-profile.md) §4 Environment / PropertySource |
| 6. @ConditionalOnBean 不生效 | [条件装配](./chapter-07-conditional-profile.md) §1 BeanDefinition 注册阶段 |
| 7. prototype @PreDestroy 不触发 | [Bean 生命周期](./chapter-03-bean-lifecycle.md) §9.1 作用域 |
| 8. 多线程事务失效 | [事务管理](../04-data-access/chapter-04-transaction.md) ThreadLocal 绑定 |
