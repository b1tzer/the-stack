---
doc_id: pg-ecommerce
title: 电商订单系统设计
---

# 电商订单系统设计

> **核心问题**：如何设计一个支撑高并发、可扩展的电商订单系统？从系统架构到数据库表结构，再到库存扣减的并发控制，本章给出完整方案。数据库层用 PostgreSQL，应用层用 Spring Boot，缓存用 Redis，异步解耦用消息队列。

## 1. 需求分析

一个典型的电商系统涉及五张核心实体：

| 实体 | 核心特征 | 技术挑战 |
| :-- | :-- | :-- |
| 用户 (user) | 基础信息 + 收货地址 | 地址 JSONB 存储 |
| 商品 (product) | SPU + SKU 两级结构 | 属性灵活扩展 |
| 订单 (order) | 状态流转 + 分区裁剪 | 按月分区 |
| 订单明细 (order_item) | 快照冗余 | 价格不可变 |
| 支付 (payment) | 幂等 + 对账 | 外部流水号唯一 |

### 1.1 系统架构视角

**技术选型**：

| 层 | 选型 | 用途 |
| :-- | :-- | :-- |
| 应用框架 | Spring Boot | 业务服务 |
| 数据库 | MySQL / PostgreSQL（主从） | 持久化 |
| 缓存 | Redis | 热点缓存、库存预扣 |
| 消息队列 | RocketMQ / Kafka | 异步解耦、削峰 |
| 搜索 | Elasticsearch | 商品搜索 |
| 部署 | Kubernetes | 容器编排 |

**服务拆分**（按业务域）：

```txt
商品服务   # 商品管理、库存管理
订单服务   # 订单创建、查询、状态管理
支付服务   # 支付、退款
用户服务   # 注册、登录、信息管理
搜索服务   # 商品搜索
```

**非功能需求**：

| 指标 | 目标 |
| :-- | :-- |
| 可用性 | 99.99% |
| 响应时间 | P99 < 200ms |
| 一致性 | 支付与库存最终一致 |

秒杀等高并发场景的架构见 [并发控制](../../scenarios/02-concurrency/) 与 [消息场景](../../scenarios/03-messaging/)，具体实现见 [分布式锁](../../spring/09-distributed/chapter-01-distributed-lock) 与 [消息集成](../../spring/07-async-and-messaging/chapter-05-messaging)。

## 2. 表结构设计

### 2.1 用户表与收货地址

```sql
-- 用户表
CREATE TABLE t_user (
    user_id     BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    username    VARCHAR(64)  NOT NULL UNIQUE,
    phone       VARCHAR(20)  UNIQUE,
    email       VARCHAR(128),
    password    VARCHAR(256) NOT NULL,  -- BCrypt 哈希
    status      SMALLINT     NOT NULL DEFAULT 1,  -- 1=正常 0=禁用
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- 收货地址（JSONB 数组存入用户表，或独立建表）
-- 方案 B：独立表，支持多地址
CREATE TABLE t_address (
    addr_id     BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id     BIGINT       NOT NULL REFERENCES t_user(user_id),
    receiver    VARCHAR(64)  NOT NULL,
    phone       VARCHAR(20)  NOT NULL,
    province    VARCHAR(32),
    city        VARCHAR(32),
    district    VARCHAR(32),
    detail      VARCHAR(256) NOT NULL,
    is_default  BOOLEAN      NOT NULL DEFAULT FALSE,
    extra       JSONB,  -- 扩展字段：邮编、街道等
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX idx_address_user ON t_address(user_id) WHERE is_default = TRUE;
```

### 2.2 商品表（JSONB 灵活属性）

SPU（标准产品单元）和 SKU（库存量单位）两级模型：

```sql
-- SPU：标准产品单元
CREATE TABLE t_spu (
    spu_id      BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    spu_name    VARCHAR(256) NOT NULL,
    category_id INT          NOT NULL,
    brand_id    INT,
    description TEXT,
    -- JSONB 存储灵活属性：颜色、材质、尺寸等
    attributes  JSONB        NOT NULL DEFAULT '{}',
    -- 示例 attributes:
    -- {"颜色": ["红","蓝","黑"], "材质": "纯棉", "尺码表": {"S":"165/84A",...}}
    status      SMALLINT     NOT NULL DEFAULT 1,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- GIN 索引支持 JSONB 包含查询
CREATE INDEX idx_spu_attr ON t_spu USING GIN (attributes);

-- SKU：库存量单位
CREATE TABLE t_sku (
    sku_id      BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    spu_id      BIGINT         NOT NULL REFERENCES t_spu(spu_id),
    sku_name    VARCHAR(256)   NOT NULL,
    price       NUMERIC(12, 2) NOT NULL CHECK (price >= 0),
    stock       INT            NOT NULL DEFAULT 0 CHECK (stock >= 0),
    -- SKU 级别的属性：红色-XL 等
    spec        JSONB          NOT NULL DEFAULT '{}',
    status      SMALLINT       NOT NULL DEFAULT 1,
    created_at  TIMESTAMPTZ    NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ    NOT NULL DEFAULT now()
);

CREATE INDEX idx_sku_spu ON t_sku(spu_id);
CREATE INDEX idx_sku_spec ON t_sku USING GIN (spec);
```

> **JSONB 使用建议**：稳定的、需要过滤的字段（如 `price`、`stock`）用传统列；变化频繁、结构不固定的属性（如颜色、尺码）用 JSONB。两者结合是最佳实践。

### 2.3 订单表（枚举 + 分区）

```sql
-- 订单状态枚举
CREATE TYPE order_status AS ENUM (
    'PENDING',      -- 待支付
    'PAID',         -- 已支付
    'SHIPPING',     -- 发货中
    'DELIVERED',    -- 已送达
    'COMPLETED',    -- 已完成
    'CANCELLED',    -- 已取消
    'REFUNDING',    -- 退款中
    'REFUNDED'      -- 已退款
);

-- 订单主表（按月分区）
CREATE TABLE t_order (
    order_id     BIGINT         NOT NULL DEFAULT nextval('seq_order_id'),
    user_id      BIGINT         NOT NULL,
    order_no     VARCHAR(32)    NOT NULL,
    total_amount NUMERIC(14, 2) NOT NULL CHECK (total_amount >= 0),
    pay_amount   NUMERIC(14, 2) NOT NULL CHECK (pay_amount >= 0),
    status       order_status   NOT NULL DEFAULT 'PENDING',
    address      JSONB          NOT NULL,  -- 下单时快照地址
    remark       VARCHAR(512),
    created_at   TIMESTAMPTZ    NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ    NOT NULL DEFAULT now(),
    paid_at      TIMESTAMPTZ,
    PRIMARY KEY (order_id, created_at)  -- 分区表必须包含分区键
) PARTITION BY RANGE (created_at);

-- 按月创建分区
CREATE TABLE t_order_2026_01 PARTITION OF t_order
    FOR VALUES FROM ('2026-01-01') TO ('2026-02-01');
CREATE TABLE t_order_2026_02 PARTITION OF t_order
    FOR VALUES FROM ('2026-02-01') TO ('2026-03-01');
-- ... 按需继续创建

-- 唯一约束（order_no 全局唯一）
CREATE UNIQUE INDEX idx_order_no ON t_order(order_no);

-- 用户订单查询索引（覆盖分区裁剪）
CREATE INDEX idx_order_user_time ON t_order(user_id, created_at DESC);

-- 状态查询索引
CREATE INDEX idx_order_status ON t_order(status, created_at DESC)
    WHERE status IN ('PENDING', 'PAID', 'SHIPPING');
```

> **分区键选择**：`created_at` 作为分区键，查询时必须带上时间范围才能触发分区裁剪。前端的"我的订单"页面天然带时间筛选，完美匹配。

### 2.4 订单明细表

```sql
CREATE TABLE t_order_item (
    item_id     BIGINT         NOT NULL GENERATED ALWAYS AS IDENTITY,
    order_id    BIGINT         NOT NULL,
    sku_id      BIGINT         NOT NULL,
    sku_name    VARCHAR(256)   NOT NULL,  -- 冗余快照，防止商品改名
    price       NUMERIC(12, 2) NOT NULL,  -- 下单时价格，不可变
    quantity    INT            NOT NULL CHECK (quantity > 0),
    subtotal    NUMERIC(14, 2) GENERATED ALWAYS AS (price * quantity) STORED,
    spec        JSONB,                     -- 下单时规格快照
    created_at  TIMESTAMPTZ    NOT NULL DEFAULT now(),
    PRIMARY KEY (item_id, order_id)
) PARTITION BY RANGE (created_at);

-- 与订单表保持一致的分区策略
CREATE TABLE t_order_item_2026_01 PARTITION OF t_order_item
    FOR VALUES FROM ('2026-01-01') TO ('2026-02-01');
CREATE TABLE t_order_item_2026_02 PARTITION OF t_order_item
    FOR VALUES FROM ('2026-02-01') TO ('2026-03-01');

CREATE INDEX idx_order_item_order ON t_order_item(order_id);
CREATE INDEX idx_order_item_sku   ON t_order_item(sku_id);
```

### 2.5 支付记录表

```sql
CREATE TABLE t_payment (
    pay_id       BIGINT         NOT NULL GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    order_id     BIGINT         NOT NULL,
    pay_no       VARCHAR(64)    NOT NULL UNIQUE,       -- 内部支付流水号
    trade_no     VARCHAR(128),                          -- 第三方交易号
    amount       NUMERIC(14, 2) NOT NULL CHECK (amount > 0),
    channel      VARCHAR(32)    NOT NULL,               -- ALIPAY / WECHAT
    status       SMALLINT       NOT NULL DEFAULT 0,     -- 0=待支付 1=成功 2=失败 3=已退款
    paid_at      TIMESTAMPTZ,
    callback_raw JSONB,                                 -- 回调原始数据，用于对账
    created_at   TIMESTAMPTZ    NOT NULL DEFAULT now()
);

CREATE INDEX idx_payment_order ON t_payment(order_id);
CREATE INDEX idx_payment_trade ON t_payment(trade_no) WHERE trade_no IS NOT NULL;
```

## 3. 热点行并发控制：库存扣减

库存扣减是电商系统最经典的并发问题。三种方案对比：

### 方案 A：悲观锁（SELECT FOR UPDATE）

```sql
-- 事务内执行
BEGIN;

-- 1. 锁定库存行
SELECT stock FROM t_sku WHERE sku_id = 1001 FOR UPDATE;

-- 2. 检查库存
-- 应用层判断 stock >= 购买数量

-- 3. 扣减
UPDATE t_sku SET stock = stock - 2, updated_at = now()
WHERE sku_id = 1001;

-- 4. 插入订单明细 ...

COMMIT;
```

**适用场景**：库存不多、并发可控（< 500 TPS）。简单可靠，但行锁会导致排队。

### 方案 B：乐观锁（CAS 更新）

```sql
-- 先读取版本号
SELECT stock, version FROM t_sku WHERE sku_id = 1001;

-- 应用层判断库存充足后，CAS 更新
UPDATE t_sku
SET stock  = stock - 2,
    version = version + 1,
    updated_at = now()
WHERE sku_id = 1001
  AND stock >= 2
  AND version = 5;  -- 之前读到的版本号

-- 如果 affected_rows = 0，说明被其他事务修改，重试
```

**适用场景**：高并发、库存充足。无锁等待，但需要重试机制。

### 方案 C：Redis 预扣 + 异步落库（推荐高并发场景）

```java
// 伪代码：Redis 预扣库存
String key = "stock:sku:" + skuId;
Long remain = redisTemplate.opsForValue().decrement(key, quantity);
if (remain < 0) {
    redisTemplate.opsForValue().increment(key, quantity); // 回滚
    throw new BizException("库存不足");
}
// 发送 MQ 消息，异步写入数据库
```

> **选型建议**：日活 < 10 万用方案 A；10-100 万用方案 B；> 100 万用方案 C。大部分项目方案 B 足够。

## 4. 订单状态机

用枚举类型 + 应用层校验保证状态流转合法：

```txt
PENDING ──→ PAID ──→ SHIPPING ──→ DELIVERED ──→ COMPLETED
   │                      │
   ↓                      ↓
CANCELLED            REFUNDING ──→ REFUNDED
```

在数据库层用触发器或应用层做状态转换校验：

```sql
-- 合法的状态转换映射（应用层维护）
-- PENDING   → PAID, CANCELLED
-- PAID      → SHIPPING, REFUNDING
-- SHIPPING  → DELIVERED, REFUNDING
-- DELIVERED → COMPLETED, REFUNDING
-- REFUNDING → REFUNDED

-- 更新订单状态时，用乐观锁 + 条件更新
UPDATE t_order
SET status     = 'PAID',
    paid_at    = now(),
    updated_at = now()
WHERE order_no = 'ORD202608280001'
  AND status = 'PENDING';  -- 只有待支付才能变成已支付

-- 如果 affected_rows = 0，说明状态已变更，抛出异常
```

## 5. 常见查询优化

### 5.1 订单列表（带分区裁剪）

```sql
-- 用户查询近 3 个月订单（触发分区裁剪）
SELECT o.order_no, o.total_amount, o.status, o.created_at,
       json_agg(json_build_object(
           'sku_name', i.sku_name,
           'quantity', i.quantity,
           'price', i.price
       )) AS items
FROM t_order o
JOIN t_order_item i ON i.order_id = o.order_id
WHERE o.user_id = 12345
  AND o.created_at >= '2026-06-01'  -- 分区裁剪
GROUP BY o.order_id
ORDER BY o.created_at DESC
LIMIT 20;
```

### 5.2 商品搜索（JSONB 查询）

```sql
-- 搜索"纯棉"材质的商品
SELECT spu_id, spu_name, attributes
FROM t_spu
WHERE attributes @> '{"材质": "纯棉"}'
  AND status = 1
ORDER BY created_at DESC
LIMIT 20;

-- 查找支持红色且价格在 100-500 之间的 SKU
SELECT s.sku_id, s.sku_name, s.price, s.stock, s.spec
FROM t_sku s
WHERE s.spec @> '{"颜色": "红色"}'
  AND s.price BETWEEN 100 AND 500
  AND s.stock > 0
ORDER BY s.price;
```

### 5.3 统计报表

```sql
-- 每日销售统计
SELECT created_at::date AS sale_date,
       COUNT(*)         AS order_count,
       SUM(pay_amount)  AS total_revenue
FROM t_order
WHERE status NOT IN ('CANCELLED', 'REFUNDED')
  AND created_at >= '2026-08-01'
GROUP BY sale_date
ORDER BY sale_date;
```

## 6. 窗口函数实战

### 6.1 用户消费排行

```sql
-- 用户累计消费排行 + 排名 + 同比上一名差距
SELECT
    user_id,
    total_spent,
    RANK()       OVER (ORDER BY total_spent DESC) AS ranking,
    total_spent - LAG(total_spent) OVER (ORDER BY total_spent DESC) AS gap_with_prev
FROM (
    SELECT user_id, SUM(pay_amount) AS total_spent
    FROM t_order
    WHERE status NOT IN ('CANCELLED', 'REFUNDED')
    GROUP BY user_id
) t
ORDER BY ranking
LIMIT 50;
```

### 6.2 复购分析

```sql
-- 识别复购用户：首次购买 vs 最近购买，复购间隔天数
WITH user_orders AS (
    SELECT
        user_id,
        created_at,
        ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY created_at)     AS rn_asc,
        ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY created_at DESC) AS rn_desc
    FROM t_order
    WHERE status NOT IN ('CANCELLED', 'REFUNDED')
)
SELECT
    a.user_id,
    a.created_at  AS first_order,
    b.created_at  AS last_order,
    (b.created_at - a.created_at) AS repeat_interval,
    COUNT(*) OVER (PARTITION BY a.user_id) AS total_orders
FROM user_orders a
JOIN user_orders b ON a.user_id = b.user_id AND b.rn_desc = 1
WHERE a.rn_asc = 1
  AND a.user_id != b.user_id  -- 排除只买过一次的
ORDER BY repeat_interval DESC;
```

### 6.3 移动平均销售额

```sql
-- 7 日移动平均
SELECT
    created_at::date AS sale_date,
    SUM(pay_amount)  AS daily_revenue,
    AVG(SUM(pay_amount)) OVER (
        ORDER BY created_at::date
        ROWS BETWEEN 6 PRECEDING AND CURRENT ROW
    ) AS moving_avg_7d
FROM t_order
WHERE status NOT IN ('CANCELLED', 'REFUNDED')
  AND created_at >= '2026-08-01'
GROUP BY sale_date
ORDER BY sale_date;
```

## 7. 维护与扩展建议

| 场景 | 方案 | 命令 |
| :-- | :-- | :-- |
| 自动创建未来分区 | `pg_partman` 扩展 | `SELECT partman.create_parent(...)` |
| 清理历史数据 | 分区 detach + DROP | `ALTER TABLE t_order DETACH PARTITION ...` |
| 更新统计信息 | 定期 ANALYZE | `ANALYZE t_order;` |
| 大表加字段 | 避免 ACCESS EXCLUSIVE | `ALTER TABLE ... ADD COLUMN ... DEFAULT ... ;` (PG 11+ 不重写表) |

## 总结

本章通过电商订单系统串联了 PostgreSQL 的多个核心知识点：

- **JSONB** → 灵活的商品属性存储
- **枚举类型** → 订单状态机
- **分区表** → 千万级订单的查询性能保障
- **SELECT FOR UPDATE / 乐观锁** → 并发库存扣减
- **窗口函数** → 复杂业务分析

这些技术组合在一起，足以支撑日均百万级订单的电商业务。

## 8. 架构决策记录（ADR）

### ADR-001：秒杀场景使用 Redis 预扣 + 消息队列异步下单

**决策**：秒杀采用 Redis 预扣库存 + 消息队列异步下单。

**理由**：

1. Redis 单机 10 万+ QPS，远超数据库
2. Lua 脚本保证库存扣减的原子性
3. 消息队列异步处理下单，削峰填谷
4. 库存扣减失败直接返回，不进入下单流程

**后果**：

- 正面：支撑 10000+ QPS 秒杀场景
- 负面：系统复杂度增加，需要处理消息消费失败的补偿

## 9. 经验总结

| 经验 | 说明 |
| :-- | :-- |
| 先单体后拆分 | 不要一开始就用微服务 |
| 渐进式架构 | 根据业务增长逐步演进 |
| 技术服务于业务 | 技术选型以解决业务问题为导向 |
| 文档化决策 | 使用 ADR 记录重要决策 |
| 自动化一切 | 测试、部署、监控都要自动化 |
