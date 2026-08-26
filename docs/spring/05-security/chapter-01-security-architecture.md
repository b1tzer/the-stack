# 企业系统安全与部署

> 某公司用户数据被拖库，原因是密码用明文存储、SQL 注入没防住、接口没有鉴权。这不是段子，是每年都在发生的真实事故。身份认证怎么选型？权限怎么设计才能既灵活又安全？敏感数据怎么保护？应用怎么打包才能在任何环境一致运行？本章从认证授权、数据安全、容器化部署三个维度，讲清楚企业级 Java 应用的安全底线。

## 1. 身份认证

### 1.1 认证的本质

身份认证（Authentication）回答的是"你是谁"的问题。在 Web 应用中，用户首次登录后，后续请求需要某种机制让服务器知道"这个请求来自已认证的用户"。三种主流方案的对比如下：

| 维度 | Session-Cookie | JWT（JSON Web Token） | OAuth 2.0 |
|------|---------------|----------------------|-----------|
| **存储位置** | 服务端（内存/Redis） | 客户端（LocalStorage/Cookie） | 不存储 token，由授权服务器管理 |
| **状态** | 有状态（服务端需保存 Session） | 无状态（token 自包含信息） | 依赖授权服务器 |
| **跨域** | 需要额外处理（Cookie 跨域限制） | 天然支持（放在 Header 中） | 天然支持 |
| **扩展性** | 多实例需要 Session 共享 | 任意节点可验证 | 授权中心集中管理 |
| **撤销** | 删除 Session 即可 | 困难（需黑名单机制） | 通过 Refresh Token 机制 |
| **适用场景** | 传统单体 Web 应用 | 前后端分离、微服务内部认证 | 第三方登录、开放平台 |
| **安全风险** | CSRF 攻击 | Token 泄露后难以撤销 | 配置不当可能被滥用 |

### 1.2 JWT 的结构

JWT 是目前微服务架构中最常用的身份认证方案，它由三部分组成：

```text
eyJhbGciOiJIUzI1NiJ9.eyJ1c2VySWQiOjEwMDg2LCJyb2xlIjoiYWRtaW4iLCJleHAiOjE3MDUzMDAwMDB9.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c
│       Header（算法）          │              Payload（声明）                    │            Signature（签名）               │
```

**Java 中生成和验证 JWT**：

```java
@Component
public class JwtUtil {

    @Value("${jwt.secret}")
    private String secret;

    @Value("${jwt.expiration:7200}")
    private long expiration; // 默认 2 小时

    public String generateToken(Long userId, String role) {
        return Jwts.builder()
            .setSubject(String.valueOf(userId))
            .claim("role", role)
            .setIssuedAt(new Date())
            .setExpiration(new Date(System.currentTimeMillis() + expiration * 1000))
            .signWith(Keys.hmacShaKeyFor(secret.getBytes(StandardCharsets.UTF_8)))
            .compact();
    }

    public Claims parseToken(String token) {
        return Jwts.parserBuilder()
            .setSigningKey(Keys.hmacShaKeyFor(secret.getBytes(StandardCharsets.UTF_8)))
            .build()
            .parseClaimsJws(token)
            .getBody();
    }

    public boolean isTokenValid(String token) {
        try {
            Claims claims = parseToken(token);
            return !claims.getExpiration().before(new Date());
        } catch (JwtException e) {
            return false;
        }
    }
}
```

### 1.3 OAuth 2.0 四种授权模式

OAuth 2.0 是一个授权框架，定义了四种授权模式：

| 模式 | 流程 | 适用场景 |
|------|------|---------|
| **授权码模式** | 用户→授权页→授权码→后端换 Token | 第三方登录（微信、GitHub） |
| **隐式模式** | 用户→授权页→直接返回 Token（前端） | 已不推荐，安全隐患大 |
| **密码模式** | 用户名+密码直接换 Token | 自家 App、高度信任的第一方应用 |
| **客户端凭证模式** | 客户端 ID+Secret 直接换 Token | 服务间调用（M2M） |

授权码模式的完整流程：

```text
① 用户点击"微信登录"
        │
        ▼
② 浏览器跳转到微信授权页
   https://open.weixin.qq.com/authorize?client_id=xxx&redirect_uri=xxx&scope=userinfo
        │
        ▼
③ 用户确认授权，微信回调 redirect_uri 并携带授权码
   https://myapp.com/callback?code=AUTH_CODE_xxx
        │
        ▼
④ 后端用授权码换取 Access Token（服务器间通信，用户无感知）
   POST https://api.weixin.qq.com/oauth/access_token
   Body: client_id=xxx&client_secret=xxx&code=AUTH_CODE_xxx
        │
        ▼
⑤ 获得 Access Token，调用微信 API 获取用户信息
   GET https://api.weixin.qq.com/sns/userinfo?access_token=xxx&openid=xxx
```

## 2. Spring Security 核心

### 2.1 整体架构

Spring Security 的本质是一条 **Servlet Filter Chain**（过滤器链），每个请求都要经过这条链的处理：

```text
HTTP Request
    │
    ▼
┌──────────────────────────────────────────────────────────────────┐
│                   DelegatingFilterProxy                          │
│  (Spring 容器的入口，委托给 FilterChainProxy)                       │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │              FilterChainProxy                                │ │
│  │                                                              │ │
│  │  ┌──────────┐  ┌──────────────────┐  ┌──────────────────┐  │ │
│  │  │ Security │  │ Authentication   │  │  Authorization    │  │ │
│  │  │ Context  │  │     Filter       │  │     Filter        │  │ │
│  │  │  Filter  │  │ (认证：你是谁？)   │  │ (授权：你能做什么？)│  │ │
│  │  └──────────┘  └──────────────────┘  └──────────────────┘  │ │
│  └─────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────┘
    │
    ▼
  Controller
```

### 2.2 认证流程详解

一次登录认证的完整流程涉及多个组件的协作：

![security-auth-flow](/spring/security-auth-flow.svg)

### 2.3 核心代码示例

```java
@Configuration
@EnableWebSecurity
public class SecurityConfig {

    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        http
            .csrf(csrf -> csrf.disable())  // 前后端分离禁用 CSRF
            .sessionManagement(session ->
                session.sessionCreationPolicy(SessionCreationPolicy.STATELESS)) // 无状态
            .authorizeHttpRequests(auth -> auth
                .requestMatchers("/api/auth/login", "/api/auth/register").permitAll()
                .requestMatchers("/api/admin/**").hasRole("ADMIN")
                .requestMatchers("/api/user/**").hasAnyRole("USER", "ADMIN")
                .anyRequest().authenticated()
            )
            .addFilterBefore(jwtAuthenticationFilter(),
                UsernamePasswordAuthenticationFilter.class);

        return http.build();
    }

    @Bean
    public PasswordEncoder passwordEncoder() {
        return new BCryptPasswordEncoder();
    }
}
```

自定义 JWT 认证过滤器：

```java
@Component
public class JwtAuthenticationFilter extends OncePerRequestFilter {

    private final JwtUtil jwtUtil;

    @Override
    protected void doFilterInternal(HttpServletRequest request,
            HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {

        String header = request.getHeader("Authorization");

        if (header != null && header.startsWith("Bearer ")) {
            String token = header.substring(7);

            if (jwtUtil.isTokenValid(token)) {
                Claims claims = jwtUtil.parseToken(token);
                Long userId = Long.parseLong(claims.getSubject());
                String role = claims.get("role", String.class);

                UsernamePasswordAuthenticationToken auth =
                    new UsernamePasswordAuthenticationToken(
                        userId, null,
                        List.of(new SimpleGrantedAuthority("ROLE_" + role))
                    );

                SecurityContextHolder.getContext().setAuthentication(auth);
            }
        }

        chain.doFilter(request, response);
    }
}
```

## 3. 权限模型（RBAC）

### 3.1 RBAC 基本模型

RBAC（Role-Based Access Control，基于角色的访问控制）是企业应用中最广泛使用的权限模型：

```text
┌────────┐     M:N      ┌────────┐     M:N      ┌────────────┐
│  用户   │ ◀──────────▶ │  角色   │ ◀──────────▶ │  权限/资源  │
│ (User) │              │ (Role) │              │(Permission)│
└────────┘              └────────┘              └────────────┘

示例：
用户"张三" → 角色"订单管理员" → 权限"order:read", "order:create", "order:refund"
用户"李四" → 角色"客服"       → 权限"order:read", "ticket:create"
```

### 3.2 数据库设计

```sql
-- 五张核心表
CREATE TABLE sys_user (
    id          BIGINT PRIMARY KEY AUTO_INCREMENT,
    username    VARCHAR(50) UNIQUE NOT NULL,
    password    VARCHAR(100) NOT NULL,
    status      TINYINT DEFAULT 1 COMMENT '1-正常 0-禁用',
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE sys_role (
    id          BIGINT PRIMARY KEY AUTO_INCREMENT,
    role_code   VARCHAR(50) UNIQUE NOT NULL COMMENT '如 ROLE_ADMIN',
    role_name   VARCHAR(100) NOT NULL,
    status      TINYINT DEFAULT 1
);

CREATE TABLE sys_permission (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    permission_code VARCHAR(100) UNIQUE NOT NULL COMMENT '如 order:read',
    permission_name VARCHAR(200) NOT NULL,
    resource_type   VARCHAR(20) DEFAULT 'api' COMMENT 'menu/button/api',
    parent_id       BIGINT DEFAULT 0
);

-- 关联表
CREATE TABLE sys_user_role (
    user_id BIGINT NOT NULL,
    role_id BIGINT NOT NULL,
    PRIMARY KEY (user_id, role_id)
);

CREATE TABLE sys_role_permission (
    role_id       BIGINT NOT NULL,
    permission_id BIGINT NOT NULL,
    PRIMARY KEY (role_id, permission_id)
);
```

### 3.3 与 Spring Security 集成

```java
@Service
public class CustomUserDetailsService implements UserDetailsService {

    private final UserMapper userMapper;

    @Override
    public UserDetails loadUserByUsername(String username) {
        // 1. 查询用户基本信息
        SysUser user = userMapper.selectByUsername(username);
        if (user == null) {
            throw new UsernameNotFoundException("用户不存在: " + username);
        }

        // 2. 查询用户的角色和权限
        List<String> permissions = userMapper.selectPermissionsByUserId(user.getId());

        // 3. 构建 GrantedAuthority 列表
        List<GrantedAuthority> authorities = permissions.stream()
            .map(SimpleGrantedAuthority::new)
            .collect(Collectors.toList());

        return new User(
            user.getUsername(),
            user.getPassword(),
            user.getStatus() == 1,  // enabled
            true, true, true,       // accountNonExpired, credentialsNonExpired, accountNonLocked
            authorities
        );
    }
}
```

在 Controller 中使用注解做权限校验：

```java
@RestController
@RequestMapping("/api/order")
public class OrderController {

    @PreAuthorize("hasAuthority('order:create')")
    @PostMapping
    public Order createOrder(@RequestBody OrderRequest request) {
        return orderService.create(request);
    }

    @PreAuthorize("hasAuthority('order:refund') and @orderSecurity.checkOwner(#id)")
    @PostMapping("/{id}/refund")
    public Order refundOrder(@PathVariable Long id) {
        return orderService.refund(id);
    }
}
```

## 4. 数据安全

### 4.1 HTTPS 传输加密

HTTPS 是最基本的安全措施，确保数据在传输过程中不被窃听和篡改。Spring Boot 配置 HTTPS：

```yaml
server:
  port: 443
  ssl:
    enabled: true
    key-store: classpath:keystore.p12
    key-store-password: ${SSL_KEYSTORE_PASSWORD}
    key-store-type: PKCS12
```

**生产环境推荐**：在 Nginx 或负载均衡器上终止 SSL，后端服务之间使用内网 HTTP 通信，减少证书管理的复杂度。

### 4.2 敏感数据存储加密

数据库中的密码、身份证号、银行卡号等敏感字段必须加密存储：

```java
@Component
public class EncryptUtil {

    private static final String AES_KEY = System.getenv("AES_ENCRYPT_KEY");

    // AES 加密
    public static String encrypt(String plainText) {
        try {
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            SecretKeySpec keySpec = new SecretKeySpec(
                AES_KEY.getBytes(StandardCharsets.UTF_8), "AES");
            byte[] iv = new byte[12];
            SecureRandom.getInstanceStrong().nextBytes(iv);
            GCMParameterSpec gcmSpec = new GCMParameterSpec(128, iv);
            cipher.init(Cipher.ENCRYPT_MODE, keySpec, gcmSpec);
            byte[] encrypted = cipher.doFinal(plainText.getBytes(StandardCharsets.UTF_8));
            // iv + 密文一起存储
            byte[] combined = new byte[iv.length + encrypted.length];
            System.arraycopy(iv, 0, combined, 0, iv.length);
            System.arraycopy(encrypted, 0, combined, iv.length, encrypted.length);
            return Base64.getEncoder().encodeToString(combined);
        } catch (Exception e) {
            throw new RuntimeException("加密失败", e);
        }
    }
}
```

MyBatis 类型处理器，自动加密/解密：

```java
@MappedTypes(String.class)
public class EncryptTypeHandler extends BaseTypeHandler<String> {

    @Override
    public void setNonNullParameter(PreparedStatement ps, int i,
            String parameter, JdbcType jdbcType) throws SQLException {
        ps.setString(i, EncryptUtil.encrypt(parameter));
    }

    @Override
    public String getNullableResult(ResultSet rs, String columnName)
            throws SQLException {
        String value = rs.getString(columnName);
        return value != null ? EncryptUtil.decrypt(value) : null;
    }
    // ... 其他 getNullableResult 重载
}
```

### 4.3 日志脱敏

日志中出现敏感信息是最常见的安全漏洞之一。使用 Logback 的自定义脱敏 Converter：

```java
public class SensitiveDataConverter extends ClassicConverter {

    // 匹配手机号、身份证号、银行卡号的正则
    private static final Pattern PHONE_PATTERN =
        Pattern.compile("(1[3-9]\\d)\\d{4}(\\d{4})");
    private static final Pattern ID_CARD_PATTERN =
        Pattern.compile("(\\d{6})\\d{8}(\\d{3}[0-9Xx])");
    private static final Pattern BANK_CARD_PATTERN =
        Pattern.compile("(\\d{4})\\d{8,12}(\\d{4})");

    @Override
    public String convert(ILoggingEvent event) {
        String msg = event.getFormattedMessage();
        msg = PHONE_PATTERN.matcher(msg).replaceAll("$1****$2");
        msg = ID_CARD_PATTERN.matcher(msg).replaceAll("$1********$2");
        msg = BANK_CARD_PATTERN.matcher(msg).replaceAll("$1****$2");
        return msg;
    }
}
```

在 `logback-spring.xml` 中注册：

```xml
<conversionRule conversionWord="desensitize"
    converterClass="com.example.log.SensitiveDataConverter" />

<appender name="CONSOLE" class="ch.qos.logback.core.ConsoleAppender">
    <encoder>
        <pattern>%d{yyyy-MM-dd HH:mm:ss} [%thread] %-5level %logger{36} - %desensitize%n</pattern>
    </encoder>
</appender>
```

### 4.4 操作审计

企业系统必须记录"谁在什么时间做了什么操作"，用于事后追溯和合规审计：

```java
@Aspect
@Component
public class AuditAspect {

    @Autowired
    private AuditLogService auditLogService;

    @Around("@annotation(auditLog)")
    public Object audit(ProceedingJoinPoint joinPoint, AuditLog auditLog) throws Throwable {
        Long userId = SecurityContextHolder.getContext()
            .getAuthentication() != null
            ? (Long) SecurityContextHolder.getContext()
                .getAuthentication().getPrincipal()
            : null;

        Object result = null;
        boolean success = true;
        String errorMsg = null;

        try {
            result = joinPoint.proceed();
            return result;
        } catch (Throwable e) {
            success = false;
            errorMsg = e.getMessage();
            throw e;
        } finally {
            auditLogService.save(AuditRecord.builder()
                .userId(userId)
                .module(auditLog.module())
                .operation(auditLog.operation())
                .method(joinPoint.getSignature().toShortString())
                .params(toJson(joinPoint.getArgs()))
                .result(success ? "SUCCESS" : "FAIL")
                .errorMsg(errorMsg)
                .ip(getClientIp())
                .createdAt(LocalDateTime.now())
                .build());
        }
    }
}

// 使用
@AuditLog(module = "订单管理", operation = "退款")
@PostMapping("/api/order/{id}/refund")
public Order refundOrder(@PathVariable Long id) { ... }
```

## 5. Docker 容器化

### 5.1 为什么需要容器化

| 传统部署痛点 | Docker 解决方式 |
|-------------|----------------|
| "在我电脑上能跑" —— 环境不一致 | 打包应用 + 依赖 + 配置为一个镜像，任何环境一致运行 |
| 部署一台机器需要数小时 | `docker run` 秒级启动 |
| 多个应用共享机器，依赖冲突 | 每个容器独立的文件系统和依赖 |
| 扩容需要采购服务器 | 容器秒级水平扩展 |

### 5.2 Dockerfile 示例

```dockerfile
# ========== 构建阶段 ==========
FROM eclipse-temurin:17-jdk-alpine AS builder
WORKDIR /app

# 先复制依赖文件（利用 Docker 缓存层）
COPY pom.xml .
COPY .mvn .mvn
COPY mvnw .
RUN ./mvnw dependency:go-offline -B

# 再复制源码并构建
COPY src ./src
RUN ./mvnw package -DskipTests -B

# ========== 运行阶段 ==========
FROM eclipse-temurin:17-jre-alpine
WORKDIR /app

# 安全：不使用 root 用户运行
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser

# 从构建阶段复制产物
COPY --from=builder /app/target/*.jar app.jar

# JVM 参数：容器感知内存限制
ENV JAVA_OPTS="-XX:+UseContainerSupport \
               -XX:MaxRAMPercentage=75.0 \
               -XX:InitialRAMPercentage=50.0 \
               -Djava.security.egd=file:/dev/./urandom"

# 健康检查
HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
    CMD wget -qO- http://localhost:8080/actuator/health || exit 1

EXPOSE 8080

ENTRYPOINT ["sh", "-c", "java $JAVA_OPTS -jar app.jar"]
```

**构建和运行**：

```bash
# 构建镜像
docker build -t order-service:1.0.0 .

# 运行容器
docker run -d \
    --name order-service \
    -p 8080:8080 \
    -e SPRING_PROFILES_ACTIVE=prod \
    -e DB_URL=jdbc:mysql://db:3306/order_db \
    order-service:1.0.0
```

### 5.3 多阶段构建的价值

多阶段构建（Multi-stage Build）将"编译"和"运行"分离：

```text
构建阶段（builder）          运行阶段（runtime）
┌─────────────────────┐     ┌─────────────────────┐
│ JDK 17 (~300MB)     │     │ JRE 17 (~180MB)     │
│ Maven (~10MB)       │     │                     │
│ 源代码               │     │ app.jar only        │
│ pom.xml             │     │ (~50MB)             │
│                     │     │                     │
│ 输出: app.jar        │──▶  │ 最终镜像: ~230MB    │
└─────────────────────┘     └─────────────────────┘
```

最终镜像不包含 JDK、Maven、源代码，体积大幅缩小，攻击面也更小。

## 6. Kubernetes 基础

### 6.1 核心资源对象

Kubernetes（K8s）是容器编排的事实标准，其核心资源对象如下：

| 资源 | 作用 | 类比 |
|------|------|------|
| **Pod** | 最小部署单元，包含一个或多个容器 | 一个"宿舍"，里面住着一个或多个"人" |
| **Deployment** | 管理 Pod 的副本数、滚动更新、回滚 | 宿舍管理员，确保始终有 N 间宿舍住着人 |
| **Service** | 为一组 Pod 提供稳定的访问入口（负载均衡） | 前台接待，把访客引导到有空位的宿舍 |
| **ConfigMap** | 存储非敏感配置（键值对或文件） | 公告栏上的通知 |
| **Secret** | 存储敏感信息（密码、证书），Base64 编码 | 上锁的保险柜 |

### 6.2 Deployment 示例

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: order-service
  namespace: production
spec:
  replicas: 3                          # 保持 3 个副本
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1                      # 最多多出 1 个 Pod
      maxUnavailable: 0                # 更新时不允许不可用
  selector:
    matchLabels:
      app: order-service
  template:
    metadata:
      labels:
        app: order-service
    spec:
      containers:
        - name: order-service
          image: registry.example.com/order-service:1.2.0
          ports:
            - containerPort: 8080
          env:
            - name: SPRING_PROFILES_ACTIVE
              valueFrom:
                configMapKeyRef:
                  name: order-config
                  key: spring.profiles.active
            - name: DB_PASSWORD
              valueFrom:
                secretKeyRef:
                  name: order-secret
                  key: db-password
          resources:
            requests:
              memory: "512Mi"
              cpu: "500m"
            limits:
              memory: "1Gi"
              cpu: "1000m"
          readinessProbe:              # 就绪探针：准备好才接收流量
            httpGet:
              path: /actuator/health/readiness
              port: 8080
            initialDelaySeconds: 30
            periodSeconds: 10
          livenessProbe:               # 存活探针：挂了就重启
            httpGet:
              path: /actuator/health/liveness
              port: 8080
            initialDelaySeconds: 60
            periodSeconds: 15
```

### 6.3 Service 示例

```yaml
apiVersion: v1
kind: Service
metadata:
  name: order-service
  namespace: production
spec:
  type: ClusterIP                      # 集群内部访问
  selector:
    app: order-service
  ports:
    - port: 80                         # Service 端口
      targetPort: 8080                 # Pod 端口
      protocol: TCP
```

Service 提供稳定的 DNS 名称：`order-service.production.svc.cluster.local`，无论 Pod 如何漂移，其他服务只需通过这个域名访问。

### 6.4 ConfigMap 与 Secret

```yaml
# ConfigMap - 非敏感配置
apiVersion: v1
kind: ConfigMap
metadata:
  name: order-config
  namespace: production
data:
  spring.profiles.active: "prod"
  app.page-size: "20"
  app.cache-ttl: "300"
# Secret - 敏感配置
apiVersion: v1
kind: Secret
metadata:
  name: order-secret
  namespace: production
type: Opaque
data:
  db-password: cGFzc3dvcmQxMjM=    # base64("password123")
  jwt-secret: c2VjcmV0S2V5MTIz     # base64("secretKey123")
```

**最佳实践**：ConfigMap 和 Secret 的值可以在 Pod 内以环境变量或文件挂载的方式使用。环境变量适合简单配置，文件挂载适合配置文件（如 `application.yml`）。

## 7. 多环境配置

### 7.1 Spring Profiles 机制

企业应用通常需要在多个环境（开发、测试、预发布、生产）中运行，每个环境的数据库地址、缓存配置、日志级别都不同。Spring Boot 通过 `spring.profiles.active` 机制解决这个问题：

```text
src/main/resources/
├── application.yml              # 公共配置（所有环境共享）
├── application-dev.yml          # 开发环境
├── application-test.yml         # 测试环境
├── application-staging.yml      # 预发布环境
└── application-prod.yml         # 生产环境
```

**公共配置 application.yml**：

```yaml
spring:
  application:
    name: order-service
  jackson:
    date-format: yyyy-MM-dd HH:mm:ss
    time-zone: Asia/Shanghai

# 公共业务配置
order:
  page-size: 20
  max-retry: 3
```

**开发环境 application-dev.yml**：

```yaml
spring:
  datasource:
    url: jdbc:mysql://localhost:3306/order_dev
    username: root
    password: root
  data:
    redis:
      host: localhost
      port: 6379

logging:
  level:
    com.example: DEBUG
    org.springframework: INFO
```

**生产环境 application-prod.yml**：

```yaml
spring:
  datasource:
    url: jdbc:mysql://${DB_HOST:prod-db}:3306/order_prod
    username: ${DB_USERNAME}
    password: ${DB_PASSWORD}
    hikari:
      maximum-pool-size: 20
      minimum-idle: 5
  data:
    redis:
      host: ${REDIS_HOST}
      port: 6379
      password: ${REDIS_PASSWORD}

logging:
  level:
    com.example: WARN
    org.springframework: WARN
```

### 7.2 激活 Profile 的方式

| 方式 | 示例 | 优先级 |
|------|------|--------|
| 命令行参数 | `java -jar app.jar --spring.profiles.active=prod` | 最高 |
| 环境变量 | `SPRING_PROFILES_ACTIVE=prod` | 高 |
| JVM 参数 | `java -Dspring.profiles.active=prod -jar app.jar` | 中 |
| bootstrap.yml | `spring.profiles.active: ${SPRING_PROFILES_ACTIVE:dev}` | 低 |
| 默认值 | `@Profile("dev")` | 最低 |

在 Kubernetes 中，通常通过 ConfigMap 设置环境变量：

```yaml
env:
  - name: SPRING_PROFILES_ACTIVE
    valueFrom:
      configMapKeyRef:
        name: app-config
        key: spring.profiles.active   # 值为 "prod"
```

### 7.3 配置优先级链

Spring Boot 的配置优先级从高到低：

```text
命令行参数 > java:comp/env > 系统属性 > 系统环境变量
> application-{profile}.yml > application.yml > @PropertySource
> 默认属性（SpringApplication.setDefaultProperties）
```

**设计原则**：公共配置放 `application.yml`，环境差异配置放 `application-{profile}.yml`，敏感信息通过环境变量或 Secret 注入，**永远不要将密码写在代码仓库中**。

## 8. 本章小结

本章从三个维度构建了企业级 Java 应用的安全与部署体系：

| 维度 | 核心能力 | 关键技术 |
|------|---------|---------|
| **认证授权** | 身份认证 + 权限控制 | JWT / OAuth 2.0 / Spring Security / RBAC |
| **数据安全** | 传输加密 + 存储加密 + 日志脱敏 + 审计 | HTTPS / AES / Logback / AOP |
| **容器化部署** | 一致环境 + 快速部署 + 弹性伸缩 | Docker / Kubernetes / Spring Profiles |

> 系统安全部署上线了，但你怎么知道它运行得好不好？用户说"接口很慢"，你如何定位是数据库慢、缓存穿透还是下游超时？下一章从日志、指标、链路追踪三大支柱出发，构建完整的可观测体系。
