# Spring AI 概览与工程接入

> 本文以 Spring AI 1.1.x（参考文档 1.1.8）与 Spring Boot 3.5.x 为准，运行环境要求 Java 17 及以上。Spring AI 2.0.x 需要 Spring Boot 4.0.x 或 4.1.x，与本文的坐标、配置项和部分 API 不同，差异见本文第 8 节。
>
> 阅读前应能独立编写 Spring Boot 应用，理解依赖注入和自动配置的基本作用；本文不重复这些内容。

Spring AI 是 Spring 生态里的 AI 应用框架。它把「调用模型」这件事拆成可替换的抽象：聊天、嵌入、图像、语音各有接口，具体厂商通过 starter 接入。业务代码依赖抽象，更换模型时改动集中在配置和少量选项对象上。

它不负责训练模型，不提供推理服务，也不是工作流编排引擎。把它当成「AI 能力的 Spring 风格客户端加应用侧编排工具」更准确：模型在远端跑，Spring AI 负责组织请求、处理响应、连接企业数据和外部工具。

## 1. 它解决的问题

直接调用模型 HTTP 接口能跑通一次请求，但在工程里落地会遇到四个反复出现的问题：

1. 每个厂商的请求体、响应体、错误码、流式协议都不一样。
2. 提示词、对话历史、检索上下文、工具定义需要按固定顺序拼装，拼错不会报错，只会让回答变差。
3. 模型输出是非结构化文本，业务代码需要结构化的对象。
4. 调用是远程依赖，需要超时、重试、限流、成本统计和链路追踪。

Spring AI 对每个问题给出一个抽象：

| 问题 | Spring AI 的抽象 |
| :-- | :-- |
| 厂商差异 | `ChatModel`、`EmbeddingModel`、`ImageModel` 等接口，加厂商 starter |
| 请求拼装 | `ChatClient` 的流式 API 和 `Advisor` 链 |
| 结构化输出 | `entity()` 与 `StructuredOutputConverter` |
| 远程调用治理 | 基于 Micrometer 的观测、Spring 的 HTTP 客户端配置 |

关键结论：**Spring AI 的核心价值是「可替换」和「可编排」，不是「更强的模型能力」。** 回答质量主要由模型、提示词和检索到的数据决定，框架只能让这些因素更容易控制和验证。

## 2. 版本与兼容矩阵

版本不匹配是接入阶段最常见的失败原因。Spring AI 与 Spring Boot 是两条独立的发布线，必须成对选择。

| Spring AI | 对应 Spring Boot | 状态（2026 年 11 月） |
| :-- | :-- | :-- |
| 1.1.x | 3.4.x、3.5.x | 功能版本，本文基准 |
| 1.0.x | 3.4.x、3.5.x | 维护版本，只接收修复 |
| 2.0.x | 4.0.x、4.1.x | 当前默认稳定版本 |

判断依据来自官方 Getting Started 的兼容声明，而不是 Maven 能否解析依赖。坐标能下载、应用能启动，不代表自动配置的类名和属性名对得上。

选定版本后，用 BOM 统一管理版本，不要在单个依赖上写版本号：

```xml
<dependencyManagement>
  <dependencies>
    <dependency>
      <groupId>org.springframework.ai</groupId>
      <artifactId>spring-ai-bom</artifactId>
      <version>1.1.8</version>
      <type>pom</type>
      <scope>import</scope>
    </dependency>
  </dependencies>
</dependencyManagement>
```

从 1.0 开始，正式版本都在 Maven Central，不需要额外配置快照仓库。只有使用 `SNAPSHOT` 或 1.0 之前的里程碑版本时才需要加仓库，这时要检查 Maven `settings.xml` 里的 `<mirrorOf>*</mirrorOf>` 是否把 Spring 的仓库一并拦掉。

## 3. 第一个可运行调用

一个能跑的最小工程需要三样东西：模型 starter、聊天客户端、一次调用。

依赖：

```xml
<dependencies>
  <dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-web</artifactId>
  </dependency>
  <dependency>
    <groupId>org.springframework.ai</groupId>
    <artifactId>spring-ai-starter-model-openai</artifactId>
  </dependency>
</dependencies>
```

配置。1.1.x 的厂商参数位于 `<provider>.chat.options` 之下，2.0 起才扁平化为 `chat.model`：

```yaml
spring:
  ai:
    openai:
      api-key: ${OPENAI_API_KEY}
      chat:
        options:
          model: gpt-4o-mini
          temperature: 0.7
```

客户端。`ChatClient.Builder` 由自动配置提供，注意它是 prototype 作用域的 bean，每次注入都会得到新实例：

```java
@Configuration
class ChatConfig {

    @Bean
    ChatClient chatClient(ChatClient.Builder builder) {
        return builder
                .defaultSystem("你是一名严谨的技术支持工程师，回答不超过 150 字。")
                .build();
    }
}
```

调用：

```java
@Component
class DemoRunner implements ApplicationRunner {

    private final ChatClient chatClient;

    DemoRunner(ChatClient chatClient) {
        this.chatClient = chatClient;
    }

    @Override
    public void run(ApplicationArguments args) {
        String answer = chatClient.prompt()
                .user("用一句话解释 Spring 的 IoC 容器。")
                .call()
                .content();
        System.out.println(answer);
    }
}
```

这段代码的实际行为是：`prompt()` 构造请求，`call()` 声明同步模式，`content()` 才真正发出 HTTP 请求并取回文本。把 `call()` 换成 `stream()` 会得到 `Flux<String>`，但命令式应用需要额外引入 `spring-boot-starter-webflux`。

`api-key` 是必需属性。缺失时模型 bean 无法创建，问题应该在启动阶段暴露，不要等到第一次业务请求才发现。密钥通过环境变量或配置中心注入，不写进仓库。

### 3.1 自动配置做了什么

引入 starter 后，自动配置按 classpath 和属性创建 `OpenAiApi`、`OpenAiChatModel`、`OpenAiEmbeddingModel` 和 `ChatClient.Builder`。业务代码不需要自己 new 这些对象。

自动配置的取舍是：**默认只允许一个聊天模型参与构建 `ChatClient.Builder`。** 需要同时使用多个厂商时，先关闭客户端自动配置，再手动定义 bean：

```properties
spring.ai.chat.client.enabled=false
```

```java
@Configuration
class MultiModelConfig {

    @Bean
    ChatClient fastChatClient(OpenAiChatModel model) {
        return ChatClient.create(model);
    }

    @Bean
    ChatClient reasoningChatClient(AnthropicChatModel model) {
        return ChatClient.create(model);
    }
}
```

注入时用 `@Qualifier` 区分。不要指望框架按方法名自动选择模型。

## 4. 能力地图

Spring AI 1.1.x 提供的能力，以及本知识库中对应的章节：

| 能力 | 关键抽象 | 适用场景 | 深入阅读 |
| :-- | :-- | :-- | :-- |
| 同步与流式对话 | `ChatClient`、`ChatModel` | 问答、摘要、改写 | [ChatClient 与调用链](./chapter-02-chat-client.md) |
| 结构化输出 | `entity()`、`StructuredOutputConverter` | 抽取字段、生成待审草稿 | [提示词与结构化输出](./chapter-03-prompt-and-structured-output.md) |
| 对话记忆 | `ChatMemory`、`ChatMemoryRepository` | 多轮对话、客服会话 | [对话记忆](./chapter-04-chat-memory.md) |
| 检索增强 | `VectorStore`、`Advisor` | 基于内部文档问答 | [RAG 与向量存储](./chapter-05-rag-and-vector-store.md) |
| 工具调用 | `@Tool`、`ToolCallback` | 查实时数据、触发业务动作 | [工具调用](./chapter-06-tool-calling.md) |
| MCP 接入 | MCP Client/Server Starter | 复用外部工具生态 | [MCP 集成](./chapter-07-mcp.md) |
| 可观测与评估 | Micrometer 观测、`Evaluator` | 上线监控、质量回归 | [可观测性与评估](./chapter-08-observability-and-evaluation.md) |
| 图像、语音、审核 | `ImageModel`、`TranscriptionModel` 等 | 生成图片、转写音频 | 按厂商文档使用，本库不展开 |

多模态输入属于对话能力的一部分：`UserMessage` 可以同时携带文本和 `Media`，通过 `MimeType` 区分图片、音频等类型。

## 5. 什么时候不该用它

以下情况，引入 Spring AI 会增加维护成本：

- **只需要一次性的脚本调用。** 直接发 HTTP 请求更简单，不需要抽象层。
- **模型服务在同一个 JVM 内。** 本地推理有专门的运行时和部署方式，Spring AI 的定位是远程模型客户端。
- **需要复杂、可持久化的 Agent 工作流。** Spring AI 提供工具调用和 Advisor 链，但不做长时间运行的状态机与人工审批编排，这类需求需要额外的流程引擎或工作流框架。
- **团队已经在用其他 AI 框架且运转良好。** 引入第二套抽象只会增加认知负担。

## 6. 与 LangChain4j、手写 HTTP 的取舍

这是作者基于工程经验的判断，不是普遍规律：

| 维度 | Spring AI | LangChain4j | 手写 HTTP |
| :-- | :-- | :-- | :-- |
| 与 Spring Boot 集成 | 自动配置、starter、属性体系一致 | 有 Spring Boot 集成模块 | 自己装配 |
| 抽象覆盖范围 | 聊天、嵌入、图像、语音、向量库、MCP | 更偏 Agent、链式编排和工具 | 取决于你写多少 |
| 迁移成本 | 换厂商主要改 starter 和选项 | 换厂商改 `ChatLanguageModel` 实现 | 全量重写 |
| 透明度 | 中，需要读自动配置 | 中 | 高 |
| 适合的团队 | 已有 Spring 技术栈、需要长期维护 | 需要更多内置 Agent 能力 | 调用点很少、要求完全可控 |

选择框架时先确定三件事：模型是否会更换、是否需要检索和工具、团队是否能维护这层抽象。三个问题的答案比框架的功能列表更有决定作用。

## 7. 常见误解

- **「`ChatClient` 是厂商 SDK 的包装。」** 它是对 `ChatModel` 的编排层，真正的厂商协议在 `ChatModel` 实现里。
- **「向量库会生成向量。」** 不会。`VectorStore` 只存文本、向量和元数据，向量由 `EmbeddingModel` 生成，模型换了维度就必须重建索引。
- **「用了 MCP 就等于有了 RAG。」** MCP 负责工具和资源的协议接入，检索质量取决于数据是否已经向量化、分块是否合理。
- **「`maxTokens` 越大回答越好。」** 它只限制输出上限，可能截断答案，也会按输出计费。
- **「框架会自动处理超时和重试。」** 超时来自 HTTP 客户端和模型侧配置，重试需要自己定义幂等边界；不要对可能已经计费的请求盲目重试。

## 8. 与 2.0 的差异

如果项目已经升级到 Spring Boot 4，可以直接使用 Spring AI 2.0.x；仍在 Boot 3.x 的项目应停留在 1.1.x。两条线在以下位置不兼容：

| 主题 | 1.1.x | 2.0.x |
| :-- | :-- | :-- |
| Spring Boot | 3.4.x、3.5.x | 4.0.x、4.1.x |
| 厂商配置项 | `spring.ai.openai.chat.options.model` | `spring.ai.openai.chat.model` |
| 工具执行 | `ChatModel` 内部自动完成工具调用循环 | 内部循环移除，由 `ToolCallingAdvisor` 承担 |
| 选项对象 | `.options(OpenAiChatOptions)` 可传实例 | 必须传 builder，选项不可变 |
| 会话 ID | 必填，缺失抛异常 | 同样必填，且删除默认常量与 `.conversationId()` |
| 向量库 Advisor | `spring-ai-advisors-vector-store` | 重命名为 `spring-ai-vector-store-advisor` |
| MCP 注解包 | `org.springaicommunity.mcp.annotation` | `org.springframework.ai.mcp.annotation` |

升级时最容易遗漏的两点：`ChatClient` 在 2.0 会自动注册 `ToolCallingAdvisor`，手动再加会重复执行；默认 temperature 不再强制 0.7，沿用旧行为需要显式设置。

## 小结

- Spring AI 提供可替换的模型抽象和请求编排，不提供模型能力本身。
- 版本必须与 Spring Boot 成对选择：1.1.x 配 Boot 3.4/3.5，2.0.x 配 Boot 4.0/4.1。
- 最小可用路径是：BOM + 厂商 starter + `ChatClient.Builder` + `call().content()`。
- 真正的工程问题在提示词、检索、工具和可观测性，后续章节依次展开。
