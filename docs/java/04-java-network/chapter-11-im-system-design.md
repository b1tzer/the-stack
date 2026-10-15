# IM 系统设计

长连接解决“如何持续通信”，IM 系统还要解决在线状态、消息路由、可靠投递和顺序保证。本章把这些能力组织成可落地的系统模型。

## 在线状态管理

长连接只解决客户端与服务端之间的持续通信。IM 还需要维护用户的活跃连接、将消息路由到正确的节点，并处理消息丢失、重复和乱序。本章围绕这几个问题展开。

IM 的在线状态需要区分连接状态和用户的展示状态。连接建立后，服务端可以把连接登记为活跃；心跳超时或连接关闭后，服务端应清理对应连接。用户是否展示为隐身由用户设置决定，不能由心跳超时直接推导。多设备场景下一个用户可能同时有多个活跃连接，单个连接断开不一定意味着用户离线，只有在该用户没有其他有效连接时，系统才应将其整体在线状态更新为离线。

```txt
┌─────────────────────────────────────────────────────────┐
│              在线状态：连接状态与展示状态分离              │
│                                                         │
│  连接状态（系统观测，随心跳/断连变化）                     │
│   ┌──────────┐    登录     ┌──────────┐                 │
│   │  未连接   │ ─────────→ │  活跃     │                 │
│   └──────────┘ ←───────── └──────────┘                 │
│                 心跳超时 / 主动断开                       │
│                                                         │
│  展示状态（用户设置，与连接是否存活无关）                   │
│   在线 / 隐身 / 勿扰 / 离线（可选）                       │
└─────────────────────────────────────────────────────────┘
```

**状态存储方案对比：**

| 方案 | 适用条件与主要代价 |
| :-- | :-- |
| 数据库 | 低频状态变更、规模较小的场景；高频心跳轮询容易增加数据库负担 |
| Redis Bitmap | 大量用户的紧凑布尔状态查询；不适合直接承载每个连接的丰富属性 |
| Redis Hash + TTL | 保存用户或连接的状态属性；需考虑 Key 数量、字段数量、过期清理和并发更新 |
| 独立状态服务 | 统一管理连接、跨节点路由和状态聚合；需额外承担服务治理与故障恢复成本 |

具体规模取决于每用户连接数、状态更新频率、内存预算和查询延迟目标，用户数量本身不足以决定选型。

下面的代码展示单连接路由的最小实现。真实 IM 系统通常同时存在多个设备和多个连接；此时应按 `connectionId` 分别保存路由，并在消息投递时向所有有效连接扇出。

```java
// Redis 存储在线状态（单连接示例）
@Component
public class PresenceService {

    @Autowired
    private StringRedisTemplate redis;

    private static final String PRESENCE_KEY = "im:presence:";
    private static final long ONLINE_TTL = 120; // 2 分钟 TTL

    public void online(String userId, String serverId) {
        String key = PRESENCE_KEY + userId;
        redis.opsForHash().put(key, "status", "ONLINE");
        redis.opsForHash().put(key, "server", serverId);
        redis.expire(key, ONLINE_TTL, TimeUnit.SECONDS);
    }

    public void heartbeat(String userId) {
        redis.expire(PRESENCE_KEY + userId, ONLINE_TTL, TimeUnit.SECONDS);
    }

    public void offline(String userId) {
        // 单连接示例：连接关闭后清除状态。
        // 多连接场景应按 connectionId 删除对应字段，并在没有连接时再删除整个 key。
        redis.delete(PRESENCE_KEY + userId);
    }

    public boolean isOnline(String userId) {
        return redis.hasKey(PRESENCE_KEY + userId);
    }

    // 查询用户在哪台服务器上（用于消息路由）
    public String getServerId(String userId) {
        return (String) redis.opsForHash()
                .get(PRESENCE_KEY + userId, "server");
    }
}
```

## 消息路由、可靠性与顺序

### 消息路由

Redis 中的在线状态是路由依据，不是连接仍然可用的证明。消息服务查询到目标服务器后，用户可能已经断线或切换服务器，因此目标服务器仍需检查本地连接；连接不存在时，应将消息交给可恢复的离线存储或重新路由，而不能直接丢弃。多设备场景还需区分用户与连接：用户级状态用于判断是否存在活跃连接，连接级路由用于找到具体投递目标。

当系统有多台消息服务器时，如何把消息投递到正确的服务器是核心问题：

```txt
                  ┌──────────────────────────────────────┐
                  │          消息路由架构                  │
                  └──────────────────────────────────────┘

    用户A ──→ ┌──────────┐         ┌──────────┐ ←── 用户B
              │ Server-1 │         │ Server-2 │
              └────┬─────┘         └────┬─────┘
                   │                     │
                   ↓                     ↓
              ┌──────────────────────────────────┐
              │       消息路由层（Message Router） │
              │                                  │
              │  1. 查 Redis: 用户B在哪台服务器？   │
              │  2. 如果在本机 → 直接投递           │
              │  3. 如果在远端 → 通过 MQ 转发       │
              └──────────┬───────────────────────┘
                         │
                         ↓
              ┌──────────────────────┐
              │  消息队列 (Kafka/RMQ) │
              └──────────────────────┘
```

```java
@Service
public class MessageRouter {

    @Autowired
    private PresenceService presenceService;

    @Autowired
    private LocalSessionManager localSessions;

    @Autowired
    private KafkaTemplate<String, String> kafka;

    private final String currentServerId = "server-1"; // 当前服务器ID

    public void route(Message message) {
        String targetUserId = message.getTo();
        String targetServer = presenceService.getServerId(targetUserId);

        if (targetServer == null) {
            // 用户离线，存入离线消息
            saveOfflineMessage(message);
            return;
        }

        if (currentServerId.equals(targetServer)) {
            // 用户在本机，直接投递
            Session session = localSessions.get(targetUserId);
            if (session != null && session.isOpen()) {
                session.getBasicRemote().sendText(
                        JsonUtil.toJson(message));
            } else {
                // presence 可能已经过期，不能静默丢弃
                saveOfflineMessage(message);
            }
        } else {
            // 用户在其他服务器，通过 MQ 转发
            kafka.send("im.message.transfer." + targetServer,
                    JsonUtil.toJson(message));
        }
    }

    private void saveOfflineMessage(Message message) {
        // 此处假设项目已注入 offlineMessageStore，仅示意接口调用；
        // 实际实现需在可恢复存储中按消息 ID 与序列号保存，重连后按已确认的同步位置拉取
        offlineMessageStore.save(message);
    }
}
```

跨服务器路由不能以「调用了 MQ 发送 API」作为投递成功的判断。`kafka.send()` 是异步调用，返回不代表消息已写入 Kafka，更不代表目标服务器已收到；生产实现需要检查发送结果，并明确发送失败时的重试、持久化和告警策略。`currentServerId = "server-1"` 是教学占位值，部署时必须使用实际实例标识。`"im.message.transfer." + targetServer` 为每台服务器构造独立 Topic 的做法需要评估 Topic 数量、分区规划和目标服务器生命周期，不是所有 IM 系统的默认选型。

还有一个更隐蔽的竞态：`getServerId()` 查询到目标服务器后，用户可能立刻断开或切换服务器。路由查询只是某一时刻的状态快照，不能保证投递时连接仍然有效，目标服务器仍需处理连接不存在、消息重投和离线补偿。

### 消息可靠性

IM 需要尽量避免消息丢失和重复。网络超时并不能说明消息一定没有送达：服务端可能已经提交消息，只是 ACK 没有返回。因此，客户端重试时必须携带稳定的消息 ID，服务端也需要识别重复请求。

消息确认分两个阶段：发送方到服务端返回服务端 ACK，服务端到接收方返回接收方 ACK。两个 ACK 含义不同，下面分别说明。

```txt
┌─────────────────────────────────────────────────────────┐
│                 消息可靠投递的两个阶段                     │
│                                                         │
│  阶段一：发送方 → 服务端                                   │
│    1. 客户端发送消息（带 clientMsgId）                     │
│    2. 服务端校验，并在持久化事务中记录消息与幂等标识          │
│    3. 服务端提交后返回服务端 ACK（带 serverMsgId + 序列号） │
│    4. 客户端超时未收到 ACK → 用同一 clientMsgId 重试        │
│       → 服务端识别重复，返回原处理结果，不重复创建           │
│                                                         │
│  阶段二：服务端 → 接收方                                   │
│    5. 服务端将已提交消息投递给接收方                        │
│    6. 接收方按消息 ID 去重，本地持久化后返回接收方 ACK       │
│    7. 服务端未收到接收方 ACK → 按策略重投，接收方需幂等      │
│    8. 接收方离线 → 消息保留在可恢复存储，重连后同步          │
└─────────────────────────────────────────────────────────┘
```

服务端 ACK 与接收方 ACK 表示不同阶段的进展。系统可以通过重试和幂等降低丢失、重复的风险，但不能仅凭 ACK 和有限次重试保证消息绝不丢失。这里的「完成持久化」必须与实际实现一致：如果服务端只写入内存队列、尚未提交数据库事务，就不应把 ACK 描述成消息已经持久化。

```java
// 消息去重 —— 基于 clientMsgId
@Component
public class MessageDeduplicator {

    @Autowired
    private StringRedisTemplate redis;

    private static final String DEDUP_KEY = "im:msg:dedup:";
    private static final long DEDUP_TTL = 86400; // 24 小时去重窗口

    /**
     * @return true 如果是新消息，false 如果是重复消息
     */
    public boolean tryAcquire(String clientMsgId) {
        Boolean result = redis.opsForValue()
                .setIfAbsent(DEDUP_KEY + clientMsgId, "1",
                        DEDUP_TTL, TimeUnit.SECONDS);
        return Boolean.TRUE.equals(result);
    }
}
```

这段代码只展示「去重键原子抢占」，不是完整的消息去重实现。如果执行顺序是「Redis 写入去重键 → 进程崩溃 → 消息未落库 → 客户端重试」，Redis 会把重试判定为重复，导致消息从未成功落库却被抑制。原子去重不等于可靠处理。

更稳妥的做法是把消息记录与 `clientMsgId` 的唯一约束放在同一数据库事务内，重复请求返回已有处理结果；Redis 作为辅助去重缓存，不应让一个没有恢复状态的缓存键决定消息能否重试。24 小时去重窗口也只是策略参数，如果客户端可能在此之后重试，需要依靠数据库唯一约束或延长幂等记录保留期。
// 消息 ACK 机制
@Data
public class MessageAck {
    private String clientMsgId;   // 客户端消息ID（幂等键）
    private String serverMsgId;   // 服务端消息ID
    private long sequenceNo;      // 消息序列号（保证顺序）
    private long timestamp;
}
```

### 消息顺序保证

消息顺序是 IM 系统的经典难题。严格全局有序代价太高，通常保证**单聊有序**和**群聊分区有序**：

```java
/**
 * 基于 Redis 的自增序列号生成器
 * 该方法只负责为会话分配递增编号，不保证持久化和投递顺序
 */
@Component
public class SequenceGenerator {

    @Autowired
    private StringRedisTemplate redis;

    /**
     * 生成会话级别的自增序列号
     * @param conversationId 会话ID（单聊需规范化，如按 uid 排序后拼接，避免 A_B 与 B_A 产生两套序列）
     */
    public long nextSequence(String conversationId) {
        String key = "im:seq:" + conversationId;
        Long seq = redis.opsForValue().increment(key);
        if (seq == null) {
            throw new IllegalStateException("Failed to allocate sequence");
        }
        return seq;
    }
}
```

序列分配失败时抛出运行时异常（`IllegalStateException`），由调用链上能决定重试、终止请求或记录告警的边界统一处理。示例未展开上层异常处理逻辑。

**排序方案对比：**

| 方案 | 原理与边界 |
| :-- | :-- |
| 数据库自增 ID | 单分片/单会话内可递增有序；分库后全局唯一与全局顺序更难保证 |
| Redis INCR | 为同一 Key 分配递增编号，适合快速获取会话序列号；编号分配与消息持久化是独立操作 |
| Snowflake 类 ID | 适合生成分布式唯一 ID；ID 数值顺序不等同会话业务顺序，不能单独承担有序保证 |
| 会话内序列号 | 为会话分配递增编号；能否实现业务有序取决于编号分配、持久化和投递流程 |

序列号只负责**会话内的编号顺序**，不保证网络投递顺序。编号顺序、持久化顺序、投递顺序和客户端展示顺序是四个不同概念：Redis INCR 分配编号、数据库提交消息、网络投递、客户端排序展示，各步骤之间没有必然的先后一致。例如两个并发请求分别获得序号 101 和 102，获得 101 的请求在数据库写入前被阻塞，获得 102 的请求反而先提交，数据库中的提交顺序就成了 102、101。重试和多条链路仍可能让消息乱序，客户端收到消息后应按 `sequenceNo` 排序，并配合 ACK、去重和滑动窗口处理缺失消息。窗口大小和超时时间需要根据消息速率、重试策略和用户可接受延迟确定。如果业务要求严格的会话顺序，序列号分配、消息持久化和会话内的并发处理需要一起设计，而不是仅靠一个自增编号。

## IM 系统架构总览

```txt
┌───────────────────────────────────────────────────────────────────┐
│                         IM 系统整体架构                             │
│                                                                   │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐                            │
│  │ 客户端A  │  │ 客户端B  │  │ 客户端C  │                            │
│  └────┬────┘  └────┬────┘  └────┬────┘                            │
│       │            │            │                                 │
│       ↓            ↓            ↓                                 │
│  ┌──────────────────────────────────────┐                         │
│  │        接入层 (Gateway)               │                         │
│  │  WebSocket 长连接管理 / 鉴权 / 协议解析 │                         │
│  └──────────────────┬───────────────────┘                         │
│                     │                                             │
│       ┌─────────────┼─────────────┐                               │
│       ↓             ↓             ↓                               │
│  ┌─────────┐  ┌──────────┐  ┌──────────┐                          │
│  │ 消息服务 │  │ 状态服务  │   │ 用户服务  │                          │
│  │ Message │  │ Presence │  │  User    │                          │
│  └────┬────┘  └────┬─────┘  └────┬─────┘                          │
│       │             │             │                               │
│       ↓             ↓             ↓                               │
│  ┌─────────┐  ┌──────────┐  ┌──────────┐                          │
│  │  Kafka  │  │  Redis   │  │  MySQL   │                          │
│  │ (消息)  │   │ (状态)   │  │ (持久)    │                          │
│  └─────────┘  └──────────┘  └──────────┘                          │
│                                                                   │
│  ┌──────────────────────────────────────┐                         │
│  │         离线推送服务                   │                         │
│  │  APNs / FCM / 厂商推送通道             │                         │
│  └──────────────────────────────────────┘                         │
└───────────────────────────────────────────────────────────────────┘
```

接入层负责连接管理、鉴权和协议解析；消息服务负责消息校验、持久化和投递协调；状态服务维护用户与活跃连接之间的映射。Redis 用于在线状态、路由信息等需要快速访问的数据，MySQL 等持久化存储用于保存需要恢复的消息记录。Kafka 可承担跨节点异步转发，但消息服务仍需处理发布失败、重复消费和接收方离线等情况。

离线推送服务通过 APNs、FCM 或厂商推送通道提醒离线设备，不应与 IM 消息本身的持久化和同步机制混为一谈。推送平台接受通知请求，也不代表用户设备已经收到 IM 消息，更不代表消息已被用户阅读。

> **本章与其他章节的联系：**
>
> - **纵向（本专题内）：** 第 2-3 章介绍 TCP 与性能参数，第 7 章介绍 HTTP，第 9 章讨论 RPC，第 10 章展开长连接协议与保活。本章在这些基础上组织 IM 的状态、路由与投递模型；长连接故障排查见[网络性能分析与故障排查](../06-diagnostics/03-network/chapter-01-network-diagnostics.md)。
>
> - **横向（跨专题）：** 本章的 IM 系统设计与 [Java 并发专题](../03-java-concurrency/chapter-11-thread-pool.md)中的线程池、并发集合密切相关（如 `CopyOnWriteArraySet` 管理会话）；消息队列的使用涉及消息中间件专题；Redis 在线状态存储则与缓存设计一脉相承。
