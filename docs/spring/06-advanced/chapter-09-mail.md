# 邮件发送 (Spring Mail)

> 注册确认、密码重置、订单通知——邮件是应用的标准触达方式。Spring 抽象了 `JavaMailSender` 接口，支持简单邮件、HTML 邮件、模板邮件、附件。底层协议是 SMTP，Spring Boot 自动配置连接参数。

## 1. 依赖与配置

```xml
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-mail</artifactId>
</dependency>
```

```yaml
spring:
  mail:
    host: smtp.example.com
    port: 587
    username: ${MAIL_USERNAME}
    password: ${MAIL_PASSWORD}
    properties:
      mail:
        smtp:
          auth: true
          starttls:
            enable: true
          connectiontimeout: 5000
          timeout: 5000
```

## 2. 发送简单邮件

```java
@Service
public class MailService {

    @Autowired
    private JavaMailSender mailSender;

    @Value("${spring.mail.username}")
    private String from;

    // 纯文本邮件
    public void sendSimpleMail(String to, String subject, String text) {
        SimpleMailMessage message = new SimpleMailMessage();
        message.setFrom(from);
        message.setTo(to);
        message.setSubject(subject);
        message.setText(text);
        mailSender.send(message);
    }

    // HTML 邮件
    public void sendHtmlMail(String to, String subject, String html) throws MessagingException {
        MimeMessage message = mailSender.createMimeMessage();
        MimeMessageHelper helper = new MimeMessageHelper(message, true, "UTF-8");
        helper.setFrom(from);
        helper.setTo(to);
        helper.setSubject(subject);
        helper.setText(html, true);  // true 表示 HTML 格式
        mailSender.send(message);
    }

    // 带附件
    public void sendAttachmentMail(String to, String subject, String text,
                                   String attachmentName, Resource attachment)
            throws MessagingException {
        MimeMessage message = mailSender.createMimeMessage();
        MimeMessageHelper helper = new MimeMessageHelper(message, true);
        helper.setFrom(from);
        helper.setTo(to);
        helper.setSubject(subject);
        helper.setText(text);
        helper.addAttachment(attachmentName, attachment);
        mailSender.send(message);
    }

    // 内嵌图片
    public void sendInlineMail(String to, String subject, String html,
                               String imageId, Resource image)
            throws MessagingException {
        MimeMessage message = mailSender.createMimeMessage();
        MimeMessageHelper helper = new MimeMessageHelper(message, true);
        helper.setFrom(from);
        helper.setTo(to);
        helper.setSubject(subject);
        helper.setText(html, true);
        helper.addInline(imageId, image);  // html 中用 <img src="cid:imageId"/>
        mailSender.send(message);
    }
}
```

## 3. 模板邮件

### 3.1 Thymeleaf 模板

```xml
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-thymeleaf</artifactId>
</dependency>
```

```html
<!-- src/main/resources/templates/mail/verify.html -->
<!DOCTYPE html>
<html xmlns:th="http://www.thymeleaf.org">
<body>
    <h2>注册确认</h2>
    <p>你好，<span th:text="${username}">用户</span></p>
    <p>请点击以下链接完成注册：</p>
    <a th:href="${verifyUrl}">确认注册</a>
    <p>链接 30 分钟内有效。</p>
</body>
</html>
```

```java
@Service
public class TemplateMailService {

    @Autowired
    private JavaMailSender mailSender;

    @Autowired
    private TemplateEngine templateEngine;

    @Value("${spring.mail.username}")
    private String from;

    public void sendVerifyMail(String to, String username, String verifyUrl)
            throws MessagingException {
        // 渲染模板
        Context context = new Context();
        context.setVariable("username", username);
        context.setVariable("verifyUrl", verifyUrl);
        String html = templateEngine.process("mail/verify", context);

        // 发送
        MimeMessage message = mailSender.createMimeMessage();
        MimeMessageHelper helper = new MimeMessageHelper(message, true, "UTF-8");
        helper.setFrom(from);
        helper.setTo(to);
        helper.setSubject("请确认你的注册");
        helper.setText(html, true);
        mailSender.send(message);
    }
}
```

### 3.2 FreeMarker 模板

```java
@Autowired
private FreeMarkerConfigurationFactory freeMarkerConfig;

public void sendMail(String to, Map<String, Object> model) throws Exception {
    Template template = freeMarkerConfig.createConfiguration().getTemplate("mail/order.ftl");
    String html = FreeMarkerTemplateUtils.processTemplateIntoString(template, model);
    // 发送 HTML 邮件...
}
```

## 4. 异步发送

邮件发送是 IO 操作，不应阻塞主线程：

```java
@Service
public class AsyncMailService {

    @Autowired
    private MailService mailService;

    @Async
    public void sendVerifyMailAsync(String to, String username, String verifyUrl) {
        try {
            mailService.sendVerifyMail(to, username, verifyUrl);
        } catch (Exception e) {
            log.error("邮件发送失败: to={}", to, e);
            // 记录失败，后续重试
            mailFailureRepository.save(new MailFailure(to, "verify", e.getMessage()));
        }
    }
}
```

## 5. 重试与失败处理

```java
@Configuration
@EnableRetry
public class MailRetryConfig {}

@Service
public class ReliableMailService {

    @Autowired
    private JavaMailSender mailSender;

    @Retryable(
        value = {MailException.class},
        maxAttempts = 3,
        backoff = @Backoff(delay = 2000, multiplier = 2)
    )
    public void sendWithRetry(String to, String subject, String content) {
        SimpleMailMessage message = new SimpleMailMessage();
        message.setFrom(from);
        message.setTo(to);
        message.setSubject(subject);
        message.setText(content);
        mailSender.send(message);
    }

    @Recover
    public void recover(MailException e, String to, String subject, String content) {
        log.error("邮件发送最终失败: to={}", to, e);
        // 存入数据库，后续人工处理或定时重试
        mailFailureRepository.save(new MailFailure(to, subject, content, e.getMessage()));
    }
}
```

**最佳实践：**

1. **异步发送**——邮件是 IO 操作，用 `@Async` 不阻塞主流程
2. **模板渲染和发送分离**——模板用 Thymeleaf/FreeMarker 管理，不要硬编码 HTML
3. **敏感信息走配置**——SMTP 密码用环境变量或配置中心，不写在代码里
4. **失败重试**——网络抖动导致发送失败，自动重试 3 次
5. **失败记录**——发送失败的邮件存数据库，后续补发
6. **频率限制**——防止被 SMTP 服务商封号，控制发送频率
