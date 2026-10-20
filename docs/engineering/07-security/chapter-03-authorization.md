# 授权

> **核心问题**：RBAC 和 ABAC 有什么区别？如何实现细粒度的权限控制？

## 1. RBAC（基于角色的访问控制）

RBAC 模型：用户 -> 角色 -> 权限。一个用户可以有多个角色，一个角色可以有多个权限。

数据库设计：

```txt
users: id, username, password
roles: id, name (ADMIN, USER, MANAGER)
permissions: id, name (user:read, user:write, order:read)
user_roles: user_id, role_id
role_permissions: role_id, permission_id
```

RBAC 落地通常分两层：URL 级权限（哪些接口需要什么角色）与方法级权限（哪些方法需要什么权限）。各框架的注解与配置见 [Spring Security 授权](../../spring/05-security/chapter-03-authorization)。

## 2. ABAC（基于属性的访问控制）

ABAC 基于用户属性、资源属性、环境属性做决策，比 RBAC 更灵活，适合复杂权限场景：

```java
public class AccessDecisionService {

    public boolean canAccess(User user, Resource resource, RequestContext context) {
        // 规则 1：来源限制是访问前提，不直接授予资源权限
        // 本例白名单表示「仅允许这些来源的请求参与授权判断」，命中后才能继续；
        // 若业务中白名单本身就是某类资源的授权规则，应限定其适用资源范围，而非全局放行
        if (!isInWhitelist(context.getClientIp())) return false;

        // 规则 2：管理员可以访问所有资源
        if (user.hasRole("ADMIN")) return true;

        // 规则 3：资源拥有者可以访问自己的资源
        if (resource.getOwnerId().equals(user.getId())) return true;

        // 规则 4：工作时间内，经理可以访问部门资源
        if (user.hasRole("MANAGER")
            && isWorkingHours(context.getCurrentTime())
            && resource.getDepartmentId().equals(user.getDepartmentId())) {
            return true;
        }

        return false;
    }
}
```

## 3. RBAC vs ABAC 对比

| 维度 | RBAC | ABAC |
| :-- | :-- | :-- |
| 灵活性 | 低（权限经角色绑定，粒度粗） | 高（任意属性组合） |
| 复杂度 | 低 | 高 |
| 适用场景 | 权限相对固定 | 权限规则复杂、动态 |
| 管理成本 | 低（管理角色） | 高（管理策略） |
| 示例 | 后台管理系统 | 云平台、多租户系统 |

两者不互斥，实际系统常以 RBAC 为主、属性规则为辅。

## 4. 数据权限

数据权限解决「不同用户看到不同数据范围」的问题：管理员看到所有数据，部门经理看到本部门数据，普通员工只看到自己的数据。

实现思路是在查询层统一追加数据范围过滤条件，按当前用户的数据范围自动生成过滤条件。过滤条件必须在统一、可验证的查询执行路径中施加，覆盖分页、统计、关联等所有受保护查询，避免将未经校验的用户输入拼接进 SQL；无法安全施加过滤条件的查询应拒绝执行，而不是默认放行。各框架落地见 [Spring Security 授权](../../spring/05-security/chapter-03-authorization) 与 [MyBatis 集成](../../spring/04-data-access/chapter-02-mybatis-integration)。

> **授权的核心**：验证"你能做什么"。RBAC 适合大多数场景，ABAC 适合复杂场景。数据权限是授权的重要组成部分，不能只控制功能权限而忽略数据权限。
