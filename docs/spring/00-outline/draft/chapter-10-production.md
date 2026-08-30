# 第 10 章：生产化与部署

> 代码写完只是开始，让它在生产环境稳定运行才是真正的考验。一个"Hello World"级的 Spring Boot 应用和一个扛住万级 QPS 的生产服务之间，差的不是代码质量，而是连接池调优、JVM 参数、容器化、CI/CD 流水线、部署策略这些"脏活累活"。本章把这些经验值一次性给你。

---

## 10.1 连接池与容器调优

### 10.1.1 HikariCP 参数调优

Spring Boot 默认使用 HikariCP 作为数据库连接池——它的性能确实强，但默认参数几乎不可能适合你的生产环境。**最大连接数设错了，不是浪费资源就是压垮数据库**。

**最大连接数计算公式（PostgreSQL 官方推荐）：**

```
maximum-pool-size = (CPU 核心数 * 2) + 有效磁盘数
```

对于 8 核 SSD 服务器：`(8 * 2) + 1 = 17`，一般设 **20** 左右。但这只是起点，实际要根据数据库承受能力调整。

```yaml
# application-prod.yml
spring:
  datasource:
    url: jdbc:mysql://10.0.1.100:3306/order_db?useSSL=false&serverTimezone=Asia/Shanghai
    username: ${DB_USERNAME}
    password: ${DB_PASSWORD}
    hikari:
      # 核心参数
      maximum-pool-size: 20               # 最大连接数（不是越大越好）
      minimum-idle: 5                     # 最小空闲连接（建议 = maximum-pool-size / 4）
      connection-timeout: 3000            # 获取连接超时时间（ms）
      max-lifetime: 1800000               # 连接最大存活时间（30 分钟，必须 < MySQL wait_timeout）
      idle-timeout: 600000                # 空闲连接超时（10 分钟）
      keepalive-time: 300000              # 连接保活间隔（5 分钟）

      # 性能优化
      pool-name: OrderHikariPool          # 连接池名称（方便日志识别）
      auto-commit: true                   # 自动提交
      validation-timeout: 1000            # 连接验证超时
      leak-detection-threshold: 60000     # 连接泄漏检测阈值（60 秒未归还则告警）
```

```java
/**
 * 通过编程方式监控 HikariCP 连接池状态
 * 生产环境建议接入 Prometheus + Grafana
 */
@Component
@Slf4j
@Scheduled(fixedRate = 30000)  // 每 30 秒采集一次
public class HikariPoolMonitor {

    private final DataSource dataSource;

    public HikariPoolMonitor(DataSource dataSource) {
        this.dataSource = dataSource;
    }

    public void monitor() {
        if (dataSource instanceof HikariDataSource hikari) {
            HikariPoolMXBean pool = hikari.getHikariPoolMXBean();
            if (pool != null) {
                log.info("HikariCP Pool [{}] - Active: {}, Idle: {}, Waiting: {}, Total: {}",
                        hikari.getPoolName(),
                        pool.getActiveConnections(),
                        pool.getIdleConnections(),
                        pool.getThreadsAwaitingConnection(),
                        pool.getTotalConnections());
            }
        }
    }
}
```

**HikariCP 关键参数速查表：**

| 参数 | 默认值 | 推荐值 | 说明 |
|------|--------|--------|------|
| maximum-pool-size | 10 | 20 | 最大连接数 |
| minimum-idle | = maximum-pool-size | 5 | 最小空闲连接 |
| connection-timeout | 30000ms | 3000ms | 获取连接等待超时 |
| max-lifetime | 1800000ms | 1800000ms | 连接最大存活时间 |
| idle-timeout | 600000ms | 600000ms | 空闲连接回收时间 |
| leak-detection-threshold | 0（禁用） | 60000ms | 连接泄漏检测 |

**踩坑提醒：**
- `max-lifetime` 必须小于数据库的 `wait_timeout`（MySQL 默认 8 小时），否则数据库端已关闭连接，HikariCP 还在使用，导致 `Communications link failure`
- `minimum-idle` 和 `maximum-pool-size` 设成一样可以避免连接数频繁伸缩（高并发场景推荐）
- `connection-timeout` 不要设太长——获取不到连接时快速失败比让用户等 30 秒体验好得多

---

### 10.1.2 Tomcat 线程池调优

Spring Boot 内嵌的 Tomcat 线程池是处理 HTTP 请求的"工人"，线程数太少扛不住流量，太多则上下文切换开销飙升。**关键是找到线程数和连接数的平衡点**。

```yaml
server:
  tomcat:
    # 线程池配置
    threads:
      max: 200                        # 最大工作线程数（默认 200）
      min-spare: 10                   # 最小空闲线程（默认 10）
    accept-count: 100                 # 等待队列长度（所有线程忙时，新请求排队）
    max-connections: 10000            # 最大连接数（NIO 默认 10000）
    connection-timeout: 5000          # 连接超时（ms）

    # 访问日志
    accesslog:
      enabled: true
      directory: /var/log/app
      pattern: "%h %l %u %t \"%r\" %s %b %D"  # %D = 请求处理时间（ms）
      prefix: access
      suffix: .log
      rotate: true
      max-days: 30
```

**线程池与连接池配合的工作流：**

```
HTTP 请求 → accept-count 队列 → Tomcat 线程处理
                                      ↓
                                从 HikariCP 获取 DB 连接
                                      ↓
                                执行 SQL → 返回连接
                                      ↓
                                线程归还 → 响应客户端
```

**线程数计算模型（Little's Law）：**

```
最优线程数 = QPS × 平均响应时间（秒）

示例：QPS = 500，平均 RT = 200ms
最优线程数 = 500 × 0.2 = 100

如果 RT 主要来自 DB 查询：
  DB 连接数 = 20（HikariCP）
  每个连接平均占用时间 = 50ms
  DB 瓶颈 QPS = 20 / 0.05 = 400
  → 应用 QPS 不能超过 400，增加线程数没用
```

```java
/**
 * 自定义 Tomcat 线程池（需要更精细控制时）
 */
@Configuration
public class TomcatConfig {

    @Bean
    public WebServerFactoryCustomizer<TomcatServletWebServerFactory> tomcatCustomizer() {
        return factory -> {
            factory.addConnectorCustomizers(connector -> {
                ProtocolHandler handler = connector.getProtocolHandler();
                if (handler instanceof AbstractProtocol<?> protocol) {
                    // 设置线程池参数
                    protocol.setMaxThreads(200);
                    protocol.setMinSpareThreads(10);
                    protocol.setAcceptCount(100);
                    protocol.setConnectionTimeout(5000);
                    // 开启 NIO（默认已开启）
                    // protocol.setProtocol("org.apache.coyote.http11.Http11NioProtocol");
                }
            });
        };
    }
}
```

**踩坑提醒：**
- `threads.max` 不是越大越好——超过 200 个线程时，上下文切换成本可能超过并发收益
- `accept-count` 是 Tomcat 的"缓冲区"，满了之后新连接直接被拒绝（`Connection refused`）
- 如果你的服务是 **CPU 密集型**（如图片处理），线程数应该接近 CPU 核心数

---

### 10.1.3 JVM 参数调优

Spring Boot 应用跑在 JVM 上，JVM 参数直接决定了内存使用、GC 停顿时间和吞吐量。**不调 JVM 参数就像开车不看仪表盘——可能一直没事，也可能突然爆缸**。

```bash
# 生产环境推荐 JVM 参数（16GB 内存服务器）
java -jar app.jar \
  # 堆内存
  -Xms4g \                          # 初始堆大小（建议 = Xmx，避免动态扩缩）
  -Xmx4g \                          # 最大堆大小（物理内存的 50-75%）
  -Xmn2g \                          # 新生代大小（堆的 1/3 到 1/2）

  # 元空间（替代 PermGen）
  -XX:MetaspaceSize=256m \
  -XX:MaxMetaspaceSize=512m \

  # GC 策略 —— G1（推荐，Java 11+ 默认）
  -XX:+UseG1GC \
  -XX:MaxGCPauseMillis=200 \        # 目标最大 GC 停顿时间（ms）
  -XX:G1HeapRegionSize=8m \         # G1 区域大小
  -XX:InitiatingHeapOccupancyPercent=45 \  # 触发并发标记的堆占用率
  -XX:G1ReservePercent=15 \         # 预留内存防止 to-space 溢出

  # GC 日志（Java 11+ 统一格式）
  -Xlog:gc*:file=/var/log/app/gc.log:time,uptime,level,tags:filecount=10,filesize=50M \

  # OOM 处理
  -XX:+HeapDumpOnOutOfMemoryError \
  -XX:HeapDumpPath=/var/log/app/heapdump.hprof \
  -XX:+ExitOnOutOfMemoryError \      # OOM 后退出（配合 K8s 重启策略）

  # 性能优化
  -XX:+UseStringDeduplication \      # 字符串去重（G1 专属）
  -XX:+OptimizeStringConcat \        # 优化字符串拼接
  -XX:+AlwaysPreTouch \              # 启动时预分配内存（减少首次 GC 延迟）
  -Djava.security.egd=file:/dev/urandom  # 加速随机数生成
```

**GC 策略选型对比：**

| GC 策略 | 适用场景 | 最大停顿 | 吞吐量 | 内存效率 |
|---------|---------|---------|--------|---------|
| **G1** | 通用场景（推荐默认） | 可控（~200ms） | 高 | 中等 |
| **ZGC** | 超低延迟（Java 15+） | <10ms | 中等 | 较低 |
| **Shenandoah** | 超低延迟（RedHat） | <10ms | 中等 | 较低 |
| **Parallel** | 吞吐优先（批处理） | 不可控 | 最高 | 高 |

```bash
# 如果需要极致低延迟，使用 ZGC（Java 17+）
java -jar app.jar \
  -Xms4g -Xmx4g \
  -XX:+UseZGC \
  -XX:+ZGenerational \              # Java 21+ 分代 ZGC
  -XX:SoftMaxHeapSize=4g \
  -Xlog:gc*:file=/var/log/app/gc.log:time,uptime,level,tags
```

**GC 日志分析关键指标：**

```
# 正常 GC 日志示例（G1）
[gc] GC(42) Pause Young (Concurrent Start) (G1 Evacuation Pause) 1024M->256M(4096M) 45.123ms

关键指标：
- 1024M->256M：GC 前 → GC 后的堆使用量
- 4096M：总堆大小
- 45.123ms：GC 停顿时间

告警阈值建议：
- Young GC 停顿 > 100ms：关注
- Full GC 停顿 > 1s：严重
- Full GC 频率 > 1次/小时：排查内存泄漏
```

```java
/**
 * 通过 JMX 监控 JVM 指标（生产环境推荐接入 Micrometer + Prometheus）
 */
@Component
@Slf4j
@Scheduled(fixedRate = 60000)
public class JvmMonitor {

    public void report() {
        MemoryMXBean memory = ManagementFactory.getMemoryMXBean();
        MemoryUsage heap = memory.getHeapMemoryUsage();
        MemoryUsage nonHeap = memory.getNonHeapMemoryUsage();

        List<GarbageCollectorMXBean> gcBeans = ManagementFactory.getGarbageCollectorMXBeans();

        log.info("JVM Heap: {}/{} MB ({}%), NonHeap: {} MB",
                heap.getUsed() / 1024 / 1024,
                heap.getMax() / 1024 / 1024,
                heap.getUsed() * 100 / heap.getMax(),
                nonHeap.getUsed() / 1024 / 1024);

        for (GarbageCollectorMXBean gc : gcBeans) {
            log.info("GC [{}]: count={}, time={}ms",
                    gc.getName(), gc.getCollectionCount(), gc.getCollectionTime());
        }
    }
}
```

**踩坑提醒：**
- `-Xms` 和 `-Xmx` 设成一样！避免 JVM 在运行时动态扩缩堆大小，这个过程会触发 Full GC
- 不要迷信"大堆 = 好"——堆越大，Full GC 停顿越长。4-8GB 是多数 Web 应用的甜区
- 生产环境 **必须** 开启 GC 日志和 HeapDump——出了问题没有日志就是在盲人摸象

---

## 10.2 容器化部署

### 10.2.1 分层 Dockerfile

把 Spring Boot 应用打包成 Docker 镜像看似简单——`COPY jar → java -jar` 就完事了。但这样每次代码改动都要重新传输 200MB+ 的依赖层，构建慢得让人怀疑人生。**分层构建是解决这个问题的关键**。

Spring Boot 2.3+ 内置了分层机制，将 jar 分为四层：

| 层 | 内容 | 变化频率 | 大小占比 |
|----|------|---------|---------|
| **dependencies** | 第三方依赖 jar | 极低 | ~70% |
| **spring-boot-loader** | Spring Boot 加载器 | 极低 | ~1% |
| **snapshot-dependencies** | SNAPSHOT 依赖 | 低 | ~5% |
| **application** | 应用代码和配置 | 高 | ~24% |

```java
// 先配置 Spring Boot 分层（pom.xml 中）
// <plugin>
//   <groupId>org.springframework.boot</groupId>
//   <artifactId>spring-boot-maven-plugin</artifactId>
//   <configuration>
//     <layers>
//       <enabled>true</enabled>
//     </layers>
//   </configuration>
// </plugin>
```

```dockerfile
# ========== 构建阶段 ==========
FROM eclipse-temurin:21-jdk-alpine AS builder
WORKDIR /app

# 只拷贝构建配置（利用 Docker 缓存，依赖不变时不重新下载）
COPY pom.xml mvnw ./
COPY .mvn .mvn
RUN chmod +x mvnw && ./mvnw dependency:go-offline -B

# 拷贝源码并构建
COPY src src
RUN ./mvnw package -DskipTests -B && \
    java -Djarmode=layertools -jar target/*.jar extract --destination extracted

# ========== 运行阶段 ==========
FROM eclipse-temurin:21-jre-alpine AS runtime
WORKDIR /app

# 创建非 root 用户（安全最佳实践）
RUN addgroup -S app && adduser -S app -G app

# 按层拷贝（变化频率从低到高，最大化缓存命中）
COPY --from=builder /app/extracted/dependencies/ ./
COPY --from=builder /app/extracted/spring-boot-loader/ ./
COPY --from=builder /app/extracted/snapshot-dependencies/ ./
COPY --from=builder /app/extracted/application/ ./

# 切换到非 root 用户
USER app

# 暴露端口
EXPOSE 8080

# 健康检查
HEALTHCHECK --interval=30s --timeout=10s --retries=3 --start-period=40s \
  CMD wget -qO- http://localhost:8080/actuator/health || exit 1

# JVM 参数通过环境变量注入（灵活调整）
ENTRYPOINT ["sh", "-c", "java ${JAVA_OPTS:-} org.springframework.boot.loader.launch.JarLauncher"]
```

**构建与运行：**

```bash
# 构建镜像（首次较慢，后续只重建 application 层）
docker build -t order-service:1.0.0 .

# 运行（通过 JAVA_OPTS 注入生产参数）
docker run -d \
  -p 8080:8080 \
  -e JAVA_OPTS="-Xms2g -Xmx2g -XX:+UseG1GC -XX:MaxGCPauseMillis=200" \
  -e SPRING_PROFILES_ACTIVE=prod \
  -e DB_USERNAME=admin \
  -e DB_PASSWORD=secret \
  --name order-service \
  order-service:1.0.0
```

**踩坑提醒：**
- 使用 JRE 而不是 JDK 做运行镜像——JDK 比 JRE 大 200MB+，而且生产环境不需要编译器
- `--start-period` 要留够——Spring Boot 启动可能需要 30-60 秒，这段时间健康检查失败不应重启容器
- 不要在 Dockerfile 中硬编码密码，用环境变量或 Kubernetes Secret

---

### 10.2.2 Docker Compose 编排

本地开发和测试时，你需要把应用和它依赖的 MySQL、Redis、RabbitMQ 一起跑起来。Docker Compose 是最简单的编排工具——一个 YAML 文件搞定所有服务。

```yaml
# docker-compose.yml
version: "3.8"

services:
  # ========== 应用服务 ==========
  order-service:
    build:
      context: .
      dockerfile: Dockerfile
    ports:
      - "8080:8080"
    environment:
      SPRING_PROFILES_ACTIVE: docker
      DB_HOST: mysql
      DB_PORT: 3306
      DB_USERNAME: root
      DB_PASSWORD: root123
      REDIS_HOST: redis
      REDIS_PORT: 6379
      RABBITMQ_HOST: rabbitmq
      RABBITMQ_PORT: 5672
    depends_on:
      mysql:
        condition: service_healthy     # 等 MySQL 健康检查通过再启动
      redis:
        condition: service_healthy
      rabbitmq:
        condition: service_healthy
    restart: unless-stopped
    deploy:
      resources:
        limits:
          memory: 2G
          cpus: "2.0"
        reservations:
          memory: 512M
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:8080/actuator/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s

  # ========== MySQL ==========
  mysql:
    image: mysql:8.0
    ports:
      - "3306:3306"
    environment:
      MYSQL_ROOT_PASSWORD: root123
      MYSQL_DATABASE: order_db
      MYSQL_CHARACTER_SET_SERVER: utf8mb4
      MYSQL_COLLATION_SERVER: utf8mb4_unicode_ci
    volumes:
      - mysql_data:/var/lib/mysql
      - ./sql/init.sql:/docker-entrypoint-initdb.d/init.sql  # 初始化脚本
    command: >
      --default-authentication-plugin=mysql_native_password
      --innodb-buffer-pool-size=512M
      --max-connections=500
      --slow-query-log=ON
      --long-query-time=1
    healthcheck:
      test: ["CMD", "mysqladmin", "ping", "-h", "localhost", "-uroot", "-proot123"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 30s

  # ========== Redis ==========
  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    command: redis-server --maxmemory 256mb --maxmemory-policy allkeys-lru
    volumes:
      - redis_data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 3

  # ========== RabbitMQ ==========
  rabbitmq:
    image: rabbitmq:3.13-management-alpine
    ports:
      - "5672:5672"     # AMQP
      - "15672:15672"   # 管理界面
    environment:
      RABBITMQ_DEFAULT_USER: guest
      RABBITMQ_DEFAULT_PASS: guest
    volumes:
      - rabbitmq_data:/var/lib/rabbitmq
    healthcheck:
      test: ["CMD", "rabbitmq-diagnostics", "-q", "ping"]
      interval: 15s
      timeout: 10s
      retries: 3
      start_period: 20s

volumes:
  mysql_data:
  redis_data:
  rabbitmq_data:
```

```yaml
# application-docker.yml（Docker 环境专用配置）
spring:
  datasource:
    url: jdbc:mysql://${DB_HOST:localhost}:${DB_PORT:3306}/order_db?useSSL=false&serverTimezone=Asia/Shanghai
  data:
    redis:
      host: ${REDIS_HOST:localhost}
      port: ${REDIS_PORT:6379}
  rabbitmq:
    host: ${RABBITMQ_HOST:localhost}
    port: ${RABBITMQ_PORT:5672}
```

**启动顺序与健康检查流程：**

```
docker compose up -d
  ↓
MySQL 启动 → healthcheck: mysqladmin ping → ✅ healthy
Redis 启动 → healthcheck: redis-cli ping → ✅ healthy
RabbitMQ 启动 → healthcheck: rabbitmq-diagnostics ping → ✅ healthy
  ↓
order-service 启动（depends_on condition: service_healthy）
  ↓
应用健康检查 → actuator/health → ✅ healthy
```

**踩坑提醒：**
- `depends_on` 只保证 **容器启动** 顺序，不保证 **服务就绪** 顺序。必须配合 `healthcheck + condition: service_healthy`
- `volumes` 要用 **命名卷**（named volume）而不是 bind mount——命名卷由 Docker 管理，数据持久化更可靠
- 生产环境不要用 Docker Compose，用 Kubernetes。Compose 适合本地开发和测试

---

## 10.3 GraalVM 原生镜像

### 10.3.1 AOT 处理原理

传统 JVM 模式下，Spring 在启动时扫描注解、解析 Bean 定义、创建代理类——这个过程在云原生时代显得"奢侈"。**Serverless 场景要求秒级启动、MB 级内存**，GraalVM 原生镜像（Native Image）应运而生。

**AOT vs JIT 核心区别：**

| 维度 | JIT（传统 JVM） | AOT（GraalVM Native） |
|------|----------------|----------------------|
| 编译时机 | 运行时（边运行边编译） | 构建时（提前编译） |
| 启动速度 | 慢（需要类加载、JIT 预热） | 极快（10-100ms 级） |
| 内存占用 | 高（JVM 元数据 + JIT 编译器） | 低（只有运行时数据） |
| 峰值性能 | 高（JIT 可运行时优化） | 略低（缺少运行时 Profile） |
| 镜像大小 | 大（JRE + jar） | 小（可执行文件 + 必要资源） |
| 反射支持 | 完全支持 | 需要提前声明 |

**Spring Boot 3.x 的 AOT 处理流程：**

```
mvn spring-boot:process-aot
  ↓
┌─────────────────────────────────────────────────┐
│ AOT 引擎（在构建时运行 Spring 容器）               │
├─────────────────────────────────────────────────┤
│ 1. 扫描所有 @Configuration/@Component 类         │
│ 2. 生成 Bean 定义代码（替代运行时反射）             │
│ 3. 生成反射配置（哪些类/方法需要反射访问）          │
│ 4. 生成代理类源码（替代运行时 CGLIB 动态代理）      │
│ 5. 生成资源注册（哪些文件需要打包进镜像）            │
│ 6. 生成 Spring 初始化代码                         │
└─────────────────────────────────────────────────┘
  ↓
native-image 编译（将字节码编译为本地可执行文件）
  ↓
单个可执行文件（无需 JVM）
```

```java
/**
 * Spring Boot 3.x AOT 示例——Bean 定义在构建时生成
 * 以下代码在 JIT 模式和 AOT 模式下完全一致，框架自动处理差异
 */
@Configuration
public class AppConfig {

    /**
     * 这个 Bean 在 AOT 处理时会被分析并生成对应的静态代码
     * 运行时不再需要反射来创建实例
     */
    @Bean
    public OrderService orderService(OrderMapper orderMapper, RedisTemplate<String, Object> redisTemplate) {
        return new OrderService(orderMapper, redisTemplate);
    }

    /**
     * @Conditional 在 AOT 阶段也会被评估
     * 如果条件不满足，对应的 Bean 定义不会被生成
     */
    @Bean
    @ConditionalOnProperty(name = "feature.cache.enabled", havingValue = "true")
    public CacheManager cacheManager() {
        return new ConcurrentMapCacheManager("orders");
    }
}
```

**踩坑提醒：**
- AOT 处理时会 **运行部分初始化逻辑**（如 `@PostConstruct`），如果这些逻辑依赖外部服务会失败
- `@Conditional` 在 AOT 阶段评估，AOT 后无法动态切换——同一份 AOT 产物不能用于 dev 和 prod
- GraalVM 要求 **所有反射调用都必须在编译时声明**，否则运行时报 `ReflectionOperationException`

---

### 10.3.2 Native 编译实战

把 Spring Boot 应用编译为 GraalVM 原生镜像，需要解决三个核心问题：**反射兼容性、资源注册、代理类处理**。

**Maven 配置：**

```xml
<!-- pom.xml -->
<parent>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-parent</artifactId>
    <version>3.3.0</version>
</parent>

<properties>
    <java.version>21</java.version>
</properties>

<dependencies>
    <dependency>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-starter-web</artifactId>
    </dependency>
    <!-- MyBatis 等使用反射的库需要特别处理 -->
    <dependency>
        <groupId>org.mybatis.spring.boot</groupId>
        <artifactId>mybatis-spring-boot-starter</artifactId>
        <version>3.0.3</version>
    </dependency>
</dependencies>

<build>
    <plugins>
        <plugin>
            <groupId>org.graalvm.buildtools</groupId>
            <artifactId>native-maven-plugin</artifactId>
            <configuration>
                <!-- 主类（Spring Boot 3.x 自动生成） -->
                <mainClass>${start.class}</mainClass>
                <!-- 构建参数 -->
                <buildArgs>
                    <arg>-H:+ReportExceptionStackTraces</arg>
                    <arg>-H:+PrintAnalysisCallTree</arg>
                    <!-- 内存限制（构建时） -->
                    <arg>-J-Xmx8g</arg>
                </buildArgs>
            </configuration>
        </plugin>
    </plugins>
</build>
```

**反射配置——手动声明需要反射访问的类：**

```json
// src/main/resources/META-INF/native-image/reflect-config.json
[
  {
    "name": "com.example.entity.Order",
    "allDeclaredConstructors": true,
    "allDeclaredMethods": true,
    "allDeclaredFields": true
  },
  {
    "name": "com.example.entity.User",
    "allDeclaredConstructors": true,
    "allDeclaredMethods": true,
    "allDeclaredFields": true
  },
  {
    "name": "java.time.LocalDateTime",
    "allDeclaredConstructors": true,
    "allDeclaredMethods": true
  }
]
```

**资源配置——声明需要打包的资源文件：**

```json
// src/main/resources/META-INF/native-image/resource-config.json
{
  "resources": {
    "includes": [
      {"pattern": "mapper/.*\\.xml$"},        // MyBatis Mapper XML
      {"pattern": "templates/.*\\.html$"},     // Thymeleaf 模板
      {"pattern": "static/.*"},                // 静态资源
      {"pattern": "application.*\\.yml$"},     // 配置文件
      {"pattern": "META-INF/.*"}
    ]
  }
}
```

**代理配置（CGLIB 动态代理）：**

```json
// src/main/resources/META-INF/native-image/proxy-config.json
[
  ["com.example.service.OrderService", "org.springframework.aop.SpringProxy", "org.springframework.aop.framework.Advised", "org.springframework.core.DecoratorProxy"]
]
```

**一键编译：**

```bash
# 方式 1：使用 Maven 插件（推荐，自动处理 AOT + native-image）
mvn -Pnative native:compile

# 方式 2：使用 GraalVM 的 native-image 命令
# 先构建 AOT 产物
mvn spring-boot:process-aot -Pnative package -DskipTests
# 再编译为原生镜像
native-image -jar target/app.jar -o target/app

# 运行
./target/app
```

**踩坑提醒：**
- 第一次编译非常慢（5-15 分钟），CI/CD 中要预留足够时间
- 不是所有 Java 库都兼容 GraalVM——使用反射、动态代理、JNI 的库可能需要额外配置
- 使用 `native-maven-plugin` 的 tracing agent 可以 **自动收集** 反射配置：先在 JVM 模式下运行测试，再从 `target/native-image/` 中提取配置

---

### 10.3.3 原生镜像 vs JVM 模式

选不选 GraalVM？这不是一个"哪个更好"的问题，而是"你的场景需要什么"的问题。以下是基于实际测试数据的四维对比：

**测试条件：Spring Boot 3.3 + JDK 21 + 4 核 8GB 云服务器**

| 维度 | JVM 模式 | GraalVM Native | 差异倍数 |
|------|---------|----------------|---------|
| **冷启动时间** | 2.5-5 秒 | 50-200ms | **10-25x 更快** |
| **内存占用（稳态）** | 300-500MB | 50-100MB | **3-5x 更小** |
| **峰值吞吐（QPS）** | 100%（基准） | 85-95% | 略低 5-15% |
| **构建时间** | 30-60 秒 | 5-15 分钟 | **10-20x 更慢** |
| **镜像大小** | 250-400MB | 50-80MB | **3-5x 更小** |
| **调试支持** | 完整（JDB/JFR） | 有限 | 差距明显 |

**适用场景决策树：**

```
你的应用是 Serverless / FaaS（按调用计费）？
  → YES → 用 GraalVM（冷启动时间和内存直接决定成本）
  → NO ↓

你的应用需要极致启动速度（K8s 快速扩缩容）？
  → YES → 用 GraalVM（秒级启动配合 HPA）
  → NO ↓

你的应用依赖大量反射/动态代理（MyBatis、Hibernate 等）？
  → YES → 谨慎使用 GraalVM（兼容性问题多，配置成本高）
  → NO ↓

你的应用是长驻服务，对峰值吞吐要求极高？
  → YES → 用 JVM（JIT 的运行时优化在长运行中优势明显）
  → NO → 两者都可以，团队更熟悉哪个就用哪个
```

```java
/**
 * 实际的启动时间对比测试代码
 * 通过 ApplicationReadyEvent 记录真实启动耗时
 */
@Component
@Slf4j
public class StartupTimer implements ApplicationListener<ApplicationReadyEvent> {

    private final long startTime = System.currentTimeMillis();

    @Override
    public void onApplicationEvent(ApplicationReadyEvent event) {
        long duration = System.currentTimeMillis() - startTime;
        String mode = System.getProperty("org.graalvm.nativeimage.imagecode") != null
                ? "Native" : "JVM";

        log.info("========================================");
        log.info("  启动模式: {}", mode);
        log.info("  启动耗时: {}ms", duration);
        log.info("  最大堆内存: {}MB", Runtime.getRuntime().maxMemory() / 1024 / 1024);
        log.info("  可用处理器: {}", Runtime.getRuntime().availableProcessors());
        log.info("========================================");
    }
}
```

**踩坑提醒：**
- GraalVM Native 的峰值吞吐在长时间运行后可能比 JIT 低 10-15%——因为 JIT 有运行时 Profile-guided Optimization（PGO），而 AOT 没有
- 不要在 Native 模式下做性能基准测试——应该在 JVM 模式下测试吞吐，在 Native 模式下测试启动和内存
- Spring Boot 3.3+ 的 AOT 支持已经很成熟，但第三方库（尤其国内生态如 MyBatis-Plus、Dubbo）的兼容性仍在改善中

---

## 10.4 CI/CD 流水线

### 10.4.1 GitHub Actions 自动化

手动 `mvn package → scp → ssh restart` 是 2015 年的做法。现代 CI/CD 流水线应该是：**代码推送后自动测试、构建镜像、推送仓库、部署到 K8s——全程无人值守**。

```yaml
# .github/workflows/ci-cd.yml
name: CI/CD Pipeline

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

env:
  REGISTRY: ghcr.io
  IMAGE_NAME: ${{ github.repository }}

jobs:
  # ========== 阶段 1：测试 ==========
  test:
    runs-on: ubuntu-latest
    services:
      mysql:
        image: mysql:8.0
        env:
          MYSQL_ROOT_PASSWORD: test
          MYSQL_DATABASE: test_db
        ports:
          - 3306:3306
        options: >-
          --health-cmd="mysqladmin ping -h localhost"
          --health-interval=10s
          --health-timeout=5s
          --health-retries=5

      redis:
        image: redis:7-alpine
        ports:
          - 6379:6379
        options: >-
          --health-cmd="redis-cli ping"
          --health-interval=10s
          --health-timeout=5s
          --health-retries=3

    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Set up JDK 21
        uses: actions/setup-java@v4
        with:
          java-version: "21"
          distribution: "temurin"
          cache: maven

      - name: Run tests
        run: mvn clean test -B
        env:
          SPRING_DATASOURCE_URL: jdbc:mysql://localhost:3306/test_db
          SPRING_DATASOURCE_USERNAME: root
          SPRING_DATASOURCE_PASSWORD: test
          SPRING_DATA_REDIS_HOST: localhost

      - name: Upload test results
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: test-results
          path: target/surefire-reports/

  # ========== 阶段 2：构建并推送镜像 ==========
  build:
    needs: test
    runs-on: ubuntu-latest
    if: github.event_name == 'push'  # PR 不构建镜像
    permissions:
      contents: read
      packages: write

    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Set up JDK 21
        uses: actions/setup-java@v4
        with:
          java-version: "21"
          distribution: "temurin"
          cache: maven

      - name: Build JAR
        run: mvn clean package -DskipTests -B

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3

      - name: Login to Container Registry
        uses: docker/login-action@v3
        with:
          registry: ${{ env.REGISTRY }}
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Extract metadata
        id: meta
        uses: docker/metadata-action@v5
        with:
          images: ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}
          tags: |
            type=sha,prefix=
            type=ref,event=branch
            type=semver,pattern={{version}}

      - name: Build and push Docker image
        uses: docker/build-push-action@v5
        with:
          context: .
          push: true
          tags: ${{ steps.meta.outputs.tags }}
          labels: ${{ steps.meta.outputs.labels }}
          cache-from: type=gha
          cache-to: type=gha,mode=max

  # ========== 阶段 3：部署到 K8s ==========
  deploy:
    needs: build
    runs-on: ubuntu-latest
    if: github.ref == 'refs/heads/main'  # 只在 main 分支部署
    environment: production              # 需要手动审批（GitHub Environment Protection）

    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Set up kubectl
        uses: azure/setup-kubectl@v3

      - name: Configure kubeconfig
        run: |
          mkdir -p $HOME/.kube
          echo "${{ secrets.KUBE_CONFIG }}" | base64 -d > $HOME/.kube/config

      - name: Deploy to Kubernetes
        run: |
          # 更新镜像版本
          kubectl set image deployment/order-service \
            order-service=${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}:${{ github.sha }} \
            -n production

          # 等待滚动更新完成
          kubectl rollout status deployment/order-service -n production --timeout=300s

      - name: Verify deployment
        run: |
          # 检查 Pod 状态
          kubectl get pods -n production -l app=order-service
          # 健康检查
          kubectl exec deployment/order-service -n production -- \
            wget -qO- http://localhost:8080/actuator/health
```

**流水线执行流程：**

```
git push main
  ↓
┌─────────────────────────┐
│ Job 1: test             │
│ - checkout              │
│ - setup JDK 21          │
│ - mvn test              │
│ - upload test reports   │
└─────────┬───────────────┘
          ↓ (成功)
┌─────────────────────────┐
│ Job 2: build            │
│ - mvn package           │
│ - docker build          │
│ - docker push           │
└─────────┬───────────────┘
          ↓ (成功)
┌─────────────────────────┐
│ Job 3: deploy           │
│ - kubectl set image     │
│ - rollout status        │
│ - health check          │
└─────────────────────────┘
```

**踩坑提醒：**
- GitHub Actions 的 `services`（MySQL、Redis）只在 **job 级别** 生效，跨 job 需要重新声明
- Docker 镜像 tag 用 Git SHA 而不是 `latest`——`latest` 无法追溯版本，回滚也困难
- 部署阶段建议配置 **Environment Protection Rules**（手动审批），避免误操作直接上生产

---

### 10.4.2 蓝绿部署与滚动更新

部署新版本时，如何做到"零停机"？两种主流策略各有取舍。

**蓝绿部署（Blue-Green Deployment）：**

```
部署前：
┌─────────────────────────────────────┐
│           Load Balancer              │
└──────────┬──────────────────────────┘
           ↓ (100% 流量)
┌─────────────────────────────────────┐
│     蓝环境（当前生产版本 v1.0）        │
│  [Pod-1] [Pod-2] [Pod-3] [Pod-4]    │
└─────────────────────────────────────┘
┌─────────────────────────────────────┐
│     绿环境（新版本 v1.1，待命）        │
│  [Pod-1] [Pod-2] [Pod-3] [Pod-4]    │
└─────────────────────────────────────┘

切换后：
           Load Balancer
               ↓ (100% 流量)
          绿环境 v1.1 ✅
          蓝环境 v1.0（保留，随时回滚）
```

**滚动更新（Rolling Update）——K8s 默认策略：**

```
阶段 1: 4 个 v1.0 Pod
[v1.0] [v1.0] [v1.0] [v1.0]

阶段 2: 新建 1 个 v1.1，删除 1 个 v1.0
[v1.1] [v1.0] [v1.0] [v1.0]   ← maxSurge=1, maxUnavailable=0

阶段 3: 继续替换
[v1.1] [v1.1] [v1.0] [v1.0]

阶段 4: 完成
[v1.1] [v1.1] [v1.1] [v1.1]
```

**K8s 滚动更新配置：**

```yaml
# k8s/deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: order-service
  namespace: production
spec:
  replicas: 4
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1              # 最多多创建 1 个 Pod（滚动更新期间）
      maxUnavailable: 0        # 不允许任何 Pod 不可用（零停机保证）
  selector:
    matchLabels:
      app: order-service
  template:
    metadata:
      labels:
        app: order-service
        version: v1.1.0
    spec:
      terminationGracePeriodSeconds: 60   # 优雅关闭等待时间
      containers:
        - name: order-service
          image: ghcr.io/company/order-service:abc123
          ports:
            - containerPort: 8080
          resources:
            requests:
              memory: "512Mi"
              cpu: "500m"
            limits:
              memory: "2Gi"
              cpu: "2000m"
          # 就绪探针——Pod 准备好接收流量
          readinessProbe:
            httpGet:
              path: /actuator/health/readiness
              port: 8080
            initialDelaySeconds: 30
            periodSeconds: 10
            failureThreshold: 3
          # 存活探针——Pod 是否还活着
          livenessProbe:
            httpGet:
              path: /actuator/health/liveness
              port: 8080
            initialDelaySeconds: 60
            periodSeconds: 15
            failureThreshold: 3
          # 启动探针——Pod 是否启动完成（慢启动应用用这个）
          startupProbe:
            httpGet:
              path: /actuator/health
              port: 8080
            initialDelaySeconds: 10
            periodSeconds: 5
            failureThreshold: 30    # 最多等 150 秒
          lifecycle:
            preStop:
              exec:
                command: ["sh", "-c", "sleep 10"]  # 优雅关闭：先摘流量再停应用
```

**蓝绿 vs 滚动更新对比：**

| 维度 | 蓝绿部署 | 滚动更新 |
|------|---------|---------|
| 停机时间 | 零 | 零 |
| 资源开销 | 2 倍（需要双倍资源） | 1.2-1.5 倍（maxSurge 额外资源） |
| 回滚速度 | 极快（切换流量即可） | 较慢（需要重新部署旧版本） |
| 风险 | 流量切换瞬间所有请求受影响 | 逐步替换，影响范围小 |
| 数据库兼容性 | 需要同时兼容两个版本 | 需要兼容新旧版本 |
| 适用场景 | 重大版本升级、不频繁发布 | 日常迭代、频繁发布 |

**优雅关闭流程（Spring Boot + K8s）：**

```java
/**
 * 优雅关闭配置
 * 当 Pod 收到 SIGTERM 信号时：
 * 1. K8s 从 Service Endpoint 中摘除该 Pod（不再接收新流量）
 * 2. 执行 preStop hook（sleep 10s，等待 LB 生效）
 * 3. Spring Boot 收到 SIGTERM，开始优雅关闭
 * 4. 等待正在处理的请求完成（server.shutdown=graceful）
 * 5. 超时后强制关闭
 */
```

```yaml
# application-prod.yml
server:
  shutdown: graceful
  tomcat:
    connection-timeout: 5s

spring:
  lifecycle:
    timeout-per-shutdown-phase: 30s  # 优雅关闭超时时间
```

**踩坑提醒：**
- 蓝绿部署要求 **数据库 Schema 向前兼容**——新版本的 SQL 变更不能破坏旧版本的运行
- 滚动更新时，`maxUnavailable: 0` 保证零停机，但需要有足够的资源来创建额外的 Pod
- `preStop` 中的 `sleep` 很关键——Service Endpoint 的摘除有延迟（通常 5-10 秒），不 sleep 的话旧 Pod 还会收到新请求
- `startupProbe` 对 Spring Boot 应用特别重要——启动慢的应用如果不配 startupProbe，livenessProbe 会在启动过程中就把 Pod 杀掉
