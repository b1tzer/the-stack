# IM 系统设计

长连接解决“如何持续通信”，IM 系统还要解决在线状态、消息路由、可靠投递和顺序保证。本章把这些能力组织成可落地的系统模型。

## 在线状态管理

一个生产级的即时通讯系统是长连接技术的集大成者。本节从四个核心维度拆解 IM 系统设计。

```txt
┌─────────────────────────────────────────────────────────┐
│                    在线状态机                            │
│                                                         │
│   ┌──────────┐    登录     ┌──────────┐                 │
│   │  离线     │ ─────────→ │  在线     │                 │
│   │ OFFLINE  │            │  ONLINE  │                  │
│   └──────────┘            └────┬─────┘                  │
│        ↑                       │                        │
│        │                   心跳超时                      │
│        │                       ↓                        │
│        │               ┌──────────┐                     │
│        │    超时/主动   │  隐身     │                     │
│        └────────────── │ HIDDEN   │  (可选)              │
│          离线           └──────────┘                     │
└─────────────────────────────────────────────────────────┘
```

**状态存储方案对比：**

| 方案 | 优点 | 缺点 | 适用规模 |
| :-- | :-- | :-- | :-- |
| 数据库轮询 | 实现简单 | 延迟高，数据库压力大 | < 1万 |
| Redis Bitmap | O(1) 查询，内存高效 | 仅支持在线/离线二态 | 百万级 |
| Redis Hash + TTL | 支持多状态，自动过期 | 内存占用稍大 | 百万级 |
| 独立状态服务 | 可扩展，支持自定义状态 | 架构复杂 | 千万级 |

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
        // 持久化到数据库或 Redis List，用户上线后按游标拉取
        // 此处假设项目已注入 offlineMessageStore
        offlineMessageStore.save(message);
    }
}
```

### 消息可靠性

IM 系统中消息不能丢，也不能重复。需要多层保障：

```txt
┌─────────────────────────────────────────────────────────┐
│                 消息可靠投递流程                          │
│                                                         │
│  发送方                                                  │
│    │                                                    │
│    ├── 1. 客户端发送消息（带 clientMsgId）                 │
│    │                                                    │
│    ↓                                                    │
│  服务端                                                  │
│    │                                                    │
│    ├── 2. 服务端收到，持久化到 DB                          │
│    │                                                    │
│    ├── 3. 服务端返回 ACK（带 serverMsgId + 序列号）        │
│    │                                                    │
│    ├── 4. 投递给接收方                                    │
│    │                                                    │
│    ├── 5. 接收方 ACK 确认                                │
│    │                                                    │
│    ├── 6. 如果 3s 未收到 ACK → 重试（最多 3 次）           │
│    │                                                    │
│    ↓                                                    │
│  接收方                                                  │
│    │                                                    │
│    ├── 7. 收到消息，写入本地 DB                            │
│    │                                                    │
│    ├── 8. 向服务端发送 ACK                                │
│    │                                                    │
│    └── 9. 上层展示消息                                    │
└─────────────────────────────────────────────────────────┘
```

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
 * 保证同一会话内的消息有序
 */
@Component
public class SequenceGenerator {

    @Autowired
    private StringRedisTemplate redis;

    /**
     * 生成会话级别的自增序列号
     * @param conversationId 会话ID（单聊：uid1_uid2，群聊：groupId）
     */
    public long nextSequence(String conversationId) {
        String key = "im:seq:" + conversationId;
        Long seq = redis.opsForValue().increment(key);
        return seq != null ? seq : 0;
    }
}
```

**排序方案对比：**

| 方案 | 原理 | 优缺点 |
| :-- | :-- | :-- |
| 数据库自增 ID | 递增天然有序 | 集中瓶颈，分库后失效 |
| Redis INCR | 同上，但更快 | 单点瓶颈，需持久化 |
| Snowflake ID | 时间戳 + 机器 + 序列号 | 分布式，大致有序，偶尔需客户端修正 |
| 会话内序列号 | 每个会话独立自增 | 精确有序，会话间无序（可接受） |

序列号只负责**会话内的编号顺序**，不保证网络投递顺序；重试和多条链路仍可能让消息乱序。客户端收到消息后应按 `sequenceNo` 排序，并配合 ACK、去重和滑动窗口处理缺失消息。窗口大小和超时时间需要根据消息速率、重试策略和用户可接受延迟确定。

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

> **本章与其他章节的联系：**
>
> - **纵向（本专题内）：** 第 2-3 章介绍 TCP 与性能参数，第 7 章介绍 HTTP，第 9 章讨论 RPC，第 10 章展开长连接协议与保活。本章在这些基础上组织 IM 的状态、路由与投递模型；长连接故障排查见[网络性能分析与故障排查](../06-diagnostics/03-network/chapter-01-network-diagnostics.md)。
>
> - **横向（跨专题）：** 本章的 IM 系统设计与 [Java 并发专题](../03-java-concurrency/chapter-11-thread-pool.md)中的线程池、并发集合密切相关（如 `CopyOnWriteArraySet` 管理会话）；消息队列的使用涉及消息中间件专题；Redis 在线状态存储则与缓存设计一脉相承。
