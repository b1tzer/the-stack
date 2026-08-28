---
doc_id: pg-multi-tenant
title: 多租户架构设计
---

# 多租户架构设计

> **核心问题**：一个 SaaS 系统要服务多个租户（企业/团队），如何在数据库层面实现数据隔离？三种方案各有何优劣？如何在 Spring Boot 中优雅地切换租户上下文？

## 1. 三种方案对比

| 维度 | 独立数据库 | Schema 隔离 | 行级安全 (RLS) |
|------|-----------|------------|---------------|
| 隔离级别 | 最高（物理隔离） | 中等（逻辑隔离） | 最低（行级过滤） |
| 运维成本 | 高（每个租户一套库） | 中等（共享库，多 Schema） | 低（单库单表） |
| 租户数量 | < 50 | 50-5000 | > 5000 |
| 备份恢复 | 可单独备份 | 可按 Schema 导出 | 需按条件导出 |
| 连接池压力 | 高（每库独立连接） | 中等 | 低 |
| 跨租户查询 | 困难 | 简单 | 简单 |
| Schema 迁移 | 需逐库执行 | 需逐 Schema 执行 | 一次搞定 |
| 典型场景 | 金融、政企 | 企业级 SaaS | 中小型 SaaS、多租户 API |

> **选型建议**：大多数 Java 项目选 **Schema 隔离** —— 隔离性够用，运维可控，是性价比最高的方案。金融级场景选独立数据库；海量小租户选 RLS。

## 2. Schema 隔离实现

### 2.1 设计思路

每个租户一个 PostgreSQL Schema，共享同一个数据库实例：

```
ecommerce_db
├── public          -- 公共表（租户注册、系统配置）
├── tenant_001      -- 租户 A 的所有业务表
│   ├── t_order
│   ├── t_product
│   └── t_user
├── tenant_002      -- 租户 B 的所有业务表
│   ├── t_order
│   ├── t_product
│   └── t_user
└── template_schema -- 模板 Schema（新租户创建时复制）
    ├── t_order
    ├── t_product
    └── t_user
```

### 2.2 模板 Schema 建表

```sql
-- 创建模板 Schema
CREATE SCHEMA IF NOT EXISTS template_schema;

-- 在模板中创建所有业务表
CREATE TABLE template_schema.t_order (
    order_id     BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id      BIGINT         NOT NULL,
    order_no     VARCHAR(32)    NOT NULL UNIQUE,
    total_amount NUMERIC(14, 2) NOT NULL,
    status       SMALLINT       NOT NULL DEFAULT 0,
    created_at   TIMESTAMPTZ    NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ    NOT NULL DEFAULT now()
);

CREATE TABLE template_schema.t_product (
    product_id   BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name         VARCHAR(256)   NOT NULL,
    price        NUMERIC(12, 2) NOT NULL,
    stock        INT            NOT NULL DEFAULT 0,
    attributes   JSONB          NOT NULL DEFAULT '{}',
    created_at   TIMESTAMPTZ    NOT NULL DEFAULT now()
);

CREATE TABLE template_schema.t_user (
    user_id    BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    username   VARCHAR(64)  NOT NULL UNIQUE,
    email      VARCHAR(128),
    status     SMALLINT     NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- 公共 Schema 中的租户注册表
CREATE TABLE public.t_tenant (
    tenant_id   BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_code VARCHAR(32)  NOT NULL UNIQUE,  -- 如 "acme_corp"
    tenant_name VARCHAR(128) NOT NULL,
    schema_name VARCHAR(64)  NOT NULL UNIQUE,  -- 如 "tenant_001"
    status      SMALLINT     NOT NULL DEFAULT 1,
    plan        VARCHAR(32)  NOT NULL DEFAULT 'free',  -- free/pro/enterprise
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);
```

### 2.3 新租户创建（自动复制 Schema）

```sql
-- 存储过程：为新租户创建 Schema
CREATE OR REPLACE FUNCTION create_tenant_schema(
    p_tenant_code VARCHAR,
    p_tenant_name VARCHAR
) RETURNS VARCHAR AS $$
DECLARE
    v_schema_name VARCHAR;
    v_table_name  VARCHAR;
BEGIN
    -- 生成 Schema 名称
    v_schema_name := 'tenant_' || p_tenant_code;

    -- 创建 Schema
    EXECUTE format('CREATE SCHEMA %I', v_schema_name);

    -- 从模板复制所有表结构
    FOR v_table_name IN
        SELECT tablename FROM pg_tables WHERE schemaname = 'template_schema'
    LOOP
        EXECUTE format(
            'CREATE TABLE %I.%I (LIKE template_schema.%I INCLUDING ALL)',
            v_schema_name, v_table_name, v_table_name
        );
    END LOOP;

    -- 注册租户
    INSERT INTO public.t_tenant (tenant_code, tenant_name, schema_name)
    VALUES (p_tenant_code, p_tenant_name, v_schema_name);

    RETURN v_schema_name;
END;
$$ LANGUAGE plpgsql;

-- 使用
SELECT create_tenant_schema('acme', 'Acme Corporation');
-- 自动创建 tenant_acme Schema，并复制所有模板表
```

### 2.4 表空间与权限（可选）

```sql
-- 为租户 Schema 授权（如果有多租户管理员角色）
GRANT USAGE ON SCHEMA tenant_acme TO tenant_acme_role;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA tenant_acme TO tenant_acme_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA tenant_acme
    GRANT ALL PRIVILEGES ON TABLES TO tenant_acme_role;
```

## 3. 行级安全（RLS）实现

### 3.1 设计思路

单库单表，通过 RLS 策略自动过滤每个租户只能看到自己的数据：

```sql
-- 启用 RLS 的表结构
CREATE TABLE t_order (
    order_id     BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id    BIGINT         NOT NULL,  -- 租户标识
    user_id      BIGINT         NOT NULL,
    order_no     VARCHAR(32)    NOT NULL,
    total_amount NUMERIC(14, 2) NOT NULL,
    status       SMALLINT       NOT NULL DEFAULT 0,
    created_at   TIMESTAMPTZ    NOT NULL DEFAULT now()
);

-- 全局唯一约束需包含 tenant_id
CREATE UNIQUE INDEX idx_order_no_tenant ON t_order(tenant_id, order_no);
CREATE INDEX idx_order_tenant_user ON t_order(tenant_id, user_id);
```

### 3.2 启用 RLS 策略

```sql
-- Step 1：启用行级安全
ALTER TABLE t_order ENABLE ROW LEVEL SECURITY;

-- Step 2：强制所有非超级用户都遵守 RLS（包括表的 owner）
ALTER TABLE t_order FORCE ROW LEVEL SECURITY;

-- Step 3：创建策略 —— 通过 session 变量匹配 tenant_id
CREATE POLICY tenant_isolation ON t_order
    USING (tenant_id = current_setting('app.current_tenant_id')::BIGINT)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::BIGINT);
```

> **`USING` vs `WITH CHECK`**：`USING` 控制 SELECT/UPDATE/DELETE 的可见行；`WITH CHECK` 控制 INSERT/UPDATE 的写入行。两者配合确保数据不会跨租户泄漏。

### 3.3 应用层设置租户上下文

```sql
-- 每个请求开始时设置
SET app.current_tenant_id = '42';

-- 之后的所有查询自动过滤
SELECT * FROM t_order;  -- 只返回 tenant_id = 42 的行
INSERT INTO t_order (tenant_id, user_id, order_no, total_amount)
    VALUES (99, 1, 'ORD001', 100.00);
    -- 如果 tenant_id != 42，INSERT 会被 RLS 拦截并报错
```

### 3.4 为所有业务表批量启用 RLS

```sql
-- 生成所有表的 RLS 策略
DO $$
DECLARE
    v_table TEXT;
    v_tables TEXT[] := ARRAY['t_order', 't_product', 't_user', 't_payment'];
BEGIN
    FOREACH v_table IN ARRAY v_tables
    LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', v_table);
        EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', v_table);
        EXECUTE format(
            'CREATE POLICY tenant_isolation ON %I
             USING (tenant_id = current_setting(''app.current_tenant_id'')::BIGINT)
             WITH CHECK (tenant_id = current_setting(''app.current_tenant_id'')::BIGINT)',
            v_table
        );
    END LOOP;
END $$;
```

## 4. RLS 高级策略设计

### 4.1 基于角色的 RLS（租户内权限）

```sql
-- 租户内的角色表
CREATE TABLE t_user_role (
    user_id    BIGINT NOT NULL,
    tenant_id  BIGINT NOT NULL,
    role       VARCHAR(32) NOT NULL,  -- admin / manager / viewer
    PRIMARY KEY (user_id, tenant_id)
);

-- 仅允许 admin 删除订单
CREATE POLICY order_delete_policy ON t_order
    FOR DELETE
    USING (
        tenant_id = current_setting('app.current_tenant_id')::BIGINT
        AND EXISTS (
            SELECT 1 FROM t_user_role
            WHERE user_id = current_setting('app.current_user_id')::BIGINT
              AND tenant_id = current_setting('app.current_tenant_id')::BIGINT
              AND role = 'admin'
        )
    );
```

### 4.2 按计划限制（免费版租户限制行数）

```sql
-- 免费版租户最多 1000 个产品
CREATE POLICY product_limit ON t_product
    FOR INSERT
    WITH CHECK (
        tenant_id = current_setting('app.current_tenant_id')::BIGINT
        AND (
            SELECT plan FROM t_tenant
            WHERE tenant_id = current_setting('app.current_tenant_id')::BIGINT
        ) = 'enterprise'
        OR (
            SELECT COUNT(*) FROM t_product
            WHERE tenant_id = current_setting('app.current_tenant_id')::BIGINT
        ) < 1000
    );
```

### 4.3 超级管理员绕过 RLS

```sql
-- 超级管理员角色可以绕过 RLS
ALTER TABLE t_order ENABLE ROW LEVEL SECURITY;
-- 注意：表的 owner 默认绕过 RLS，除非使用 FORCE

-- 创建只读的超级管理员（用于监控/审计）
CREATE ROLE super_admin BYPASSRLS;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO super_admin;
```

## 5. 性能对比与选型建议

### 5.1 性能测试对比

以 1000 万行订单表、100 个租户为例：

| 指标 | Schema 隔离 | RLS |
|------|------------|-----|
| 单租户查询 | ~2ms（独立表，索引小） | ~5ms（全表 + RLS 过滤） |
| 批量写入 | ~5000 TPS | ~8000 TPS（单表，无跨 Schema 开销） |
| 连接数 | 较多（需 `SET search_path`） | 较少 |
| 索引大小 | 每租户独立索引（小而快） | 全局索引（大，B-tree 更深） |
| 备份时间 | 可按 Schema 并行 | 只能整库备份 |

### 5.2 选型决策树

```
租户数量 < 50 且对数据安全要求极高？
    └─ 是 → 独立数据库

租户数量 50-5000？
    └─ 是 → Schema 隔离（推荐）

租户数量 > 5000 或需要跨租户聚合分析？
    └─ 是 → 行级安全 (RLS)

不确定？
    └─ Schema 隔离（最灵活，后续可迁移到独立库）
```

## 6. Spring Boot 集成方案

### 6.1 Schema 隔离：动态 Schema 切换

```java
/**
 * 租户上下文：ThreadLocal 存储当前租户的 Schema 名
 */
public class TenantContext {
    private static final ThreadLocal<String> SCHEMA = new ThreadLocal<>();

    public static void setSchema(String schema) { SCHEMA.set(schema); }
    public static String getSchema() { return SCHEMA.get(); }
    public static void clear() { SCHEMA.remove(); }
}

/**
 * Hibernate 拦截器：在 SQL 执行前切换 Schema
 */
@Component
public class TenantSchemaInterceptor implements HandlerInterceptor {

    @Override
    public boolean preHandle(HttpServletRequest req, HttpServletResponse resp,
                             Object handler) {
        // 从 Header / JWT / 子域名中提取租户标识
        String tenantCode = resolveTenantCode(req);
        String schema = "tenant_" + tenantCode;

        // 验证 Schema 存在
        if (!isValidSchema(schema)) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "无效的租户");
        }

        TenantContext.setSchema(schema);
        return true;
    }

    @Override
    public void afterCompletion(HttpServletRequest req, HttpServletResponse resp,
                                Object handler, Exception ex) {
        TenantContext.clear();
    }

    private String resolveTenantCode(HttpServletRequest req) {
        // 方案 A：从子域名提取（acme.example.com → acme）
        String host = req.getServerName();
        return host.split("\\.")[0];

        // 方案 B：从 JWT 提取
        // return jwtUtil.getClaim(req.getHeader("Authorization"), "tenant_code");
    }
}

/**
 * Hibernate Schema 切换配置
 */
@Configuration
public class HibernateConfig {

    @Bean
    public HibernatePropertiesCustomizer hibernateCustomizer() {
        return properties -> {
            properties.put(AvailableSettings.MULTI_TENANT, MultiTenancyStrategy.SCHEMA);
            properties.put(AvailableSettings.MULTI_TENANT_IDENTIFIER_RESOLVER,
                new CurrentTenantIdentifierResolver() {
                    @Override
                    public String resolveCurrentTenantIdentifier() {
                        String schema = TenantContext.getSchema();
                        return schema != null ? schema : "public";
                    }

                    @Override
                    public boolean validateExistingCurrentSessions() {
                        return false;
                    }
                });
            properties.put(AvailableSettings.MULTI_TENANT_CONNECTION_PROVIDER,
                new SchemaMultiTenantConnectionProvider());
        };
    }
}

/**
 * 连接提供者：根据 Schema 名切换 search_path
 */
public class SchemaMultiTenantConnectionProvider implements MultiTenantConnectionProvider {

    @Autowired
    private DataSource dataSource;

    @Override
    public Connection getAnyConnection() throws SQLException {
        return dataSource.getConnection();
    }

    @Override
    public Connection getConnection(String tenantIdentifier) throws SQLException {
        Connection conn = dataSource.getConnection();
        // 核心：通过 SET search_path 切换 Schema
        conn.createStatement().execute(
            "SET search_path TO " + tenantIdentifier + ", public"
        );
        return conn;
    }

    @Override
    public void releaseConnection(String tenantIdentifier, Connection conn) {
        try {
            conn.createStatement().execute("SET search_path TO public");
        } catch (SQLException e) {
            // log error
        }
        try { conn.close(); } catch (SQLException e) { /* ignore */ }
    }

    @Override
    public boolean supportsAggressiveRelease() { return false; }
}
```

### 6.2 RLS 方案：请求级设置 session 变量

```java
/**
 * RLS 模式下的拦截器：设置 PostgreSQL session 变量
 */
@Component
public class TenantRlsInterceptor implements HandlerInterceptor {

    @Autowired
    private DataSource dataSource;

    @Override
    public boolean preHandle(HttpServletRequest req, HttpServletResponse resp,
                             Object handler) throws SQLException {
        Long tenantId = resolveTenantId(req);

        // 在连接上设置 session 变量（PgBouncer transaction 模式下用 SET LOCAL）
        Connection conn = DataSourceUtils.getConnection(dataSource);
        conn.createStatement().execute(
            "SET app.current_tenant_id = '" + tenantId + "'"
        );

        return true;
    }
}

// 使用 JdbcTemplate 时的替代方案：每个查询前设置
@Repository
public class OrderRepository {

    @Autowired
    private JdbcTemplate jdbc;

    public List<Order> findAll() {
        // RLS 自动过滤，无需 WHERE tenant_id = ?
        return jdbc.query("SELECT * FROM t_order ORDER BY created_at DESC",
            new BeanPropertyRowMapper<>(Order.class));
    }
}
```

## 7. 迁移策略（Flyway + 多 Schema）

### 7.1 Flyway 多 Schema 迁移配置

```yaml
# application.yml
spring:
  flyway:
    enabled: true
    # 公共 Schema 迁移
    schemas: public
    locations: classpath:db/migration/public
    baseline-on-migrate: true
```

### 7.2 租户 Schema 迁移脚本

```java
/**
 * 租户 Schema 迁移器：为所有租户执行 Flyway 迁移
 */
@Component
public class TenantFlywayMigrator {

    @Autowired
    private DataSource dataSource;

    @Autowired
    private JdbcTemplate jdbcTemplate;

    /**
     * 为所有租户执行迁移
     */
    public void migrateAllTenants() {
        List<String> schemas = jdbcTemplate.queryForList(
            "SELECT schema_name FROM t_tenant WHERE status = 1",
            String.class
        );

        for (String schema : schemas) {
            migrateTenant(schema);
        }
    }

    /**
     * 为单个租户执行迁移
     */
    public void migrateTenant(String schema) {
        Flyway flyway = Flyway.configure()
            .dataSource(dataSource)
            .schemas(schema)                     // 目标 Schema
            .locations("classpath:db/migration/tenant")  // 租户迁移脚本
            .baselineOnMigrate(true)
            .outOfOrder(false)
            .load();
        flyway.migrate();
    }

    /**
     * 创建新租户并迁移
     */
    @Transactional
    public void createAndMigrateTenant(String tenantCode, String tenantName) {
        // 1. 创建 Schema 和表
        jdbcTemplate.queryForObject(
            "SELECT create_tenant_schema(?, ?)",
            String.class, tenantCode, tenantName
        );

        // 2. 执行迁移（确保与最新版本一致）
        migrateTenant("tenant_" + tenantCode);
    }
}
```

### 7.3 迁移脚本目录结构

```
src/main/resources/db/migration/
├── public/                      # 公共 Schema 迁移
│   ├── V1__create_tenant_table.sql
│   ├── V2__create_tenant_func.sql
│   └── V3__add_tenant_plan.sql
└── tenant/                      # 租户 Schema 迁移
    ├── V1__create_order_table.sql
    ├── V2__create_product_table.sql
    ├── V3__add_product_attributes_json.sql
    └── V4__add_order_index.sql
```

```sql
-- db/migration/tenant/V3__add_product_attributes_json.sql
ALTER TABLE t_product ADD COLUMN IF NOT EXISTS attributes JSONB DEFAULT '{}';
CREATE INDEX IF NOT EXISTS idx_product_attr ON t_product USING GIN (attributes);
```

## 8. 真实案例对比

### 案例 A：某 CRM SaaS（Schema 隔离）

- **租户数**：约 800 家企业
- **方案**：Schema 隔离 + Hibernate 多租户
- **迁移**：Flyway 逐 Schema 执行，耗时约 30 分钟（并行 8 线程）
- **教训**：`pg_dump` 按 Schema 导出时，大租户（10GB+）会拖慢整体备份。后来改为每个租户独立备份调度。

```sql
-- 备份单个租户
pg_dump -n tenant_acme ecommerce_db > tenant_acme_backup.sql

-- 恢复
psql -d ecommerce_db -c "CREATE SCHEMA IF NOT EXISTS tenant_acme;"
psql -d ecommerce_db -n tenant_acme < tenant_acme_backup.sql
```

### 案例 B：某多租户 API 平台（RLS）

- **租户数**：约 12000 个
- **方案**：RLS + 应用层 session 变量
- **性能调优**：为 `tenant_id` 创建 BRIN 索引（时序数据场景），配合分区表
- **教训**：早期未使用 `FORCE ROW LEVEL SECURITY`，表 owner（超级用户角色）绕过了 RLS，导致一次数据泄漏。

```sql
-- BRIN 索引适合时序数据（按 tenant_id + created_at 物理聚集）
CREATE INDEX idx_order_tenant_brin ON t_order USING BRIN (tenant_id, created_at);
```

### 案例 C：某金融系统（独立数据库）

- **租户数**：约 20 家银行
- **方案**：每个银行独立数据库 + 独立主从集群
- **运维**：Ansible 统一管理，每家银行独立备份/恢复
- **教训**：连接池总数爆炸（20 库 × 100 连接 = 2000），后来引入 PgBouncer 统一管理。

## 9. 总结

| 关键决策 | 推荐方案 |
|---------|---------|
| 租户 < 50，高安全 | 独立数据库 |
| 租户 50-5000 | **Schema 隔离**（首选） |
| 租户 > 5000 | RLS |
| Schema 切换 | Hibernate `search_path` |
| 迁移管理 | Flyway 多 Location |
| RLS 会话变量 | 请求拦截器 + `SET` |

多租户设计没有银弹。Schema 隔离是大多数 SaaS 项目的最优解——它在隔离性、运维成本和性能之间取得了最佳平衡。只有当租户数量突破 Schema 管理的上限，或者需要极致的跨租户分析能力时，才需要迁移到 RLS 方案。
