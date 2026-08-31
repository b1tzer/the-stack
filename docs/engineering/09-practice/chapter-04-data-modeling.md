# 数据建模

> **核心问题**：如何设计数据库表结构？范式化和反范式化如何权衡？索引怎么设计？

## 1. ER 图设计

```java
// 电商核心实体关系
// User (1) ---- (N) Order
// Order (1) ---- (N) OrderItem
// Product (1) ---- (N) OrderItem
// Order (1) ---- (0..1) Payment
// Order (1) ---- (0..1) Shipment

// 数据库表设计
// CREATE TABLE users (
//     id BIGINT PRIMARY KEY AUTO_INCREMENT,
//     username VARCHAR(50) NOT NULL UNIQUE,
//     email VARCHAR(100) NOT NULL UNIQUE,
//     phone VARCHAR(20),
//     status TINYINT DEFAULT 1,
//     created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
//     updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
// );
//
// CREATE TABLE orders (
//     id BIGINT PRIMARY KEY AUTO_INCREMENT,
//     order_no VARCHAR(32) NOT NULL UNIQUE,
//     user_id BIGINT NOT NULL,
//     total_amount DECIMAL(12,2) NOT NULL,
//     status VARCHAR(20) NOT NULL DEFAULT 'CREATED',
//     shipping_address_id BIGINT,
//     created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
//     updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
//     INDEX idx_user_id (user_id),
//     INDEX idx_status (status),
//     INDEX idx_created_at (created_at)
// );
```

## 2. 范式化 vs 反范式化

| 范式 | 说明 | 优点 | 缺点 |
|------|------|------|------|
| 1NF | 字段不可再分 | 数据原子性 | - |
| 2NF | 消除部分依赖 | 减少冗余 | 查询需要 JOIN |
| 3NF | 消除传递依赖 | 数据一致性 | 查询性能差 |
| 反范式化 | 适当冗余 | 查询性能好 | 数据冗余，更新复杂 |

```java
// 范式化设计：订单表不冗余商品名称
// 查询需要 JOIN
// SELECT o.id, p.name, oi.quantity, oi.price
// FROM orders o
// JOIN order_items oi ON o.id = oi.order_id
// JOIN products p ON oi.product_id = p.id;

// 反范式化设计：订单表冗余商品信息
// 查询简单，但商品改名后订单数据不会同步
// CREATE TABLE order_items (
//     id BIGINT PRIMARY KEY AUTO_INCREMENT,
//     order_id BIGINT NOT NULL,
//     product_id BIGINT NOT NULL,
//     product_name VARCHAR(100) NOT NULL,  -- 冗余
//     product_price DECIMAL(10,2) NOT NULL, -- 冗余（下单时价格快照）
//     quantity INT NOT NULL,
//     INDEX idx_order_id (order_id)
// );

// 权衡建议
// - 写多读少：范式化（减少数据冗余，更新简单）
// - 读多写少：反范式化（减少 JOIN，查询快）
// - 历史快照：必须冗余（订单商品信息需要快照）
```

## 3. 索引设计

```java
// 索引设计原则
// 1. 最左前缀原则
// 联合索引 (a, b, c) 可用于查询条件：
// - a
// - a, b
// - a, b, c
// 不能用于：b / c / b, c

// 2. 覆盖索引
// 索引包含查询所需的所有字段，避免回表
// CREATE INDEX idx_user_status_amount ON orders(user_id, status, total_amount);
// SELECT user_id, status, total_amount FROM orders WHERE user_id = 123;

// 3. 避免索引失效
// 差：函数导致索引失效
// WHERE DATE(created_at) = '2024-01-15'
// 好：范围查询
// WHERE created_at >= '2024-01-15' AND created_at < '2024-01-16'

// 4. 前缀索引
// 对长字符串使用前缀索引
// CREATE INDEX idx_email_prefix ON users(email(10));
```

## 4. 数据类型选择

| 场景 | 推荐类型 | 说明 |
|------|---------|------|
| 主键 | BIGINT | 范围大，支持分库分表 |
| 金额 | DECIMAL(12,2) | 精确计算，不用 FLOAT |
| 状态 | TINYINT | 比 VARCHAR 节省空间 |
| 时间 | TIMESTAMP/DATETIME | 根据时区需求选择 |
| 文本 | VARCHAR(n) | 明确长度限制 |
| 大文本 | TEXT | 不参与索引 |

> **数据建模的核心**：好的数据模型是系统的基础。范式化保证数据一致性，反范式化提升查询性能。在两者之间找到平衡点，需要理解业务的读写模式。
