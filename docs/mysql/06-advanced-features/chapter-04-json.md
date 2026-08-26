# JSON 类型

## 1. 基本操作

```sql
CREATE TABLE docs (
    id INT PRIMARY KEY,
    data JSON
);

INSERT INTO docs VALUES (1, '{"name": "张三", "age": 25}');

-- 提取
SELECT JSON_EXTRACT(data, '$.name') FROM docs;
SELECT data->>'$.name' FROM docs;  -- 返回字符串

-- 修改
UPDATE docs SET data = JSON_SET(data, '$.email', 'zhangsan@example.com') WHERE id = 1;
```

## 2. JSON 函数

| 函数 | 说明 |
|------|------|
| JSON_EXTRACT | 提取值 |
| JSON_SET | 设置值 |
| JSON_INSERT | 插入值 |
| JSON_REMOVE | 删除值 |
| JSON_CONTAINS | 包含检查 |
| JSON_ARRAY | 创建数组 |
| JSON_OBJECT | 创建对象 |

## 3. JSON 索引

```sql
-- 虚拟列 + 索引
ALTER TABLE docs ADD COLUMN name VARCHAR(50) AS (JSON_UNQUOTE(JSON_EXTRACT(data, '$.name')));
CREATE INDEX idx_name ON docs(name);
```

## 4. JSON 数组操作

```sql
-- 创建包含数组的 JSON
INSERT INTO users VALUES (1, '{"name": "张三", "hobbies": ["reading", "coding", "gaming"]}');

-- 查询数组元素
SELECT JSON_EXTRACT(data, '$.hobbies[0]') FROM users WHERE id = 1;  -- "reading"

-- 数组长度
SELECT JSON_LENGTH(data, '$.hobbies') FROM users WHERE id = 1;  -- 3

-- 数组追加
UPDATE users SET data = JSON_ARRAY_APPEND(data, '$.hobbies', 'swimming') WHERE id = 1;

-- 数组插入
UPDATE users SET data = JSON_ARRAY_INSERT(data, '$.hobbies[0]', 'running') WHERE id = 1;

-- 数组删除
UPDATE users SET data = JSON_REMOVE(data, '$.hobbies[1]') WHERE id = 1;

-- 检查数组是否包含某值
SELECT * FROM users WHERE JSON_CONTAINS(data->'$.hobbies', '"coding"');

-- 数组展开（MySQL 8.0.17+）
SELECT * FROM users, JSON_TABLE(data, '$.hobbies[*]' COLUMNS (
    hobby VARCHAR(50) PATH '$'
)) AS jt;
```

## 5. JSON 聚合与条件

```sql
-- JSON_OBJECT 聚合
SELECT JSON_OBJECT('id', id, 'name', name, 'age', age) FROM users LIMIT 5;

-- JSON_ARRAYAGG（MySQL 8.0+）
SELECT
    department,
    JSON_ARRAYAGG(name) AS employees
FROM employees
GROUP BY department;

-- JSON_OBJECTAGG（MySQL 8.0+）
SELECT
    department,
    JSON_OBJECTAGG(name, salary) AS salary_map
FROM employees
GROUP BY department;

-- JSON 条件查询
SELECT * FROM users WHERE
    JSON_EXTRACT(data, '$.age') > 20
    AND JSON_EXTRACT(data, '$.city') = '北京';

-- JSON 路径查询（MySQL 8.0+）
SELECT * FROM users WHERE data->>'$.city' = '北京';
```

## 6. JSON 索引方案

```sql
-- 方案 1：虚拟列 + 索引（推荐）
ALTER TABLE users ADD COLUMN city VARCHAR(50)
    GENERATED ALWAYS AS (JSON_UNQUOTE(JSON_EXTRACT(data, '$.city'))) VIRTUAL;
CREATE INDEX idx_city ON users(city);

-- 方案 2：多值索引（MySQL 8.0.17+，数组元素索引）
CREATE TABLE tags (
    id INT PRIMARY KEY,
    data JSON,
    INDEX idx_tags ((CAST(data->'$.tags' AS UNSIGNED ARRAY)))
);

INSERT INTO tags VALUES (1, '{"tags": [1, 2, 3]}');
INSERT INTO tags VALUES (2, '{"tags": [2, 3, 4]}');

-- 多值索引查询
SELECT * FROM tags WHERE 2 MEMBER OF (data->'$.tags');
SELECT * FROM tags WHERE JSON_OVERLAPS(data->'$.tags', '[2, 5]');

-- 方案 3：函数索引
CREATE INDEX idx_json_name ON users((JSON_UNQUOTE(JSON_EXTRACT(data, '$.name'))));
```

## 7. JSON 与应用层集成

```java
// Spring Boot + JPA 中使用 JSON
@Entity
@Table(name = "users")
public class User {
    @Id
    private Long id;
    
    @Column(columnDefinition = "JSON")
    @Convert(converter = JsonConverter.class)
    private Map<String, Object> profile;
}

// JSON 转换器
@Converter
public class JsonConverter implements AttributeConverter<Map<String, Object>, String> {
    private static final ObjectMapper mapper = new ObjectMapper();
    
    @Override
    public String convertToDatabaseColumn(Map<String, Object> attribute) {
        try { return mapper.writeValueAsString(attribute); }
        catch (JsonProcessingException e) { throw new RuntimeException(e); }
    }
    
    @Override
    public Map<String, Object> convertToEntityAttribute(String dbData) {
        try { return mapper.readValue(dbData, new TypeReference<>() {}); }
        catch (JsonProcessingException e) { throw new RuntimeException(e); }
    }
}
```

## 8. 最佳实践

1. **JSON 适合半结构化数据** — 不同记录有不同字段
2. **高频查询字段应提取为虚拟列并建索引** — 性能远优于 JSON 函数查询
3. **避免存储超大 JSON** — 单行 JSON 不宜超过几十 KB
4. **使用 `->>` 替代 `JSON_UNQUOTE(JSON_EXTRACT())`** — 语法更简洁
5. **多值索引用于数组查询** — MySQL 8.0.17+ 的重要特性
6. **结构化字段用传统列，半结构化用 JSON** — 不要滥用 JSON

