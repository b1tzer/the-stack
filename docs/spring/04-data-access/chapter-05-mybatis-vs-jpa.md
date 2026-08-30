# MyBatis vs JPA 选型

> 项目组为「用 MyBatis 还是 JPA」吵了三天——这不是信仰问题，是工程选型问题。MyBatis 是 SQL 映射器，你写 SQL 它帮你映射；JPA 是 ORM，你操作对象它帮你生成 SQL。两条路线各有适用场景，选错了代价很大。

## 1. 两条路线的本质差异

### 1.1 SQL 映射器 vs 对象关系映射

```text
MyBatis 路线：
  Java 方法 → SQL 语句 → 结果集 → Java 对象
  你写 SQL，MyBatis 帮你映射

JPA 路线：
  Java 对象 → ORM 映射 → 自动生成 SQL → 结果集 → Java 对象
  你操作对象，JPA 帮你生成 SQL
```

### 1.2 核心差异对比

| 维度 | MyBatis | JPA (Hibernate) |
| :-- | :-- | :-- |
| 核心思想 | SQL 映射器 | 对象关系映射（ORM） |
| SQL 控制 | 完全手写 | 自动生成，也可手写 |
| 学习曲线 | 低（会 SQL 就行） | 高（实体状态、懒加载、缓存） |
| 灵活性 | 极高（任意 SQL） | 受 ORM 框架约束 |
| 数据库移植 | 差（SQL 方言依赖） | 好（Hibernate 方言抽象） |
| 复杂查询 | 强（直接写 SQL） | 弱（JPQL 限制多） |
| 关联查询 | 手动映射 | 自动映射（但 N+1 是陷阱） |
| 二级缓存 | 需手动配置 | 内置支持 |
| 动态 SQL | XML 标签强大 | Criteria API / Specification |
| 批量操作 | 灵活（foreach） | 受持久化上下文约束 |

---

## 2. 四维决策矩阵

| 维度 | 选 MyBatis | 选 JPA |
| :-- | :-- | :-- |
| **团队 SQL 能力** | SQL 功底扎实 | 更熟悉面向对象 |
| **查询复杂度** | 多表联查、统计报表 | 简单 CRUD 为主 |
| **精细调优** | 需要手动优化 SQL | 可接受框架生成的 SQL |
| **项目规模** | 大型项目、微服务 | 中小型项目、快速开发 |

### 2.1 决策流程图

```text
新项目选型：
│
├── 团队 SQL 能力强？
│   ├── 是 → 查询复杂？
│   │        ├── 是（多表联查、报表） → MyBatis
│   │        └── 否（简单 CRUD）      → 都行，看团队偏好
│   └── 否 → JPA（减少 SQL 编写）
│
├── 需要精细控制 SQL？
│   ├── 是 → MyBatis
│   └── 否 → JPA
│
└── 项目规模大？
    ├── 是（微服务、大型单体） → MyBatis（更灵活，团队协作更容易）
    └── 否（中小型、快速迭代） → JPA（开发效率高）
```

### 2.2 典型场景

| 场景 | 推荐 | 理由 |
| :-- | :-- | :-- |
| 电商后台 CRUD | JPA | 简单增删改查，JPA 开发效率高 |
| 报表统计系统 | MyBatis | 复杂 SQL、多表联查、存储过程 |
| 微服务业务层 | MyBatis | SQL 可控，团队协作清晰 |
| 快速原型 / MVP | JPA | 零 SQL 启动，快速迭代 |
| 多数据库适配 | JPA | Hibernate 方言抽象层 |
| 高并发核心链路 | MyBatis | SQL 可精确调优 |

---

## 3. 混合使用方案

同一项目可以混用 MyBatis 和 JPA，各取所长：

```java
// 复杂查询用 MyBatis
@Mapper
public interface ReportMapper {
    @Select("SELECT department, COUNT(*) as cnt, AVG(salary) as avg_salary " +
            "FROM employees GROUP BY department HAVING cnt > 5")
    List<DepartmentStat> getDepartmentStats();
}

// 简单 CRUD 用 JPA
public interface UserRepository extends JpaRepository<User, Long> {
    Optional<User> findByUsername(String username);
}
```

> **踩坑提醒**：同一项目混用 MyBatis 和 JPA 时，**事务管理要统一**。JPA 用 `JpaTransactionManager`，MyBatis 用 `DataSourceTransactionManager`。如果混用，确保它们操作的是**同一个数据源**，且用同一个 `PlatformTransactionManager`。推荐用 `JpaTransactionManager` 统一管理。

---

## 4. 没有银弹

| 如果你选了 MyBatis | 如果你选了 JPA |
| :-- | :-- |
| 要写大量 SQL，维护成本随项目增长 | N+1 问题是最大的坑，必须理解懒加载 |
| 数据库迁移时 SQL 要逐个检查 | 复杂查询时 JPQL 不够用，要退回原生 SQL |
| 动态 SQL 学习成本（XML 标签） | 持久化上下文的脏检查机制需要理解 |
| 没有自动建表、审计等开箱即用功能 | 批量操作性能不如手写 SQL |

**最终建议**：选型不是技术信仰之争。团队 SQL 强 + 查询复杂 → MyBatis。团队 OOP 背景 + CRUD 为主 → JPA。不确定 → 先 JPA（门槛低），遇到复杂查询再引入 MyBatis。
