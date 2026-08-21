# 安全实践

> **核心问题**：如何在开发过程中融入安全？安全编码规范有哪些？

---

## 1. 安全编码规范

```java\n// 规范 1：输入校验\n// 所有外部输入必须校验\npublic class InputValidator {\n    \n    public static String sanitize(String input) {\n        if (input == null) return null;\n        // 去除前后空白\n        input = input.trim();\n        // 限制长度\n        if (input.length() > 1000) {\n            throw new IllegalArgumentException(\"输入过长\");\n        }\n        // HTML 转义\n        return StringEscapeUtils.escapeHtml4(input);\n    }\n    \n    public static boolean isValidEmail(String email) {\n        return email != null && email.matches(\"^[\\\\w.-]+@[\\\\w.-]+\\\\.[a-zA-Z]{2,}$\");\n    }\n    \n    public static boolean isValidPhone(String phone) {\n        return phone != null && phone.matches(\"^1[3-9]\\\\d{9}$\");\n    }\n}\n\n// 规范 2：敏感数据处理\npublic class SensitiveDataUtil {\n    \n    // 手机号脱敏：138****1234\n    public static String maskPhone(String phone) {\n        if (phone == null || phone.length() < 7) return phone;\n        return phone.substring(0, 3) + \"****\" + phone.substring(7);\n    }\n    \n    // 身份证脱敏：110***********1234\n    public static String maskIdCard(String idCard) {\n        if (idCard == null || idCard.length() < 8) return idCard;\n        return idCard.substring(0, 3) + \"***********\" + idCard.substring(idCard.length() - 4);\n    }\n    \n    // 邮箱脱敏：z***@example.com\n    public static String maskEmail(String email) {\n        if (email == null || !email.contains(\"@\")) return email;\n        int at = email.indexOf('@');\n        return email.charAt(0) + \"***\" + email.substring(at);\n    }\n}\n\n// 规范 3：密码安全\npublic class PasswordPolicy {\n    \n    public static boolean isStrongPassword(String password) {\n        if (password == null || password.length() < 8) return false;\n        boolean hasUpper = password.chars().anyMatch(Character::isUpperCase);\n        boolean hasLower = password.chars().anyMatch(Character::isLowerCase);\n        boolean hasDigit = password.chars().anyMatch(Character::isDigit);\n        boolean hasSpecial = password.chars().anyMatch(c -> \"!@#$%^&*\".indexOf(c) >= 0);\n        return hasUpper && hasLower && hasDigit && hasSpecial;\n    }\n}\n```\n\n## 2. 日志安全\n\n```java\n// 差：日志中记录敏感信息\nlog.info(\"用户登录: username={}, password={}\", username, password);\nlog.info(\"支付信息: cardNo={}, cvv={}\", cardNo, cvv);\n\n// 好：日志脱敏\nlog.info(\"用户登录: username={}\", username);  // 不记录密码\nlog.info(\"支付信息: cardNo={}\", SensitiveDataUtil.maskPhone(cardNo));\n```\n\n## 3. API 安全\n\n```java\n// API 安全清单\n// 1. HTTPS 强制\n// 2. 认证（JWT/Session）\n// 3. 授权（RBAC/ABAC）\n// 4. 限流（防 DDoS）\n// 5. 输入校验\n// 6. CORS 配置\n\n@Configuration\npublic class WebSecurityConfig {\n    \n    @Bean\n    public CorsConfigurationSource corsConfigurationSource() {\n        CorsConfiguration config = new CorsConfiguration();\n        config.setAllowedOrigins(List.of(\"https://www.example.com\"));  // 不要用 *\n        config.setAllowedMethods(List.of(\"GET\", \"POST\", \"PUT\", \"DELETE\"));\n        config.setAllowedHeaders(List.of(\"Authorization\", \"Content-Type\"));\n        config.setAllowCredentials(true);\n        config.setMaxAge(3600L);\n        \n        UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();\n        source.registerCorsConfiguration(\"/api/**\", config);\n        return source;\n    }\n}\n```\n\n## 4. 依赖安全\n\n```bash\n# 使用 OWASP Dependency-Check 检查依赖漏洞\nmvn org.owasp:dependency-check-maven:check\n\n# 使用 Snyk 检查\nsnyk test\n\n# 定期更新依赖\nmvn versions:display-dependency-updates\n```\n\n## 5. 安全开发流程\n\n| 阶段 | 安全活动 |\n|------|----------|\n| 需求 | 安全需求分析、威胁建模 |\n| 设计 | 安全架构评审 |\n| 编码 | 安全编码规范、代码审查 |\n| 测试 | 安全测试（渗透测试、漏洞扫描） |\n| 部署 | 安全配置检查 |\n| 运维 | 安全监控、应急响应 |\n\n> **安全的核心**：安全是过程，不是产品。它需要在开发的每个阶段持续关注，而不是上线前的临时抱佛脚。

---

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
```\n