# 常见攻击与防御

> **核心问题**：XSS、SQL 注入、CSRF 等常见攻击的原理和防御方法是什么？

## 1. XSS（跨站脚本攻击）

```java
// XSS 原理：攻击者在页面中注入恶意脚本
// 存储型 XSS：恶意脚本存入数据库，其他用户浏览时执行

// 差：直接输出用户输入
String comment = request.getParameter(\"comment\");
response.getWriter().write(\"<div>\" + comment + \"</div>\");
// comment = \"<script>alert('XSS')</script>\" 可注入

// 好：HTML 转义
import org.apache.commons.text.StringEscapeUtils;
String safe = StringEscapeUtils.escapeHtml4(comment);
response.getWriter().write(\"<div>\" + safe + \"</div>\");
// 输出: &lt;script&gt;alert('XSS')&lt;/script&gt;

// Spring 默认处理：Thymeleaf 自动转义
// <div th:text=\"${comment}\"></div>  // 自动 HTML 转义
```

## 2. CSRF（跨站请求伪造）

```java
// CSRF 原理：诱导用户访问恶意网站，利用用户的登录态发起请求

// 防御 1：CSRF Token
// Spring Security 默认启用 CSRF
// 表单中自动添加隐藏的 CSRF Token 字段
// <input type=\"hidden\" name=\"_csrf\" th:value=\"${_csrf.token}\">

// 防御 2：SameSite Cookie
// Set-Cookie: JSESSIONID=xxx; SameSite=Lax; HttpOnly; Secure

// 防御 3：验证 Referer/Origin 头
// 只接受来自自己域名的请求
```

## 3. SQL 注入

```java
// 差：字符串拼接
String sql = \"SELECT * FROM users WHERE id = \" + userId;
// userId = \"1 OR 1=1\" 可注入

// 好：参数化查询
@Query(\"SELECT u FROM User u WHERE u.id = :id\")
User findById(@Param(\"id\") Long id);

// 好：MyBatis #{} 参数化
// <select id=\"findUser\" resultType=\"User\">
//   SELECT * FROM users WHERE id = #{userId}
// </select>

// 差：MyBatis ${} 字符串替换（不安全）
// <select id=\"findUser\" resultType=\"User\">
//   SELECT * FROM users WHERE name = '${name}'  // 不安全！
// </select>
```

## 4. 文件上传漏洞

```java
// 差：不限制文件类型
@PostMapping(\"/upload\")
public String upload(@RequestParam MultipartFile file) {
    file.transferTo(new File(\"/uploads/\" + file.getOriginalFilename()));
    // 攻击者上传 .jsp 文件，可执行任意代码
    return \"success\";
}

// 好：严格限制文件类型和大小
@PostMapping(\"/upload\")
public String upload(@RequestParam MultipartFile file) {
    // 1. 检查文件扩展名
    String originalName = file.getOriginalFilename();
    String ext = originalName.substring(originalName.lastIndexOf('.'));
    if (!List.of(\".jpg\", \".png\", \".gif\", \".pdf\").contains(ext.toLowerCase())) {
        throw new IllegalArgumentException(\"不支持的文件类型\");
    }
    
    // 2. 检查文件大小
    if (file.getSize() > 10 * 1024 * 1024) {
        throw new IllegalArgumentException(\"文件大小不能超过 10MB\");
    }
    
    // 3. 使用随机文件名，防止路径遍历
    String newFileName = UUID.randomUUID() + ext;
    file.transferTo(new File(\"/uploads/\" + newFileName));
    
    return \"success\";
}
```

## 5. 攻击防御总结

| 攻击 | 防御方法 |
|------|----------|
| XSS | HTML 转义、CSP 头、HttpOnly Cookie |
| CSRF | CSRF Token、SameSite Cookie、验证 Referer |
| SQL 注入 | 参数化查询、ORM 框架 |
| 文件上传 | 类型白名单、大小限制、随机文件名 |
| DDoS | 限流、WAF、CDN |
| 中间人攻击 | HTTPS、证书固定 |

> **安全的核心**：永远不要信任用户输入。所有来自客户端的数据（参数、头、Cookie、文件）都必须经过校验和清洗。
