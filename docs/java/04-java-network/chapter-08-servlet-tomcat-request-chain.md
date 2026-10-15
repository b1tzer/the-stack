# Servlet 与 Tomcat 请求链

> Controller 中的一次 `userService.findById(id)` 调用，背后涉及 Spring MVC、Servlet 和 Tomcat 的多个处理层次。线上出现 `Broken pipe` 或 `Connection reset by peer` 时，仅凭异常名称往往无法判断连接在哪个阶段被关闭。这一章从你每天在写的 Controller 出发，沿 Servlet、Tomcat Container 和 Connector 向下梳理请求处理链。

> **版本说明**：本章以传统 Servlet 请求处理模型和 Tomcat NIO Connector 为主线，重点解释请求分派、连接管理与线程池的关系。示例代码中的 Servlet API 命名空间应与所用 Spring Boot、Spring Framework 和 Tomcat 版本保持一致：Spring Boot 2.x 及更早使用 `javax.servlet`，Spring Boot 3.x / Spring Framework 6.x 使用 `jakarta.servlet`。Tomcat 的参数默认值、线程模型实现细节及虚拟线程支持以对应版本的官方文档为准，本章的调用链是用于理解请求处理过程的简化模型，不代表所有协议、异步请求和连接复用场景都具有完全相同的执行顺序。

> **📖 阅读建议**：如果你正在排查问题，可以从遇到的那层开始读。先确认请求是否进入 Servlet，再检查 Tomcat 的 Container 路由、Connector 协议解析和 Worker 线程状态。

## 1. 请求如何进入 Java Web 层

先看最熟悉的一层，一段典型的 Controller 代码：

```java
@RestController
@RequestMapping("/api/users")
public class UserController {

    @GetMapping("/{id}")
    public User getUser(@PathVariable Long id) {
        return userService.findById(id);
    }
}
```

这段 Controller 代码运行时涉及 Spring MVC、Servlet 和 Tomcat 的多个处理层次，可拆成下面七个观察层次。每一层都可能在某个特定场景下出问题：

```txt
@GetMapping("/api/users/1")
│
├─ 第 1 层：Spring MVC 框架         ← 你现在的位置
│     @GetMapping → HandlerMapping → HandlerAdapter → Controller 方法
│
├─ 第 2 层：DispatcherServlet       ← Spring MVC 的"前台"
│     继承链 → 自动注册 → service() 入口
│
├─ 第 3 层：Servlet 规范            ← Java Web 的基石
│     HttpServlet 方法分发 → 生命周期 → Filter 链
│
├─ 第 4 层：Tomcat Container       ← 请求路由
│     Engine → Host → Context → Wrapper
│
├─ 第 5 层：Tomcat Connector       ← 协议解析
│     Endpoint → ProtocolHandler → CoyoteAdapter
│
├─ 第 6 层：Tomcat NIO 线程模型     ← 线程在哪
│     Acceptor → Poller → Worker(线程池)
│
└─ 第 7 层：Socket                 ← 字节流
      TCP 连接 → read()/write() → 四次挥手
```

下面从 Servlet 规范开始，一层层向下拆。

Spring MVC 的 `doDispatch()`、参数解析和返回值序列化属于框架层，见 [Spring MVC](../../spring/03-web/chapter-01-spring-mvc.md)。本章从 `DispatcherServlet` 之下的 Servlet 规范开始，继续向下拆到 Tomcat 和 Socket。

## 2. Servlet 规范：Java Web 的执行契约

Spring MVC 再强大，也跑在 Servlet 之上。Spring Boot 只是替你做了 Servlet 注册和配置，底层运行的仍然是 Servlet API（Spring Boot 2.x 为 `javax.servlet`，3.x 起为 `jakarta.servlet`）定义的接口和生命周期。

### 2.1 HttpServlet 如何按 HTTP 方法分发

HttpServlet 继承自 GenericServlet，是处理 HTTP 请求的常见 Servlet 基类。它做的事情是——按 HTTP 方法分派到不同的处理方法：

```java
public abstract class HttpServlet extends GenericServlet {

    @Override
    protected void service(HttpServletRequest req, HttpServletResponse resp)
            throws ServletException, IOException {
        String method = req.getMethod();

        switch (method) {
            case "GET":    doGet(req, resp);    break;
            case "POST":   doPost(req, resp);   break;
            case "PUT":    doPut(req, resp);    break;
            case "DELETE": doDelete(req, resp); break;
            // 真实实现还处理 HEAD、OPTIONS、TRACE 等方法，这里是简化示意
        }
    }
}
```

HttpServlet 根据 HTTP 方法调用对应的 `doGet()`、`doPost()` 等方法，Spring MVC 在这一层之上提供了更灵活的处理器映射。`@GetMapping("/users/{id}")` 声明了路径和方法的匹配条件，请求进入 `DispatcherServlet` 后，Spring MVC 通过 `HandlerMapping` 找到匹配的处理器，再由 `HandlerAdapter` 调用 Controller 方法。两者处于不同抽象层，前者负责 Servlet 层的 HTTP 方法分发，后者负责把请求映射到应用处理器，不是同一个 `switch-case` 的直接转换。

### 2.2 Servlet 生命周期：什么时候创建，怎么被销毁

每个 Servlet 在 Tomcat 中的一生只有三个时刻：

```java
public interface Servlet {
    void init(ServletConfig config);   // 一生一次
    void service(ServletRequest req, ServletResponse res);  // 每请求一次
    void destroy();                    // 一生一次
}
```

| 阶段 | 触发时机 | 需要注意的事项 |
| :-- | :-- | :-- |
| `init()` | 容器创建 Servlet 实例后、处理请求前调用，具体时机受 `load-on-startup` 配置影响 | 初始化该 Servlet 所需的资源 |
| `service()` | 每次请求分派给 Servlet 时调用 | 同一实例可能被多个线程并发调用 |
| `destroy()` | 容器移除 Servlet 前调用 | 释放该 Servlet 自己管理的资源 |

Servlet 规范不保证 `init()` 和 `destroy()` 运行在某个固定名称或角色的线程上。Spring Boot 会自动配置 `DispatcherServlet`，但这不意味着所有 Spring 上下文和连接池都由它直接初始化和关闭，资源关闭取决于应用上下文层级与生命周期配置。

Tomcat 通常不会为每个请求创建新的 `DispatcherServlet` 实例，而是让多个请求共享同一个实例，由不同 Worker 线程并发调用。问题不在 `service()` 本身，而在于多个请求并发访问同一份可变状态。下面的代码存在竞态条件：

```java
// ❌ Servlet 里写实例字段 = 数据错乱
public class BadServlet extends HttpServlet {
    private String currentUser;  // 多个请求共享，必乱

    protected void doGet(HttpServletRequest req, HttpServletResponse resp) {
        currentUser = req.getParameter("user");  // 线程A设"小明"
        // 线程B设"小红"——线程A再读 currentUser 已经变成了"小红"
    }
}

// ✅ 请求状态放在方法局部变量中
```

请求专属的数据通常应放在方法局部变量中。确实需要 `ThreadLocal` 时，还必须考虑线程复用、清理时机，以及异步执行时请求状态跨越线程的传递问题，它不能直接替代跨异步阶段的上下文传递。

### 2.3 Filter 链：请求在进入 Servlet 之前经过了什么

Filter 运行在 Servlet 之前——它比 Spring 的拦截器更底层，在 Tomcat 调用 `Servlet.service()` 之前就已经执行了。每个请求都要穿过 Filter 链才能到达 Servlet：

```txt
HTTP Request 到达 Tomcat
│
├─ Filter 1: CharacterEncodingFilter  → 设置请求/响应编码为 UTF-8
├─ Filter 2: CorsFilter              → 处理跨域头（Access-Control-Allow-Origin）
├─ Filter 3: SpringSecurityFilterChain → 认证与授权
│
├─ DispatcherServlet.service()
│   └─ doDispatch()
│       ├─ 拦截器 preHandle
│       ├─ Controller 方法
│       └─ 拦截器 postHandle
│
├─ 响应回到 Filter 链（反向）
```

| 对比维度 | Filter（Servlet 层） | HandlerInterceptor（Spring MVC 层） |
| :-- | :-- | :-- |
| 作用范围 | 所有请求，包括静态资源 | 只拦截进入 DispatcherServlet 的请求 |
| 能拦截什么 | 请求/响应的原始字节流 | Controller 方法前后 |
| 配置方式 | `@WebFilter` 或 `FilterRegistrationBean` | `addInterceptors()` 或 `@Configuration` |
| 典型用途 | 编码、CORS、安全认证 | 日志、权限校验、性能统计 |

### 2.4 Servlet 异步：请求不一定占着线程

上面的章节描绘了"一个请求 = 一条 Worker 线程"的完整路径。大多数场景这个模式没问题——Response 写完，线程归还。但有一种情况例外：

```java
@GetMapping("/order/{id}")
public Order getOrder(@PathVariable Long id) {
    Order order = orderService.findById(id);           // 远程调用，500ms
    User user = userService.getUser(order.getUserId()); // 远程调用，800ms
    return enrichOrder(order, user);
}
// Worker 线程被阻塞 1.3 秒 —— 期间它什么都没做，就是等
```

两个远程调用串行耗时 1.3 秒，Worker 线程全程被占用。如果 200 个 Worker 线程全被这种"等下游"的请求占着，新的快速请求（比如 10ms 的健康检查）也进不来——这就是线程饥饿。

Servlet 3.0 引入的 `AsyncContext` 允许 Worker 线程在处理请求中途**主动归还**线程池：

```java
@GetMapping("/order/{id}")
public Callable<Order> getOrder(@PathVariable Long id) {
    return () -> {
        // 这段代码由 Spring MVC 配置的异步执行器（AsyncTaskExecutor）执行
        Order order = orderService.findById(id);
        User user = userService.getUser(order.getUserId());
        return enrichOrder(order, user);
    };
}

// 实际发生了什么：
// 1. Tomcat 请求处理线程进入 DispatcherServlet，执行 Controller 方法，得到 Callable
// 2. Spring MVC 启动 Servlet 异步处理，把 Callable 提交给 AsyncTaskExecutor
// 3. 当前请求处理线程退出这次分派，不再一直等待 Callable 完成
// 4. 执行器中的线程运行 Callable（阻塞式远程调用仍会占用这条执行器线程）
// 5. 任务完成后，Spring MVC 通过 Servlet 异步分派继续处理结果并完成响应
```

**关键差异**：异步处理减少了请求等待期间对 Tomcat 请求处理线程的占用，但不会消灭等待，也不提高下游处理能力。Callable 里的阻塞式远程调用仍会占用执行它的线程，如果异步执行器也被慢调用占满，请求照样排队或失败。因此需要为异步执行器配置合理的容量、超时和拒绝策略，并监控任务排队与执行时间。

WebFlux 提供了基于响应式编程的 Web 处理模型，适合能让主要 I/O 链路保持非阻塞的应用，但需要把命令式代码改成 `Mono`/`Flux`，调试和排查成本更高。JDK 21 虚拟线程则允许应用继续使用阻塞式写法，同时降低大量阻塞任务对平台线程数量的压力。两者都不能消除下游容量限制，也不能替代超时、限流和资源池管理。

## 3. Tomcat Container：请求如何在容器内路由

Filter 和 Servlet 处理的都是 `HttpServletRequest` 对象。这个对象穿过 Filter 链后，要路由到具体的 Servlet。做这件事的是 **Container**。

### 3.1 Connector 创建对象，Container 负责路由

Tomcat 的架构只分两块，职责边界非常清晰：

```txt
┌─────────────────────────────────────────────────────────────┐
│                      Tomcat                                  │
│                                                              │
│  ┌─────────────────────┐    ┌────────────────────────────┐  │
│  │     Connector        │    │       Container             │  │
│  │                      │    │                              │  │
│  │  职责:               │    │  职责:                       │  │
│  │  - 监听端口          │───▶│  - 根据 URL 找到对应的 Servlet│  │
│  │  - 解析 HTTP 协议     │    │  - 执行 Filter 链            │  │
│  │  - 构造 Request 对象  │    │  - 调用 Servlet.service()   │  │
│  │  - 管理连接与线程     │    │  - 管理 Session             │  │
│  └─────────────────────┘    └────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

Connector 负责网络连接和协议处理，并把解析后的请求适配为 Servlet 容器能处理的对象；Container 负责应用层的请求分派，包括匹配虚拟主机、Web 应用和目标 Servlet，以及执行相应的容器管线。两者职责不同，但通过 `CoyoteAdapter` 等适配层紧密协作，并非彼此独立。这一节只看 Container，Connector 见下文“Tomcat Connector：字节流如何变成 HttpServletRequest”。

### 3.2 四层嵌套，逐级找到你的 Servlet

Container 按四层嵌套结构，逐级找到该处理这个请求的 Servlet：

```txt
Server (Tomcat 进程)
 └── Service (Connector + Container 的绑定)
      ├── Connector
      └── Engine (请求路由引擎)
           └── Host (虚拟主机，按 Host 头匹配)
                └── Context (Web 应用，按 URL 路径前缀匹配)
                     └── Wrapper (单个 Servlet 的包装)
```

| 层级 | 匹配依据 | 例子 |
| :-- | :-- | :-- |
| Engine | 标准配置下每个 Service 一个 Engine | Catalina |
| Host | HTTP 请求头 `Host` | `api.example.com`、`www.example.com` |
| Context | URL 路径前缀 | `/myapp`、`/api` |
| Wrapper | Servlet 映射规则 | `/users/*` → `UserServlet` |

请求从 Engine 开始，逐级往下调：

```java
// 简化版调用链
engine.invoke(request, response)
  → host.invoke(request, response)       // 找出匹配的 Host
    → context.invoke(request, response)  // 找出匹配的 Context
      → wrapper.invoke(request, response) // 找到具体的 Servlet
        → filterChain.doFilter(request, response)
          → servlet.service(request, response)
```

容器各层可通过相应的 Pipeline/Valve 扩展点插入处理逻辑，Valve 是 Tomcat 特有的扩展机制，并非 Engine、Host、Context、Wrapper 四个对象各自都必须安装一个。最常见的扩展点是 Context 层，Spring Boot 就是在这里注册 `DispatcherServlet` 的。

## 4. Tomcat Connector：字节流如何变成 HttpServletRequest

Container 处理的都是 `HttpServletRequest`。但这个对象不是凭空生成的——Tomcat 先要从 Socket 里读出原始 HTTP 字节流，解析请求行、请求头、请求体，才能构造成一个对象。

做这件事的是 **Connector**。Connector 内部三道工序：

```txt
Socket 收到字节流
│
▼
┌─────────────────────┐
│  Endpoint           │  监听端口，accept() 连接，从 Socket 读字节
│  实现：NioEndpoint   │
└────────┬────────────┘
         │ byte[]
         ▼
┌─────────────────────┐
│  ProtocolHandler     │  解析 HTTP 协议字节流
│  实现：Http11Protocol │  拆出：请求行、请求头、请求体
│                      │  产出：org.apache.coyote.Request
└────────┬────────────┘
         │ Coyote Request
         ▼
┌─────────────────────┐
│  CoyoteAdapter       │  把 Tomcat 内部 Request 对象
│                      │  适配成 javax.servlet.http.HttpServletRequest
└─────────────────────┘
         │ HttpServletRequest
         ▼
   Container → Filter Chain → Servlet.service()
```

**三个组件各司其职**：Endpoint 管连接（NIO Selector、accept、read/write），ProtocolHandler 管协议（如 HTTP/1.1 的 `Http11Protocol`），CoyoteAdapter 管适配（把 Tomcat 内部对象翻译成 Servlet 规范对象）。这种分层便于分别理解连接管理、协议处理和 Servlet 适配，但不能据此推断更换其中一个组件就一定不影响其他组件，具体流程取决于 Tomcat 版本、Connector 实现和所使用的协议。HTTP/2 的处理路径也不能直接等同于 HTTP/1.1 的 `Http11Protocol`。

## 5. Tomcat 线程模型：请求在哪个线程上执行

你已经知道请求经过 DispatcherServlet → Servlet 规范 → Container 路由 → Connector 解析。但还有一个关键问题：**整个链路中，代码在哪个线程上执行的？谁创建了这个线程？一个线程能同时处理几个请求？**

### 5.1 NIO Connector 的主要线程角色

Tomcat 8.5 起默认使用 NIO。网络 I/O 的"等待"和业务逻辑的"执行"分离到几个线程角色上：

```txt
                         ┌──────────────────────┐
                         │   ServerSocketChannel │
                         │   (监听 8080 端口)     │
                         └──────────┬───────────┘
                                    │
                    ┌───────────────▼───────────────┐
                    │         Acceptor 线程 (1个)     │
                    │  accept() 接受新连接            │
                    │  设为非阻塞模式                  │
                    │  注册到 Poller                  │
                    └───────────────┬───────────────┘
                                    │
                    ┌───────────────▼───────────────┐
                    │      Poller 线程（数量随版本配置变化）│
                    │  selector.select() 轮询 I/O 事件 │
                    │  有可读事件 → 封装 SocketProcessor │
                    └───────────────┬───────────────┘
                                    │ 提交到线程池
                    ┌───────────────▼───────────────┐
                    │      Worker 线程池 (maxThreads)  │
                    │  读请求 → 解析 HTTP → 调 Servlet │
                    │  → 你的 Controller 代码在这里执行 │
                    │  → 写响应 → 归还线程到池          │
                    └───────────────────────────────┘
```

**关键事实**：在传统的同步请求处理中，Controller 通常运行在 Tomcat 的请求处理线程上。Acceptor 接受新连接，Poller 处理连接的 I/O 事件，请求处理执行器运行相应的处理任务。这里的 Worker 是便于理解的称呼，实际线程名称、任务分派细节和执行器配置会随 Tomcat 版本与配置变化。启用 Servlet 异步处理后，请求处理线程可以提前退出当前分派；使用虚拟线程执行器时，线程模型也会不同。排查时应结合线程转储、Tomcat JMX 指标和实际执行器配置判断，而不是只凭线程名称推断请求所处阶段。

### 5.2 线程池参数：线上排查的核心依据

```xml
<!-- server.xml 配置 -->
<Connector port="8080"
           protocol="org.apache.coyote.http11.Http11NioProtocol"
           maxThreads="200"
           maxConnections="8192"
           acceptCount="100"
           connectionTimeout="20000" />
```

| 参数 | 准确含义 | 排查时重点观察 |
| :-- | :-- | :-- |
| `maxThreads` | 请求处理执行器的最大平台线程数，具体行为受执行器配置影响 | 当前线程数、忙碌线程数、请求耗时、线程栈 |
| `maxConnections` | Connector 可同时接受和处理的连接数上限，不是并发请求数的同义词 | 连接数、Keep-Alive 连接、JMX 指标 |
| `acceptCount` | 连接数达到上限时，操作系统提供的待接入连接队列的配置值 | 连接建立延迟、拒绝与超时、监听队列状态 |
| `connectionTimeout` | 等待请求行等连接阶段数据的超时配置，语义随协议与版本变化 | 客户端超时位置、慢连接、服务端连接状态 |

`acceptCount` 不是 Tomcat 自己的请求队列长度，不能简单等同于待处理 HTTP 请求数。当连接数达到 `maxConnections` 后，Tomcat 停止继续正常处理更多连接，操作系统可能仍完成部分连接接入并把连接请求排队，队列满时新连接可能被拒绝或超时。`connectionTimeout` 与整体请求延迟也不是同一个指标，不能把 P99 延迟是否接近该值当成诊断规则。

**一次典型的线程池满排查**：

```bash
# 1. 保存完整线程转储，避免只看线程名称
jcmd <pid> Thread.print > thread-dump.txt

# 2. 查看 Tomcat 请求处理线程的状态和调用栈
grep -n -A 30 'catalina-exec' thread-dump.txt

# 3. 结合调用栈检查常见等待位置
# 数据库连接池获取连接、JDBC 执行或读取结果、HTTP 客户端调用
# synchronized 竞争、Future.get / CountDownLatch.await 等待
```

这里的命令是辅助检查，不能自动识别"阻塞最多的方法"：`BLOCKED` 只表示线程等待进入监视器锁，大量线程在 `WAITING` 或 `TIMED_WAITING` 状态等待数据库连接、Socket I/O 或线程池任务时，不一定会被该命令统计出来。真正的判断需要结合线程状态、调用栈、重复采样和线程池监控数据。

排查时先确认瓶颈在哪：是计算、锁竞争还是下游等待。需要区分三类情况——Tomcat 请求处理线程是否达到容量上限、线程是否因锁竞争或下游等待而无法完成任务、下游资源池是否先于 Tomcat 饱和。这三类处置方式不同，只有确认瓶颈位于 Tomcat 执行器容量时，才有理由讨论调整线程数，而不是机械地"调大超时或加机器"，前者可能延长线程占用，后者可能把压力转移给已经饱和的下游。

### 5.3 BIO 时代 vs NIO 时代

Tomcat 7 默认使用 BIO，BIO Connector 的典型处理方式是为连接分配专用处理线程，因此大量空闲长连接也可能占用大量线程资源。NIO Connector 则把连接管理和请求处理分开：连接由 Poller 等机制监测 I/O 事件，不必始终为每条空闲连接占用一个请求处理线程，只有需要执行请求处理任务时才需要相应的执行线程：

```txt
BIO Connector (Tomcat 7 默认):   连接 ←→ 线程  1:1，空闲连接也占线程
NIO Connector (Tomcat 8.5 起默认): 连接 ←→ Worker  N:1，只有活跃的请求分配线程
```

线程栈的实际内存占用受 JVM 配置、操作系统和线程实际使用情况影响，不能简单把每条线程等同于固定占用 1MB 物理内存。这种变化提高了处理大量空闲连接时的资源利用率，但并不意味着 NIO 能让请求处理线程无限扩展，请求处理能力仍受执行器容量、下游资源和应用处理时间的限制。

版本方面应以对应 Tomcat 版本的官方配置文档为准，区分默认 Connector 与可选 Connector，不要把某个版本的默认配置当成所有部署的固定行为。

## 6. 全链路回看

把七层抽象串起来看一个请求的旅程。下图展示的是传统 Tomcat NIO Connector 处理一个同步 HTTP/1.1 请求的简化路径，不包含 TLS 握手、异步分派、错误处理和连接复用等分支：

```txt
客户端发起 GET /api/users/1
│
├─ OS 层：TCP 三次握手建立连接 → SYN, SYN+ACK, ACK
│
├─ Tomcat Acceptor 线程：accept() 拿到新连接 → 注册到 Poller
│
├─ Tomcat Poller 线程：selector.select() 检测到可读事件
│   → 提交 SocketProcessor 到 Worker 线程池
│
├─ Tomcat Worker 线程：从 Socket Channel 读字节
│   ┌─ ProtocolHandler：解析 HTTP 请求行和请求头
│   └─ CoyoteAdapter：封装成 HttpServletRequest
│
├─ Tomcat Container：Engine → Host → Context → Wrapper
│   → 找到 DispatcherServlet
│
├─ Filter Chain：编码 → CORS → Security
│
├─ DispatcherServlet.doDispatch()
│   ├─ HandlerMapping：URL "/api/users/1" → UserController.getUser()
│   ├─ HandlerAdapter + ArgumentResolver：@PathVariable id = 1
│   ├─ Controller：userService.findById(1) → User(id=1, name="张三")
│   └─ ReturnValueHandler + Jackson：User → {"id":1,"name":"张三"}
│
├─ Response 字节流原路返回：Jackson 写 response.getOutputStream()
│   → CoyoteAdapter → ProtocolHandler → Socket Channel.write()
│
└─ OS 层：TCP 四次挥手关闭连接（或 Keep-Alive 复用）
```

定位故障时，先确定请求是否到达某个阶段，再检查对应组件的日志和运行指标，不要凭单个错误字符串直接下结论：`Connection reset` 表示连接被重置，需要结合客户端、代理和服务端日志判断发生位置；HTTP 500 表示服务端返回了错误状态，原因可能在应用处理、异常映射或其他服务端组件；503 也不能直接判定为线程池耗尽，应结合响应来源、Tomcat 指标和应用日志定位。
