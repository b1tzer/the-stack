# 适配器模式

## 1. 🏠 生活类比

充电器转接头：国标插头 → 转接头 → 美标插座。

你不需要改插头，也不需要改插座，加个转接头就行。

## 2. 💩 烂代码

```java
// 老接口，金额以「分」为单位，int 类型
interface OldPayment {
    void payByCard(String cardNo, int amountInCents);
}

// 新系统的请求对象，金额统一用「元」
class PaymentRequest {
    String getCardNo() { ... }
    BigDecimal getAmount() { ... }
}

interface NewPayment {
    void pay(PaymentRequest request);
}

// 老接口是第三方库，改不动；重写所有调用方，改动面又太大
```

## 3. ✨ 适配器模式

```java
class PaymentAdapter implements NewPayment {
    private OldPayment oldPayment;
    
    public PaymentAdapter(OldPayment oldPayment) {
        this.oldPayment = oldPayment;
    }
    
    public void pay(PaymentRequest request) {
        // 契约转换，元转分是适配器的职责
        int cents = request.getAmount()
                .movePointRight(2)   // 元转分
                .intValueExact();    // 仅保证能精确转成 int，不含业务校验
        oldPayment.payByCard(request.getCardNo(), cents);
    }
}
```

## 4. 🔧 框架应用

- Spring MVC `HandlerAdapter`。DispatcherServlet 通过它调用不同类型的 Handler，`supports()` 判断能否处理、`handle()` 执行调用，把处理器类型差异隔离在统一调用流程之外。
- JDK `InputStreamReader`。把字节流 `InputStream` 适配成字符流 `Reader`，读取时按字符集解码，是数据表示形式的转换，不只是方法改名。

## 5. ⚠️ 适用场景

- 接口不兼容、使用第三方库、老系统迁移时，引入适配器。
- 两端接口都由自己维护、改动不破坏其他调用方时，直接统一接口更省事。
- 适配器只做接口映射、参数与返回值转换，业务规则不要塞进适配器。

与装饰器、代理的区别见 [结构型模式对比](./chapter-08-structural-comparison.md)，`InputStreamReader` 的更多细节见 [JDK 中的设计模式](../04-practice/chapter-03-jdk-patterns.md)。
