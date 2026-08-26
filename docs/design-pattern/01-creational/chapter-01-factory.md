# 工厂模式

## 1. 🏠 生活类比

你去餐厅点餐：你说"来份宫保鸡丁"，厨房就做出来。你不需要知道厨师是谁、用的什么锅。

餐厅 = 工厂，菜品 = 产品，点餐 = 创建对象。

## 2. 💩 烂代码

```java
// 每次新增支付方式，都要改这里
public Payment createPayment(String type) {
    if ("alipay".equals(type)) return new Alipay();
    else if ("wechat".equals(type)) return new WechatPay();
    else if ("bank".equals(type)) return new BankPay();
    // 违反开闭原则！
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

## 4. ✨ 工厂方法

```java
// 每个产品有自己的工厂
interface PaymentFactory {
    Payment create();
}
class AlipayFactory implements PaymentFactory {
    public Payment create() { return new Alipay(); }
}
```

## 5. ✨ 抽象工厂

```java
// 创建一族产品
interface UIFactory {
    Button createButton();
    Input createInput();
}
class DarkUIFactory implements UIFactory {
    public Button createButton() { return new DarkButton(); }
    public Input createInput() { return new DarkInput(); }
}
```

## 6. 🔧 框架应用

- Spring: `BeanFactory`、`FactoryBean`
- JDK: `Calendar.getInstance()`、`NumberFormat.getInstance()`

## 7. ⚠️ 适用场景

- 创建逻辑复杂（需要配置、缓存、池化）
- 需要解耦创建和使用
- 需要支持多种产品类型
