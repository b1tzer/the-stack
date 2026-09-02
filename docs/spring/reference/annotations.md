# Spring Boot 配置速查

## application.yml 核心配置

### 服务配置

```yaml
server:
  port: 8080
  servlet:
    context-path: /api
  tomcat:
    max-threads: 200
    min-spare-threads: 10
    max-connections: 8192
    accept-count: 100
    connection-timeout: 20000
```

### 数据源配置

```yaml
spring:
  datasource:
    url: jdbc:mysql://localhost:3306/mydb?useUnicode=true&characterEncoding=utf-8
    username: root
    password: ${DB_PASSWORD}
    hikari:
      maximum-pool-size: 20
      minimum-idle: 5
      idle-timeout: 600000
      max-lifetime: 1800000
      connection-timeout: 30000
```

### Redis 配置

```yaml
spring:
  data:
    redis:
      host: localhost
      port: 6379
      password: ${REDIS_PASSWORD}
      lettuce:
        pool:
          max-active: 20
          max-idle: 10
          min-idle: 5
```

### Kafka 配置

```yaml
spring:
  kafka:
    bootstrap-servers: localhost:9092
    producer:
      acks: all
      retries: 3
      batch-size: 65536
      linger-ms: 10
    consumer:
      group-id: my-app
      auto-offset-reset: earliest
      enable-auto-commit: false
```

### 日志配置

```yaml
logging:
  level:
    root: INFO
    com.example: DEBUG
    org.springframework.web: DEBUG
  pattern:
    console: "%d{yyyy-MM-dd HH:mm:ss} [%thread] %-5level %logger{36} - %msg%n"
  file:
    name: logs/app.log
    max-size: 100MB
    max-history: 30
```

## 常用注解速查

| 注解 | 说明 |
|------|------|
| `@SpringBootApplication` | 启动类注解（含 @Configuration + @EnableAutoConfiguration + @ComponentScan） |
| `@RestController` | RESTful 控制器 |
| `@RequestMapping` | URL 映射 |
| `@GetMapping` / `@PostMapping` | HTTP 方法映射 |
| `@PathVariable` | URL 路径变量 |
| `@RequestParam` | 查询参数 |
| `@RequestBody` | 请求体 |
| `@ResponseBody` | 响应体 |
| `@Service` | 服务层 |
| `@Repository` | 数据访问层 |
| `@Component` | 通用组件 |
| `@Autowired` | 依赖注入 |
| `@Value` | 配置值注入 |
| `@ConfigurationProperties` | 类型安全的配置绑定 |
| `@Transactional` | 事务管理 |
| `@Cacheable` / `@CacheEvict` | 缓存 |
| `@Async` | 异步方法 |
| `@Scheduled` | 定时任务 |
| `@ExceptionHandler` | 异常处理 |
| `@ControllerAdvice` | 全局异常处理 |
| `@Validated` | 参数校验 |
