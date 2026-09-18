# API 网关

> 微服务对外暴露几十个端口，前端要记住每个服务的地址和端口——这是 API 网关要解决的第一个问题。但网关的价值远不止"统一入口"：路由转发、负载均衡、认证鉴权、限流、日志，所有横切关注点都可以在网关层统一处理。

## 1. 核心概念

Spring Cloud Gateway 的核心抽象是 **三元组**：

| 组件 | 作用 | 类比 | 典型实现 |
| :-- | :-- | :-- | :-- |
| **Route（路由）** | 定义转发目标地址 | Nginx 的 `location` + `proxy_pass` | `uri: lb://user-service` |
| **Predicate（断言）** | 匹配请求条件 | Nginx 的 `if` 判断 | `Path=/api/users/**` |
| **Filter（过滤器）** | 修改请求/响应 | Servlet 的 `Filter` | `StripPrefix=1` |

```xml
<dependency>
    <groupId>org.springframework.cloud</groupId>
    <artifactId>spring-cloud-starter-gateway</artifactId>
</dependency>
<dependency>
    <groupId>org.springframework.cloud</groupId>
    <artifactId>spring-cloud-starter-loadbalancer</artifactId>
</dependency>
```

## 2. 路由配置

```yaml
server:
  port: 8080

spring:
  cloud:
    gateway:
      routes:
        # 订单服务路由
        - id: order-service
          uri: lb://order-service
          predicates:
            - Path=/api/orders/**
          filters:
            - StripPrefix=1
            - name: RequestRateLimiter
              args:
                redis-rate-limiter.replenishRate: 10
                redis-rate-limiter.burstCapacity: 20

        # 用户服务路由
        - id: user-service
          uri: lb://user-service
          predicates:
            - Path=/api/users/**
            - Method=GET,POST
          filters:
            - StripPrefix=1
            - AddRequestHeader=X-Source, gateway

        # 基于 Header 的路由（灰度）
        - id: beta-route
          uri: lb://user-service-beta
          predicates:
            - Header=X-User-Type, beta
            - Path=/api/users/**
          filters:
            - StripPrefix=1

        # 路径重写
        - id: external-api
          uri: https://api.thirdparty.com
          predicates:
            - Path=/external/**
          filters:
            - RewritePath=/external/(?<segment>.*), /v2/${segment}
```

**路径重写与负载均衡工作流程**：

```
客户端 → GET /api/orders/123
         ↓
Gateway Predicate: Path=/api/orders/**  ✅ 匹配
         ↓
Filter 1: StripPrefix=1 → 路径变为 /orders/123
         ↓
Filter 2: LoadBalancer → 从 order-service 的实例列表中选择一个
         ↓
转发到: http://order-service-instance-2/orders/123
```

> **踩坑提醒**：
> - Gateway 基于 WebFlux（Netty），**不能引入 spring-boot-starter-web**（Tomcat），否则启动报错
> - `lb://` 需要 `spring-cloud-starter-loadbalancer` 依赖，Spring Cloud 2020+ 移除了 Ribbon
> - Predicate 的匹配是 **有序的**，第一个匹配成功的路由会被使用

## 3. 全局过滤器

### 3.1 JWT 认证过滤器

```java
@Component
@Slf4j
public class AuthGlobalFilter implements GlobalFilter, Ordered {

    private final JwtUtil jwtUtil;
    private static final Set<String> WHITE_LIST = Set.of(
            "/api/auth/login",
            "/api/auth/register",
            "/api/health"
    );

    public AuthGlobalFilter(JwtUtil jwtUtil) {
        this.jwtUtil = jwtUtil;
    }

    @Override
    public Mono<Void> filter(ServerWebExchange exchange, GatewayFilterChain chain) {
        String path = exchange.getRequest().getURI().getPath();

        if (WHITE_LIST.stream().anyMatch(path::startsWith)) {
            return chain.filter(exchange);
        }

        String token = exchange.getRequest().getHeaders().getFirst("Authorization");
        if (token == null || !token.startsWith("Bearer ")) {
            exchange.getResponse().setStatusCode(HttpStatus.UNAUTHORIZED);
            return exchange.getResponse().setComplete();
        }

        try {
            Claims claims = jwtUtil.parseToken(token.substring(7));
            ServerWebExchange mutatedExchange = exchange.mutate()
                    .request(r -> r
                            .header("X-User-Id", claims.getSubject())
                            .header("X-User-Role", claims.get("role", String.class))
                    )
                    .build();
            return chain.filter(mutatedExchange);
        } catch (Exception e) {
            exchange.getResponse().setStatusCode(HttpStatus.UNAUTHORIZED);
            return exchange.getResponse().setComplete();
        }
    }

    @Override
    public int getOrder() { return -100; }
}
```

### 3.2 请求日志过滤器

```java
@Component
@Slf4j
public class RequestLogFilter implements GlobalFilter, Ordered {

    @Override
    public Mono<Void> filter(ServerWebExchange exchange, GatewayFilterChain chain) {
        long startTime = System.currentTimeMillis();
        ServerHttpRequest request = exchange.getRequest();

        log.info("→ {} {} from {}",
                request.getMethod(),
                request.getURI().getPath(),
                request.getRemoteAddress());

        return chain.filter(exchange).then(Mono.fromRunnable(() -> {
            long duration = System.currentTimeMillis() - startTime;
            int statusCode = exchange.getResponse().getStatusCode() != null
                    ? exchange.getResponse().getStatusCode().value() : 0;

            log.info("← {} {} → {} ({}ms)",
                    request.getMethod(),
                    request.getURI().getPath(),
                    statusCode,
                    duration);
        }));
    }

    @Override
    public int getOrder() { return -200; }
}
```

**Filter 执行顺序**：

```
请求进入
  ↓
Gateway Filter（配置在路由上的 Filter）
  ↓
Global Filter（全局过滤器，按 Order 值从小到大执行）
  ↓
转发到下游服务
  ↓
Global Filter 响应阶段（按 Order 值从大到小执行）
  ↓
Gateway Filter 响应阶段
  ↓
响应返回客户端
```

## 4. 限流配置

### 4.1 基于 Redis 的令牌桶

```java
@Configuration
public class RateLimiterConfig {

    @Bean
    public KeyResolver userKeyResolver() {
        return exchange -> Mono.justOrEmpty(
            exchange.getRequest().getHeaders().getFirst("X-User-Id")
        ).defaultIfEmpty("anonymous");
    }

    @Bean
    public KeyResolver ipKeyResolver() {
        return exchange -> Mono.just(
            Objects.requireNonNull(
                exchange.getRequest().getRemoteAddress()
            ).getAddress().getHostAddress()
        );
    }
}
```

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
            - name: RequestRateLimiter
              args:
                redis-rate-limiter.replenishRate: 10
                redis-rate-limiter.burstCapacity: 20
                key-resolver: "#{@ipKeyResolver}"
```

### 4.2 限流算法对比

| 特性 | 令牌桶（Token Bucket） | 漏桶（Leaky Bucket） |
| :-- | :-- | :-- |
| **原理** | 桶中存放令牌，请求取走令牌才放行 | 请求进入桶，以固定速率流出处理 |
| **突发流量** | ✅ 允许突发 | ❌ 严格匀速 |
| **适用场景** | API 网关、用户请求限流 | 流量整形、削峰填谷 |
| **Gateway 默认** | ✅ 使用令牌桶 | — |

## 5. 熔断集成

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

## 6. 灰度路由（金丝雀发布）

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

## 7. 跨域配置（CORS）

```yaml
spring:
  cloud:
    gateway:
      globalcors:
        cors-configurations:
          '[/**]':
            allowedOriginPatterns: "*"
            allowedMethods:
              - GET
              - POST
              - PUT
              - DELETE
              - OPTIONS
            allowedHeaders: "*"
            exposedHeaders:
              - X-Request-Id
              - X-Response-Time
            allowCredentials: true
            maxAge: 3600
```

> ⚠️ **注意**：Gateway 基于 WebFlux，不能使用 Spring MVC 的 `@CrossOrigin` 注解和 `WebMvcConfigurer`。

## 8. 全局异常处理

```java
@Component
@Order(-1)
public class GatewayExceptionHandler implements ErrorWebExceptionHandler {

    @Override
    public Mono<Void> handle(ServerWebExchange exchange, Throwable ex) {
        ServerHttpResponse response = exchange.getResponse();
        if (response.isCommitted()) {
            return Mono.error(ex);
        }

        ErrorInfo errorInfo = resolveError(ex);
        response.setStatusCode(errorInfo.status);
        response.getHeaders().setContentType(MediaType.APPLICATION_JSON);

        Map<String, Object> body = new LinkedHashMap<>();
        body.put("code", errorInfo.status.value());
        body.put("message", errorInfo.message);
        body.put("path", exchange.getRequest().getPath().value());
        body.put("timestamp", System.currentTimeMillis());

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
        if (ex instanceof ResponseStatusException rse) {
            return new ErrorInfo(rse.getStatusCode(),
                rse.getReason() != null ? rse.getReason() : "Request Error");
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
}
```

## 9. 最佳实践总结

| 实践 | 说明 | 反模式 |
| :-- | :-- | :-- |
| **网关无状态** | 不存储会话，便于水平扩展 | 在 Gateway 中使用 Session |
| **超时递减** | Gateway 超时 < 下游服务超时 | 所有超时设为相同值 |
| **限流分层** | IP → 用户 → API 三层限流 | 只做单维度限流 |
| **灰度按标识** | Header/Cookie/用户 ID 标识 | 随机分流无标识 |
| **跨域网关统一** | 只在 Gateway 配 CORS | 每个服务各配各的 |
| **错误统一格式** | 网关层统一错误 JSON 格式 | 直接返回默认错误页 |
| **监控全覆盖** | QPS、延迟、错误率、限流触发次数 | 只监控业务服务 |
| **优雅降级** | 熔断 + 降级 + 限流组合使用 | 只做熔断不做限流 |
