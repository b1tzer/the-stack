# 安全概览

> OWASP Top 10 是 Web 应用最常见的安全风险清单。了解它们是安全编码的基础。

## 1. OWASP Top 10 (2021)

| 排名 | 风险 | 说明 | 防御 |
| :-- | :-- | :-- | :-- |
| A01 | 访问控制失效 | 未授权访问 | 最小权限、RBAC |
| A02 | 加密机制失效 | 明文存储、弱加密 | 强加密、密钥管理 |
| A03 | 注入 | SQL/NoSQL/OS 注入 | 参数化查询、输入校验 |
| A04 | 不安全设计 | 架构层面的安全缺陷 | 威胁建模、安全评审 |
| A05 | 安全配置错误 | 默认密码、不必要的端口 | 最小化配置、定期审计 |
| A06 | 过时组件 | 使用有漏洞的库 | 定期更新、SCA 扫描 |
| A07 | 认证失败 | 弱密码、暴力破解 | MFA、限流、密码策略 |
| A08 | 数据完整性失败 | 未验证的数据被信任 | 签名、校验、CI/CD 安全 |
| A09 | 日志与监控不足 | 攻击无法被发现 | 日志、告警、SIEM |
| A10 | SSRF | 利用服务端发起请求 | 白名单、网络隔离 |

## 2. 最常见的攻击

### SQL 注入

```java
// ❌ 危险：拼接 SQL
String sql = "SELECT * FROM users WHERE name = '" + name + "'";

// ✅ 安全：参数化查询
String sql = "SELECT * FROM users WHERE name = ?";
PreparedStatement ps = conn.prepareStatement(sql);
ps.setString(1, name);
```

### XSS（跨站脚本）

```html
<!-- ❌ 危险：直接输出用户输入 -->
<div>${userInput}</div>

<!-- ✅ 安全：HTML 转义 -->
<div th:text="${userInput}"></div>
```

### CSRF（跨站请求伪造）

```java
// Spring Security 自动处理 CSRF Token
@EnableWebSecurity
public class SecurityConfig extends WebSecurityConfigurerAdapter {
    // CSRF 默认开启
}
```

## 3. 安全编码原则

1. **最小权限**：每个组件只拥有必要的权限
2. **纵深防御**：多层安全措施，不依赖单一防线
3. **默认安全**：默认配置应该是安全的
4. **输入验证**：所有外部输入都不可信
5. **参数化查询**：永远不要拼接 SQL
6. **敏感数据加密**：传输用 TLS，存储用强加密
7. **日志审计**：记录所有安全相关操作
