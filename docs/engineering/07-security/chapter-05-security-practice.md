# 安全实践

> **核心问题**：如何在开发过程中融入安全？安全编码规范有哪些？

## 1. 安全编码规范

```java
// 规范 1：输入校验
// 所有外部输入必须校验
public class InputValidator {
    
    public static String sanitize(String input) {
        if (input == null) return null;
        // 去除前后空白
        input = input.trim();
        // 限制长度
        if (input.length() > 1000) {
            throw new IllegalArgumentException(\"输入过长\");
        }
        // HTML 转义
        return StringEscapeUtils.escapeHtml4(input);
    }
    
    public static boolean isValidEmail(String email) {
        return email != null && email.matches(\"^[\\\\w.-]+@[\\\\w.-]+\\\\.[a-zA-Z]{2,}$\");
    }
    
    public static boolean isValidPhone(String phone) {
        return phone != null && phone.matches(\"^1[3-9]\\\\d{9}$\");
    }
}

// 规范 2：敏感数据处理
public class SensitiveDataUtil {
    
    // 手机号脱敏：138****1234
    public static String maskPhone(String phone) {
        if (phone == null || phone.length() < 7) return phone;
        return phone.substring(0, 3) + \"****\" + phone.substring(7);
    }
    
    // 身份证脱敏：110***********1234
    public static String maskIdCard(String idCard) {
        if (idCard == null || idCard.length() < 8) return idCard;
        return idCard.substring(0, 3) + \"***********\" + idCard.substring(idCard.length() - 4);
    }
    
    // 邮箱脱敏：z***@example.com
    public static String maskEmail(String email) {
        if (email == null || !email.contains(\"@\")) return email;
        int at = email.indexOf('@');
        return email.charAt(0) + \"***\" + email.substring(at);
    }
}

// 规范 3：密码安全
public class PasswordPolicy {
    
    public static boolean isStrongPassword(String password) {
        if (password == null || password.length() < 8) return false;
        boolean hasUpper = password.chars().anyMatch(Character::isUpperCase);
        boolean hasLower = password.chars().anyMatch(Character::isLowerCase);
        boolean hasDigit = password.chars().anyMatch(Character::isDigit);
        boolean hasSpecial = password.chars().anyMatch(c -> \"!@#$%^&*\".indexOf(c) >= 0);
        return hasUpper && hasLower && hasDigit && hasSpecial;
    }
}
```

## 2. 日志安全

```java
// 差：日志中记录敏感信息
log.info(\"用户登录: username={}, password={}\", username, password);
log.info(\"支付信息: cardNo={}, cvv={}\", cardNo, cvv);

// 好：日志脱敏
log.info(\"用户登录: username={}\", username);  // 不记录密码
log.info(\"支付信息: cardNo={}\", SensitiveDataUtil.maskPhone(cardNo));
```

## 3. API 安全

```java
// API 安全清单
// 1. HTTPS 强制
// 2. 认证（JWT/Session）
// 3. 授权（RBAC/ABAC）
// 4. 限流（防 DDoS）
// 5. 输入校验
// 6. CORS 配置

@Configuration
public class WebSecurityConfig {
    
    @Bean
    public CorsConfigurationSource corsConfigurationSource() {
        CorsConfiguration config = new CorsConfiguration();
        config.setAllowedOrigins(List.of(\"https://www.example.com\"));  // 不要用 *
        config.setAllowedMethods(List.of(\"GET\", \"POST\", \"PUT\", \"DELETE\"));
        config.setAllowedHeaders(List.of(\"Authorization\", \"Content-Type\"));
        config.setAllowCredentials(true);
        config.setMaxAge(3600L);
        
        UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
        source.registerCorsConfiguration(\"/api/**\", config);
        return source;
    }
}
```

## 4. 依赖安全

```bash
# 使用 OWASP Dependency-Check 检查依赖漏洞
mvn org.owasp:dependency-check-maven:check

# 使用 Snyk 检查
snyk test

# 定期更新依赖
mvn versions:display-dependency-updates
```

## 5. 安全开发流程

| 阶段 | 安全活动 |
|------|----------|
| 需求 | 安全需求分析、威胁建模 |
| 设计 | 安全架构评审 |
| 编码 | 安全编码规范、代码审查 |
| 测试 | 安全测试（渗透测试、漏洞扫描） |
| 部署 | 安全配置检查 |
| 运维 | 安全监控、应急响应 |

> **安全的核心**：安全是过程，不是产品。它需要在开发的每个阶段持续关注，而不是上线前的临时抱佛脚。

## 6. 敏感数据存储加密

数据库中的密码、身份证号、银行卡号等敏感字段必须加密存储：

```java
@Component
public class EncryptUtil {

    private static final String AES_KEY = System.getenv("AES_ENCRYPT_KEY");

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

要点：密钥走环境变量或 KMS，不落代码库；GCM 模式自带完整性校验，比 CBC 更安全。

## 7. 日志脱敏

日志中出现敏感信息是最常见的安全漏洞之一。用 Logback 自定义 Converter 统一脱敏：

```java
public class SensitiveDataConverter extends ClassicConverter {

    private static final Pattern PHONE_PATTERN =
        Pattern.compile("(1[3-9]\d)\d{4}(\d{4})");
    private static final Pattern ID_CARD_PATTERN =
        Pattern.compile("(\d{6})\d{8}(\d{3}[0-9Xx])");

    @Override
    public String convert(ILoggingEvent event) {
        String msg = event.getFormattedMessage();
        msg = PHONE_PATTERN.matcher(msg).replaceAll("$1****$2");
        msg = ID_CARD_PATTERN.matcher(msg).replaceAll("$1********$2");
        return msg;
    }
}
```

在 `logback-spring.xml` 注册 `<conversionRule conversionWord="desensitize" converterClass="...SensitiveDataConverter" />`，pattern 中用 `%desensitize` 引用。

## 8. 操作审计

企业系统必须记录"谁在什么时间做了什么操作"，用于事后追溯和合规：

```java
@Aspect
@Component
public class AuditAspect {

    @Around("@annotation(auditLog)")
    public Object audit(ProceedingJoinPoint joinPoint, AuditLog auditLog) throws Throwable {
        Long userId = (Long) SecurityContextHolder.getContext()
            .getAuthentication().getPrincipal();

        try {
            return joinPoint.proceed();
        } finally {
            auditLogService.save(AuditRecord.builder()
                .userId(userId)
                .module(auditLog.module())
                .operation(auditLog.operation())
                .method(joinPoint.getSignature().toShortString())
                .createdAt(LocalDateTime.now())
                .build());
        }
    }
}
```
