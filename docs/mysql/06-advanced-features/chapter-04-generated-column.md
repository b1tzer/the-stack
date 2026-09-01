# 生成列与函数索引

## 1. 生成列与函数索引

### 1.1 生成列

```sql
CREATE TABLE products (
    id INT PRIMARY KEY,
    price DECIMAL(10,2),
    quantity INT,
    total_price DECIMAL(10,2) GENERATED ALWAYS AS (price * quantity) STORED
);
```

### 1.2 函数索引 (8.0+)

```sql
-- 对函数结果建索引
CREATE INDEX idx_upper_name ON users((UPPER(name)));
CREATE INDEX idx_year ON orders((YEAR(created_at)));

-- 使用
SELECT * FROM users WHERE UPPER(name) = 'ZHANGSAN';
SELECT * FROM orders WHERE YEAR(created_at) = 2024;
```

## 2. 生成列的选择与应用

### 2.1 应用场景

- 不区分大小写查询
- 按年/月查询
- 计算字段索引

### 2.2 虚拟列 vs 存储列

```sql
-- 虚拟列（VIRTUAL）：不占用存储空间，查询时实时计算
ALTER TABLE products ADD COLUMN total_price DECIMAL(10,2)
    GENERATED ALWAYS AS (price * quantity) VIRTUAL;

-- 存储列（STORED）：占用存储空间，写入时计算并存储
ALTER TABLE products ADD COLUMN total_price DECIMAL(10,2)
    GENERATED ALWAYS AS (price * quantity) STORED;

-- 对比
-- 虚拟列：
--   ✅ 不占存储空间
--   ✅ 写入更快（不需计算）
--   ❌ 不能用于索引（MySQL 8.0.13+ 虚拟列可以建索引）
--   ❌ 每次查询都要计算

-- 存储列：
--   ✅ 可以建索引
--   ✅ 查询时不需要计算
--   ❌ 占用存储空间
--   ❌ 写入时需要计算
```

## 3. 虚拟列索引实践

### 3.1 JSON 虚拟列索引

```sql
-- MySQL 8.0.17+ 虚拟列支持二级索引
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

-- 查询可以利用索引
SELECT * FROM users WHERE first_name = '张三';  -- 走 idx_first_name 索引
SELECT * FROM users WHERE email = 'test@example.com';  -- 走 idx_email 索引
```

### 3.2 多列虚拟索引

```sql
-- 联合虚拟索引
CREATE TABLE orders (
    id INT PRIMARY KEY,
    user_id INT,
    amount DECIMAL(10,2),
    created_at DATETIME,
    -- 提取年月
    order_month VARCHAR(7) GENERATED ALWAYS AS (DATE_FORMAT(created_at, '%Y-%m')) VIRTUAL
);

CREATE INDEX idx_user_month ON orders(user_id, order_month);

-- 查询利用联合虚拟索引
SELECT * FROM orders WHERE user_id = 100 AND order_month = '2024-06';
```

## 4. 实际业务场景

```sql
-- 场景 1：不区分大小写查询
CREATE TABLE users (
    id INT PRIMARY KEY,
    username VARCHAR(50),
    username_lower VARCHAR(50) GENERATED ALWAYS AS (LOWER(username)) STORED
);
CREATE INDEX idx_username_lower ON users(username_lower);
SELECT * FROM users WHERE username_lower = 'zhangsan';

-- 场景 2：地理坐标距离计算
CREATE TABLE locations (
    id INT PRIMARY KEY,
    lat DECIMAL(10, 7),
    lng DECIMAL(10, 7),
    -- 计算距离（简化版）
    distance_from_center DECIMAL(10, 2) GENERATED ALWAYS AS (
        SQRT(POW(lat - 39.9042, 2) + POW(lng - 116.4074, 2)) * 111
    ) STORED
);
CREATE INDEX idx_distance ON locations(distance_from_center);
SELECT * FROM locations WHERE distance_from_center < 10;  -- 10km 以内

-- 场景 3：复合条件索引
CREATE TABLE products (
    id INT PRIMARY KEY,
    price DECIMAL(10,2),
    discount DECIMAL(5,2),
    -- 折后价
    final_price DECIMAL(10,2) GENERATED ALWAYS AS (price * (1 - discount/100)) STORED
);
CREATE INDEX idx_final_price ON products(final_price);
SELECT * FROM products WHERE final_price < 100 ORDER BY final_price;
```

## 5. 最佳实践

1. **读多写少场景用 STORED 列** — 可以建索引，查询效率高
2. **写多读少场景用 VIRTUAL 列** — 不占存储，写入快
3. **JSON 字段提取用虚拟列 + 索引** — 替代 JSON_CONTAINS 查询
4. **避免过度使用生成列** — 增加表结构复杂度
5. **MySQL 8.0.13+ 虚拟列支持索引** — 优先使用虚拟列
