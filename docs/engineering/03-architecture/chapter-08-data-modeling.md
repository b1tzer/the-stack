# 数据建模

> **核心问题**：如何设计数据库表结构？范式化和反范式化如何权衡？索引怎么设计？

## 1. ER 图设计

```text
电商核心实体关系（简化模型）
User (1) ---- (N) Order
Order (1) ---- (N) OrderItem
Product (1) ---- (N) OrderItem
Order (1) ---- (0..1) Payment
Order (1) ---- (0..1) Shipment
```

上图中 Order 与 Payment、Shipment 表达为至多一对一，这是简化假设。支持多次支付尝试、部分发货或拆单履约的业务，应改为一对多（如支付流水表、发货记录表）。

```sql
-- 数据库表设计（MySQL 方言）
CREATE TABLE users (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    username VARCHAR(50) NOT NULL UNIQUE,
    email VARCHAR(100) NOT NULL UNIQUE,
    phone VARCHAR(20),
    status TINYINT DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE orders (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    order_no VARCHAR(32) NOT NULL UNIQUE,
    user_id BIGINT NOT NULL,
    total_amount DECIMAL(12,2) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'CREATED',
    shipping_address_id BIGINT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_user_id (user_id),
    INDEX idx_status (status),
    INDEX idx_created_at (created_at)
);
```

## 2. 范式化 vs 反范式化

| 范式 | 说明 | 优点 | 缺点 |
| :-- | :-- | :-- | :-- |
| 1NF | 字段不可再分 | 数据原子性 | - |
| 2NF | 消除部分依赖 | 减少冗余 | 查询需要 JOIN |
| 3NF | 消除非主属性对候选键的传递依赖 | 数据一致性 | 查询性能差 |
| 反范式化 | 适当冗余 | 查询性能好 | 数据冗余，更新复杂 |

```sql
-- 范式化设计：订单明细不冗余商品名称，查询需 JOIN products
-- 注意：p.name 是商品当前名称，商品改名后历史订单展示的名称会随之变化
SELECT o.id, p.name, oi.quantity, oi.unit_price_at_purchase
FROM orders o
JOIN order_items oi ON o.id = oi.order_id
JOIN products p ON oi.product_id = p.id;
```

```sql
-- 反范式化设计：订单明细冗余商品信息，查询简单，但商品改名后订单数据不会同步
CREATE TABLE order_items (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    order_id BIGINT NOT NULL,
    product_id BIGINT NOT NULL,
    product_name VARCHAR(100) NOT NULL,       -- 下单时的商品名快照
    unit_price_at_purchase DECIMAL(10,2) NOT NULL, -- 下单时的成交单价快照
    quantity INT NOT NULL,
    INDEX idx_order_id (order_id)
);
```

读写比例只是参考信号，不能单独决定范式化还是反范式化，还需考虑查询延迟目标、关联成本、数据更新频率，以及冗余数据的一致性维护方式。

- 读多写少、查询可容忍少量冗余 → 可适当反范式化，减少 JOIN
- 写多读少、强一致性优先 → 范式化，减少冗余与更新复杂度
- 历史快照 → 下单时成交的商品名与单价应作为快照冗余到订单明细，商品当前名称与售价由商品主数据维护，改名或调价不应覆盖历史订单。是否进一步冗余汇总字段，取决于一致性维护机制（事务内同步、异步事件或定期重算）及相应代价。

## 3. 索引设计

以下规则针对常见 B-tree 索引的典型访问方式，具体行为取决于数据库产品、版本、统计信息与执行计划。

1. **最左前缀原则**。联合索引 `(a, b, c)` 的典型访问方式是连续前缀 `a`、`a, b`、`a, b, c`；仅以 `b`、`c` 或 `b, c` 作为条件时，通常无法形成连续前缀访问，优化器较难有效利用该索引。

2. **覆盖索引**。索引包含查询所需全部字段时，可避免回表。

```sql
CREATE INDEX idx_user_status_amount ON orders(user_id, status, total_amount);
SELECT user_id, status, total_amount FROM orders WHERE user_id = 123;
```

3. **避免函数包裹索引列**。对索引列套函数通常不利于直接使用普通索引，条件能改写为半开区间时优先改写。

```sql
-- 差：函数包裹索引列
WHERE DATE(created_at) = '2024-01-15'
-- 好：半开区间
WHERE created_at >= '2024-01-15' AND created_at < '2024-01-16'
```

4. **前缀索引**。对长字符串可只索引前缀。

```sql
CREATE INDEX idx_email_prefix ON users(email(10));
```

## 4. 数据类型选择

| 场景 | 推荐类型 | 说明 |
| :-- | :-- | :-- |
| 主键 | BIGINT | 值域大，可支撑较长业务周期；分布式 ID 生成与分片键需另行设计 |
| 金额 | DECIMAL(12,2) | 精确计算，不用 FLOAT |
| 状态 | TINYINT | 比 VARCHAR 节省空间 |
| 时间 | TIMESTAMP/DATETIME | 根据时区需求选择 |
| 文本 | VARCHAR(n) | 明确长度限制 |
| 大文本 | TEXT | 通常不宜建完整索引，可按需用前缀索引或全文索引 |

> **数据建模的核心**：范式化降低冗余引发的更新异常，反范式化减少 JOIN 换取查询性能。取舍的关键不是读写比例，而是冗余数据的更新成本由谁承担、何时承担。
