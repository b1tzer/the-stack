# 授权模型

## 1. RBAC 模型

### 1.1 RBAC 三表模型设计

**痛点**：硬编码 `if (user.getRole().equals("ADMIN"))` 散落在每个接口里，改权限要改代码。

**RBAC 五表模型**（用户-角色-权限三核心 + 两张关联表）：

```txt
┌──────────┐    ┌──────────────┐    ┌──────────┐
│ sys_user │───►│ sys_user_role│◄───│ sys_role │
│──────────│    │──────────────│    │──────────│
│ id       │    │ user_id      │    │ id       │
│ username │    │ role_id      │    │ role_code│
│ password │    └──────────────┘    │ role_name│
└──────────┘                        └─────┬────┘
                                          │
                                    ┌─────┴──────────────┐
                                    │sys_role_permission │
                                    │────────────────────│
                                    │ role_id            │
                                    │ permission_id      │
                                    └─────┬──────────────┘
                                          │
                                    ┌─────┴────────────┐
                                    │ sys_permission   │
                                    │──────────────────│
                                    │ id               │
                                    │ permission_code  │
                                    │ resource_type    │
                                    │ parent_id        │
                                    └──────────────────┘
```

**数据库建表语句**：

```sql
CREATE TABLE sys_user (
    id          BIGINT PRIMARY KEY AUTO_INCREMENT,
    username    VARCHAR(50) UNIQUE NOT NULL,
    password    VARCHAR(100) NOT NULL,
    status      TINYINT DEFAULT 1 COMMENT '1-正常 0-禁用',
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE sys_role (
    id          BIGINT PRIMARY KEY AUTO_INCREMENT,
    role_code   VARCHAR(50) UNIQUE NOT NULL COMMENT '如 ROLE_ADMIN',
    role_name   VARCHAR(100) NOT NULL,
    status      TINYINT DEFAULT 1
);

CREATE TABLE sys_permission (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    permission_code VARCHAR(100) UNIQUE NOT NULL COMMENT '如 order:read',
    permission_name VARCHAR(200) NOT NULL,
    resource_type   VARCHAR(20) DEFAULT 'api' COMMENT 'menu/button/api',
    parent_id       BIGINT DEFAULT 0
);

CREATE TABLE sys_user_role (
    user_id BIGINT NOT NULL,
    role_id BIGINT NOT NULL,
    PRIMARY KEY (user_id, role_id)
);

CREATE TABLE sys_role_permission (
    role_id       BIGINT NOT NULL,
    permission_id BIGINT NOT NULL,
    PRIMARY KEY (role_id, permission_id)
);
```

### 1.2 与 Spring Security 集成

```java
@Service
public class CustomUserDetailsService implements UserDetailsService {

    private final UserMapper userMapper;

    @Override
    public UserDetails loadUserByUsername(String username) {
        // 1. 查询用户基本信息
        SysUser user = userMapper.selectByUsername(username);
        if (user == null) {
            throw new UsernameNotFoundException("用户不存在: " + username);
        }

        // 2. 查询用户的角色和权限
        List<String> permissions = userMapper.selectPermissionsByUserId(user.getId());

        // 3. 构建 GrantedAuthority 列表
        List<GrantedAuthority> authorities = permissions.stream()
            .map(SimpleGrantedAuthority::new)
            .collect(Collectors.toList());

        return new User(
            user.getUsername(),
            user.getPassword(),
            user.getStatus() == 1,
            true, true, true,
            authorities
        );
    }
}
```

方法级权限控制：

```java
@Configuration
@EnableMethodSecurity
public class MethodSecurityConfig {
    // @EnableMethodSecurity 已包含 @PreAuthorize 支持
}

@Service
public class AdminService {
    @PreAuthorize("hasRole('ADMIN')")
    public void adminOperation() { /* ... */ }
    
    @PreAuthorize("hasAuthority('user:write')")
    public void writeUser() { /* ... */ }
    
    @PostAuthorize("returnObject.username == authentication.name")
    public User getUser(Long id) { /* ... */ }
}
```

> **踩坑提醒**：`hasRole('ADMIN')` 会自动加 `ROLE_` 前缀，所以数据库里存的必须是 `ROLE_ADMIN`。如果你存的是 `ADMIN`，应该用 `hasAuthority('ADMIN')`。

## 2. 数据级权限（PermissionEvaluator）

**痛点**：RBAC 只能控制“谁能访问订单接口”，但你需要更细粒度的控制——“用户只能编辑自己创建的订单”。这就是数据级权限。

### 2.1 PermissionEvaluator 完整实现

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

在 Service 中使用：

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

## 3. ABAC（基于属性的访问控制）

**痛点**：RBAC 无法表达“工作日 9-18 点才能访问”、“只能从公司 IP 操作”这类动态规则。

### 3.1 Spring EL 实现 ABAC

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

### 3.2 在 Controller 中组合使用

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

### 3.3 ABAC vs RBAC 对比

| 维度 | RBAC | ABAC |
| :-- | :-- | :-- |
| 权限粒度 | 角色级 | 属性级（时间/IP/资源状态...） |
| 规则复杂度 | 低（简单映射） | 高（灵活表达式） |
| 管理成本 | 低（配角色即可） | 高（需编写策略逻辑） |
| 适用场景 | 组织架构清晰的企业应用 | 动态策略需求（审批流、风控） |
| 性能 | ⭐⭐⭐ 简单查询 | ⭐⭐ 需要运行时计算 |

> **踩坑提醒**：ABAC 表达式中 `@permissionService.isXxx()` 调用的是 Spring Bean 的方法，每次请求都会执行。如果你的判断逻辑涉及数据库查询，注意性能影响——考虑加缓存或用 `@Cacheable`。

## 4. 授权实战

### 4.1 数据权限控制

```java
@Target(ElementType.METHOD)
@Retention(RetentionPolicy.RUNTIME)
public @interface DataScope {
    String tableAlias() default "";  // 表别名
    String deptColumn() default "dept_id";
    String userColumn() default "create_by";
}

@Aspect
@Component
public class DataScopeAspect {

    @Before("@annotation(dataScope)")
    public void before(JoinPoint point, DataScope dataScope) {
        // 获取当前用户角色和部门信息
        LoginUser currentUser = SecurityUtils.getCurrentUser();
        List<String> roles = currentUser.getRoles();

        StringBuilder sqlFilter = new StringBuilder();

        // 超级管理员不过滤
        if (!roles.contains("ROLE_ADMIN")) {
            // 部门管理员：只看本部门数据
            if (roles.contains("ROLE_DEPT_ADMIN")) {
                sqlFilter.append(String.format(" AND %s.%s = %d",
                    dataScope.tableAlias(), dataScope.deptColumn(),
                    currentUser.getDeptId()));
            } else {
                // 普通用户：只看自己创建的数据
                sqlFilter.append(String.format(" AND %s.%s = '%s'",
                    dataScope.tableAlias(), dataScope.userColumn(),
                    currentUser.getUsername()));
            }
        }

        // 将过滤条件注入到 MyBatis 的 SQL 中
        MDC.put("dataScope", sqlFilter.toString());
    }
}

// 使用
@Service
public class OrderService {
    @DataScope(tableAlias = "o", deptColumn = "dept_id")
    public List<Order> listOrders() {
        return orderMapper.selectAll();  // SQL 中会自动追加数据权限条件
    }
}
```

### 4.2 数据库级权限控制

```java
@Service
public class DatabasePermissionService {

    @Autowired
    private JdbcTemplate jdbcTemplate;

    // 根据用户角色动态修改查询 SQL
    public String buildPermissionFilter(String resource, LoginUser user) {
        List<String> permissions = user.getPermissions();
        if (permissions.contains("*:*:*")) {
            return "";  // 超级管理员，不过滤
        }

        String permission = findMatchingPermission(permissions, resource);
        if (permission == null) {
            throw new AccessDeniedException("无 " + resource + " 访问权限");
        }

        // 解析权限表达式
        if (permission.contains("dept:")) {
            return " AND dept_id IN (" + getDeptTree(user.getDeptId()) + ")";
        } else if (permission.contains("self:")) {
            return " AND create_by = '" + user.getUsername() + "'";
        }
        return "";
    }
}
```

### 4.3 权限缓存

```java
@Service
public class PermissionCacheService {

    private final Cache<String, Set<String>> permissionCache = CacheBuilder.newBuilder()
        .maximumSize(10000)
        .expireAfterWrite(5, TimeUnit.MINUTES)
        .build();

    public Set<String> getUserPermissions(Long userId) {
        return permissionCache.getUnchecked(String.valueOf(userId),
            () -> loadPermissionsFromDb(userId));
    }

    private Set<String> loadPermissionsFromDb(Long userId) {
        // 查询用户的角色和权限
        return permissionMapper.selectByUserId(userId).stream()
            .map(Permission::getCode)
            .collect(Collectors.toSet());
    }

    // 用户权限变更时清除缓存
    public void evictUser(Long userId) {
        permissionCache.invalidate(String.valueOf(userId));
    }
}
```

## 5. 授权最佳实践

1. **权限粒度**——菜单权限 + 按钮权限 + 数据权限，三层控制
2. **角色设计**——遵循最小权限原则，不要给用户多余权限
3. **权限缓存**——权限查询频繁，必须缓存，变更时主动清除
4. **`@PreAuthorize` 优于 `@Secured`**——前者支持 SpEL 表达式，更灵活
5. **接口和菜单权限分开管理**——接口权限防越权访问，菜单权限控制前端展示
