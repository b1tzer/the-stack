---
doc_id: pg-first-db
title: 第一个数据库
---

# 第一个数据库

> **核心问题：** 如何用 PostgreSQL 创建数据库和表，完成基本 CRUD，并体验 PG 的特色语法（RETURNING、数组、JSONB）？

---

## 1. 创建数据库和表

```sql
-- 创建数据库
CREATE DATABASE school_db
    ENCODING 'UTF8'
    LC_COLLATE 'en_US.UTF-8'
    LC_CTYPE 'en_US.UTF-8';

-- 连接
\c school_db

-- 创建学生表
CREATE TABLE students (
    id          SERIAL PRIMARY KEY,
    name        VARCHAR(50) NOT NULL,
    email       VARCHAR(100) UNIQUE,
    gender      CHAR(1) CHECK (gender IN ('M', 'F')),
    birthday    DATE,
    tags        TEXT[],                        -- PG 数组类型
    profile     JSONB DEFAULT '{}'::JSONB,     -- JSONB 字段
    created_at  TIMESTAMP DEFAULT now(),
    updated_at  TIMESTAMP DEFAULT now()
);

-- 创建成绩表
CREATE TABLE scores (
    id          SERIAL PRIMARY KEY,
    student_id  INT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    subject     VARCHAR(50) NOT NULL,
    score       NUMERIC(5,2) CHECK (score >= 0 AND score <= 100),
    exam_date   DATE NOT NULL,
    UNIQUE (student_id, subject, exam_date)    -- 防止重复录入
);

-- 创建索引
CREATE INDEX idx_scores_student ON scores(student_id);
CREATE INDEX idx_scores_subject ON scores(subject);
CREATE INDEX idx_students_tags ON students USING GIN(tags);  -- GIN 索引支持数组查询
```

---

## 2. 基本 CRUD 操作

### Create — 插入

```sql
-- 单条插入
INSERT INTO students (name, email, gender, birthday)
VALUES ('张三', 'zhangsan@example.com', 'M', '2000-03-15');

-- 批量插入
INSERT INTO students (name, email, gender, birthday) VALUES
    ('李四', 'lisi@example.com', 'F', '2001-07-22'),
    ('王五', 'wangwu@example.com', 'M', '1999-11-08'),
    ('赵六', 'zhaoliu@example.com', 'F', '2000-01-30');
```

### Read — 查询

```sql
-- 基础查询
SELECT id, name, email FROM students WHERE gender = 'M';

-- 模糊查询
SELECT * FROM students WHERE name LIKE '张%';

-- 分页（PG 语法）
SELECT * FROM students ORDER BY id LIMIT 10 OFFSET 0;

-- 聚合统计
SELECT gender, COUNT(*) AS cnt
FROM students
GROUP BY gender;
```

### Update — 更新

```sql
UPDATE students
SET email = 'zhangsan_new@example.com', updated_at = now()
WHERE id = 1;
```

### Delete — 删除

```sql
-- 软删除（推荐）
UPDATE students SET updated_at = now() WHERE id = 4;

-- 硬删除
DELETE FROM students WHERE id = 4;
```

---

## 3. PG 特有语法尝鲜

### RETURNING — 操作后直接返回结果

```sql
-- 插入后返回自动生成的 id 和默认值
INSERT INTO students (name, email, gender)
VALUES ('孙七', 'sunqi@example.com', 'M')
RETURNING id, created_at;
--  id |         created_at
-- ----+----------------------------
--   5 | 2026-08-28 18:00:00.000000

-- 更新后返回变更的行
UPDATE students SET name = '张三丰' WHERE id = 1
RETURNING id, name, updated_at;

-- 删除后返回被删数据
DELETE FROM students WHERE id = 5
RETURNING *;
```

> **Java 开发者注意**：在 MyBatis/JPA 中配合 `RETURNING` 可以省去一次 `SELECT`，等价于 `INSERT ... RETURNING id` 替代 `getLastInsertId()`。

### 数组类型 — TEXT[]

```sql
-- 插入带数组的数据
INSERT INTO students (name, email, gender, tags)
VALUES ('周八', 'zhouba@example.com', 'M', ARRAY['学霸', '篮球队', 'ACM奖'])
RETURNING id, tags;

-- 查询包含特定标签的学生
SELECT name, tags FROM students WHERE '学霸' = ANY(tags);

-- 数组包含查询（使用 GIN 索引）
SELECT name, tags FROM students WHERE tags @> ARRAY['篮球队'];

-- 数组追加元素
UPDATE students SET tags = array_append(tags, '班长') WHERE id = 1;

-- 展开数组
SELECT name, unnest(tags) AS tag FROM students WHERE id = 1;
```

### JSONB — 半结构化数据

```sql
-- 插入 JSONB 数据
UPDATE students SET profile = '{
    "city": "北京",
    "skills": ["Java", "Spring", "PostgreSQL"],
    "gpa": 3.8,
    "address": {"district": "海淀", "street": "中关村大街"}
}'::JSONB WHERE id = 1;

-- 读取 JSON 字段
SELECT name,
       profile->>'city' AS city,              -- 文本提取
       profile->'skills' AS skills,           -- JSON 提取
       (profile->>'gpa')::NUMERIC AS gpa      -- 转类型
FROM students WHERE id = 1;

-- JSON 路径查询
SELECT name FROM students
WHERE profile->'address'->>'district' = '海淀';

-- JSON 包含查询
SELECT name FROM students
WHERE profile @> '{"city": "北京"}'::JSONB;

-- 更新 JSON 字段
UPDATE students
SET profile = jsonb_set(profile, '{gpa}', '3.9'::JSONB)
WHERE id = 1;
```

| 操作 | 语法 | 说明 |
|------|------|------|
| 提取文本 | `col->>'key'` | 返回 TEXT |
| 提取 JSON | `col->'key'` | 返回 JSONB |
| 路径提取 | `col#>>'{a,b,c}'` | 嵌套路径 |
| 包含查询 | `col @> '{"k":"v"}'::JSONB` | 部分匹配 |
| 存在键 | `col ? 'key'` | 键是否存在 |

---

## 4. 完整小项目：学生成绩管理系统

将上面的表和数据整合，实现一个完整查询——**各科成绩排行榜**：

```sql
-- 插入成绩数据
INSERT INTO scores (student_id, subject, score, exam_date) VALUES
    (1, '数学', 92.5, '2026-06-15'),
    (1, '英语', 88.0, '2026-06-15'),
    (1, 'Java程序设计', 95.0, '2026-06-16'),
    (2, '数学', 78.0, '2026-06-15'),
    (2, '英语', 91.5, '2026-06-15'),
    (2, 'Java程序设计', 85.0, '2026-06-16'),
    (3, '数学', 88.0, '2026-06-15'),
    (3, '英语', 76.0, '2026-06-15'),
    (3, 'Java程序设计', 90.0, '2026-06-16');

-- 查询各科排名（窗口函数）
SELECT
    s.name AS 学生,
    sc.subject AS 科目,
    sc.score AS 成绩,
    RANK() OVER (PARTITION BY sc.subject ORDER BY sc.score DESC) AS 排名
FROM scores sc
JOIN students s ON s.id = sc.student_id
ORDER BY sc.subject, 排名;
```

输出：

```
 学生 |    科目    | 成绩 | 排名
------+-----------+------+------
 张三 | Java程序设计 | 95.0 |    1
 王五 | Java程序设计 | 90.0 |    2
 李四 | Java程序设计 | 85.0 |    3
 张三 | 数学       | 92.5 |    1
 王五 | 数学       | 88.0 |    2
 李四 | 数学       | 78.0 |    3
 李四 | 英语       | 91.5 |    1
 张三 | 英语       | 88.0 |    2
 王五 | 英语       | 76.0 |    3
```

**每个学生的总分和平均分：**

```sql
SELECT
    s.name AS 学生,
    SUM(sc.score) AS 总分,
    ROUND(AVG(sc.score), 2) AS 平均分,
    COUNT(*) AS 科目数
FROM scores sc
JOIN students s ON s.id = sc.student_id
GROUP BY s.name
ORDER BY 总分 DESC;
```

**使用 CTE 查找每科最高分学生：**

```sql
WITH ranked AS (
    SELECT
        s.name,
        sc.subject,
        sc.score,
        ROW_NUMBER() OVER (PARTITION BY sc.subject ORDER BY sc.score DESC) AS rn
    FROM scores sc
    JOIN students s ON s.id = sc.student_id
)
SELECT name AS 学生, subject AS 科目, score AS 最高分
FROM ranked WHERE rn = 1;
```

---

## 5. 常见新手问题 FAQ

### Q1: `ERROR: relation "xxx" does not exist`

表名拼错或不在当前 schema。检查：

```sql
-- 查看当前 schema
SHOW search_path;

-- 查看所有表
\dt *.*

-- 设置 search_path
SET search_path TO public;
```

### Q2: `ERROR: column "xxx" does not exist`

列名大小写敏感。PG 默认将未加引号的标识符转为小写：

```sql
CREATE TABLE T (Id INT);   -- 实际创建的是 id 列
SELECT Id FROM T;           -- ✅ 等价于 SELECT id FROM t
SELECT "Id" FROM "T";      -- ❌ 报错，大小写需要双引号
```

> **建议**：始终使用小写 + 下划线命名，如 `student_id`。

### Q3: `ERROR: permission denied for table xxx`

```sql
-- 授权给指定用户
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO your_user;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO your_user;
```

### Q4: 如何查看 SQL 执行计划？

```sql
EXPLAIN ANALYZE
SELECT * FROM scores WHERE student_id = 1;

-- 输出包含实际执行时间和行数估算
```

### Q5: SERIAL 和 IDENTITY 的区别？

```sql
-- SERIAL（传统方式，本质是 SEQUENCE + DEFAULT）
CREATE TABLE t1 (id SERIAL PRIMARY KEY);

-- IDENTITY（SQL 标准，推荐 PG 10+）
CREATE TABLE t2 (id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY);
```

| 特性 | SERIAL | IDENTITY |
|------|--------|----------|
| SQL 标准 | ❌ PG 私有 | ✅ SQL:2003 |
| 手动插入值 | 可以 | 需 `OVERRIDING SYSTEM VALUE` |
| 推荐程度 | 兼容旧代码 | **新项目首选** |

### Q6: 如何与 Java（Spring Boot）集成？

```yaml
# application.yml
spring:
  datasource:
    url: jdbc:postgresql://localhost:5432/school_db
    username: postgres
    password: dev123
    driver-class-name: org.postgresql.Driver
  jpa:
    database-platform: org.hibernate.dialect.PostgreSQLDialect
    hibernate:
      ddl-auto: update
```

```java
// 实体类中使用 JSONB
@Entity
@Table(name = "students")
public class Student {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    private String name;

    @Type(JsonType.class)  // hibernate-types 库
    @Column(columnDefinition = "jsonb")
    private Map<String, Object> profile;
}
```

---

## 要点总结

- **RETURNING** 是 PG 的杀手级特性，减少一次查询往返
- **数组类型** 适合存储标签、分类等多值属性，配合 GIN 索引查询高效
- **JSONB** 是半结构化数据的最佳选择，支持索引、包含查询、路径提取
- **IDENTITY > SERIAL**，新项目优先使用标准语法
- 标识符大小写：**全小写 + 下划线**，避免双引号地狱
- `EXPLAIN ANALYZE` 是排查慢查询的第一步
