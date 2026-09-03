# 企业系统安全

> 某公司用户数据被拖库，原因是密码用明文存储、SQL 注入没防住、接口没有鉴权。这不是段子，是每年都在发生的真实事故。身份认证怎么选型？权限怎么设计才能既灵活又安全？敏感数据怎么保护？本章从认证授权、数据安全两个维度，讲清楚企业级 Java 应用的安全底线。

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
│  │              FilterChainProxy                               │ │
│  │                                                             │ │
│  │  ┌──────────┐  ┌──────────────────┐  ┌──────────────────┐   │ │
│  │  │ Security │  │ Authentication   │  │  Authorization   │   │ │
│  │  │ Context  │  │     Filter       │  │     Filter       │   │ │
│  │  │  Filter  │  │ (认证：你是谁？)   │  │ (授权：你能做什么？)│   │ │
│  │  └──────────┘  └──────────────────┘  └──────────────────┘   │ │
│  └─────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────┘
    │
    ▼
  Controller
```

### 2.2 认证流程详解

一次登录认证的完整流程，各组件按顺序协作：

```mermaid
sequenceDiagram
    autonumber
    actor Client as 用户(浏览器)
    participant F as AuthenticationFilter
    participant M as AuthenticationManager
    participant P as DaoAuthenticationProvider
    participant U as UserDetailsService
    participant E as PasswordEncoder
    participant S as SecurityContextHolder

    Client->>F: 提交用户名/密码
    Note over F: 创建未认证的 Authentication 对象
    F->>M: authenticate(authentication)
    M->>P: authenticate(authentication)
    P->>U: loadUserByUsername(username)
    U-->>P: 返回 UserDetails（含密码、权限）
    P->>E: matches(rawPassword, encodedPassword)
    E-->>P: 返回匹配结果
    P-->>M: 返回已认证 Authentication
    M-->>F: 返回已认证 Authentication
    F->>S: setAuthentication(auth)
    Note over S: 后续请求通过 getAuthentication() 获取当前用户
```

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

RBAC 的五表建表语句、与 Spring Security 的集成（`UserDetailsService` + `@PreAuthorize`）等完整实现，见 [授权模型](./chapter-03-authorization.md) §1，本节只保留模型概览。

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

## 5. 本章小结

本章从两个维度构建了企业级 Java 应用的安全体系：

| 维度 | 核心能力 | 关键技术 |
|------|---------|---------|
| **认证授权** | 身份认证 + 权限控制 | JWT / OAuth 2.0 / Spring Security / RBAC |
| **数据安全** | 传输加密 + 存储加密 + 日志脱敏 + 审计 | HTTPS / AES / Logback / AOP |

> 系统安全上线了，但你怎么知道它运行得好不好？用户说"接口很慢"，你如何定位是数据库慢、缓存穿透还是下游超时？下一章从日志、指标、链路追踪三大支柱出发，构建完整的可观测体系。
