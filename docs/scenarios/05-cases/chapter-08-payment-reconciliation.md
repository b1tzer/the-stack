# 支付回调与对账

> 本场景回答：支付结果来自外部系统、可能重复且乱序时，怎样安全更新订单、处理超时退款，并用对账发现人工和自动流程都没有覆盖的差异。

## 设定业务边界

示例流程如下：

```text
用户下单
  → 创建支付单
  → 调用支付渠道
  → 渠道异步回调
  → 校验并更新订单
  → 通知履约

支付渠道账单 ←→ 本地支付单/流水 ←→ 对账任务
                                      ↓
                              差异单与人工处理
```

三个系统各有职责：

- **支付渠道**：确认资金结果，提供可验证的回调和账单；
- **本地支付服务**：用状态机处理重复、乱序和并发回调；
- **对账任务**：比较两侧完整账单，发现漏单、错单和金额差异。

不能把回调当作资金事实的唯一来源，也不能用“没有收到失败回调”推断支付成功或失败。超时是未知状态，应主动查询渠道或等待对账。

## 定义支付状态机

| 当前状态 | 允许进入 | 禁止进入 | 说明 |
| :-- | :-- | :-- | :-- |
| `CREATED` | `PENDING`、`CLOSED` | `SUCCEEDED` | 尚未向渠道发起支付 |
| `PENDING` | `SUCCEEDED`、`FAILED`、`CLOSED` | `REFUNDED` | 已发起，等待渠道结果 |
| `SUCCEEDED` | `REFUNDING`、`CLOSED` | `FAILED`、`PENDING` | 终态后只允许进入退款流程 |
| `FAILED` | `PENDING` | `SUCCEEDED` | 用户重新发起时创建新支付尝试 |
| `REFUNDING` | `REFUNDED`、`SUCCEEDED` | 任意退款中间态跳跃 | 退款单独跟踪 |
| `REFUNDED` | 无 | 任意支付状态 | 退款终态 |

状态判断必须由数据库条件更新执行，不能只在应用中先读取再写入。相同模式见[订单状态流转](./chapter-03-order-state-machine.md)。

## 建立可核对的数据模型

```sql
CREATE TABLE payments (
    payment_no VARCHAR(64) NOT NULL,
    order_no VARCHAR(64) NOT NULL,
    attempt_no INT NOT NULL,
    provider VARCHAR(32) NOT NULL,
    provider_txn_id VARCHAR(128) NULL,
    amount_minor BIGINT NOT NULL,
    currency CHAR(3) NOT NULL,
    status VARCHAR(24) NOT NULL,
    version INT NOT NULL DEFAULT 0,
    created_at DATETIME(6) NOT NULL,
    updated_at DATETIME(6) NOT NULL,
    PRIMARY KEY (payment_no),
    UNIQUE KEY uk_order_attempt (order_no, attempt_no),
    UNIQUE KEY uk_provider_txn (provider, provider_txn_id),
    INDEX idx_status_updated (status, updated_at)
) ENGINE=InnoDB;

CREATE TABLE payment_callbacks (
    callback_id VARCHAR(128) NOT NULL,
    provider VARCHAR(32) NOT NULL,
    payment_no VARCHAR(64) NULL,
    provider_txn_id VARCHAR(128) NULL,
    callback_status VARCHAR(24) NOT NULL,
    payload JSON NOT NULL,
    payload_hash CHAR(64) NOT NULL,
    verify_result VARCHAR(24) NOT NULL,
    processed_at DATETIME(6) NULL,
    error_message VARCHAR(512) NULL,
    received_at DATETIME(6) NOT NULL,
    PRIMARY KEY (callback_id),
    INDEX idx_callback_payment (payment_no, received_at)
) ENGINE=InnoDB;

CREATE TABLE payment_effects (
    effect_id CHAR(36) NOT NULL,
    payment_no VARCHAR(64) NOT NULL,
    effect_type VARCHAR(32) NOT NULL,
    created_at DATETIME(6) NOT NULL,
    PRIMARY KEY (effect_id),
    UNIQUE KEY uk_payment_effect (payment_no, effect_type)
) ENGINE=InnoDB;
```

设计要点：

- `payment_no` 是本地唯一业务键；每次重新支付使用新的 `attempt_no`。
- `provider_txn_id` 用于识别渠道交易，但在首次创建时可能为空。
- `callback_id` 用于去重；同一回调携带不同业务结果时，要记录差异并告警，不能静默覆盖。
- `amount_minor` 使用最小货币单位整数，避免浮点误差。
- 原始回调和校验结果必须保留，便于审计和重新处理。

## 发起支付

### 1. 先创建本地支付单

使用客户端幂等键防止用户重复点击产生多笔支付：

```sql
INSERT INTO payments(
    payment_no, order_no, attempt_no, provider,
    amount_minor, currency, status, created_at, updated_at
) VALUES (
    'PAY-20261011-0001',
    'ORD-20261011-001',
    1,
    'example-pay',
    19900,
    'CNY',
    'CREATED',
    UTC_TIMESTAMP(6),
    UTC_TIMESTAMP(6)
);
```

将渠道请求参数、请求 ID 和 `payment_no` 写入 Outbox 或任务表，再调用渠道。不要在数据库事务中等待渠道响应；网络超时会让事务和锁持续更久。

### 2. 渠道返回后按状态处理

- 返回明确成功：进入成功处理流程；
- 返回明确失败：记录渠道错误，状态转为 `FAILED`；
- 返回处理中：状态转为 `PENDING`，等待回调或主动查询；
- 请求超时或连接中断：状态保持未知，查询渠道后重试，不能直接标为失败。

主动查询和回调必须汇聚到同一状态机，不允许两条路径各自直接写订单。

## 安全处理回调

### 1. 先验真，再进入业务事务

回调入口按以下顺序执行：

1. 限制请求来源、协议和报文大小；
2. 校验渠道签名、时间戳、随机数或防重放字段；
3. 校验订单号、支付单号、金额、币种和渠道交易号；
4. 保存原始载荷、载荷哈希、验签结果和接收时间；
5. 验签失败时不进入业务状态更新；
6. 重复回调直接返回渠道要求的成功响应，但不重复执行业务副作用。

不要在日志中打印完整签名、密钥或敏感支付信息。回调验签规则以具体渠道文档为准，本文只规定校验边界。

### 2. 用条件更新接收结果

成功回调在同一个本地事务中更新支付单、写入业务效果和 Outbox：

```sql
START TRANSACTION;

UPDATE payments
SET status = 'SUCCEEDED',
    provider_txn_id = 'CHANNEL-TXN-9001',
    version = version + 1,
    updated_at = UTC_TIMESTAMP(6)
WHERE payment_no = 'PAY-20261011-0001'
  AND provider = 'example-pay'
  AND amount_minor = 19900
  AND currency = 'CNY'
  AND status IN ('CREATED', 'PENDING')
  AND (provider_txn_id IS NULL OR provider_txn_id = 'CHANNEL-TXN-9001');

-- 仅当上面影响 1 行时执行
INSERT INTO payment_effects(effect_id, payment_no, effect_type, created_at)
VALUES (
    '7e9043ef-222b-49f4-9db0-7efdc790ef13',
    'PAY-20261011-0001',
    'ORDER_PAID',
    UTC_TIMESTAMP(6)
);

INSERT INTO outbox_events(
    message_id, aggregate_type, aggregate_id, event_type,
    payload, available_at, created_at, updated_at
) VALUES (
    'ab995261-54ba-4d05-93de-dc4052093223',
    'payment',
    'PAY-20261011-0001',
    'payment.succeeded',
    JSON_OBJECT(
        'paymentNo', 'PAY-20261011-0001',
        'orderNo', 'ORD-20261011-001',
        'amountMinor', 19900
    ),
    UTC_TIMESTAMP(6),
    UTC_TIMESTAMP(6),
    UTC_TIMESTAMP(6)
);

COMMIT;
```

该条件同时检查状态、金额、币种和交易号。应用必须读取 `UPDATE` 的受影响行数：

- 影响 1 行：本次是首次有效结果，可以提交副作用；
- 影响 0 行且当前状态已经是 `SUCCEEDED`、交易信息一致：视为重复回调；
- 影响 0 行且金额、币种或交易号冲突：拒绝更新，写入差异单并告警；
- 影响 0 行且状态已进入不允许的后续状态：根据状态机判断是否为乱序回调。

Outbox 发布机制见[消息可靠性闭环](../03-messaging/chapter-07-message-reliability.md)。

### 3. 处理重复、乱序和迟到回调

| 情况 | 示例 | 处理 |
| :-- | :-- | :-- |
| 完全重复 | 同一 `callback_id`、金额、交易号 | 记录已处理并返回成功，不重复通知 |
| 成功回调先到，失败回调后到 | `SUCCEEDED → FAILED` | 状态机拒绝倒退，记录乱序告警 |
| 迟到的旧尝试回调 | 旧 `payment_no` 已关闭 | 只更新该支付尝试，不影响新尝试 |
| 同一交易号对应不同订单 | 渠道数据或伪造异常 | 不更新任何订单，进入高优先级差异单 |
| 回调金额与本地金额不同 | 19900 vs 19800 | 不自动确认，人工核对渠道账单 |

回调接口可以返回成功表示“已接收”，但接收成功不代表业务状态已变更。需要渠道明确语义时，应按其协议返回对应结果。

## 处理超时与退款

### 1. 超时不是失败

创建主动查询任务，按退避节奏查询渠道：

```text
1. 查询 payment_no 或渠道请求号
2. 成功 → 进入与回调相同的成功处理
3. 失败 → 进入失败处理
4. 处理中 → 继续查询
5. 查询次数或时限达到上限 → 进入待对账状态并告警
```

主动查询和回调可能同时返回。两者都必须通过同一条件更新，唯一键和状态守卫决定最终只产生一次副作用。

### 2. 退款使用独立流程

退款应有独立的 `refund_no`、金额、状态和渠道退款交易号，不要只把原支付单状态从 `SUCCEEDED` 直接改成 `REFUNDED`。

部分退款时，原支付单仍可能是成功状态，退款记录累计已退金额。退款成功、失败、超时和重复回调遵循与支付相同的原则：

- 原子扣减可退余额或使用退款账本；
- 重复退款请求使用同一幂等键；
- 退款回调校验金额、币种和原支付交易号；
- 退款结果通过 Outbox 通知订单、库存和账务。

## 执行双向对账

### 1. 获取两侧完整账单

对账任务应获取渠道账单和本地支付流水，按渠道交易号优先关联，再按 `payment_no` 和时间窗口补充匹配。

```text
渠道账单 A ──匹配──▶ 本地支付记录 B
      │                    │
      └── 仅渠道存在 ──┐    ├── 仅本地存在 ──┤
                       ├─ 金额/币种不一致 ─┤
                       └── 重复或一对多 ───┘
```

全量账单很大时可使用渠道提供的增量账单、分页或对账文件，但必须确认游标连续、文件完整和时间边界无遗漏。

### 2. 定义差异类型和处置

| 差异 | 可能原因 | 默认动作 |
| :-- | :-- | :-- |
| 渠道成功、本地无记录 | 回调丢失、入库失败 | 按渠道结果补单或进入人工审核 |
| 本地成功、渠道无记录 | 伪造回调、渠道查询遗漏 | 立即告警，暂停自动履约 |
| 金额或币种不一致 | 参数错误、渠道数据异常 | 人工核对，不自动改金额 |
| 一对多匹配 | 重复创建支付或交易号复用 | 锁定相关支付单并审计 |
| 本地状态落后 | 回调处理失败 | 重放已验真的回调或重新查询 |
| 已退款金额不一致 | 退款回调缺失或重复 | 核对退款账本和渠道退款单 |

自动修复只用于低风险且可证明幂等的差异，例如重放同一已验真回调。资金金额冲突、未知入账和一对多匹配必须人工审批。

### 3. 输出可追踪的差异单

差异单至少包含：

- 对账批次、渠道、账单文件和时间范围；
- 渠道交易号、本地支付单、订单号和关联 Trace ID；
- 渠道金额/状态与本地金额/状态；
- 差异类型、严重级别、发现时间和负责人；
- 自动处理记录、人工结论、凭证和关闭时间。

每天比较“应处理笔数、已匹配、待处理、已修复、仍未知”，而不是只输出一个总差异率。

## 执行故障演练

在预发布环境覆盖以下情况：

1. 同一成功回调连续发送 10 次，只产生一次订单履约副作用；
2. 成功回调先到、失败回调后到，状态不倒退；
3. 回调返回前杀死服务，重启后主动查询或重试能恢复；
4. 回调金额与订单金额不一致，支付不被自动确认；
5. 渠道账单存在、本地无记录，生成高优先级差异单；
6. 退款回调重复，退款账本只增加一次；
7. 对账文件分页中断，任务明确失败并可从游标续传。

每次记录支付单状态、副作用次数、Outbox 消息、差异单和人工操作结果。

## 面试追问速答 {#interview-questions}

### 1. 支付回调重复怎么办？

先按 `callback_id` 和 `provider_txn_id` 去重，再用状态条件更新。订单副作用表设置唯一键，确保即使重复消息进入业务事务也只执行一次。

### 2. 回调乱序怎么处理？

状态机只允许合法前进。成功后的迟到失败不能把状态改回去；冲突记录到差异单并告警，以渠道主动查询和账单作为后续证据。

### 3. 支付超时为什么不能直接标记失败？

超时只说明本地没有得到结果，渠道可能已经扣款。应查询渠道或等待回调/对账，在结果未知期间保持待确认状态。

### 4. 为什么不能一直持有数据库事务调用支付渠道？

网络调用可能持续数秒甚至超时，长期事务会占用连接、锁和 Undo/Redo 资源。应先落本地任务或 Outbox，再在事务外调用，结果通过状态机合流。

### 5. 回调和主动查询同时返回怎么办？

两条路径调用同一个条件更新，由数据库决定谁成功。第二次更新返回 0 后读取当前状态；信息一致视为重复，信息冲突进入差异单。

### 6. 对账为什么不能只比较总金额？

总金额相同仍可能互相抵消错误，存在漏单、重复单和一对多关系。必须按交易号、支付单、金额、币种、状态和时间窗口逐笔匹配，并跟踪未匹配笔数。

### 7. 自动修复到什么程度安全？

重放已验真且业务幂等的回调通常安全；改变金额、状态、币种或合并一对多交易不可自动处理。修复必须留下审批、前后值和操作者记录。

## 相关场景

- 状态守卫和订单状态机见[订单状态流转](./chapter-03-order-state-machine.md)。
- 幂等键、去重表和版本号见[幂等性设计](../02-concurrency/chapter-03-idempotency.md)。
- 支付结果通知的可靠投递见[消息可靠性闭环](../03-messaging/chapter-07-message-reliability.md)。
- 跨服务补偿和 Saga 见[分布式事务](../03-messaging/chapter-05-distributed-transaction.md)。
