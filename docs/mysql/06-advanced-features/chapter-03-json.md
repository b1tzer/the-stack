# JSON 类型

关系模型要求「先定义 schema、再写入数据」，但实际业务里总有一些字段是「不知道会有哪些、也不适合每加一个就 `ALTER TABLE`」的：用户画像里的偏好标签、商品的扩展属性、日志里附带的上下文。把这些字段塞进 `TEXT` 列存 JSON 字符串是最原始的做法，代价是 MySQL 完全不理解这些内容，既不能校验、也不能查询——每次都得把整段字符串拉回应用层反序列化。

MySQL 5.7 引入的 `JSON` 类型解决的正是这件事。它在磁盘上不是字符串，而是**二进制格式**：文档在写入时被解析成键值对与数组元素的树结构，附带类型和偏移量索引。这样带来两个直接好处——写入时会做**语法校验**（非法 JSON 直接报错），读取时可以按路径**局部提取**而不必解析整个文档。代价是每次修改都需要重写这个二进制结构，因此 JSON 更适合「读多写少、字段不固定」的场景，不该被当成关系表的替代品。

::: warning 版本要求
JSON 相关功能是逐步补齐的，不同特性对应的最低版本差异较大：

| 特性 | 起始版本 |
| :-- | :-- |
| `JSON` 类型与基础函数（`JSON_EXTRACT`、`JSON_SET` 等） | 5.7.8 |
| `->` 内联路径操作符 | 5.7.9 |
| `->>` 内联路径操作符（`JSON_UNQUOTE` + `JSON_EXTRACT`） | 5.7.13 |
| `JSON_ARRAYAGG` / `JSON_OBJECTAGG` 聚合函数 | 5.7.22（8.0 更完善） |
| `JSON_TABLE`（把 JSON 展平成关系表） | 8.0.4 |
| 多值索引（对 JSON 数组元素建索引） | 8.0.17 |

只有 5.6 及以下版本没有原生 JSON 类型，只能用 `TEXT` 列自行处理。本文默认 MySQL 5.7.8 以上，涉及 8.0 才有的特性会在小节里单独说明。
:::

## 1. 基础用法

### 1.1 存与取

创建 JSON 列不需要指定长度或格式，值可以直接以 JSON 字符串字面量写入，MySQL 会自动解析并转成内部二进制表示：

```sql
CREATE TABLE docs (
    id INT PRIMARY KEY,
    data JSON
);

INSERT INTO docs VALUES (1, '{"name": "张三", "age": 25}');
```

读取时最常用的两个操作符是 `->` 和 `->>`。前者等价于 `JSON_EXTRACT`，返回一个 JSON 值（字符串带引号）；后者是 `->` 再叠加一层 `JSON_UNQUOTE`，返回去引号后的原始文本，更适合直接和普通字符串比较：

```sql
-- data->'$.name'  返回  "张三"   （带引号，仍是 JSON 值）
-- data->>'$.name' 返回  张三     （已去引号，可与 VARCHAR 比较）

SELECT data->>'$.name' FROM docs WHERE id = 1;

-- 等价的老写法
SELECT JSON_UNQUOTE(JSON_EXTRACT(data, '$.name')) FROM docs WHERE id = 1;
```

路径表达式 `'$.name'` 里的 `$` 代表文档根，`.name` 表示对象属性，`[0]` 表示数组下标，可以链式嵌套（`$.address.city`、`$.hobbies[0]`）。这套语法是 SQL 标准的 JSON Path 子集，学会一次就能用在所有 JSON 函数里。

### 1.2 修改：`SET`、`INSERT`、`REPLACE` 的差异

对 JSON 的修改总是「先读出整个文档、按路径改动、再整体写回」，因此更新一个字段和更新整个文档的成本区别不大。MySQL 提供了三个语义相近但边界不同的写函数：

```sql
-- JSON_SET：路径存在则替换、不存在则新增
UPDATE docs SET data = JSON_SET(data, '$.email', 'zhangsan@example.com') WHERE id = 1;

-- JSON_INSERT：只在路径不存在时插入，已有值不动
UPDATE docs SET data = JSON_INSERT(data, '$.email', 'other@example.com') WHERE id = 1;

-- JSON_REPLACE：只在路径存在时替换，缺字段不新增
UPDATE docs SET data = JSON_REPLACE(data, '$.email', 'new@example.com') WHERE id = 1;

-- JSON_REMOVE：删除指定路径
UPDATE docs SET data = JSON_REMOVE(data, '$.email') WHERE id = 1;
```

三者的区别只在「路径已存在」和「路径不存在」两种情况下的行为——记不清语义时可以想成 upsert / insert-only / update-only。

### 1.3 构造与常用函数

除了读写既有文档，还常有从关系列构造 JSON 结果返回给应用的需要，`JSON_OBJECT` 与 `JSON_ARRAY` 就是干这个的：

```sql
-- 把关系行拼成 JSON 对象返回
SELECT JSON_OBJECT('id', id, 'name', name, 'age', age) FROM users LIMIT 5;

-- 构造 JSON 数组
SELECT JSON_ARRAY('a', 'b', 'c');
```

下表列出了这类文档级函数的常用成员，按用途分组便于记忆：

| 用途 | 函数 |
|------|------|
| 提取 | `JSON_EXTRACT`、`->`、`->>` |
| 修改 | `JSON_SET`、`JSON_INSERT`、`JSON_REPLACE`、`JSON_REMOVE` |
| 构造 | `JSON_OBJECT`、`JSON_ARRAY` |
| 判断 | `JSON_CONTAINS`、`JSON_CONTAINS_PATH`、`JSON_LENGTH`、`JSON_TYPE` |

## 2. 数组的读写

JSON 里的数组不能像关系表那样按行处理，只能靠专门的数组函数：

```sql
INSERT INTO users VALUES
    (1, '{"name": "张三", "hobbies": ["reading", "coding", "gaming"]}');

-- 按下标读取单个元素
SELECT data->>'$.hobbies[0]' FROM users WHERE id = 1;   -- reading

-- 数组长度
SELECT JSON_LENGTH(data, '$.hobbies') FROM users WHERE id = 1;   -- 3

-- 追加到末尾
UPDATE users SET data = JSON_ARRAY_APPEND(data, '$.hobbies', 'swimming') WHERE id = 1;

-- 在指定下标处插入（其他元素后移）
UPDATE users SET data = JSON_ARRAY_INSERT(data, '$.hobbies[0]', 'running') WHERE id = 1;

-- 按下标删除
UPDATE users SET data = JSON_REMOVE(data, '$.hobbies[1]') WHERE id = 1;

-- 是否包含某个值（注意值本身要是合法 JSON，字符串要带双引号）
SELECT * FROM users WHERE JSON_CONTAINS(data->'$.hobbies', '"coding"');
```

如果需要**把数组元素当成多行来处理**（比如按 hobby 统计人数、和其他表 JOIN），单靠上面这些函数不够，得用 `JSON_TABLE`。它把 JSON 数组「行化」成一张临时表，能直接参与 JOIN、GROUP BY：

```sql
-- JSON_TABLE：把 $.hobbies 数组的每个元素展开成一行
SELECT u.id, jt.hobby
FROM users u,
     JSON_TABLE(u.data, '$.hobbies[*]' COLUMNS (
         hobby VARCHAR(50) PATH '$'
     )) AS jt;
```

`JSON_TABLE` 是 8.0 引入的，把 JSON 与关系模型之间的鸿沟填上了一大半——原本要在应用层做的展开逻辑，可以直接放进一条 SQL 里。

## 3. 聚合与查询

反向操作是把多行聚合成一段 JSON，`JSON_ARRAYAGG` 和 `JSON_OBJECTAGG` 分别对应「聚合成数组」和「聚合成对象」：

```sql
-- 每个部门的员工名字，聚合成 JSON 数组
SELECT
    department,
    JSON_ARRAYAGG(name) AS employees
FROM employees
GROUP BY department;

-- 每个部门的「姓名 -> 薪资」映射，聚合成 JSON 对象
SELECT
    department,
    JSON_OBJECTAGG(name, salary) AS salary_map
FROM employees
GROUP BY department;
```

这两个函数常用在「一次查询把主从关系一起拉出来」的场景，避免应用层再做一次分组拼装。

针对 JSON 内部字段的过滤查询，直接用 `->>` 或 `JSON_EXTRACT` 拼在 `WHERE` 里即可：

```sql
-- 用 ->> 与普通字符串比较（推荐写法）
SELECT * FROM users WHERE data->>'$.city' = '北京';

-- 多条件组合
SELECT * FROM users
WHERE data->'$.age' > 20
  AND data->>'$.city' = '北京';
```

问题在于——**上面这条 SQL 默认是全表扫描**。JSON 列本身不能建 B+ 树索引，MySQL 也不会自动为路径表达式建索引。想让 JSON 查询走索引，必须把要查的字段「挑出来」单独索引，这就是下一节要讲的内容。

## 4. 为什么 JSON 列不能直接建索引

B+ 树索引的前提是「键值可比较、可排序」。JSON 是嵌套结构，同一个 JSON 值内部有几十上百个字段，B+ 树无法决定「以哪个字段作为排序键」。所以 MySQL 里 JSON 列的索引，本质上都是**把要查询的路径先提取成一个可比较的值，再对这个值建索引**，只是提取的方式有三种。

### 4.1 生成列 + 索引：最通用的方案

把 JSON 里的某个字段定义成生成列，再在生成列上建普通索引。这种方式的好处是**索引字段是显式命名的**，应用层甚至可以直接 `SELECT city` 而不必写 `data->>'$.city'`：

```sql
ALTER TABLE users
    ADD COLUMN city VARCHAR(50)
    GENERATED ALWAYS AS (JSON_UNQUOTE(JSON_EXTRACT(data, '$.city'))) VIRTUAL;

CREATE INDEX idx_city ON users(city);

-- 查询走 idx_city
SELECT * FROM users WHERE city = '北京';
-- 用原始路径写法也能命中同一个索引
SELECT * FROM users WHERE data->>'$.city' = '北京';
```

`VIRTUAL` 生成列不占行存储、只在读取时计算，但**建了二级索引后值会物化在索引记录里**——这是生成列索引之所以可行的关键。生成列与函数索引的机制在 [生成列与函数索引](./chapter-04-generated-column.md) 里有完整讲解。

### 4.2 函数索引：省掉命名生成列

MySQL 8.0.13 引入函数索引后，可以省掉「先建生成列」这一步，直接对表达式建索引，效果与「生成列 + 索引」等价：

```sql
CREATE INDEX idx_json_name
    ON users((JSON_UNQUOTE(JSON_EXTRACT(data, '$.name'))));

-- 使用时的表达式必须与索引定义中的表达式完全一致
SELECT * FROM users WHERE JSON_UNQUOTE(JSON_EXTRACT(data, '$.name')) = '张三';
```

函数索引写起来短，但**要求查询里的表达式和建索引时的表达式逐字符一致**（多一个空格、换一种等价写法都可能识别不出来）。生产上倾向于用「生成列 + 索引」——列名固定，DBA 和应用都好维护。

### 4.3 多值索引：数组字段的专属方案

前两种方案解决的都是「JSON 里某个标量字段」的问题。如果需要索引的是**数组**——比如「标签为 X 的所有商品」——就必须用多值索引（Multi-Valued Index，MySQL 8.0.17 起支持）。

它的特别之处在于：**一行对应索引里的多条记录**，数组里每个元素都会写一条索引项，因此 `MEMBER OF` 和 `JSON_OVERLAPS` 这类「元素级」查询才能真正走索引：

```sql
CREATE TABLE tags (
    id INT PRIMARY KEY,
    data JSON,
    -- 用 CAST(... AS UNSIGNED ARRAY) 声明这是一个多值索引
    INDEX idx_tags ((CAST(data->'$.tags' AS UNSIGNED ARRAY)))
);

INSERT INTO tags VALUES
    (1, '{"tags": [1, 2, 3]}'),
    (2, '{"tags": [2, 3, 4]}');

-- 查找 tags 数组里含有 2 的行——命中多值索引
SELECT * FROM tags WHERE 2 MEMBER OF (data->'$.tags');

-- 查找 tags 数组与 [2, 5] 有交集的行
SELECT * FROM tags WHERE JSON_OVERLAPS(data->'$.tags', '[2, 5]');
```

三种索引方案对应三类不同的查询形态：标量字段等值/范围查询用生成列或函数索引，数组「包含某元素」查询用多值索引，两者不可互相替代。

## 5. 应用层的集成

从应用侧看，JSON 列在结果集里是普通字符串，写入时也允许绑定字符串参数——多数 ORM 已经把这一层封装好。以 Spring Boot + JPA 为例，只需要一个 `AttributeConverter` 把 Java 对象与 JSON 字符串互转：

```java
@Entity
@Table(name = "users")
public class User {

    @Id
    private Long id;

    // 让 JPA 走自定义转换器，把 Map/DTO 映射为数据库里的 JSON 列
    @Column(columnDefinition = "JSON")
    @Convert(converter = JsonConverter.class)
    private Map<String, Object> profile;
}

@Converter
public class JsonConverter
        implements AttributeConverter<Map<String, Object>, String> {

    private static final ObjectMapper mapper = new ObjectMapper();

    @Override
    public String convertToDatabaseColumn(Map<String, Object> attribute) {
        try {
            return mapper.writeValueAsString(attribute);
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("JSON 序列化失败", e);
        }
    }

    @Override
    public Map<String, Object> convertToEntityAttribute(String dbData) {
        try {
            return mapper.readValue(dbData, new TypeReference<>() {});
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("JSON 反序列化失败", e);
        }
    }
}
```

需要注意的是，走 `AttributeConverter` 意味着**每次读取都会在应用侧反序列化整个文档**——如果只是拿其中一两个字段，直接在 SQL 里用 `data->>'$.xxx'` 提取回来更省事。

## 6. 使用 JSON 的几条原则

JSON 类型很好用，但也很容易被滥用成「不想设计 schema 时的兜底方案」。日常使用中，几条经验值得反复提醒：

**结构化字段就用普通列**。任何一个字段只要「所有记录都有、类型固定、经常参与查询/排序」，就应该做成普通列而非 JSON 里的属性。JSON 的价值在于容纳「不同记录字段不同」的部分。

**高频查询的路径要建索引**。JSON 列本身不能索引，需要通过生成列（推荐）或函数索引把路径值物化出来。没有索引的 `data->>'$.xxx'` 查询就是全表扫描，量一大立刻变成慢查询。

**单行 JSON 不要太大**。虽然 `JSON` 类型的上限和 `LONGTEXT` 一样是 4GB，但一旦超过几十 KB，写入放大、临时表溢出磁盘、网络传输都会变慢。真正的大对象应该放对象存储，数据库里只留引用。

**优先用 `->>` 而不是嵌套函数**。`data->>'$.city'` 与 `JSON_UNQUOTE(JSON_EXTRACT(data, '$.city'))` 完全等价，前者可读性更好，也和多数索引定义习惯保持一致。

**数组查询要用多值索引**。`JSON_CONTAINS` 在没有多值索引时会全表扫描；改用 `MEMBER OF` / `JSON_OVERLAPS` 配合多值索引，才能拿到 B+ 树该有的性能。
