# 生成列与函数索引

有些查询条件不是列本身，而是列的计算结果——「按大写用户名查」「按年份分组」「按 JSON 里的某个字段查」。这些条件写在 `WHERE` 里就是函数调用，普通索引全都失效。生成列（Generated Column）和函数索引解决的就是这一类问题：让「由已有列算出来的值」也能走索引。

两者的关系可以这样理解：生成列是把计算结果显式声明成一列，再在这列上建普通索引；函数索引（8.0.13 起）省掉了这一步，直接对表达式建索引，本质上是「隐藏的虚拟列 + 索引」的语法糖。搞清楚生成列的两种形态（VIRTUAL 与 STORED），后面所有场景——JSON 索引、不区分大小写查询、按年月查询——都只是同一机制的不同用法。

::: warning 版本要求
生成列与函数索引的版本边界经常被搞混，整理如下：

| 特性 | 起始版本 |
| :-- | :-- |
| 生成列（`GENERATED ALWAYS AS ... VIRTUAL / STORED`） | 5.7 |
| VIRTUAL 生成列上建二级索引 | 5.7 |
| 函数索引（直接对表达式建索引，`CREATE INDEX ... ((expr))`） | 8.0.13 |

5.6 及以下版本没有生成列，需要用普通列 + 触发器维护计算值。8.0.13 之前想要「函数索引」效果，只能走「先建 VIRTUAL 生成列、再对该列建普通索引」的路子，本文 §3 的多个示例正是这种写法。
:::

## 1. 生成列与函数索引

### 1.1 生成列

生成列的值不能显式插入或更新，而是由建表时指定的表达式算出来。定义时用 `GENERATED ALWAYS AS (表达式)`，后面可选 `VIRTUAL` 或 `STORED`——不写默认是 `VIRTUAL`。下面这个例子里，`total_price` 永远等于 `price * quantity`，插入行时只提供前两列即可。

```sql
CREATE TABLE products (
    id INT PRIMARY KEY,
    price DECIMAL(10,2),
    quantity INT,
    total_price DECIMAL(10,2) GENERATED ALWAYS AS (price * quantity) STORED
);
```

### 1.2 函数索引 (8.0.13+)

MySQL 8.0.13 引入了函数索引，可以直接对表达式建索引，不必再手工造一个生成列。语法是把表达式用一对额外的圆括号包起来，写在 `CREATE INDEX` 的列位置上。

```sql
-- 对函数结果建索引
CREATE INDEX idx_upper_name ON users((UPPER(name)));
CREATE INDEX idx_year ON orders((YEAR(created_at)));

-- 查询里的表达式必须和索引里写法一致，优化器才认得出
SELECT * FROM users WHERE UPPER(name) = 'ZHANGSAN';
SELECT * FROM orders WHERE YEAR(created_at) = 2024;
```

要注意的是：函数索引对「表达式一致性」很挑剔。索引写的是 `UPPER(name)`，查询里若写成 `UPPER(TRIM(name))` 或大小写敏感的排序规则冲突，优化器都可能选择不走索引。8.0 之前没有这个特性，那时的等价做法就是下节要讲的「虚拟列 + 索引」。

## 2. 生成列的选择与应用

### 2.1 应用场景

生成列适合这几类问题：一是查询条件里带函数（`UPPER`、`YEAR`、`DATE_FORMAT` 等），普通索引失效；二是要基于多列算出一个新维度，例如折后价、距离；三是 JSON 里某个字段查询频繁，需要把它「提出来」建索引。它们的共同点都是「查询条件不是原列，而是原列的一个函数」。

### 2.2 虚拟列 vs 存储列

两种形态最关键的差别是「什么时候算」。VIRTUAL 的值不落盘，读到这一行时才计算；STORED 的值在写入时算好，物理上保存在数据行里，读取时直接取。因此 VIRTUAL 节省存储，写入更快；STORED 占用空间，写入要多算一次，但读取无需再算。

```sql
-- 虚拟列（VIRTUAL）：不占用数据行存储，读取时计算
ALTER TABLE products ADD COLUMN total_price DECIMAL(10,2)
    GENERATED ALWAYS AS (price * quantity) VIRTUAL;

-- 存储列（STORED）：写入时计算并物理存储
ALTER TABLE products ADD COLUMN total_price DECIMAL(10,2)
    GENERATED ALWAYS AS (price * quantity) STORED;
```

有一个常见的误区：以为「虚拟列不能建索引」。实际上，从 5.7 起 InnoDB 支持在虚拟列上建二级索引，索引记录里会物化虚拟列的值——建了索引的虚拟列，等价于「读取时不算、写入时把值物化到索引里」，兼顾了存储与查询效率。

因此选型的经验规则是：如果这列几乎只读、频繁参与查询和索引，用 STORED 稍稍换取查询稳定；如果这列参与写入频繁、且已经计划建二级索引，用 VIRTUAL 更划算——数据行不占空间，索引记录里也照样有物化值可用。只有既想索引又不建索引的极少数场景，STORED 才是唯一选择。

## 3. 虚拟列索引实践

### 3.1 JSON 虚拟列索引

JSON 列本身不能直接建 B+ 树索引，但可以用虚拟列「把 JSON 里的某个字段提出来」，再在虚拟列上建索引。这是 8.0 之前——乃至 8.0 之后不用函数索引时——给 JSON 字段加索引的标准做法。

```sql
CREATE TABLE users (
    id INT PRIMARY KEY,
    profile JSON,
    -- 虚拟列提取 JSON 字段
    first_name VARCHAR(50) GENERATED ALWAYS AS (JSON_UNQUOTE(JSON_EXTRACT(profile, '$.firstName'))) VIRTUAL,
    email VARCHAR(100) GENERATED ALWAYS AS (JSON_UNQUOTE(JSON_EXTRACT(profile, '$.email'))) VIRTUAL
);

-- 在虚拟列上建索引
CREATE INDEX idx_first_name ON users(first_name);
CREATE INDEX idx_email ON users(email);

-- 查询走索引，与普通列无异
SELECT * FROM users WHERE first_name = '张三';
SELECT * FROM users WHERE email = 'test@example.com';
```

这里 `JSON_UNQUOTE(JSON_EXTRACT(...))` 的组合等价于 `->>` 操作符，用哪种写法看个人偏好，但要保证生成列的表达式和查询里提取 JSON 字段的方式对得上，否则索引选不中。

### 3.2 多列虚拟索引

多个虚拟列可以组合成联合索引，覆盖多条件查询。下面这个例子把订单时间格式化成 `YYYY-MM` 存进虚拟列，再和 `user_id` 组成联合索引，用来支撑「某用户某月的订单」这种典型报表查询。

```sql
CREATE TABLE orders (
    id INT PRIMARY KEY,
    user_id INT,
    amount DECIMAL(10,2),
    created_at DATETIME,
    -- 提取年月
    order_month VARCHAR(7) GENERATED ALWAYS AS (DATE_FORMAT(created_at, '%Y-%m')) VIRTUAL
);

CREATE INDEX idx_user_month ON orders(user_id, order_month);

-- 查询走 (user_id, order_month) 联合索引
SELECT * FROM orders WHERE user_id = 100 AND order_month = '2024-06';
```

## 4. 实际业务场景

三个典型场景：**不区分大小写查询**是最常见的需求，把用户名统一转成小写存进 STORED 列并建索引，登录、找回密码这类精确查找就能走索引；**地理坐标距离**用 STORED 列预先算好到某个中心点的距离，配合范围查询能高效筛出「附近的人」，缺点是中心点固定；**折后价查询**把 `price * (1 - discount/100)` 沉淀成 STORED 列，让「按折后价排序、筛区间」的查询也能走索引。

```sql
-- 场景 1：不区分大小写查询
CREATE TABLE users (
    id INT PRIMARY KEY,
    username VARCHAR(50),
    username_lower VARCHAR(50) GENERATED ALWAYS AS (LOWER(username)) STORED
);
CREATE INDEX idx_username_lower ON users(username_lower);
SELECT * FROM users WHERE username_lower = 'zhangsan';

-- 场景 2：地理坐标距离计算（到固定中心点）
CREATE TABLE locations (
    id INT PRIMARY KEY,
    lat DECIMAL(10, 7),
    lng DECIMAL(10, 7),
    -- 简化的欧氏距离，单位近似 km
    distance_from_center DECIMAL(10, 2) GENERATED ALWAYS AS (
        SQRT(POW(lat - 39.9042, 2) + POW(lng - 116.4074, 2)) * 111
    ) STORED
);
CREATE INDEX idx_distance ON locations(distance_from_center);
SELECT * FROM locations WHERE distance_from_center < 10;  -- 10km 以内

-- 场景 3：折后价索引
CREATE TABLE products (
    id INT PRIMARY KEY,
    price DECIMAL(10,2),
    discount DECIMAL(5,2),
    final_price DECIMAL(10,2) GENERATED ALWAYS AS (price * (1 - discount/100)) STORED
);
CREATE INDEX idx_final_price ON products(final_price);
SELECT * FROM products WHERE final_price < 100 ORDER BY final_price;
```

需要提醒的是场景 2 的「距离生成列」只对固定中心点有效。如果业务里中心点会随查询变化（例如「离我 3 公里内的门店」），距离必须在查询里现算，此时应改用空间索引（SPATIAL）和 `ST_Distance_Sphere` 之类的空间函数，生成列救不了这种查询。

## 5. 最佳实践

1. **读多写少场景用 STORED 列** — 写入多算一次，换来读取无需计算
2. **写多读少场景用 VIRTUAL 列** — 数据行不占空间，需要索引时再在虚拟列上建
3. **JSON 高频查询字段用虚拟列 + 索引** — 比每次调用 `JSON_EXTRACT` 快几个数量级
4. **函数索引要求表达式一致** — 查询里写法与索引定义必须逐字符对齐，否则不走索引
5. **避免过度使用生成列** — 增加表结构复杂度，且改动生成表达式往往需要重建索引
