# 安全最佳实践

## 1. 密码加密（BCrypt vs MD5）

**痛点**：2024年了还有人用 MD5 存密码——MD5不是加密算法，是哈希算法，而且已经被彩虹表攻破了。

**BCrypt 为什么比 MD5 安全**：

| 特性 | MD5 | SHA-256 | BCrypt |
| :-- | :-- | :-- | :-- |
| 类型 | 哈希 | 哈希 | 自适应哈希 |
| 盐值（Salt） | ❌ 需要手动加 | ❌ 需要手动加 | ✅ 自动生成 |
| 计算速度 | ⚡ 极快（10 亿次/秒） | ⚡ 快 | 🐌 故意慢（可调节） |
| 抗彩虹表 | ❌ | ❌ | ✅ |
| 抗 GPU 暴力破解 | ❌ | ❌ | ✅（内存密集型） |

**Spring Boot 使用 BCrypt**：

```java
@Configuration
public class PasswordConfig {

    @Bean
    public PasswordEncoder passwordEncoder() {
        // BCrypt 强度因子（默认 10，推荐 12）
        return new BCryptPasswordEncoder(12);
    }
}
```

```java
@Service
@RequiredArgsConstructor
public class UserService {

    private final PasswordEncoder passwordEncoder;
    private final UserRepository userRepository;

    public User register(RegisterRequest request) {
        User user = new User();
        user.setUsername(request.getUsername());
        // 永远不要明文存储密码
        user.setPassword(passwordEncoder.encode(request.getPassword()));
        return userRepository.save(user);
    }
}
```

**BCrypt 强度因子说明**：

```
BCryptPasswordEncoder(4)  → ~0.01 秒，不推荐
BCryptPasswordEncoder(10) → ~0.1 秒，默认值
BCryptPasswordEncoder(12) → ~0.5 秒，推荐
BCryptPasswordEncoder(14) → ~2 秒，高安全场景
BCryptPasswordEncoder(31) → ~数天，别用，服务器会炸
```

> **踩坑提醒**：BCrypt 生成的哈希值每次都不一样（因为随机盐值），所以你不能用 `passwordEncoder.encode("123").equals(storedHash)` 来验证——必须用 `passwordEncoder.matches()`。另外，BCrypt 有 72 字节截断限制，超过 72 字节的密码部分会被忽略。

## 2. 敏感数据加密存储（Jasypt）

**痛点**：用户的身份证号、手机号、银行卡号，数据库管理员直接 `SELECT *` 就能看到。你需要字段级加密。

### 2.1 Jasypt 配置文件加密

```yaml
# application.yml — 加密后的配置值用 ENC() 包裹
spring:
  datasource:
    password: ENC(nrmZ02SmGMjFZhsxluDbOoH4P9kX8bBn)

jasypt:
  encryptor:
    password: ${JASYPT_MASTER_KEY}  # 主密钥，通过环境变量传入
    algorithm: PBEWITHHMACSHA512ANDAES_256
    iv-generator-classname: org.jasypt.iv.RandomIvGenerator
```

```xml
<!-- pom.xml -->
<dependency>
    <groupId>com.github.ulisesbocchio</groupId>
    <artifactId>jasypt-spring-boot-starter</artifactId>
    <version>3.0.5</version>
</dependency>
```

### 2.2 JPA AttributeConverter 字段加密

```java
@Converter
public class EncryptedStringConverter implements AttributeConverter<String, String> {

    private static final String SECRET_KEY = System.getenv("FIELD_ENCRYPT_KEY");
    private static final String ALGORITHM = "AES/GCM/NoPadding";

    @Override
    public String convertToDatabaseColumn(String attribute) {
        if (attribute == null) return null;
        try {
            SecretKey key = deriveKey();
            Cipher cipher = Cipher.getInstance(ALGORITHM);
            cipher.init(Cipher.ENCRYPT_MODE, key);
            byte[] iv = cipher.getIV();
            byte[] encrypted = cipher.doFinal(
                attribute.getBytes(StandardCharsets.UTF_8));
            byte[] combined = new byte[iv.length + encrypted.length];
            System.arraycopy(iv, 0, combined, 0, iv.length);
            System.arraycopy(encrypted, 0, combined, iv.length, encrypted.length);
            return Base64.getEncoder().encodeToString(combined);
        } catch (Exception e) {
            throw new RuntimeException("加密失败", e);
        }
    }

    @Override
    public String convertToEntityAttribute(String dbData) {
        if (dbData == null) return null;
        try {
            byte[] combined = Base64.getDecoder().decode(dbData);
            byte[] iv = Arrays.copyOfRange(combined, 0, 12); // GCM IV 固定12字节
            byte[] encrypted = Arrays.copyOfRange(combined, 12, combined.length);
            SecretKey key = deriveKey();
            Cipher cipher = Cipher.getInstance(ALGORITHM);
            cipher.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(128, iv));
            return new String(cipher.doFinal(encrypted), StandardCharsets.UTF_8);
        } catch (Exception e) {
            throw new RuntimeException("解密失败", e);
        }
    }

    private SecretKey deriveKey() {
        return new SecretKeySpec(
            SECRET_KEY.getBytes(StandardCharsets.UTF_8), "AES");
    }
}

// 在实体中使用
@Entity
public class Customer {
    @Id
    private Long id;
    private String name;  // 明文

    @Convert(converter = EncryptedStringConverter.class)
    private String idCardNumber;  // 加密存储

    @Convert(converter = EncryptedStringConverter.class)
    private String phoneNumber;   // 加密存储
}
```

> **踩坑提醒**：字段加密后你就不能用 `WHERE phone = ?` 做精确查询了（每次加密的 IV 不同，同明文不同密文）。解决方案：① 存一个不可逆哈希用于查询，密文用于解密展示；② 用确定性加密（固定 IV），但安全性降低。

## 3. CSRF 防护

```java
@Configuration
public class SecurityConfig {
    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        http.csrf(csrf -> csrf
            .csrfTokenRepository(CookieCsrfTokenRepository.withHttpOnlyFalse()));
        return http.build();
    }
}
```

## 4. CORS 配置

```java
@Configuration
public class CorsConfig implements WebMvcConfigurer {
    @Override
    public void addCorsMappings(CorsRegistry registry) {
        registry.addMapping("/api/**")
                .allowedOrigins("https://example.com")
                .allowedMethods("GET", "POST", "PUT", "DELETE")
                .allowCredentials(true);
    }
}
```

## 5. 安全响应头配置

**痛点**：你的网站能被 iframe 嵌入（Clickjacking）、加载外部脚本（XSS）、HTTP 被降级（MITM）。安全响应头是最轻量的防御层。

```java
@Bean
public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
    http.headers(headers -> headers
        // Content Security Policy — 防 XSS
        .contentSecurityPolicy(csp -> csp
            .policyDirectives(
                "default-src 'self'; " +
                "script-src 'self' https://cdn.jsdelivr.net; " +
                "style-src 'self' 'unsafe-inline'; " +
                "img-src 'self' data: https:; " +
                "font-src 'self' https://fonts.gstatic.com; " +
                "frame-ancestors 'none';"  // 防 Clickjacking
            )
        )
        // X-Frame-Options — 防 Clickjacking
        .frameOptions(frame -> frame.deny())
        // HSTS — 强制 HTTPS
        .httpStrictTransportSecurity(hsts -> hsts
            .includeSubDomains(true)
            .maxAgeInSeconds(31536000)     // 1 年
        )
        // 不要暴露服务器信息
        .defaultsDisabled()
    );
    return http.build();
}
```

**常见安全头说明**：

| 安全头 | 作用 | 推荐值 |
| :-- | :-- | :-- |
| `Content-Security-Policy` | 限制资源加载来源，防 XSS | `default-src 'self'` |
| `X-Frame-Options` | 防止页面被 iframe 嵌入 | `DENY` 或 `SAMEORIGIN` |
| `Strict-Transport-Security` | 强制使用 HTTPS | `max-age=31536000; includeSubDomains` |
| `X-Content-Type-Options` | 防止 MIME 类型嗅探 | `nosniff` |
| `X-XSS-Protection` | 浏览器 XSS 过滤器 | `1; mode=block`（旧浏览器用） |
| `Referrer-Policy` | 控制 Referer 信息泄露 | `strict-origin-when-cross-origin` |
| `Permissions-Policy` | 限制浏览器 API 使用 | `camera=(), microphone=()` |

> **踩坑提醒**：CSP 配置太严格会把你的前端页面搞挂——比如 `script-src 'self'` 会阻止所有内联脚本。建议先用 `Content-Security-Policy-Report-Only` 头观察哪些资源会被拦截，确认无误后再正式启用。

## 6. 安全最佳实践清单

### 4.1 输入验证与 SQL 注入防护

```java
// MyBatis 参数化查询（安全）
@Select("SELECT * FROM users WHERE id = #{id}")
User findById(@Param("id") Long id);

// ❌ 危险：字符串拼接（SQL 注入）
@Select("SELECT * FROM users WHERE name = '" + "${name}" + "'")
User findByName(@Param("name") String name);
```

### 4.2 XSS 防护

```java
@Component
public class XssFilter extends OncePerRequestFilter {

    @Override
    protected void doFilterInternal(HttpServletRequest request,
            HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        chain.doFilter(new XssRequestWrapper(request), response);
    }
}

public class XssRequestWrapper extends HttpServletRequestWrapper {

    public XssRequestWrapper(HttpServletRequest request) {
        super(request);
    }

    @Override
    public String getParameter(String name) {
        String value = super.getParameter(name);
        return value != null ? cleanXSS(value) : null;
    }

    @Override
    public String[] getParameterValues(String name) {
        String[] values = super.getParameterValues(name);
        if (values == null) return null;
        return Arrays.stream(values).map(this::cleanXSS).toArray(String[]::new);
    }

    private String cleanXSS(String value) {
        return value
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll("\"", "&quot;")
            .replaceAll("'", "&#39;")
            .replaceAll("javascript:", "")
            .replaceAll("on\\w+=", "");
    }
}
```

### 4.3 安全头部配置

```java
@Bean
public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
    http.headers(headers -> headers
        // 防止点击劫持
        .frameOptions(frame -> frame.deny())
        // XSS 防护
        .xssProtection(xss -> xss
            .headerValue(XXssProtectionHeaderWriter.HeaderValue.ENABLED_MODE_BLOCK))
        // 内容安全策略
        .contentSecurityPolicy(csp -> csp
            .policyDirectives("default-src 'self'; " +
                "script-src 'self' 'unsafe-inline'; " +
                "style-src 'self' 'unsafe-inline'"))
        // HSTS（HTTPS 强制）
        .httpStrictTransportSecurity(hsts -> hsts
            .includeSubDomains(true)
            .maxAgeInSeconds(31536000))
        // 禁止浏览器嗅探 MIME 类型
        .contentTypeOptions(contentType -> {}));
    return http.build();
}
```

### 4.4 接口幂等性

```java
@Target(ElementType.METHOD)
@Retention(RetentionPolicy.RUNTIME)
public @interface Idempotent {
    long timeout() default 5;  // 幂等窗口 5 秒
    TimeUnit unit() default TimeUnit.SECONDS;
    String message() default "请勿重复提交";
}

@Aspect
@Component
public class IdempotentAspect {

    @Autowired
    private StringRedisTemplate redisTemplate;

    @Around("@annotation(idempotent)")
    public Object check(ProceedingJoinPoint pjp, Idempotent idempotent) throws Throwable {
        // 构建幂等 key：用户ID + 请求方法 + 参数哈希
        String userId = SecurityContextHolder.getContext().getAuthentication().getName();
        String method = pjp.getSignature().toShortString();
        String argsHash = Integer.toHexString(Arrays.deepHashCode(pjp.getArgs()));
        String key = "idempotent:" + userId + ":" + method + ":" + argsHash;

        // 尝试设置 key（原子操作）
        Boolean success = redisTemplate.opsForValue()
            .setIfAbsent(key, "1", idempotent.timeout(), idempotent.unit());

        if (!Boolean.TRUE.equals(success)) {
            throw new BusinessException(429, idempotent.message());
        }

        try {
            return pjp.proceed();
        } catch (Throwable t) {
            // 业务异常时删除幂等 key，允许重试
            redisTemplate.delete(key);
            throw t;
        }
    }
}

// 使用
@Idempotent(timeout = 10, message = "订单创建中，请勿重复提交")
@PostMapping("/api/orders")
public Order createOrder(@RequestBody OrderRequest request) {
    return orderService.create(request);
}
```

**安全清单：**

| 类别 | 措施 | 优先级 |
| :-- | :-- | :-- |
| **传输安全** | 全站 HTTPS，HSTS 头部 | 🔴 必须 |
| **认证** | BCrypt 密码哈希，JWT 签名验证 | 🔴 必须 |
| **授权** | RBAC 权限模型，接口级 + 数据级 | 🔴 必须 |
| **输入验证** | 参数校验，SQL 参数化，XSS 过滤 | 🔴 必须 |
| **CSRF** | 前后端分离可禁用，传统表单必须开启 | 🟡 视场景 |
| **CORS** | 精确配置允许的域名，不要用 `*` | 🟡 视场景 |
| **限流** | Nginx/网关限流 + 应用层限流 | 🟡 推荐 |
| **日志脱敏** | 密码、身份证、手机号脱敏 | 🟡 推荐 |
| **审计** | 关键操作审计日志 | 🟡 推荐 |
| **依赖安全** | 定期扫描依赖漏洞（OWASP Dependency-Check） | 🟡 推荐 |
