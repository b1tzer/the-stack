# 策略模式

## 1. 🏠 生活类比

去餐厅付款：可以现金、刷卡、支付宝、微信。你选一种方式就行，餐厅不需要改收银系统。

## 2. 💩 烂代码

```java
public void pay(String type, BigDecimal amount) {
    if ("alipay".equals(type)) {
        // 支付宝逻辑
    } else if ("wechat".equals(type)) {
        // 微信逻辑
    } else if ("bank".equals(type)) {
        // 银行卡逻辑
    }
    // 每次新增支付方式都要改这里
}
```

## 3. ✨ 策略模式

```java
// 策略接口
interface PaymentStrategy {
    void pay(BigDecimal amount);
}

// 具体策略
class Alipay implements PaymentStrategy {
    public void pay(BigDecimal amount) { /* 支付宝支付 */ }
}
class WechatPay implements PaymentStrategy {
    public void pay(BigDecimal amount) { /* 微信支付 */ }
}

// 上下文
class PaymentContext {
    private PaymentStrategy strategy;
    
    public void setStrategy(PaymentStrategy strategy) {
        this.strategy = strategy;
    }
    
    public void pay(BigDecimal amount) {
        strategy.pay(amount);
    }
}

// 使用
PaymentContext ctx = new PaymentContext();
ctx.setStrategy(new Alipay());
ctx.pay(new BigDecimal("100"));
```

## 4. 🔧 框架应用

- Spring: `Resource` 接口（ClassPathResource/FileSystemResource）
- JDK: `Comparator`、`ThreadPoolExecutor` 的拒绝策略

## 5. ⚠️ 适用场景

- 多种算法/策略
- 需要运行时切换
- 消除 if-else
