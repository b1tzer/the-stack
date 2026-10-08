# Servlet 与 Tomcat 请求链

> 你每天写 `@GetMapping("/{id}")`，然后 `return userService.findById(id)`。哪天线上出了 Bug，日志里只有 `Broken pipe` 或 `Connection reset by peer`，连在哪一层报的都不确定。这一章从你每天在写的 Controller 出发，一层层往回拆：Spring MVC → Servlet → Tomcat → Socket——拆到你看到一个 HTTP 请求从网卡到代码的完整路径为止。

> **📖 阅读建议**：如果你正在排查问题，可以从遇到的那层开始读。先确认请求是否进入 Servlet，再检查 Tomcat 的 Container 路由、Connector 协议解析和 Worker 线程状态。

## 1. 请求如何进入 Java Web 层

这是你最熟悉的代码。每天写几十遍，闭着眼都能敲出来：

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

五行代码，但执行时经过了 **7 层抽象**。每一层都可能在某个特定场景下出问题：

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

Spring MVC 再强大，也跑在 Servlet 之上。Spring Boot 只是替你做了 Servlet 注册和配置，底层运行的仍然是 `javax.servlet` 定义的接口和生命周期。

### 2.1 HttpServlet 如何按 HTTP 方法分发

所有 Servlet 的老祖宗是 `javax.servlet.http.HttpServlet`。它做的事情非常朴实——按 HTTP 方法分派到不同的处理方法：

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
            // HEAD, OPTIONS, TRACE ...
        }
    }
}
```

这就是你熟悉的 `@GetMapping`、`@PostMapping` 注解的**物理起源**——Spring 把这个 `switch-case` 变成了注解层级的声明式分发。

### 2.2 Servlet 生命周期：什么时候创建，怎么被销毁

每个 Servlet 在 Tomcat 中的一生只有三个时刻：

```java
public interface Servlet {
    void init(ServletConfig config);   // 一生一次
    void service(ServletRequest req, ServletResponse res);  // 每请求一次
    void destroy();                    // 一生一次
}
```

| 阶段 | 触发时机 | 执行线程 | 典型操作 |
| :-- | :-- | :-- | :-- |
| `init()` | 容器启动或首次请求到达 | 容器主线程 | 加载 Spring 上下文、初始化 DispatcherServlet 策略组件 |
| `service()` | 每次 HTTP 请求 | Tomcat Worker 线程 | 进入 doDispatch()，执行 Controller 方法 |
| `destroy()` | 容器关闭 | 容器主线程 | 关闭 Spring 上下文、释放连接池 |

**`service()` 是线程不安全的**。Tomcat 里只有一个 `DispatcherServlet` 实例，所有请求由不同 Worker 线程并发调用它的 `service()`。这就是为什么 Servlet 中不该用实例变量存请求状态——线程 A 写到一半，线程 B 可能已经覆盖了：

```java
// ❌ Servlet 里写实例变量 = 数据错乱
public class BadServlet extends HttpServlet {
    private String currentUser;  // 多个请求共享，必乱

    protected void doGet(HttpServletRequest req, HttpServletResponse resp) {
        currentUser = req.getParameter("user");  // 线程A设"小明"
        // 线程B设"小红"——线程A再读 currentUser 已经变成了"小红"
    }
}

// ✅ 请求状态放在方法局部变量或 ThreadLocal 中
```

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
        // 这段代码不在 Tomcat Worker 线程上执行
        // 而是在一个独立的异步线程池里执行
        Order order = orderService.findById(id);
        User user = userService.getUser(order.getUserId());
        return enrichOrder(order, user);
    };
}

// 实际发生了什么：
// 1. Tomcat Worker 线程收到请求 → 创建 Callable → 提交到异步线程池 → Worker 立即归还
// 2. 异步线程池执行 Callable（1.3 秒的等待全发生在这里）
// 3. 执行完毕 → 通知 Tomcat → Tomcat 再分配一条 Worker 线程把结果写回客户端
```

**关键差异**：那 1.3 秒的等待不占用 Tomcat Worker 线程了。200 个 Worker 线程全部空闲，随时能处理新请求。

Spring WebFlux 把这个思路做到了极致——全链路非阻塞。但代价是代码从命令式变成响应式（`Mono`/`Flux`），调试和排查都更难。JDK 21 虚拟线程提供了一个折中方案：代码保持同步写法，但底层线程由 JVM 调度而非 OS 调度，阻塞不再占用昂贵的 OS 线程。

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

Connector 只负责"通信"（把字节流变成 Java 对象），Container 只负责"路由"（把 Request 交给正确的 Servlet）。两者互不越界。这一节只看 Container，Connector 见下文“Tomcat Connector：字节流如何变成 HttpServletRequest”。

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
| Engine | 固定（一个 Service 一个 Engine） | Catalina |
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

四层中每一层都是一个独立的阀门（Valve），可以插入自定义逻辑。最常见的扩展点是 Context 层——Spring Boot 就是在这里注册 `DispatcherServlet` 的。

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

**三道工序各司其职**：Endpoint 管连接（NIO Selector、accept、read/write），ProtocolHandler 管协议（HTTP/1.1、HTTP/2、AJP），CoyoteAdapter 管适配（把 Tomcat 内部对象翻译成 Servlet 规范对象）。改 I/O 模型只改 Endpoint，改协议支持只改 ProtocolHandler，互不影响。

## 5. Tomcat 线程模型：请求在哪个线程上执行

你已经知道请求经过 DispatcherServlet → Servlet 规范 → Container 路由 → Connector 解析。但还有一个关键问题：**整个链路中，代码在哪个线程上执行的？谁创建了这个线程？一个线程能同时处理几个请求？**

### 5.1 NioEndpoint 的三线程模型

Tomcat 8.5 起全面改用 NIO。网络 I/O 的"等待"和业务逻辑的"执行"分离到三个线程角色上：

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
                    │         Poller 线程 (1~2个)      │
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

**关键事实**：你的 Controller 代码永远在 Worker 线程池的某条线程上执行。Worker 线程总数由 `maxThreads` 决定——一旦所有 Worker 都在忙，新请求就会被 Tomcat 排进 `acceptCount` 队列等待。排队排满了，连接直接拒绝。

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

| 参数 | 含义 | 线上出问题的表现 | 排查命令 |
| :-- | :-- | :-- | :-- |
| `maxThreads` | Worker 线程池最大值 | 所有请求卡住不响应 | `jstack <pid> \| grep "catalina-exec" \| wc -l` |
| `maxConnections` | 可同时处理的连接上限（默认值随版本变化） | 达到上限后，新连接停留在 OS backlog 中 | `ss -ant \| grep 8080 \| wc -l` |
| `acceptCount` | Worker 满后，允许排队的请求数 | 发起连接时直接 refused | 日志搜 `Too many open files` 或 `accept failed` |
| `connectionTimeout` | 连接超时（ms） | 客户端报 `Read timed out` | 看业务侧监控：P99 延迟是否接近该值 |

**一次典型的线程池满排查**：

```bash
# 1. 看当前工人在干什么
jstack <pid> | grep "catalina-exec" | head -20

# 2. 找出阻塞最多的方法
jstack <pid> | grep -A 2 "BLOCKED" | sort | uniq -c | sort -rn | head -10

# 3. 如果大量线程阻塞在同一个数据库查询上 → 慢 SQL
#    如果大量线程阻塞在 Socket read → 下游服务超时
```

排查线程池问题的逻辑很简单：工人都在忙 → 看他们在忙什么 → 如果都在等下游，调大超时或加缓存；如果确实计算太慢，加机器。

### 5.3 BIO 时代 vs NIO 时代

Tomcat 7 默认用 BIO。BIO 模型下，**一个连接占一条线程**，不管这条连接上有没有数据传输。1000 个空闲长连接 = 1000 条线程白白挂着（~1GB 栈内存）。NIO 把这个绑定打破了——连接归 Acceptor/Poller 管，只有"有数据可读"的请求才分配 Worker 线程：

```txt
BIO (Tomcat 7-):    连接 ←→ 线程  =  1:1  → 10000 连接 = 10000 线程 = 10GB
NIO (Tomcat 8.5+):  连接 ←→ Worker =  N:1  → 10000 连接，只有活跃的分配线程
```

> 这就是为什么 Tomcat 8.0 是最后一个支持 BIO 的版本，8.5 直接砍掉了 BIO Connector。

## 6. 全链路回看

把七层抽象串起来，一个请求的完整旅程：

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

**每个节点都是一个可能的故障点**：线程池满、Socket 断开、Filter 抛异常、参数解析失败、序列化报错。排查时不要一层层猜——从最外层日志抓关键信息（`Connection reset` → Socket 层；500 + 空 body → Controller 或序列化层；503 + 线程名 `catalina-exec-*` → 线程池满），然后跳到那一层深入。
