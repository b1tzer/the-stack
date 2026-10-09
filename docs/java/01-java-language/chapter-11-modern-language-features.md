# 现代 Java：record、sealed 与模式匹配

> DTO 里手写 30 行 `equals`、`hashCode` 和 `toString`；类型层次不断增加 `instanceof` 分支；异常转换逻辑既要详尽又要避免漏掉子类。Java 8 之后引入的 record、sealed 和模式匹配，分别针对数据载体、类型边界和分支穷尽性。

本页适用于以 Java 21 为基线的后端代码，解释这些特性何时改变代码结构，以及它们没有解决的问题。JPMS 模块系统放在本页末尾说明定位，不进入 Java 主线章节。

## 1. 用 record 表达不可变数据载体

### 1.1 record 自动生成什么

```java
record Money(long minorUnits, String currency) {
    Money {
        if (minorUnits < 0) {
            throw new IllegalArgumentException("minorUnits must be >= 0");
        }
        currency = currency.toUpperCase(Locale.ROOT);
    }
}

Money price = new Money(1299, "cny");
System.out.println(price.minorUnits()); // 1299
System.out.println(price);              // Money[minorUnits=1299, currency=CNY]
```

record 自动生成组件访问器、基于组件的 `equals`/`hashCode` 和 `toString`。紧凑构造器在字段赋值前执行校验或规范化，适合让非法状态无法被创建。

record 的组件引用不能被重新赋值，但这只是浅层不可变。如果组件本身是可变数组、集合或对象，外部仍可修改其内容：

```java
record Snapshot(List<String> tags) {
    Snapshot {
        tags = List.copyOf(tags); // 防止调用方传入后继续修改同一列表
    }
}
```

是否复制、防御性读取或只暴露不可变视图，要根据数据是否跨信任边界和生命周期复用来决定。

### 1.2 record 什么时候不适合

- 需要可变状态、延迟初始化或对象池语义时，普通类更合适。
- 组件数量很多且没有稳定含义时，record 可能只是把复杂度藏进长参数列表。
- 持久化框架、序列化协议或代理机制对 record 有特定限制时，应先验证集成行为。
- record 不会自动让聚合根变成值对象；业务不变量仍需明确建模。

record 主要简化“由哪些值共同标识一个结果”的数据结构，不替代面向对象行为。

## 2. 用 sealed 表达封闭类型边界

```java
sealed interface PaymentResult
        permits PaymentAccepted, PaymentRejected, PaymentPending {}

record PaymentAccepted(String transactionId) implements PaymentResult {}
record PaymentRejected(String code, String reason) implements PaymentResult {}
record PaymentPending(String requestId) implements PaymentResult {}
```

`permits` 明确允许哪些类型实现该父类型。编译器据此约束继承关系，并支持穷尽性检查：

```java
String label = switch (result) {
    case PaymentAccepted accepted -> "accepted:" + accepted.transactionId();
    case PaymentRejected rejected -> "rejected:" + rejected.code();
    case PaymentPending pending   -> "pending:" + pending.requestId();
};
```

新增没有列入 permits 的子类型无法通过编译；在当前封闭集合上省略 `default` 时，编译器可以检查所有类型是否已覆盖。

sealed 的价值不是“禁止所有扩展”，而是把“哪些扩展属于这个协议”写成代码契约。开放框架扩展点通常仍应使用普通接口或抽象类。

## 3. 用模式匹配减少重复类型展开

### 3.1 instanceof 模式

Java 16 起，`instanceof` 可以同时完成类型判断和绑定：

```java
if (value instanceof String text && !text.isBlank()) {
    return text.strip();
}
```

模式变量只在条件成立的流程分支中可用。这比先 `instanceof`、再强制转换更不容易出现判断与转换对象不一致。

### 3.2 record 模式与 switch 模式

Java 21 中，switch 支持类型模式、guard 和 record 模式：

```java
String describe(Object value) {
    return switch (value) {
        case null                     -> "null";
        case String text              -> "text:" + text;
        case Money money when money.minorUnits() == 0
                                      -> "free";
        case Money money              -> money.currency() + ":" + money.minorUnits();
        case PaymentAccepted accepted -> "accepted:" + accepted.transactionId();
        case PaymentRejected rejected -> "rejected:" + rejected.code();
        case PaymentPending pending   -> "pending:" + pending.requestId();
        default                       -> "unknown";
    };
}
```

上例以 `Object` 为分支目标，因此需要 `default`；如果目标类型是上一节的 `PaymentResult`，则可在封闭子类型全部覆盖时省略 `default`，让编译器检查穷尽性。使用模式时还要遵守三条边界：

1. 分支顺序会改变结果，类型更具体或条件更强的模式应放在前面。
2. guard 抛出的异常仍会传播；不要在 guard 中执行 I/O 或昂贵计算。
3. 对封闭类型层次做穷尽匹配时，新增允许子类型会让缺失分支在编译期暴露。

模式匹配减少的是机械类型转换，不替你决定业务分支是否正确。

## 4. 现代特性与既有概念的关系

| 特性 | 主要解决 | 仍依赖 |
| :-- | :-- | :-- |
| record | 数据组件、浅层不可变、生成值语义 | 组件自身的不变量与可变性 |
| sealed | 封闭继承集合与穷尽匹配 | 明确稳定的类型协议 |
| `instanceof` 模式 | 安全的类型判断与绑定 | 正确的流程条件 |
| switch 模式 | 多类型分支与穷尽检查 | 分支顺序、guard 和默认行为 |

它们建立在[类型系统](./chapter-02-type-system.md)、[对象与值语义](./chapter-03-object-values.md)和[面向对象](./chapter-04-oop.md)之上。record 自动生成的相等性仍遵守 `equals`/`hashCode` 契约；sealed 层次仍通过接口和继承组织行为。

## 5. JPMS 模块系统的定位

JPMS 通过 `module-info.java` 声明模块依赖、导出包和服务关系：

```java
module example.orders {
    requires java.net.http;
    exports com.example.orders.api;
}
```

它解决运行时组件边界和封装问题，不等同于 Maven/Gradle 的构建模块，也不会自动替你划分微服务。对于普通类路径部署，引入 JPMS 会增加依赖描述、反射开放和第三方库兼容性成本。

本知识库当前不把 JPMS 设为独立主线：语言基础、JVM、并发、网络和数据访问优先形成连续阅读路径。需要设计多模块应用或诊断 `module not found` 时，再按 [JEP 261: Module System](https://openjdk.org/jeps/261)补全。

## 6. 下一步

现代语法补齐语言表达能力后，可以进入[字节码与类加载](../02-jvm-runtime/chapter-01-bytecode-classloading.md)看这些类型如何进入运行时；生产上的类型、容器和失败问题分别回到[异常与资源管理](./chapter-08-exceptions.md)、[标准集合](./chapter-09-collections.md)和[诊断总览](../06-diagnostics/index.md)。

> **官方参考：** [JEP 395: Records](https://openjdk.org/jeps/395)、[JEP 409: Sealed Classes](https://openjdk.org/jeps/409)、[JEP 441: Pattern Matching for switch](https://openjdk.org/jeps/441)。
