# 安全实践

> **核心问题**：如何在开发过程中融入安全？安全编码规范有哪些？

## 1. 安全编码规范

```java
// 规范 1：输入校验
// 所有外部输入必须校验。
// HTML 转义属于输出编码，应在输出层（模板引擎/渲染层）按最终输出
// 上下文执行，不要在此处提前转义，否则可能重复转义，或在 HTML 属性、
// JavaScript、URL 等其他上下文中仍不安全。
public class InputValidator {
    
    public static String sanitize(String input) {
        if (input == null) return null;
        // 去除前后空白
        input = input.trim();
        // 限制长度
        if (input.length() > 1000) {
            throw new IllegalArgumentException(\"输入过长\");
        }
        return input;
    }
    
    public static boolean isValidEmail(String email) {
        return email != null && email.matches(\"^[\\\\w.-]+@[\\\\w.-]+\\\\.[a-zA-Z]{2,}$\");
    }
    
    public static boolean isValidPhone(String phone) {
        return phone != null && phone.matches(\"^1[3-9]\\\\d{9}$\");
    }
}

// 规范 2：敏感数据处理
// 以下脱敏函数假设输入为合规格式（11 位手机号、标准银行卡号等），
// 异常格式应在业务校验层拦截，不要把这些示例当作通用脱敏工具。
public class SensitiveDataUtil {
    
    // 手机号脱敏：138****1234
    public static String maskPhone(String phone) {
        if (phone == null || phone.length() != 11) return phone;
        return phone.substring(0, 3) + \"****\" + phone.substring(7);
    }
    
    // 身份证脱敏：110***********1234
    public static String maskIdCard(String idCard) {
        if (idCard == null || idCard.length() < 8) return idCard;
        return idCard.substring(0, 3) + \"***********\" + idCard.substring(idCard.length() - 4);
    }
    
    // 邮箱脱敏：z***@example.com
    public static String maskEmail(String email) {
        if (email == null || !email.contains("@")) return email;
        int at = email.indexOf('@');
        return email.charAt(0) + "***" + email.substring(at);
    }
    
    // 银行卡号脱敏：6222****1234
    public static String maskCardNo(String cardNo) {
        if (cardNo == null || cardNo.length() < 8) return cardNo;
        return cardNo.substring(0, 4) + "****" + cardNo.substring(cardNo.length() - 4);
    }
}
// 规范 3：密码安全
// 大写/小写/数字/特殊字符的组合是业务策略，不是通用安全标准；
// 更可靠的做法是结合密码长度、常见密码拦截、登录限速与安全哈希。
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
log.info(\"支付信息: cardNo={}\", SensitiveDataUtil.maskCardNo(cardNo));
```

## 3. API 安全

```java
// API 安全清单
// 1. HTTPS 强制
// 2. 认证（JWT/Session）
// 3. 授权（RBAC/ABAC）
// 4. 限流（控制请求速率）
// 5. 输入校验
// 6. CORS 配置
```

CORS 配置要点：允许的来源用白名单（不要用 `*`）、限制允许的方法与请求头、按需开启凭证携带。各框架的 CORS 配置见 [Spring Security](../../spring/05-security/chapter-04-security-practice)。

边界澄清：
- CORS 是浏览器实施的跨源访问控制，不是服务端认证或授权机制；非浏览器客户端不受 CORS 策略约束，服务端仍须独立鉴权。
- 限流能缓解资源滥用，但不能单独等同于 DDoS 防护，大规模攻击还需 CDN、边缘防护与容量管理。
- 认证（JWT/Session）与授权（RBAC/ABAC）解决不同问题，还需明确令牌撤销、权限变更生效时间与对象级授权（防 IDOR）。
- CSRF 的风险关键在于浏览器是否自动附带凭证。Cookie 会话会被浏览器自动携带，需配合 CSRF Token 或 SameSite 防护；Bearer Token 由客户端显式放入请求头则不受影响，但若把令牌存在 Cookie 中，仍会面临 CSRF 风险。CSRF 与 CORS 是两个独立机制。

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
| :-- | :-- |
| 需求 | 安全需求分析、威胁建模 |
| 设计 | 安全架构评审 |
| 编码 | 安全编码规范、代码审查 |
| 测试 | 安全测试（渗透测试、漏洞扫描） |
| 部署 | 安全配置检查 |
| 运维 | 安全监控、应急响应 |

> **安全的核心**：安全是过程，不是产品。它需要在开发的每个阶段持续关注，而不是上线前的临时抱佛脚。

漏洞处置闭环：威胁识别 → 控制措施 → 自动化检测 → 风险分级 → 修复与复测 → 生产监控。依赖扫描（§4）发现漏洞后，应结合实际调用路径、可达性、暴露范围与利用状态确定风险等级，而不是仅依据扫描结果或 CVSS 分数。修复成本只影响处置排期，不改变漏洞的风险等级。

职责分工：[认证](./chapter-02-authentication.md)、[授权](./chapter-03-authorization.md)、[常见攻击与防御](./chapter-04-common-attacks.md)及 Spring Security 的实现细节由对应章节维护，本章聚焦通用工程原则。

## 6. 敏感数据存储加密

数据库中的敏感字段按类型区分存储方式。密码必须用带独立随机盐的自适应哈希存储，如 Argon2id、bcrypt 或适当配置的 PBKDF2，不可逆。身份证号、银行卡号等需要恢复原值的敏感数据才用可逆加密，如 AES-GCM：

```java
@Component
public class EncryptUtil {

    private static final String AES_KEY = System.getenv("AES_ENCRYPT_KEY");
    private static final SecureRandom SECURE_RANDOM = new SecureRandom();

    static {
        // 启动时校验密钥：必须存在且为 AES 合法长度 16/24/32 字节
        if (AES_KEY == null || AES_KEY.isEmpty()) {
            throw new IllegalStateException("未配置 AES_ENCRYPT_KEY 环境变量");
        }
        byte[] keyBytes = AES_KEY.getBytes(StandardCharsets.UTF_8);
        if (keyBytes.length != 16 && keyBytes.length != 24 && keyBytes.length != 32) {
            throw new IllegalStateException(
                "AES_ENCRYPT_KEY 须为 16/24/32 字节（UTF-8）");
        }
    }

    public static String encrypt(String plainText) {
        try {
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            SecretKeySpec keySpec = new SecretKeySpec(
                AES_KEY.getBytes(StandardCharsets.UTF_8), "AES");
            byte[] iv = new byte[12];
            SECURE_RANDOM.nextBytes(iv);
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

要点：密钥走环境变量或 KMS，不落代码库。长度合法不等于密钥安全，密钥须来自安全随机源或 KMS 生成的高熵密钥。GCM 模式自带完整性校验，比 CBC 更安全，同一密钥下 nonce 不得重复。生产环境还需设计密钥轮换与密文版本标识。新密钥不能直接解密旧密文，轮换期间可受控保留旧密钥用于解密，并在密文头部写入密钥版本，逐步重加密历史数据。加密或解密失败不得降级为明文处理。

## 7. 日志脱敏

敏感信息一旦进入日志，会随日志流转到多个下游系统，扩大泄露面。用 Logback 自定义 Converter 统一脱敏：

```java
public class SensitiveDataConverter extends ClassicConverter {

    private static final Pattern PHONE_PATTERN =
        Pattern.compile("(1[3-9]\\d)\\d{4}(\\d{4})");
    private static final Pattern ID_CARD_PATTERN =
        Pattern.compile("(\\d{6})\\d{8}(\\d{3}[0-9Xx])");

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

正则脱敏只是纵深防御，不能作为唯一防线。优先做法是避免记录密码、CVV、令牌等敏感信息；结构化日志应在字段写入前脱敏，而不是事后靠正则扫描。正则也无法覆盖所有格式与绕过情况，需配合测试。

## 8. 操作审计

企业系统必须记录"谁在什么时间做了什么操作"，用于事后追溯和合规：

```java
@Aspect
@Component
public class AuditAspect {

    @Around("@annotation(auditLog)")
    public Object audit(ProceedingJoinPoint joinPoint, AuditLog auditLog) throws Throwable {
        // 主体可能为 UserDetails、字符串或自定义类型，匿名请求与系统任务须单独处理
        Long userId = currentUserService.currentUserId();
        boolean success = true;
        try {
            return joinPoint.proceed();
        } catch (Throwable e) {
            success = false;
            throw e;
        } finally {
            try {
                auditLogService.save(AuditRecord.builder()
                    .userId(userId)
                    .module(auditLog.module())
                    .operation(auditLog.operation())
                    .method(joinPoint.getSignature().toShortString())
                    .success(success)
                    .createdAt(Instant.now())
                    .build());
            } catch (Exception auditException) {
                // 审计作为旁路记录，失败只告警、不覆盖业务结果。
                // 高风险操作要求审计与业务强一致时，应改为同事务写入，
                // 审计失败随业务事务回滚，此时不能在此吞掉异常。
                log.error("审计写入失败", auditException);
            }
        }
    }
}
```

审计身份应通过项目统一的当前用户服务提取，避免在切面中直接对 `getPrincipal()` 强转类型，匿名请求与系统任务需定义明确的审计身份。审计写入默认作为旁路记录，失败只告警、不覆盖业务结果。高风险操作若要求审计与业务强一致，应同事务写审计表，审计失败随业务事务回滚，此时不得吞掉审计异常。若采用异步审计，则要设计可靠交付、重试与去重。时间统一用 `Instant`，并按需补充操作结果、目标资源、请求关联 ID 等字段，避免记录密码、令牌等敏感数据。
