# 认证

> **核心问题**：Session vs JWT 如何选择？OAuth2 的流程是什么？如何实现安全的认证？

## 1. Session 认证

```java
// 传统 Session 认证流程
// 1. 用户登录，服务端创建 Session，返回 SessionID（Cookie）
// 2. 后续请求携带 Cookie，服务端验证 Session

// Spring Security Session 配置
@Configuration
@EnableWebSecurity
public class SecurityConfig {
    
    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        http
            .authorizeHttpRequests(auth -> auth
                .requestMatchers(\"/api/public/**\").permitAll()
                .requestMatchers(\"/api/admin/**\").hasRole(\"ADMIN\")
                .anyRequest().authenticated()
            )
            .formLogin(form -> form
                .loginProcessingUrl(\"/api/login\")
                .successHandler((req, res, auth) -> {
                    res.setContentType(\"application/json\");
                    res.getWriter().write(\"{\\\"message\\\":\\\"登录成功\\\"}\");
                })
            )
            .sessionManagement(session -> session
                .sessionCreationPolicy(SessionCreationPolicy.IF_REQUIRED)
                .maximumSessions(1)  // 单点登录
            )
            .csrf(csrf -> csrf.disable());  // API 场景禁用 CSRF
        return http.build();
    }
}
```

## 2. JWT 认证

```java
// JWT（JSON Web Token）组成：Header.Payload.Signature

// JWT 工具类
public class JwtUtil {
    private final String secret;
    private final long expiration;
    
    public String generateToken(UserDetails user) {
        return Jwts.builder()
            .setSubject(user.getUsername())
            .claim(\"roles\", user.getAuthorities())
            .setIssuedAt(new Date())
            .setExpiration(new Date(System.currentTimeMillis() + expiration))
            .signWith(Keys.hmacShaKeyFor(secret.getBytes()), SignatureAlgorithm.HS256)
            .compact();
    }
    
    public Claims parseToken(String token) {
        return Jwts.parserBuilder()
            .setSigningKey(Keys.hmacShaKeyFor(secret.getBytes()))
            .build()
            .parseClaimsJws(token)
            .getBody();
    }
    
    public boolean validateToken(String token) {
        try {
            parseToken(token);
            return true;
        } catch (JwtException e) {
            return false;
        }
    }
}

// JWT 过滤器
@Component
public class JwtFilter extends OncePerRequestFilter {
    private final JwtUtil jwtUtil;
    
    @Override
    protected void doFilterInternal(HttpServletRequest request,
            HttpServletResponse response, FilterChain chain) throws IOException, ServletException {
        String header = request.getHeader(\"Authorization\");
        if (header != null && header.startsWith(\"Bearer \")) {
            String token = header.substring(7);
            if (jwtUtil.validateToken(token)) {
                Claims claims = jwtUtil.parseToken(token);
                UsernamePasswordAuthenticationToken auth = new UsernamePasswordAuthenticationToken(
                    claims.getSubject(), null, List.of(new SimpleGrantedAuthority(\"ROLE_USER\"))
                );
                SecurityContextHolder.getContext().setAuthentication(auth);
            }
        }
        chain.doFilter(request, response);
    }
}
```

## 3. Session vs JWT 对比

| 维度 | Session | JWT |
|------|---------|-----|
| 存储位置 | 服务端 | 客户端 |
| 扩展性 | 需要共享 Session 存储 | 无状态，天然支持分布式 |
| 安全性 | 服务端可控 | Token 泄露风险 |
| 撤销 | 难以撤销 | 难以撤销（需黑名单） |
| 适用场景 | 传统 Web 应用 | API、移动端、微服务 |

## 4. OAuth2 流程

```java
// OAuth2 授权码模式
// 1. 用户点击\"微信登录\"，跳转到微信授权页面
// 2. 用户授权后，微信回调你的应用，带上 authorization_code
// 3. 你的应用用 code 换取 access_token
// 4. 用 access_token 获取用户信息

// Spring Security OAuth2 Client 配置
// spring:
//   security:
//     oauth2:
//       client:
//         registration:
//           wechat:
//             client-id: your-app-id
//             client-secret: your-app-secret
//             authorization-grant-type: authorization_code
//             redirect-uri: \"{baseUrl}/login/oauth2/code/wechat\"
//         provider:
//           wechat:
//             authorization-uri: https://open.weixin.qq.com/connect/qrconnect
//             token-uri: https://api.weixin.qq.com/sns/oauth2/access_token
//             user-info-uri: https://api.weixin.qq.com/sns/userinfo
```

> **认证的核心**：验证"你是谁"。Session 适合传统 Web，JWT 适合 API 和微服务，OAuth2 适合第三方登录。选择哪种方式取决于你的应用场景。
