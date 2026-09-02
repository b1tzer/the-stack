# 服务调用

> 微服务之间互相调用是家常便饭，但手写 RestTemplate 的 URL 拼接、序列化、异常处理让人崩溃。本章覆盖三种主流方案：RestTemplate、OpenFeign、WebClient，以及负载均衡策略。

## 1. 三种方案对比

| 维度 | RestTemplate | OpenFeign | WebClient |
|------|-------------|-----------|-----------|
| 编程模型 | 同步阻塞 | 同步阻塞（声明式） | 异步非阻塞 |
| 学习成本 | 低 | 低 | 中等 |
| 代码量 | 多（手动拼装） | 少（接口声明） | 中等 |
| 服务发现 | 需 @LoadBalanced | 内置 | 需 @LoadBalanced |
| 响应式支持 | 不支持 | 不支持 | 原生支持 |
| 适用场景 | 简单调用、遗留系统 | 微服务间调用 | 高并发外部调用 |
| Spring 推荐 | 已标记维护模式 | 推荐 | 推荐 |

## 2. OpenFeign 声明式调用

### 2.1 基础配置

```yaml
spring:
  cloud:
    openfeign:
      client:
        config:
          default:
            connect-timeout: 5000
            read-timeout: 10000
      circuitbreaker:
        enabled: true
```

```java
@SpringBootApplication
@EnableFeignClients
public class OrderApplication {
    public static void main(String[] args) {
        SpringApplication.run(OrderApplication.class, args);
    }
}
```

### 2.2 声明远程服务接口

```java
@FeignClient(
    name = "storage-service",
    fallbackFactory = StorageFallbackFactory.class
)
public interface StorageFeignClient {

    @PostMapping("/api/storage/deduct")
    Result<Void> deduct(@RequestParam("productId") Long productId,
                        @RequestParam("quantity") int quantity);

    @GetMapping("/api/storage/{productId}")
    Result<StorageVO> getStorage(@PathVariable("productId") Long productId);
}
```

### 2.3 FallbackFactory 降级

```java
@Component
@Slf4j
public class StorageFallbackFactory implements FallbackFactory<StorageFeignClient> {

    @Override
    public StorageFeignClient create(Throwable cause) {
        log.error("Storage 服务调用失败，触发降级", cause);

        return new StorageFeignClient() {
            @Override
            public Result<Void> deduct(Long productId, int quantity) {
                return Result.fail("库存服务暂不可用，请稍后重试");
            }

            @Override
            public Result<StorageVO> getStorage(Long productId) {
                return Result.fail("库存服务暂不可用");
            }
        };
    }
}
```

### 2.4 高级配置

```java
@FeignClient(
    name = "user-service",
    configuration = UserFeignConfig.class,
    fallbackFactory = UserClientFallbackFactory.class
)
public interface UserClient {

    @GetMapping("/api/users/{id}")
    User getUser(@PathVariable("id") Long id);

    @PostMapping("/api/users")
    User createUser(@RequestBody User user);

    // 复杂查询参数
    @GetMapping("/api/users")
    Page<User> searchUsers(
        @RequestParam("keyword") String keyword,
        @RequestParam(value = "page", defaultValue = "1") int page,
        @RequestParam(value = "size", defaultValue = "20") int size);

    // 文件上传
    @PostMapping(value = "/api/users/avatar", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    String uploadAvatar(@RequestPart("file") MultipartFile file);
}

// Feign 配置类
public class UserFeignConfig {

    @Bean
    public Request.Options requestOptions() {
        return new Request.Options(
            2, TimeUnit.SECONDS,   // 连接超时
            5, TimeUnit.SECONDS,   // 读取超时
            true
        );
    }

    @Bean
    public ErrorDecoder errorDecoder() {
        return (methodKey, response) -> {
            if (response.status() == 404) {
                return new UserNotFoundException("用户不存在");
            }
            return new RuntimeException("调用 user-service 失败: " + response.status());
        };
    }
}
```

### 2.5 超时设置原则

超时值的计算逻辑：`接口超时 = P99 响应时间 × 安全系数（1.5 ~ 2）`，但不能大于上游能容忍的最大等待时间。

建议：**逐层递减超时**。Gateway 层 10s → OrderService 8s → PaymentService 5s → AccountService 3s。

> **踩坑提醒**：
> - Feign 默认不传递请求头（如 Token），需要配置 `RequestInterceptor`
> - `@PathVariable` 必须指定 `value`，否则在某些版本下参数绑定失败
> - FallbackFactory 和 Fallback 只能选一个，不能同时配置
> - Feign 超时要小于网关超时——避免网关已超时但 Feign 还在等待

## 3. WebClient 响应式调用

Spring WebFlux 的 `WebClient` 是替代 `RestTemplate` 的现代方案，支持非阻塞 I/O、响应式流。

### 3.1 配置

```java
@Configuration
public class WebClientConfig {

    @Bean
    public WebClient webClient(WebClient.Builder builder) {
        return builder
                .baseUrl("https://api.example.com")
                .defaultHeader(HttpHeaders.CONTENT_TYPE, MediaType.APPLICATION_JSON_VALUE)
                .filter(ExchangeFilterFunctions.basicAuthentication("user", "pass"))
                .clientConnector(new ReactorClientHttpConnector(
                    HttpClient.create()
                        .responseTimeout(Duration.ofSeconds(10))
                        .option(ChannelOption.CONNECT_TIMEOUT_MILLIS, 5000)
                ))
                .build();
    }
}
```

### 3.2 使用示例

```java
@Service
@Slf4j
public class ExternalApiService {

    private final WebClient webClient;

    public ExternalApiService(WebClient webClient) {
        this.webClient = webClient;
    }

    /**
     * 调用外部 API，带超时、重试和错误处理
     */
    public Mono<ExternalData> fetchData(String id) {
        return webClient.get()
                .uri("/data/{id}", id)
                .retrieve()
                .onStatus(HttpStatusCode::is4xxClientError, response ->
                    response.bodyToMono(String.class)
                        .flatMap(body -> Mono.error(
                            new BusinessException("请求参数错误: " + body)))
                )
                .onStatus(HttpStatusCode::is5xxServerError, response ->
                    Mono.error(new RuntimeException("外部服务异常: " + response.statusCode()))
                )
                .bodyToMono(ExternalData.class)
                .timeout(Duration.ofSeconds(10))
                .retryWhen(Retry.backoff(3, Duration.ofMillis(500))
                    .maxBackoff(Duration.ofSeconds(5))
                    .filter(ex -> ex instanceof RuntimeException)
                    .onRetryExhaustedThrow((spec, signal) ->
                        new RuntimeException("重试次数已用尽", signal.failure()))
                )
                .doOnError(e -> log.error("调用外部API失败, id={}", id, e))
                .doOnSuccess(data -> log.info("调用外部API成功, id={}", id));
    }

    /**
     * 批量并发调用示例
     */
    public Flux<ExternalData> fetchBatch(List<String> ids) {
        return Flux.fromIterable(ids)
                .parallel(10)                     // 最多 10 个并发
                .runOn(Schedulers.boundedElastic())
                .flatMap(this::fetchData)
                .sequential()
                .collectList()
                .flatMapMany(Flux::fromIterable);
    }
}
```

> **踩坑提醒**：`WebClient` 的 `retrieve()` 默认不处理 4xx/5xx 状态码，必须手动添加 `onStatus()` 处理。

## 4. 负载均衡策略

### 4.1 内置策略

| 策略 | 说明 |
|------|------|
| RoundRobin | 轮询（默认） |
| Random | 随机 |
| WeightedResponseTime | 响应时间权重 |
| BestAvailable | 最小并发 |

### 4.2 自定义负载均衡策略

```java
public class CustomLoadBalancer implements ReactorServiceInstanceLoadBalancer {

    private final AtomicInteger position = new AtomicInteger(0);
    private final String serviceId;
    private final ObjectProvider<ServiceInstanceListSupplier> supplierProvider;

    public CustomLoadBalancer(ObjectProvider<ServiceInstanceListSupplier> supplierProvider,
            String serviceId) {
        this.supplierProvider = supplierProvider;
        this.serviceId = serviceId;
    }

    @Override
    public Mono<Response<ServiceInstance>> choose(Request request) {
        ServiceInstanceListSupplier supplier = supplierProvider.getIfAvailable();
        return supplier.get()
            .next()
            .map(this::getInstanceResponse);
    }

    private Response<ServiceInstance> getInstanceResponse(List<ServiceInstance> instances) {
        if (instances.isEmpty()) {
            return new EmptyResponse();
        }
        int pos = position.incrementAndGet() % instances.size();
        return new DefaultResponse(instances.get(pos));
    }
}
```

### 4.3 指定服务的负载均衡策略

```java
@FeignClient(name = "payment-service", configuration = PaymentFeignConfig.class)
public interface PaymentClient {
    @PostMapping("/api/payment/create")
    PaymentResult createPayment(PaymentRequest request);
}

public class PaymentFeignConfig {

    @Bean
    public ReactorLoadBalancer<ServiceInstance> paymentLoadBalancer(
            Environment environment,
            LoadBalancerClientFactory factory) {
        String name = environment.getProperty(LoadBalancerClientFactory.PROPERTY_NAME);
        return new WeightedResponseTimeLoadBalancer(
            factory.getLazyProvider(name, ServiceInstanceListSupplier.class), name);
    }
}
```

## 5. 最佳实践

1. **默认轮询足够**——大多数场景 Round Robin 就够了
2. **同机房优先**——配置 `zone-preference` 避免跨机房调用
3. **Feign 超时要小于网关超时**——避免网关已超时但 Feign 还在等待
4. **降级必须有**——任何远程调用都可能失败，降级方案是保底
5. **连接池复用**——配置 `OkHttp` 或 `Apache HttpClient` 替代默认的 `HttpURLConnection`
6. **OpenFeign 优先**——声明式调用减少样板代码，Spring 官方推荐
7. **WebClient 用于高并发**——非阻塞 I/O 适合调用外部 API 的场景
