# 授权

> **核心问题**：RBAC 和 ABAC 有什么区别？如何实现细粒度的权限控制？

## 1. RBAC（基于角色的访问控制）

```java
// RBAC 模型：用户 -> 角色 -> 权限
// 一个用户可以有多个角色，一个角色可以有多个权限

// 数据库设计
// users: id, username, password
// roles: id, name (ADMIN, USER, MANAGER)
// permissions: id, name (user:read, user:write, order:read)
// user_roles: user_id, role_id
// role_permissions: role_id, permission_id

// Spring Security RBAC 配置
@Configuration
@EnableMethodSecurity
public class MethodSecurityConfig {
    
    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        http.authorizeHttpRequests(auth -> auth
            .requestMatchers(\"/api/admin/**\").hasRole(\"ADMIN\")
            .requestMatchers(\"/api/user/**\").hasAnyRole(\"USER\", \"ADMIN\")
            .requestMatchers(HttpMethod.GET, \"/api/products/**\").permitAll()
            .requestMatchers(HttpMethod.POST, \"/api/orders/**\").authenticated()
            .anyRequest().denyAll()
        );
        return http.build();
    }
}

// 方法级别权限控制
@Service
public class UserService {
    
    @PreAuthorize(\"hasRole('ADMIN')\")
    public void deleteUser(Long userId) {
        // 只有管理员可以删除用户
    }
    
    @PreAuthorize(\"hasRole('ADMIN') or #userId == authentication.principal.id\")
    public UserVO getUser(Long userId) {
        // 管理员可以看任何人，普通用户只能看自己
        return null;
    }
    
    @PreAuthorize(\"hasAuthority('order:write')\")
    public void createOrder(OrderCommand cmd) {
        // 需要 order:write 权限
    }
}
```

## 2. ABAC（基于属性的访问控制）

```java
// ABAC：基于用户属性、资源属性、环境属性做决策
// 更灵活，适合复杂权限场景

// 示例：基于时间、地点、用户属性的权限控制
public class AccessDecisionService {
    
    public boolean canAccess(User user, Resource resource, RequestContext context) {
        // 规则 1：管理员可以访问所有资源
        if (user.hasRole(\"ADMIN\")) return true;
        
        // 规则 2：资源拥有者可以访问自己的资源
        if (resource.getOwnerId().equals(user.getId())) return true;
        
        // 规则 3：工作时间内，经理可以访问部门资源
        if (user.hasRole(\"MANAGER\") 
            && isWorkingHours(context.getCurrentTime())
            && resource.getDepartmentId().equals(user.getDepartmentId())) {
            return true;
        }
        
        // 规则 4：IP 白名单内的请求可以访问
        if (isInWhitelist(context.getClientIp())) return true;
        
        return false;
    }
    
    private boolean isWorkingHours(LocalDateTime time) {
        int hour = time.getHour();
        return hour >= 9 && hour < 18;
    }
}
```

## 3. RBAC vs ABAC 对比

| 维度 | RBAC | ABAC |
|------|------|------|
| 灵活性 | 低（角色固定） | 高（任意属性组合） |
| 复杂度 | 低 | 高 |
| 适用场景 | 权限相对固定 | 权限规则复杂、动态 |
| 管理成本 | 低（管理角色） | 高（管理策略） |
| 示例 | 后台管理系统 | 云平台、多租户系统 |

## 4. 数据权限

```java
// 数据权限：不同用户看到不同的数据范围
// 管理员：看到所有数据
// 部门经理：看到本部门数据
// 普通员工：只看到自己的数据

// MyBatis 拦截器实现数据权限
@Intercepts({@Signature(type = StatementHandler.class, method = \"prepare\", args = {Connection.class, Integer.class})})
public class DataPermissionInterceptor implements Interceptor {
    
    @Override
    public Object intercept(Invocation invocation) throws Throwable {
        StatementHandler handler = (StatementHandler) invocation.getTarget();
        String sql = handler.getBoundSql().getSql();
        
        // 根据当前用户的数据权限，追加 WHERE 条件
        User currentUser = SecurityUtils.getCurrentUser();
        if (currentUser.getDataScope() == DataScope.DEPARTMENT) {
            sql = sql + \" AND department_id = \" + currentUser.getDepartmentId();
        } else if (currentUser.getDataScope() == DataScope.SELF) {
            sql = sql + \" AND creator_id = \" + currentUser.getId();
        }
        
        // 反射修改 SQL
        Field sqlField = handler.getBoundSql().getClass().getDeclaredField(\"sql\");
        sqlField.setAccessible(true);
        sqlField.set(handler.getBoundSql(), sql);
        
        return invocation.proceed();
    }
}
```

> **授权的核心**：验证"你能做什么"。RBAC 适合大多数场景，ABAC 适合复杂场景。数据权限是授权的重要组成部分，不能只控制功能权限而忽略数据权限。
