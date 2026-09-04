# MySQL 数据类型速查

## 数值类型

| 类型 | 字节 | 范围 / 说明 |
| :-- | :-- | :-- |
| `TINYINT` | 1 | -128 ~ 127 / 0 ~ 255（UNSIGNED） |
| `SMALLINT` | 2 | -32768 ~ 32767 |
| `MEDIUMINT` | 3 | -8388608 ~ 8388607 |
| `INT` | 4 | -2^31 ~ 2^31-1 |
| `BIGINT` | 8 | -2^63 ~ 2^63-1 |
| `FLOAT` | 4 | 单精度浮点，精度约 7 位 |
| `DOUBLE` | 8 | 双精度浮点，精度约 15 位 |
| `DECIMAL(M,D)` | 变长 | 精确小数，M=总位数，D=小数位 |

## 字符串类型

| 类型 | 最大长度 | 说明 |
| :-- | :-- | :-- |
| `CHAR(N)` | 255 字节 | 定长，适合固定长度（如 MD5） |
| `VARCHAR(N)` | 65535 字节 | 变长，适合长度不固定的数据 |
| `TEXT` | 65535 字节 | 长文本，不能有默认值 |
| `MEDIUMTEXT` | 16M | 中等长度文本 |
| `LONGTEXT` | 4G | 超长文本 |
| `BLOB` | 65535 字节 | 二进制数据 |
| `JSON` | 1G | JSON 文档（5.7.8+） |

## 日期时间类型

| 类型 | 格式 | 说明 |
| :-- | :-- | :-- |
| `DATE` | YYYY-MM-DD | 日期 |
| `TIME` | HH:MM:SS | 时间 |
| `DATETIME` | YYYY-MM-DD HH:MM:SS | 日期时间，不受时区影响 |
| `TIMESTAMP` | YYYY-MM-DD HH:MM:SS | 时间戳，自动转 UTC 存储 |
| `YEAR` | YYYY | 年份 |

## 选型原则

- 主键用 `BIGINT AUTO_INCREMENT`，不用 UUID（索引性能差）
- 金额用 `DECIMAL`，不用 FLOAT/DOUBLE
- 布尔用 `TINYINT(1)`，不用 BOOLEAN
- 枚举用 `TINYINT` + 代码映射，慎用 `ENUM` 类型
- 时间优先 `DATETIME`，需要时区感知用 `TIMESTAMP`
- 能用 `VARCHAR` 不用 `TEXT`，TEXT 无法完整建索引
