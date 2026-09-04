# 重构技术

## 1. 什么是重构

在不改变外部行为的前提下，改善代码内部结构。

## 2. 常用重构手法

| 手法 | 说明 |
| :-- | :-- |
| 提取方法 | 将代码片段提取为独立方法 |
| 提取类 | 将部分职责提取到新类 |
| 内联方法 | 将简单方法内联到调用处 |
| 移动方法 | 将方法移到更合适的类 |
| 重命名 | 使用更有意义的名称 |
| 引入参数对象 | 将多个参数封装为对象 |
| 引入接口 | 提取抽象接口 |
| 以多态取代条件 | 用策略模式替代 if-else |

## 3. 重构到模式

```java
// 重构前：大量 if-else
if (type.equals("alipay")) {
    // 支付宝逻辑
} else if (type.equals("wechat")) {
    // 微信逻辑
}

// 重构后：策略模式
interface Payment { void pay(BigDecimal amount); }
Map<String, Payment> payments = Map.of(
    "alipay", new Alipay(),
    "wechat", new WechatPay()
);
payments.get(type).pay(amount);
```

## 4. 重构时机

- 添加功能前
- 修复 Bug 时
- Code Review 后
- 定期重构（每周/每迭代）

## 5. 重构手法详解与代码示例

### 5.1 提取方法（Extract Method）

```java
// 重构前
void printOwing(double amount) {
    printBanner();
    
    // 打印详情
    System.out.println("name: " + name);
    System.out.println("amount: " + amount);
}

// 重构后
void printOwing(double amount) {
    printBanner();
    printDetails(amount);
}

void printDetails(double amount) {
    System.out.println("name: " + name);
    System.out.println("amount: " + amount);
}
```

### 5.2 引入参数对象（Introduce Parameter Object）

```java
// 重构前：参数过多
void createOrder(String userId, String productId, int quantity,
                 String address, String city, String zipCode,
                 String phone, String couponCode) { /* ... */ }

// 重构后：封装为参数对象
record OrderRequest(
    String userId,
    String productId,
    int quantity,
    ShippingAddress address,
    String couponCode
) {}

record ShippingAddress(String street, String city, String zipCode, String phone) {}

void createOrder(OrderRequest request) { /* ... */ }
```

### 5.3 以多态取代条件表达式（Replace Conditional with Polymorphism）

```java
// 重构前：大量 if-else
class PriceCalculator {
    BigDecimal calculate(String customerType, BigDecimal basePrice) {
        if ("regular".equals(customerType)) {
            return basePrice.multiply(BigDecimal.valueOf(0.9));
        } else if ("premium".equals(customerType)) {
            return basePrice.multiply(BigDecimal.valueOf(0.8));
        } else if ("vip".equals(customerType)) {
            return basePrice.multiply(BigDecimal.valueOf(0.7));
        }
        return basePrice;
    }
}

// 重构后：策略模式
interface PricingStrategy {
    BigDecimal calculate(BigDecimal basePrice);
}

class RegularPricing implements PricingStrategy {
    @Override
    public BigDecimal calculate(BigDecimal basePrice) {
        return basePrice.multiply(BigDecimal.valueOf(0.9));
    }
}

class PremiumPricing implements PricingStrategy {
    @Override
    public BigDecimal calculate(BigDecimal basePrice) {
        return basePrice.multiply(BigDecimal.valueOf(0.8));
    }
}

class VipPricing implements PricingStrategy {
    @Override
    public BigDecimal calculate(BigDecimal basePrice) {
        return basePrice.multiply(BigDecimal.valueOf(0.7));
    }
}
```

### 5.4 以工厂取代构造函数（Replace Constructor with Factory）

```java
// 重构前：直接 new 对象，创建逻辑暴露给调用方
Order order = new Order(userId, amount, type);
if ("express".equals(type)) {
    order.setShippingFee(BigDecimal.valueOf(20));
} else {
    order.setShippingFee(BigDecimal.valueOf(5));
}

// 重构后：工厂封装创建逻辑
class OrderFactory {
    public static Order create(String userId, BigDecimal amount, String type) {
        Order order = new Order(userId, amount, type);
        order.setShippingFee(calculateShippingFee(type));
        return order;
    }
    
    private static BigDecimal calculateShippingFee(String type) {
        return "express".equals(type)
            ? BigDecimal.valueOf(20)
            : BigDecimal.valueOf(5);
    }
}
```

## 6. 安全重构的实践原则

| 原则 | 说明 |
| :-- | :-- |
| 小步前进 | 每次只做一个小改动，验证后再继续 |
| 保持测试通过 | 重构前后测试都应通过 |
| 先写测试 | 重构前先补充缺失的测试 |
| 使用 IDE 工具 | IntelliJ 的 Refactor 菜单自动处理引用 |
| 版本控制 | 每个小步骤单独提交，方便回滚 |
| 避免重构+修改 | 重构和功能修改分开提交 |

```java
// 安全重构流程示例：将 God Class 拆分为多个类
// Step 1: 为现有行为编写测试
@Test
void shouldCalculateDiscount() {
    GodClass gc = new GodClass();
    assertEquals(BigDecimal.valueOf(0.9), gc.calculateDiscount("regular"));
}

// Step 2: 提取 DiscountCalculator 类
// Step 3: 将调用从 GodClass 委托到 DiscountCalculator
// Step 4: 更新所有调用方
// Step 5: 删除 GodClass 中的旧代码
// Step 6: 运行所有测试确认无误
```

> **重构戒律**：重构不是重写。重构是在保持行为不变的前提下改善结构。如果你需要改变行为，那是修改功能，不是重构。两者不要混在一起做。
