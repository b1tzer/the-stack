# 第 01 章：Spring 核心原理

## 1.1 Spring 核心概览

### 1.1.1 为什么会有 Spring

**一句话痛点：** 2002 年的 Java 企业开发被 EJB 2.x 绑架——写一个最简单的业务组件，却要继承 SessionBean、实现一堆回调接口、部署到笨重的应用服务器、忍受长达数十秒的启动时间。

**EJB 2.x 的四个致命痛点：**

1. **组件膨胀**：一个无状态会话 Bean 需要 Home 接口、Remote 接口、Bean 实现类、ejb-jar.xml 部署描述符，四个文件才能写一个 Hello World。
2. **强制容器依赖**：业务代码必须运行在 EJB 容器（WebLogic、WebSphere）中，单元测试几乎不可能脱离容器进行。
3. **持久化笨重**：Entity Bean 要求容器管理持久化（CMP），配置复杂、性能差，开发者对 SQL 完全失去控制。
4. **侵入性极强**：业务类被迫实现 `SessionBean`、`EntityBean` 等接口，框架代码渗透到业务逻辑中。

**Rod Johnson 的反击：**

2002 年，Rod Johnson 出版《Expert One-on-One J2EE Design and Development》，提出了两个颠覆性思想：

- **IoC（控制反转）**：对象不再自己创建依赖，而是由外部容器"注入"进来。
- **AOP（面向切面编程）**：横切关注点（事务、日志、安全）从业务代码中剥离，通过切面织入。

```java
// ❌ EJB 2.x 写法：4 个文件才能写一个业务方法
// HelloBean.java
public class HelloBean implements SessionBean {
    private SessionContext ctx;
    public void ejbCreate() {}
    public void ejbRemove() {}
    public void ejbActivate() {}
    public void ejbPassivate() {}
    public void setSessionContext(SessionContext ctx) { this.ctx = ctx; }
    public String sayHello() { return "Hello"; }
}

// ✅ Spring 写法：一个类搞定
@Service
public class HelloService {
    public String sayHello() {
        return "Hello";
    }
}
```

**Spring 的定位：** 它不是一个应用服务器，而是一个轻量级容器——只做两件事：帮你管理对象（IoC）和帮你抽取横切逻辑（AOP）。代码干净、可测试、不依赖任何特定容器。

---

### 1.1.2 版本演进与时代问题

**一句话痛点：** Spring 从 2004 年的 1.0 到 2022 年的 6.0，每一次大版本迭代都不是"新功能"，而是对当时开发痛点的直接回应。

| 版本 | 年份 | 核心变化 | 解决的问题 |
|------|------|---------|-----------|
| 1.0 | 2004 | XML 配置，IoC + AOP | 替代 EJB，轻量级容器 |
| 2.5 | 2007 | `@Autowired`、`@Component` 注解 | XML 配置过于冗长 |
| 3.0 | 2009 | `@Configuration`、JavaConfig、条件注解 | 消灭 XML |
| 4.0 | 2013 | `@Conditional`、泛型注入 | 精细化条件装配 |
| Boot 1.0 | 2014 | 自动配置、Starter | 配置地狱 |
| 5.0 | 2017 | WebFlux、响应式编程 | 高并发场景 |
| 6.0 | 2022 | 基准 Java 17、GraalVM 原生编译 | 启动速度、云原生 |

**因果链：** XML 太重 → 引入注解 → 注解太多需要 JavaConfig 管理 → 配置还是太多 → Spring Boot 自动配置 → 微服务需要更快启动 → 响应式 + 原生镜像。

```java
// Spring 1.0：XML 地狱
// applicationContext.xml
<bean id="userService" class="com.example.UserService">
    <property name="userDao" ref="userDao"/>
</bean>

// Spring 2.5：注解来了
@Service
public class UserService {
    @Autowired
    private UserDao userDao;
}

// Spring 3.0+：JavaConfig
@Configuration
@ComponentScan("com.example")
public class AppConfig {
    @Bean
    public UserService userService(UserDao userDao) {
        return new UserService(userDao);
    }
}
```

**踩坑提醒：** Spring Boot 2.7 起 `spring.factories` 已被标记为 deprecated，3.0 起只支持 `META-INF/spring/org.springframework.boot.autoconfigure.AutoConfiguration.imports`。升级时务必检查自动配置注册方式。

---

### 1.1.3 框架版图与模块分层

**一句话痛点：** Spring 模块几十个，但核心只有三层——搞清楚这三层，其余都是上层建筑。

**Spring 核心三层：**

| 层级 | 模块 | 职责 |
|------|------|------|
| **底层基础** | `spring-core` | IoC 容器的基础工具：资源加载、类型转换、反射工具 |
| **Bean 管理** | `spring-beans` | BeanFactory、BeanDefinition、属性注入 |
| **容器上层** | `spring-context` | ApplicationContext、事件机制、注解支持、Environment |

**BeanFactory vs ApplicationContext：**

```java
// BeanFactory：最基础的容器，懒加载
BeanFactory factory = new DefaultListableBeanFactory();
// 手动注册 BeanDefinition
((DefaultListableBeanFactory) factory)
    .registerBeanDefinition("user", bd);

// ApplicationContext：功能齐全的容器，预加载
ApplicationContext ctx = new AnnotationConfigApplicationContext(AppConfig.class);
User user = ctx.getBean(User.class); // 直接拿
```

| 能力 | BeanFactory | ApplicationContext |
|------|:-----------:|:------------------:|
| Bean 生命周期管理 | ✅ | ✅ |
| AOP 支持 | ✅ | ✅ |
| 国际化 MessageSource | ❌ | ✅ |
| 事件发布 ApplicationEvent | ❌ | ✅ |
| 资源加载 ResourcePatternResolver | ❌ | ✅ |
| Environment 抽象 | ❌ | ✅ |

**结论：** 除非你在写框架底层代码（需要精确控制 Bean 的加载时机），否则永远用 `ApplicationContext`。Spring Boot 自动创建的就是 `AnnotationConfigServletWebServerApplicationContext`。

---

### 1.1.4 知识地图

**一句话痛点：** 学 Spring 最怕东一榔头西一棒子——你需要一条主线把所有知识点串起来。

**学习主线（因果链）：**

```
IoC 容器启动
  → 解析 @Configuration / @Component → 生成 BeanDefinition
  → BeanFactoryPostProcessor（修改 BeanDefinition）
  → 实例化 Bean
  → 依赖注入（构造器 / Setter / 字段）
  → BeanPostProcessor（AOP 代理在此处创建）
  → 初始化回调（@PostConstruct → InitializingBean → init-method）
  → 容器就绪，Bean 可用
  → 销毁回调（@PreDestroy → DisposableBean → destroy-method）
```

**进阶路径：**

1. **IoC 基础** → 理解控制反转的本质
2. **Bean 生命周期** → 知道一个 Bean 从出生到死亡的全过程
3. **依赖注入** → 掌握三种注入方式和常见注解
4. **循环依赖** → 理解三级缓存如何解决属性注入的循环
5. **AOP** → 掌握切面编程和代理机制
6. **条件装配** → 理解 Spring Boot 自动配置的底层原理

> **建议：** 学完每一块都去看对应源码，不看源码的 Spring 学习等于空中楼阁。

---

## 1.2 IoC 容器

### 1.2.1 控制反转的本质

**一句话痛点：** 你 new 一个对象，它的依赖也得你 new——这就是"控制"。IoC 让你把"谁来创建依赖"这个决定权交出去。

**传统方式 vs IoC：**

```java
// ❌ 传统方式：自己控制依赖的创建
public class OrderService {
    private UserDao userDao = new UserDao();          // 硬编码依赖
    private EmailService emailService = new EmailService(); // 硬编码依赖
    
    public void createOrder(Order order) {
        userDao.save(order);
        emailService.send(order);
    }
}
// 问题：
// 1. 无法替换成 Mock 对象做单元测试
// 2. 依赖变更时必须改源码
// 3. 对象生命周期无法统一管理

// ✅ IoC 方式：依赖由外部注入
@Service
public class OrderService {
    private final UserDao userDao;
    private final EmailService emailService;
    
    // 构造器注入：依赖从外部传入，自己不创建
    public OrderService(UserDao userDao, EmailService emailService) {
        this.userDao = userDao;
        this.emailService = emailService;
    }
    
    public void createOrder(Order order) {
        userDao.save(order);
        emailService.send(order);
    }
}
```

**IoC 的本质不是一种技术，而是一种思想：** "Don't call us, we'll call you"——你不用主动去找依赖，容器会把依赖送到你面前。Spring IoC 容器是这种思想的一种实现，其他实现还有 Google Guice、Jakarta CDI 等。

**依赖注入（DI）是 IoC 的实现方式：** IoC 描述的是"控制权反转"这个现象，DI 描述的是"通过构造器/Setter/字段把依赖传进来"这个具体手法。两者经常互换使用。

**踩坑提醒：** 有人说"IoC 就是 DI"，这不准确。IoC 是设计原则，DI 是实现手段。事件驱动（容器在适当时机回调你）也是 IoC 的一种实现。

---

### 1.2.2 BeanFactory 与 ApplicationContext

**一句话痛点：** BeanFactory 是"毛坯房"，ApplicationContext 是"精装修"——你几乎永远不需要毛坯房。

**懒加载 vs 预加载：**

```java
// BeanFactory 默认懒加载：getBean() 时才创建
BeanFactory factory = new DefaultListableBeanFactory();
// 此时 Bean 还没创建
Object bean = factory.getBean("myService"); // 调用时才实例化

// ApplicationContext 默认预加载：启动时就创建所有单例
ApplicationContext ctx = new AnnotationConfigApplicationContext(Config.class);
// refresh() 完成时，所有单例 Bean 已经就绪
Object bean = ctx.getBean("myService"); // 直接拿，无需等待
```

**ApplicationContext 多出的四个能力：**

```java
// 1. 国际化
String msg = ctx.getMessage("greeting", new Object[]{"张三"}, Locale.CHINA);

// 2. 事件发布
ctx.publishEvent(new OrderCreatedEvent(order));

// 3. 资源加载
Resource[] resources = ctx.getResources("classpath:templates/*.html");

// 4. 环境抽象
String profile = ctx.getEnvironment().getActiveProfiles()[0];
String value = ctx.getEnvironment().getProperty("app.name");
```

**ApplicationContext 的常见实现：**

| 实现类 | 用途 |
|--------|------|
| `AnnotationConfigApplicationContext` | 纯 Java 配置，非 Web |
| `ClassPathXmlApplicationContext` | XML 配置（遗留项目） |
| `AnnotationConfigServletWebServerApplicationContext` | Spring Boot Web 应用 |
| `AnnotationConfigReactiveWebServerApplicationContext` | Spring WebFlux 应用 |

**踩坑提醒：** `ApplicationContext` 预加载意味着启动时就会发现配置错误（如缺少依赖 Bean），这是好事——不要为了"优化启动"而改用 `@Lazy` 全局懒加载，这会把问题推迟到运行时。

---

### 1.2.3 refresh() 十二步

**一句话痛点：** `ApplicationContext` 的 `refresh()` 方法是 Spring 容器的心跳——理解这十二步，就理解了容器启动的全部秘密。

```java
// AnnotationConfigApplicationContext 的构造函数
public AnnotationConfigApplicationContext(Class<?>... componentClasses) {
    this();
    register(componentClasses);
    refresh(); // 核心！
}
```

**十二步拆解（简化为关键步骤）：**

| 步骤 | 方法 | 做什么 |
|------|------|--------|
| 1 | `prepareRefresh()` | 设置启动时间、active 标志、初始化属性源 |
| 2 | `obtainFreshBeanFactory()` | 获取 BeanFactory（Web 环境下刷新） |
| 3 | `prepareBeanFactory()` | 设置类加载器、注册默认环境 Bean |
| 4 | `postProcessBeanFactory()` | 子类扩展点（如 Web 应用注册 Scope） |
| 5 | **`invokeBeanFactoryPostProcessors()`** | **执行 BeanFactoryPostProcessor，解析 @Configuration、@ComponentScan** |
| 6 | **`registerBeanPostProcessors()`** | **注册 BeanPostProcessor（AOP、@Autowired 在此注册）** |
| 7 | `initMessageSource()` | 国际化 |
| 8 | `initApplicationEventMulticaster()` | 事件广播器 |
| 9 | `onRefresh()` | 子类扩展（如创建 WebServer） |
| 10 | `registerListeners()` | 注册事件监听器 |
| 11 | **`finishBeanFactoryInitialization()`** | **实例化所有非懒加载的单例 Bean** |
| 12 | `finishRefresh()` | 发布 ContextRefreshedEvent |

```java
// 实际源码（简化）
public void refresh() {
    synchronized (this.startupShutdownMonitor) {
        prepareRefresh();
        ConfigurableListableBeanFactory beanFactory = obtainFreshBeanFactory();
        prepareBeanFactory(beanFactory);
        postProcessBeanFactory(beanFactory);
        invokeBeanFactoryPostProcessors(beanFactory); // 第 5 步：关键
        registerBeanPostProcessors(beanFactory);      // 第 6 步：关键
        initMessageSource();
        initApplicationEventMulticaster();
        onRefresh();
        registerListeners();
        finishBeanFactoryInitialization(beanFactory); // 第 11 步：关键
        finishRefresh();
    }
}
```

**踩坑提醒：** 第 5 步 `invokeBeanFactoryPostProcessors` 会执行 `ConfigurationClassPostProcessor`，它负责解析 `@ComponentScan`、`@Import`、`@Bean` 等注解。如果你自定义 `BeanFactoryPostProcessor` 没生效，大概率是因为它在第 5 步之后才注册，错过了时机。

---

### 1.2.4 BeanDefinition

**一句话痛点：** `@Service`、`@Component` 这些注解不会凭空变成 Bean——它们先被解析为 `BeanDefinition` 这个"图纸"，然后容器按图纸创建实例。

**从注解到 BeanDefinition 的过程：**

```java
// 1. 你写的代码
@Service
public class UserService {
    @Autowired
    private UserDao userDao;
    
    public User findById(Long id) {
        return userDao.findById(id);
    }
}

// 2. Spring 内部做了什么（伪代码）
// ConfigurationClassPostProcessor 扫描到 @Service
// → 创建 AnnotatedGenericBeanDefinition
// → 设置 beanClass = UserService.class
// → 设置 scope = "singleton"
// → 设置 autowireMode = AUTOWIRE_NO
// → 注册到 BeanDefinitionRegistry

// 3. 你可以手动操作 BeanDefinition
@Configuration
public class AppConfig implements BeanDefinitionRegistryPostProcessor {
    @Override
    public void postProcessBeanDefinitionRegistry(BeanDefinitionRegistry registry) {
        BeanDefinition bd = BeanDefinitionBuilder
            .rootBeanDefinition(UserService.class)
            .setScope("prototype")
            .addPropertyValue("maxRetries", 3)
            .getBeanDefinition();
        registry.registerBeanDefinition("userService", bd);
    }
}
```

**PropertySourcesPlaceholderConfigurer 解析占位符：**

```yaml
# application.yml
app:
  max-retries: 3
  timeout: 5000
```

```java
@Service
public class RetryService {
    @Value("${app.max-retries}")  // 占位符
    private int maxRetries;
    
    @Value("${app.timeout:3000}") // 带默认值
    private long timeout;
}
```

`PropertySourcesPlaceholderConfigurer` 是一个 `BeanFactoryPostProcessor`，在第 5 步执行，它会遍历所有 `BeanDefinition`，将 `${...}` 占位符替换为实际值。

**BeanDefinition 的关键属性：**

| 属性 | 含义 | 示例 |
|------|------|------|
| `beanClassName` | Bean 的全限定类名 | `com.example.UserService` |
| `scope` | 作用域 | `singleton` / `prototype` |
| `lazyInit` | 是否懒加载 | `false` |
| `autowireMode` | 自动装配模式 | `AUTOWIRE_CONSTRUCTOR` |
| `dependsOn` | 依赖的其他 Bean | `["dataSource"]` |
| `initMethodName` | 初始化方法 | `"init"` |

**踩坑提醒：** `@Value` 注解在 `BeanFactoryPostProcessor` 阶段处理，这意味着它无法访问其他 Bean（因为 Bean 还没创建）。如果你需要在 Bean 创建后读取配置，请用 `@ConfigurationProperties`。

---

## 1.3 Bean 完整生命周期

### 1.3.1 三阶段骨架

**一句话痛点：** 面试问"Bean 的生命周期"能说十分钟，但代码里遇到 `@PostConstruct` 不执行就懵了——因为你只记住了步骤，没理解骨架。

**三阶段模型：**

```
阶段一：实例化（Instantiation）
  └→ 构造器调用，对象被创建（但属性还是 null）

阶段二：属性填充（Populate Properties）
  └→ @Autowired / @Value / @Resource 注入

阶段三：初始化（Initialization）
  └→ Aware 回调 → BeanPostProcessor → @PostConstruct → InitializingBean → 自定义 init
```

```java
@Component
public class LifecycleDemo implements InitializingBean, DisposableBean {
    
    private String name;
    
    // 阶段一：构造器（实例化）
    public LifecycleDemo() {
        System.out.println("1. 构造器调用，此时 name = " + name); // null
    }
    
    // 阶段二：属性填充
    @Value("${app.name}")
    public void setName(String name) {
        this.name = name;
        System.out.println("2. 属性填充，name = " + name);
    }
    
    // 阶段三：初始化
    @PostConstruct
    public void postConstruct() {
        System.out.println("3. @PostConstruct，name = " + name);
    }
    
    @Override
    public void afterPropertiesSet() {
        System.out.println("4. InitializingBean.afterPropertiesSet()");
    }
    
    public void customInit() {
        System.out.println("5. 自定义 init-method");
    }
    
    // 销毁
    @Override
    public void destroy() {
        System.out.println("6. DisposableBean.destroy()");
    }
}
```

**关键方法速查表：**

| 阶段 | 方法 | 时机 |
|------|------|------|
| 实例化 | 构造器 | 容器调用构造函数 |
| 属性填充 | `populateBean()` | 注入 @Autowired、@Value |
| 初始化前 | `BeanPostProcessor.postProcessBeforeInitialization()` | @PostConstruct 在此执行 |
| 初始化 | `InitializingBean.afterPropertiesSet()` | 接口回调 |
| 初始化后 | `BeanPostProcessor.postProcessAfterInitialization()` | AOP 代理在此创建 |
| 销毁 | `DisposableBean.destroy()` | 容器关闭时 |

---

### 1.3.2 初始化回调的执行顺序

**一句话痛点：** 面试经典问题——"@PostConstruct 和 InitializingBean 哪个先执行？"答案是 `@PostConstruct` 先，因为它是 `BeanPostProcessor` 处理的。

**完整执行顺序：**

```
1. Aware 回调（BeanNameAware → BeanFactoryAware → ApplicationContextAware）
2. BeanPostProcessor.postProcessBeforeInitialization()
   └→ CommonAnnotationBeanPostProcessor 处理 @PostConstruct
3. @PostConstruct 标注的方法
4. InitializingBean.afterPropertiesSet()
5. 自定义 init-method
6. BeanPostProcessor.postProcessAfterInitialization()
   └→ 创建 AOP 代理（如果需要）
```

```java
@Component
public class InitOrderDemo implements BeanNameAware, BeanFactoryAware,
        ApplicationContextAware, InitializingBean {
    
    private String beanName;
    
    @Override
    public void setBeanName(String name) {
        this.beanName = name;
        System.out.println("1. BeanNameAware: " + name);
    }
    
    @Override
    public void setBeanFactory(BeanFactory beanFactory) {
        System.out.println("2. BeanFactoryAware");
    }
    
    @Override
    public void setApplicationContext(ApplicationContext ctx) {
        System.out.println("3. ApplicationContextAware");
    }
    
    @PostConstruct
    public void postConstruct() {
        System.out.println("4. @PostConstruct");
    }
    
    @Override
    public void afterPropertiesSet() {
        System.out.println("5. InitializingBean.afterPropertiesSet()");
    }
    
    public void customInit() {
        System.out.println("6. 自定义 init-method");
    }
}
```

**对比表格：**

| 回调方式 | 注解/接口 | 处理器 | 是否推荐 |
|---------|----------|--------|---------|
| @PostConstruct | `jakarta.annotation.PostConstruct` | `CommonAnnotationBeanPostProcessor` | ✅ 推荐 |
| InitializingBean | `org.springframework.beans.factory.InitializingBean` | 容器直接调用 | ⚠️ 侵入性 |
| 自定义 init-method | `@Bean(initMethod = "init")` | 容器反射调用 | ✅ 第三方 Bean |

**踩坑提醒：** 如果 Bean 被 AOP 代理了，`@PostConstruct` 在代理对象上执行，但 `InitializingBean.afterPropertiesSet()` 在原始对象上执行。两者执行的"this"不同。

---

### 1.3.3 销毁回调与优雅停机

**一句话痛点：** 应用关闭时数据库连接池没释放、消息消费者没停止——因为你忘了注册销毁回调。

**销毁回调的执行顺序：**

```
1. @PreDestroy 标注的方法
2. DisposableBean.destroy()
3. 自定义 destroy-method
```

```java
@Component
public class GracefulShutdownDemo implements DisposableBean, SmartLifecycle {
    
    private final ExecutorService executor = Executors.newFixedThreadPool(4);
    
    @PreDestroy
    public void preDestroy() {
        System.out.println("1. @PreDestroy：关闭线程池");
        executor.shutdown();
    }
    
    @Override
    public void destroy() {
        System.out.println("2. DisposableBean.destroy()");
    }
    
    // SmartLifecycle：更精细的生命周期控制
    @Override
    public void stop(Runnable callback) {
        System.out.println("3. SmartLifecycle.stop()：优雅停止");
        // 等待所有任务完成
        try {
            executor.awaitTermination(30, TimeUnit.SECONDS);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
        callback.run(); // 通知容器停止完成
    }
    
    @Override
    public void start() {
        System.out.println("SmartLifecycle.start()");
    }
    
    @Override
    public boolean isRunning() {
        return !executor.isShutdown();
    }
    
    @Override
    public int getPhase() {
        return 0; // 值越小越先停止
    }
}
```

**SmartLifecycle vs DisposableBean：**

| 特性 | DisposableBean | SmartLifecycle |
|------|:--------------:|:--------------:|
| 异步停止 | ❌ | ✅（stop(Runnable)） |
| 停止顺序控制 | ❌ | ✅（getPhase()） |
| 多次调用 | 只一次 | 控制在 isRunning() |
| Spring Boot 优雅停机 | 部分支持 | 完全支持 |

**踩坑提醒：** Spring Boot 2.3+ 支持 `server.shutdown=graceful`，但这只对 Web 请求有效。如果你有自定义的消费者线程（如 Kafka Listener），需要自己实现 `SmartLifecycle` 来配合优雅停机。

---

### 1.3.4 源码级拆解

**一句话痛点：** 知道 `@Autowired` 能注入，但不知道是谁帮你做的——答案是 `AutowiredAnnotationBeanPostProcessor`。

**ApplicationContextAwareProcessor：**

```java
// 源码简化
class ApplicationContextAwareProcessor implements BeanPostProcessor {
    
    @Override
    public Object postProcessBeforeInitialization(Object bean, String beanName) {
        if (bean instanceof ApplicationContextAware) {
            ((ApplicationContextAware) bean).setApplicationContext(this.applicationContext);
        }
        if (bean instanceof EnvironmentAware) {
            ((EnvironmentAware) bean).setEnvironment(this.applicationContext.getEnvironment());
        }
        // ... 其他 Aware 接口
        return bean;
    }
}
```

这就是为什么实现了 `ApplicationContextAware` 接口就能拿到 `ApplicationContext`——容器通过这个 `BeanPostProcessor` 回调你的方法。

**AutowiredAnnotationBeanPostProcessor：**

```java
// 源码简化
class AutowiredAnnotationBeanPostProcessor implements BeanPostProcessor {
    
    @Override
    public PropertyValues postProcessProperties(PropertyValues pvs, Object bean, String beanName) {
        // 1. 找到 bean 中所有标注了 @Autowired 的字段和方法
        InjectionMetadata metadata = findAutowiringMetadata(bean.getClass());
        // 2. 从容器中查找匹配的 Bean 并注入
        metadata.inject(bean, beanName, pvs);
        return pvs;
    }
}
```

**关键 BeanPostProcessor 一览：**

| BeanPostProcessor | 处理的注解/功能 | 时机 |
|------------------|---------------|------|
| `ApplicationContextAwareProcessor` | 各种 Aware 接口 | before |
| `CommonAnnotationBeanPostProcessor` | `@PostConstruct`、`@Resource` | before |
| `AutowiredAnnotationBeanPostProcessor` | `@Autowired`、`@Value` | after |
| `AbstractAutoProxyCreator` | AOP 代理创建 | after |

**踩坑提醒：** `@Autowired` 的注入发生在 `postProcessProperties()` 阶段（属性填充），而不是 `postProcessAfterInitialization()`（初始化后）。这两个阶段在源码中是不同的调用点。

---

## 1.4 依赖注入

### 1.4.1 三种注入方式对比

**一句话痛点：** "用构造器注入还是字段注入？"这是 Spring 开发者最常见的争论——答案是构造器注入，其他两种都有硬伤。

```java
// 方式一：构造器注入（推荐）
@Service
public class OrderService {
    private final OrderRepository orderRepository;
    private final PaymentGateway paymentGateway;
    
    // Spring 4.3+ 单构造器可省略 @Autowired
    public OrderService(OrderRepository orderRepository, PaymentGateway paymentGateway) {
        this.orderRepository = orderRepository;
        this.paymentGateway = paymentGateway;
    }
}

// 方式二：Setter 注入
@Service
public class NotificationService {
    private EmailSender emailSender;
    
    @Autowired
    public void setEmailSender(EmailSender emailSender) {
        this.emailSender = emailSender;
    }
}

// 方式三：字段注入（最不推荐）
@Service
public class ReportService {
    @Autowired
    private ReportGenerator reportGenerator; // 无法设为 final
}
```

**四维度对比：**

| 维度 | 构造器注入 | Setter 注入 | 字段注入 |
|------|:---------:|:----------:|:-------:|
| 不可变性（final） | ✅ 可以 final | ❌ | ❌ |
| 必须存在校验 | ✅ 编译期 | ❌ 运行时空指针 | ❌ 运行时空指针 |
| 可测试性 | ✅ new 即可测试 | ✅ | ❌ 需反射 |
| 启动时发现问题 | ✅ 缺依赖直接报错 | ⚠️ 可能延迟 | ⚠️ 可能延迟 |

**踩坑提醒：** 字段注入最大的问题不是"不推荐"，而是**单元测试极其痛苦**——你必须用 `ReflectionTestUtils.setField()` 或 Mockito 的 `@InjectMocks`，而构造器注入只需要 `new OrderService(mockRepo, mockGateway)`。

---

### 1.4.2 @Autowired vs @Resource

**一句话痛点：** `@Autowired` 按类型注入，`@Resource` 按名称注入——当容器里有多个同类型 Bean 时，选错注解会让你 debug 半天。

```java
// 定义两个同类型的 Bean
@Configuration
public class DataSourceConfig {
    @Bean
    public DataSource primaryDataSource() { /* ... */ }
    
    @Bean
    public DataSource secondaryDataSource() { /* ... */ }
}

// ❌ @Autowired 按类型：找到两个，报错 NoUniqueBeanDefinitionException
@Service
public class ReportService {
    @Autowired
    private DataSource dataSource; // 报错！
}

// ✅ @Autowired + @Qualifier 指定
@Service
public class ReportService {
    @Autowired
    @Qualifier("primaryDataSource")
    private DataSource dataSource;
}

// ✅ @Resource 按名称：自动匹配变量名
@Service
public class ReportService {
    @Resource
    private DataSource primaryDataSource; // 匹配 @Bean 方法名
}
```

**核心区别：**

| 特性 | @Autowired | @Resource |
|------|:---------:|:--------:|
| 来源 | Spring | JSR-250（Jakarta） |
| 匹配策略 | 先类型，后名称 | 先名称，后类型 |
| 多实现处理 | 需配合 @Qualifier | 名称匹配则自动解决 |
| 必须存在 | `required = false` 可选 | 找不到直接报错 |
| 推荐场景 | Spring 生态内部 | 需要名称匹配时 |

**踩坑提醒：** `@Resource` 的名称匹配是基于 **setter 方法名** 或 **字段名**，而不是 `@Bean` 方法名。如果字段名和 Bean 名不一致，`@Resource` 会退化为按类型匹配，行为与 `@Autowired` 相同。

---

### 1.4.3 @Qualifier 与自定义限定符

**一句话痛点：** 当容器中有 5 个 `MessageSender` 实现时，光靠 `@Autowired` 注入不了——你需要 `@Qualifier` 精确指定。

```java
// 自定义限定符注解（比 @Qualifier("sms") 更安全）
@Target({ElementType.FIELD, ElementType.PARAMETER, ElementType.TYPE})
@Retention(RetentionPolicy.RUNTIME)
@Qualifier
public @interface SmsSender {}

@Target({ElementType.FIELD, ElementType.PARAMETER, ElementType.TYPE})
@Retention(RetentionPolicy.RUNTIME)
@Qualifier
public @interface EmailSender {}

// 使用自定义限定符
@Component
@SmsSender
public class SmsMessageSender implements MessageSender {
    @Override
    public void send(String to, String content) { /* 发短信 */ }
}

@Component
@EmailSender
public class EmailMessageSender implements MessageSender {
    @Override
    public void send(String to, String content) { /* 发邮件 */ }
}

// 注入时精确指定
@Service
public class NotificationService {
    private final MessageSender smsSender;
    private final MessageSender emailSender;
    
    public NotificationService(@SmsSender MessageSender smsSender,
                               @EmailSender MessageSender emailSender) {
        this.smsSender = smsSender;
        this.emailSender = emailSender;
    }
}
```

**为什么用自定义注解而不是 `@Qualifier("sms")`？**

| 对比 | @Qualifier("sms") | 自定义 @SmsSender |
|------|:-----------------:|:------------------:|
| 编译期检查 | ❌ 字符串拼写错误 | ✅ 类型安全 |
| 重构友好 | ❌ 重命名后失效 | ✅ IDE 自动重命名 |
| 语义清晰 | ⚠️ 字符串无意义 | ✅ 注解即文档 |

**踩坑提醒：** `@Qualifier` 在 `@Bean` 方法参数上使用时，参数名**不**作为 Bean 名称匹配——必须显式写 `@Qualifier("beanName")`。

---

### 1.4.4 ObjectProvider 延迟注入

**一句话痛点：** 有些依赖不是必须的——没有就用默认行为，有了就增强功能。`ObjectProvider` 让你优雅处理"依赖可能不存在"。

```java
// 场景：缓存策略可选，没有 Redis 就用本地缓存
@Service
public class UserService {
    private final CacheManager cacheManager;
    
    public UserService(ObjectProvider<CacheManager> cacheManagerProvider) {
        // 如果容器中有 CacheManager Bean，就用它；否则用默认实现
        this.cacheManager = cacheManagerProvider
            .getIfAvailable(() -> new ConcurrentMapCacheManager());
    }
}

// 场景：多实现时选择一个
@Service
public class ReportService {
    private final List<ReportExporter> exporters;
    
    public ReportService(ObjectProvider<ReportExporter> provider) {
        this.exporters = provider.orderedStream()
            .collect(Collectors.toList());
    }
}

// 场景：延迟获取（避免循环依赖）
@Service
public class AService {
    private final ObjectProvider<BService> bServiceProvider;
    
    public AService(ObjectProvider<BService> bServiceProvider) {
        this.bServiceProvider = bServiceProvider;
    }
    
    public void doSomething() {
        BService bService = bServiceProvider.getIfAvailable();
        if (bService != null) {
            bService.process();
        }
    }
}
```

**ObjectProvider API 速查：**

| 方法 | 行为 |
|------|------|
| `getIfAvailable()` | 有则返回，无则返回 null |
| `getIfAvailable(Supplier)` | 有则返回，无则用默认 |
| `getIfUnique()` | 唯一才返回，多个则返回 null |
| `getObject()` | 有则返回，无则抛异常 |
| `stream()` | 返回所有匹配的 Bean 的 Stream |
| `orderedStream()` | 按 @Order 排序的 Stream |

**踩坑提醒：** `ObjectProvider` 的 `getIfAvailable()` 在构造器调用时，Bean 可能还没完全初始化。如果获取的 Bean 有 AOP 代理，拿到的可能是未代理的原始对象。建议在方法调用时获取，而不是构造器中。

---

## 1.5 AOP 面向切面编程

### 1.5.1 横切关注点与切面

**一句话痛点：** 事务管理、日志记录、权限校验——这些逻辑散落在每个 Service 方法里，AOP 让你把它们抽出来集中管理。

**五个核心术语：**

```java
@Aspect
@Component
public class LoggingAspect {
    
    // 1. 切点（Pointcut）：定义在哪些方法上执行
    @Pointcut("execution(* com.example.service.*.*(..))")
    public void serviceMethods() {}
    
    // 2. 通知（Advice）：定义在切点的什么时机执行
    @Before("serviceMethods()")
    public void logBefore(JoinPoint joinPoint) {
        // 3. 连接点（JoinPoint）：被拦截的方法
        System.out.println("调用: " + joinPoint.getSignature().getName());
    }
    
    // 4. 切面（Aspect）= 切点 + 通知
    // 本类 @LoggingAspect 就是一个切面
    
    // 5. 织入（Weaving）：将切面应用到目标对象的过程
    // Spring AOP 在初始化后通过 BeanPostProcessor 完成织入
}
```

**术语对照表：**

| 术语 | 英文 | 含义 | 类比 |
|------|------|------|------|
| 切点 | Pointcut | 在哪里执行 | GPS 坐标 |
| 通知 | Advice | 做什么 | 具体动作 |
| 连接点 | JoinPoint | 被拦截的方法 | 具体地点 |
| 切面 | Aspect | 切点 + 通知 | 路线规划 |
| 织入 | Weaving | 将切面应用到目标 | 执行导航 |

**踩坑提醒：** Spring AOP 只支持方法级别的连接点（方法执行），不支持字段访问、构造器调用等。如果需要更细粒度的 AOP，请使用 AspectJ。

---

### 1.5.2 五种通知类型

**一句话痛点：** Before、After、Around 搞混了？一句话：Before 最早，After 最晚，Around 全包。

```java
@Aspect
@Component
public class TransactionAspect {
    
    // 1. @Before：方法执行前
    @Before("execution(* com.example.service.*.*(..))")
    public void beginTransaction(JoinPoint jp) {
        System.out.println("开启事务: " + jp.getSignature().getName());
    }
    
    // 2. @AfterReturning：方法正常返回后
    @AfterReturning(pointcut = "execution(* com.example.service.*.*(..))", 
                    returning = "result")
    public void commit(JoinPoint jp, Object result) {
        System.out.println("提交事务，返回值: " + result);
    }
    
    // 3. @AfterThrowing：方法抛出异常后
    @AfterThrowing(pointcut = "execution(* com.example.service.*.*(..))", 
                   throwing = "ex")
    public void rollback(JoinPoint jp, Exception ex) {
        System.out.println("回滚事务，异常: " + ex.getMessage());
    }
    
    // 4. @After：方法结束后（无论成功失败，类似 finally）
    @After("execution(* com.example.service.*.*(..))")
    public void cleanup(JoinPoint jp) {
        System.out.println("清理资源: " + jp.getSignature().getName());
    }
    
    // 5. @Around：环绕通知（最强大，可控制是否执行目标方法）
    @Around("execution(* com.example.service.*.*(..))")
    public Object around(ProceedingJoinPoint pjp) throws Throwable {
        System.out.println("Around 前");
        try {
            Object result = pjp.proceed(); // 执行目标方法
            System.out.println("Around 后");
            return result;
        } catch (Throwable t) {
            System.out.println("Around 异常");
            throw t;
        }
    }
}
```

**执行顺序对比：**

| 通知类型 | 执行时机 | 能否控制方法执行 | 能否修改返回值 |
|---------|---------|:--------------:|:------------:|
| @Before | 方法前 | ❌ | ❌ |
| @AfterReturning | 正常返回后 | ❌ | ✅ |
| @AfterThrowing | 抛异常后 | ❌ | ❌ |
| @After | finally | ❌ | ❌ |
| @Around | 包裹整个方法 | ✅ | ✅ |

**踩坑提醒：** `@Around` 的 `pjp.proceed()` 必须调用，否则目标方法不会执行。另外，`@Around` 的返回值类型必须是 `Object`，不能直接声明目标方法的返回类型。

---

### 1.5.3 切点表达式

**一句话痛点：** 切点表达式写错了，AOP 就等于没用——要么切不到，要么切太多。

```java
// execution：最常用，匹配方法签名
@Pointcut("execution(* com.example.service.*.*(..))")
// 返回值任意 | 包名 | 类名任意 | 方法名任意 | 参数任意

// 精确匹配
@Pointcut("execution(public String com.example.service.UserService.findById(Long))")

// @annotation：匹配标注了特定注解的方法
@Pointcut("@annotation(com.example.annotation.Loggable)")
public void loggableMethods() {}

// @within：匹配类上标注了特定注解的所有方法
@Pointcut("@within(org.springframework.stereotype.Service)")
public void allServices() {}

// args：匹配特定参数类型的方法
@Pointcut("execution(* *(String, ..))")
public void firstArgString() {}

// 组合切点
@Pointcut("execution(* com.example.service.*.*(..)) && @annotation(Loggable)")
public void serviceWithLog() {}

@Pointcut("execution(* com.example.service.*.*(..)) || execution(* com.example.dao.*.*(..))")
public void serviceOrDao() {}
```

**切点表达式速查：**

| 表达式 | 匹配目标 | 示例 |
|--------|---------|------|
| `execution` | 方法签名 | `execution(* save*(..))` |
| `@annotation` | 方法上的注解 | `@annotation(Cacheable)` |
| `@within` | 类上的注解 | `@within(Service)` |
| `@target` | 运行时对象的注解 | `@target(Configurable)` |
| `args` | 参数类型 | `args(String,..)` |
| `bean` | Bean 名称（Spring 特有） | `bean(userService)` |

**踩坑提醒：** `execution(* com.example..*.*(..))` 中的 `..` 表示"com.example 及其所有子包"，不要写成 `com.example.*`（只匹配一级子包）。

---

### 1.5.4 JDK 动态代理 vs CGLIB

**一句话痛点：** 你的 Bean 明明有方法，代理后却调不到——因为你不知道 Spring 用了哪种代理方式。

```java
// JDK 动态代理：基于接口
public interface UserService {
    User findById(Long id);
}

@Service
public class UserServiceImpl implements UserService {
    @Override
    public User findById(Long id) { /* ... */ }
}

// 代理后：proxy 是 $Proxy0 类型，不是 UserServiceImpl
UserService proxy = ctx.getBean(UserService.class); // ✅ 接口接收
UserServiceImpl impl = ctx.getBean(UserServiceImpl.class); // ❌ 报错！

// CGLIB：基于继承（Spring Boot 默认）
@Service
public class OrderService {
    public Order create(OrderRequest request) { /* ... */ }
}

// 代理后：proxy 是 OrderService$$EnhancerBySpringCGLIB 类型
OrderService proxy = ctx.getBean(OrderService.class); // ✅
OrderService proxy = (OrderService) ctx.getBean("orderService"); // ✅
```

**对比：**

| 特性 | JDK 动态代理 | CGLIB |
|------|:-----------:|:-----:|
| 代理方式 | 实现接口 | 继承类 |
| 要求 | 目标类必须实现接口 | 目标类不能是 final |
| 方法限制 | 只代理接口方法 | 代理所有非 final 方法 |
| 性能 | 略快（Java 17+ 差距缩小） | 略慢 |
| Spring Boot 默认 | 2.x 起不再默认 | ✅ 默认使用 |

**Spring Boot 的配置：**

```yaml
# Spring Boot 2.x+ 默认开启 CGLIB
spring:
  aop:
    proxy-target-class: true  # 默认值
```

```java
// 手动关闭 CGLIB，使用 JDK 代理
@EnableAspectJAutoProxy(proxyTargetClass = false)
@Configuration
public class AopConfig {}
```

**踩坑提醒：** CGLIB 代理会创建子类，所以**被代理的类不能是 final**，方法也不能是 final。如果你发现 AOP 没生效，先检查目标类和方法是否被 `final` 修饰。

---

### 1.5.5 AOP 失效的四种场景

**一句话痛点：** AOP 注解写了、切点也对，但通知就是不执行——90% 是因为踩了这四个坑之一。

**场景一：自调用（最常见）**

```java
@Service
public class PaymentService {
    
    @Transactional
    public void processPayment(Order order) {
        // 处理支付
        validatePayment(order); // ❌ 自调用，@Transactional 失效！
    }
    
    @Transactional
    public void validatePayment(Order order) {
        // 验证支付
    }
}
// 原因：this.validatePayment() 调用的是原始对象，不是代理对象
// 解法：注入自身代理，或拆分到不同类

// ✅ 解法一：注入自身代理
@Service
public class PaymentService {
    @Autowired
    private ApplicationContext ctx;
    
    public void processPayment(Order order) {
        PaymentService proxy = ctx.getBean(PaymentService.class);
        proxy.validatePayment(order); // 通过代理调用
    }
}

// ✅ 解法二：AopContext（需开启 exposeProxy）
@EnableAspectJAutoProxy(exposeProxy = true)
@Configuration
public class AopConfig {}

@Service
public class PaymentService {
    public void processPayment(Order order) {
        ((PaymentService) AopContext.currentProxy()).validatePayment(order);
    }
}
```

**场景二：private 方法**

```java
@Service
public class CacheService {
    @Cacheable("users") // ❌ 对 private 方法无效
    private User findUser(Long id) {
        return userRepo.findById(id);
    }
}
// 原因：CGLIB 代理通过继承实现，private 方法无法被重写
```

**场景三：final 类/方法**

```java
@Service
public final class ReportService { // ❌ final 类，CGLIB 无法继承
    @Transactional
    public void generate() { /* ... */ }
}
```

**场景四：未被容器管理**

```java
// ❌ 手动 new 的对象不受 Spring 管理
UserService userService = new UserService();
userService.findById(1L); // @Transactional 不生效
```

**排查清单：**

| 检查项 | 原因 | 解法 |
|--------|------|------|
| 自调用 | 通过 this 调用，绕过代理 | 注入代理或拆分类 |
| private 方法 | 代理无法拦截 | 改为 public |
| final 类/方法 | CGLIB 无法继承 | 去掉 final |
| 未被容器管理 | 手动 new | 让 Spring 管理 |

---

## 1.6 循环依赖与三级缓存

### 1.6.1 循环依赖的卡点

**一句话痛点：** A 依赖 B，B 依赖 A——Spring 能不能自动解决？答案是：构造器注入不行，字段注入可以。

```java
// ❌ 构造器注入：死锁，无法解决
@Service
public class ServiceA {
    private final ServiceB serviceB;
    public ServiceA(ServiceB serviceB) { // 创建 A 需要 B
        this.serviceB = serviceB;
    }
}

@Service
public class ServiceB {
    private final ServiceA serviceA;
    public ServiceB(ServiceA serviceA) { // 创建 B 需要 A
        this.serviceA = serviceA;
    }
}
// 报错：BeanCurrentlyInCreationException

// ✅ 字段注入：可以解决
@Service
public class ServiceA {
    @Autowired
    private ServiceB serviceB; // 先创建 A（serviceB 为 null），再创建 B，最后注入
}

@Service
public class ServiceB {
    @Autowired
    private ServiceA serviceA; // B 创建好后，将 A 注入到 B，将 B 注入到 A
}
```

**为什么构造器注入不行？** 因为构造器调用是"一步到位"的——你不能先 new 一个"半成品"再补属性。而字段注入允许先创建对象（属性为 null），再通过 setter 注入属性。

---

### 1.6.2 提前暴露机制

**一句话痛点：** 循环依赖的核心解法：先把"半成品"（只有对象引用，没有属性填充）放到缓存里，让对方能拿到引用，等双方都创建完再补全属性。

**流程拆解（A 依赖 B，B 依赖 A）：**

```
1. 创建 A：
   - 实例化 A（调用构造器，得到半成品 A）
   - 将 A 的 ObjectFactory 放入三级缓存
   - 开始填充属性，发现依赖 B

2. 创建 B：
   - 实例化 B（调用构造器，得到半成品 B）
   - 将 B 的 ObjectFactory 放入三级缓存
   - 开始填充属性，发现依赖 A
   - 从三级缓存拿到 A 的 ObjectFactory，调用 getObject() 得到半成品 A
   - 将半成品 A 从三级缓存升级到二级缓存
   - B 属性填充完成，B 初始化完成
   - 将 B 放入一级缓存

3. 回到 A：
   - 从一级缓存拿到完整的 B
   - A 属性填充完成，A 初始化完成
   - 将 A 从二级缓存移到一级缓存
```

---

### 1.6.3 三个 Map 的流水线

**一句话痛点：** Spring 用三个 Map 解决循环依赖——理解这三个 Map 的数据流转，就理解了整个机制。

```java
// Spring 源码中的三个缓存（DefaultSingletonBeanRegistry）
/** 一级缓存：完整的 Bean */
Map<String, Object> singletonObjects = new ConcurrentHashMap<>(256);

/** 二级缓存：提前暴露的 Bean（半成品，可能被代理） */
Map<String, Object> earlySingletonObjects = new ConcurrentHashMap<>(16);

/** 三级缓存：Bean 的 ObjectFactory（延迟创建代理） */
Map<String, ObjectFactory<?>> singletonFactories = new HashMap<>(16);
```

**流转过程：**

| 阶段 | 一级缓存 | 二级缓存 | 三级缓存 |
|------|---------|---------|---------|
| A 实例化后 | - | - | A 的 ObjectFactory |
| B 创建时依赖 A | - | A（半成品） | - |
| A 属性填充完成 | A（完整） | - | - |

```java
// 源码简化：DefaultSingletonBeanRegistry.getSingleton()
protected Object getSingleton(String beanName, boolean allowEarlyReference) {
    // 1. 先从一级缓存找
    Object singletonObject = this.singletonObjects.get(beanName);
    if (singletonObject == null && isSingletonCurrentlyInCreation(beanName)) {
        // 2. 再从二级缓存找
        singletonObject = this.earlySingletonObjects.get(beanName);
        if (singletonObject == null && allowEarlyReference) {
            synchronized (this.singletonObjects) {
                // 3. 最后从三级缓存找
                ObjectFactory<?> singletonFactory = this.singletonFactories.get(beanName);
                if (singletonFactory != null) {
                    singletonObject = singletonFactory.getObject();
                    // 升级到二级缓存
                    this.earlySingletonObjects.put(beanName, singletonObject);
                    this.singletonFactories.remove(beanName);
                }
            }
        }
    }
    return singletonObject;
}
```

**为什么需要三级而不是两级？** 因为 AOP 代理。如果 A 需要被代理，`ObjectFactory` 可以在被需要时才创建代理对象，而不是实例化时就创建——这避免了不必要的代理创建。

**踩坑提醒：** Spring 的循环依赖只支持**单例 Bean 的属性注入循环**。原型（prototype）作用域的循环依赖完全不支持，因为原型 Bean 不会被缓存。

---

### 1.6.4 @Lazy 破解循环依赖

**一句话痛点：** 构造器注入遇到循环依赖报错了？`@Lazy` 一行搞定——先注入一个代理，真正用到时才初始化。

```java
// 构造器注入 + @Lazy 解决循环依赖
@Service
public class ServiceA {
    private final ServiceB serviceB;
    
    public ServiceA(@Lazy ServiceB serviceB) {
        this.serviceB = serviceB; // 注入的是代理，不是真正的 B
    }
    
    public void methodA() {
        serviceB.methodB(); // 调用时才初始化真正的 B
    }
}

@Service
public class ServiceB {
    private final ServiceA serviceA;
    
    public ServiceB(@Lazy ServiceA serviceA) {
        this.serviceA = serviceA; // 注入的是代理
    }
    
    public void methodB() {
        serviceA.methodA();
    }
}
```

**`@Lazy` 的原理：** Spring 为 `@Lazy` 注入创建一个 CGLIB 代理（`TargetSource`），代理的 `invoke()` 方法在第一次调用时才从容器获取真正的 Bean 并缓存。

```java
// @Lazy 代理的内部机制（伪代码）
public class LazyTargetSource implements TargetSource {
    private Object target;
    private final BeanFactory beanFactory;
    private final String beanName;
    
    @Override
    public Object getTarget() {
        if (this.target == null) {
            this.target = this.beanFactory.getBean(this.beanName); // 延迟初始化
        }
        return this.target;
    }
}
```

**`@Lazy` 适用场景对比：**

| 场景 | 是否推荐用 @Lazy |
|------|:--------------:|
| 属性注入的循环依赖 | ❌ Spring 能自动解决 |
| 构造器注入的循环依赖 | ✅ 唯一的简单解法 |
| 延迟加载不常用的 Bean | ✅ 减少启动时间 |
| 打破设计上的循环 | ⚠️ 应该重构，而非 @Lazy |

**踩坑提醒：** `@Lazy` 只是"推迟问题"，不是"解决问题"。如果两个 Bean 在运行时**一定会**互相调用，循环依赖说明你的设计有问题——考虑引入第三个 Bean 或事件驱动解耦。

---

## 1.7 条件装配与 Profile

### 1.7.1 @Conditional 原理

**一句话痛点：** Spring Boot 的"自动配置"不是魔法——底层就是 `@Conditional` 在 Bean 注册阶段决定"这个 Bean 要不要注册"。

```java
// @Conditional 的工作原理
// 1. Spring 在注册 BeanDefinition 时检查 @Conditional
// 2. 调用 Condition.matches() 方法
// 3. 返回 true → 注册 BeanDefinition
// 4. 返回 false → 跳过，Bean 不会被创建

// 自定义条件
public class OnDatabaseCondition implements Condition {
    @Override
    public boolean matches(ConditionContext context, AnnotatedTypeMetadata metadata) {
        // 检查是否有数据库驱动
        return ClassUtils.isPresent("com.mysql.cj.jdbc.Driver", 
            context.getClassLoader());
    }
}

// 使用自定义条件
@Configuration
@Conditional(OnDatabaseCondition.class)
public class DatabaseConfig {
    @Bean
    public DataSource dataSource() {
        return new HikariDataSource();
    }
}
```

**ConfigurationPhase：**

| 阶段 | 用途 | 示例 |
|------|------|------|
| `PARSE_CONFIGURATION` | 配置类解析阶段 | `@ConditionalOnClass` |
| `REGISTER_BEAN` | Bean 注册阶段 | `@ConditionalOnMissingBean` |

```java
// 实现 ConfigurationCondition 接口指定阶段
public class MyCondition implements ConfigurationCondition {
    @Override
    public ConfigurationPhase getConfigurationPhase() {
        return ConfigurationPhase.REGISTER_BEAN; // 只在注册阶段评估
    }
    
    @Override
    public boolean matches(ConditionContext context, AnnotatedTypeMetadata metadata) {
        return true;
    }
}
```

**踩坑提醒：** `@Conditional` 的评估发生在 `BeanFactoryPostProcessor` 阶段（refresh 第 5 步），此时 Bean 还没创建。所以条件中不能注入其他 Bean，只能检查类路径、环境变量、BeanDefinition 等。

---

### 1.7.2 常用条件注解

**一句话痛点：** Spring Boot 自动配置的"智能"来自条件注解——你配了数据源它就用，没配就跳过。

```java
// @ConditionalOnClass：类路径上存在指定类时生效
@Configuration
@ConditionalOnClass(name = "com.mysql.cj.jdbc.Driver")
public class MySqlAutoConfiguration {
    @Bean
    public DataSource mysqlDataSource() {
        return new HikariDataSource();
    }
}

// @ConditionalOnMissingBean：容器中没有指定类型的 Bean 时生效
@Configuration
public class DefaultCacheConfig {
    @Bean
    @ConditionalOnMissingBean(CacheManager.class) // 用户没配就用默认
    public CacheManager defaultCacheManager() {
        return new ConcurrentMapCacheManager();
    }
}

// @ConditionalOnProperty：配置属性满足条件时生效
@Configuration
@ConditionalOnProperty(
    name = "app.feature.new-ui",
    havingValue = "true",
    matchIfMissing = false  // 没配置时默认 false
)
public class NewUiConfig {
    @Bean
    public UiRenderer newUiRenderer() {
        return new NewUiRenderer();
    }
}
```

**常用条件注解速查：**

| 注解 | 判断依据 | 典型场景 |
|------|---------|---------|
| `@ConditionalOnClass` | 类路径存在 | 有 MySQL 驱动才配置数据源 |
| `@ConditionalOnMissingClass` | 类路径不存在 | 没有 Redis 才用本地缓存 |
| `@ConditionalOnBean` | 容器有指定 Bean | 有 DataSource 才配置事务 |
| `@ConditionalOnMissingBean` | 容器无指定 Bean | 用户没配才用默认 |
| `@ConditionalOnProperty` | 配置属性值 | 功能开关 |
| `@ConditionalOnResource` | 资源文件存在 | 有 keystore 才配 SSL |
| `@ConditionalOnWebApplication` | Web 环境 | Web 才配 Servlet |
| `@ConditionalOnJava` | Java 版本 | Java 17+ 才用新特性 |

**踩坑提醒：** `@ConditionalOnMissingBean` 放在 `@Bean` 方法上和放在类上效果不同。放在方法上检查的是方法返回类型的 Bean，放在类上检查的是整个配置类。

---

### 1.7.3 @Profile 按环境切换

**一句话痛点：** 开发用 H2，测试用 H2，生产用 MySQL——不用 `@Profile` 你就得每次手动改配置。

```java
// 方式一：在 @Configuration 上使用
@Configuration
public class DataSourceConfig {
    
    @Bean
    @Profile("dev")
    public DataSource devDataSource() {
        return new EmbeddedDatabaseBuilder()
            .setType(EmbeddedDatabaseType.H2)
            .build();
    }
    
    @Bean
    @Profile("prod")
    public DataSource prodDataSource() {
        HikariConfig config = new HikariConfig();
        config.setJdbcUrl("jdbc:mysql://prod-server:3306/mydb");
        return new HikariDataSource(config);
    }
}

// 方式二：在 @Component 上使用
@Component
@Profile("dev")
public class DevMailSender implements MailSender {
    @Override
    public void send(Mail mail) {
        System.out.println("开发环境，不发送邮件: " + mail);
    }
}

@Component
@Profile("prod")
public class SmtpMailSender implements MailSender {
    @Override
    public void send(Mail mail) {
        // 真正发送邮件
    }
}
```

**激活 Profile 的方式：**

```yaml
# application.yml
spring:
  profiles:
    active: dev  # 激活 dev
```

```bash
# 命令行
java -jar app.jar --spring.profiles.active=prod

# 环境变量
export SPRING_PROFILES_ACTIVE=prod
```

**@Profile 与 @Conditional 的关系：**

```java
// @Profile 的底层就是 @Conditional
@Target({ElementType.TYPE, ElementType.METHOD})
@Retention(RetentionPolicy.RUNTIME)
@Conditional(ProfileCondition.class)  // 底层实现
public @interface Profile {
    String[] value();
}

// ProfileCondition.matches() 检查 active profiles
```

**踩坑提醒：** `@Profile("default")` 只在没有任何 Profile 激活时才生效。如果你设置了 `spring.profiles.active=dev`，所有 `@Profile("default")` 的 Bean 都不会注册。

---

## 1.8 踩坑案例集

### 1.8.1 @Transactional 自调用失效

**一句话痛点：** 明明加了 `@Transactional`，数据却没有回滚——90% 的原因是"自调用"。

**现象：**

```java
@Service
public class TransferService {
    
    public void transfer(Long from, Long to, BigDecimal amount) {
        deductBalance(from, amount);  // 扣款成功
        addBalance(to, amount);       // 转账失败，但扣款没回滚！
    }
    
    @Transactional
    public void deductBalance(Long accountId, BigDecimal amount) {
        accountRepository.deduct(accountId, amount);
    }
    
    @Transactional
    public void addBalance(Long accountId, BigDecimal amount) {
        accountRepository.add(accountId, amount);
        throw new RuntimeException("模拟失败"); // 故意抛异常
    }
}
```

**排查过程：**

1. 检查 `@EnableTransactionManagement` → 已开启
2. 检查数据库引擎 → InnoDB，支持事务
3. 检查异常类型 → RuntimeException，应该回滚
4. 打断点发现 → `this` 是原始对象，不是代理对象

**根因：** `this.addBalance()` 是自调用，绕过了 Spring AOP 代理。`@Transactional` 的事务管理是通过代理拦截实现的，自调用不经过代理，事务不生效。

**解法：**

```java
// ✅ 解法一：拆分到不同类
@Service
public class TransferService {
    @Autowired
    private BalanceService balanceService;
    
    public void transfer(Long from, Long to, BigDecimal amount) {
        balanceService.deductBalance(from, amount);
        balanceService.addBalance(to, amount);
    }
}

@Service
public class BalanceService {
    @Transactional
    public void deductBalance(Long accountId, BigDecimal amount) { /* ... */ }
    
    @Transactional
    public void addBalance(Long accountId, BigDecimal amount) { /* ... */ }
}

// ✅ 解法二：注入自身代理
@Service
public class TransferService {
    @Autowired
    private ApplicationContext ctx;
    
    public void transfer(Long from, Long to, BigDecimal amount) {
        TransferService proxy = ctx.getBean(TransferService.class);
        proxy.deductBalance(from, amount);
        proxy.addBalance(to, amount);
    }
    
    @Transactional
    public void deductBalance(Long accountId, BigDecimal amount) { /* ... */ }
}
```

---

### 1.8.2 @Transactional 异常类型不匹配

**一句话痛点：** `@Transactional` 默认只回滚 `RuntimeException` 和 `Error`，不回滚 checked 异常——你的 `throws IOException` 不会触发回滚。

```java
// ❌ 默认行为：checked 异常不回滚
@Service
public class FileService {
    @Transactional
    public void importData(String filePath) throws IOException {
        parseFile(filePath);      // 成功
        saveToDatabase();         // 失败，抛 IOException
        // 但 parseFile 的结果不会回滚！
    }
}

// ✅ 解法一：指定回滚异常
@Service
public class FileService {
    @Transactional(rollbackFor = Exception.class) // 所有异常都回滚
    public void importData(String filePath) throws IOException {
        parseFile(filePath);
        saveToDatabase();
    }
}

// ✅ 解法二：指定不回滚的异常
@Service
public class OrderService {
    @Transactional(noRollbackFor = BusinessException.class)
    public void createOrder(Order order) {
        // BusinessException 不回滚，其他异常回滚
    }
}
```

**异常回滚规则：**

| 异常类型 | 默认行为 | 修改方式 |
|---------|:-------:|---------|
| `RuntimeException` | ✅ 回滚 | - |
| `Error` | ✅ 回滚 | - |
| Checked Exception | ❌ 不回滚 | `rollbackFor = Exception.class` |

**踩坑提醒：** `@Transactional` 的 `rollbackFor` 经常被忽略，建议在项目规范中统一写 `@Transactional(rollbackFor = Exception.class)`，避免踩坑。

---

### 1.8.3 AOP 代理对象比较

**一句话痛点：** `user.getClass()` 返回的是 `UserService$$EnhancerBySpringCGLIB`，不是 `UserService`——用 `instanceof` 才安全。

```java
// ❌ 类型比较失败
Object bean = ctx.getBean("userService");
if (bean.getClass() == UserService.class) {  // false！
    System.out.println("是 UserService");
}

// ✅ instanceof 正确
if (bean instanceof UserService) {  // true
    System.out.println("是 UserService");
}

// ❌ getClass() 名称比较
bean.getClass().getName(); // "com.example.UserService$$EnhancerBySpringCGLIB$$abc123"

// ✅ 获取原始类型
Class<?> targetClass = AopUtils.getTargetClass(bean); // UserService.class
```

**代理对象相关的工具类：**

```java
import org.springframework.aop.support.AopUtils;

// 判断是否是代理
AopUtils.isAopProxy(bean);           // true

// 获取目标类
AopUtils.getTargetClass(bean);       // UserService.class

// 判断是否是 JDK 代理
AopUtils.isJdkDynamicProxy(bean);    // false (CGLIB)

// 判断是否是 CGLIB 代理
AopUtils.isCglibProxy(bean);         // true
```

**踩坑提醒：** 在序列化、日志打印、反射调用等场景中，代理对象的 class 名称可能与预期不同。用 `AopUtils.getTargetClass()` 获取真实类型。

---

### 1.8.4 Bean 覆盖导致注入错误

**一句话痛点：** 容器中有两个 `DataSource` Bean，`@Autowired` 注入时报 `NoUniqueBeanDefinitionException`——Spring 不知道选哪个。

```java
// 报错场景
@Configuration
public class DatabaseConfig {
    @Bean
    public DataSource primaryDataSource() { /* ... */ }
    
    @Bean
    public DataSource secondaryDataSource() { /* ... */ }
}

@Service
public class UserService {
    @Autowired
    private DataSource dataSource; // ❌ NoUniqueBeanDefinitionException
}
```

**解法：**

```java
// 解法一：@Primary 标记首选
@Bean
@Primary
public DataSource primaryDataSource() { /* ... */ }

// 解法二：@Qualifier 精确指定
@Autowired
@Qualifier("secondaryDataSource")
private DataSource dataSource;

// 解法三：@Resource 按名称
@Resource
private DataSource primaryDataSource; // 匹配 @Bean 方法名

// 解法四：@Autowired 用 List/Set 接收全部
@Autowired
private List<DataSource> allDataSources; // 注入所有

// 解法五：Spring Boot 自动配置让路
// 用户自己配置了 Bean，自动配置就不生效了（@ConditionalOnMissingBean）
```

**Spring Boot 的 Bean 覆盖规则：**

```yaml
# application.yml
spring:
  main:
    allow-bean-definition-overriding: true  # 允许覆盖（默认 false）
```

| 版本 | 默认行为 |
|------|---------|
| Boot 1.x/2.0 | 允许覆盖，后来者覆盖前者 |
| Boot 2.1+ | 默认禁止覆盖，覆盖则报错 |

**踩坑提醒：** 项目中出现 `BeanDefinitionOverrideException` 时，不是简单地设 `allow-bean-definition-overriding: true`，而是要找到两个冲突的 Bean，用 `@Primary` 或 `@Qualifier` 解决。
