# 全文索引

在长文本里搜关键词，最直觉的写法是 `WHERE content LIKE '%MySQL%'`。这种写法在几十万行以上的表上就会开始变慢，且无论加什么普通索引都救不回来——B+ 树索引只对「前缀匹配」有效，`%keyword%` 这种左右都开放的模式必然退化为全表扫描。

全文索引解决的是这一类问题。它在建索引时先把文本按解析器（parser）切成一个个词（token），再为每个词建立「词 → 包含该词的行」的映射，也就是倒排索引。查询时不再扫文本，而是查这张映射表，因此性能与文档总量近似解耦，只与命中词条数量相关。

InnoDB 从 5.6 起原生支持全文索引，MyISAM 一直支持。除非有特殊历史原因，本文默认讨论 InnoDB。

::: warning 版本要求
全文索引不同能力对应的版本节点差异明显：

| 特性 | 起始版本 |
| :-- | :-- |
| MyISAM 全文索引 | 3.23（长期支持） |
| InnoDB 全文索引 | 5.6.4 |
| ngram 内置解析器（中日韩语言分词） | 5.7.6 |
| 可安装的 MeCab 解析器插件（日文） | 5.7.6 |

5.5 及以下版本不能在 InnoDB 表上建全文索引，只能改用 MyISAM 或依赖外部搜索引擎。中文场景必须使用 5.7.6+ 并显式指定 `WITH PARSER ngram`，否则默认解析器按空格分词，对中文完全无效。
:::

## 1. 建立与查询

全文索引可以在建表时随列一起声明，也可以事后 `ALTER` 加上。索引可以覆盖一列，也可以覆盖多列——多列索引在查询时必须把所有涵盖的列一次性写进 `MATCH()` 括号里，写法必须与索引定义完全一致，否则 MySQL 不会命中该索引。

```sql
CREATE TABLE articles (
    id INT PRIMARY KEY AUTO_INCREMENT,
    title VARCHAR(200),
    content TEXT,
    FULLTEXT INDEX ft_title_content (title, content)
) ENGINE=InnoDB;

-- 查询：MATCH 列表必须与索引列一致
SELECT * FROM articles
WHERE MATCH(title, content) AGAINST('MySQL 优化');
```

`MATCH() AGAINST()` 既是「过滤条件」也是「相关度打分」。放在 `WHERE` 里筛选行，放在 `SELECT` 里可以拿到一个 `float` 类型的相关度分数，通常按这个分数倒序返回。同一个 `MATCH() AGAINST()` 表达式出现两次时 MySQL 只计算一次，不用担心重复开销。

## 2. 三种搜索模式

`AGAINST()` 支持三种模式，语义与适用场景差别很大。

**自然语言模式**是默认模式，把查询串当作一段自然语言处理。MySQL 会拆词、丢弃停用词与短词，然后按 TF-IDF 类算法给每篇文档打分。查询串里的空格代表「或」而非「且」——`AGAINST('MySQL 优化')` 会返回包含「MySQL」或「优化」的所有文档，而不是要求两个词同时出现。这个模式适合搜索框场景：用户输入一句话，你希望按相关度返回最匹配的若干条。

**布尔模式**在查询串里引入操作符，把「必须包含」「必须不包含」「短语匹配」「前缀匹配」显式表达出来。

```sql
SELECT * FROM articles
WHERE MATCH(title, content) AGAINST('+MySQL +优化 -PostgreSQL' IN BOOLEAN MODE);
```

上面的查询要求同时包含「MySQL」和「优化」，且不能出现「PostgreSQL」。常用操作符如下：

| 操作符 | 语义 |
|--------|------|
| `+词`  | 必须包含 |
| `-词`  | 必须不包含 |
| `词*`  | 前缀匹配 |
| `"短语"` | 精确短语（词与词之间保持顺序） |
| `>词` / `<词` | 提高 / 降低相关度权重 |
| `(...)` | 分组，可与 `+ -` 组合 |

布尔模式不做停用词与短词过滤（受配置影响），也不会隐式拆词，因此更适合「后端拼查询、前端不给用户看操作符」的严格检索场景。

**查询扩展模式**（`WITH QUERY EXPANSION`）先按自然语言模式跑一次，取头部几条结果里的高频词作为新的查询词再跑一次，把结果合并返回。它专门为「结果太少、希望做同义扩展」的场景设计，代价是可能带回噪声，一般不作为默认。

## 3. 中文分词：ngram 解析器

全文索引的效果与解析器强绑定。InnoDB 内置的默认解析器按空格、标点等分隔符切词，这套规则对英文完全够用，但对没有词分隔符的中文完全无效——整段「MySQL 全文索引原理」会被切成 `MySQL` 和 `全文索引原理` 两个词，用户搜「全文索引」反而查不到。

MySQL 5.7.6 起内置了 ngram 解析器专门处理中日韩文本。它的思路很直接：不做语义分词，只按固定长度切窗口。窗口大小由 `ngram_token_size` 控制（默认 2），2 表示所有连续 2 字的组合都进倒排索引，「全文索引」会被切成 `全文`、`文索`、`索引` 三个词。查询时同样按 2 字切窗口再去匹配。

这个机制的直接后果是：**用户查询词的字数必须不小于 `ngram_token_size`**。当 `ngram_token_size = 2` 时，搜单字（比如「书」）永远返回空——查询词被切成不了任何 2 字组合。若业务上确实需要支持单字查询，只能把 `ngram_token_size` 设为 1，但会显著放大索引体积。默认值 2 在多数场景下是可用的折中。

使用 ngram 必须在创建索引时显式指定 `WITH PARSER ngram`，配置文件里改 `ngram_token_size` 只影响解析粒度，不会自动把现有的默认解析器索引改成 ngram 索引。

```sql
CREATE TABLE articles (
    id INT PRIMARY KEY AUTO_INCREMENT,
    title VARCHAR(200),
    content TEXT,
    FULLTEXT INDEX ft_search (title, content) WITH PARSER ngram
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

SELECT * FROM articles
WHERE MATCH(title, content) AGAINST('数据库优化');
```

如果一开始建了默认解析器的索引再想切换到 ngram，唯一的办法是 `DROP INDEX` 后 `ADD FULLTEXT INDEX ... WITH PARSER ngram`，索引会全量重建。

## 4. 停用词与最小词长

即使解析器切出了词，MySQL 也不会把每个词都塞进索引。有两道过滤：**停用词表**过滤 `the / is / at` 这类没有区分度的高频词；**最小词长**过滤过短的词。默认 InnoDB 的 `innodb_ft_min_token_size = 3`，意味着长度小于 3 的英文词不进索引——这就是为什么直接用全文索引搜 `AI`、`Go` 常常没结果。

停用词表可以查询与自定义：

```sql
-- 查看 InnoDB 默认停用词
SELECT * FROM information_schema.innodb_ft_default_stopword;

-- 自定义停用词表
SET GLOBAL innodb_ft_server_stopword_table = 'db_name/stopword_table';
```

调整 `innodb_ft_min_token_size` 或停用词表后，必须重建索引才生效。这两个参数在设计早期就要定，避免上线后重建。

## 5. 常见坑与性能注意

**LIKE 与全文索引的语义并不等价**。`LIKE '%mysql%'` 是子串匹配，`match('mysql')` 是词匹配——「mysqld」这个词包含 `mysql` 子串但不是 `mysql` 词本身，`LIKE` 能匹上而全文索引不能。做搜索前想清楚需要的是哪种语义。

**多列全文索引的写法必须严格对齐**。索引定义为 `FULLTEXT(title, content)`，那么查询必须 `MATCH(title, content) AGAINST(...)`。`MATCH(title)` 单列查询在多列索引上跑不到——需要单独再建一个单列索引。

**全文索引会占用不小的空间**，尤其是 ngram + 中文语料。倒排索引里每个词都要维护 doc list，ngram 又把粒度切得很细，实际索引大小可能达到原始文本的一半到两倍。上线前用真实语料估算一遍。

**写入放大**。全文索引的每次插入都要更新倒排结构，高频写入表（比如日志、留言）会明显变慢。InnoDB 通过 FTS 缓存（`innodb_ft_cache_size`）把新写入的分词结果暂存内存，达到阈值再批量刷入索引，可以缓解但不能消除写放大。

**排序默认按相关度倒序**。当 `MATCH() AGAINST()` 出现在 `WHERE` 里而没有显式 `ORDER BY` 时，MySQL 会隐式按相关度倒序返回。如果加了自己的 `ORDER BY`（比如按时间），相关度排序就失效，需要在 `SELECT` 列表里显式取分数再自己排。

## 6. 什么时候用 Elasticsearch

MySQL 全文索引最大的价值是「不引入额外组件」。数据、事务、搜索都在同一个库里，写入即可搜、无需同步、无需二次一致性保障。对于「站内文章搜索」「简单产品名搜索」这类量级不大、需求不复杂的场景，全文索引足够，且运维成本远低于额外的搜索服务。

但它有明确的天花板。**分词能力**只到 ngram 这一层——不做词性分析、不做同义词、不做拼写纠错、不支持 IK / Jieba 这类语义分词器。**排序算法**只有 MySQL 内置的相关度公式，无法自定义打分与召回策略。**大规模并发**下，倒排索引在 InnoDB 里的锁与 MVCC 开销明显高于 Elasticsearch 的 Lucene 引擎。**跨字段加权、聚合、分面搜索**这些搜索场景的常规需求，MySQL 全文索引都不支持或很难做。

当你开始需要「同义词映射」「拼写建议」「按用户行为个性化排序」「亿级文档下的低延迟检索」这类需求时，就该考虑把搜索独立到 Elasticsearch 或类似方案。此时 MySQL 只作数据源，通过 Canal / Debezium 等 CDC 工具把变更同步到搜索集群，业务查询走搜索集群、写入仍走 MySQL。

## 7. 一个完整的例子

下面这段是「文章检索」的常见落地：主键与业务字段用普通 B+ 树索引，正文与标题用 ngram 全文索引，检索时把布尔模式与业务过滤条件组合起来。

```sql
CREATE TABLE articles (
    id INT PRIMARY KEY AUTO_INCREMENT,
    title VARCHAR(200) NOT NULL,
    content TEXT NOT NULL,
    category_id INT,
    status TINYINT DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FULLTEXT INDEX ft_search (title, content) WITH PARSER ngram,
    INDEX idx_category_status (category_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

SELECT
    id,
    title,
    LEFT(content, 200) AS summary,
    MATCH(title, content) AGAINST('+MySQL +优化' IN BOOLEAN MODE) AS relevance
FROM articles
WHERE MATCH(title, content) AGAINST('+MySQL +优化' IN BOOLEAN MODE)
  AND status = 1
ORDER BY relevance DESC
LIMIT 20;
```

这条查询里同一个 `MATCH() AGAINST()` 写了两次，一次作过滤、一次取分数——MySQL 只计算一次，不必担心。业务条件 `status = 1` 放在全文索引命中之后再过滤，因为全文索引先给出候选集，走覆盖索引扫描比反过来要快。
