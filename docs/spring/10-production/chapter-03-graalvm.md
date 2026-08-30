# GraalVM 原生镜像

> 传统 JVM 模式下，Spring 在启动时扫描注解、解析 Bean 定义、创建代理类——这个过程在云原生时代显得"奢侈"。Serverless 场景要求秒级启动、MB 级内存，GraalVM 原生镜像应运而生。

---

## 1. AOT 处理原理

### 1.1 AOT vs JIT

| 维度 | JIT（传统 JVM） | AOT（GraalVM Native） |
|------|----------------|----------------------|
| 编译时机 | 运行时（边运行边编译） | 构建时（提前编译） |
| 启动速度 | 慢（需要类加载、JIT 预热） | 极快（10-100ms 级） |
| 内存占用 | 高（JVM 元数据 + JIT 编译器） | 低（只有运行时数据） |
| 峰值性能 | 高（JIT 可运行时优化） | 略低（缺少运行时 Profile） |
| 镜像大小 | 大（JRE + jar） | 小（可执行文件 + 必要资源） |
| 反射支持 | 完全支持 | 需要提前声明 |

### 1.2 Spring Boot 3.x AOT 处理流程

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

## 2. Native 编译实战

### 2.1 Maven 配置

```xml
<parent>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-parent</artifactId>
    <version>3.3.0</version>
</parent>

<properties>
    <java.version>21</java.version>
</properties>

<build>
    <plugins>
        <plugin>
            <groupId>org.graalvm.buildtools</groupId>
            <artifactId>native-maven-plugin</artifactId>
            <configuration>
                <mainClass>${start.class}</mainClass>
                <buildArgs>
                    <arg>-H:+ReportExceptionStackTraces</arg>
                    <arg>-J-Xmx8g</arg>
                </buildArgs>
            </configuration>
        </plugin>
    </plugins>
</build>
```

### 2.2 反射配置

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

### 2.3 资源配置

```json
// src/main/resources/META-INF/native-image/resource-config.json
{
  "resources": {
    "includes": [
      {"pattern": "mapper/.*\\.xml$"},
      {"pattern": "templates/.*\\.html$"},
      {"pattern": "static/.*"},
      {"pattern": "application.*\\.yml$"},
      {"pattern": "META-INF/.*"}
    ]
  }
}
```

### 2.4 代理配置

```json
// src/main/resources/META-INF/native-image/proxy-config.json
[
  ["com.example.service.OrderService", "org.springframework.aop.SpringProxy", "org.springframework.aop.framework.Advised", "org.springframework.core.DecoratorProxy"]
]
```

### 2.5 编译与运行

```bash
# 方式 1：使用 Maven 插件（推荐，自动处理 AOT + native-image）
mvn -Pnative native:compile

# 方式 2：使用 GraalVM 的 native-image 命令
mvn spring-boot:process-aot -Pnative package -DskipTests
native-image -jar target/app.jar -o target/app

# 运行
./target/app
```

**踩坑提醒：**
- 第一次编译非常慢（5-15 分钟），CI/CD 中要预留足够时间
- 不是所有 Java 库都兼容 GraalVM——使用反射、动态代理、JNI 的库可能需要额外配置
- 使用 `native-maven-plugin` 的 tracing agent 可以 **自动收集** 反射配置：先在 JVM 模式下运行测试，再从 `target/native-image/` 中提取配置

---

## 3. 原生镜像 vs JVM 模式四维对比

**测试条件：Spring Boot 3.3 + JDK 21 + 4 核 8GB 云服务器**

| 维度 | JVM 模式 | GraalVM Native | 差异倍数 |
|------|---------|----------------|---------|
| **冷启动时间** | 2.5-5 秒 | 50-200ms | **10-25x 更快** |
| **内存占用（稳态）** | 300-500MB | 50-100MB | **3-5x 更小** |
| **峰值吞吐（QPS）** | 100%（基准） | 85-95% | 略低 5-15% |
| **构建时间** | 30-60 秒 | 5-15 分钟 | **10-20x 更慢** |
| **镜像大小** | 250-400MB | 50-80MB | **3-5x 更小** |
| **调试支持** | 完整（JDB/JFR） | 有限 | 差距明显 |

### 3.1 适用场景决策树

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

### 3.2 启动时间对比代码

```java
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
