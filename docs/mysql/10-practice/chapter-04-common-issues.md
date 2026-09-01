# 常见问题与避坑指南

## 1. 索引失效

```sql
-- 函数操作
WHERE YEAR(created_at) = 2024  -- ❌

-- 隐式类型转换
WHERE phone = 13800138000  -- ❌ phone 是 VARCHAR

-- LIKE 左模糊
WHERE name LIKE '%张'  -- ❌
```

## 2. 死锁

```sql
-- 固定加锁顺序
-- 按主键顺序更新
UPDATE users SET name = 'A' WHERE id = 1;
UPDATE users SET name = 'A' WHERE id = 2;
```

## 3. 大事务

```sql
-- 拆分大事务
-- 慢
DELETE FROM logs WHERE created_at < '2024-01-01';

-- 快
DELETE FROM logs WHERE created_at < '2024-01-01' LIMIT 10000;
-- 循环执行直到影响行数为 0
```

## 4. 连接池耗尽

```yaml
spring:
  datasource:
    hikari:
      maximum-pool-size: 20
      connection-timeout: 30000
      idle-timeout: 600000
      max-lifetime: 1800000
```

## 5. 主键选择不当

```sql
-- ❌ UUID 作为主键
CREATE TABLE orders (
    id CHAR(36) PRIMARY KEY,  -- 随机写入，页分裂
    ...
);

-- ❌ 业务字段作为主键
CREATE TABLE orders (
    order_no VARCHAR(32) PRIMARY KEY,  -- 可能变更，且不连续
    ...
);

-- ✅ 自增主键 + 唯一索引
CREATE TABLE orders (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    order_no VARCHAR(32) NOT NULL,
    UNIQUE INDEX idx_order_no (order_no)
);
```

## 6. 大表 DDL 阻塞

```sql
-- ❌ 直接 ALTER 大表
ALTER TABLE big_table ADD COLUMN new_col INT;  -- 可能锁表几分钟

-- ✅ 使用 Online DDL
ALTER TABLE big_table ADD COLUMN new_col INT, ALGORITHM=INPLACE, LOCK=NONE;

-- ✅ 使用 pt-osc
-- pt-online-schema-change --alter "ADD COLUMN new_col INT" D=mydb,t=big_table --execute

-- ✅ 使用 gh-ost
-- gh-ost --database=mydb --table=big_table --alter="ADD COLUMN new_col INT" --execute
```

## 7. 连接泄漏

```java
// ❌ 连接泄漏
public void badExample() {
    Connection conn = dataSource.getConnection();
    Statement stmt = conn.createStatement();
    ResultSet rs = stmt.executeQuery("SELECT * FROM users");
    // 如果这里抛异常，连接永远不会关闭
}

// ✅ 使用 try-with-resources
public void goodExample() throws SQLException {
    try (Connection conn = dataSource.getConnection();
         Statement stmt = conn.createStatement();
         ResultSet rs = stmt.executeQuery("SELECT * FROM users")) {
        while (rs.next()) {
            // 处理数据
        }
    } // 自动关闭
}

// ✅ 使用 Spring JdbcTemplate
public void bestExample() {
    jdbcTemplate.query("SELECT * FROM users", (rs, rowNum) -> {
        return new User(rs.getString("name"));
    });
}
```

## 8. N+1 查询问题

```java
// ❌ N+1 查询
List<Order> orders = orderRepository.findAll();  // 1 次查询
for (Order order : orders) {
    User user = userRepository.findById(order.getUserId());  // N 次查询
    order.setUser(user);
}

// ✅ 使用 JOIN FETCH（JPA）
@Query("SELECT o FROM Order o JOIN FETCH o.user")
List<Order> findAllWithUser();

// ✅ 使用 IN 批量查询
List<Long> userIds = orders.stream().map(Order::getUserId).collect(Collectors.toList());
Map<Long, User> userMap = userRepository.findByIdIn(userIds)
    .stream().collect(Collectors.toMap(User::getId, Function.identity()));

// ✅ MyBatis 嵌套查询
// <collection property="items" select="findItemsByOrderId" column="id"/>
```

## 9. 时区问题

```java
// ❌ 时区不一致导致时间错误
// 服务器 UTC，应用 CST，数据库未设置时区

// ✅ 统一时区配置
// JDBC URL
String url = "jdbc:mysql://host:3306/mydb?serverTimezone=Asia/Shanghai&useSSL=false";

// my.cnf
// default-time-zone = '+08:00'

// Java 应用
// 使用 LocalDateTime 替代 Date
// 确保 JVM 时区一致：-Duser.timezone=Asia/Shanghai
```

## 10. 常见错误码

| 错误码 | 含义 | 解决方案 |
|--------|------|----------|
| 1062 | 唯一约束冲突 | 检查重复数据 |
| 1213 | 死锁 | 重试或优化加锁顺序 |
| 1205 | 锁等待超时 | 缩短事务或增大超时 |
| 1040 | 连接数过多 | 增大 max_connections 或优化连接池 |
| 1153 | 包过大 | 增大 max_allowed_packet |
| 2006 | 服务器断开连接 | 检查 wait_timeout |
| 1045 | 认证失败 | 检查用户名密码 |
| 1146 | 表不存在 | 检查表名和数据库 |

