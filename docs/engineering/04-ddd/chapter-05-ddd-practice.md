# DDD 实战

> **核心问题**：如何在实际项目中落地 DDD？事件风暴怎么做？如何从传统架构迁移到 DDD？

## 1. 事件风暴（Event Storming）

事件风暴是一种协作式建模方法，由领域专家和技术人员共同参与。

### 1.1 事件风暴的步骤

| 步骤 | 产出 | 参与者 |
| :-- | :-- | :-- |
| 1. 头脑风暴事件 | 所有领域事件（橙色便签） | 全员 |
| 2. 排列时间线 | 事件的先后顺序 | 全员 |
| 3. 识别命令 | 触发事件的命令（蓝色便签） | 全员 |
| 4. 识别聚合 | 处理命令的聚合（黄色便签） | 技术人员 |
| 5. 划分限界上下文 | 模块边界（粉色便签） | 全员 |
| 6. 识别读模型 | 查询需求（绿色便签） | 全员 |

### 1.2 事件风暴的产出示例

```txt
[用户注册] → (User) → [用户已注册]
[提交订单] → (Order) → [订单已创建]
[支付订单] → (Payment) → [支付已完成] → [订单已确认]
[取消订单] → (Order) → [订单已取消] → [库存已恢复]
[发货]    → (Shipment) → [订单已发货]
```

## 2. DDD 分层架构实现

```txt
目录结构
com.example.order
  ├── application/          // 应用层
  │   ├── CreateOrderCommand.java
  │   ├── OrderApplicationService.java
  │   └── OrderQueryService.java
  ├── domain/               // 领域层
  │   ├── model/
  │   │   ├── Order.java           // 聚合根
  │   │   ├── OrderLine.java       // 实体
  │   │   ├── Money.java           // 值对象
  │   │   └── OrderStatus.java     // 枚举
  │   ├── event/
  │   │   └── OrderCreatedEvent.java
  │   ├── repository/
  │   │   └── OrderRepository.java // 仓储接口
  │   └── service/
  │       └── OrderDomainService.java
  ├── infrastructure/       // 基础设施层
  │   ├── persistence/
  │   │   ├── JpaOrderRepository.java
  │   │   └── OrderEntity.java
  │   └── messaging/
  │       └── RabbitOrderEventPublisher.java
  └── interfaces/           // 接口层
      ├── rest/
      │   └── OrderController.java
      └── rpc/
          └── OrderGrpcService.java
```

## 3. 从传统架构迁移到 DDD

### 3.1 迁移策略

```java
// 阶段 1：识别核心域（Strategic Design）
// 问自己：哪些业务逻辑是公司的核心竞争力？
// 核心域 → 投入最多精力，使用 DDD
// 支撑域 → 适度设计
// 通用域 → 使用现成方案

// 阶段 2：提取值对象
// 迁移前
class Order {
    String status;          // "CREATED", "PAID", "SHIPPED"
    BigDecimal amount;
    String currency;
}

// 迁移后
class Order {
    OrderStatus status;     // 枚举，类型安全
    Money amount;           // 值对象，不可变，自带业务规则
}

// 阶段 3：引入聚合根
// 将散落在 Service 中的业务逻辑移到领域模型

// 迁移前（贫血模型）
class OrderService {
    public void cancelOrder(Long orderId) {
        Order order = orderDao.findById(orderId);
        if ("PAID".equals(order.getStatus())) {
            // 需要退款
            paymentService.refund(orderId);
        }
        order.setStatus("CANCELLED");
        orderDao.update(order);
    }
}

// 迁移后（充血模型）
class Order {
    public OrderCancelledEvent cancel() {
        if (!canCancel()) {
            throw new IllegalStateException("当前状态不允许取消");
        }
        this.status = OrderStatus.CANCELLED;
        return new OrderCancelledEvent(this.id, this.status);
    }
    
    public boolean canCancel() {
        return status == OrderStatus.CREATED || status == OrderStatus.CONFIRMED;
    }
}

class OrderApplicationService {
    @Transactional
    public void cancelOrder(Long orderId) {
        Order order = repo.findById(orderId);
        OrderCancelledEvent event = order.cancel();
        repo.save(order);
        eventPublisher.publish(event);  // 由事件处理器处理退款
    }
}
```

## 4. 常见陷阱与解决方案

| 陷阱 | 问题 | 解决方案 |
| :-- | :-- | :-- |
| 贫血模型 | 实体只有 getter/setter | 将业务逻辑移到实体中 |
| 聚合过大 | 聚合包含过多实体 | 通过 ID 引用，保持小聚合 |
| 忽视限界上下文 | 所有业务共享一个模型 | 明确上下文边界，各上下文独立模型 |
| 过度设计 | 简单 CRUD 也用 DDD | 只在核心域使用 DDD |
| 事件泛滥 | 发布过多细粒度事件 | 只发布领域专家关心的事件 |

```java
// 过度设计示例：简单的 CRUD 不需要 DDD
// 差：为标签管理引入完整的 DDD
// class Tag { ... }  // 标签管理只是简单 CRUD，不需要聚合根

// 好：标签管理用传统 Service + Repository
@Service
public class TagService {
    private final TagRepository repo;
    
    public Tag create(String name) {
        return repo.save(new Tag(name));
    }
}
```

## 5. DDD 落地检查清单

```markdown
□ 团队理解统一语言（Ubiquitous Language）
□ 核心域已识别，投入了最多精力
□ 限界上下文边界清晰
□ 聚合根维护了内部一致性
□ 值对象用于无标识的概念
□ 领域事件用于聚合间通信
□ 仓储接口定义在领域层
□ 领域层不依赖框架
□ 单元测试覆盖领域逻辑
□ 上下文映射关系明确
```

> **DDD 的本质**：不是一套技术方案，而是一种思维方式。它的核心是"以业务领域为中心设计软件"。技术只是手段，理解业务才是目的。
