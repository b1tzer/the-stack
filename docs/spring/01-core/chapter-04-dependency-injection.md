# 依赖注入

> 一个类要拿到它的依赖，Spring 给了三种写法：构造器、Setter、字段。三种都能让依赖在运行时被填上，但只有一种能让你三年后改代码时不踩坑。这一章不重复 DI 是什么（见 [IoC 容器](./chapter-02-ioc-container.md)），只回答一件事：三种写法怎么选，选错会付出什么代价。

## 1. 三种注入方式

同一个依赖，三种写法：

```java
// 构造器注入：依赖通过构造器传入
@Service
public class OrderService {
    private final OrderRepository orderRepository;

    public OrderService(OrderRepository orderRepository) {
        this.orderRepository = orderRepository;
    }
}

// Setter 注入：依赖通过 setter 传入
@Service
public class OrderService {
    private OrderRepository orderRepository;

    @Autowired
    public void setOrderRepository(OrderRepository orderRepository) {
        this.orderRepository = orderRepository;
    }
}

// 字段注入：依赖直接塞进字段
@Service
public class OrderService {
    @Autowired
    private OrderRepository orderRepository;
}
```

三种写法都能让 `orderRepository` 在运行时被填上，差别在填上之后。

## 2. 为什么构造器注入是默认选择

把三种写法放到工程约束下对比：

| 维度 | 构造器 | Setter | 字段 |
| :-- | :-- | :-- | :-- |
| 字段不可变 | ✅ 可声明 `final` | ❌ 可变 | ❌ 可变 |
| 依赖必须存在 | ✅ 创建时绑定 | ❌ 可能忘调 | ❌ 运行时才暴露 |
| 单元测试 | ✅ 直接 `new` 传参 | ✅ 调 setter | ❌ 需反射或容器 |
| 启动期发现缺依赖 | ✅ 启动即报错 | ⚠️ 延迟 | ⚠️ 延迟 |

其中「字段不可变」是决定性的。构造器注入把依赖声明成 `final`，对象创建完成后依赖就无法被改动，编译器替你守住这条底线。字段注入唯一的优势是代码短一行，代价是丢掉不可变性和测试独立性，这笔账不划算。

一个常见的反驳是「字段注入写起来方便」。方便体现在写的那一刻，代价在之后每一次重构和测试里偿还——字段注入的类无法脱离容器单独 `new` 出来测，想替换一个 Mock 得靠反射。

## 3. @Autowired 与 @Resource

两个注解都能注入，匹配规则不同：

```java
// @Autowired：Spring 原生，先按类型匹配
@Autowired
private UserService userService;

// @Resource：JSR-250 标准，先按名称匹配
@Resource(name = "userService")
private UserService userService;
```

| 维度 | @Autowired | @Resource |
| :-- | :-- | :-- |
| 来源 | Spring | JSR-250 |
| 匹配顺序 | 先类型，再名称 | 先名称，再类型 |
| 缺省必填 | `required=true` | `required=true` |
| 指定 Bean | 配合 `@Qualifier` | 用 `name` 属性 |

工程里更倾向 `@Autowired` + `@Qualifier`：两者都是 Spring 原生，语义一致；`@Resource` 是标准注解，只在需要跨框架时才有额外价值。

::: warning 版本锚点
`@Resource` 来自 `javax.annotation`。JDK 11 起 JDK 不再内置该包，Spring 6.0 全面转向 `jakarta.annotation`，需额外引入 `jakarta.annotation-api` 依赖。
:::

## 4. 进阶用法

### 4.1 同类型多个 Bean：@Qualifier

容器里有多个同类型 Bean 时，类型匹配会失败，用 `@Qualifier` 指名：

```java
@Configuration
public class DataSourceConfig {
    @Bean("master")
    public DataSource master() { /* 主库 */ }
    @Bean("slave")
    public DataSource slave() { /* 从库 */ }
}

@Service
public class OrderService {
    public OrderService(
            @Qualifier("master") DataSource master,
            @Qualifier("slave") DataSource slave) {
        // ...
    }
}
```

### 4.2 同类型全部注入：集合注入

实现策略模式时，可以让 Spring 把同一接口的所有实现一次性注入：

```java
public interface PaymentStrategy {
    String type();
    void pay();
}

// 假设已有多个 @Component 实现：AlipayStrategy(type="alipay")、WechatStrategy(type="wechat")

@Service
public class PaymentService {
    private final Map<String, PaymentStrategy> strategies;

    // Spring 自动收集所有 PaymentStrategy 实现，key 为 Bean 名
    public PaymentService(Map<String, PaymentStrategy> strategies) {
        this.strategies = strategies;
    }

    public void pay(String type) {
        PaymentStrategy s = strategies.get(type);
        if (s == null) {
            throw new IllegalArgumentException("不支持: " + type);
        }
        s.pay();
    }
}
```

`Map<String, PaymentStrategy>` 的 key 是 Bean 名，也可以注入成 `List<PaymentStrategy>` 按注册顺序排列。

### 4.3 可选依赖：ObjectProvider

依赖可能不存在时，用 `ObjectProvider` 延迟获取：

```java
@Service
public class ReportService {
    private final ObjectProvider<CacheManager> cacheManager;

    public ReportService(ObjectProvider<CacheManager> cacheManager) {
        this.cacheManager = cacheManager;
    }

    public void generate() {
        // 使用时才取，不存在返回 null 而不是抛异常
        CacheManager cm = cacheManager.getIfAvailable();
        // ...
    }
}
```

`ObjectProvider` 注入的是「获取器」而不是 bean 本身，真正的 bean 在首次调用 `getObject()` / `getIfAvailable()` 时才去容器里解析，时机由调用方决定。但要分清「延迟解析」和「延迟创建」：默认单例 bean 在容器启动时就被 `DefaultListableBeanFactory.preInstantiateSingletons()` 预创建了，`ObjectProvider` 拦不住这一步；只有当目标 bean 标了 `@Lazy`，首次 `getObject()` 才会真正触发实例化——这才是「等调用时才创建 bean」的成立前提。

为什么不推荐 `@Autowired(required=false)`？`required=false` 只能用在字段或 Setter 注入上，用它就意味着把依赖声明成可空字段，放弃 `final` 和脱离容器的测试独立性；`ObjectProvider` 是构造器参数，这两点都不丢。`required=false` 的「不存在」表现为字段为 `null`，判空散落到每个调用点，`ObjectProvider.getIfAvailable()` 则把判断收敛在获取处。

## 5. 选型清单

| 场景 | 选择 |
| :-- | :-- |
| 依赖是必需的 | 构造器注入，声明 `final` |
| 依赖可选或延迟初始化 | `ObjectProvider`，不要用 `@Autowired(required=false)` |
| 同类型多个 Bean | `@Qualifier` 指名 |
| 策略 / 插件扩展点 | 集合注入（`Map` 或 `List`） |
| 遇到循环依赖 | 优先重构消除；确实拆不掉时，换字段 / Setter 注入并开启 `allow-circular-references`，这是最后兜底（见 [循环依赖与三级缓存](./chapter-06-circular-dependency.md)） |
