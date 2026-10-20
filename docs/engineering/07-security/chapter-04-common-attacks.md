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
// <div th:text="${comment}"></div>  // 自动 HTML 转义
// 注意：th:utext 不转义，需额外审查
// <div th:utext="${comment}"></div>  // 危险！直接输出不转义
```

> **输出上下文**。HTML 转义只适用于 HTML 文本节点和带引号的 HTML 属性值，不能当作 JavaScript、CSS、URL 上下文的通用防护，不同上下文需要各自的编码策略。展示富文本时应使用经过维护的 HTML 清洗库，而不是简单转义或删标签。

## 2. CSRF（跨站请求伪造）
```java
// CSRF 原理：诱导用户访问恶意网站，利用用户的登录态发起请求
// 前提：典型 CSRF 风险来自浏览器在跨站请求中自动携带服务端认可的认证凭据

// 防御 1：CSRF Token（主要手段）
// Spring Security 默认启用 CSRF，但前提是正确配置 Token 的生成、传递与校验
// 服务端渲染表单可自动注入 Token；前后端分离应用需手动传递
// <input type="hidden" name="_csrf" th:value="${_csrf.token}">

// 防御 2：SameSite Cookie（纵深防御，不能替代 CSRF Token）
// Set-Cookie: JSESSIONID=xxx; SameSite=Lax; HttpOnly; Secure

// 防御 3：验证 Origin/Referer 头（需明确可信源比较与缺失时的拒绝策略）
// 比较可信源（协议、主机、端口），不直接比较域名字符串
```

> 典型 CSRF 风险的前提是浏览器会在跨站请求中自动携带服务端认可的认证凭据，是否使用 Cookie、请求是否改变服务端状态，都影响风险判断。完整配置见 [Spring Security 安全实践](../../spring/05-security/chapter-04-security-practice)。

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
// <select id="findUser" resultType="User">
//   SELECT * FROM users WHERE name = '${name}'  // 不安全！
// </select>
```

> `#{}` 做参数绑定，`${}` 做文本替换。排序字段、表名等无法用普通值参数绑定的部分，应映射到服务端定义的有限选项（白名单），而不是直接拼接用户输入。

## 4. 文件上传漏洞
```java
// 差：不限制文件类型
@PostMapping(\"/upload\")
public String upload(@RequestParam MultipartFile file) {
    file.transferTo(new File(\"/uploads/\" + file.getOriginalFilename()));
    // 攻击者上传 .jsp 文件，可执行任意代码
    return \"success\";
}

// 好：基础校验（扩展名白名单 + 大小限制 + 服务端文件名）
@PostMapping(\"/upload\")
public String upload(@RequestParam MultipartFile file) {
    // 1. 检查文件扩展名（处理空文件名与无后缀）
    String originalName = file.getOriginalFilename();
    if (originalName == null || originalName.isBlank()) {
        throw new IllegalArgumentException("文件名为空");
    }
    int dotIndex = originalName.lastIndexOf('.');
    if (dotIndex < 0 || dotIndex == originalName.length() - 1) {
        throw new IllegalArgumentException("文件名缺少扩展名");
    }
    String ext = originalName.substring(dotIndex).toLowerCase(Locale.ROOT);
    if (!List.of(".jpg", ".png", ".gif", ".pdf").contains(ext)) {
        throw new IllegalArgumentException("不支持的文件类型");
    }    
    // 2. 检查文件大小
    if (file.getSize() > 10 * 1024 * 1024) {
        throw new IllegalArgumentException(\"文件大小不能超过 10MB\");
    }
    
    // 3. 使用服务端生成的文件名，避免将原始文件名用于存储路径
    String newFileName = UUID.randomUUID() + ext;
    file.transferTo(new File(\"/uploads/\" + newFileName));
    
    return "success";
}
```

> **边界说明**。扩展名白名单、大小限制、随机文件名只是基础校验，不能单独构成安全边界。攻击者可伪造文件名与 Content-Type，文件真实内容仍需校验；上传文件应存储到 Web 根目录之外并禁止直接执行。完整实现见 [文件上传与下载](../../spring/03-web/chapter-09-file-upload-download)。

## 5. 攻击防御总结
| 攻击 | 防御方法 |
| :-- | :-- |
| XSS | 输出编码（匹配上下文）、安全 DOM API；CSP 限制脚本执行，HttpOnly 降低凭据被脚本读取风险 |
| CSRF | CSRF Token、SameSite Cookie（纵深防御）、验证 Origin/Referer |
| SQL 注入 | 参数化绑定、动态标识符白名单、避免拼接不可信 SQL |
| 文件上传 | 类型白名单、大小限制、随机文件名，内容校验与存储隔离见专项文档 |
| DDoS | 限流、WAF、CDN |
| 中间人攻击 | HTTPS、证书固定 |

> **安全的核心**：永远不要信任用户输入。针对具体风险采用不同处理，SQL 用参数绑定、HTML 输出按上下文编码、文件与字段做格式校验，而不是把所有客户端数据统一「清洗」。
