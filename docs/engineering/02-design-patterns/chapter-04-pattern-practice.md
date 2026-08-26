# 设计模式实践与选型

> **核心问题**：在实际项目中如何选择合适的设计模式？如何避免模式的过度使用？模式之间如何组合？

## 1. 模式选型决策框架

选择设计模式时，关键不是"我该用哪个模式"，而是"我遇到了什么问题"。

| 问题 | 推荐模式 | 说明 |
|------|---------|------|
| 对象创建逻辑复杂 | 工厂方法、建造者 | 封装创建过程 |
| 需要全局唯一实例 | 单例 | 配置管理、连接池 |
| 接口不兼容 | 适配器 | 集成第三方库 |
| 需要动态增强功能 | 装饰器、代理 | 日志、缓存、权限 |
| 算法需要可替换 | 策略 | 排序、支付、定价 |
| 对象状态驱动行为 | 状态模式 | 订单状态机 |
| 请求需要多级处理 | 责任链 | 过滤器、审批流 |
| 一对多通知 | 观察者 | 事件系统 |
| 简化复杂子系统 | 外观 | 门面封装 |

## 2. 模式组合实战

### 2.1 策略 + 工厂 + 单例

```java
// 策略接口
interface PricingStrategy {
    BigDecimal calculate(BigDecimal basePrice, int quantity);
}

// 具体策略
class RegularPricing implements PricingStrategy {
    @Override
    public BigDecimal calculate(BigDecimal basePrice, int quantity) {
        return basePrice.multiply(BigDecimal.valueOf(quantity));
    }
}

class VipPricing implements PricingStrategy {
    @Override
    public BigDecimal calculate(BigDecimal basePrice, int quantity) {
        return basePrice.multiply(BigDecimal.valueOf(quantity))
                        .multiply(BigDecimal.valueOf(0.8));
    }
}

class WholesalePricing implements PricingStrategy {
    @Override
    public BigDecimal calculate(BigDecimal basePrice, int quantity) {
        BigDecimal discount = quantity >= 100
            ? BigDecimal.valueOf(0.7)
            : BigDecimal.valueOf(0.85);
        return basePrice.multiply(BigDecimal.valueOf(quantity)).multiply(discount);
    }
}

// 工厂（注册表模式，支持动态扩展）
class PricingStrategyFactory {
    private static final Map<String, PricingStrategy> STRATEGIES = Map.of(
        "regular", new RegularPricing(),
        "vip", new VipPricing(),
        "wholesale", new WholesalePricing()
    );
    
    public static PricingStrategy getStrategy(String type) {
        PricingStrategy strategy = STRATEGIES.get(type);
        if (strategy == null) {
            throw new IllegalArgumentException("未知的定价策略: " + type);
        }
        return strategy;
    }
}

// 使用
public class OrderPricingService {
    public BigDecimal calculatePrice(String customerType, BigDecimal unitPrice, int qty) {
        PricingStrategy strategy = PricingStrategyFactory.getStrategy(customerType);
        return strategy.calculate(unitPrice, qty);
    }
}
```

### 2.2 责任链 + 策略

```java
// 抽象处理器
abstract class OrderHandler {
    private OrderHandler next;
    
    public OrderHandler setNext(OrderHandler next) {
        this.next = next;
        return next;
    }
    
    public Order process(Order order) {
        order = doHandle(order);
        if (next != null && order != null) {
            return next.process(order);
        }
        return order;
    }
    
    protected abstract Order doHandle(Order order);
}

// 具体处理器
class ValidationHandler extends OrderHandler {
    @Override
    protected Order doHandle(Order order) {
        if (order.getAmount().compareTo(BigDecimal.ZERO) <= 0) {
            throw new IllegalArgumentException("订单金额必须大于0");
        }
        System.out.println("验证通过");
        return order;
    }
}

class InventoryHandler extends OrderHandler {
    @Override
    protected Order doHandle(Order order) {
        // 检查库存
        System.out.println("库存检查通过");
        return order;
    }
}

class PricingHandler extends OrderHandler {
    @Override
    protected Order doHandle(Order order) {
        // 应用优惠券、计算最终价格
        System.out.println("价格计算完成");
        return order;
    }
}

// 构建责任链
class OrderProcessingPipeline {
    public static OrderHandler build() {
        OrderHandler validation = new ValidationHandler();
        OrderHandler inventory = new InventoryHandler();
        OrderHandler pricing = new PricingHandler();
        
        validation.setNext(inventory).setNext(pricing);
        return validation;
    }
}

// 使用
OrderHandler pipeline = OrderProcessingPipeline.build();
Order result = pipeline.process(order);
```

## 3. 反模式：模式的过度使用

| 反模式 | 表现 | 正确做法 |
|--------|------|----------|
| 模式强迫症 | 简单 CRUD 也要用工厂+策略 | 遵循 YAGNI，简单场景用简单方案 |
| 过度抽象 | 一个实现也要抽接口 | Rule of Three：有 3 个实现再抽象 |
| 模式堆砌 | 一个类同时用 5 种模式 | 每个类只解决一个问题 |
| 忽视语言特性 | 用策略模式替代简单 Lambda | Java 8+ 的函数式接口更简洁 |

```java
// 过度设计：简单场景不需要策略模式
interface StringValidator {
    boolean validate(String s);
}
class EmailValidator implements StringValidator { /* ... */ }
class PhoneValidator implements StringValidator { /* ... */ }

// 合理设计：用 Lambda 简化
Map<String, Predicate<String>> validators = Map.of(
    \"email\", s -> s.matches(\"[\\\\w.]+@[\\\\w.]+\"),
    \"phone\", s -> s.matches(\"1\\\\d{10}\")
);
```

## 4. 框架中的模式应用

| 框架 | 使用的模式 | 说明 |
|------|-----------|------|
| Spring IoC | 工厂 + 单例 + 代理 | BeanFactory 创建 Bean，默认单例，AOP 用代理 |
| Spring MVC | 前端控制器 + 策略 | DispatcherServlet 统一分发，HandlerMapping 策略 |
| MyBatis | 代理 + 建造者 | Mapper 代理、SqlSessionFactory.Builder |
| Netty | 责任链 + 观察者 | ChannelPipeline 责任链、EventLoop 观察者 |
| JDK | 模板方法 + 迭代器 | `AbstractList`、`Iterator` |

> **核心原则**：设计模式是解决问题的工具，不是目标。先理解问题，再选择模式。能用简单方案解决的，就不要引入模式的复杂度。
