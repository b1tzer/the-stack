# 认证

> **核心问题**：Session vs JWT 如何选择？OAuth2 的流程是什么？如何实现安全的认证？

## 1. Session 认证

Session 认证的流程：

1. 用户登录，服务端创建 Session，返回 SessionID（通常放在 Cookie 里）
2. 后续请求携带 Cookie，服务端据此找到对应 Session

Session 方案的关键配置点：登录处理、权限校验（放行公开接口、拦截需认证接口）、会话管理（单点登录、会话过期）。

> 各框架的 Session 落地代码见 [Spring Security 认证](../../spring/05-security/chapter-02-authentication)。

## 2. JWT 认证

JWT 由三部分组成：`Header.Payload.Signature`，用 `.` 分隔。服务端签发时用密钥对 Header + Payload 签名，客户端无状态携带，服务端按约定验证 JWT 并检查必要声明后，才能据此建立认证身份，无需存储会话。

JWT 校验不能止于签名正确。验证方应固定允许的算法和可信密钥，按应用约定检查签发方（iss）、受众（aud）、有效期（exp/nbf）等必要声明，并区分不同用途的 Token，避免将一个场景签发的 Token 用于另一个场景。校验通过后，再根据可信声明建立当前请求的认证身份。

> JWT 的签发与过滤器落地代码见 [Spring Security 认证](../../spring/05-security/chapter-02-authentication)。

## 3. Session vs JWT 对比

| 维度 | Session | JWT |
| :-- | :-- | :-- |
| 会话状态存储 | 通常在服务端维护 | 令牌常由客户端持有，也可由服务端管理 |
| 多实例部署 | 需要共享 Session 存储或路由策略 | 需要统一信任配置和密钥管理，撤销/刷新可能仍需服务端状态 |
| 安全性 | 服务端可控 | Token 泄露风险 |
| 主动失效 | 删除或失效会话即可 | 已签发 Token 无法仅靠签名验证撤销，需额外机制 |
| 适用场景 | 传统 Web 应用 | API、移动端、微服务 |

## 4. OAuth2 流程

OAuth2 解决的是授权委托，本身不是通用的身份认证协议。拿到 `access_token` 不代表已经可靠确认了用户身份，第三方登录还需要明确的身份信息来源，通常是提供方支持的身份接口或 OpenID Connect 的 ID Token。

OAuth2 授权码模式（以微信登录为例）：

1. 用户点击「微信登录」，跳转到微信授权页面
2. 用户授权后，微信回调你的应用，带上 `authorization_code`
3. 你的应用用 `code` 换取 `access_token`
4. 用 `access_token` 获取用户信息

授权码流程的安全约束：用 `state` 参数将授权响应与发起请求关联，防登录 CSRF；按提供方规则注册并校验回调地址；对可支持 PKCE 的客户端启用 PKCE，防止授权码被截获后滥用；保护授权码和 Token 不泄露、不重放。采用 OIDC 时，还需按 OIDC 规则验证 ID Token，不能把拿到 `access_token` 直接等同于完成身份认证。

> OAuth2 各提供方的接入配置见 [Spring Security 认证](../../spring/05-security/chapter-02-authentication)。

## 5. 生产环境中的认证边界

选型之外，生产实现还需明确三点：

- 会话与 Token 的生命周期管理：过期、注销、账号禁用、凭据泄露后的失效策略。
- 凭据保护：Cookie 用 HttpOnly 降低 XSS 窃取风险，Secure 限制仅经安全连接发送，SameSite 降低跨站携带风险；CSRF 仍需配合 CSRF Token 或 Origin/Referer 校验。浏览器存储 Token 时注意 XSS 风险。
- 身份与权限分离：认证成功不代表授权通过，权限校验与数据访问控制交由授权机制负责。

具体配置留在 Spring Security 认证实现文档，不在此重复。

> **认证的核心**：验证"你是谁"。Session 适合传统 Web，JWT 适合 API 和微服务，第三方登录应借助 OIDC 或提供方约定的身份接口。选择哪种方式取决于你的应用场景。
