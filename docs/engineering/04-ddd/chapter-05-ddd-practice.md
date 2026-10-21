# DDD 实战

> **核心问题**：如何在实际项目中落地 DDD？事件风暴怎么做？如何从传统架构迁移到 DDD？

## 1. 事件风暴（Event Storming）

事件风暴是一种协作式建模方法，由领域专家和技术人员共同参与。

### 1.1 事件风暴的开展方式

事件风暴没有必须遵循的固定步骤，常见的推进方式是先梳理领域事件，再补充命令、参与者、业务规则和外部系统。下表是一种常见组织方式，不是强制流程。

| 活动 | 需要回答的问题 | 主要产出 |
| :-- | :-- | :-- |
| 梳理领域事件 | 业务过程中发生了什么 | 领域事件及时间线 |
| 补充命令和参与者 | 谁发起了操作，目的是什么 | 命令、参与者 |
| 识别业务规则和协作关系 | 什么条件触发后续行为，哪些系统参与协作 | 策略、外部系统 |
| 讨论聚合与一致性边界 | 哪些规则必须在一次业务操作中保证 | 候选聚合及其边界 |
| 识别上下文边界 | 哪些业务概念具有不同含义或规则 | 候选限界上下文 |
| 补充查询需求与问题热点 | 业务需要查看哪些信息，哪些规则尚未达成共识 | 查询需求、待解决问题 |

聚合与限界上下文通常需要反复讨论，不能仅凭便签排列直接确定。便签颜色由团队事先约定即可。

### 1.2 事件风暴的产出示例

```txt
[用户注册] → (User) → [用户已注册]
[提交订单] → (Order) → [订单已创建]
[支付订单] → (Payment) → [支付已完成] → [订单已确认]
[取消订单] → (Order) → [订单已取消] → [库存已恢复]
[发货]    → (Shipment) → [订单已发货]
```

图中的箭头可能表达流程顺序、因果关系或协作关系，具体语义由团队约定，不能默认每条箭头都同时表示因果和时序，也不代表所有动作都在同一事务内同步完成。以取消订单为例，订单取消后库存恢复与退款未必立即完成，可能由异步消费者处理，需要明确这些动作是同步还是异步、失败时如何处理。

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

目录结构本身不保证依赖方向正确。分层的要点是依赖方向：接口层接收请求并转换输入，应用层组织用例，领域层承载业务规则，基础设施层实现持久化与消息等技术能力。领域层不依赖基础设施，仓储接口定义在领域层、由基础设施层实现，应用服务依赖仓储抽象而非 JPA 实现，接口层不直接操纵聚合内部状态。

## 3. 从传统架构迁移到 DDD

### 3.1 迁移策略

```java
// 阶段 1：识别核心域（Strategic Design）
// 问自己：哪些业务逻辑是公司的核心竞争力？
// 核心域 → 投入最多精力，使用 DDD
// 支撑域 → 适度设计
// 通用域 → 使用现成方案

// 阶段 2：提取值对象
// 值对象封装币种、精度与运算规则，不只是字段类型替换
// 迁移前：金额与币种分散在多个字段中
class Order {
    String status;          // "CREATED", "PAID", "SHIPPED"
    BigDecimal amount;
    String currency;
}

// 迁移后：金额与币种作为一个业务概念共同建模
class Order {
    OrderStatus status;     // 枚举，约束合法状态
    Money amount;           // 值对象，封装币种、精度与运算规则
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
// 状态约定：CREATED 待支付，CONFIRMED 已支付已确认，CANCELLED 已取消
// 迁移前的 PAID 在此映射为 CONFIRMED，这是一次业务语义映射，不是枚举值替换
class Order {
    public OrderCancelledEvent cancel() {
        if (!canCancel()) {
            throw new IllegalStateException("当前状态不允许取消");
        }
        // 已支付的订单取消后需要退款，退款是否完成由退款流程单独保证
        boolean refundRequired = this.status == OrderStatus.CONFIRMED;
        this.status = OrderStatus.CANCELLED;
        return new OrderCancelledEvent(this.id, refundRequired);
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
        // 事务内直接发布事件存在可靠性边界，见下文说明
        eventPublisher.publish(event);
    }
}
```

canCancel() 的状态检查不能解决并发竞争。两个请求可能同时读到可取消状态并分别执行取消，持久化层还需通过乐观锁或条件更新保证只有符合条件的状态转换成功。

事件发布存在可靠性边界。如果 publish() 在事务提交前直接发送消息，消息可能在数据库事务回滚前被消费者处理；如果先提交事务再发送消息，进程可能在两者之间崩溃，导致订单已取消但事件未发出。可靠方案是事务性 Outbox，在同一个数据库事务中保存业务变更和待发布事件，再由独立发布器投递，并配合重试与失败监控。消费者幂等用于安全处理重复投递。是否需要 Outbox 取决于系统的可靠性要求，并非所有场景都必须采用。

## 4. 常见陷阱与解决方案

| 陷阱 | 问题 | 解决方案 |
| :-- | :-- | :-- |
| 贫血模型 | 业务规则集中在服务层，多个入口重复实现校验 | 将属于该对象的业务规则放入领域模型，简单数据载体无需强行充血 |
| 聚合过大 | 聚合包含过多实体 | 聚合边界由业务不变量和一致性要求决定，跨聚合通过 ID 引用 |
| 忽视限界上下文 | 所有业务共享一个模型 | 明确上下文边界，各上下文独立模型 |
| 过度设计 | 简单 CRUD 也套用完整 DDD | 核心域优先投入建模精力，其他领域按业务复杂度选择 |
| 事件泛滥 | 为每次字段修改都创建事件 | 事件应表达有业务意义的事实，跨上下文事件明确契约与幂等 |

```java
// 简单 CRUD 未必需要复杂领域建模
// 差：仅为标签管理引入领域服务、领域事件等复杂抽象
// class Tag { ... }  // 标签管理只有名称唯一性校验与基本增删改查时，作为简单聚合根即可

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
□ 值对象封装了业务约束，身份与相等性语义明确
□ 领域事件表达有业务意义的事实，可用于聚合间及上下文内协作
□ 仓储接口定义在领域层
□ 业务规则未被技术框架绑死
□ 单元测试覆盖领域逻辑
□ 上下文映射关系明确
```

> DDD 的价值在于让软件模型反映业务规则，并明确不同业务模型之间的边界。是否引入聚合、领域事件或领域服务，应由业务复杂度、一致性要求和团队协作方式决定，而不是为了符合某种架构形式。
