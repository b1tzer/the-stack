---
type: explanation
level: intermediate
---

# 可观测性与评估

> 本文以 Spring AI 1.1.x、Spring Boot 3.5.x 与 Micrometer 为准。指标名称遵循 OpenTelemetry 生成式 AI 语义约定，不同后端展示的名字会有前缀或下划线差异。

AI 功能的运维难点不在于「服务是否存活」，而在于四个无法用传统指标回答的问题：

1. 这次调用花了多少 token，成本涨在哪里？
2. 回答变差是模型变了、检索变差了，还是提示词被改了？
3. 一次请求慢，慢在检索、模型还是工具？
4. 上线新版本后，质量是否退化？

前三个靠观测，最后一个靠评估。两者都不能只在上线后补。

## 1. 观测覆盖了哪些组件

Spring AI 基于 Micrometer Observations 埋点，覆盖 `ChatClient`、`ChatModel`、`EmbeddingModel`、`ImageModel`、`VectorStore` 和工具调用。

前提是引入 Actuator：

```xml
<dependency>
  <groupId>org.springframework.boot</groupId>
  <artifactId>spring-boot-starter-actuator</artifactId>
</dependency>
```

没有这个依赖就没有任何 AI 指标和追踪。这一点容易被忽略，因为应用能正常运行，只是监控面板上什么都没有。

### 1.1 低基数进指标，高基数只进追踪

| 键类型 | 例子 | 指标 | 追踪 |
| :-- | :-- | :-- | :-- |
| 低基数 | 操作名、系统名、模型名 | 是 | 是 |
| 高基数 | 提示词、补全内容、token 数、参数值 | 否 | 是 |

设计意图是避免标签爆炸：把 prompt 当指标标签，几万条不同文本就会产生几万条时间序列。所以**想看具体内容只能查 trace，指标里只有聚合信息**。

排查「某次回答为什么是这样」时，指标帮不上忙，必须依赖 trace 或临时打开内容日志。

### 1.2 内容类日志默认关闭

提示词和补全内容可能包含用户隐私、内部文档、密钥，因此开关默认全部关闭：

| 属性 | 作用 | 默认 |
| :-- | :-- | :-- |
| `spring.ai.chat.client.observations.log-prompt` | 记录 ChatClient 层提示词 | `false` |
| `spring.ai.chat.client.observations.log-completion` | 记录 ChatClient 层补全 | `false` |
| `spring.ai.chat.observations.log-prompt` | 记录 ChatModel 层提示词 | `false` |
| `spring.ai.chat.observations.log-completion` | 记录 ChatModel 层补全 | `false` |
| `spring.ai.tools.observations.include-content` | 导出工具入参与结果 | `false` |
| `spring.ai.vectorstore.observations.log-query-response` | 记录向量检索请求与响应 | `false` |

`chat.client` 和 `chat` 是两套属性：前者作用于 ChatClient 层，后者作用于底层 ChatModel 层。只开一套，另一层的日志仍然看不到。

临时排查时按需开启，并在排查结束后关闭。长期开启等于把用户数据持续写进日志系统。

## 2. 关键指标

| 指标 | 类型 | 说明 |
| :-- | :-- | :-- |
| `gen_ai.chat.client.operation` | Timer | ChatClient 端到端耗时，含 Advisor |
| `gen_ai.client.operation` | Timer | 模型厂商调用耗时 |
| `gen_ai.client.token.usage` | Counter | token 消耗，按 `gen_ai_token_type` 区分输入/输出 |
| `db.vector.client.operation` | Timer | 向量库 add/delete/query |
| `spring.ai.tool` | Timer | 工具调用耗时 |

告警建议从四个维度建立，而不是给每个指标都设阈值：

1. **失败率**：模型调用错误（含限流、超时）占比。
2. **延迟**：`gen_ai.client.operation` 的 P95，与检索、工具耗时分开看。
3. **成本**：token 总量按业务维度（接口、租户、功能）聚合，设日增量告警。
4. **检索健康度**：查询耗时的突变，通常意味着索引未生效或数据量激增。

指标只能发现「异常」，不能解释「原因」。用量突增可能是业务增长，也可能是提示词里误加了整篇文档。

## 3. 追踪与日志

一次 AI 请求通常包含多个 span：ChatClient、Advisor、ChatModel、工具调用、向量检索。它们通过 trace ID 关联。

实践建议：

- **把业务标识写进 span 或日志**，例如会话 ID、租户 ID、功能名。只靠 trace ID 无法从业务视角检索。
- **不要记录完整提示词。** 需要复现时记录提示词模板 ID、版本号和参数摘要。
- **记录 `finishReason`。** 截断问题不会体现在错误率上。
- **工具调用单独记录。** 工具内部的慢查询会被误算成模型慢。

## 4. 成本核算

token 用量来自响应元数据：

```java
ChatResponse response = chatClient.prompt()
        .user(question)
        .call()
        .chatResponse();

Usage usage = response.getMetadata().getUsage();
meterRegistry.counter("ai.tokens",
        "feature", "ticket-summary",
        "type", "input").increment(usage.getPromptTokens());
meterRegistry.counter("ai.tokens",
        "feature", "ticket-summary",
        "type", "output").increment(usage.getCompletionTokens());
```

三个注意点：

- **流式调用的用量在最后一个分片才完整。** 中途取消的请求可能没有可用数据，成本统计会偏低。
- **检索和工具也消耗成本。** 向量检索有基础设施成本，工具调用的结果会再次进入上下文并计费。
- **缓存能显著降本。** 同一段长 system 提示重复发送时，部分厂商支持提示词缓存，但要求前缀稳定。把变化的参数放到消息末尾，可以命中缓存。

按 `feature`、`tenant` 这类低基数标签聚合，才能定位成本来源。用用户 ID 或会话 ID 做标签会让指标基数失控。

## 5. 质量评估

错误率、延迟、成本都正常，回答仍可能是错的。质量需要单独的评估机制。

Spring AI 提供 `Evaluator` 接口，用模型判断模型输出：

```java
EvaluationResponse evaluate(String question, List<Content> context, String answer) {
    Evaluator evaluator = new RelevancyEvaluator(ChatClient.builder(chatModel));
    return evaluator.evaluate(new EvaluationRequest(question, context, answer));
}

EvaluationResponse factCheck(String document, String claim) {
    Evaluator evaluator = new FactCheckingEvaluator(ChatClient.builder(chatModel));
    return evaluator.evaluate(new EvaluationRequest(document, List.of(), claim));
}
```

| 评估器 | 判断什么 | 典型用途 |
| :-- | :-- | :-- |
| `RelevancyEvaluator` | 回答是否切合问题与检索上下文 | RAG 质量回归 |
| `FactCheckingEvaluator` | 陈述是否被给定文档支持 | 幻觉检测 |

`EvaluationRequest` 有三个字段：用户问题、上下文数据、待评估的回答。RAG 场景下上下文可以从响应元数据里取：

```java
ChatResponse response = chatClient.prompt(question)
        .advisors(ragAdvisor)
        .call()
        .chatResponse();

Object context = response.getMetadata().get(RetrievalAugmentationAdvisor.DOCUMENT_CONTEXT);
```

### 5.1 用 LLM 做评委的边界

- **评估本身有成本。** 每条用例多一次模型调用，回归集大的时候费用可观。核查类任务可以用小模型甚至本地模型。
- **评委模型也会错。** 它给出的是「倾向性判断」，不是事实判定。关键业务仍需人工抽检。
- **评估模型不要和生成模型相同。** 同一个模型对自己的输出有明显偏好，换一个模型或换一家厂商更可靠。
- **固定评估提示词。** 评估模板变了，历史分数就不可比，需要重新建立基线。

## 6. 测试策略

三层测试各管一件事：

| 层次 | 方式 | 验证什么 |
| :-- | :-- | :-- |
| 单元测试 | mock `ChatModel` | 提示词拼装、参数传递、异常分支 |
| 集成测试 | Testcontainers 起 pgvector | 入库、检索、过滤、SQL 脚本 |
| 评估测试 | 真实模型 + `Evaluator` | 回答质量是否达标 |

单元测试里替换模型，让结果可重复：

```java
@Test
void summarizeKeepsErrorCode() {
    ChatModel model = mock(ChatModel.class);
    when(model.call(any(Prompt.class))).thenReturn(
            new ChatResponse(List.of(new Generation(new AssistantMessage("E1024：连接超时")))));

    var service = new TicketSummaryService(ChatClient.create(model));

    assertThat(service.summarize("...")).contains("E1024");
}
```

注意断言的是「服务对模型输出的处理」，不是模型本身。模型行为不在单元测试范围内。

评估测试会真实调用模型，应满足三个条件：单独打标签、不进默认的 `mvn test`、失败不阻塞发布但要有报告。否则一次厂商抖动就会让流水线变红。

## 7. 上线检查清单

| 检查项 | 说明 |
| :-- | :-- |
| Actuator 与指标导出 | 没有它就没有任何 AI 观测数据 |
| 内容日志开关 | 生产默认关闭，排查时临时开启 |
| token 成本看板 | 按功能与租户聚合，有日增量告警 |
| 超时与重试 | 每层都有上限，重试不影响幂等 |
| 提示词版本 | 提示词随代码发布，可回滚 |
| 评估基线 | 有回归集和上一次的通过率 |
| 错误兜底 | 模型不可用时返回可读提示，不直接抛堆栈 |
| 数据脱敏 | 日志、追踪、评估集都不含敏感信息 |

最后一项经常被跳过。评估集往往直接用线上真实问题构建，里面可能包含手机号、订单号，需要先清洗再入库。

## 8. 从故障到定位的顺序

出现「回答不对」时，按下面的顺序查，避免直接在提示词上反复改：

1. 看 trace：模型调用是否成功，`finishReason` 是否正常，耗时在哪一段。
2. 看检索：召回片段里有没有正确答案。没有就是检索问题。
3. 看提示词：实际发送的 system 与上下文顺序是否符合预期。
4. 看工具：是否调用了不该调用的工具，参数是否正确。
5. 看评估：单个案例不能说明退化，用回归集判断。

顺序颠倒的代价是：改了提示词，掩盖了检索缺陷，下一个问题再次出现。

## 小结

- 观测覆盖指标与追踪，内容类信息默认关闭，且只能进 trace。
- 低基数标签用于聚合，高基数只用于诊断，不要把 prompt 当标签。
- token 用量从响应元数据取，按功能维度聚合才能定位成本。
- 质量评估用 `Evaluator`，评估模型与生成模型分开，评估提示词固定版本。
- 排查从 trace 到检索再到提示词，不要跳过检索直接改提示词。
