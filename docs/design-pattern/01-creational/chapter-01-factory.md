# 工厂模式

## 1. 🏠 生活类比

你去餐厅点餐：你说"来份宫保鸡丁"，厨房就做出来。你不需要知道厨师是谁、用的什么锅。

餐厅 = 工厂，菜品 = 产品，点餐 = 创建对象。

「工厂模式」是广义统称。后面三节讲的简单工厂、工厂方法、抽象工厂是三种不同机制，解决的问题不同。简单工厂把创建分支集中到一个地方，是常见习惯用法，不是 GoF 的独立模式。工厂方法把创建决策推迟到子类，父类保留公共业务流程。抽象工厂保证一组相互关联的产品出自同一产品族，切换工厂就切换整套实现。

## 2. 💩 烂代码

```java
// 每次新增支付方式，都要改这里
public Payment createPayment(String type) {
    if ("alipay".equals(type)) return new Alipay();
    else if ("wechat".equals(type)) return new WechatPay();
    else if ("bank".equals(type)) return new BankPay();
    // 新增类型要改这个方法，分支一多维护成本就上来了
}
```

## 3. ✨ 简单工厂

```java
public class PaymentFactory {
    private static Map<String, Supplier<Payment>> registry = Map.of(
        "alipay", Alipay::new,
        "wechat", WechatPay::new,
        "bank", BankPay::new
    );
    
    public static Payment create(String type) {
        Supplier<Payment> supplier = registry.get(type);
        if (supplier == null) throw new IllegalArgumentException("Unknown: " + type);
        return supplier.get();
    }
}
```

这个注册表没有消除对工厂代码的修改，新增支付方式仍然要改 `PaymentFactory`。它解决的是创建逻辑集中管理，而不是自动获得开闭原则的扩展性。

## 4. ✨ 工厂方法

```java
// Creator 定义公共业务流程，创建决策推迟给子类
abstract class PaymentProcessor {
    protected abstract Payment createPayment();

    public void processPayment() {
        Payment payment = createPayment();
        payment.pay();
    }
}

class AlipayProcessor extends PaymentProcessor {
    @Override
    protected Payment createPayment() { return new Alipay(); }
}

class WechatProcessor extends PaymentProcessor {
    @Override
    protected Payment createPayment() { return new WechatPay(); }
}
```

公共流程 `processPayment()` 由父类维护，创建哪种支付由子类重写 `createPayment()` 决定。工厂方法的关键是 Creator 定义创建接口、具体 Creator 决定实例化哪种产品，公共流程不是它的成立条件。当父类确实有需要复用的、且依赖所创建产品的流程时，工厂方法的价值最明显；如果只是选择不同创建器，工厂接口加依赖注入更简单。

## 5. ✨ 抽象工厂

```java
// 创建一族相互兼容的产品
interface UIFactory {
    Button createButton();
    Input createInput();
}

class DarkUIFactory implements UIFactory {
    public Button createButton() { return new DarkButton(); }
    public Input createInput() { return new DarkInput(); }
}

class LightUIFactory implements UIFactory {
    public Button createButton() { return new LightButton(); }
    public Input createInput() { return new LightInput(); }
}
```

客户端只持有 `UIFactory`，切换 `DarkUIFactory` 与 `LightUIFactory` 就切换整套深浅色实现，不会出现深色按钮配浅色输入框的混搭。这正是抽象工厂区别于分别注入两个独立工厂的地方。

## 6. 🔧 框架中的工厂机制

- Spring 的 `BeanFactory` 是容器核心接口，负责访问容器中的 Bean。`FactoryBean` 是由容器管理的特殊 Bean，通过 `getObject()` 提供对象
- JDK 的 `Calendar.getInstance()`、`NumberFormat.getInstance()` 属于静态工厂方法，与子类重写创建方法的 GoF 工厂方法不是一回事

## 7. ⚠️ 适用场景

- 创建过程需要封装配置或选择逻辑
- 需要解耦创建和使用
- 需要支持多种产品类型

缓存、对象池等复用策略可能由工厂一并封装，但它们不属于工厂模式本身，也不是创建逻辑的必要部分。
