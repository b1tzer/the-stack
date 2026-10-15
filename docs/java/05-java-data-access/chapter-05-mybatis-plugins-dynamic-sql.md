# MyBatis：插件机制与动态 SQL

> 本页与 [MyBatis：SQL 映射框架](./chapter-04-mybatis.md) 配套，重点说明插件拦截链、分页插件和动态 SQL 的运行方式。

## 1. 插件机制

### 1.1 拦截器模型

MyBatis 的插件机制基于**责任链模式**，允许插件拦截四类核心组件的特定方法，在 SQL 执行链中插入自定义逻辑。

```java
@Intercepts({
    @Signature(
        type = StatementHandler.class,
        method = "prepare",
        args = {Connection.class, Integer.class}
    )
})
public class StatementPreparePlugin implements Interceptor {

    @Override
    public Object intercept(Invocation invocation) throws Throwable {
        long start = System.currentTimeMillis();
        Object result = invocation.proceed();  // 执行原始逻辑
        long elapsed = System.currentTimeMillis() - start;
        // 该示例仅记录正常返回的调用，异常路径不输出耗时日志
        if (elapsed > 500) {  // 示例阈值 500ms；此处统计的是 Statement 准备阶段耗时，不等同于 SQL 查询的执行耗时
            StatementHandler handler = (StatementHandler) invocation.getTarget();
            BoundSql boundSql = handler.getBoundSql();
            log.warn("Statement 准备耗时较长 [{}ms]: {}", elapsed, boundSql.getSql());
        }
        return result;
    }
}
```

### 1.2 四个拦截点

![mybatis-interceptor-chain](/java/mybatis-interceptor-chain.svg)

| 拦截对象 | 典型场景 | 示例 |
| :-- | :-- | :-- |
| **Executor** | query/update 调用拦截、执行层审计、缓存行为扩展、分页处理 | **PageHelper 分页插件**、Mapper 调用耗时统计 |
| **ParameterHandler** | 参数绑定前后的转换、加密等处理 | 将敏感参数转为数据库要求的加密值 |
| **StatementHandler** | Statement 创建与准备、SQL 改写、执行前处理 | Statement 准备耗时监控 |
| **ResultSetHandler** | 结果集后处理、字段解密 | 敏感字段解密 |

### 1.3 插件的底层实现

MyBatis 在初始化时，会对匹配拦截签名的目标对象进行**代理包装**。以下摘录展示核心逻辑，省略了类定义、字段声明和辅助方法：

```java
// InterceptorChain 中的 pluginAll 方法
public Object pluginAll(Object target) {
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

如果配置了多个插件，pluginAll 会依次将目标对象交给各拦截器包装，形成嵌套代理；后包装的代理位于外层，调用时先进入外层插件，再沿代理链向内执行。具体拦截哪些方法，还取决于各插件声明的 @Signature 是否匹配。

### 1.4 实战：分页插件 PageHelper

PageHelper 是常用的 MyBatis 分页插件。其常见实现通过 `PageInterceptor` 拦截 `Executor.query`，根据分页上下文、原始 SQL 与数据库方言自动生成分页语句和总数统计；具体行为以项目所用的 PageHelper 版本为准：

```java
// 使用方式
PageHelper.startPage(1, 10);  // 第 1 页，每页 10 条
List<User> users = userMapper.selectAll();
// 示例：MySQL 方言下可能生成 SELECT * FROM users LIMIT 10 OFFSET 0；具体 SQL 取决于数据库方言与版本

// 常见流程（具体拦截点与方言生成方式取决于版本）：
// 1. 拦截紧跟其后的 Mapper 查询（Executor.query）
// 2. 读取原始 SQL 并按数据库方言改写
// 3. 生成分页 SQL 和 COUNT 查询
// 4. 是否统计总数、如何缓存 total 取决于具体 API 与配置，以所用 PageHelper 版本为准
// 注意：分页上下文通常与线程绑定，startPage(...) 应紧邻目标 Mapper 查询，避免中间插入其他查询
```

## 2. 动态 SQL

### 2.1 为什么需要动态 SQL

实际业务中，查询条件往往不固定。用户可能按姓名搜索，也可能按状态筛选，或者同时按多个条件组合查询。如果为每种组合写一条 SQL，条件增多后会产生大量重复的维护工作。

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

`<where>` 在有条件片段时添加 `WHERE`，并去除开头多余的 `AND` 或 `OR`；如果内部所有条件都不满足，则不生成 `WHERE` 子句。

**各标签速查：**

| 标签 | 作用 | 关键行为 |
| :-- | :-- | :-- |
| `<if>` | 条件判断 | `test` 属性使用 OGNL 表达式 |
| `<choose>/<when>/<otherwise>` | 多选一（类似 switch） | 只执行第一个匹配的分支 |
| `<where>` | 条件拼接与前缀修剪 | 自动去除多余 AND/OR |
| `<set>` | 更新赋值与逗号修剪（UPDATE 用） | 自动去除多余逗号 |
| `<foreach>` | 遍历集合 | 常用于 IN 查询和批量插入 |
| `<trim>` | 自定义前缀/后缀及覆盖规则 | `<where>`/`<set>` 基于此修剪逻辑实现 |
| `<bind>` | 基于 OGNL 创建上下文变量 | 常见用途是为模糊查询构造带通配符的参数 |
| `<sql>/<include>` | SQL 片段复用（解析期） | 在映射文件中复用片段，不属于运行时动态条件判断 |

### 2.3 choose/when：互斥条件

当多个条件互斥时（如排序策略只能选一种），使用 `choose`：

```xml
<select id="findUsers" resultType="User">
    SELECT * FROM users
    <where>
        <if test="keyword != null and keyword != ''">
            <bind name="pattern" value="'%' + keyword + '%'" />
            AND (name LIKE #{pattern} OR email LIKE #{pattern})
        </if>
    </where>
    <choose>
        <when test="orderBy == 'name'">ORDER BY name ASC</when>
        <when test="orderBy == 'age'">ORDER BY age DESC</when>
        <otherwise>ORDER BY id DESC</otherwise>
    </choose>
</select>
```

注意：`LIKE #{keyword}` 不会自动添加通配符，包含匹配需要调用方传入 `%tom%` 之类的参数，或用 `<bind>` 生成带通配符的变量。另外，列名和排序方向不是普通绑定参数，不能用 `#{orderBy}` 替代 SQL 标识符；上面的 `<choose>` 通过白名单选择预定义排序片段，避免把不可信输入直接交给 `${...}`。

### 2.4 foreach：集合遍历

`<foreach>` 可以遍历集合并为每个元素生成对应的 SQL 片段，常用于 `IN` 条件和多行插入：

```xml
<!-- IN 查询 -->
<select id="findByIds" resultType="User">
    SELECT * FROM users WHERE id IN
    <foreach collection="ids" item="id" open="(" separator="," close=")">
        #{id}
    </foreach>
</select>
<!-- SQL 结构示意：SELECT * FROM users WHERE id IN (?, ?, ?)，实际值通过 JDBC 参数绑定传入 -->

<!-- 批量插入 -->
<insert id="batchInsert">
    INSERT INTO users (name, email) VALUES
    <foreach collection="list" item="user" separator=",">
        (#{user.name}, #{user.email})
    </foreach>
</insert>
<!-- SQL 结构示意：INSERT INTO users (name, email) VALUES (?, ?), (?, ?)，实际值通过 JDBC 参数绑定传入 -->
```

### 2.5 动态 SQL 的本质

MyBatis 的动态 SQL 并非简单的字符串拼接。对于包含运行时动态节点的映射语句，MyBatis 将其中的动态元素解析为 `SqlNode` 组合，通过 **OGNL 表达式引擎** 解析 `test` 条件，在执行时根据参数计算条件并生成 SQL，最终得到包含 SQL 文本与参数映射的 `BoundSql`。不包含运行时动态文本或动态节点的 SQL 通常走 `RawSqlSource` 路径；包含 `${...}` 文本替换或动态 SQL 节点的语句通常由 `DynamicSqlSource` 在执行时构建 `BoundSql`，因此不能用「不带动态 XML 标签」直接判断它一定是静态 SQL。`${...}` 做文本替换，不能将不可信输入直接作为 SQL 片段插入。

![mybatis-xml-to-runtime](/java/mybatis-xml-to-runtime.svg)

`<if>`、`<choose>`、`<foreach>`、`<where>` 等动态 SQL 元素会被解析为相应的 `SqlNode` 实现（`IfSqlNode`、`ForEachSqlNode`、`WhereSqlNode` 等），运行时根据参数值决定是否输出该节点的内容。`<select>`、`<resultMap>`、`<sql>/<include>` 等并非运行时动态 SQL 节点。

### 2.6 实战：复杂条件查询

下面以订单搜索为例，组合使用关联查询、可选条件、集合筛选与时间范围：

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

这段 SQL 可以根据传入参数的不同组合，动态生成不同的查询——只传 `statusList` 就按状态筛选，加上 `startDate` 就加时间范围，再加 `keyword` 就支持模糊搜索。一个映射语句即可覆盖多种条件组合，减少重复 SQL。

注意若干边界：`statusList` 为空集合时已被 `statusList.size > 0` 排除，不会生成无效 `IN` 条件；若 `endDate` 表示用户选中的某一天（零点），`<= #{endDate}` 会排除当天后续记录，按日期筛选时通常改用左闭右开区间 `create_time < #{endExclusive}`；两侧 `%` 的包含匹配难以利用普通 B-tree 索引，数据量大时应结合实际库评估；分页场景建议加唯一键次级排序，如 `ORDER BY o.create_time DESC, o.id DESC`，保证同时间记录次序稳定。

## 3. 本页小结

| 要点 | 核心结论 |
| :-- | :-- |
| 插件机制 | 责任链模式，拦截指定接口的特定方法；实际效果取决于拦截签名与代理顺序 |
| 分页插件 | PageHelper 按配置与数据库方言处理分页；行为以所用版本为准 |
| 动态 SQL | 动态节点按参数生成 SQL，`BoundSql` 含最终 SQL 与参数映射；`<sql>/<include>` 属片段复用 |
| 使用边界 | 处理空集合与日期范围，使用绑定参数和排序白名单；分页查询应保证排序稳定 |
