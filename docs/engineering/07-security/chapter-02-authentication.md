# 认证

> **核心问题**：Session vs JWT 如何选择？OAuth2 的流程是什么？如何实现安全的认证？

## 1. Session 认证

Session 认证的流程：

1. 用户登录，服务端创建 Session，返回 SessionID（通常放在 Cookie 里）
2. 后续请求携带 Cookie，服务端据此找到对应 Session

Session 方案的关键配置点：登录处理、权限校验（放行公开接口、拦截需认证接口）、会话管理（单点登录、会话过期）。

> 各框架的 Session 落地代码见 [Spring Security 认证](../../spring/05-security/chapter-02-authentication)。

## 2. JWT 认证

JWT 由三部分组成：`Header.Payload.Signature`，用 `.` 分隔。服务端签发时用密钥对 Header + Payload 签名，客户端无状态携带，服务端校验签名即可确认身份，无需存储会话。

JWT 校验的关键点：验证签名、验证过期时间、验证签发方。校验通过后将用户身份写入当前请求上下文。

> JWT 的签发与过滤器落地代码见 [Spring Security 认证](../../spring/05-security/chapter-02-authentication)。

## 3. Session vs JWT 对比

| 维度 | Session | JWT |
| :-- | :-- | :-- |
| 存储位置 | 服务端 | 客户端 |
| 扩展性 | 需要共享 Session 存储 | 无状态，天然支持分布式 |
| 安全性 | 服务端可控 | Token 泄露风险 |
| 撤销 | 难以撤销 | 难以撤销（需黑名单） |
| 适用场景 | 传统 Web 应用 | API、移动端、微服务 |

## 4. OAuth2 流程

OAuth2 授权码模式：

1. 用户点击「微信登录」，跳转到微信授权页面
2. 用户授权后，微信回调你的应用，带上 `authorization_code`
3. 你的应用用 `code` 换取 `access_token`
4. 用 `access_token` 获取用户信息

> OAuth2 各提供方的接入配置见 [Spring Security 认证](../../spring/05-security/chapter-02-authentication)。

> **认证的核心**：验证"你是谁"。Session 适合传统 Web，JWT 适合 API 和微服务，OAuth2 适合第三方登录。选择哪种方式取决于你的应用场景。
