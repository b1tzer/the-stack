# 限界上下文

> **核心问题**：如何划分限界上下文？上下文之间如何映射？如何避免"大泥球"？

## 1. 什么是限界上下文

限界上下文（Bounded Context）是 DDD 中的核心战略模式，它定义了一个模型的适用边界。在边界内，所有术语和规则保持一致。

```txt
┌─────────── 电商系统 ────────────┐
│                                │
│  ┌─────────────┐ ┌───────────┐ │
│  │  交易上下文  │  │ 用户上下文 │ │
│  │             │ │           │ │
│  │ 买家、卖家   │ │ 注册用户    │ │
│  │ 订单、支付   │ │ 认证信息    │ │
│  │ 物流地址     │ │ 偏好设置   │ │
│  └─────────────┘ └───────────┘ │
│                                │
│  ┌─────────────┐ ┌───────────┐ │
│  │  库存上下文   │ │ 搜索上下文 │ │
│  │             │ │           │ │
│  │ SKU、库存    │ │ 商品索引   │ │
│  │ 仓库、批次   │  │ 搜索词    │ │
│  └─────────────┘ └───────────┘ │
└────────────────────────────────┘
```

## 2. 如何划分限界上下文

```java
// 同一个词在不同上下文中的含义不同
// "商品" 在不同上下文中的含义：

// 商品上下文：完整的商品信息
class Product {
    Long id;
    String name;
    String description;
    List<String> images;
    BigDecimal price;
    Category category;
}

// 库存上下文：商品的库存信息
class InventoryItem {
    String sku;           // 用 SKU 而非商品 ID
    int quantity;
    String warehouseCode;
}

// 搜索上下文：商品的搜索索引
class ProductIndex {
    String productId;
    String title;
    String[] tags;
    double score;         // 搜索相关性分数
}

// 订单上下文：订单中的商品快照
class OrderProduct {
    String productId;
    String productName;   // 下单时的名称快照
    BigDecimal price;     // 下单时的价格快照
    int quantity;
}
```

四个模型的字段不同，但字段差异本身不是划分上下文的依据。真正决定边界的是业务规则和一致性责任。商品改价后，商品主数据、订单历史价格、搜索索引不能共用同一个领域模型：商品上下文关心当前价格，订单上下文必须保留下单那一刻的价格快照，搜索上下文只维护索引所需的最小字段。库存按 SKU、仓库维度管理，订单保存快照是为了保留下单时的业务事实。这些都是职责与规则的结果，不是按字段裁剪实体。

## 3. 上下文映射模式

| 模式 | 说明 | 适用场景 |
| :-- | :-- | :-- |
| 共享内核（Shared Kernel） | 两个上下文共享部分模型 | 紧密耦合的上下文 |
| 客户-供应商（Customer-Supplier） | 下游依赖上游，上游交付需纳入下游需求 | 存在供需依赖的上下游 |
| 防腐层（ACL） | 通过适配器隔离外部模型 | 集成遗留系统或第三方 |
| 开放主机服务（OHS） | 提供标准化协议供多方使用 | 平台型服务 |
| 各行其道（Separate Ways） | 两个上下文完全独立 | 无业务关联 |

实际选择模式先看上下游关系。交易上下文依赖商品上下文获取商品主数据，通过明确契约调用，并在下单时保存必要的商品与价格快照。交易上下文对接第三方支付时，通过防腐层把支付平台的状态与协议映射为内部支付模型，避免外部模型渗入领域核心。如果上游不接受下游的模型需求，下游可能采用符合者（Conformist）策略迁就上游，也可能通过防腐层隔离；符合者与防腐层可在同一集成关系中结合使用，具体取决于双方协作意愿与业务约束。

```java
// 防腐层（ACL）示例：隔离第三方支付系统
// 外部模型
class AlipayResponse {
    String trade_no;
    String total_amount;
    String trade_status;
}

// 防腐层：将外部模型转换为领域模型
class AlipayAdapter implements PaymentGateway {
    private final AlipayClient alipayClient;
    
    @Override
    public PaymentResult charge(PaymentCommand command) {
        AlipayResponse response = alipayClient.pay(/* ... */);
        // 转换为领域模型
        return new PaymentResult(
            mapStatus(response.trade_status),  // 将支付宝状态映射为内部状态
            new Money(new BigDecimal(response.total_amount), Currency.CNY)
        );
    }
    
    private PaymentStatus mapStatus(String alipayStatus) {
        // 将支付宝状态映射为内部支付状态。
        // 映射规则取决于支付平台契约与内部状态机：
        // 未知状态不应默认为「处理中」，需区分协议变更与解析错误。
        // 此处省略具体映射，仅示意防腐层的模型转换职责。
        return PaymentStatusMapper.from(alipayStatus);
    }
}
```

## 4. 微服务与限界上下文的映射

限界上下文约束的是领域模型与统一语言的适用范围，是逻辑边界；微服务是部署单元，是物理边界。两者没有固定的一一映射。

| 情况 | 处理 |
| :-- | :-- |
| 上下文需要独立部署、独立扩缩容或团队自治 | 映射为独立微服务 |
| 规模较小、部署独立性不足 | 可在模块化单体中保留多个限界上下文 |
| 一个上下文拆成多个服务 | 应有明确的运行时或组织需求 |
| 多个上下文共处一个服务 | 必须保留清晰的模型、模块和依赖边界 |

```java
// 一个限界上下文独立部署时
// service-order     → 交易上下文
// service-inventory → 库存上下文

// 模块化单体：多个上下文共处一个部署单元
// 交易、用户、库存、搜索各自保持模型与模块边界
// 只有当它们共享领域模型、相互依赖并需要协调发布时，
// 才构成值得警惕的耦合（大泥球），而非仅因同处一个服务
```

> **核心原则**：限界上下文不是按技术层划分，而是按业务语义划分。同一个"用户"在不同上下文中的含义和属性可能完全不同，这就是为什么要用不同的模型来表示。
