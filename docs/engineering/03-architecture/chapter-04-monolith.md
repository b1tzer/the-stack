# 模块化单体架构

> **核心问题**：如何在单体架构中保持代码的模块化？如何为未来可能的微服务拆分做好准备？

## 1. 什么是模块化单体

模块化单体是在一个部署单元内，按业务域划分模块，每个模块有清晰的边界和独立的数据模型。

```
┌─────────────────────────────────────────┐
│            模块化单体应用                 │
│                                         │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐│
│  │ 用户模块  │ │ 订单模块  │ │ 商品模块  ││
│  │          │ │          │ │          ││
│  │ user_db  │ │ order_db │ │ prod_db  ││
│  └──────────┘ └──────────┘ └──────────┘│
│         ↕ 通过接口通信 ↕                 │
│  ┌─────────────────────────────────────┐│
│  │         共享内核（Common）           ││
│  └─────────────────────────────────────┘│
└─────────────────────────────────────────┘
```

## 2. Java 模块化实践

### 2.1 Maven 多模块结构

```xml
<!-- 父 POM -->
<modules>
    <module>common</module>
    <module>user-module</module>
    <module>order-module</module>
    <module>product-module</module>
    <module>web-app</module>  <!-- 最终打包为单个可部署单元 -->
</modules>
```

### 2.2 模块间通过接口通信

```java
// user-module: 对外暴露的接口
public interface UserService {
    UserDTO findById(Long id);
    UserDTO findByUsername(String username);
}

// user-module: 内部实现（对外不可见）
@Service
class UserServiceImpl implements UserService {
    @Override
    public UserDTO findById(Long id) {
        // 实现细节
        return null;
    }
    @Override
    public UserDTO findByUsername(String username) {
        return null;
    }
}

// order-module: 依赖 user-module 的接口，而非实现
@Service
public class OrderService {
    private final UserService userService;  // 依赖接口
    
    public OrderService(UserService userService) {
        this.userService = userService;
    }
    
    public OrderDTO createOrder(Long userId, List<OrderItem> items) {
        UserDTO user = userService.findById(userId);  // 跨模块调用
        // 创建订单逻辑
        return null;
    }
}
```

## 3. 数据库层面的模块化

```java
// 方案一：Schema 隔离（推荐）
// user_module.users, order_module.orders
// 每个模块使用独立的 Schema，禁止跨 Schema 直接 JOIN

// 方案二：逻辑隔离
// 同一数据库，但通过表前缀区分模块
// um_users, om_orders, pm_products

// 模块间数据通过 API 获取，不直接查询对方的表
// 差：order_module 直接 JOIN user_module 的表
// 好：order_module 通过 UserService API 获取用户信息
```

## 4. 从模块化单体到微服务的拆分路径

| 阶段 | 做法 | 时机 |
| :-- | :-- | :-- |
| 阶段 1 | 模块化单体 | 项目初期，团队 < 10 人 |
| 阶段 2 | 提取独立部署的模块 | 某模块需要独立扩展 |
| 阶段 3 | 按业务域拆分为微服务 | 团队 > 15 人，需要独立发布 |

```java
// 拆分检查清单：
// 1. 模块是否有清晰的 API 边界？→ 是 → 容易拆分
// 2. 模块间是否有大量数据库 JOIN？→ 是 → 需要先重构
// 3. 模块是否有独立的数据模型？→ 是 → 容易拆分
// 4. 模块是否有独立的发布需求？→ 是 → 值得拆分
```

## 5. Spring Modulith

```java
// Spring Modulith 提供了模块化单体的开箱即用支持
// 自动检测模块边界违规

// 模块结构：
// com.example.app
//   ├── user/          // 用户模块
//   │   ├── User.java
//   │   └── UserService.java
//   ├── order/         // 订单模块
//   │   ├── Order.java
//   │   └── OrderService.java
//   └── shared/        // 共享内核
//       └── EventPublisher.java

// 模块间通过 ApplicationEvent 通信
@Service
public class OrderService {
    private final ApplicationEventPublisher events;
    
    public OrderService(ApplicationEventPublisher events) {
        this.events = events;
    }
    
    public void createOrder(Long userId) {
        // 创建订单
        events.publishEvent(new OrderCreatedEvent(userId));
    }
}
```

> **核心理念**：模块化单体是微服务的"训练轮"。它让你在享受单体简单性的同时，建立清晰的模块边界。当业务需要时，可以平滑地拆分为微服务。
