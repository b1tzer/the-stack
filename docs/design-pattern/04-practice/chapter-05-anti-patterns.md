# 反模式（Anti-Patterns）

> **一句话记忆口诀**：反模式是看起来合理但实际有害的做法，识别反模式比学习模式更重要。

## 1. 什么是反模式？

反模式是在实践中反复出现的**低效或有害**的解决方案。它们通常看起来合理，但会导致代码难以维护、性能低下或频繁出 bug。

| 正模式 | 反模式 |
|--------|--------|
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

**解决方案：** 大胆拆分。一个类超过 300 行就该考虑拆分。

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

**解决方案：** 策略模式 + 状态模式 + 卫语句（early return）。

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

**解决方案：** 模板方法、AOP、装饰器。

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
        // 无状态的验证逻辑，不需要单例！
        return user.getName() != null && user.getName().length() >= 3;
    }
}

// 问题：
// 1. 无状态的类用单例没有意义
// 2. 难以测试（全局状态、mock 困难）
// 3. Spring 管理的 Bean 默认就是单例，不需要手动实现

// ✅ 正确：Spring @Component 天然单例，不需要手写
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
// 只有创建逻辑复杂时才需要工厂
```

### 2.8 观察者泄漏（Observer Leak）

```java
// ❌ 反模式：注册了观察者但忘记取消注册
public class OrderListener implements ApplicationListener<OrderEvent> {
    // 每次创建一个 OrderListener 实例就注册一次
    // 但从不取消注册，导致内存泄漏
}

// 在 Web 应用中尤其危险：
// 每次请求创建新实例，但旧实例永远不会被 GC（因为被 Subject 引用）

// ✅ 正确：Spring @EventListener 自动管理生命周期
@Component
public class OrderListener {
    @EventListener
    public void onOrder(OrderEvent event) { /* Spring 管理，无需手动取消 */ }
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

| 信号 | 可能的反模式 |
|------|------------|
| 一个类超过 500 行 | 上帝类 |
| 同一段代码出现 3 次以上 | 复制粘贴 |
| 嵌套超过 3 层 | 面条代码 |
| 构造函数超过 5 个参数 | 缺少建造者 |
| if-else 超过 5 个分支 | 缺少策略/状态模式 |
| 修改一个功能要改 3 个以上文件 | 缺少单一职责 |
| "这个类太大了不敢改" | 上帝类 |
| "这段代码谁写的？" | 缺少文档和模式 |

## 4. 如何避免反模式？

1. **Code Review**：让同事帮你检查，自己很难发现自己的反模式
2. **测试先行**：写不出测试的代码通常设计有问题
3. **30 秒规则**：如果一个类需要 30 秒以上才能理解，就该重构
4. **Boy Scout Rule**：每次路过都让代码比来时更好一点
5. **持续学习**：读《重构》《Clean Code》《设计模式》

## 5. 正模式 vs 反模式对照表

| 场景 | 正模式 | 反模式 |
|------|--------|--------|
| 多种算法 | 策略模式 | if-else 地狱 |
| 复杂对象创建 | 建造者 | 构造函数 10 个参数 |
| 全局唯一 | 单例（Spring 管理） | 全局变量、静态方法 |
| 通知多个对象 | 观察者 | 直接调用所有依赖 |
| 接口不兼容 | 适配器 | 改老代码 |
| 增强功能 | 装饰器 | 修改原始类 |
| 树形结构 | 组合模式 | 到处 instanceof |
| 大量相似对象 | 享元 | 每个都 new |

> **一句话记忆口诀**：识别反模式比学习模式更重要——上帝类、复制粘贴、面条代码是三大最常见的反模式，Code Review 和测试是最好的预防手段。
