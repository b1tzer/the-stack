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

## 2. JWT 认证

```java
@Component
public class JwtTokenProvider {
    public String generateToken(UserDetails userDetails) {
        return Jwts.builder()
            .setSubject(userDetails.getUsername())
            .setExpiration(new Date(System.currentTimeMillis() + expiration))
            .signWith(SignatureAlgorithm.HS256, secret)
            .compact();
    }
    
    public boolean validateToken(String token) {
        try {
            Jwts.parser().setSigningKey(secret).parseClaimsJws(token);
            return true;
        } catch (JwtException e) {
            return false;
        }
    }
}
```

## 3. OAuth2

```java
@Configuration
public class OAuth2Config {
    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        http.oauth2Login(oauth2 -> oauth2
                .defaultSuccessUrl("/dashboard"));
        return http.build();
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

## 5. 三种认证方案对比

选型之前，先看清 Session-Cookie、JWT、OAuth 2.0 三者的本质差异：

| 维度 | Session-Cookie | JWT | OAuth 2.0 |
|------|---------------|-----|-----------|
| 存储位置 | 服务端（内存/Redis） | 客户端（LocalStorage/Cookie） | 不存储 token，授权服务器管理 |
| 状态 | 有状态 | 无状态（token 自包含） | 依赖授权服务器 |
| 跨域 | 需额外处理 | 天然支持（Header） | 天然支持 |
| 扩展性 | 多实例需 Session 共享 | 任意节点可验证 | 授权中心集中管理 |
| 撤销 | 删除 Session 即可 | 困难（需黑名单） | Refresh Token 机制 |
| 适用场景 | 传统单体 Web | 前后端分离、微服务 | 第三方登录、开放平台 |

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

---

**最佳实践：**

1. **JWT 过期时间**——Access Token 短（2 小时），Refresh Token 长（7 天）
2. **密码存储**——BCrypt 单向哈希，永远不要存明文
3. **Token 刷新机制**——Access Token 过期后用 Refresh Token 无感刷新
4. **OAuth2 状态参数**——防止 CSRF 攻击，验证 state 参数一致性
5. **多因素认证（MFA）**——敏感操作要求短信/邮箱验证码二次确认
