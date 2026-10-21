# 策略模式

> **一句话记忆口诀**：策略模式把一组可替换的算法封装成独立类，运行时按需切换，替代不断膨胀的 if-else。

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

> ⚠️ 上面的 `setStrategy()` 是为了演示运行期替换，默认 `PaymentContext` 是短生命周期、单线程使用的对象。若把它注册成 Spring 单例 Bean 或跨线程共享，`setStrategy()` 与 `pay()` 并发调用会出现可见性问题，一次调用可能拿到预期之外的策略。两种常见做法：策略固定时，在构造阶段注入 `final PaymentStrategy`，运行期不修改；确实要动态切换时，把策略字段声明为 `volatile` 保证引用可见，并在一次业务操作开始时读取一次引用、本次调用全程沿用。注意 `volatile` 只保证引用本身可见，不保证策略对象内部状态的线程安全，若策略自身可变或依赖被并发修改的配置，仍需额外的同步手段。

## 4. 🔍 工程化决策

策略模式的价值不在「用多态替换 if-else」这一步，而在选型和边界判断。

**哪些分支值得抽策略**：分支会持续增长、每个分支是独立完整算法时，才值得抽策略类。分支只有两三个、逻辑稳定且很少变化时，直接写 if-else 反而更清晰。

**策略如何注册与选择**：抽出的策略类需要能被找到。简单场景用注册表 `Map<Type, Strategy>`，按 key 取策略；当调用方只依赖注册表、注册过程支持独立扩展时，新增策略可以只加一条注册而不改调用方，手动维护的注册表仍需同步修改注册配置。Spring 场景把策略实现标成 Bean，`List<Strategy>` 自动注入全部实现，再用 `getType()` 建映射，类型映射、重复 key 和缺失策略仍需自行兜底。

**代价与职责边界**：策略模式只是把 if-else 转移成 N 个类加一张注册表，实现类变多、选择逻辑并没有消失。策略接口只应承担算法本身；事务、异常兜底、重试这类横切职责要留在调用方或公共执行层，别塞进每个策略类。

## 5. 🔧 框架应用

- JDK：`Comparator`、`ThreadPoolExecutor` 的拒绝策略（更典型的示例）
- Spring：`Resource` 接口（ClassPathResource/FileSystemResource）

`Resource` 首先是对不同资源来源的统一抽象，体现可替换的多态设计，与策略模式有关联，但不宜仅凭「接口 + 多实现」就等同于经典策略模式。`Comparator` 和线程池拒绝策略才是更贴切的核心示例。

## 6. ⚠️ 适用场景

- 同一操作存在多种算法，且需要运行期切换
- 分支会持续增长、每个分支是独立完整的算法
- 大段 if-else 持续膨胀、各分支逻辑独立，抽成策略类后更易维护和单测

## 🔗 延伸阅读

- [重构到设计模式](../04-practice/chapter-04-refactoring-to-patterns.md)：从 if-else 到策略注册表的完整迁移过程
- [行为型模式对比](./chapter-11-behavioral-comparison.md)：策略 vs 状态、策略 vs 模板方法的职责取舍
- [JDK 中的设计模式](../04-practice/chapter-03-jdk-patterns.md)：`Comparator` 与线程池拒绝策略的应用
