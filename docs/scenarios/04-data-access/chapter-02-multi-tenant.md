# 多租户数据隔离

> 一个 SaaS 系统服务多个租户，租户之间的数据不能互相看见。本章只回答一个问题，三种隔离方案怎么选，以及在应用层怎么把「当前租户」传进每一次查询。

## 1. 三种隔离方案

隔离的本质是给每行数据打上租户标签，差别只在这个标签落在哪一层。三种方案对应三种落点。

| 方案 | 租户标签落在哪 | 隔离强度 | 租户数上限 |
| :-- | :-- | :-- | :-- |
| 独立数据库 | 物理层，每租户一套库 | 最高 | 几十 |
| Schema 隔离 | 逻辑层，每租户一个 Schema | 中 | 几千 |
| 行级安全（RLS） | 行层，单表多租户混存 | 最低 | 上万 |

独立数据库给每个租户一套物理库，隔离最彻底，代价是运维最重，几十套库的备份、迁移、连接池都是独立成本。Schema 隔离共享一个库，用 Schema 把租户隔开，隔离性够用、运维可控。RLS 连表都共享，靠策略在行级别过滤，租户数可以撑到很大，但隔离全靠一条策略兜着，策略写漏一行就是跨租户泄漏。

## 2. 选型的关键是租户数量

判断几乎只由租户数量这一个变量驱动。

```txt
租户数 < 50，且对数据安全要求极高？
  └─ 是 → 独立数据库

租户数 50 到 5000？
  └─ 是 → Schema 隔离，多数 SaaS 的落点

租户数 > 5000，或要跨租户聚合分析？
  └─ 是 → 行级安全（RLS）
```

多数 Java 项目的答案是 Schema 隔离。它处在隔离性、运维成本、性能三者平衡的位置。金融政企这类几十个客户、出一次事故就致命的场景上独立库，海量小租户的开放平台才上 RLS。

## 3. 应用层怎么把租户传进去

隔离方案定了之后，应用层只剩一件事，把「当前租户是谁」从请求里解析出来，塞进每一次数据库访问。三种方案在应用层的差异，就在这个「塞」的动作上。

### 3.1 Schema 隔离，切换 search_path

Schema 隔离下，应用层把当前租户的 Schema 名放进连接上下文，SQL 不需要带租户条件，靠 search_path 决定查哪个 Schema。

```java
public class TenantContext {
    private static final ThreadLocal<String> SCHEMA = new ThreadLocal<>();
    public static void setSchema(String s) { SCHEMA.set(s); }
    public static String getSchema()  { return SCHEMA.get(); }
    public static void clear()        { SCHEMA.remove(); }
}
```

拿到连接后设一次 search_path 即可，`SET search_path TO tenant_acme, public`。Hibernate 的 `CurrentTenantIdentifierResolver` 和 `MultiTenantConnectionProvider` 能把这个动作挂到连接建立时机，业务代码无感。

### 3.2 RLS，设置会话变量

RLS 下，应用层把租户 ID 写进会话变量，策略读这个变量做行过滤。SQL 同样不带租户条件，但过滤发生在数据库的策略层，而不是 Schema 层。

```java
conn.createStatement().execute(
    "SET app.current_tenant_id = '" + tenantId + "'"
);
```

这两条路线的共同点在于，都用 `ThreadLocal` 承载租户上下文，都在请求结束时清理，都用连接建立时机把上下文注入数据库。区别只在注入的目标，一个是 search_path，一个是会话变量。

## 4. 一个绕不开的坑，ThreadLocal 不清理

租户上下文用 `ThreadLocal` 存，就必须在请求结束时 `remove`。Tomcat 线程池和数据库连接池都会复用线程，上一个请求的租户标记不清掉，会串到下一个请求，租户 A 的请求读到了租户 B 的 Schema 或会话变量。

清理放在拦截器的 `afterCompletion` 里，和设置配对出现，缺一不可。

## 5. 组件细节

RLS 的策略语法、Schema 的建表与授权、Flyway 多 Schema 迁移这些实现细节，落在 PostgreSQL 专项，本章不复制。

- 行级安全策略见 [用户与安全](../../postgresql/11-ops/chapter-01-user-security) 第 5 节
- Schema 与 search_path 基础见 [第一个数据库](../../postgresql/tutorials/first-db)
- 动态数据源与多数据源配置见 [Spring 多数据源](../../spring/04-data-access/chapter-06-multi-datasource)

## 6. 小结

先按租户数量定方案，再在应用层把租户上下文用 ThreadLocal 传进连接，最后记住清理。隔离方案没有银弹，Schema 隔离是多数 SaaS 的默认落点，只有当租户数突破 Schema 管理上限、或要跨租户聚合时才迁移到 RLS。
