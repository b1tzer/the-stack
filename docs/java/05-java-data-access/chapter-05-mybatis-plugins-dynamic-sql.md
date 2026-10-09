# MyBatis：插件机制与动态 SQL

> 本页与 [MyBatis：SQL 映射框架](./chapter-04-mybatis.md) 配套，重点说明插件拦截链、分页插件和动态 SQL 的运行方式。

## 1. 插件机制

### 1.1 拦截器模型

MyBatis 的插件机制基于**责任链模式**，允许你在 SQL 执行的四个关键环节插入自定义逻辑。

```java
@Intercepts({
    @Signature(
        type = StatementHandler.class,
        method = "prepare",
        args = {Connection.class, Integer.class}
    )
})
public class SlowSqlPlugin implements Interceptor {

    @Override
    public Object intercept(Invocation invocation) throws Throwable {
        long start = System.currentTimeMillis();
        Object result = invocation.proceed();  // 执行原始逻辑
        long elapsed = System.currentTimeMillis() - start;

        if (elapsed > 500) {  // 超过 500ms 视为慢 SQL
            StatementHandler handler = (StatementHandler) invocation.getTarget();
            BoundSql boundSql = handler.getBoundSql();
            log.warn("慢SQL警告 [{}ms]: {}", elapsed, boundSql.getSql());
        }
        return result;
    }
}
```

### 1.2 四个拦截点

![mybatis-interceptor-chain](/java/mybatis-interceptor-chain.svg)

| 拦截对象 | 典型场景 | 示例 |
| :-- | :-- | :-- |
| **Executor** | 二级缓存实现、拦截 update/query | 自定义缓存策略 |
| **ParameterHandler** | 参数加密、类型转换 | 手机号脱敏 |
| **StatementHandler** | SQL 改写、分页、慢 SQL 监控 | **PageHelper 分页插件** |
| **ResultSetHandler** | 结果集后处理、字段解密 | 敏感字段解密 |

### 1.3 插件的底层实现

MyBatis 在初始化时，会对被拦截的对象进行**层层代理包装**：

```java
// Configuration 中的 pluginAll 方法
public void pluginAll(Object target) {
    for (Interceptor interceptor : interceptors) {
        target = interceptor.plugin(target);
        // 实际调用 Plugin.wrap(target, interceptor)
    }
    return target;
}

// Plugin.wrap 核心逻辑
public static Object wrap(Object target, Interceptor interceptor) {
    Map<Class<?>, Set<Method>> signatureMap = getSignatureMap(interceptor);
    Class<?> type = target.getClass();
    Class<?>[] interfaces = getAllInterfaces(type, signatureMap);
    if (interfaces.length > 0) {
        // 创建 JDK 动态代理
        return Proxy.newProxyInstance(
            type.getClassLoader(),
            interfaces,
            new Plugin(target, interceptor, signatureMap)
        );
    }
    return target;
}
```

如果配置了多个插件，它们会形成嵌套代理——最外层的插件最先被调用，形成责任链。

### 1.4 实战：分页插件 PageHelper

PageHelper 是常用的 MyBatis 分页插件。不同版本会拦截 MyBatis 执行链中的不同位置，并根据数据库方言生成 COUNT 与分页语句；以下以常见配置为例，使用前应核对目标版本文档：

```java
// 使用方式
PageHelper.startPage(1, 10);  // 第 1 页，每页 10 条
List<User> users = userMapper.selectAll();
// 实际执行的 SQL：SELECT * FROM users LIMIT 10 OFFSET 0

// 常见流程（具体拦截点与方言生成方式取决于版本）：
// 1. 拦截下一条 Mapper 查询
// 2. 读取原始 SQL 并按数据库方言改写
// 3. 生成分页 SQL 和 COUNT 查询
// 4. 默认执行 COUNT 并缓存 Page 对象的 total，可通过参数关闭
```

## 2. 动态 SQL

### 2.1 为什么需要动态 SQL

实际业务中，查询条件往往不固定。用户可能按姓名搜索，也可能按状态筛选，或者同时按多个条件组合查询。如果为每种组合写一条 SQL，组合爆炸会导致维护灾难。

MyBatis 的动态 SQL 通过 XML 标签，根据运行时参数动态拼装 SQL 片段。

### 2.2 核心标签详解

```xml
<select id="findUsers" resultType="User">
    SELECT * FROM users
    <where>
        <if test="name != null and name != ''">
            AND name LIKE CONCAT('%', #{name}, '%')
        </if>
        <if test="status != null">
            AND status = #{status}
        </if>
        <if test="minAge != null">
            AND age >= #{minAge}
        </if>
        <if test="maxAge != null">
            AND age <= #{maxAge}
        </if>
    </where>
    ORDER BY id DESC
</select>
```

`<where>` 标签的智能之处：它会自动去除多余的 `AND`/`OR` 前缀，且如果内部所有条件都不满足，则不会生成 `WHERE` 子句。

**各标签速查：**

| 标签 | 作用 | 关键行为 |
| :-- | :-- | :-- |
| `<if>` | 条件判断 | `test` 属性使用 OGNL 表达式 |
| `<choose>/<when>/<otherwise>` | 多选一（类似 switch） | 只执行第一个匹配的分支 |
| `<where>` | 智能 WHERE | 自动去除多余 AND/OR |
| `<set>` | 智能 SET（UPDATE 用） | 自动去除多余逗号 |
| `<foreach>` | 遍历集合 | 常用于 IN 查询和批量插入 |
| `<trim>` | 自定义前缀/后缀处理 | where/set 的底层实现 |
| `<sql>/<include>` | SQL 片段复用 | 类似代码中的方法提取 |

### 2.3 choose/when：互斥条件

当多个条件互斥时（如排序策略只能选一种），使用 `choose`：

```xml
<select id="findUsers" resultType="User">
    SELECT * FROM users
    <where>
        <if test="keyword != null">
            AND (name LIKE #{keyword} OR email LIKE #{keyword})
        </if>
    </where>
    <choose>
        <when test="orderBy == 'name'">ORDER BY name ASC</when>
        <when test="orderBy == 'age'">ORDER BY age DESC</when>
        <otherwise>ORDER BY id DESC</otherwise>
    </choose>
</select>
```

### 2.4 foreach：集合遍历

`foreach` 是处理 `IN` 查询和批量操作的利器：

```xml
<!-- IN 查询 -->
<select id="findByIds" resultType="User">
    SELECT * FROM users WHERE id IN
    <foreach collection="ids" item="id" open="(" separator="," close=")">
        #{id}
    </foreach>
</select>
<!-- 生成：SELECT * FROM users WHERE id IN (1, 2, 3) -->

<!-- 批量插入 -->
<insert id="batchInsert">
    INSERT INTO users (name, email) VALUES
    <foreach collection="list" item="user" separator=",">
        (#{user.name}, #{user.email})
    </foreach>
</insert>
<!-- 生成：INSERT INTO users (name, email) VALUES ('Tom', 'tom@x.com'), ('Jerry', 'jerry@x.com') -->
```

### 2.5 动态 SQL 的本质

MyBatis 的动态 SQL 并非简单的字符串拼接。它使用 **OGNL 表达式引擎** 解析 `test` 条件，通过 `SqlNode` 树形结构组织 SQL 片段，最终由 `DynamicSqlSource` 在运行时生成最终的 `BoundSql`。

![mybatis-xml-to-runtime](/java/mybatis-xml-to-runtime.svg)

每个 XML 标签被解析为对应的 `SqlNode` 实现（`IfSqlNode`、`ForEachSqlNode`、`WhereSqlNode` 等），运行时根据参数值决定是否输出该节点的内容。

### 2.6 实战：复杂条件查询

一个贴近真实业务的例子——电商订单搜索：

```xml
<select id="searchOrders" resultType="OrderVO">
    SELECT o.id, o.order_no, o.total_amount, o.status,
           u.name AS user_name, u.phone
    FROM orders o
    LEFT JOIN users u ON o.user_id = u.id
    <where>
        <if test="orderNo != null">
            AND o.order_no = #{orderNo}
        </if>
        <if test="statusList != null and statusList.size > 0">
            AND o.status IN
            <foreach collection="statusList" item="s" open="(" separator="," close=")">
                #{s}
            </foreach>
        </if>
        <if test="startDate != null">
            AND o.create_time >= #{startDate}
        </if>
        <if test="endDate != null">
            AND o.create_time &lt;= #{endDate}
        </if>
        <if test="minAmount != null">
            AND o.total_amount >= #{minAmount}
        </if>
        <if test="keyword != null and keyword != ''">
            AND (u.name LIKE CONCAT('%', #{keyword}, '%')
                 OR u.phone LIKE CONCAT('%', #{keyword}, '%'))
        </if>
    </where>
    ORDER BY o.create_time DESC
</select>
```

这段 SQL 可以根据传入参数的不同组合，动态生成不同的查询——只传 `statusList` 就按状态筛选，加上 `startDate` 就加时间范围，再加 `keyword` 就支持模糊搜索。一个 XML 抵得上几十条硬编码 SQL。

## 3. 本页小结

| 要点 | 核心结论 |
| :-- | :-- |
| MyBatis 定位 | SQL 映射框架，不是 ORM。SQL 由开发者掌控 |
| 核心机制 | Mapper 接口 → JDK 动态代理 → SqlSession → Executor → JDBC |
| 一级缓存 | SqlSession 级别，Spring 整合后不可依赖 |
| 二级缓存 | Mapper 级别，跨 SqlSession，需手动开启 |
| 插件机制 | 责任链模式，四个拦截点，分页/监控/加密的基础设施 |
| 动态 SQL | OGNL + SqlNode 树，一个 XML 适配多种查询条件 |
