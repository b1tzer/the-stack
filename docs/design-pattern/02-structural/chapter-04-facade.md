---
doc_id: dp-结构型补充-外观桥接组合享元
title: 结构型补充 — 外观、桥接、组合、享元模式
---

# 结构型补充 — 外观、桥接、组合、享元模式

> **一句话记忆口诀**：外观简化入口、桥接分离维度、组合统一树形、享元共享复用。

## 1. 外观模式（Facade Pattern）

### 1.1 引入：它解决了什么问题？

当一个子系统包含多个复杂的类和接口时，客户端需要了解每个类的细节才能完成操作：

```java
// ❌ 反例：客户端直接调用多个子系统，耦合度极高
public class OrderService {
    public void placeOrder(Order order) {
        InventorySystem inventory = new InventorySystem();
        inventory.checkStock(order.getProductId());
        inventory.reserveStock(order.getProductId(), order.getQuantity());
        PaymentSystem payment = new PaymentSystem();
        payment.validateCard(order.getCardNumber());
        payment.charge(order.getAmount());
        ShippingSystem shipping = new ShippingSystem();
        shipping.createShipment(order);
        NotificationSystem notification = new NotificationSystem();
        notification.sendEmail(order.getUserEmail(), "订单已创建");
    }
}
```

**问题根因**：客户端与子系统的多个类直接耦合，调用逻辑分散，维护成本高。

### 1.2 类比与定义

**生活类比**：酒店前台就是外观模式。住客不需要分别联系客房部、餐饮部、保洁部，只需要打电话给前台，前台协调所有部门完成服务。

> 外观模式为子系统中的一组接口提供一个**统一的高层接口**，使子系统更容易使用。

### 1.3 原理与实现

```java
// ===== 外观类：统一入口，封装子系统调用逻辑 =====
public class OrderFacade {
    private final InventorySystem inventory;
    private final PaymentSystem payment;
    private final ShippingSystem shipping;
    private final NotificationSystem notification;

    public OrderFacade(InventorySystem inventory, PaymentSystem payment,
                       ShippingSystem shipping, NotificationSystem notification) {
        this.inventory = inventory;
        this.payment = payment;
        this.shipping = shipping;
        this.notification = notification;
    }

    public boolean placeOrder(Order order) {
        if (!inventory.checkStock(order.getProductId())) return false;
        inventory.reserveStock(order.getProductId(), order.getQuantity());
        payment.charge(order.getAmount());
        shipping.createShipment(order);
        notification.sendEmail(order.getUserEmail(), "订单已创建");
        return true;
    }
}

// ===== 客户端调用 =====
OrderFacade facade = new OrderFacade(inventory, payment, shipping, notification);
facade.placeOrder(order); // 一行代码搞定！
```

### 1.4 在 Spring / JDK 中的应用

| 框架/类 | 说明 |
| :-- | :-- |
| `JdbcTemplate` | 封装了 Connection、Statement、ResultSet 的复杂操作 |
| `SLF4J` | 日志门面，统一 Log4j、Logback 等日志框架的接口 |
| `RestTemplate` | 封装了 HTTP 连接、序列化、错误处理等细节 |
| Spring `ApplicationContext` | 统一了 BeanFactory、ResourceLoader、EventPublisher 等子系统 |

### 1.5 常见误区

- **误区**：外观类变成"上帝类" → 外观类只做**编排和委托**，不包含业务逻辑
- **误区**：有了外观就不能直接访问子系统 → 外观是**可选的便捷入口**，不阻止直接访问

## 2. 桥接、组合、享元：进入单页详解

这三个模式的完整讲解各自单独成页，包含生活类比、烂代码对比、完整实现、框架应用和适用场景，本页不重复展开：

- [桥接模式](./chapter-05-bridge.md)——抽象与实现分离，用组合连接两个独立变化的维度，避免继承导致的类爆炸。
- [组合模式](./chapter-06-composite.md)——把叶子和容器统一到同一个接口，让客户端不必区分二者。
- [享元模式](./chapter-07-flyweight.md)——分离内部状态与外部状态，用共享对象换内存。

## 3. 四种模式对比总结

| 模式 | 核心思想 | 解决的问题 | 关键词 |
| :-- | :-- | :-- | :-- |
| **外观模式** | 统一入口 | 子系统复杂，客户端调用困难 | 简化、封装、门面 |
| **桥接模式** | 分离维度 | 多维度变化导致类爆炸 | 抽象与实现分离 |
| **组合模式** | 统一接口 | 树形结构中叶子和容器处理不一致 | 部分-整体、递归 |
| **享元模式** | 共享复用 | 大量相似对象消耗过多内存 | 内部状态、外部状态 |

> **复习检验标准**：能否口述"这个模式解决了什么问题？不用它会怎样？Spring 中哪里用到了？"
