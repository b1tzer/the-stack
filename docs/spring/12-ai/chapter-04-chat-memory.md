---
type: explanation
level: intermediate
---

# 对话记忆

> 本文以 Spring AI 1.1.x 为准。会话 ID 必填、`PromptChatMemoryAdvisor` 废弃等行为从 1.1.x 开始生效，升级前请对照版本。

模型本身不记得上一轮说过什么。每次调用都是一次独立的请求，历史必须由应用带进去。这件事听起来简单，实际要回答三个问题：保留多少、存在哪里、谁可以读。

Spring AI 把这三个问题拆成不同抽象，混用会导致会话串号、上下文膨胀或持久化失效。

## 1. 记忆不是聊天记录

两个概念要分开：

| 概念 | 内容 | 用途 |
| :-- | :-- | :-- |
| 对话记忆（Chat Memory） | 模型生成下一轮回答所需的近期消息 | 拼进提示词 |
| 聊天记录（Chat History） | 完整的会话历史，含时间、用户、审计信息 | 查询、审计、导出 |

`ChatMemory` 面向第一个用途。它会有意丢弃旧消息，所以不适合当作归档存储。需要完整历史时，用业务表或 Spring Data 自己保存，不要指望记忆组件。

## 2. ChatMemory 与 ChatMemoryRepository

```java
public interface ChatMemory {
    void add(String conversationId, Message... messages);
    List<Message> get(String conversationId);
    void clear(String conversationId);
}
```

`ChatMemory` 决定保留策略，`ChatMemoryRepository` 只负责存取。默认组合是 `InMemoryChatMemoryRepository` 加 `MessageWindowChatMemory`。

`MessageWindowChatMemory` 的行为：

- 按消息条数保留窗口，默认 20 条。
- 超出后删除最旧的消息，但保留 system 消息。
- 一个窗口同时包含用户消息和助手消息，所以 20 条大约等于 10 轮。

```java
ChatMemory chatMemory = MessageWindowChatMemory.builder()
        .maxMessages(10)
        .build();
```

窗口太小会「失忆」，太大会让每次请求的输入 token 线性增长。窗口大小应该按对话轮次和单条消息长度估算，不要照抄默认值。

## 3. 接入 ChatClient

```java
@Bean
ChatClient chatClient(ChatClient.Builder builder, ChatMemory chatMemory) {
    return builder
            .defaultAdvisors(MessageChatMemoryAdvisor.builder(chatMemory).build())
            .build();
}
```

调用时必须传会话 ID：

```java
String conversationId = "session-20261109-001";

String answer = chatClient.prompt()
        .user("我刚才说的订单号是哪个？")
        .advisors(a -> a.param(ChatMemory.CONVERSATION_ID, conversationId))
        .call()
        .content();
```

**没有默认会话 ID。** 缺少这个参数会抛 `IllegalArgumentException`，这是 1.1.x 的强制约束。它避免了一个隐患：所有未指定会话的请求共享同一份记忆，用户之间互相看到对方的内容。

不要使用 `PromptChatMemoryAdvisor`。它从 1.1.3 起废弃，把历史以 XML 标签形式塞进 system 消息，并且禁用自定义 system 模板。作用相同的 `MessageChatMemoryAdvisor` 把历史作为类型化消息传递，对模型更友好。

### 3.1 Advisor 做了哪些事

`MessageChatMemoryAdvisor` 在请求前把历史追加到消息列表，在响应后把用户消息和助手消息写回 `ChatMemory`。业务代码不需要手动 `add`。

这也意味着**不要在同一个 `ChatClient` 上再手动维护一遍历史**，否则消息会重复，模型看到两次相同的问题。

### 3.2 不使用 ChatClient 时

直接调用 `ChatModel` 时，记忆完全由调用方管理：

```java
String conversationId = "session-20261109-001";

chatMemory.add(conversationId, new UserMessage("我的订单号是 A1024"));
ChatResponse first = chatModel.call(new Prompt(chatMemory.get(conversationId)));
chatMemory.add(conversationId, first.getResult().getOutput());

chatMemory.add(conversationId, new UserMessage("我刚才说的订单号是哪个？"));
ChatResponse second = chatModel.call(new Prompt(chatMemory.get(conversationId)));
chatMemory.add(conversationId, second.getResult().getOutput());
```

顺序不能乱：先把用户消息写入记忆，再取历史拼 `Prompt`，最后把响应写回。漏掉最后一步，下一轮就看不到助手的回答。

## 4. 持久化

内存仓库在进程重启后丢失，多实例部署时每个实例各有一份。生产环境需要共享存储。

JDBC 仓库的接入方式：

```xml
<dependency>
  <groupId>org.springframework.ai</groupId>
  <artifactId>spring-ai-starter-model-chat-memory-repository-jdbc</artifactId>
</dependency>
```

```yaml
spring:
  ai:
    chat:
      memory:
        repository:
          jdbc:
            initialize-schema: always
```

`initialize-schema` 的取值决定建表时机：

| 取值 | 行为 | 适用 |
| :-- | :-- | :-- |
| `embedded` | 仅对内置数据库建表（默认） | 本地开发、H2 |
| `always` | 每次启动都执行建表脚本 | 开发环境、无迁移工具的项目 |
| `never` | 不建表 | 已用 Flyway/Liquibase 管理结构 |

表名是 `SPRING_AI_CHAT_MEMORY`。生产环境通常选 `never`，由迁移脚本创建，避免应用启动时改动线上结构。消息按时间戳升序读出，符合对话顺序。

手写仓库实例时要指定方言，或者让框架从 `DataSource` 自动探测：

```java
ChatMemoryRepository repository = JdbcChatMemoryRepository.builder()
        .jdbcTemplate(jdbcTemplate)
        .dialect(JdbcChatMemoryRepositoryDialect.from(dataSource))
        .build();
```

除关系库外，还有 Cassandra、Neo4j、MongoDB 等实现，选择依据是团队已有的运维能力，不是性能差异。为了几十条消息引入一个新的存储系统通常不划算。

## 5. 会话 ID 的设计

会话 ID 是记忆的隔离边界，也是越权风险的入口。

三类 ID 来源，安全性依次下降：

1. **服务端生成并保存在会话中。** 例如登录后生成 UUID 放进服务端 session，客户端无法构造。
2. **服务端签发、客户端回传。** 例如签名 token，服务端校验签名与用户归属。
3. **客户端直接传。** 例如 URL 参数 `conversationId`，必须校验它属于当前用户。

第三种最常见，也最容易出问题：用户把 ID 改成别人的值，就能读到别人的对话记忆。校验逻辑要放在进入 AI 调用的地方：

```java
void assertOwnedByCurrentUser(String conversationId, String userId) {
    if (!conversationRepository.exists(conversationId, userId)) {
        throw new AccessDeniedException("会话不存在或无权访问");
    }
}
```

另外两条规则：

- **不要用可枚举的 ID**（自增数字、时间戳），它会让越权尝试变得容易。
- **不要复用会话 ID 跨业务场景**。客服会话和内部助手混用同一个 ID，记忆会互相污染。

## 6. 上下文膨胀与成本

记忆是输入 token 的主要来源之一。20 条消息、每条 200 token，每轮就多出 4000 token 的固定成本，且随轮次增长到窗口上限。

控制手段，按实施成本排序：

| 手段 | 做法 | 代价 |
| :-- | :-- | :-- |
| 缩小窗口 | `maxMessages` 设为 6～10 | 更早「失忆」 |
| 限制单条长度 | 入库前截断超长输入 | 丢失细节 |
| 摘要替代原文 | 定期把旧消息压成一段摘要，作为 system 消息 | 需要自己实现策略 |
| 按业务切分会话 | 一个任务一个会话，完成后关闭 | 需要业务定义任务边界 |

Spring AI 没有内置的「摘要记忆」。需要时实现自己的 `ChatMemory` 装饰器，在消息数超过阈值时调用模型生成摘要并替换旧消息。这属于产品决策，不是框架配置。

## 7. 已知限制

- **工具调用的中间消息不会进入记忆。** 框架托管的工具调用循环中，`ToolResponseMessage` 不写回 `ChatMemory`。需要完整记录时使用用户托管的工具执行方式，自行保存。
- **记忆不做过期清理。** 窗口只按条数裁剪。长时间不活跃的会话仍占用存储，需要在业务层定义归档与删除策略。
- **并发写同一会话可能乱序。** 同一个用户同时发两个请求，写回顺序不确定。前端应串行发送，或在服务端按会话加锁。
- **记忆内容会进入模型上下文。** 里面可能有手机号、地址等敏感信息，落库前要考虑脱敏和保留期限。

## 8. 多实例部署的检查项

| 检查项 | 期望 |
| :-- | :-- |
| 仓库实现 | 共享存储（JDBC、Redis 等），不是 `InMemoryChatMemoryRepository` |
| 建表方式 | 迁移工具管理，`initialize-schema=never` |
| 会话 ID | 服务端可校验归属，不可枚举 |
| 清理策略 | 有归档或删除任务 |
| 监控 | 记忆条数、单会话 token 量、存储增长 |

前两项缺失时，表现是「换一个实例后对话断了」，这类问题在单机测试中不会出现。

## 小结

- 模型无状态，记忆是应用侧能力；记忆不等于聊天记录。
- `ChatMemory` 管策略，`ChatMemoryRepository` 管存储，默认窗口 20 条。
- 会话 ID 必填且必须校验归属，否则会出现串号和越权。
- 生产环境用共享存储，并自己管理表结构与清理。
- 记忆直接推高输入 token，窗口大小是成本决策。
