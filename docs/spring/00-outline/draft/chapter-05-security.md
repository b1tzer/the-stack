# 第 05 章：安全

> **一句话总结**：安全不是"加个登录"就完事了——它贯穿认证、授权、数据保护、传输安全的每一层，Spring Security 帮你把这些全串起来。

---

## 5.1 安全架构概览

### 5.1.1 认证 vs 授权

**痛点**：很多人把"认证"和"授权"混为一谈，结果要么权限配错，要么登录逻辑和权限逻辑纠缠在一起。

**认证（Authentication）= 你是谁**：验证用户身份，拿到一个可信的主体（Principal）。典型手段：用户名密码、JWT Token、OAuth 2.0 回调。

**授权（Authorization）= 你能做什么**：在已知身份的前提下，判断该用户是否有权限执行某个操作。典型手段：RBAC 角色检查、ABAC 属性判断、数据级权限。

**Spring Security 的核心抽象**：

| 概念 | 类 | 作用 |
|------|-----|------|
| 认证令牌 | `Authentication` | 携带主体信息 + 凭证（密码/Token） |
| 认证管理器 | `AuthenticationManager` | 协调认证流程 |
| 用户详情 | `UserDetailsService` | 从数据库/LDAP 加载用户信息 |
| 授权决策 | `AccessDecisionManager` | 判断是否有权限 |
| 安全上下文 | `SecurityContextHolder` | 存储当前线程的认证信息 |

```java
// 认证成功后，SecurityContextHolder 中就有了 Authentication
Authentication auth = SecurityContextHolder.getContext().getAuthentication();
String username = auth.getName();                    // 认证：你是谁
boolean isAdmin = auth.getAuthorities().stream()     // 授权：你能做什么
    .anyMatch(g -> g.getAuthority().equals("ROLE_ADMIN"));
```

**流程图**：

```
用户请求
  │
  ▼
认证（Authentication）── 失败 → 401 Unauthorized
  │ 成功
  ▼
授权（Authorization）── 拒绝 → 403 Forbidden
  │ 通过
  ▼
业务逻辑
```

> **踩坑提醒**：`Authentication` 对象在整个请求生命周期中都存在，但它是存在 `ThreadLocal` 里的。异步场景（`@Async`、`CompletableFuture`）中子线程拿不到父线程的认证信息，需要手动传播。

---

### 5.1.2 Spring Security 过滤器链

**痛点**：Spring Security 有十几个过滤器，默认都帮你配好了，但一旦出问题你必须知道请求经过了哪些 Filter、顺序是什么、谁负责什么。

Spring Security 本质上就是一堆 `Filter` 组成的责任链。一个 HTTP 请求进来，先经过 `SecurityFilterChain`，里面的 Filter 按顺序依次执行：

```
HTTP Request
  │
  ▼
SecurityContextPersistenceFilter   ← 从 SecurityContextRepository 恢复上下文
  │
  ▼
UsernamePasswordAuthenticationFilter ← 拦截 POST /login，执行表单登录
  │
  ▼
BasicAuthenticationFilter          ← 处理 HTTP Basic 认证
  │
  ▼
BearerTokenAuthenticationFilter    ← 处理 JWT/OAuth2 Bearer Token
  │
  ▼
ExceptionTranslationFilter         ← 捕获认证/授权异常，返回 401/403
  │
  ▼
FilterSecurityInterceptor          ← 最终的访问控制决策
  │
  ▼
Controller
```

**核心 Filter 职责表**：

| Filter | 职责 | 触发条件 |
|--------|------|----------|
| `SecurityContextPersistenceFilter` | 请求开始时加载 `SecurityContext`，结束时清除 | 每个请求 |
| `UsernamePasswordAuthenticationFilter` | 处理表单登录 | `POST /login` |
| `BasicAuthenticationFilter` | 处理 HTTP Basic 认证 | `Authorization: Basic ...` |
| `BearerTokenAuthenticationFilter` | 处理 JWT Token | `Authorization: Bearer ...` |
| `ExceptionTranslationFilter` | 将 `AuthenticationException` → 401，`AccessDeniedException` → 403 | 异常发生时 |
| `FilterSecurityInterceptor` | 调用 `AccessDecisionManager` 做最终授权决策 | URL 匹配时 |
| `CsrfFilter` | CSRF 令牌校验 | 非 GET/HEAD/OPTIONS |
| `CorsFilter` | CORS 预检请求处理 | `OPTIONS` 预检 |

```java
// 查看当前生效的所有 Filter（调试神器）
@Component
public class SecurityFilterDumper implements ApplicationRunner {
    @Autowired
    private FilterChainProxy filterChainProxy;

    @Override
    public void run(ApplicationArguments args) {
        filterChainProxy.getFilterChains().forEach(chain -> {
            chain.getFilters().forEach(f ->
                System.out.println(f.getClass().getSimpleName()));
        });
    }
}
```

> **踩坑提醒**：如果你自定义了多个 `SecurityFilterChain`，Spring 会按 `@Order` 优先级匹配第一个满足条件的链。如果你的自定义 Filter 加错了位置（比如加在 `CsrfFilter` 之后），CSRF 校验会在你的认证逻辑之前执行，导致预期之外的 403。

---

### 5.1.3 SecurityFilterChain 配置

**痛点**：Spring Security 3.x → 5.x → 6.x 配置方式改了三代，`WebSecurityConfigurerAdapter` 已废弃，很多人还在用旧写法。

**Spring Security 6.x（Spring Boot 3.x）推荐写法**：

```java
@Configuration
@EnableWebSecurity
public class SecurityConfig {

    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        http
            // URL 权限
            .authorizeHttpRequests(auth -> auth
                .requestMatchers("/public/**", "/actuator/health").permitAll()
                .requestMatchers("/admin/**").hasRole("ADMIN")
                .requestMatchers("/api/**").authenticated()
                .anyRequest().authenticated()
            )
            // 表单登录
            .formLogin(form -> form
                .loginPage("/login")
                .loginProcessingUrl("/do-login")
                .defaultSuccessUrl("/dashboard", true)
                .failureUrl("/login?error=true")
                .permitAll()
            )
            // 登出
            .logout(logout -> logout
                .logoutUrl("/logout")
                .logoutSuccessUrl("/login?logout=true")
                .deleteCookies("JSESSIONID")
            )
            // 关闭 CSRF（仅 REST API 无状态场景）
            .csrf(csrf -> csrf.disable())
            // 会话管理
            .sessionManagement(session -> session
                .sessionCreationPolicy(SessionCreationPolicy.STATELESS)
            );

        return http.build();
    }
}
```

**`authorizeHttpRequests` vs `authorizeRequests` 对比**：

| 特性 | `authorizeRequests`（已废弃） | `authorizeHttpRequests`（推荐） |
|------|-------------------------------|----------------------------------|
| 引入版本 | Spring Security 3.x | Spring Security 5.7+ |
| 匹配机制 | `AntPathMatcher` | `RequestMatcher`（更灵活） |
| 性能 | 路径匹配较慢 | 使用 trie 结构，性能更好 |
| 可组合性 | 低 | 支持 `MvcRequestMatcher`、`AntPathRequestMatcher` |
| 是否兼容 `.mvcMatcher()` | 需要额外调用 | 统一使用 `requestMatchers()` |

```java
// 旧写法（已废弃）
http.authorizeRequests()
    .antMatchers("/admin/**").hasRole("ADMIN");

// 新写法（Spring Security 6.x）
http.authorizeHttpRequests(auth -> auth
    .requestMatchers("/admin/**").hasRole("ADMIN")
);
```

> **踩坑提醒**：Spring Boot 3.x 中如果你同时配了 `SecurityFilterChain` 和 `WebSecurityCustomizer`，注意 `WebSecurityCustomizer` 是用来忽略某些路径的（完全跳过安全过滤器），而 `SecurityFilterChain` 是在过滤器链内部做权限控制。两者作用层面不同，别搞混。

---

## 5.2 身份认证

### 5.2.1 表单登录

**痛点**：默认的表单登录页面太丑，而且你需要在登录成功后做额外逻辑（记录登录日志、初始化用户会话数据）。

**自定义登录页 + 处理器**：

```java
@Configuration
@EnableWebSecurity
public class FormLoginConfig {

    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        http
            .authorizeHttpRequests(auth -> auth
                .requestMatchers("/login", "/css/**", "/js/**").permitAll()
                .anyRequest().authenticated()
            )
            .formLogin(form -> form
                .loginPage("/login")                          // 自定义登录页
                .loginProcessingUrl("/do-login")              // 表单提交地址
                .usernameParameter("email")                   // 自定义表单字段名
                .passwordParameter("pwd")
                .successHandler(customAuthenticationSuccessHandler())   // 成功处理器
                .failureHandler(customAuthenticationFailureHandler())   // 失败处理器
            );
        return http.build();
    }

    @Bean
    public AuthenticationSuccessHandler customAuthenticationSuccessHandler() {
        return (request, response, authentication) -> {
            // 记录登录日志
            String ip = request.getRemoteAddr();
            log.info("用户 {} 从 {} 登录成功", authentication.getName(), ip);

            // 根据角色跳转不同页面
            boolean isAdmin = authentication.getAuthorities().stream()
                .anyMatch(g -> g.getAuthority().equals("ROLE_ADMIN"));
            response.sendRedirect(isAdmin ? "/admin/dashboard" : "/user/home");
        };
    }

    @Bean
    public AuthenticationFailureHandler customAuthenticationFailureHandler() {
        return (request, response, exception) -> {
            String errorMsg = "用户名或密码错误";
            if (exception instanceof LockedException) {
                errorMsg = "账户已锁定";
            } else if (exception instanceof DisabledException) {
                errorMsg = "账户已禁用";
            }
            request.getSession().setAttribute("error", errorMsg);
            response.sendRedirect("/login?error");
        };
    }
}
```

**UserDetailsService 实现**：

```java
@Service
@RequiredArgsConstructor
public class CustomUserDetailsService implements UserDetailsService {

    private final UserRepository userRepository;
    private final RoleRepository roleRepository;

    @Override
    public UserDetails loadUserByUsername(String username)
            throws UsernameNotFoundException {
        User user = userRepository.findByUsername(username)
            .orElseThrow(() -> new UsernameNotFoundException(
                "用户不存在: " + username));

        List<GrantedAuthority> authorities = roleRepository
            .findByUserId(user.getId()).stream()
            .map(role -> new SimpleGrantedAuthority("ROLE_" + role.getName()))
            .collect(Collectors.toList());

        return new org.springframework.security.core.userdetails.User(
            user.getUsername(),
            user.getPassword(),
            user.isEnabled(),       // enabled
            true,                   // accountNonExpired
            true,                   // credentialsNonExpired
            !user.isLocked(),       // accountNonLocked
            authorities
        );
    }
}
```

> **踩坑提醒**：`loadUserByUsername` 里的数据库查询是每次登录都执行的。如果你的用户信息变化了（比如改了密码、禁用了账号），下一次登录就会用新数据。但如果用户已经在会话中，修改不会实时生效——需要主动调用 `SecurityContextHolder` 刷新。

---

### 5.2.2 JWT 认证

**痛点**：Session 认证在微服务架构下难以为继——你无法在几十个服务间共享 Session，JWT 让每个服务都能独立验证用户身份。

**JWT 认证流程**：

```
客户端                           服务端
  │                                │
  │── POST /auth/login ──────────►│ 1. 验证用户名密码
  │                                │ 2. 生成 JWT（Header.Payload.Signature）
  │◄── { accessToken, refreshToken}│
  │                                │
  │── GET /api/orders ───────────►│ 3. 从 Authorization 头提取 JWT
  │   Authorization: Bearer xxx   │ 4. 验证签名、过期时间
  │                                │ 5. 解析用户信息，执行业务
  │◄── { data: [...] }           │
```

**JWT 过滤器实现**：

```java
@Component
@RequiredArgsConstructor
public class JwtAuthenticationFilter extends OncePerRequestFilter {

    private final JwtTokenProvider tokenProvider;
    private final UserDetailsService userDetailsService;

    @Override
    protected void doFilterInternal(HttpServletRequest request,
                                     HttpServletResponse response,
                                     FilterChain filterChain)
            throws ServletException, IOException {

        String token = extractToken(request);

        if (StringUtils.hasText(token) && tokenProvider.validateToken(token)) {
            String username = tokenProvider.getUsernameFromToken(token);
            UserDetails userDetails = userDetailsService.loadUserByUsername(username);

            UsernamePasswordAuthenticationToken authentication =
                new UsernamePasswordAuthenticationToken(
                    userDetails, null, userDetails.getAuthorities());
            authentication.setDetails(
                new WebAuthenticationDetailsSource().buildDetails(request));

            SecurityContextHolder.getContext().setAuthentication(authentication);
        }

        filterChain.doFilter(request, response);
    }

    private String extractToken(HttpServletRequest request) {
        String bearer = request.getHeader("Authorization");
        if (StringUtils.hasText(bearer) && bearer.startsWith("Bearer ")) {
            return bearer.substring(7);
        }
        return null;
    }
}
```

**JWT Token 工具类**：

```java
@Component
public class JwtTokenProvider {

    @Value("${jwt.secret}")
    private String secret;

    @Value("${jwt.expiration:3600000}")  // 默认 1 小时
    private long expiration;

    @Value("${jwt.refresh-expiration:604800000}")  // 默认 7 天
    private long refreshExpiration;

    public String generateToken(UserDetails userDetails) {
        Map<String, Object> claims = new HashMap<>();
        claims.put("roles", userDetails.getAuthorities().stream()
            .map(GrantedAuthority::getAuthority)
            .collect(Collectors.toList()));
        return buildToken(claims, userDetails.getUsername(), expiration);
    }

    public String generateRefreshToken(UserDetails userDetails) {
        return buildToken(new HashMap<>(), userDetails.getUsername(),
            refreshExpiration);
    }

    private String buildToken(Map<String, Object> claims,
                               String subject, long expiration) {
        return Jwts.builder()
            .setClaims(claims)
            .setSubject(subject)
            .setIssuedAt(new Date())
            .setExpiration(new Date(System.currentTimeMillis() + expiration))
            .signWith(Keys.hmacShaKeyFor(secret.getBytes()), SignatureAlgorithm.HS256)
            .compact();
    }

    public boolean validateToken(String token) {
        try {
            Jwts.parserBuilder()
                .setSigningKey(Keys.hmacShaKeyFor(secret.getBytes()))
                .build()
                .parseClaimsJws(token);
            return true;
        } catch (JwtException | IllegalArgumentException e) {
            return false;
        }
    }

    public String getUsernameFromToken(String token) {
        return Jwts.parserBuilder()
            .setSigningKey(Keys.hmacShaKeyFor(secret.getBytes()))
            .build()
            .parseClaimsJws(token)
            .getBody()
            .getSubject();
    }
}
```

**JWT 注册到 Filter Chain**：

```java
@Configuration
@RequiredArgsConstructor
public class JwtSecurityConfig {

    private final JwtAuthenticationFilter jwtAuthFilter;

    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        http
            .csrf(csrf -> csrf.disable())
            .sessionManagement(session ->
                session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
            .authorizeHttpRequests(auth -> auth
                .requestMatchers("/auth/**").permitAll()
                .anyRequest().authenticated()
            )
            .addFilterBefore(jwtAuthFilter,
                UsernamePasswordAuthenticationFilter.class);
        return http.build();
    }
}
```

**JWT 方案对比**：

| 特性 | JWT（内存中） | JWT + Redis 黑名单 |
|------|--------------|-------------------|
| 无状态 | ✅ 完全无状态 | ⚠️ 半无状态（需查 Redis） |
| 主动注销 | ❌ 无法实现 | ✅ 加入黑名单即可 |
| 性能 | ⭐⭐⭐ 最快 | ⭐⭐ 多一次 Redis 查询 |
| 适用场景 | 短生命周期 Token | 需要即时注销的场景 |

> **踩坑提醒**：JWT 的 payload 是 Base64 编码的，不是加密！不要在 JWT 中放敏感信息（密码、手机号）。另外，JWT 的 `exp` 字段只控制 Token 过期时间，无法实现"修改密码后立即让旧 Token 失效"——你必须引入 Token 黑名单或版本号机制。

---

### 5.2.3 OAuth 2.0 / OIDC

**痛点**：你的应用想支持微信、GitHub、Google 登录，但不想自己维护第三方账号的密码。OAuth 2.0 让你"借"第三方的身份来认证用户。

**Authorization Code Grant 流程**：

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

**Spring Boot 配置**：

```yaml
# application.yml
spring:
  security:
    oauth2:
      client:
        registration:
          github:
            client-id: ${GITHUB_CLIENT_ID}
            client-secret: ${GITHUB_CLIENT_SECRET}
            scope: read:user,user:email
          google:
            client-id: ${GOOGLE_CLIENT_ID}
            client-secret: ${GOOGLE_CLIENT_SECRET}
            scope: openid,profile,email
        provider:
          github:
            authorization-uri: https://github.com/login/oauth/authorize
            token-uri: https://github.com/login/oauth/access_token
            user-info-uri: https://api.github.com/user
            user-name-attribute: login
```

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
            // 委托给默认实现获取用户信息
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

> **踩坑提醒**：OAuth 2.0 的 `state` 参数是防 CSRF 的关键，Spring Security 默认会处理。但如果你的回调 URL 配错（比如生产环境配了 `localhost`），用户授权后会跳转失败。另外，国内微信 OAuth 2.0 有自己的坑——它不完全遵守标准 OAuth 2.0，需要单独适配。

---

### 5.2.4 认证方案选型

**痛点**：Session、JWT、OAuth 2.0 各有优劣，选错了后面改很痛苦。

**三维度选型模型**：

| 维度 | Session | JWT | OAuth 2.0 |
|------|---------|-----|-----------|
| **有状态 vs 无状态** | 有状态（服务端存 Session） | 无状态（客户端持有 Token） | 半无状态（取决于实现） |
| **单体 vs 微服务** | ✅ 单体首选 | ✅ 微服务首选 | ✅ 跨系统首选 |
| **内部 vs 开放** | 内部系统 | 内部 + 对外 API | 第三方接入 |
| 性能 | ⭐⭐⭐ 本地内存 | ⭐⭐⭐ 无网络开销 | ⭐⭐ 需要外部调用 |
| 安全性 | ⭐⭐⭐ Cookie HttpOnly | ⭐⭐ Token 存储风险 | ⭐⭐⭐ 第三方托管 |
| 注销能力 | ✅ 即时 | ❌ 需额外机制 | ✅ 撤销 Token |
| 跨域支持 | ❌ Cookie 跨域限制 | ✅ Header 无跨域问题 | ✅ 标准协议 |

**决策树**：

```
需要第三方登录？
  ├─ 是 → OAuth 2.0 / OIDC
  └─ 否 → 内部系统？
            ├─ 单体应用 → Session
            └─ 微服务 / 前后端分离 → JWT
```

> **踩坑提醒**：不要"为了无状态而无状态"。单体内网管理系统用 JWT 纯属自找麻烦——你得自己处理 Token 存储、刷新、XSS 防护，而 Session + Cookie HttpOnly 开箱即用就很安全。

---

## 5.3 授权模型

### 5.3.1 RBAC（基于角色的访问控制）

**痛点**：硬编码 `if (user.getRole().equals("ADMIN"))` 散落在每个接口里，改权限要改代码。

**RBAC 三表模型**：

```
┌──────────┐    ┌──────────────┐    ┌──────────────┐
│  users   │───►│  user_roles  │◄───│    roles     │
│──────────│    │──────────────│    │──────────────│
│ id       │    │ user_id      │    │ id           │
│ username │    │ role_id      │    │ name         │
│ password │    └──────────────┘    └──────┬───────┘
└──────────┘                              │
                                    ┌─────┴────────┐
                                    │ role_perms   │
                                    │───────────── │
                                    │ role_id      │
                                    │ perm_id      │
                                    └─────┬────────┘
                                          │
                                    ┌─────┴────────┐
                                    │ permissions  │
                                    │──────────────│
                                    │ id           │
                                    │ name         │
                                    │ resource     │
                                    │ action       │
                                    └──────────────┘
```

**数据库实体**：

```java
@Entity
@Table(name = "users")
public class User {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;
    private String username;
    private String password;
    private boolean enabled;

    @ManyToMany(fetch = FetchType.EAGER)
    @JoinTable(name = "user_roles",
        joinColumns = @JoinColumn(name = "user_id"),
        inverseJoinColumns = @JoinColumn(name = "role_id"))
    private Set<Role> roles = new HashSet<>();
}

@Entity
@Table(name = "roles")
public class Role {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;
    private String name;

    @ManyToMany(fetch = FetchType.EAGER)
    @JoinTable(name = "role_permissions",
        joinColumns = @JoinColumn(name = "role_id"),
        inverseJoinColumns = @JoinColumn(name = "perm_id"))
    private Set<Permission> permissions = new HashSet<>();
}

@Entity
@Table(name = "permissions")
public class Permission {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;
    private String name;       // e.g. "order:read"
    private String resource;   // e.g. "order"
    private String action;     // e.g. "read", "write", "delete"
}
```

**方法级权限控制**：

```java
@Service
@RequiredArgsConstructor
public class OrderService {

    private final OrderRepository orderRepository;

    @PreAuthorize("hasRole('ADMIN')")
    public List<Order> findAll() {
        return orderRepository.findAll();
    }

    @PreAuthorize("hasRole('USER') or hasRole('ADMIN')")
    public Order findById(Long id) {
        return orderRepository.findById(id)
            .orElseThrow(() -> new NotFoundException("订单不存在"));
    }

    @PreAuthorize("hasRole('ADMIN')")
    public void deleteById(Long id) {
        orderRepository.deleteById(id);
    }
}
```

启用方法级安全：

```java
@Configuration
@EnableMethodSecurity  // Spring Security 6.x
public class MethodSecurityConfig {
    // @EnableMethodSecurity 已包含 @PreAuthorize 支持
    // 旧写法：@EnableGlobalMethodSecurity(prePostEnabled = true)
}
```

> **踩坑提醒**：`hasRole('ADMIN')` 会自动加 `ROLE_` 前缀，所以数据库里存的必须是 `ROLE_ADMIN`。如果你存的是 `ADMIN`，应该用 `hasAuthority('ADMIN')`。这个坑我踩过无数次。

---

### 5.3.2 自定义权限评估

**痛点**：RBAC 只能控制"谁能访问订单接口"，但你需要更细粒度的控制——"用户只能编辑自己创建的订单"。这就是数据级权限。

**PermissionEvaluator 实现**：

```java
@Component
public class CustomPermissionEvaluator implements PermissionEvaluator {

    @Autowired
    private OrderRepository orderRepository;

    @Override
    public boolean hasPermission(Authentication authentication,
                                  Object targetDomainObject,
                                  Object permission) {
        if (targetDomainObject instanceof Order order) {
            return checkOrderPermission(authentication, order,
                permission.toString());
        }
        return false;
    }

    @Override
    public boolean hasPermission(Authentication authentication,
                                  Serializable targetId,
                                  String targetType,
                                  Object permission) {
        if ("Order".equals(targetType)) {
            Order order = orderRepository.findById((Long) targetId)
                .orElse(null);
            if (order == null) return false;
            return checkOrderPermission(authentication, order,
                permission.toString());
        }
        return false;
    }

    private boolean checkOrderPermission(Authentication auth,
                                          Order order, String perm) {
        String currentUsername = auth.getName();

        // 管理员有全部权限
        if (auth.getAuthorities().stream()
                .anyMatch(g -> g.getAuthority().equals("ROLE_ADMIN"))) {
            return true;
        }

        // 普通用户只能操作自己的订单
        return switch (perm) {
            case "read"   -> true;  // 所有人可读
            case "write"  -> order.getCreatedBy().equals(currentUsername);
            case "delete" -> order.getCreatedBy().equals(currentUsername)
                             && order.getStatus() == OrderStatus.DRAFT;
            default       -> false;
        };
    }
}
```

注册自定义 `PermissionEvaluator`：

```java
@Bean
public MethodSecurityExpressionHandler methodSecurityExpressionHandler(
        CustomPermissionEvaluator permissionEvaluator) {
    DefaultMethodSecurityExpressionHandler handler =
        new DefaultMethodSecurityExpressionHandler();
    handler.setPermissionEvaluator(permissionEvaluator);
    return handler;
}
```

**在 Service 中使用**：

```java
@Service
public class OrderService {

    // targetDomainObject 方式：对象已加载
    @PreAuthorize("hasPermission(#order, 'write')")
    public Order updateOrder(Order order) {
        return orderRepository.save(order);
    }

    // targetId 方式：先检查权限再加载对象
    @PreAuthorize("hasPermission(#id, 'Order', 'delete')")
    public void deleteOrder(Long id) {
        orderRepository.deleteById(id);
    }
}
```

> **踩坑提醒**：`@PreAuthorize` 的 `hasPermission` 和 `hasRole` 是不同的表达式。如果你忘了注册 `PermissionEvaluator` Bean，`hasPermission` 会静默返回 `false`，不会报错——这比报错更危险，因为所有用户都会被拒绝访问。

---

### 5.3.3 ABAC（基于属性的访问控制）

**痛点**：RBAC 无法表达"工作日 9-18 点才能访问"、"只能从公司 IP 操作"这类动态规则。

**Spring EL 实现 ABAC**：

```java
@Component("permissionService")
public class DynamicPermissionService {

    // 基于时间的权限
    public boolean isBusinessHours() {
        LocalTime now = LocalTime.now();
        return now.isAfter(LocalTime.of(9, 0))
            && now.isBefore(LocalTime.of(18, 0));
    }

    // 基于 IP 的权限
    public boolean isFromCompanyNetwork(HttpServletRequest request) {
        String ip = request.getRemoteAddr();
        return ip.startsWith("10.0.") || ip.startsWith("192.168.");
    }

    // 基于资源属性的权限
    public boolean isOrderOwner(Long orderId, Authentication auth) {
        return orderRepository.findById(orderId)
            .map(o -> o.getCreatedBy().equals(auth.getName()))
            .orElse(false);
    }
}
```

**在 Controller 中组合使用**：

```java
@RestController
@RequestMapping("/api/orders")
@RequiredArgsConstructor
public class OrderController {

    private final OrderService orderService;

    // 时间 + 角色 组合
    @GetMapping("/export")
    @PreAuthorize("hasRole('ADMIN') and @permissionService.isBusinessHours()")
    public ResponseEntity<byte[]> exportOrders() {
        return ResponseEntity.ok(orderService.exportToExcel());
    }

    // IP + 角色 组合
    @PostMapping
    @PreAuthorize("hasRole('USER') and " +
        "@permissionService.isFromCompanyNetwork(request)")
    public Order createOrder(@RequestBody OrderRequest req,
                             HttpServletRequest request) {
        return orderService.create(req);
    }

    // 资源所有权
    @PutMapping("/{id}")
    @PreAuthorize("@permissionService.isOrderOwner(#id, authentication)")
    public Order updateOrder(@PathVariable Long id,
                             @RequestBody OrderRequest req) {
        return orderService.update(id, req);
    }
}
```

**ABAC vs RBAC 对比**：

| 维度 | RBAC | ABAC |
|------|------|------|
| 权限粒度 | 角色级 | 属性级（时间/IP/资源状态...） |
| 规则复杂度 | 低（简单映射） | 高（灵活表达式） |
| 管理成本 | 低（配角色即可） | 高（需编写策略逻辑） |
| 适用场景 | 组织架构清晰的企业应用 | 动态策略需求（审批流、风控） |
| 性能 | ⭐⭐⭐ 简单查询 | ⭐⭐ 需要运行时计算 |

> **踩坑提醒**：ABAC 表达式中 `@permissionService.isXxx()` 调用的是 Spring Bean 的方法，每次请求都会执行。如果你的判断逻辑涉及数据库查询，注意性能影响——考虑加缓存或用 `@Cacheable`。

---

## 5.4 数据安全

### 5.4.1 密码加密

**痛点**：2024 年了还有人用 MD5 存密码——MD5 不是加密算法，是哈希算法，而且已经被彩虹表攻破了。

**BCrypt 为什么比 MD5 安全**：

| 特性 | MD5 | SHA-256 | BCrypt |
|------|-----|---------|--------|
| 类型 | 哈希 | 哈希 | 自适应哈希 |
| 盐值（Salt） | ❌ 需要手动加 | ❌ 需要手动加 | ✅ 自动生成 |
| 计算速度 | ⚡ 极快（10 亿次/秒） | ⚡ 快 | 🐌 故意慢（可调节） |
| 抗彩虹表 | ❌ | ❌ | ✅ |
| 抗 GPU 暴力破解 | ❌ | ❌ | ✅（内存密集型） |
| 是否可逆 | 理论不可逆 | 理论不可逆 | 理论不可逆 |

**Spring Boot 使用 BCrypt**：

```java
@Configuration
public class PasswordConfig {

    @Bean
    public PasswordEncoder passwordEncoder() {
        // BCrypt 强度因子（默认 10，推荐 12）
        return new BCryptPasswordEncoder(12);
    }
}
```

```java
// 注册用户时加密密码
@Service
@RequiredArgsConstructor
public class UserService {

    private final PasswordEncoder passwordEncoder;
    private final UserRepository userRepository;

    public User register(RegisterRequest request) {
        User user = new User();
        user.setUsername(request.getUsername());
        // 永远不要明文存储密码
        user.setPassword(passwordEncoder.encode(request.getPassword()));
        return userRepository.save(user);
    }

    // 验证密码（登录时由 Spring Security 自动调用）
    // passwordEncoder.matches(rawPassword, encodedPassword)
}
```

```java
// 密码强度因子说明
// BCryptPasswordEncoder(4)  → ~0.01 秒，不推荐
// BCryptPasswordEncoder(10) → ~0.1 秒，默认值
// BCryptPasswordEncoder(12) → ~0.5 秒，推荐
// BCryptPasswordEncoder(14) → ~2 秒，高安全场景
// BCryptPasswordEncoder(31) → ~数天，别用，服务器会炸
```

> **踩坑提醒**：BCrypt 生成的哈希值每次都不一样（因为随机盐值），所以你不能用 `passwordEncoder.encode("123").equals(storedHash)` 来验证——必须用 `passwordEncoder.matches()`。另外，BCrypt 有 72 字节截断限制，超过 72 字节的密码部分会被忽略。

---

### 5.4.2 敏感数据加密存储

**痛点**：用户的身份证号、手机号、银行卡号，数据库管理员直接 `SELECT *` 就能看到。你需要字段级加密。

**方案一：Jasypt 配置文件加密**：

```yaml
# application.yml — 加密后的配置值用 ENC() 包裹
spring:
  datasource:
    password: ENC(nrmZ02SmGMjFZhsxluDbOoH4P9kX8bBn)

# jasypt 配置
jasypt:
  encryptor:
    password: ${JASYPT_MASTER_KEY}  # 主密钥，通过环境变量传入
    algorithm: PBEWITHHMACSHA512ANDAES_256
    iv-generator-classname: org.jasypt.iv.RandomIvGenerator
```

```xml
<!-- pom.xml -->
<dependency>
    <groupId>com.github.ulisesbocchio</groupId>
    <artifactId>jasypt-spring-boot-starter</artifactId>
    <version>3.0.5</version>
</dependency>
```

**方案二：自定义 AttributeConverter 字段加密**：

```java
@Converter
public class EncryptedStringConverter implements AttributeConverter<String, String> {

    // 实际项目中应从安全配置获取密钥，不要硬编码
    private static final String SECRET_KEY = System.getenv("FIELD_ENCRYPT_KEY");
    private static final String ALGORITHM = "AES/GCM/NoPadding";

    @Override
    public String convertToDatabaseColumn(String attribute) {
        if (attribute == null) return null;
        try {
            SecretKey key = deriveKey();
            Cipher cipher = Cipher.getInstance(ALGORITHM);
            cipher.init(Cipher.ENCRYPT_MODE, key);
            byte[] iv = cipher.getIV();
            byte[] encrypted = cipher.doFinal(attribute.getBytes(StandardCharsets.UTF_8));
            // IV + 密文 一起存储
            byte[] combined = new byte[iv.length + encrypted.length];
            System.arraycopy(iv, 0, combined, 0, iv.length);
            System.arraycopy(encrypted, 0, combined, iv.length, encrypted.length);
            return Base64.getEncoder().encodeToString(combined);
        } catch (Exception e) {
            throw new RuntimeException("加密失败", e);
        }
    }

    @Override
    public String convertToEntityAttribute(String dbData) {
        if (dbData == null) return null;
        try {
            byte[] combined = Base64.getDecoder().decode(dbData);
            byte[] iv = Arrays.copyOfRange(combined, 0, 12); // GCM IV 固定 12 字节
            byte[] encrypted = Arrays.copyOfRange(combined, 12, combined.length);
            SecretKey key = deriveKey();
            Cipher cipher = Cipher.getInstance(ALGORITHM);
            cipher.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(128, iv));
            return new String(cipher.doFinal(encrypted), StandardCharsets.UTF_8);
        } catch (Exception e) {
            throw new RuntimeException("解密失败", e);
        }
    }

    private SecretKey deriveKey() {
        return new SecretKeySpec(
            SECRET_KEY.getBytes(StandardCharsets.UTF_8), "AES");
    }
}

// 在实体中使用
@Entity
public class Customer {
    @Id
    private Long id;

    private String name;  // 明文

    @Convert(converter = EncryptedStringConverter.class)
    private String idCardNumber;  // 加密存储

    @Convert(converter = EncryptedStringConverter.class)
    private String phoneNumber;   // 加密存储
}
```

> **踩坑提醒**：字段加密后你就不能用 `WHERE phone = ?` 做精确查询了（每次加密的 IV 不同，同明文不同密文）。解决方案：① 存一个不可逆哈希用于查询，密文用于解密展示；② 用确定性加密（固定 IV），但安全性降低。

---

## 5.5 安全最佳实践

### 5.5.1 CSRF 防护

**痛点**：用户登录了你的网站，然后访问了一个恶意网站，恶意网站用用户的 Cookie 向你的网站发请求——这就是 CSRF 攻击。

**CSRF 攻击原理**：

```
1. 用户登录 bank.com，获得 Session Cookie
2. 用户访问 evil.com（恶意页面）
3. evil.com 页面中有：<img src="https://bank.com/transfer?to=hacker&amount=10000">
4. 浏览器自动带上 bank.com 的 Cookie
5. bank.com 以为是用户本人操作，执行转账
```

**Spring Security 的 CSRF 防护**：

```java
@Configuration
@EnableWebSecurity
public class CsrfConfig {

    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        http
            // 启用 CSRF（默认就是启用的）
            .csrf(csrf -> csrf
                // 使用 Cookie 存储 CSRF Token（前后端分离场景）
                .csrfTokenRepository(CookieCsrfTokenRepository.withHttpOnlyFalse())
                // 某些路径不需要 CSRF 保护
                .ignoringRequestMatchers(
                    "/api/**",           // REST API 用 JWT，不需要 CSRF
                    "/webhook/**"        // 第三方回调
                )
            );
        return http.build();
    }
}
```

**前端配合（Thymeleaf 模板）**：

```html
<!-- Thymeleaf 自动注入 CSRF Token -->
<form th:action="@{/transfer}" method="post">
    <input type="hidden" th:name="${_csrf.parameterName}"
           th:value="${_csrf.token}" />
    <input type="text" name="to" />
    <input type="number" name="amount" />
    <button type="submit">转账</button>
</form>
```

```javascript
// 前后端分离：从 Cookie 读取 CSRF Token
function getCsrfToken() {
    const match = document.cookie.match(/XSRF-TOKEN=([^;]+)/);
    return match ? decodeURIComponent(match[1]) : null;
}

// 请求时带上
fetch('/api/orders', {
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'X-XSRF-TOKEN': getCsrfToken()  // CookieCsrfTokenRepository 默认用这个头
    },
    body: JSON.stringify({ /* ... */ })
});
```

**什么时候禁用 CSRF**：

| 场景 | 是否需要 CSRF |
|------|--------------|
| 表单提交 + Session | ✅ 必须启用 |
| REST API + JWT（无 Cookie） | ❌ 可以禁用 |
| REST API + Session Cookie | ✅ 必须启用 |
| 第三方 Webhook 回调 | ❌ 用签名验证 |

> **踩坑提醒**：如果你用 JWT + `Authorization` 头传递 Token，CSRF 攻击对你的 API 无效——因为恶意网站无法读取 `Authorization` 头，也无法让浏览器自动带上它。所以 REST API 场景下可以安全地禁用 CSRF。但如果你的 JWT 存在 Cookie 里，那 CSRF 防护仍然必须。

---

### 5.5.2 CORS 跨域配置

**痛点**：前端 `localhost:3000` 请求后端 `localhost:8080`，浏览器直接拦截——"No 'Access-Control-Allow-Origin' header"。

**CORS 精细配置**：

```java
@Configuration
public class CorsConfig {

    @Bean
    public CorsConfigurationSource corsConfigurationSource() {
        CorsConfiguration config = new CorsConfiguration();

        // 允许的来源（不要用 *，指定具体域名）
        config.setAllowedOrigins(List.of(
            "http://localhost:3000",
            "https://app.example.com"
        ));

        // 允许的 HTTP 方法
        config.setAllowedMethods(List.of("GET", "POST", "PUT", "DELETE", "OPTIONS"));

        // 允许的请求头
        config.setAllowedHeaders(List.of(
            "Authorization", "Content-Type", "X-Requested-With"
        ));

        // 暴露给前端的响应头
        config.setExposedHeaders(List.of(
            "X-Total-Count", "X-Page-Number"
        ));

        // 允许携带 Cookie（注意：此时 allowedOrigins 不能用 *）
        config.setAllowCredentials(true);

        // 预检请求缓存时间（秒）
        config.setMaxAge(3600L);

        UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
        source.registerCorsConfiguration("/**", config);
        return source;
    }
}
```

**在 SecurityFilterChain 中启用**：

```java
@Bean
public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
    http
        // CORS 必须在 CSRF 之前
        .cors(cors -> cors.configurationSource(corsConfigurationSource()))
        .csrf(csrf -> csrf.disable())
        // ...
        ;
    return http.build();
}
```

**CORS 响应头说明**：

| 响应头 | 作用 |
|--------|------|
| `Access-Control-Allow-Origin` | 允许哪些来源 |
| `Access-Control-Allow-Methods` | 允许哪些 HTTP 方法 |
| `Access-Control-Allow-Headers` | 允许哪些自定义头 |
| `Access-Control-Expose-Headers` | 前端可读取的响应头 |
| `Access-Control-Allow-Credentials` | 是否允许携带 Cookie |
| `Access-Control-Max-Age` | 预检缓存时间 |

> **踩坑提醒**：`allowedOrigins("*")` 和 `allowCredentials(true)` 不能同时使用——这是 CORS 规范的硬性限制。如果你需要带 Cookie，必须指定具体域名。另外，Spring Boot 3.x 对 `setAllowedOrigins` 和 `setAllowedOriginPatterns` 做了区分，前者不支持通配符，后者支持 `*.example.com`。

---

### 5.5.3 安全响应头

**痛点**：你的网站能被 iframe 嵌入（Clickjacking）、加载外部脚本（XSS）、HTTP 被降级（MITM）。安全响应头是最轻量的防御层。

**配置安全响应头**：

```java
@Bean
public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
    http
        .headers(headers -> headers
            // Content Security Policy — 防 XSS
            .contentSecurityPolicy(csp -> csp
                .policyDirectives(
                    "default-src 'self'; " +
                    "script-src 'self' https://cdn.jsdelivr.net; " +
                    "style-src 'self' 'unsafe-inline'; " +
                    "img-src 'self' data: https:; " +
                    "font-src 'self' https://fonts.gstatic.com; " +
                    "frame-ancestors 'none';"  // 防 Clickjacking
                )
            )
            // X-Frame-Options — 防 Clickjacking
            .frameOptions(frame -> frame.deny())
            // HSTS — 强制 HTTPS
            .httpStrictTransportSecurity(hsts -> hsts
                .includeSubDomains(true)
                .maxAgeInSeconds(31536000)     // 1 年
            )
            // 不要暴露服务器信息
            .defaultsDisabled()  // 禁用所有默认头
        );
    return http.build();
}
```

**常见安全头说明**：

| 安全头 | 作用 | 推荐值 |
|--------|------|--------|
| `Content-Security-Policy` | 限制资源加载来源，防 XSS | `default-src 'self'` |
| `X-Frame-Options` | 防止页面被 iframe 嵌入 | `DENY` 或 `SAMEORIGIN` |
| `Strict-Transport-Security` | 强制使用 HTTPS | `max-age=31536000; includeSubDomains` |
| `X-Content-Type-Options` | 防止 MIME 类型嗅探 | `nosniff` |
| `X-XSS-Protection` | 浏览器 XSS 过滤器 | `1; mode=block`（旧浏览器用） |
| `Referrer-Policy` | 控制 Referer 信息泄露 | `strict-origin-when-cross-origin` |
| `Permissions-Policy` | 限制浏览器 API 使用 | `camera=(), microphone=()` |

> **踩坑提醒**：CSP 配置太严格会把你的前端页面搞挂——比如 `script-src 'self'` 会阻止所有内联脚本（`<script>...</script>`）和 `eval()`。建议先用 `Content-Security-Policy-Report-Only` 头观察哪些资源会被拦截，确认无误后再正式启用。

---

## 本章小结

| 主题 | 核心要点 |
|------|----------|
| 安全架构 | 认证（你是谁）→ 授权（你能做什么），基于 Filter Chain |
| 认证方案 | 单体用 Session，微服务用 JWT，第三方用 OAuth 2.0 |
| 授权模型 | RBAC 管角色，ABAC 管动态策略，PermissionEvaluator 管数据级 |
| 数据安全 | 密码用 BCrypt，敏感字段用 AES-GCM 加密 |
| 最佳实践 | CSRF/CORS/安全头三件套，缺一不可 |
