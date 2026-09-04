# WebFlux 响应式编程

> Spring MVC 的线程模型是「一请求一线程」：200 个并发请求就需要 200 个线程。线程消耗内存（每个约 1MB 栈空间），切换消耗 CPU。当并发量到达万级，阻塞模型的瓶颈不在业务逻辑，而在线程等待——等数据库、等下游 HTTP、等磁盘 IO。WebFlux 换了一种思路：不给每个请求分配线程，而是用少量线程通过事件驱动处理所有请求。

## 1. 阻塞模型的瓶颈

```txt
Spring MVC 线程模型：
┌─────────────────────────────────────────────────┐
│ Tomcat 线程池 (默认 200 线程)                     │
│                                                 │
│  请求1 ──→ [线程1] ──→ 查询数据库(50ms) ──→ 返回   │
│  请求2 ──→ [线程2] ──→ 调用下游(200ms) ──→ 返回    │
│  请求3 ──→ [线程3] ──→ 查询数据库(80ms) ──→ 返回    │
│  ...                                            │
│  请求201 ──→ [等待...] ──→ 线程池满，排队           │
└─────────────────────────────────────────────────┘

问题：线程在等 IO 时被白白占用，不能处理其他请求
```

```txt
WebFlux 事件驱动模型：
┌─────────────────────────────────────────────────┐
│ Event Loop 线程数 = CPU 核心数                    │
│                                                 │
│  请求1 ──→ 发送SQL ──→ 释放线程                    │
│  请求2 ──→ 发送HTTP ──→ 释放线程                   │
│  ...                                            │
│  数据库响应回来 ──→ 回调处理请求1                   │
│  下游响应回来 ──→ 回调处理请求2                     │
└─────────────────────────────────────────────────┘

优势：线程不等待 IO，少量线程处理大量并发
```

## 2. Reactor 响应式库

WebFlux 基于 Reactor 库，核心类型是 `Mono<T>` 和 `Flux<T>`：

| 类型 | 含义 | 类比 |
| :-- | :-- | :-- |
| `Mono<T>` | 0 或 1 个元素的异步序列 | `Optional<T>` 的异步版 |
| `Flux<T>` | 0 到 N 个元素的异步序列 | `Stream<T>` 的异步版 |

### 2.1 创建

```java
// Mono 创建
Mono<String> mono1 = Mono.just("hello");
Mono<String> mono2 = Mono.empty();                    // 空序列
Mono<String> mono3 = Mono.error(new RuntimeException()); // 错误信号
Mono<String> mono4 = Mono.fromCallable(() -> expensiveCompute());
Mono<String> mono5 = Mono.fromFuture(comtableFuture);
Mono<String> mono6 = Mono.defer(() -> Mono.just(dynamicValue())); // 延迟创建

// Flux 创建
Flux<Integer> flux1 = Flux.range(1, 10);
Flux<String> flux2 = Flux.fromIterable(List.of("a", "b", "c"));
Flux<Long> flux3 = Flux.interval(Duration.ofSeconds(1)); // 定时发射
Flux<String> flux4 = Flux.just("a", "b", "c");
Flux<Integer> flux5 = Flux.fromStream(Stream.of(1, 2, 3));
```

### 2.2 核心操作符

```java
// ===== 转换 =====
flux.map(x -> x * 2)                    // 同步转换
    .flatMap(x -> asyncCall(x))          // 异步转换（可能改变顺序）
    .concatMap(x -> asyncCall(x))        // 异步转换（保持顺序）

// ===== 过滤 =====
flux.filter(x -> x > 5)                 // 条件过滤
    .distinct()                          // 去重
    .take(5)                             // 取前 N 个
    .skip(3)                             // 跳过前 N 个

// ===== 组合 =====
Flux.merge(flux1, flux2)                // 合并（交错）
Flux.concat(flux1, flux2)               // 拼接（顺序）
Mono.zip(mono1, mono2, mono3)           // 等所有完成，合并结果

// ===== 错误处理 =====
flux.onErrorReturn(fallbackValue)       // 出错返回默认值
flux.onErrorResume(ex -> fallback())    // 出错执行备用逻辑
flux.retry(3)                           // 重试 N 次
flux.timeout(Duration.ofSeconds(5))     // 超时

// ===== 调度 =====
flux.subscribeOn(Schedulers.boundedElastic())  // 订阅线程池
flux.publishOn(Schedulers.parallel())          // 后续操作线程池

// ===== 终止操作 =====
flux.subscribe(value -> {}, error -> {}, () -> {});
flux.blockFirst();                      // 阻塞获取第一个（仅测试用）
flux.blockLast();                       // 阻塞获取最后一个（仅测试用）
flux.collectList().block();             // 转 List（仅测试用）
```

### 2.3 背压 (Backpressure)

背压是响应式流的核心机制——消费者告诉生产者「我处理不过来了，慢点发」：

```java
// 生产者快，消费者慢
Flux.range(1, 1_000_000)
    .onBackpressureBuffer(100)           // 缓冲 100 个，满了报错
    // .onBackpressureDrop()            // 丢弃多余的
    // .onBackpressureLatest()          // 只保留最新的
    .subscribe(
        item -> slowProcess(item),
        error -> log.error("错误", error),
        () -> log.info("完成")
    );
```

```txt
背压策略：
┌──────────┐   ┌──────────────────┐   ┌──────────┐
│ 生产者    │──→│  缓冲区 / 策略     │──→│ 消费者    │
│ (快)     │   │ buffer/drop/latest│  │ (慢)      │
└──────────┘   └──────────────────┘   └──────────┘
```

## 3. 编程模型

WebFlux 提供两套写法，处理的是同一个 HTTP 请求，区别在于「请求怎么映射到处理方法」。注解式复用 MVC 的注解体系，函数式用纯函数描述路由。

实际落地时，绝大多数团队选注解式——它让 MVC 代码几乎零改动就能跑在响应式容器上。函数式是为「注解不够用」准备的逃生舱，不是默认推荐。

| 对比项 | 注解式 | 函数式 |
| :-- | :-- | :-- |
| 路由声明 | `@RequestMapping` 等注解 | `RouterFunction` 纯函数 |
| 处理方法 | 注解方法，返回 `Mono`/`Flux` | `HandlerFunction` 纯函数 |
| 校验/绑定 | 注解自动处理 | 需手动在 Handler 里做 |
| 适用场景 | 绝大多数业务 | 需精细控制路由逻辑 |

### 3.1 注解式（推荐）

写法和 MVC 几乎一致，唯一区别是方法返回 `Mono<T>` 或 `Flux<T>` 而非裸对象。Spring 据此判断「这个接口是响应式的」，把整个调用链挂到事件循环上，而不是开一个线程阻塞等待。

下面这段代码有几个值得注意的点：

- `getUser` 用 `defaultIfEmpty` 把空结果转成 404，而不是返回 null；
- `createUser` 的入参直接声明 `@RequestBody Mono<CreateUserDTO>`，请求体在反序列化完成前就以响应式信号存在，校验和转换都发生在管道里；
- `getUserDetail` 是并发调用的典型写法——三个 `Mono` 各自发起（其中两个是 WebClient 远程调用），`Mono.zip` 等它们全部完成再合并，全程不阻塞任何线程。

```java
@RestController
@RequestMapping("/api/users")
public class UserController {

    private final UserRepository userRepository;
    private final WebClient webClient;

    public UserController(UserRepository userRepository, WebClient.Builder builder) {
        this.userRepository = userRepository;
        this.webClient = builder.baseUrl("http://order-service").build();
    }

    // 返回类型是 Mono/Flux，而非直接对象
    @GetMapping
    public Flux<User> listUsers() {
        return userRepository.findAll();
    }

    @GetMapping("/{id}")
    public Mono<ResponseEntity<User>> getUser(@PathVariable Long id) {
        return userRepository.findById(id)
                .map(ResponseEntity::ok)
                .defaultIfEmpty(ResponseEntity.notFound().build());
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public Mono<User> createUser(@Valid @RequestBody Mono<CreateUserDTO> dtoMono) {
        return dtoMono
                .map(this::toEntity)
                .flatMap(userRepository::save);
    }

    // 并发调用多个下游服务
    @GetMapping("/{id}/detail")
    public Mono<UserDetailVO> getUserDetail(@PathVariable Long id) {
        Mono<User> userMono = userRepository.findById(id);
        Mono<List<Order>> ordersMono = webClient.get()
                .uri("/api/orders?userId={id}", id)
                .retrieve()
                .bodyToFlux(Order.class)
                .collectList();
        Mono<List<Point>> pointsMono = webClient.get()
                .uri("/api/points?userId={id}", id)
                .retrieve()
                .bodyToFlux(Point.class)
                .collectList();

        // 三个请求并发执行，全部完成后合并结果
        return Mono.zip(userMono, ordersMono, pointsMono)
                .map(tuple -> new UserDetailVO(tuple.getT1(), tuple.getT2(), tuple.getT3()));
    }
}
```

### 3.2 函数式

函数式把「路由」和「处理」拆成两块：`RouterConfig` 用 `RouterFunctions.route()` 声明路径到 Handler 的映射，`UserHandler` 是纯函数，接收 `ServerRequest`、返回 `Mono<ServerResponse>`。

它没有注解的自动魔法——`getUser` 里要自己 `Long.valueOf(request.pathVariable("id"))` 取参、`switchIfEmpty` 处理查不到，`createUser` 里要手动 `bodyToMono` 解析请求体。代码更啰嗦，但路由逻辑完全暴露成可组合的函数，适合需要对匹配规则做精细控制的场景。

```java
// 路由配置
@Configuration
public class RouterConfig {

    @Bean
    public RouterFunction<ServerResponse> userRoutes(UserHandler handler) {
        return RouterFunctions.route()
                .path("/api/users", builder -> builder
                        .GET("", handler::listUsers)
                        .GET("/{id}", handler::getUser)
                        .POST("", handler::createUser)
                        .PUT("/{id}", handler::updateUser)
                        .DELETE("/{id}", handler::deleteUser))
                .build();
    }
}

// Handler
@Component
public class UserHandler {

    private final UserRepository userRepository;

    public Mono<ServerResponse> listUsers(ServerRequest request) {
        return ServerResponse.ok()
                .contentType(MediaType.APPLICATION_JSON)
                .body(userRepository.findAll(), User.class);
    }

    public Mono<ServerResponse> getUser(ServerRequest request) {
        Long id = Long.valueOf(request.pathVariable("id"));
        return userRepository.findById(id)
                .flatMap(user -> ServerResponse.ok()
                        .contentType(MediaType.APPLICATION_JSON)
                        .bodyValue(user))
                .switchIfEmpty(ServerResponse.notFound().build());
    }

    public Mono<ServerResponse> createUser(ServerRequest request) {
        return request.bodyToMono(CreateUserDTO.class)
                .flatMap(dto -> userRepository.save(toEntity(dto)))
                .flatMap(user -> ServerResponse
                        .created(URI.create("/api/users/" + user.getId()))
                        .bodyValue(user));
    }
}
```

## 4. WebClient（响应式 HTTP 客户端）

WebClient 替代 RestTemplate，是非阻塞的 HTTP 客户端：

```java
@Configuration
public class WebClientConfig {

    @Bean
    public WebClient.Builder webClientBuilder() {
        return WebClient.builder()
                .baseUrl("http://user-service")
                .defaultHeader(HttpHeaders.CONTENT_TYPE, MediaType.APPLICATION_JSON_VALUE)
                .filter(ExchangeFilterFunctions.basicAuthentication("user", "pass"))
                .codecs(config -> config.defaultCodecs().maxInMemorySize(16 * 1024 * 1024));
    }
}

@Service
public class UserServiceClient {

    private final WebClient webClient;

    public UserServiceClient(WebClient.Builder builder) {
        this.webClient = builder.baseUrl("http://user-service").build();
    }

    // GET
    public Mono<User> getUser(Long id) {
        return webClient.get()
                .uri("/api/users/{id}", id)
                .retrieve()
                .bodyToMono(User.class);
    }

    // GET 列表
    public Flux<User> listUsers() {
        return webClient.get()
                .uri("/api/users")
                .retrieve()
                .bodyToFlux(User.class);
    }

    // POST
    public Mono<User> createUser(CreateUserDTO dto) {
        return webClient.post()
                .uri("/api/users")
                .bodyValue(dto)
                .retrieve()
                .bodyToMono(User.class);
    }

    // 错误处理
    public Mono<User> getUserSafe(Long id) {
        return webClient.get()
                .uri("/api/users/{id}", id)
                .retrieve()
                .onStatus(HttpStatusCode::is4xxClientError, resp ->
                        Mono.error(new UserNotFoundException(id)))
                .onStatus(HttpStatusCode::is5xxClientError, resp ->
                        Mono.error(new ServiceUnavailableException()))
                .bodyToMono(User.class)
                .timeout(Duration.ofSeconds(3))
                .retryWhen(Retry.backoff(3, Duration.ofMillis(500)));
    }

    // 流式接收（SSE）
    public Flux<UserEvent> streamEvents() {
        return webClient.get()
                .uri("/api/events")
                .accept(MediaType.TEXT_EVENT_STREAM)
                .retrieve()
                .bodyToFlux(UserEvent.class);
    }
}
```

## 5. 错误处理

### 5.1 操作符级错误处理

```java
@Service
public class UserService {

    // 出错返回默认值
    public Mono<User> getUserOrDefault(Long id) {
        return userRepository.findById(id)
                .onErrorReturn(User.anonymous());
    }

    // 出错执行备用逻辑
    public Mono<User> getUserWithFallback(Long id) {
        return userRepository.findById(id)
                .onErrorResume(ex -> {
                    log.warn("主库查询失败，查缓存", ex);
                    return cacheService.getUser(id);
                });
    }

    // 出错记录并继续
    public Flux<User> getAllUsersSafe() {
        return userRepository.findAll()
                .onErrorContinue((ex, item) -> {
                    log.error("处理 {} 失败", item, ex);
                });
    }

    // 超时 + 重试
    public Mono<User> getUserWithRetry(Long id) {
        return userRepository.findById(id)
                .timeout(Duration.ofSeconds(3))
                .retryWhen(Retry.backoff(3, Duration.ofMillis(500))
                        .filter(ex -> ex instanceof TimeoutException)
                        .onRetryExhaustedThrow((spec, signal) ->
                                new ServiceUnavailableException()));
    }
}
```

### 5.2 全局异常处理

```java
// 注解式
@RestControllerAdvice
public class GlobalExceptionHandler {

    @ExceptionHandler(UserNotFoundException.class)
    public Mono<ResponseEntity<ErrorResponse>> handleNotFound(UserNotFoundException ex) {
        return Mono.just(ResponseEntity.status(404)
                .body(new ErrorResponse("USER_NOT_FOUND", ex.getMessage())));
    }

    @ExceptionHandler(WebExchangeBindException.class)
    public Mono<ResponseEntity<ErrorResponse>> handleValidation(WebExchangeBindException ex) {
        String message = ex.getFieldErrors().stream()
                .map(f -> f.getField() + ": " + f.getDefaultMessage())
                .collect(Collectors.joining(", "));
        return Mono.just(ResponseEntity.badRequest()
                .body(new ErrorResponse("VALIDATION_ERROR", message)));
    }
}

// 函数式（WebExceptionHandler）
@Component
@Order(-2)  // 优先级高于默认的异常处理器
public class FunctionalExceptionHandler implements WebExceptionHandler {

    @Override
    public Mono<Void> handle(ServerWebExchange exchange, Throwable ex) {
        if (exchange.getResponse().isCommitted()) {
            return Mono.error(ex);
        }

        HttpStatus status = HttpStatus.INTERNAL_SERVER_ERROR;
        String message = ex.getMessage();

        if (ex instanceof UserNotFoundException) {
            status = HttpStatus.NOT_FOUND;
        } else if (ex instanceof ServerWebInputException) {
            status = HttpStatus.BAD_REQUEST;
        }

        exchange.getResponse().setStatusCode(status);
        exchange.getResponse().getHeaders().setContentType(MediaType.APPLICATION_JSON);

        ErrorResponse error = new ErrorResponse(status.name(), message);
        byte[] bytes = new ObjectMapper().writeValueAsBytes(error);
        DataBuffer buffer = exchange.getResponse().bufferFactory().wrap(bytes);
        return exchange.getResponse().writeWith(Mono.just(buffer));
    }
}
```

## 6. 阻塞操作隔离

WebFlux 中调用阻塞 API（JDBC、旧版 SDK）必须隔离到专用线程池：

```java
@Service
public class HybridUserService {

    private final UserRepository reactiveRepo;      // R2DBC
    private final LegacyUserDao legacyDao;           // JDBC（阻塞）

    // 方案一：subscribeOn 隔离
    public Mono<User> getUserHybrid(Long id) {
        return reactiveRepo.findById(id)
                .switchIfEmpty(
                    Mono.fromCallable(() -> legacyDao.findById(id))  // 阻塞调用
                        .subscribeOn(Schedulers.boundedElastic())    // 隔离到弹性线程池
                );
    }

    // 方案二：包装阻塞调用
    public Flux<User> searchFromLegacy(String keyword) {
        return Flux.defer(() -> Flux.fromIterable(legacyDao.search(keyword)))
                .subscribeOn(Schedulers.boundedElastic());
    }
}
```

`Schedulers.boundedElastic()` 特点：
- 线程数有上限（默认 10 × CPU 核心数）
- 队列有容量限制
- 空闲线程 60 秒后回收
- 适合 IO 密集型阻塞操作

## 7. WebFlux 测试

```java
@WebFluxTest(UserController.class)
class UserControllerTest {

    @Autowired
    private WebTestClient webClient;

    @MockBean
    private UserRepository userRepository;

    @Test
    void shouldGetUser() {
        when(userRepository.findById(1L))
                .thenReturn(Mono.just(new User(1L, "张三", "zhangsan@example.com")));

        webClient.get().uri("/api/users/1")
                .exchange()
                .expectStatus().isOk()
                .expectBody()
                .jsonPath("$.name").isEqualTo("张三")
                .jsonPath("$.email").isEqualTo("zhangsan@example.com");
    }

    @Test
    void shouldReturn404WhenNotFound() {
        when(userRepository.findById(999L)).thenReturn(Mono.empty());

        webClient.get().uri("/api/users/999")
                .exchange()
                .expectStatus().isNotFound();
    }

    @Test
    void shouldCreateUser() {
        User saved = new User(1L, "李四", "lisi@example.com");
        when(userRepository.save(any())).thenReturn(Mono.just(saved));

        webClient.post().uri("/api/users")
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue(new CreateUserDTO("李四", "lisi@example.com"))
                .exchange()
                .expectStatus().isCreated()
                .expectBody()
                .jsonPath("$.id").isEqualTo(1)
                .jsonPath("$.name").isEqualTo("李四");
    }

    @Test
    void shouldStreamUsers() {
        when(userRepository.findAll()).thenReturn(Flux.just(
                new User(1L, "张三", "a@test.com"),
                new User(2L, "李四", "b@test.com")
        ));

        webClient.get().uri("/api/users")
                .exchange()
                .expectStatus().isOk()
                .expectBodyList(User.class)
                .hasSize(2);
    }
}
```

## 8. 依赖

```xml
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-webflux</artifactId>
</dependency>
```

> ⚠️ `spring-boot-starter-web` 和 `spring-boot-starter-webflux` 不能同时引入，否则默认使用 MVC。

## 9. WebFlux vs MVC 选择

```txt
需要 WebFlux 吗？
│
├── 并发量 > 1000？ ─── 否 → MVC
│
├── 有大量 IO 等待？ ─── 否 → MVC
│
├── 需要流式响应？ ─── 是 → WebFlux
│
├── 团队熟悉响应式？ ─── 否 → MVC + 异步(@Async)
│
└── 以上都是 → WebFlux
```

| 场景 | 选择 | 理由 |
| :-- | :-- | :-- |
| 传统 CRUD | MVC | 生态成熟，学习成本低 |
| 高并发网关 | WebFlux | 非阻塞，少量线程处理大量连接 |
| 流式数据 | WebFlux | Flux 天然支持 SSE/WebSocket 流 |
| 调用多个下游 | WebFlux | `Mono.zip` 并发调用，不阻塞 |
| 团队新手 | MVC | 强行用 WebFlux 反而增加 Bug |
| 已有阻塞代码 | MVC | 改造成本大，收益不确定 |

**最佳实践：**

1. **不要在 WebFlux 中调用阻塞 API**——用 `subscribeOn(Schedulers.boundedElastic())` 隔离
2. **错误处理用操作符**——`onErrorResume` / `onErrorReturn` / `retryWhen`，而非 try-catch
3. **调试用 `log()` 操作符**——追踪 Mono/Flux 的订阅、元素、错误信号
4. **不要随意 `block()`**——只有在非响应式上下文（如 main 方法、测试）中才用
5. **保持管道简洁**——复杂的响应式链用 `flatMap` 拆分成小方法
6. **WebClient 优于 RestTemplate**——即使在 MVC 中，WebClient 也支持非阻塞调用
