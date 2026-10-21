# 反模式（Anti-Patterns）

> **一句话记忆口诀**：反模式是看起来合理但实际有害的做法，识别反模式比学习模式更重要。

## 1. 什么是反模式？

反模式是在实践中反复出现的**低效或有害**的解决方案。它们通常看起来合理，但会导致代码难以维护、性能低下或频繁出 bug。

| 正模式 | 反模式 |
| :-- | :-- |
| 解决问题 | 制造问题 |
| 代码更清晰 | 代码更混乱 |
| 便于扩展 | 难以修改 |
| 经过验证 | 经常失败 |

## 2. 常见反模式一览

### 2.1 上帝类（God Class）

```java
// ❌ 反模式：一个类做了所有事情
public class OrderManager {
    // 创建订单
    public Order createOrder(...) { /* 50行 */ }
    // 支付
    public void pay(Order order) { /* 50行 */ }
    // 发货
    public void ship(Order order) { /* 50行 */ }
    // 退款
    public void refund(Order order) { /* 50行 */ }
    // 发送邮件
    public void sendEmail(Order order) { /* 30行 */ }
    // 记录日志
    public void log(Order order) { /* 20行 */ }
    // 生成报表
    public Report generateReport(...) { /* 50行 */ }
    // 导入数据
    public void importData(...) { /* 50行 */ }
    // ... 2000 行代码！
}

// 问题：
// 1. 违反单一职责原则
// 2. 难以测试（测试一个功能要理解整个类）
// 3. 修改一处可能影响其他功能
// 4. 合并冲突频繁（多人修改同一个文件）
```

**解决方案：** 拆分为多个职责单一的类（OrderCreator、PaymentService、ShippingService 等）。

### 2.2 新手恐惧症（Fear of Adding New Code）

```java
// ❌ 反模式：不敢新增类/文件，所有东西都塞进现有代码
public class UserService {
    public User getUser(Long id) { /* ... */ }
    public void createUser(User user) { /* ... */ }

    // 以下是"用户相关"的所有功能...
    public void sendWelcomeEmail(User user) { /* ... */ }
    public void syncToERP(User user) { /* ... */ }
    public Report generateUserReport(Date from, Date to) { /* ... */ }
    public void importUsersFromExcel(InputStream excel) { /* ... */ }
    public void exportUsersToCSV(OutputStream out) { /* ... */ }
    public void checkDuplicate(User user) { /* ... */ }
    public void mergeUsers(User a, User b) { /* ... */ }
    // 2000+ 行...
}

// 问题：害怕新增文件，觉得"都在一个类里好找"
// 实际：一个文件 2000 行，反而更难找
```

**解决方案：** 大胆拆分。判断依据是类是否同时承担多个变化原因，而非行数。

### 2.3 面条代码（Spaghetti Code）

```java
// ❌ 反模式：逻辑纠缠在一起，像一团面条
public void processOrder(Order order) {
    if (order.getType().equals("VIP")) {
        if (order.getAmount() > 1000) {
            if (order.getCountry().equals("CN")) {
                // 中国 VIP 大额订单逻辑
                discount = 0.8;
                if (order.getCoupon() != null) {
                    if (order.getCoupon().getType().equals("FIXED")) {
                        // ...
                    } else if (order.getCoupon().getType().equals("PERCENT")) {
                        // ...
                    }
                }
            } else if (order.getCountry().equals("US")) {
                // 美国 VIP 大额订单逻辑
                // ...又是 5 层嵌套
            }
        }
    }
    // 500 行嵌套 if-else，没人敢改
}
```

**解决方案：** 先按业务语义拆分条件、提取有意义的方法，再根据变化原因决定是否引入[策略模式](../03-behavioral/chapter-01-strategy.md)、[状态模式](../03-behavioral/chapter-06-state.md)或卫语句（early return），不因嵌套深就默认套用多态。迁移过程见[重构到设计模式](./chapter-04-refactoring-to-patterns.md)。

### 2.4 复制粘贴编程（Copy-Paste Programming）

```java
// ❌ 反模式：到处复制粘贴相同代码
public class OrderService {
    public void createOrder(Order order) {
        // 日志
        log.info("创建订单开始, orderId={}", order.getId());
        long start = System.currentTimeMillis();
        // 业务逻辑...
        log.info("创建订单结束, 耗时={}ms", System.currentTimeMillis() - start);
    }

    public void cancelOrder(Long orderId) {
        // 又复制了一遍日志逻辑
        log.info("取消订单开始, orderId={}", orderId);
        long start = System.currentTimeMillis();
        // 业务逻辑...
        log.info("取消订单结束, 耗时={}ms", System.currentTimeMillis() - start);
    }

    public void refundOrder(Long orderId) {
        // 又复制了一遍...
        log.info("退款开始, orderId={}", orderId);
        long start = System.currentTimeMillis();
        // ...
    }
}

// 问题：修改日志格式？要改 N 个地方！
```

**解决方案：** 模板方法（流程固定、部分步骤可变）、AOP（横切关注点，如日志、监控）、装饰器（按需组合增强行为）。本例的计时与日志属横切关注点，适合 AOP；重复代码是否套用模式，取决于它是否具有相同的变化原因。

### 2.5 金锤子（Golden Hammer）

```java
// ❌ 反模式：用同一个模式/技术解决所有问题
// "我熟悉策略模式，所有 if-else 都用策略模式！"

// 简单的 2 个分支，直接 if-else 更清晰
if (user.isAdmin()) {
    showAdminPanel();
} else {
    showUserPanel();
}

// ❌ 不需要这样
Map<String, Runnable> panelStrategies = Map.of(
    "admin", this::showAdminPanel,
    "user", this::showUserPanel
);
panelStrategies.get(user.getRole()).run();
```

**解决方案：** 匹配问题复杂度选择合适的方案。

### 2.6 单例滥用（Singletonitis）

```java
// ❌ 反模式：什么都用单例
public class UserValidator {
    private static final UserValidator INSTANCE = new UserValidator();
    public static UserValidator getInstance() { return INSTANCE; }

    public boolean validate(User user) {
        // 无状态的验证逻辑，交给 Spring 管理即可
        return user.getName() != null && user.getName().length() >= 3;
    }
}

// 问题：
// 1. 无状态对象是否用单实例，应看是否需要共享实例、由谁管理生命周期，以及是否存在并发安全与测试隔离问题
// 2. 手写单例的隐患不在「无状态」，而在静态入口隐藏依赖、共享可变状态，以及强制全局唯一妨碍测试隔离
// 3. Spring 的默认单例作用域（每个 Bean 定义每个容器一个实例）与 GoF 单例（整个 JVM 唯一）不是同一概念

// ✅ 正确：无状态验证器既可交给 Spring 管理，也可作普通对象使用；
// 是否合适，取决于是否隐藏依赖、强制全局唯一或妨碍测试与生命周期管理
@Component
public class UserValidator {
    public boolean validate(User user) { /* ... */ }
}
```

### 2.7 工厂过度（AbstractFactoryForEverything）

```java
// ❌ 反模式：简单的对象创建也用工厂
public class StringFactory {
    public String create(String value) {
        return new String(value);
    }
}

// String 就是 String，不需要工厂！
// 工厂的价值在封装具体类型选择、隔离调用方与实现、统一创建策略，
// 创建逻辑复杂只是其中一种情况；没有这些收益的工厂包装才是反模式
```

### 2.8 观察者泄漏（Observer Leak）

```java
// ❌ 反模式：注册了监听器，却从不注销
public class Subject {
    private final List<Consumer<OrderEvent>> listeners = new ArrayList<>();

    public void register(Consumer<OrderEvent> listener) {
        listeners.add(listener);
    }

    public void unregister(Consumer<OrderEvent> listener) {
        listeners.remove(listener);
    }

    public void publish(OrderEvent event) {
        listeners.forEach(listener -> listener.accept(event));
    }
}

// 泄漏条件：不再需要的监听器仍被长期存活的发布者引用，未注销的引用会
// 延长监听器及其关联对象的存活时间，使其无法按预期回收。
// 若监听器仍需要接收事件，或随发布者一同销毁，则不算泄漏。

// ✅ 正确：容器管理的监听器由容器负责发现与注册；手动向长期存活对象注册的
// 回调或订阅，仍需根据注册方与订阅方的生命周期自行注销
@Component
public class OrderListener {
    @EventListener
    public void onOrder(OrderEvent event) { /* 容器管理生命周期 */ }
}
```

### 2.9 过度抽象（Over-Abstraction）

```java
// ❌ 反模式：为了"未来可能的需求"过度抽象
public interface Repository<T, ID> {
    T findById(ID id);
    List<T> findAll();
    T save(T entity);
    void delete(T entity);
    long count();
    boolean exists(ID id);
    List<T> findByExample(T example);
    Page<T> findAll(Pageable pageable);
    // 20 个方法，但实际只用到 findById 和 save
}

// 问题：
// 1. 为不存在的需求设计
// 2. 增加理解和维护成本
// 3. YAGNI 原则（You Ain't Gonna Need It）

// ✅ 正确：只为当前需求设计，需要时再扩展
```

### 2.10 配置地狱（Configuration Hell）

```java
// ❌ 反模式：过度配置化
@Configuration
public class AppConfig {
    @Value("${app.order.max-items:100}")
    private int maxItems;

    @Value("${app.order.min-amount:0.01}")
    private double minAmount;

    @Value("${app.order.timeout-seconds:30}")
    private int timeout;

    @Value("${app.order.retry-count:3}")
    private int retryCount;

    @Value("${app.order.discount-vip:0.9}")
    private double vipDiscount;

    // 200 个配置项...什么都要可配置
}

// 问题：
// 1. 大部分配置永远不会改
// 2. 配置项爆炸，难以管理
// 3. 启动时配置校验复杂

// ✅ 正确：只把真正可能变化的参数配置化
// 固定的常量直接写在代码里，用常量类管理
```

## 3. 反模式检测清单

这些信号只是排查线索，不能直接证明设计有缺陷，需要结合业务语义进一步核实。

| 风险信号 | 需要核实的问题 |
| :-- | :-- |
| 类持续增长 | 是否同时承担多个变化原因？修改一处是否牵连其他职责？ |
| 相似代码重复出现 | 是否具有相同业务语义与变化原因？抽取后是否形成不合理耦合？ |
| 构造函数参数过多 | 参数是否属于同一概念对象？是否存在不合法的参数组合？ |
| 条件分支持续增加 | 分支是否代表独立、可替换的算法，或明确的状态转换？ |
| 代码难以测试 | 是依赖难以隔离、隐藏副作用，还是测试缺少合适边界？ |

## 4. 如何避免反模式？

1. **Code Review**：让同事帮你检查，自己很难发现自己的反模式
2. **测试先行**：难以独立验证行为，常提示依赖难以隔离或职责过重，值得排查，但不等于必然有设计缺陷
3. **30 秒规则**：作为个人经验提示使用——如果一个类需要很久才能理解，多半值得重构，但这不是硬性判据
4. **Boy Scout Rule**：每次路过都让代码比来时更好一点
5. **持续学习**：读《重构》《Clean Code》《设计模式》

## 5. 正模式 vs 反模式对照表

下表是方向性速查，具体选型还需结合变化原因与适用条件判断，见对应模式章节。

| 场景 | 正模式 | 反模式 |
| :-- | :-- | :-- |
| 多种算法 | 策略模式 | if-else 地狱 |
| 复杂对象创建 | 建造者 | 构造函数 10 个参数 |
| 共享实例 | 单例（Spring 容器管理） | 全局变量、静态方法 |
| 通知多个对象 | 观察者 | 直接调用所有依赖 |
| 接口不兼容 | 适配器 | 改老代码 |
| 增强功能 | 装饰器 | 修改原始类 |
| 树形结构 | 组合模式 | 到处 instanceof |
| 大量相似对象 | 享元 | 每个都 new |

> **一句话记忆口诀**：识别反模式比学习模式更重要——上帝类、复制粘贴和面条代码是常见的反模式，Code Review 和测试有助于及早发现和预防。
