# 适配器模式

## 1. 🏠 生活类比

充电器转接头：国标插头 → 转接头 → 美标插座。

你不需要改插头，也不需要改插座，加个转接头就行。

## 2. 💩 烂代码

```java
// 老接口
interface OldPayment {
    void payByCard(String cardNo, double amount);
}

// 新系统要用新接口
interface NewPayment {
    void pay(PaymentRequest request);
}

// 直接改老代码？影响太大！
```

## 3. ✨ 适配器模式

```java
class PaymentAdapter implements NewPayment {
    private OldPayment oldPayment;
    
    public PaymentAdapter(OldPayment oldPayment) {
        this.oldPayment = oldPayment;
    }
    
    public void pay(PaymentRequest request) {
        // 适配：新接口转老接口
        oldPayment.payByCard(request.getCardNo(), request.getAmount());
    }
}
```

## 4. 🔧 框架应用

- Spring MVC: `HandlerAdapter`
- JDK: `InputStreamReader`（字节流→字符流）

## 5. ⚠️ 适用场景

- 接口不兼容
- 使用第三方库
- 老系统迁移
