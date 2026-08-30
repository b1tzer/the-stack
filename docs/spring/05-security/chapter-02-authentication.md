# 认证机制

## 1. Session 认证

```java
@Configuration
@EnableWebSecurity
public class SecurityConfig {
    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        http.formLogin(form -> form
                .loginPage("/login")
                .defaultSuccessUrl("/dashboard"))
            .logout(logout -> logout.logoutSuccessUrl("/login"));
        return http.build();
    }
}
```

## 2. JWT 认证与刷新机制

**痛点**：Access Token 短生命周期（如 2 小时）会导致用户频繁重新登录。引入 Refresh Token 实现无感续期。

**双 Token 刷新流程**：

```
客户端                           服务端
  │                                │
  │── POST /auth/login ──────────►│ 1. 验证用户名密码
  │                                │ 2. 生成 Access Token（2h）+ Refresh Token（7d）
  │◄── { accessToken, refreshToken}│
  │                                │
  │── GET /api/orders ───────────►│ 3. 验证 Access Token
  │   Authorization: Bearer xxx   │
  │                                │
  │  ...2 小时后...                │
  │                                │
  │── GET /api/orders ───────────►│ 4. Access Token 过期，返回 401
  │◄── 401 Unauthorized           │
  │                                │
  │── POST /auth/refresh ────────►│ 5. 验证 Refresh Token
  │   { refreshToken }            │ 6. 签发新 Access Token
  │◄── { accessToken }            │
  │                                │
  │── GET /api/orders ───────────►│ 7. 用新 Token 继续访问
  │   Authorization: Bearer new   │
```

**Token 刷新控制器**：

```java
@RestController
@RequestMapping("/api/auth")
@RequiredArgsConstructor
public class AuthController {

    private final JwtTokenProvider tokenProvider;
    private final RefreshTokenService refreshTokenService;
    private final AuthenticationManager authenticationManager;

    @PostMapping("/login")
    public TokenResponse login(@Valid @RequestBody LoginRequest request) {
        Authentication auth = authenticationManager.authenticate(
            new UsernamePasswordAuthenticationToken(
                request.getUsername(), request.getPassword()));

        UserDetails user = (UserDetails) auth.getPrincipal();
        String accessToken = tokenProvider.generateToken(user);
        String refreshToken = tokenProvider.generateRefreshToken(user);

        // 持久化 Refresh Token
        refreshTokenService.save(user.getUsername(), refreshToken);

        return new TokenResponse(accessToken, refreshToken,
            tokenProvider.getExpirationSeconds());
    }

    @PostMapping("/refresh")
    public TokenResponse refresh(@RequestBody RefreshRequest request) {
        String refreshToken = request.getRefreshToken();

        // 1. 验证 Refresh Token 签名和有效期
        if (!tokenProvider.validateToken(refreshToken)) {
            throw new BusinessException(401, "Refresh Token 无效或已过期");
        }

        // 2. 检查 Refresh Token 是否在白名单中（防止重放）
        String username = tokenProvider.getUsernameFromToken(refreshToken);
        if (!refreshTokenService.isValid(username, refreshToken)) {
            throw new BusinessException(401, "Refresh Token 已失效，请重新登录");
        }

        // 3. 签发新的 Access Token
        UserDetails user = userDetailsService.loadUserByUsername(username);
        String newAccessToken = tokenProvider.generateToken(user);

        return new TokenResponse(newAccessToken, refreshToken,
            tokenProvider.getExpirationSeconds());
    }

    @PostMapping("/logout")
    public void logout(@AuthenticationPrincipal UserDetails user) {
        // 注销时删除 Refresh Token
        refreshTokenService.deleteByUsername(user.getUsername());
    }
}
```

**Refresh Token 存储服务**：

```java
@Service
@RequiredArgsConstructor
public class RefreshTokenService {

    private final StringRedisTemplate redisTemplate;
    private static final String PREFIX = "refresh_token:";

    public void save(String username, String refreshToken) {
        // 每个用户只有一个有效的 Refresh Token
        // 新登录会覆盖旧的
        redisTemplate.opsForValue().set(
            PREFIX + username, refreshToken, 7, TimeUnit.DAYS);
    }

    public boolean isValid(String username, String refreshToken) {
        String stored = redisTemplate.opsForValue()
            .get(PREFIX + username);
        return refreshToken.equals(stored);
    }

    public void deleteByUsername(String username) {
        redisTemplate.delete(PREFIX + username);
    }
}
```

**JWT Token 黑名单（主动失效）**：

```java
@Service
@RequiredArgsConstructor
public class TokenBlacklistService {

    private final StringRedisTemplate redisTemplate;
    private static final String PREFIX = "token_blacklist:";

    // 将 Token 加入黑名单（修改密码、强制登出时调用）
    public void blacklist(String token, long expirationMs) {
        redisTemplate.opsForValue().set(
            PREFIX + token, "1",
            expirationMs, TimeUnit.MILLISECONDS);
    }

    public boolean isBlacklisted(String token) {
        return Boolean.TRUE.equals(
            redisTemplate.hasKey(PREFIX + token));
    }
}
```

在认证过滤器中加入黑名单检查：

```java
@Override
protected void doFilterInternal(HttpServletRequest request,
                                 HttpServletResponse response,
                                 FilterChain filterChain)
        throws ServletException, IOException {

    String token = extractToken(request);

    if (StringUtils.hasText(token)
            && tokenProvider.validateToken(token)
            && !tokenBlacklistService.isBlacklisted(token)) {  // 黑名单检查
        String username = tokenProvider.getUsernameFromToken(token);
        UserDetails userDetails = userDetailsService.loadUserByUsername(username);

        UsernamePasswordAuthenticationToken authentication =
            new UsernamePasswordAuthenticationToken(
                userDetails, null, userDetails.getAuthorities());
        SecurityContextHolder.getContext().setAuthentication(authentication);
    }

    filterChain.doFilter(request, response);
}
```

> **踩坑提醒**：JWT 的 payload 是 Base64 编码的，不是加密！不要在 JWT 中放敏感信息（密码、手机号）。另外，JWT 的 `exp` 字段只控制 Token 过期时间，无法实现"修改密码后立即让旧 Token 失效"——你必须引入 Token 黑名单或版本号机制。

## 3. OAuth2 与 OIDC

### 3.1 OAuth 2.0 四种授权模式

| 模式 | 流程 | 适用场景 |
|------|------|----------|
| 授权码模式 | 用户→授权页→授权码→后端换 Token | 第三方登录（微信、GitHub） |
| 隐式模式 | 用户→授权页→直接返回 Token（前端） | 已不推荐，安全隐患大 |
| 密码模式 | 用户名+密码直接换 Token | 自家 App、高度信任的第一方 |
| 客户端凭证模式 | 客户端 ID+Secret 直接换 Token | 服务间调用（M2M） |

授权码模式完整流程：

```
用户浏览器                    你的应用                      第三方（GitHub）
    │                            │                              │
    │── 点击"GitHub 登录" ─────►│                              │
    │                            │── 302 重定向 ──────────────►│
    │◄── 302 到 GitHub 授权页 ──│                              │
    │                            │                              │
    │── 用户授权 ───────────────│────────────────────────────►│
    │◄── 302 回调 + code ──────│◄── redirect_uri?code=xxx ───│
    │                            │                              │
    │                            │── 用 code 换 access_token ─►│
    │                            │◄── { access_token } ────────│
    │                            │                              │
    │                            │── 用 token 获取用户信息 ───►│
    │                            │◄── { login, email, ... } ───│
    │                            │                              │
    │◄── 登录成功，创建会话 ───│                              │
```

### 3.2 OIDC（OpenID Connect）

**痛点**：OAuth 2.0 只解决授权（"你能访问我的数据"），不解决认证（"你是谁"）。OIDC 在 OAuth 2.0 之上加了一层身份层。

**OIDC vs OAuth 2.0**：

| 概念 | OAuth 2.0 | OIDC |
|------|-----------|------|
| 解决问题 | 授权（Authorization） | 认证（Authentication） |
| Token 类型 | Access Token | ID Token + Access Token |
| ID Token | 无 | JWT 格式，包含用户身份信息 |
| 用户信息端点 | 无标准化 | 标准化的 `/userinfo` 端点 |
| 发现机制 | 无 | `.well-known/openid-configuration` |

**Spring Boot OIDC 配置**：

```yaml
spring:
  security:
    oauth2:
      client:
        registration:
          google:
            client-id: ${GOOGLE_CLIENT_ID}
            client-secret: ${GOOGLE_CLIENT_SECRET}
            scope: openid,profile,email
        provider:
          google:
            # OIDC 自动发现：Spring Security 会访问
            # https://accounts.google.com/.well-known/openid-configuration
            # 获取 authorization-uri、token-uri、jwk-set-uri 等
            issuer-uri: https://accounts.google.com
```

```java
@RestController
public class UserController {

    @GetMapping("/api/me")
    public Map<String, Object> currentUser(@AuthenticationPrincipal OidcUser oidcUser) {
        return Map.of(
            "sub", oidcUser.getSubject(),
            "name", oidcUser.getFullName(),
            "email", oidcUser.getEmail(),
            "idToken", oidcUser.getIdToken().getTokenValue()
        );
    }
}
```

### 3.3 Spring Boot OAuth2 登录完整配置

```java
@Configuration
@EnableWebSecurity
public class OAuth2LoginConfig {

    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        http
            .authorizeHttpRequests(auth -> auth
                .requestMatchers("/", "/login", "/error").permitAll()
                .anyRequest().authenticated()
            )
            .oauth2Login(oauth2 -> oauth2
                .loginPage("/login")
                .defaultSuccessUrl("/dashboard")
                .userInfoEndpoint(userInfo ->
                    userInfo.userService(customOAuth2UserService())
                )
            );
        return http.build();
    }

    @Bean
    public OAuth2UserService<OAuth2UserRequest, OAuth2User> customOAuth2UserService() {
        return userRequest -> {
            OAuth2User oAuth2User = new DefaultOAuth2UserService()
                .loadUser(userRequest);

            String registrationId = userRequest.getClientRegistration()
                .getRegistrationId();
            String email = oAuth2User.getAttribute("email");

            // 本地用户自动注册 / 关联
            userService.findOrCreateOAuthUser(email, registrationId,
                oAuth2User.getAttributes());

            return oAuth2User;
        };
    }
}
```

## 4. 认证实战

### 4.1 JWT + Spring Security 完整配置

```java
@Configuration
@EnableWebSecurity
@EnableMethodSecurity
public class SecurityConfig {

    private final JwtAuthenticationFilter jwtFilter;

    public SecurityConfig(JwtAuthenticationFilter jwtFilter) {
        this.jwtFilter = jwtFilter;
    }

    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        http
            .csrf(AbstractHttpConfigurer::disable)
            .sessionManagement(session -> session
                .sessionCreationPolicy(SessionCreationPolicy.STATELESS))
            .authorizeHttpRequests(auth -> auth
                .requestMatchers("/api/auth/**").permitAll()
                .requestMatchers("/api/admin/**").hasRole("ADMIN")
                .anyRequest().authenticated())
            .addFilterBefore(jwtFilter, UsernamePasswordAuthenticationFilter.class)
            .exceptionHandling(ex -> ex
                .authenticationEntryPoint((req, resp, e) -> {
                    resp.setStatus(401);
                    resp.setContentType("application/json");
                    resp.getWriter().write("{\"code\":401,\"message\":\"未认证\"}");
                })
                .accessDeniedHandler((req, resp, e) -> {
                    resp.setStatus(403);
                    resp.setContentType("application/json");
                    resp.getWriter().write("{\"code\":403,\"message\":\"无权限\"}");
                }));
        return http.build();
    }

    @Bean
    public PasswordEncoder passwordEncoder() {
        return new BCryptPasswordEncoder();
    }
}
```

### 4.2 登录接口实现

```java
@RestController
@RequestMapping("/api/auth")
public class AuthController {

    private final AuthenticationManager authenticationManager;
    private final JwtUtil jwtUtil;

    public AuthController(AuthenticationManager authenticationManager, JwtUtil jwtUtil) {
        this.authenticationManager = authenticationManager;
        this.jwtUtil = jwtUtil;
    }

    @PostMapping("/login")
    public LoginResponse login(@Valid @RequestBody LoginRequest request) {
        try {
            Authentication auth = authenticationManager.authenticate(
                new UsernamePasswordAuthenticationToken(
                    request.getUsername(), request.getPassword()));

            UserDetails user = (UserDetails) auth.getPrincipal();
            String token = jwtUtil.generateToken(user);

            return new LoginResponse(token, user.getUsername(),
                user.getAuthorities().stream()
                    .map(GrantedAuthority::getAuthority)
                    .collect(Collectors.toList()));
        } catch (BadCredentialsException e) {
            throw new BusinessException(401, "用户名或密码错误");
        }
    }
}
```

### 4.3 Remember-Me 记住我

```java
// 基于持久化 Token 的 Remember-Me
@Bean
public SecurityFilterChain filterChain(HttpSecurity http, DataSource dataSource) throws Exception {
    http.rememberMe(remember -> remember
        .tokenRepository(persistentTokenRepository(dataSource))
        .tokenValiditySeconds(7 * 24 * 3600)  // 7 天
        .userDetailsService(userDetailsService));
    return http.build();
}

@Bean
public PersistentTokenRepository persistentTokenRepository(DataSource dataSource) {
    JdbcTokenRepositoryImpl repo = new JdbcTokenRepositoryImpl();
    repo.setDataSource(dataSource);
    repo.setCreateTableOnStartup(false);  // 需要预先创建表
    return repo;
}
```

### 4.4 OAuth2 第三方登录

```java
@Configuration
public class OAuth2LoginConfig {

    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        http.oauth2Login(oauth2 -> oauth2
            .loginPage("/login")
            .defaultSuccessUrl("/dashboard")
            .userInfoEndpoint(userInfo -> userInfo
                .userService(customOAuth2UserService())));
        return http.build();
    }

    @Bean
    public OAuth2UserService<OAuth2UserRequest, OAuth2User> customOAuth2UserService() {
        return userRequest -> {
            // 获取第三方用户信息
            OAuth2User oauth2User = new DefaultOAuth2UserService().loadUser(userRequest);

            // 自动注册或关联本地用户
            String email = oauth2User.getAttribute("email");
            User localUser = userRepository.findByEmail(email)
                .orElseGet(() -> userRepository.save(
                    new User(email, oauth2User.getAttribute("name"), "GITHUB")));

            return new DefaultOAuth2User(
                Collections.singleton(new SimpleGrantedAuthority("ROLE_USER")),
                oauth2User.getAttributes(), "email");
        };
    }
}
```

## 5. 三种认证方案对比与选型

选型之前，先看清 Session-Cookie、JWT、OAuth 2.0 三者的本质差异：

| 维度 | Session-Cookie | JWT | OAuth 2.0 |
|------|---------------|-----|-----------|
| 存储位置 | 服务端（内存/Redis） | 客户端（LocalStorage/Cookie） | 不存储 token，授权服务器管理 |
| 状态 | 有状态 | 无状态（token 自包含） | 依赖授权服务器 |
| 跨域 | 需额外处理 | 天然支持（Header） | 天然支持 |
| 扩展性 | 多实例需 Session 共享 | 任意节点可验证 | 授权中心集中管理 |
| 撤销 | 删除 Session 即可 | 困难（需黑名单） | Refresh Token 机制 |
| 适用场景 | 传统单体 Web | 前后端分离、微服务 | 第三方登录、开放平台 |
| 安全风险 | CSRF 攻击 | Token 泄露后难以撤销 | 配置不当可能被滥用 |

**决策树**：

```
需要第三方登录？
  ├─ 是 → OAuth 2.0 / OIDC
  └─ 否 → 内部系统？
            ├─ 单体应用 → Session
            └─ 微服务 / 前后端分离 → JWT
```

> **踩坑提醒**：不要"为了无状态而无状态"。单体内网管理系统用 JWT 纯属自找麻烦——你得自己处理 Token 存储、刷新、XSS 防护，而 Session + Cookie HttpOnly 开箱即用就很安全。

## 6. OAuth 2.0 四种授权模式

| 模式 | 流程 | 适用场景 |
|------|------|---------|
| 授权码模式 | 用户→授权页→授权码→后端换 Token | 第三方登录（微信、GitHub） |
| 隐式模式 | 用户→授权页→直接返回 Token（前端） | 已不推荐，安全隐患大 |
| 密码模式 | 用户名+密码直接换 Token | 自家 App、高度信任的第一方 |
| 客户端凭证模式 | 客户端 ID+Secret 直接换 Token | 服务间调用（M2M） |

授权码模式的完整流程：

```text
① 用户点击"微信登录"
② 浏览器跳转授权页（携带 client_id、redirect_uri、scope）
③ 用户确认授权，回调 redirect_uri 并携带授权码 code
④ 后端用授权码换 Access Token（服务器间通信，用户无感知）
⑤ 获得 Access Token，调用 API 获取用户信息
```

## 7. 最佳实践

1. **JWT 过期时间**——Access Token 短（2 小时），Refresh Token 长（7 天）
2. **密码存储**——BCrypt 单向哈希，永远不要存明文
3. **Token 刷新机制**——Access Token 过期后用 Refresh Token 无感刷新
4. **OAuth2 状态参数**——防止 CSRF 攻击，验证 state 参数一致性
5. **多因素认证（MFA）**——敏感操作要求短信/邮箱验证码二次确认
