---
type: explanation
level: intermediate
---

# MCP 集成

> 本文以 Spring AI 1.1.x 为准。1.1.x 的 MCP 注解位于 `org.springaicommunity.mcp.annotation` 包，2.0 起迁移到 `org.springframework.ai.mcp.annotation`，同时 MCP Java SDK 升级到 2.0，升级时需要改包名和坐标。

MCP（Model Context Protocol）是一个让模型访问外部工具和资源的协议标准。它解决的问题不是「怎么让模型调用函数」——这件事工具调用已经能做——而是「工具由别人实现、部署在别的进程里，怎么接进来」。

在 Spring AI 里，`@Tool` 定义本应用的工具，MCP 定义跨进程的工具。两者最终都变成 `ToolCallback` 交给 `ChatClient`，区别在部署边界、运维方式和权限模型。

## 1. 角色与传输

MCP 采用客户端/服务端模型：

| 角色 | 职责 | 在 Spring AI 中的形态 |
| :-- | :-- | :-- |
| Server | 暴露工具、资源、提示模板 | 独立进程或独立服务，可用 starter 直接构建 |
| Client | 连接 Server，发现并调用能力 | 应用内的连接器，把工具转成 `ToolCallback` |
| Host | 承载模型和对话的应用程序 | 你的 Spring Boot 应用，同时是 Client |

Spring AI 支持的传输方式：

| 传输 | 适用场景 | 特点 |
| :-- | :-- | :-- |
| STDIO | 本地子进程 | 由客户端启动服务进程，配置即代码 |
| SSE | 兼容旧实现的 HTTP 推送 | 需要拆分的 URL 结构，容易配错 |
| Streamable HTTP | 远程服务（推荐） | 有状态、可流式 |
| Stateless Streamable HTTP | 无状态远程服务 | 便于水平扩展，不保存会话 |

命名上容易混淆：`spring-ai-starter-mcp-server` 只提供 STDIO，HTTP 传输需要 `spring-ai-starter-mcp-server-webmvc` 或 `spring-ai-starter-mcp-server-webflux`，再用 `spring.ai.mcp.server.protocol` 选择 `SSE`、`STREAMABLE` 或 `STATELESS`。

## 2. 编写 MCP 服务端

以 WebMVC 传输为例：

```xml
<dependency>
  <groupId>org.springframework.ai</groupId>
  <artifactId>spring-ai-starter-mcp-server-webmvc</artifactId>
</dependency>
```

```yaml
spring:
  ai:
    mcp:
      server:
        name: weather-server
        version: 1.0.0
        protocol: STREAMABLE
```

工具用注解声明：

```java
@Service
class WeatherTools {

    @McpTool(description = "查询指定城市当前天气，返回温度与天气状况")
    String currentWeather(
            @McpToolParam(description = "城市名，例如杭州") String city) {
        return weatherClient.query(city);
    }

    @McpTool(description = "查询未来三天的天气预报")
    List<DailyForecast> forecast(
            @McpToolParam(description = "城市名") String city,
            @McpToolParam(description = "天数，1 到 3", required = false) Integer days) {
        return weatherClient.forecast(city, days == null ? 3 : days);
    }
}
```

服务端注解有四个：`@McpTool`、`@McpResource`、`@McpPrompt`、`@McpComplete`。工具参数会自动生成 JSON Schema，因此描述和必填性同样影响模型行为，规则与 `@Tool` 一致。

服务端方法可以注入 MCP 特有的参数类型，例如 `McpSyncServerExchange`、`McpTransportContext`、`McpMeta`，用来读取请求上下文和元数据。这类参数不会出现在工具的 JSON Schema 里，模型看不到。

选择 STDIO 还是 HTTP：

- **STDIO** 适合把服务端和客户端部署在同一台机器、由客户端管理生命周期的场景。
- **HTTP** 适合服务端独立部署、多客户端共享的场景。生产环境优先选 Streamable HTTP，SSE 属于兼容路径。

## 3. 接入 MCP 客户端

```xml
<dependency>
  <groupId>org.springframework.ai</groupId>
  <artifactId>spring-ai-starter-mcp-client</artifactId>
</dependency>
```

一个 starter 可以同时连多个 Server，每个连接对应一个独立的 MCP Client 实例。客户端类型（`SYNC` 或 `ASYNC`）全局统一，不能混用。

```yaml
spring:
  ai:
    mcp:
      client:
        type: SYNC
        request-timeout: 20s
        streamable-http:
          connections:
            weather:
              url: http://localhost:8081
              endpoint: /mcp
        sse:
          connections:
            legacy:
              url: http://localhost:8082
              sse-endpoint: /mcp/sse
        stdio:
          connections:
            filesystem:
              command: npx
              args: ["-y", "@modelcontextprotocol/server-filesystem", "/data"]
```

自动配置会把所有连接的工具聚合成一个 `ToolCallbackProvider`：

```java
@Configuration
class McpChatConfig {

    @Bean
    ChatClient chatClient(ChatClient.Builder builder, SyncMcpToolCallbackProvider mcpTools) {
        return builder.defaultTools(mcpTools).build();
    }
}
```

也可以只在需要的请求里挂载：

```java
String answer = chatClient.prompt()
        .user("杭州今天适合跑步吗？")
        .toolCallbacks(mcpTools.getToolCallbacks())
        .call()
        .content();
```

两种方式的取舍与普通工具一致：`defaultTools` 让所有请求都能看到全部 MCP 工具，范围大、风险高；按请求挂载更精确，但需要业务代码知道有哪些工具。

`spring.ai.mcp.client.toolcallback.enabled=false` 会关闭 Provider 的自动创建，适用于只需要直接使用 `McpSyncClient`、不打算交给模型的场景。

### 3.1 会话与超时

`request-timeout` 默认 20 秒。远程工具里如果有耗时操作，要么调大超时，要么把操作改成异步并返回任务 ID，不要让对话请求长时间挂起。

客户端还支持 `McpSyncClientCustomizer`、`McpAsyncClientCustomizer` 定制连接参数、Roots、Sampling、Elicitation、进度通知和各类事件监听。需要读取服务端日志或处理工具列表变更时，从这里接入。

## 4. 多服务端的工具名冲突

多个 Server 都提供名为 `search` 的工具时，直接聚合会冲突。默认实现 `DefaultMcpToolNamePrefixGenerator` 的处理规则：

- 非字母数字字符替换为下划线。
- 首次出现的名字保持原样。
- 同名工具按连接顺序加前缀，例如 `alt_1_search`、`alt_2_search`。
- 名称超过 64 字符时从头部截断。

显式使用 `noPrefix()` 且存在重名时，会抛 `IllegalStateException`。多 Server 场景保留默认行为更安全。

前缀会改变模型看到的工具名。如果提示词或日志里硬编码了工具名，升级或新增连接后可能失配。

## 5. 工具过滤

不是所有 MCP 工具都该暴露给模型。`McpToolFilter` 可以按连接信息或工具属性过滤：

```java
@Component
class DenyExperimentalTools implements McpToolFilter {

    @Override
    public boolean test(McpConnectionInfo connection, McpSchema.Tool tool) {
        if (tool.name().startsWith("admin_")) {
            return false;
        }
        return tool.description() == null
                || !tool.description().contains("experimental");
    }
}
```

容器里只能有一个 `McpToolFilter` bean。需要多条规则时，在一个实现里组合，否则自动配置无法决定用哪个。

过滤同时作用于同步和异步 Provider，属于服务端能力进入模型上下文的第一道闸门。

## 6. 安全边界

MCP 的安全模型还在完善，官方文档明确标注安全部分仍在开发中。以下边界需要应用自己负责：

- **STDIO 等于执行本地命令。** `command` 和 `args` 来自配置文件，绝不能由用户输入拼接。配置文件本身要按代码管理，走代码评审。
- **远程 MCP 服务要鉴权。** 连接 URL 里的 token 放在配置中心或环境变量中，不要出现在日志和错误信息里。
- **工具集合按最小权限暴露。** 面对终端用户的会话，不应挂载文件系统、数据库管理这类工具。
- **审计每次调用。** 记录服务端名、工具名、参数摘要、耗时。跨进程调用出问题时，没有日志几乎无法定位。
- **不要把 `servers-configuration` 指向可写目录。** 该 JSON 文件决定启动哪些进程，等价于启动脚本。

### 6.1 两个常见配置错误

**SSE 的 URL 拆分。** `url` 只保留 scheme、host、port，路径和查询参数全部放到 `sse-endpoint`：

| 完整地址 | `url` | `sse-endpoint` |
| :-- | :-- | :-- |
| `http://localhost:3000/mcp-hub/sse/token123` | `http://localhost:3000` | `/mcp-hub/sse/token123` |
| `https://api.example.com/v2/events?key=abc` | `https://api.example.com` | `/v2/events?key=abc` |

把完整地址写进 `url` 会得到 404，错误信息通常只说连接失败。

**Windows 上的 STDIO 命令。** `npx`、`node`、`python` 这类命令在 Windows 上是 `.cmd` 或 `.bat`，`ProcessBuilder` 无法直接执行，需要用 `cmd.exe /c` 包装：

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "cmd.exe",
      "args": ["/c", "npx", "-y", "@modelcontextprotocol/server-filesystem", "C:\\data"]
    }
  }
}
```

## 7. 排查清单

| 现象 | 检查点 |
| :-- | :-- |
| 启动时报连接失败 | 服务端是否已启动、URL 与端口、协议是否匹配 |
| 404 | SSE 的 `url` 是否包含了路径 |
| 工具列表为空 | `toolcallback.enabled`、`McpToolFilter`、服务端注解是否被扫描到 |
| 模型调用了不存在的工具 | 工具名是否被前缀改写、是否在默认工具集合里 |
| 调用超时 | `request-timeout`、服务端处理耗时、网络链路 |
| Windows 下进程起不来 | 是否用 `cmd.exe /c` 包装 |
| 工具重复注册 | 是否同时用了 `defaultTools` 和 `.tools()` |

## 8. 什么时候用 MCP

值得用的场景：

- 工具由独立团队、独立服务维护，通过协议解耦。
- 需要复用已有的 MCP 生态（文件系统、浏览器、数据库工具）。
- 多个 AI 应用要共享同一套工具。

不值得用的场景：

- 工具就在同一个应用里，`@Tool` 更简单，少一层进程和协议。
- 只需要几个只读查询，自己写 HTTP 客户端即可。
- 团队没有能力维护远程服务的鉴权、版本兼容和故障处理。

MCP 带来的是一层标准化的解耦，代价是多一个部署单元和一套协议约定。工具数量少、变化慢时，这层解耦没有回报。

## 小结

- MCP 是跨进程的工具协议，`@Tool` 是进程内工具，两者最终都变成 `ToolCallback`。
- 服务端按传输选 starter，用 `spring.ai.mcp.server.protocol` 切换 SSE 或 Streamable HTTP。
- 客户端自动聚合多服务端工具为 `SyncMcpToolCallbackProvider`，挂载方式与普通工具一致。
- 多服务端存在工具名冲突，默认前缀策略会改写模型看到的名称。
- STDIO 会启动本地进程，配置等同于代码，必须走评审和最小权限。
