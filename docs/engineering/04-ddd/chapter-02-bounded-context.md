# 限界上下文

> **核心问题**：如何划分限界上下文？上下文之间如何映射？如何避免"大泥球"？

## 1. 什么是限界上下文

限界上下文（Bounded Context）是 DDD 中的核心战略模式，它定义了一个模型的适用边界。在边界内，所有术语和规则保持一致。

```
┌─────────── 电商系统 ────────────┐
│                                 │
│  ┌─────────────┐ ┌───────────┐ │
│  │  交易上下文   │ │ 用户上下文 │ │
│  │             │ │           │ │
│  │ 买家、卖家   │ │ 注册用户  │ │
│  │ 订单、支付   │ │ 认证信息  │ │
│  │ 物流地址     │ │ 偏好设置  │ │
│  └─────────────┘ └───────────┘ │
│                                 │
│  ┌─────────────┐ ┌───────────┐ │
│  │  库存上下文   │ │ 搜索上下文 │ │
│  │             │ │           │ │
│  │ SKU、库存    │ │ 商品索引  │ │
│  │ 仓库、批次   │ │ 搜索词    │ │
│  └─────────────┘ └───────────┘ │
└─────────────────────────────────┘
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

## 3. 上下文映射模式

| 模式 | 说明 | 适用场景 |
| :-- | :-- | :-- |
| 共享内核（Shared Kernel） | 两个上下文共享部分模型 | 紧密耦合的上下文 |
| 客户-供应商 | 上游（供应商）为下游（客户提供）API | 明确的上下游关系 |
| 防腐层（ACL） | 通过适配器隔离外部模型 | 集成遗留系统或第三方 |
| 开放主机服务（OHS） | 提供标准化协议供多方使用 | 平台型服务 |
| 各行其道（Separate Ways） | 两个上下文完全独立 | 无业务关联 |

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
        return switch (alipayStatus) {
            case "TRADE_SUCCESS" -> PaymentStatus.SUCCESS;
            case "TRADE_CLOSED" -> PaymentStatus.FAILED;
            default -> PaymentStatus.PENDING;
        };
    }
}
```

## 4. 微服务与限界上下文的映射

| 原则 | 说明 |
| :-- | :-- |
| 一个限界上下文 = 一个微服务 | 最理想的映射关系 |
| 一个限界上下文 = 多个微服务 | 只在上下文内部需要进一步拆分时 |
| 一个微服务 = 多个限界上下文 | 反模式，会导致耦合 |

```java
// 推荐：限界上下文对齐微服务
// service-order     → 交易上下文
// service-user      → 用户上下文
// service-inventory → 库存上下文
// service-search    → 搜索上下文

// 反模式：一个微服务包含多个上下文
// service-mall      → 交易 + 用户 + 库存 + 搜索（大泥球）
```

> **核心原则**：限界上下文不是按技术层划分，而是按业务语义划分。同一个"用户"在不同上下文中的含义和属性可能完全不同，这就是为什么要用不同的模型来表示。
