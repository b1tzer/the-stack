---
type: explanation
level: intermediate
---

# 工具调用

> 本文以 Spring AI 1.1.x 为准。2.0 移除了 `ChatModel` 内部的工具执行循环，改由 `ToolCallingAdvisor` 承担，升级前请对照上一章的版本差异表。

工具调用（Tool Calling，早期文档中称 Function Calling）让模型在回答前请求执行一段代码：查订单、查天气、创建工单。模型不会直接访问你的数据库，它只返回「调用哪个工具、参数是什么」，执行由应用完成。

这个分工是安全边界的基础。所有参数都来自模型输出，必须按不可信输入处理。

## 1. 一次工具调用发生了什么

1. 应用把工具的名称、描述、参数 JSON Schema 随请求发给模型。
2. 模型判断需要调用工具，返回工具名和参数，不返回最终答案。
3. 应用执行工具，把结果作为工具消息回传。
4. 模型基于结果生成最终回答，或继续请求下一个工具。

第 2 到第 4 步默认由框架托管，业务代码只看到最终回答。需要审计每一步时，改用用户托管模式。

## 2. 定义工具

```java
class OrderTools {

    private final OrderRepository repository;

    OrderTools(OrderRepository repository) {
        this.repository = repository;
    }

    @Tool(description = "按订单号查询订单状态。订单号格式为字母 A 加 4 位数字。")
    OrderStatus queryOrderStatus(
            @ToolParam(description = "订单号，例如 A1024") String orderId) {
        return repository.findStatus(orderId)
                .orElseThrow(() -> new IllegalArgumentException("订单不存在：" + orderId));
    }
}
```

注解属性：

| 属性 | 作用 | 使用建议 |
| :-- | :-- | :-- |
| `name` | 工具名，默认取方法名 | 保持全局唯一，跨类也不能重名 |
| `description` | 告诉模型何时调用 | 写清触发条件，不要只写「查询订单」 |
| `returnDirect` | 结果直接返回调用方，跳过模型 | 仅用于「原样展示」的场景 |
| `resultConverter` | 自定义返回值序列化 | 默认 Jackson 转 JSON，通常不改 |

方法本身的约束容易被忽略：

- 静态方法和实例方法都支持，可见性不限。
- 参数和返回值必须可序列化。
- 不支持 `Optional`、`CompletableFuture`、`Mono`、`Flux` 以及 `Function` 这类函数式类型。
- 使用实例方法时，工具对象本身要被正确构造，依赖通过构造器注入。

**描述写得含糊是工具调用失败的首要原因。** 「查询订单状态」和「按订单号查询订单状态，订单号格式为 A 加 4 位数字，只用于查询单个订单」对模型的行为影响很大。

### 2.1 参数必填性

`@ToolParam(required = false)` 可以标记可选参数。这件事必须标对：参数实际不可用却声明为必填，模型会编造一个值来满足 Schema。

```java
@Tool(description = "按条件搜索订单，时间范围可选")
List<OrderSummary> searchOrders(
        @ToolParam(description = "用户 ID") String userId,
        @ToolParam(description = "起始日期，格式 yyyy-MM-dd", required = false) String from,
        @ToolParam(description = "结束日期，格式 yyyy-MM-dd", required = false) String to) {
    // ...
}
```

## 3. 注册工具

三种方式，作用域不同：

```java
// 方式一：传工具实例，为每个 @Tool 方法生成回调
chatClient.prompt()
        .user("A1024 到哪了？")
        .tools(new OrderTools(orderRepository))
        .call()
        .content();

// 方式二：传 ToolCallback，适合手工构造或从 MCP 获取
chatClient.prompt()
        .user("A1024 到哪了？")
        .toolCallbacks(ToolCallbacks.from(new OrderTools(orderRepository)))
        .call()
        .content();

// 方式三：按 bean 名解析，没有编译期类型检查
chatClient.prompt()
        .user("A1024 到哪了？")
        .toolNames("queryOrderStatus")
        .call()
        .content();
```

`defaultTools(...)`、`defaultToolCallbacks(...)`、`defaultToolNames(...)` 在 Builder 层设置，对所有请求生效。它们有两个风险：

- **运行时的工具会完全覆盖默认工具**，不是合并。想「默认几个再加一个」必须显式把默认工具一起传。
- **默认工具会让所有请求都能看到这些能力**，包括不该有写权限的请求。

除非工具集合固定且只读，否则按请求传工具更安全。

## 4. 传递不发给模型的上下文

租户、用户身份、追踪 ID 这类信息不应该出现在提示词里，但工具执行时需要。`ToolContext` 就是这条通道：

```java
@Tool(description = "查询当前用户自己的订单状态")
OrderStatus queryMyOrder(
        @ToolParam(description = "订单号，例如 A1024") String orderId,
        ToolContext context) {
    String userId = (String) context.getContext().get("userId");
    return repository.findStatus(orderId, userId)
            .orElseThrow(() -> new IllegalArgumentException("订单不存在或无权访问"));
}
```

```java
chatClient.prompt()
        .user("我的 A1024 到哪了？")
        .tools(orderTools)
        .toolContext(Map.of("userId", SecurityContext.currentUserId()))
        .call()
        .content();
```

`ToolContext` 不会发给模型，模型看不到 `userId`，也就无法伪造。**把身份信息放进工具参数、指望模型如实传递，是明确的越权漏洞。**

## 5. 两种执行模式

### 5.1 框架托管（默认）

`ChatModel` 内部完成「请求工具 → 执行 → 回传 → 再请求」的循环，业务代码只拿到最终答案。中间的 `ToolResponseMessage` 不会暴露给调用方，也不会写入对话记忆。

适合：工具只读、调用链短、不需要审批。

### 5.2 用户托管

需要审计、人工确认、或要在每轮工具调用之间插入业务逻辑时，关闭内部循环：

```java
ChatOptions options = ToolCallingChatOptions.builder()
        .toolCallbacks(ToolCallbacks.from(new OrderTools(repository)))
        .internalToolExecutionEnabled(false)
        .build();

Prompt prompt = new Prompt(userText, options);
ChatResponse response = chatModel.call(prompt);

while (response.hasToolCalls()) {
    ToolExecutionResult result = toolCallingManager.executeToolCalls(prompt, response);
    prompt = new Prompt(result.conversationHistory(), options);
    response = chatModel.call(prompt);
}
```

循环必须有上限。模型可能反复请求同一个工具，缺少次数限制会持续消耗 token。业务上还应对「同一工具、同一参数」的重复调用做去重。

### 5.3 Advisor 方式

`ToolCallAdvisor` 把工具循环放进 Advisor 链，好处是其他 Advisor 能拦截每一轮调用，便于观测和与记忆集成。配置项包括 `toolCallingManager`、`advisorOrder` 和是否维护会话历史。

需要同时使用记忆 Advisor 时，要避免历史被维护两次：把工具 Advisor 的会话历史关掉，由记忆 Advisor 统一负责。

## 6. 异常与失败

工具抛异常时，默认行为是「把错误信息回传给模型，让模型决定如何回应」，这也包括模型可以换一个参数重试。

```properties
# true：异常直接抛给调用方；false（默认）：转成错误消息回传模型
spring.ai.tools.throw-exception-on-error=false
```

两种策略各有代价：

- **回传给模型**：用户体验更连贯，但模型可能反复用同样参数重试，或把内部错误信息直接展示给用户。
- **抛给调用方**：可控，但需要业务代码兜底，并给用户一个可读的提示。

无论如何都不要把堆栈、SQL、内网地址放进错误消息。它们会进入模型上下文，也可能出现在回答里。

自定义 `ToolCallback` 时，抛 `ToolExecutionException` 才会走统一的异常处理链路。直接抛 `RuntimeException` 会绕过配置。

## 7. 能力边界

| 限制 | 说明 |
| :-- | :-- |
| 工具名唯一 | 同一次请求里的工具名必须全局唯一，跨类重名会冲突 |
| 返回值必须可序列化 | 默认用 Jackson 转 JSON |
| 方法型工具的禁用类型 | `Optional`、异步类型、响应式类型、函数式类型 |
| 函数型工具的禁用类型 | 基本类型、集合、`Optional`、异步与响应式类型 |
| `returnDirect` 的生效条件 | 一次响应中所有工具调用都必须标为 `returnDirect`，否则结果仍回传模型 |
| 工具数量 | 每个工具定义都占用输入 token，几十个工具会显著增加成本并降低选择准确率 |

最后一条常被低估。工具超过十来个之后，模型选错工具的概率明显上升。按业务域拆分 `ChatClient`，每个场景只暴露相关工具，比把所有工具都注册为默认工具更可靠。

## 8. 生产环境要点

- **写操作要幂等或二次确认。** 模型可能重复调用同一工具。创建订单这类操作应带幂等键，或要求人工确认。
- **工具内部再做权限校验。** 不信任模型传来的任何参数，包括看起来是 ID 的字符串。
- **设置超时。** 工具内部调用下游服务必须有超时，否则一次卡住会占满整个请求线程。
- **记录审计日志。** 工具名、参数摘要、执行结果、耗时、会话 ID。出问题时这是唯一证据。
- **限制工具可见范围。** 租户、角色不同的用户，看到的工具集合应该不同。
- **不要把内部管理工具暴露给面向用户的会话。** 提示注入能诱导模型调用任何已注册工具。

## 9. 与 MCP 的分工

`@Tool` 定义的是本应用内的工具，与模型同进程。MCP（Model Context Protocol）定义的是跨进程、跨服务的工具协议。需要复用外部工具生态，或让工具由独立团队维护时使用 MCP，见 [MCP 集成](./chapter-07-mcp.md)。

两者在 `ChatClient` 侧的用法一致：都会转成 `ToolCallback`。区别在部署边界和运维成本。

## 小结

- 模型只返回调用意图，执行永远在应用侧，参数按不可信输入处理。
- 工具描述和必填性决定调用质量，含糊的描述会直接导致误调用。
- 身份信息走 `ToolContext`，不要放进模型可见的参数。
- 默认的框架托管循环不暴露中间消息；需要审计时改用用户托管并设置循环上限。
- 工具越多，成本越高、选错概率越大，按场景裁剪工具集合。
