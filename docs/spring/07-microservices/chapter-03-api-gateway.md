# API 网关

## 1. Spring Cloud Gateway

```yaml
spring:
  cloud:
    gateway:
      routes:
        - id: user-service
          uri: lb://user-service
          predicates:
            - Path=/api/users/**
          filters:
            - StripPrefix=1
```

## 2. 自定义过滤器

```java
@Component
public class AuthFilter implements GlobalFilter, Ordered {
    @Override
    public Mono<Void> filter(ServerWebExchange exchange, GatewayFilterChain chain) {
        String token = exchange.getRequest().getHeaders().getFirst("Authorization");
        if (!validateToken(token)) {
            exchange.getResponse().setStatusCode(HttpStatus.UNAUTHORIZED);
            return exchange.getResponse().setComplete();
        }
        return chain.filter(exchange);
    }
    
    @Override
    public int getOrder() { return -1; }
}
```

## 3. 网关高级配置

### 3.1 全局过滤器链

```java
@Component
public class LoggingGlobalFilter implements GlobalFilter, Ordered {

    private static final Logger log = LoggerFactory.getLogger(LoggingGlobalFilter.class);

    @Override
    public Mono<Void> filter(ServerWebExchange exchange, GatewayFilterChain chain) {
        long startTime = System.currentTimeMillis();
        String path = exchange.getRequest().getPath().value();
        String method = exchange.getRequest().getMethod().name();

        return chain.filter(exchange).then(Mono.fromRunnable(() -> {
            long duration = System.currentTimeMillis() - startTime;
            int statusCode = exchange.getResponse().getStatusCode() != null
                ? exchange.getResponse().getStatusCode().value() : 0;

            if (duration > 1000) {
                log.warn("慢请求: {} {} 耗时 {}ms 状态码 {}", method, path, duration, statusCode);
            } else {
                log.info("请求: {} {} 耗时 {}ms 状态码 {}", method, path, duration, statusCode);
            }
        }));
    }

    @Override
    public int getOrder() {
        return -200;  // 最先执行
    }
}
```

### 3.2 路由断言工厂

```yaml
spring:
  cloud:
    gateway:
      routes:
        # 基于 Header 的路由
        - id: beta-route
          uri: lb://user-service-beta
          predicates:
            - Header=X-User-Type, beta
            - Path=/api/users/**
          filters:
            - StripPrefix=1

        # 基于 Cookie 的路由
        - id: vip-route
          uri: lb://user-service-vip
          predicates:
            - Cookie=userType, vip
            - Path=/api/users/**
          filters:
            - StripPrefix=1

        # 基于时间的路由（维护窗口）
        - id: maintenance-route
          uri: lb://maintenance-service
          predicates:
            - Between=2024-01-15T02:00:00+08:00,2024-01-15T04:00:00+08:00
```

### 3.3 限流配置

```java
@Configuration
public class RateLimiterConfig {

    @Bean
    public KeyResolver userKeyResolver() {
        // 按用户 ID 限流
        return exchange -> Mono.just(
            exchange.getRequest().getHeaders()
                .getFirst("X-User-Id"));
    }

    @Bean
    public KeyResolver ipKeyResolver() {
        // 按 IP 限流
        return exchange -> Mono.just(
            Objects.requireNonNull(
                exchange.getRequest().getRemoteAddress())
                .getAddress().getHostAddress());
    }
}
```

```yaml
spring:
  cloud:
    gateway:
      routes:
        - id: user-service
          uri: lb://user-service
          predicates:
            - Path=/api/users/**
          filters:
            - StripPrefix=1
            - name: RequestRateLimiter
              args:
                redis-rate-limiter.replenishRate: 10  # 每秒放 10 个请求
                redis-rate-limiter.burstCapacity: 20   # 突发最多 20 个
                key-resolver: "#{@ipKeyResolver}"     # 按 IP 限流
```

### 3.4 熔断集成（Resilience4j）

```yaml
spring:
  cloud:
    gateway:
      routes:
        - id: order-service
          uri: lb://order-service
          predicates:
            - Path=/api/orders/**
          filters:
            - StripPrefix=1
            - name: CircuitBreaker
              args:
                name: orderServiceCB
                fallbackUri: forward:/fallback/order
                statusCodes:
                  - 500
                  - 503

resilience4j:
  circuitbreaker:
    instances:
      orderServiceCB:
        failure-rate-threshold: 50
        wait-duration-in-open-state: 5s
        sliding-window-size: 10
```

**最佳实践：**

1. **网关是无状态的**——不要在网关中存储会话信息
2. **限流按业务维度**——API 级、用户级、IP 级多层限流
3. **网关超时 < 服务超时**——确保网关先超时返回，避免线程堆积
4. **灰度发布**——通过 Header 路由实现金丝雀发布
5. **网关也要监控**——记录每个路由的 QPS、错误率、延迟

## 4. 网关核心原理

### 4.1 三大核心组件

Spring Cloud Gateway 的所有功能都建立在三个核心组件之上：

```text
┌─────────────────────────────────────────────────────────────┐
│                    Spring Cloud Gateway                     │
│                                                             │
│  ┌──────────┐    ┌──────────────┐    ┌──────────────────┐  │
│  │  Route   │───→│  Predicate   │───→│     Filter       │  │
│  │  路由    │    │   断言       │    │     过滤器        │  │
│  └──────────┘    └──────────────┘    └──────────────────┘  │
│       │                │                     │             │
│   定义转发目标    匹配请求条件         处理请求/响应         │
└─────────────────────────────────────────────────────────────┘
```

| 组件 | 作用 | 类比 | 典型实现 |
|------|------|------|----------|
| **Route（路由）** | 定义转发目标地址 | Nginx 的 `location` + `proxy_pass` | `uri: lb://user-service` |
| **Predicate（断言）** | 匹配请求条件 | Nginx 的 `if` 判断 | `Path=/api/users/**` |
| **Filter（过滤器）** | 修改请求/响应 | Servlet 的 `Filter` | `StripPrefix=1` |

### 4.2 请求处理流程

```text
客户端请求
    │
    ▼
┌─────────────────────────────────────────────────────────┐
│  Gateway Handler Mapping（路由匹配）                     │
│  遍历所有 Route，用 Predicate 判断哪个 Route 匹配       │
└─────────────────────┬───────────────────────────────────┘
                      │ 匹配到 Route
                      ▼
┌─────────────────────────────────────────────────────────┐
│  Gateway Web Handler（执行过滤器链）                     │
│                                                         │
│  Pre Filter 链（请求阶段，顺序执行）                     │
│    ↓                                                    │
│  转发请求到下游服务                                      │
│    ↓                                                    │
│  Post Filter 链（响应阶段，逆序执行）                    │
└─────────────────────┬───────────────────────────────────┘
                      │
                      ▼
               返回响应给客户端
```

过滤器执行顺序：

| 阶段 | 执行顺序 | 典型操作 | 示例 |
|------|----------|----------|------|
| **Pre Filter** | `order` 值越小越先执行 | 鉴权、限流、日志、参数改写 | `AuthFilter(order=-1)` |
| **转发** | — | 调用下游服务 | — |
| **Post Filter** | `order` 值越大越先执行（逆序） | 响应改写、Header 添加、日志 | `ResponseFilter(order=1)` |

### 4.3 自定义路由断言工厂

当内置断言不满足需求时，可以自定义：

```java
@Component
public class CustomHeaderRoutePredicateFactory
        extends AbstractRoutePredicateFactory<CustomHeaderRoutePredicateFactory.Config> {

    public CustomHeaderRoutePredicateFactory() {
        super(Config.class);
    }

    @Override
    public Predicate<ServerWebExchange> apply(Config config) {
        return exchange -> {
            String header = exchange.getRequest()
                .getHeaders().getFirst(config.getHeaderName());
            if (header == null) return false;
            return header.matches(config.getPattern());
        };
    }

    @Override
    public List<String> shortcutFieldOrder() {
        return Arrays.asList("headerName", "pattern");
    }

    @lombok.Data
    public static class Config {
        private String headerName;
        private String pattern;  // 正则表达式
    }
}
```

```yaml
spring:
  cloud:
    gateway:
      routes:
        - id: custom-header-route
          uri: lb://user-service
          predicates:
            - CustomHeader=X-App-Version, ^v[2-9].*   # 版本号 v2+ 路由到新服务
```

## 5. 限流详解

### 5.1 两种经典算法对比

| 特性 | 令牌桶（Token Bucket） | 漏桶（Leaky Bucket） |
|------|----------------------|---------------------|
| **原理** | 桶中存放令牌，请求取走令牌才放行 | 请求进入桶，以固定速率流出处理 |
| **突发流量** | ✅ 允许突发（桶中有积累的令牌） | ❌ 严格匀速，不支持突发 |
| **适用场景** | API 网关、用户请求限流 | 流量整形、削峰填谷 |
| **实现** | Redis + Lua | Redis + Lua |
| **Gateway 默认** | ✅ 使用令牌桶 | — |

```text
令牌桶算法：

  ┌─────────────────────────┐
  │  以固定速率添加令牌       │
  │  replenishRate=10/s     │
  └──────────┬──────────────┘
             ▼
        ┌─────────┐
        │ 🪙🪙🪙🪙 │  桶容量 = burstCapacity = 20
        │  Token   │
        │  Bucket  │
        └────┬────┘
             │
        请求到来 → 有令牌？→ ✅ 放行（取走 1 个令牌）
                         → ❌ 拒绝（429 Too Many Requests）
```

### 5.2 基于 Redis 的令牌桶配置

**依赖：**

```xml
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-data-redis-reactive</artifactId>
</dependency>
```

**KeyResolver 定义（多维度）：**

```java
@Configuration
public class RateLimiterConfig {

    /**
     * 按用户 ID 限流（已登录用户）
     */
    @Bean
    public KeyResolver userKeyResolver() {
        return exchange -> Mono.justOrEmpty(
            exchange.getRequest().getHeaders().getFirst("X-User-Id")
        ).defaultIfEmpty("anonymous");
    }

    /**
     * 按 IP 限流（未登录 / 开放 API）
     */
    @Bean
    public KeyResolver ipKeyResolver() {
        return exchange -> Mono.just(
            Objects.requireNonNull(
                exchange.getRequest().getRemoteAddress()
            ).getAddress().getHostAddress()
        );
    }

    /**
     * 按 API 路径限流（保护下游服务）
     */
    @Bean
    public KeyResolver apiKeyResolver() {
        return exchange -> Mono.just(
            exchange.getRequest().getPath().value()
        );
    }

    /**
     * 组合限流：用户 + API 维度
     */
    @Bean
    public KeyResolver compositeKeyResolver() {
        return exchange -> {
            String userId = exchange.getRequest().getHeaders()
                .getFirst("X-User-Id");
            if (userId == null) userId = exchange.getRequest()
                .getRemoteAddress().getAddress().getHostAddress();
            String path = exchange.getRequest().getPath().value();
            return Mono.just(userId + ":" + path);
        };
    }
}
```

**路由级限流配置：**

```yaml
spring:
  cloud:
    gateway:
      routes:
        # 高频 API：严格限流
        - id: search-service
          uri: lb://search-service
          predicates:
            - Path=/api/search/**
          filters:
            - name: RequestRateLimiter
              args:
                redis-rate-limiter.replenishRate: 50   # 每秒 50 个
                redis-rate-limiter.burstCapacity: 100  # 突发 100 个
                redis-rate-limiter.requestedTokens: 1  # 每请求消耗 1 个令牌
                key-resolver: "#{@ipKeyResolver}"

        # 写入 API：更严格限流
        - id: order-service
          uri: lb://order-service
          predicates:
            - Path=/api/orders/**
          filters:
            - name: RequestRateLimiter
              args:
                redis-rate-limiter.replenishRate: 10
                redis-rate-limiter.burstCapacity: 20
                key-resolver: "#{@userKeyResolver}"
```

### 5.3 自定义限流响应

默认限流返回空 body，生产环境需要自定义响应：

```java
@Configuration
public class CustomRateLimiterConfig {

    @Bean
    public RateLimiterGatewayFilterFactory.Config rateLimiterConfig() {
        return new RateLimiterGatewayFilterFactory.Config()
            .setRateLimiter(redisRateLimiter())
            .setKeyResolver(ipKeyResolver());
    }
}

@Component
class RateLimitExceededHandler implements ServerHttpResponseDecorator {

    // 方式一：通过 Gateway 异常处理（推荐，见第 8 节）

    // 方式二：自定义 GatewayFilter
    @Bean
    public GlobalFilter rateLimitResponseFilter() {
        return (exchange, chain) -> chain.filter(exchange).then(Mono.fromRunnable(() -> {
            if (exchange.getResponse().getStatusCode() == HttpStatus.TOO_MANY_REQUESTS) {
                // 可在此处记录限流指标
            }
        }));
    }
}
```

## 6. 灰度路由（金丝雀发布）

### 6.1 灰度发布原理

```text
                    ┌─────────────────┐
                    │  Gateway        │
                    │                 │
                    │  灰度路由规则：   │
                    │  Header=X-Gray  │
                    │  =true          │
                    └───┬─────────┬───┘
                        │         │
              普通请求   │         │  灰度请求
                        ▼         ▼
               ┌────────────┐  ┌────────────┐
               │ user-svc   │  │ user-svc   │
               │ v1 (稳定)  │  │ v2 (灰度)  │
               │ 90% 流量   │  │ 10% 流量   │
               └────────────┘  └────────────┘
```

### 6.2 基于 Header 的灰度路由

**方案一：静态路由配置（简单场景）**

```yaml
spring:
  cloud:
    gateway:
      routes:
        # 灰度路由（优先级高，放前面）
        - id: user-service-gray
          uri: lb://user-service-v2
          order: -100
          predicates:
            - Path=/api/users/**
            - Header=X-Gray, true
          filters:
            - StripPrefix=1

        # 默认路由
        - id: user-service-default
          uri: lb://user-service-v1
          predicates:
            - Path=/api/users/**
          filters:
            - StripPrefix=1
```

**方案二：动态路由（基于 Nacos 元数据 + 自定义 Filter）**

```java
@Component
public class GrayRouteFilter implements GlobalFilter, Ordered {

    @Override
    public Mono<Void> filter(ServerWebExchange exchange, GatewayFilterChain chain) {
        ServerHttpRequest request = exchange.getRequest();

        // 灰度标识来源：Header > Cookie > 用户属性
        String grayFlag = request.getHeaders().getFirst("X-Gray");
        if (grayFlag == null) {
            grayFlag = parseGrayFromCookie(request);
        }

        if ("true".equals(grayFlag)) {
            // 将灰度标识传递给 LoadBalancer
            ServerHttpRequest mutatedRequest = request.mutate()
                .header("X-Gray", "true")
                .build();
            return chain.filter(exchange.mutate().request(mutatedRequest).build());
        }

        return chain.filter(exchange);
    }

    private String parseGrayFromCookie(ServerHttpRequest request) {
        return Optional.ofNullable(request.getCookies().getFirst("X-Gray"))
            .map(HttpCookie::getValue)
            .orElse(null);
    }

    @Override
    public int getOrder() {
        return -10;  // 在鉴权之后、转发之前执行
    }
}
```

**方案三：基于 Nacos 元数据的灰度负载均衡**

```java
@Component
public class GrayLoadBalancer implements ReactorServiceInstanceLoadBalancer {

    private final String serviceId;
    private final ObjectProvider<ServiceInstanceListSupplier> supplier;

    public GrayLoadBalancer(ObjectProvider<ServiceInstanceListSupplier> supplier,
                            String serviceId) {
        this.supplier = supplier;
        this.serviceId = serviceId;
    }

    @Override
    public Mono<Response<ServiceInstance>> choose(Request request) {
        // 从上下文获取灰度标识
        HttpHeaders headers = request.getContext();
        boolean isGray = "true".equals(headers.getFirst("X-Gray"));

        return supplier.getIfAvailable(ServiceInstanceListSupplier::with)
            .get(request)
            .map(instances -> {
                List<ServiceInstance> filtered = instances.stream()
                    .filter(instance -> {
                        String version = instance.getMetadata()
                            .getOrDefault("version", "v1");
                        return isGray ? "v2".equals(version) : "v1".equals(version);
                    })
                    .collect(Collectors.toList());

                if (filtered.isEmpty()) filtered = instances;
                return filtered;
            })
            .map(instances -> {
                int idx = ThreadLocalRandom.current().nextInt(instances.size());
                return new DefaultResponse(instances.get(idx));
            });
    }
}
```

**Nacos 服务注册配置（灰度实例标记）：**

```yaml
# user-service-v2 实例
spring:
  application:
    name: user-service
  cloud:
    nacos:
      discovery:
        metadata:
          version: v2      # 灰度标识
          gray: true
```

## 7. 跨域配置（CORS）

### 7.1 为什么在网关统一配置

| 方案 | 优点 | 缺点 |
|------|------|------|
| 每个服务单独配置 | 各服务自治 | 重复代码、维护困难、预检请求倍增 |
| **网关统一配置** | **一处配置、全局生效** | 网关成为跨域策略的唯一来源 |
| Nginx 配置 | 性能好 | 与 Spring 生态割裂 |

> ⚠️ **注意**：Gateway 基于 WebFlux，不能使用 Spring MVC 的 `@CrossOrigin` 注解和 `WebMvcConfigurer`。

### 7.2 配置方式

**方式一：配置文件（推荐）**

```yaml
spring:
  cloud:
    gateway:
      globalcors:
        cors-configurations:
          '[/**]':
            allowedOriginPatterns: "*"          # 允许的源（支持通配符）
            allowedMethods:                      # 允许的 HTTP 方法
              - GET
              - POST
              - PUT
              - DELETE
              - OPTIONS
            allowedHeaders: "*"                  # 允许的请求头
            exposedHeaders:                      # 暴露给前端的响应头
              - X-Request-Id
              - X-Response-Time
            allowCredentials: true               # 允许携带 Cookie
            maxAge: 3600                         # 预检请求缓存时间（秒）
```

**方式二：Java 配置类**

```java
@Configuration
public class CorsConfig {

    @Bean
    public CorsWebFilter corsWebFilter() {
        CorsConfiguration config = new CorsConfiguration();
        config.addAllowedOriginPattern("*");
        config.setAllowedMethods(Arrays.asList("GET", "POST", "PUT", "DELETE", "OPTIONS"));
        config.addAllowedHeader("*");
        config.addExposedHeader("X-Request-Id");
        config.setAllowCredentials(true);
        config.setMaxAge(3600L);

        UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
        source.registerCorsConfiguration("/**", config);

        return new CorsWebFilter(source);
    }
}
```

### 7.3 生产环境跨域最佳实践

```yaml
spring:
  cloud:
    gateway:
      globalcors:
        cors-configurations:
          # 管理后台：严格限制源
          '[/api/admin/**]':
            allowedOriginPatterns:
              - "https://admin.example.com"
            allowedMethods: "*"
            allowCredentials: true
            maxAge: 7200

          # 开放 API：允许第三方接入
          '[/api/public/**]':
            allowedOriginPatterns: "*"
            allowedMethods:
              - GET
              - POST
            allowCredentials: false
            maxAge: 3600

          # 内部服务间调用：禁止跨域
          '[/api/internal/**]':
            allowedOriginPatterns: []
```

## 8. 全局异常处理

### 8.1 Gateway 异常处理机制

Gateway 基于 WebFlux，异常处理方式与 Spring MVC 不同：

```text
请求处理异常时的响应链：

  异常发生
      │
      ▼
  Gateway 自动转换为 HTTP 状态码
      │
      ▼
  ErrorWebExceptionHandler（Spring 默认）
      │
      ▼
  自定义 GlobalExceptionHandler（覆盖默认）
      │
      ▼
  返回统一格式的 JSON 错误响应
```

| 异常类型 | 默认状态码 | 说明 |
|----------|-----------|------|
| `ResponseStatusException` | 自定义 | 主动抛出的业务异常 |
| `NotFoundException` | 404 | 找不到路由或服务实例 |
| `ResponseStatusException(429)` | 429 | 限流触发 |
| `ConnectTimeoutException` | 504 | 下游服务连接超时 |
| `ServiceUnavailableException` | 503 | 下游服务不可用 |

### 8.2 自定义全局异常处理器

```java
@Component
@Order(-1)  // 优先于默认处理器
public class GatewayExceptionHandler implements ErrorWebExceptionHandler {

    private static final Logger log = LoggerFactory.getLogger(GatewayExceptionHandler.class);

    @Override
    public Mono<Void> handle(ServerWebExchange exchange, Throwable ex) {
        ServerHttpResponse response = exchange.getResponse();

        // 响应已提交，无法修改
        if (response.isCommitted()) {
            return Mono.error(ex);
        }

        // 根据异常类型确定状态码和消息
        ErrorInfo errorInfo = resolveError(ex);

        log.error("网关异常: path={} error={}",
            exchange.getRequest().getPath().value(),
            errorInfo.message, ex);

        response.setStatusCode(errorInfo.status);
        response.getHeaders().setContentType(MediaType.APPLICATION_JSON);

        Map<String, Object> body = new LinkedHashMap<>();
        body.put("code", errorInfo.status.value());
        body.put("message", errorInfo.message);
        body.put("path", exchange.getRequest().getPath().value());
        body.put("timestamp", System.currentTimeMillis());

        // 添加请求追踪 ID
        String traceId = exchange.getRequest().getHeaders()
            .getFirst("X-Request-Id");
        if (traceId != null) {
            body.put("traceId", traceId);
        }

        byte[] bytes;
        try {
            bytes = new ObjectMapper().writeValueAsBytes(body);
        } catch (JsonProcessingException e) {
            bytes = ("{\"code\":500,\"message\":\"Internal Server Error\"}").getBytes();
        }

        DataBuffer buffer = response.bufferFactory().wrap(bytes);
        return response.writeWith(Mono.just(buffer));
    }

    private ErrorInfo resolveError(Throwable ex) {
        if (ex instanceof ResponseStatusException) {
            ResponseStatusException rse = (ResponseStatusException) ex;
            return new ErrorInfo(rse.getStatusCode(), rse.getReason() != null
                ? rse.getReason() : "Request Error");
        }
        if (ex instanceof ConnectTimeoutException
            || ex instanceof io.netty.handler.timeout.ReadTimeoutException) {
            return new ErrorInfo(HttpStatus.GATEWAY_TIMEOUT, "下游服务响应超时");
        }
        if (ex instanceof java.net.ConnectException) {
            return new ErrorInfo(HttpStatus.SERVICE_UNAVAILABLE, "下游服务连接失败");
        }
        return new ErrorInfo(HttpStatus.INTERNAL_SERVER_ERROR, "网关内部错误");
    }

    private static class ErrorInfo {
        HttpStatus status;
        String message;
        ErrorInfo(HttpStatus status, String message) {
            this.status = status;
            this.message = message;
        }
    }
}
```

### 8.3 统一错误响应格式

```json
{
  "code": 503,
  "message": "下游服务连接失败",
  "path": "/api/users/123",
  "traceId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "timestamp": 1724567890123
}
```

## 9. 最佳实践总结

| 实践 | 说明 | 反模式 |
|------|------|--------|
| **网关无状态** | 不存储会话，便于水平扩展 | 在 Gateway 中使用 Session |
| **超时递减** | Gateway 超时 < 下游服务超时 | 所有超时设为相同值 |
| **限流分层** | IP → 用户 → API 三层限流 | 只做单维度限流 |
| **灰度按标识** | Header/Cookie/用户 ID 标识 | 随机分流无标识 |
| **跨域网关统一** | 只在 Gateway 配 CORS | 每个服务各配各的 |
| **错误统一格式** | 网关层统一错误 JSON 格式 | 直接返回 Spring 默认错误页 |
| **监控全覆盖** | QPS、延迟、错误率、限流触发次数 | 只监控业务服务 |
| **优雅降级** | 熔断 + 降级 + 限流组合使用 | 只做熔断不做限流 |
