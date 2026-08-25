# 数据库迁移 (Flyway / Liquibase)

> 表结构变更不能靠手动执行 SQL——开发、测试、生产环境的 DDL 必须版本化管理，和代码一起走 CI/CD。数据库迁移工具把 DDL 变更脚本化，保证每个环境按相同顺序执行。Spring Boot 对 Flyway 和 Liquibase 都有自动配置支持。

## 1. 为什么需要数据库迁移

手动管理 DDL 的问题：

| 问题 | 后果 |
| :-- | :-- |
| 环境不一致 | 开发加了字段，测试没加，部署失败 |
| 无法回滚 | 改错了表结构，不知道怎么恢复 |
| 多人协作冲突 | 两个分支都改了表，合并后不知道谁先执行 |
| 审计缺失 | 谁改了什么、什么时候改的，无从追溯 |

## 2. Flyway

Flyway 用纯 SQL 脚本管理迁移，简单直接。

### 2.1 依赖与配置

```xml
<dependency>
    <groupId>org.flywaydb</groupId>
    <artifactId>flyway-core</artifactId>
</dependency>
<dependency>
    <groupId>org.flywaydb</groupId>
    <artifactId>flyway-mysql</artifactId>  <!-- MySQL 方言支持 -->
</dependency>
```

```yaml
spring:
  flyway:
    enabled: true
    locations: classpath:db/migration       # 脚本目录
    baseline-on-migrate: true               # 已有数据库首次迁移基线
    baseline-version: 0                     # 基线版本号
    validate-on-migrate: true               # 迁移前校验脚本一致性
    out-of-order: false                     # 是否允许乱序执行
    clean-disabled: true                    # 生产环境禁止 clean
```

### 2.2 迁移脚本命名

```
db/migration/
├── V1__create_user_table.sql
├── V2__add_email_to_user.sql
├── V3__create_order_table.sql
├── V3.1__add_order_index.sql        ← 小版本插队
└── R__recreate_user_view.sql        ← 可重复执行（Repeatable）
```

命名规则：

```text
V{版本号}__{描述}.sql       ← 版本迁移，只执行一次
R__{描述}.sql               ← 可重复执行，内容变化时重新执行
```

版本号支持数字和小数点：`V1`、`V1.1`、`V2_0`。

### 2.3 迁移脚本示例

```sql
-- V1__create_user_table.sql
CREATE TABLE `user` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `username` VARCHAR(50) NOT NULL,
    `email` VARCHAR(100) NOT NULL,
    `password_hash` VARCHAR(255) NOT NULL,
    `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_username` (`username`),
    UNIQUE KEY `uk_email` (`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

```sql
-- V2__add_phone_to_user.sql
ALTER TABLE `user` ADD COLUMN `phone` VARCHAR(20) DEFAULT NULL AFTER `email`;
CREATE INDEX `idx_phone` ON `user` (`phone`);
```

### 2.4 回调钩子

```sql
-- db/migration/afterMigrate.sql
-- 每次迁移完成后执行
INSERT INTO schema_version_log (version, executed_at, status)
VALUES ('${flyway:version}', NOW(), 'SUCCESS');
```

支持的回调：`beforeMigrate`、`afterMigrate`、`beforeEachMigrate`、`afterEachMigrate`、`beforeValidate`、`afterValidate` 等。

### 2.5 Java API 编程式迁移

```java
@Component
public class FlywayMigrator {

    @Autowired
    private DataSource dataSource;

    // 手动触发迁移（多数据源场景）
    public void migrate(String schema) {
        Flyway.configure()
                .dataSource(dataSource)
                .locations("db/migration/" + schema)
                .baselineOnMigrate(true)
                .load()
                .migrate();
    }
}
```

## 3. Liquibase

Liquibase 支持 XML/YAML/JSON/SQL 四种格式，功能更强大：回滚、变更集校验、diff。

### 3.1 依赖与配置

```xml
<dependency>
    <groupId>org.liquibase</groupId>
    <artifactId>liquibase-core</artifactId>
</dependency>
```

```yaml
spring:
  liquibase:
    enabled: true
    change-log: classpath:db/changelog/db.changelog-master.xml
```

### 3.2 变更集 (changelog)

```xml
<!-- db/changelog/db.changelog-master.xml -->
<databaseChangeLog
    xmlns="http://www.liquibase.org/xml/ns/dbchangelog"
    xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
    xsi:schemaLocation="http://www.liquibase.org/xml/ns/dbchangelog
        http://www.liquibase.org/xml/ns/dbchangelog/dbchangelog-4.20.xsd">

    <include file="db/changelog/changes/001-create-user.xml"/>
    <include file="db/changelog/changes/002-add-phone.xml"/>
</databaseChangeLog>
```

```xml
<!-- db/changelog/changes/001-create-user.xml -->
<changeSet id="001" author="b1tzer">
    <createTable tableName="user">
        <column name="id" type="BIGINT" autoIncrement="true">
            <constraints primaryKey="true" nullable="false"/>
        </column>
        <column name="username" type="VARCHAR(50)">
            <constraints nullable="false" unique="true"/>
        </column>
        <column name="email" type="VARCHAR(100)">
            <constraints nullable="false" unique="true"/>
        </column>
        <column name="password_hash" type="VARCHAR(255)">
            <constraints nullable="false"/>
        </column>
        <column name="created_at" type="DATETIME" defaultValueComputed="CURRENT_TIMESTAMP"/>
        <column name="updated_at" type="DATETIME" defaultValueComputed="CURRENT_TIMESTAMP"/>
    </createTable>
</changeSet>
```

### 3.3 回滚支持

```xml
<changeSet id="002" author="b1tzer">
    <addColumn tableName="user">
        <column name="phone" type="VARCHAR(20)"/>
    </addColumn>
    <rollback>
        <dropColumn tableName="user" columnName="phone"/>
    </rollback>
</changeSet>
```

命令行回滚：

```bash
# 回滚最近 N 个变更集
liquibase rollbackCount 1
```

### 3.4 YAML 格式（更简洁）

```yaml
# db/changelog/changes/001-create-user.yaml
databaseChangeLog:
  - changeSet:
      id: 001
      author: b1tzer
      changes:
        - createTable:
            tableName: user
            columns:
              - column:
                  name: id
                  type: BIGINT
                  autoIncrement: true
                  constraints:
                    primaryKey: true
                    nullable: false
              - column:
                  name: username
                  type: VARCHAR(50)
                  constraints:
                    nullable: false
                    unique: true
```

## 4. Flyway vs Liquibase 选型

| 维度 | Flyway | Liquibase |
| :-- | :-- | :-- |
| 脚本格式 | 纯 SQL | XML/YAML/JSON/SQL |
| 学习曲线 | 低（会写 SQL 就行） | 中（需学 changelog 语法） |
| 回滚支持 | 付费版 | 免费 |
| 数据库 diff | 付费版 | 免费 |
| 多数据库 | 付费版 | 免费（自动适配方言） |
| 社区活跃度 | 高 | 高 |
| **推荐场景** | 单数据库、团队小 | 多数据库、需要回滚 |

## 5. 最佳实践

```java
// 生产环境配置
@Configuration
public class MigrationConfig {

    @Bean
    @Profile("prod")
    public FlywayMigrationStrategy prodStrategy() {
        return flyway -> {
            // 生产环境：校验但不自动迁移
            flyway.validate();
            // 手动确认后才执行
            // flyway.migrate();
        };
    }

    @Bean
    @Profile({"dev", "test"})
    public FlywayMigrationStrategy devStrategy() {
        return Flyway::migrate;  // 开发/测试环境自动迁移
    }
}
```

1. **迁移脚本和代码一起版本控制**——放在 `src/main/resources/db/migration/`
2. **生产环境禁用 clean**——`spring.flyway.clean-disabled=true`
3. **脚本不可变**——已执行的脚本不能修改，只能新增
4. **幂等性**——用 `CREATE TABLE IF NOT EXISTS` 或 Liquibase 的 `preconditions`
5. **小步快跑**——每个变更集只做一件事，方便回滚和定位问题
6. **基线策略**——已有数据库用 `baseline-on-migrate`，避免从 V1 开始
