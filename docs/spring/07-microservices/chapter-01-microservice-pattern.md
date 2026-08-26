# 微服务架构

> 当单体应用膨胀到团队无法协作、部署牵一发动全身、性能瓶颈无法针对性扩展时，微服务架构成为必然选择。本章回答三个核心问题：**为什么要拆分服务？拆分后服务之间如何发现彼此？服务之间的调用如何高效、可靠地进行？**

## 1. 为什么需要微服务

### 1.1 单体架构的困境

一个典型的单体应用，所有模块打包在一个 WAR/JAR 中：

```text
单体电商应用
┌─────────────────────────────────────────────┐
│                                             │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  │
│  │ 用户模块  │  │ 商品模块  │  │ 订单模块  │  │
│  │ User     │  │ Product  │  │ Order    │  │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  │
│       │             │             │         │
│  ┌────┴─────────────┴─────────────┴──────┐  │
│  │         共享数据库（单个 MySQL）        │  │
│  └───────────────────────────────────────┘  │
│                                             │
│  部署：打成一个 WAR 包，部署到一台 Tomcat     │
└─────────────────────────────────────────────┘
```

**问题一：部署耦合**

```text
场景：商品模块修了一个 Bug

单体架构：
商品模块改了 1 行代码
    → 整个应用重新编译
    → 整个应用重新打包（5 分钟）
    → 整个应用重新部署（10 分钟）
    → 所有模块都受影响，风险不可控

微服务架构：
商品服务改了 1 行代码
    → 只编译商品服务
    → 只打包商品服务（30 秒）
    → 只部署商品服务（1 分钟）
    → 其他服务完全不受影响
```

**问题二：扩展困难**

```text
双十一流量高峰：订单模块需要 10 倍扩容，用户模块流量平稳

单体架构：
    只能整体扩容 → 10 台机器全跑完整应用
    用户模块白白占用资源，浪费 90% 的 CPU 和内存

微服务架构：
    订单服务扩容到 10 个实例
    用户服务保持 2 个实例
    资源精准投放，成本降低 80%
```

**问题三：团队协作冲突**

```text
5 个团队共用一个代码仓库：

团队 A（用户）：要改数据库表结构
团队 B（商品）：要升级 Spring 版本
团队 C（订单）：要引入新的消息队列
团队 D（支付）：要修改公共工具类
团队 E（物流）：要调整构建脚本

结果：
- 每次合并代码都冲突不断
- 一个团队的 Bug 导致所有团队回滚
- 技术选型被"最低公分母"绑死
```

### 1.2 微服务的核心理念

微服务不是简单的"把代码拆开"，而是一种架构理念：

| 维度 | 单体架构 | 微服务架构 |
|------|---------|-----------|
| 部署单元 | 一个应用包 | 每个服务独立部署 |
| 数据库 | 共享一个数据库 | 每个服务独立数据库 |
| 技术栈 | 全体统一 | 各服务自由选择 |
| 团队组织 | 按职能分（前端/后端/DBA） | 按业务分（用户组/订单组/商品组） |
| 故障隔离 | 一个模块挂，全部挂 | 服务级隔离，熔断降级 |
| 扩展方式 | 整体扩展 | 按服务独立扩展 |

### 1.3 微服务拆分后的全景

```text
┌─────────────────────────────────────────────────────────────────┐
│                        微服务电商架构                             │
│                                                                 │
│   用户端                                                        │
│     │                                                           │
│     ▼                                                           │
│  ┌──────────┐                                                   │
│  │ API 网关  │  ← 统一入口、路由、鉴权、限流                      │
│  │ Gateway  │                                                   │
│  └──┬───┬───┘                                                   │
│     │   │    ┌──────────────┐                                   │
│     │   ├───→│ 用户服务      │───→ [用户数据库]                   │
│     │   │    │ User Service │                                   │
│     │   │    └──────────────┘                                   │
│     │   │    ┌──────────────┐                                   │
│     │   ├───→│ 商品服务      │───→ [商品数据库]                   │
│     │   │    │ Product Svc  │                                   │
│     │   │    └──────────────┘                                   │
│     │   │    ┌──────────────┐                                   │
│     │   └───→│ 订单服务      │───→ [订单数据库]                   │
│     │        │ Order Service│                                   │
│     │        └──────┬───────┘                                   │
│     │               │                                           │
│     │    ┌──────────┴──────────┐                                │
│     │    ▼                     ▼                                │
│  ┌──────────────┐   ┌──────────────┐                           │
│  │ 商品服务（RPC）│   │ 用户服务（RPC）│                           │
│  └──────────────┘   └──────────────┘                           │
│                                                                 │
│  ┌──────────────┐                                               │
│  │ 注册中心      │  ← Nacos / Eureka / Consul                   │
│  │ Registry     │                                               │
│  └──────────────┘                                               │
└─────────────────────────────────────────────────────────────────┘
```

## 2. 服务注册与发现

### 2.1 为什么需要服务发现

在微服务架构中，服务实例的 IP 和端口是动态变化的：

```text
传统方式（硬编码地址）：
OrderService 调用 UserService：
    → http://192.168.1.10:8081/user/1

问题：
- UserService 扩容到 3 个实例，地址变了怎么办？
- UserService 某个实例宕机了怎么感知？
- 每个服务都要维护其他所有服务的地址列表？（N×N 复杂度）
```

### 2.2 服务发现的核心流程

```text
┌──────────────────────────────────────────────────────────────┐
│                    服务发现全流程                               │
│                                                              │
│  Provider（服务提供者）         Registry（注册中心）            │
│  ┌──────────────┐            ┌──────────────┐               │
│  │ 1. 启动       │            │              │               │
│  │ 2. 注册地址   │───注册────→│ 存储服务实例  │               │
│  │   IP:Port    │            │ 列表          │               │
│  └──────────────┘            │              │               │
│                              │  UserService:│               │
│                              │  ├─10.0.0.1:8081              │
│                              │  ├─10.0.0.2:8081              │
│                              │  └─10.0.0.3:8081              │
│                              └──────┬───────┘               │
│                                     │                        │
│ Consumer（服务消费者）                │                        │
│ ┌──────────────┐                    │                        │
│ │ 3. 订阅服务   │────订阅────────────┘                        │
│ │ 4. 获取实例   │←──推送/拉取──                               │
│ │   列表       │                                             │
│ │ 5. 负载均衡  │                                             │
│ │   选择实例   │                                             │
│ │ 6. 发起调用  │───HTTP/RPC──→ Provider                      │
│ └──────────────┘                                             │
│                                                              │
│ 7. 心跳检测（Provider 定期向 Registry 报告存活）               │
│ 8. 健康检查（Registry 剔除不健康实例）                         │
└──────────────────────────────────────────────────────────────┘
```

### 2.3 Nacos 作为注册中心

Nacos 是阿里巴巴开源的服务发现和配置管理平台，支持 AP（临时实例）和 CP（持久实例）两种模式。

**Provider 注册**：

```yaml
# application.yml - 服务提供者配置
spring:
  application:
    name: user-service
  cloud:
    nacos:
      discovery:
        server-addr: 127.0.0.1:8848
        namespace: dev
        group: DEFAULT_GROUP
```

```java
@SpringBootApplication
@EnableDiscoveryClient  // 启用服务注册（Spring Boot 2.7+ 可省略）
public class UserServiceApplication {
    public static void main(String[] args) {
        SpringApplication.run(UserServiceApplication.class, args);
    }
}
```

启动后，Nacos 控制台会显示注册信息：

```text
服务列表
├── user-service
│   ├── 192.168.1.10:8081  (healthy)
│   ├── 192.168.1.11:8081  (healthy)
│   └── 192.168.1.12:8081  (healthy)
├── order-service
│   ├── 192.168.1.20:8082  (healthy)
│   └── 192.168.1.21:8082  (healthy)
└── product-service
    └── 192.168.1.30:8083  (healthy)
```

**Consumer 发现并调用**：

```java
@RestController
@RequestMapping("/order")
public class OrderController {

    @Autowired
    private DiscoveryClient discoveryClient;

    @GetMapping("/{orderId}")
    public Order getOrder(@PathVariable Long orderId) {
        // 获取 user-service 的所有实例
        List<ServiceInstance> instances =
            discoveryClient.getInstances("user-service");

        // 负载均衡选择一个实例
        ServiceInstance instance = instances.get(
            ThreadLocalRandom.current().nextInt(instances.size())
        );

        // 发起 HTTP 调用
        String url = "http://" + instance.getHost()
                   + ":" + instance.getPort()
                   + "/user/" + orderId;
        User user = restTemplate.getForObject(url, User.class);

        // 构建订单返回
        return new Order(orderId, user, "...");
    }
}
```

### 2.4 负载均衡策略

当一个服务有多个实例时，需要决定调用哪个实例：

| 策略 | 说明 | 适用场景 |
|------|------|----------|
| **Round Robin** | 轮询，依次调用 | 通用场景，实例性能均匀 |
| **Weighted** | 按权重分配 | 实例性能不均，按比例分配 |
| **Random** | 随机选择 | 简单场景 |
| **Least Connections** | 选择连接数最少的 | 长连接场景 |
| **Consistent Hash** | 相同参数始终路由到同一实例 | 有状态服务，会话保持 |

### 2.5 注册中心对比

| 特性 | Nacos | Eureka | Consul |
|------|-------|--------|--------|
| 一致性协议 | AP + CP | AP | CP |
| 健康检查 | TCP/HTTP/MySQL/自定义 | 客户端心跳 | TCP/HTTP/gRPC/脚本 |
| 配置管理 | ✅ 内置 | ❌ 需要配合 Spring Cloud Config | ✅ 内置 |
| 管理界面 | ✅ 功能丰富 | ✅ 基础 | ✅ 功能丰富 |
| 多数据中心 | ✅ | ❌ | ✅ 原生支持 |
| 社区活跃度 | 高（阿里维护） | 中（Netflix 维护减少） | 高（HashiCorp 维护） |
| 国内使用率 | ★★★★★ | ★★★ | ★★ |

## 3. API Gateway

### 3.1 为什么需要网关

没有网关时，客户端直接调用各个微服务：

```text
没有网关的问题：

手机端 ──→ 用户服务（需要处理鉴权）
       ──→ 商品服务（需要处理鉴权）
       ──→ 订单服务（需要处理鉴权）
       ──→ 支付服务（需要处理鉴权）

每个服务都要：
- 实现 JWT 验证逻辑
- 配置 CORS 跨域
- 实现限流保护
- 记录访问日志
- 处理 SSL 证书

→ 大量重复代码，维护成本极高
```

引入网关后：

```text
手机端 ──→ API Gateway ──→ 用户服务（专注业务）
                    ──→ 商品服务（专注业务）
                    ──→ 订单服务（专注业务）
                    ──→ 支付服务（专注业务）

网关统一处理：
✅ 路由转发
✅ 统一鉴权
✅ 限流熔断
✅ 日志记录
✅ 跨域处理
✅ 协议转换
```

### 3.2 Spring Cloud Gateway 核心概念

Spring Cloud Gateway 基于 WebFlux（响应式编程），核心由三部分组成：

```text
请求进入
    │
    ▼
┌──────────┐    ┌──────────┐    ┌──────────┐
│  Route   │───→│ Predicate │───→│  Filter  │───→ 后端服务
│  路由     │    │  断言     │    │  过滤器   │
└──────────┘    └──────────┘    └──────────┘
    │               │               │
    定义路由规则      判断是否匹配      请求/响应处理
```

**Route（路由）**：一组规则的集合，包含目标 URI、断言和过滤器。

**Predicate（断言）**：匹配条件，基于 HTTP 请求的任何内容（路径、头、参数等）。

**Filter（过滤器）**：对请求和响应进行修改，分为 `GatewayFilter`（单路由）和 `GlobalFilter`（全局）。

### 3.3 网关配置示例

```yaml
# application.yml - Spring Cloud Gateway 配置
spring:
  cloud:
    gateway:
      routes:
        # 用户服务路由
        - id: user-service
          uri: lb://user-service          # lb:// 表示从注册中心获取地址
          predicates:
            - Path=/api/user/**           # 匹配路径
          filters:
            - StripPrefix=1               # 去掉 /api 前缀
            - name: RequestRateLimiter    # 限流过滤器
              args:
                redis-rate-limiter.replenishRate: 10
                redis-rate-limiter.burstCapacity: 20

        # 商品服务路由
        - id: product-service
          uri: lb://product-service
          predicates:
            - Path=/api/product/**
          filters:
            - StripPrefix=1

        # 订单服务路由
        - id: order-service
          uri: lb://order-service
          predicates:
            - Path=/api/order/**
            - Method=GET,POST             # 只允许 GET 和 POST
          filters:
            - StripPrefix=1
            - AddRequestHeader=X-Request-Source, gateway
```

### 3.4 全局鉴权过滤器

```java
@Component
public class AuthGlobalFilter implements GlobalFilter, Ordered {

    @Override
    public Mono<Void> filter(ServerWebExchange exchange, GatewayFilterChain chain) {
        String path = exchange.getRequest().getPath().value();

        // 白名单路径，无需鉴权
        if (isWhiteListed(path)) {
            return chain.filter(exchange);
        }

        // 获取 Token
        String token = exchange.getRequest().getHeaders()
                         .getFirst("Authorization");
        if (token == null || !token.startsWith("Bearer ")) {
            exchange.getResponse().setStatusCode(HttpStatus.UNAUTHORIZED);
            return exchange.getResponse().setComplete();
        }

        // 验证 JWT
        try {
            Claims claims = JwtUtils.parseToken(token.substring(7));
            // 将用户信息传递给下游服务
            ServerHttpRequest request = exchange.getRequest().mutate()
                .header("X-User-Id", claims.getSubject())
                .header("X-User-Role", claims.get("role", String.class))
                .build();
            return chain.filter(exchange.mutate().request(request).build());
        } catch (Exception e) {
            exchange.getResponse().setStatusCode(HttpStatus.UNAUTHORIZED);
            return exchange.getResponse().setComplete();
        }
    }

    @Override
    public int getOrder() {
        return -100;  // 高优先级
    }
}
```

### 3.5 网关处理流程

![microservice-request-flow](/spring/microservice-request-flow.svg)

## 4. 服务调用

### 4.1 远程调用的核心问题

微服务之间的通信本质上是网络调用，需要解决：

1. **如何找到对方** → 服务发现（上一节已解决）
2. **如何调用** → HTTP / RPC / 消息队列
3. **如何保证可靠性** → 超时、重试、熔断
4. **如何保证性能** → 连接池、序列化、协议选择

### 4.2 OpenFeign 声明式调用

OpenFeign 让远程调用像调用本地方法一样简单：

```java
// 1. 定义 Feign 客户端接口
@FeignClient(
    name = "user-service",           // 目标服务名
    fallbackFactory = UserClientFallbackFactory.class  // 降级处理
)
public interface UserClient {

    @GetMapping("/user/{id}")
    User getUser(@PathVariable("id") Long id);

    @PostMapping("/user")
    User createUser(@RequestBody User user);

    @GetMapping("/user/search")
    List<User> searchUsers(@RequestParam("keyword") String keyword);
}

// 2. 降级处理
@Component
public class UserClientFallbackFactory
        implements FallbackFactory<UserClient> {

    @Override
    public UserClient create(Throwable cause) {
        return new UserClient() {
            @Override
            public User getUser(Long id) {
                // 降级：返回默认用户
                return new User(id, "未知用户", "服务暂时不可用");
            }

            @Override
            public User createUser(User user) {
                throw new RuntimeException("用户服务不可用，无法创建用户", cause);
            }

            @Override
            public List<User> searchUsers(String keyword) {
                return Collections.emptyList();
            }
        };
    }
}

// 3. 在业务代码中使用
@Service
public class OrderService {

    @Autowired
    private UserClient userClient;  // 像调用本地方法一样

    @Transactional
    public Order createOrder(Long userId, Long productId) {
        // 远程调用用户服务
        User user = userClient.getUser(userId);  // 透明的远程调用
        // 远程调用商品服务
        Product product = productClient.getProduct(productId);
        // 创建订单
        return orderRepository.save(new Order(user, product));
    }
}
```

**OpenFeign 的工作原理**：

```text
OrderService.createOrder()
    │
    ├── userClient.getUser(1L)     ← 看起来像本地调用
    │       │
    │       ▼
    │   UserClient 是 JDK 动态代理
    │       │
    │       ▼
    │   FeignInvocationHandler.invoke()
    │       │
    │       ▼
    │   MethodHandler.dispatch()
    │       │
    │       ├── 1. 解析注解：GET /user/{id}
    │       ├── 2. 参数替换：/user/1
    │       ├── 3. 服务发现：user-service → 192.168.1.10:8081
    │       ├── 4. 负载均衡：选择一个实例
    │       ├── 5. 构建 HTTP 请求
    │       ├── 6. 发送请求（通过 LoadBalancerInterceptor）
    │       └── 7. 响应反序列化为 User 对象
    │
    └── 返回 User 对象
```

### 4.3 Dubbo RPC 调用

Dubbo 是阿里开源的高性能 RPC 框架，使用自定义协议，性能优于 HTTP：

```java
// 1. 定义服务接口（需要独立的 API 模块）
public interface UserService {
    User getUser(Long id);
}

// 2. 服务提供者实现
@DubboService(version = "1.0.0")
public class UserServiceImpl implements UserService {

    @Override
    public User getUser(Long id) {
        return userRepository.findById(id).orElse(null);
    }
}

// 3. 服务消费者调用
@RestController
@RequestMapping("/order")
public class OrderController {

    @DubboReference(version = "1.0.0", timeout = 3000, retries = 2)
    private UserService userService;

    @GetMapping("/{orderId}")
    public Order getOrder(@PathVariable Long orderId) {
        Order order = orderRepository.findById(orderId);
        User user = userService.getUser(order.getUserId());
        return order.withUser(user);
    }
}
```

### 4.4 gRPC 调用

gRPC 基于 HTTP/2 + Protocol Buffers，适合高性能、跨语言场景：

```protobuf
// user.proto
syntax = "proto3";

service UserService {
    rpc GetUser (GetUserRequest) returns (UserResponse);
    rpc SearchUsers (SearchRequest) returns (stream UserResponse);
}

message GetUserRequest {
    int64 id = 1;
}

message UserResponse {
    int64 id = 1;
    string name = 2;
    string email = 3;
}
```

### 4.5 三种调用方式全面对比

| 特性 | OpenFeign | Dubbo | gRPC |
|------|-----------|-------|------|
| **协议** | HTTP/1.1 (REST) | 自定义 TCP 协议 | HTTP/2 |
| **序列化** | JSON | Hessian2 / Protobuf | Protobuf |
| **性能** | ★★★ 较低 | ★★★★★ 高 | ★★★★ 较高 |
| **跨语言** | ✅ 天然支持（REST） | ❌ 主要 Java | ✅ 多语言支持 |
| **服务治理** | 依赖 Spring Cloud | ✅ 内置丰富 | 需配合 Istio 等 |
| **学习成本** | ★★ 低 | ★★★ 中 | ★★★★ 较高 |
| **调试友好** | ✅ 可用 curl/浏览器 | ❌ 需专用工具 | ❌ 需专用工具 |
| **接口定义** | Java 接口 + 注解 | Java 接口 | .proto 文件 |
| **连接模型** | 短连接（每次请求新建） | 长连接（连接复用） | 长连接（多路复用） |
| **适用场景** | 对外 API、前后端交互 | 内部高性能调用 | 跨语言、流式通信 |
| **国内生态** | Spring Cloud 全家桶 | 阿里系生态 | 谷歌系、云原生 |

### 4.6 调用方式选择决策树

```text
需要服务间调用
    │
    ├── 需要跨语言？（Go/Python/Java 混合）
    │       │
    │       ├── 是 → gRPC
    │       │
    │       └── 否 → 继续判断
    │
    ├── 对外暴露 API？（前端/第三方调用）
    │       │
    │       ├── 是 → OpenFeign / REST Controller
    │       │
    │       └── 否 → 继续判断
    │
    ├── 性能敏感？（高 QPS、低延迟）
    │       │
    │       ├── 是 → Dubbo 或 gRPC
    │       │
    │       └── 否 → OpenFeign（开发效率最高）
    │
    └── 阿里技术栈？
            │
            ├── 是 → Dubbo（生态完善）
            │
            └── 否 → OpenFeign（Spring Cloud 生态）
```

### 4.7 可靠性保障：熔断与降级

无论选择哪种调用方式，都需要处理服务不可用的情况。Sentinel 是常用的流量治理组件：

```java
// Sentinel 熔断降级配置
@SentinelResource(
    value = "getUser",
    blockHandler = "getUserBlockHandler",
    fallback = "getUserFallback"
)
public User getUser(Long id) {
    return userClient.getUser(id);
}

// 被限流或降级时的处理
public User getUserBlockHandler(Long id, BlockException ex) {
    return new User(id, "系统繁忙，请稍后重试", "");
}

// 服务调用异常时的降级处理
public User getUserFallback(Long id, Throwable t) {
    return new User(id, "服务暂时不可用", "");
}
```

```text
服务调用可靠性保障链路：

请求进入
    │
    ▼
┌──────────────┐
│  限流         │  ← 控制 QPS，防止过载
│  Rate Limit  │
└──────┬───────┘
       │
       ▼
┌──────────────┐
│  熔断         │  ← 错误率过高时切断调用
│  Circuit     │
│  Breaker     │
└──────┬───────┘
       │
       ▼
┌──────────────┐
│  降级         │  ← 返回兜底数据
│  Fallback    │
└──────┬───────┘
       │
       ▼
┌──────────────┐
│  重试         │  ← 可恢复错误自动重试
│  Retry       │
└──────┬───────┘
       │
       ▼
┌──────────────┐
│  超时         │  ← 设置合理超时时间
│  Timeout     │
└──────┬───────┘
       │
       ▼
  正常返回 / 兜底返回
```

> 服务拆开了，但问题也来了：配置散落各处怎么管？一个服务挂了会不会雪崩？流量突增怎么办？请求链路如同黑盒怎么排查？下一章讲分布式系统治理的四大手段：配置中心、服务容错、限流降级、链路追踪。
