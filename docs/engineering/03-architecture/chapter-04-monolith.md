# 模块化单体架构

> **核心问题**：如何在单体架构中保持代码的模块化？如何为未来可能的微服务拆分做好准备？

## 1. 什么是模块化单体

模块化单体是在一个部署单元内，按业务域划分模块，每个模块有清晰的边界和独立的数据模型。

```txt
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

> 图中各模块的 db 表示数据所有权边界，属于逻辑划分，不要求每个模块物理独立数据库。

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

> **约束边界**：Schema 隔离只是命名空间层面的划分，不等于安全边界。同一数据库账号拥有全部 Schema 访问权限时，跨模块访问仍可能发生。落地时需要明确三件事：① 每个模块负责哪些表、实体和数据写入规则（数据所有权）；② 通过数据库权限、独立访问账号、迁移脚本归属或架构测试等手段约束跨模块访问；③ 区分事务内必须立即获得的数据与允许延迟同步的数据，前者通过模块 API 协作，后者考虑事件与本地读模型。独立数据库不是模块化单体的前提，独立 Schema 也不是每个模块的强制要求。

## 4. 从模块化单体到微服务的拆分路径

| 阶段 | 做法 | 时机（参考，非硬性门槛） |
| :-- | :-- | :-- |
| 阶段 1 | 模块化单体 | 项目初期，业务边界未稳定 |
| 阶段 2 | 提取独立部署的模块 | 某模块需要独立扩缩容或故障隔离 |
| 阶段 3 | 按业务域拆分为微服务 | 出现独立发布、独立运维需求，且拆分收益覆盖成本 |

```java
// 拆分检查清单（判断拆分是否降低协作成本，而非是否「容易」）：
// 1. 模块是否有清晰稳定的对外契约？→ 是 → 有利于降低拆分成本
// 2. 模块间是否有大量数据库 JOIN？→ 是 → 需要先重构
// 3. 模块是否有明确的数据所有权？→ 是 → 有利于降低拆分成本
// 4. 模块是否有独立的扩缩容、故障隔离或发布节奏需求？→ 是 → 值得拆分
// 5. 团队是否有独立部署与运行能力（监控、告警、容量管理、故障恢复）？→ 否 → 先补齐
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

> **事件语义**：`ApplicationEventPublisher` 发布的是进程内应用事件，普通监听器通常在发布线程同步执行，并非消息代理，也不提供异步或跨服务的交付保证。若要求订单创建成功后再由下游处理，需明确事务提交与监听器执行的关系（如 `@TransactionalEventListener` 的 `AFTER_COMMIT` 阶段）；若要求提交后可靠处理，需区分事件发布记录（记录与业务事务的关系）、失败重试与失败恢复三个环节，分别按所选机制配置。重试不保证恰好一次执行，监听器可能重复执行，下游仍需考虑幂等。

> **边界验证**：把代码放进不同目录或 Maven 子模块只是组织约定，不等于边界保障。Spring Modulith 能在测试阶段自动检测模块循环依赖与跨模块访问内部包：

```java
@Test
void verifiesModuleStructure() {
    ApplicationModules.of(Application.class).verify();
}
```

> 将该验证纳入 CI，并按需配置模块允许依赖；若选用 Maven 多模块，则利用构建依赖关系进一步限制模块间的编译依赖。包结构与接口命名本身不是完整的边界保障。

> **核心理念**：模块化单体不是微服务的过渡站，可以长期作为最终架构。建立清晰的模块边界，是为了控制复杂度、降低未来拆分成本；是否拆分为微服务取决于前面所述的具体约束，而非架构演进的必经阶段。
