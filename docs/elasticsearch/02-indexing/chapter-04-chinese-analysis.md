# ES 分词器与中文分词

> **核心问题**：ES 如何把一段文本拆分成可搜索的词项？分词器由哪几部分组成？中文分词为什么需要 IK，如何配置索引与查询的分词策略？

## 1. 分词解决什么问题？

ES 的全文检索建立在**倒排索引**之上：把文档里的文本拆成一个个词项（Term），再记录"哪个词项出现在哪些文档里"。搜索时，把查询词也拆成词项，去倒排索引里查命中的文档。

这条链路的起点就是**分词**，它直接决定搜索质量：

| 分词结果 | 后果 |
| :-- | :-- |
| 太粗：`"Java编程语言"` → `["Java编程语言"]` | 搜 "Java" 或 "编程" 都找不到 |
| 太细：`"Java编程语言"` → `["J","a","v","a","编","程","语","言"]` | 噪音多、精度差 |
| 合理：`"Java编程语言"` → `["Java","编程","语言"]` | 搜 "Java"、"编程"、"语言" 都能命中 |

英文通常依靠空白、标点和语言分词规则确定词项边界。中文没有天然分隔符，词语边界需要专门算法识别，这正是 IK 分词器要解决的问题。

## 2. 分词发生在两个时机 {#two-phases}

文档写入索引时会进行一次分析，查询文本也会在执行查询时进行分析。两次分析可以使用不同的配置。

```mermaid
flowchart LR
    W["文档 'Java编程语言'"] -->|"索引时"| I["ik_max_word 分词<br>[Java, 编程语言, 编程, 语言]"] -->|"写入"| IDX["倒排索引"]
    Q["查询 '编程'"] -->|"查询时"| S["ik_smart 分词<br>[编程]"] -->|"匹配"| IDX
```

| 时机 | 做什么 | 常见意图 |
| :-- | :-- | :-- |
| **索引时** | 把文档文本拆成词项，写入倒排索引 | 让更多可能的查询词都能命中（召回取向） |
| **查询时** | 把查询词也拆成词项，去倒排索引匹配 | 尽量贴合用户意图（精度取向） |

两次分析的目标和配置不必相同，实践中常见做法是索引用较细切分、查询用较粗切分（见 [§5.3](#index-vs-search)）。但"索引必提召回、查询必提精度"不是普遍规律，实际效果还取决于查询类型、布尔组合与相关性排序。

## 3. 分词器的三层架构 {#analyzer-architecture}

每个分析器（Analyzer，习惯上也称分词器）由三个组件**按顺序**组成，其中负责切分的是分词器（Tokenizer）：

```mermaid
flowchart LR
    Input["原始文本<br>'&lt;p&gt;Java编程很Cool！&lt;/p&gt;'"] --> CF["字符过滤器 Char Filter<br>去除 HTML 标签"]
    CF --> T["分词器 Tokenizer<br>按规则切分词项"]
    T --> TF["词项过滤器 Token Filter<br>小写 / 去停用词 / 同义词"]
    TF --> Output["最终词项"]
```

| 组件 | 作用 | 示例 |
| :-- | :-- | :-- |
| **Char Filter** | 预处理原始字符（去 HTML、字符替换） | `<p>Hello</p>` → `Hello` |
| **Tokenizer** | 把字符流切成词项（**必须且唯一**） | `Hello World` → `[Hello, World]` |
| **Token Filter** | 对词项做后处理（小写、去停用词、同义词） | `[Hello, World]` → `[hello, world]` |

三者中 **Tokenizer 是必须的**，Char Filter 和 Token Filter 可以有零个或多个。Tokenizer 决定初始切分结果，Char Filter 与 Token Filter 会在分析链中继续修改文本或词项；中文分词效果还取决于分词器的词典与切分策略。

## 4. ES 内置分词器

### 4.1 常用内置分词器对比

| 分词器 | 分词规则 | 示例输入 | 分词结果 | 适用场景 |
| :-- | :-- | :-- | :-- | :-- |
| **standard** | 按 Unicode 文本边界切分，转小写 | `"Java编程 Very Cool"` | `[java, 编, 程, very, cool]` | 默认分词器，英文效果好，**不识别中文词语边界** |
| **simple** | 按非字母字符分割，转小写 | `"Hello-World 123"` | `[hello, world]` | 简单英文文本 |
| **whitespace** | 按空格分割，不转小写 | `"Hello World"` | `[Hello, World]` | 保留大小写 |
| **keyword** | 不分词，整段作为一个词项 | `"Hello World"` | `[Hello World]` | 精确匹配（ID、邮箱） |
| **pattern** | 按正则分割 | `"foo-bar_baz"` | `[foo, bar_baz]`（按 `\W+`，`_` 属单词字符不切分） | 自定义分隔符 |

### 4.2 用 _analyze 测试分词

```bash
GET /_analyze
{
  "analyzer": "standard",
  "text": "Java编程语言非常强大"
}
# tokens: [java, 编, 程, 语, 言, 非, 常, 强, 大]
```

> ⚠️ `standard` 按 Unicode 文本边界切分，不提供中文词语识别能力。对无空格的中文输入，通常会把每个字切成独立词项。搜 "编程" 时实际切成 "编" 和 "程" 两个字分别匹配，语义区分能力弱，可能引入大量语义无关的结果。

## 5. IK 中文分词器

IK 是 ES 生态最常用的中文分词插件，用**词典匹配算法**切词——维护一个中文词典，把文本与词典里的词做最大匹配，再通过消歧选出最优切分路径。

### 5.1 安装

```bash
# 版本必须与 ES 版本一致（以下为模板，请替换为实际版本号）
# 核对步骤：1) 确认 ES 版本；2) 在 GitHub Releases 页面确认对应插件版本存在
./bin/elasticsearch-plugin install https://github.com/medcl/elasticsearch-analysis-ik/releases/download/v8.x.x/elasticsearch-analysis-ik-8.x.x.zip
# 安装后重启 ES
```

### 5.2 两种分词模式

| 模式 | 分词器 | 策略 | 常见用途 |
| :-- | :-- | :-- | :-- |
| **细粒度** | `ik_max_word` | 尽可能细粒度切分，输出较多词项 | **索引时**（召回取向） |
| **粗粒度** | `ik_smart` | 较粗粒度切分，输出较少词项 | **查询时**（精度取向） |

```bash
GET /_analyze
{ "analyzer": "ik_max_word", "text": "Java编程语言非常强大" }
# [java, 编程语言, 编程, 语言, 非常, 强大] —— "编程语言" 又被拆出 "编程"、"语言"

GET /_analyze
{ "analyzer": "ik_smart", "text": "Java编程语言非常强大" }
# [java, 编程语言, 非常, 强大] —— 切分较粗，不再拆 "编程语言"
```

### 5.3 索引时 vs 查询时的搭配 {#index-vs-search}

呼应 [§2](#two-phases) 的两个时机：一种常见实践是索引用 `ik_max_word` 多切分（"编程语言" 同时产生 "编程语言"、"编程"、"语言" 三个词项），查询用 `ik_smart` 少切分（"编程" 只产生 "编程" 一个词项）。

> ⚠️ **注意**：这不是普遍成立的优化规律。索引时增加词项可以扩大部分查询的匹配范围，但也可能引入不符合业务语义的匹配；查询时减少切分不一定提高精确度，具体结果还取决于查询类型（如 `match_phrase` 依赖词项位置）、布尔组合方式和相关性排序。最终选择应由业务查询模式决定，建议用 `_analyze` 和实际 `_search` 对比验证，而非机械套用固定组合。

```bash
PUT /articles
{
  "mappings": {
    "properties": {
      "title": {
        "type": "text",
        "analyzer": "ik_max_word",      # 索引时
        "search_analyzer": "ik_smart"  # 查询时
      },
      "content": {
        "type": "text",
        "analyzer": "ik_max_word",
        "search_analyzer": "ik_smart"
      }
    }
  }
}
```

基于上述配置和分词结果，预期行为如下（实际命中还取决于查询类型和操作符）：

- 索引 "Java编程语言" 时，倒排索引里同时有 `java`、`编程语言`、`编程`、`语言` 四个词项。
- 搜 "编程" 时（`match` 查询），查询词被 `ik_smart` 切成 `[编程]`，能命中倒排索引中的 "编程" 词项。
- 搜 "编程语言" 时（`match` 查询），切成 `[编程语言]`，能命中倒排索引中的 "编程语言" 词项。

> 建议用 `_search` 实际验证：不同查询类型（`match` vs `match_phrase`）、不同操作符（`or` vs `and`）会产生不同的命中结果。

### 5.4 自定义词典

IK 依赖内置词典，但专业术语、新词、品牌名常不在词典里，需要扩展。

**本地词典**：

```xml
<!-- 配置文件通常位于 plugins/analysis-ik/config/ 目录下，
     具体路径随插件版本与部署方式不同 -->
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE properties SYSTEM "http://java.sun.com/dtd/properties.dtd">
<properties>
    <comment>IK Analyzer 扩展配置</comment>
    <entry key="ext_dict">custom/my_dict.dic</entry>
    <entry key="ext_stopwords">custom/my_stopwords.dic</entry>
</properties>
```

```txt
# custom/my_dict.dic（每行一个词，UTF-8 编码）
SpringBoot
微服务
分布式锁
布隆过滤器
```

**远程词典（热更新，无需重启）**：

```xml
<entry key="remote_ext_dict">http://your-server/api/dict</entry>
<entry key="remote_ext_stopwords">http://your-server/api/stopwords</entry>
```

> 远程词典接口返回纯文本（每行一个词），并通过 `Last-Modified` 或 `ETag` 响应头告知 IK 是否有更新，IK 定期轮询。
>
> 生产环境中，集群内参与索引和查询的节点需保持词典版本一致，否则同一文本可能在不同节点产生不同的分析结果。

## 6. 自定义分词器

内置和 IK 都不满足时，可以自定义：自己选 Char Filter、Tokenizer、Token Filter 组装。本节各示例相互独立，请在各自独立的索引上分别执行，避免同名索引重复创建冲突。

### 6.1 组装一个自定义分词器

```bash
PUT /my_index
{
  "settings": {
    "analysis": {
      "char_filter": {
        "my_char_filter": { "type": "mapping", "mappings": ["& => and", "| => or"] }
      },
      "tokenizer": {
        "my_tokenizer": { "type": "pattern", "pattern": "[\\s,;]+" }
      },
      "filter": {
        "my_stopwords": { "type": "stop", "stopwords": ["的", "了", "是", "在", "和"] }
      },
      "analyzer": {
        "my_analyzer": {
          "type": "custom",
          "char_filter": ["my_char_filter"],
          "tokenizer": "my_tokenizer",
          "filter": ["lowercase", "my_stopwords"]
        }
      }
    }
  }
}
```

结构上就是 [§3](#analyzer-architecture) 的三层：`char_filter` → `tokenizer` → `filter`。

可用 `_analyze` 验证分析链的实际输出：

```bash
POST /my_index/_analyze
{
  "analyzer": "my_analyzer",
  "text": "Java & Redis; 数据在这里"
}
# 可核对：& 是否转成 and、是否按空格/逗号/分号切分、英文是否转小写；中文部分因 pattern 不切词而保持整段
```

### 6.2 同义词过滤器

```bash
PUT /my_index
{
  "settings": {
    "analysis": {
      "filter": {
        "my_synonyms": {
          "type": "synonym",
          "synonyms": ["Java, java, JAVA", "手机, 手机设备, mobile phone"]
        }
      },
      "analyzer": {
        "ik_with_synonyms": {
          "type": "custom",
          "tokenizer": "ik_max_word",
          "filter": ["lowercase", "my_synonyms"]
        }
      }
    }
  }
}
```

> ⚠️ **同义词解析与分词器的兼容性**：ES 从 6.0 起，同义词过滤器使用它**之前**的分析链（tokenizer + 前置 filter）解析同义词规则。当 tokenizer 是 `ik_max_word` 时，规则中的中文文本也会被 `ik_max_word` 切分，可能影响多词同义词规则。例如 `手机, 手机设备` 中的 "手机设备" 若被切成 "手机" 和 "设备"，规则的匹配行为会随之改变。多词同义词还涉及词项位置与短语匹配，不能只检查最终词项是否出现。
>
> 建议：① 同义词规则尽量使用单字或已确认不会被切分的词；② 查询时处理多词同义词优先评估 `synonym_graph` 过滤器；③ 用 `_analyze` 验证规则解析，再用实际查询验证匹配行为。

同义词较多时建议改用文件维护，将 filter 的 `synonyms` 换成 `synonyms_path` 指向文件路径（与内联 `synonyms` 是两种配置方式，二选一）：

```txt
# config/analysis/synonyms.txt
# 等价同义词
手机, 手机设备, mobile phone
# 单向映射
笔记本电脑 => laptop
```

### 6.3 拼音分词（拼音搜索）

```bash
# 安装拼音插件（版本号需与 ES 版本一致，以下为模板，请替换为实际版本）
# 核对步骤：1) 确认 ES 版本；2) 在 GitHub Releases 页面确认对应插件版本存在
./bin/elasticsearch-plugin install https://github.com/medcl/elasticsearch-analysis-pinyin/releases/download/v8.x.x/elasticsearch-analysis-pinyin-8.x.x.zip

PUT /my_index
{
  "settings": {
    "analysis": {
      "filter": {
        "my_pinyin": {
          "type": "pinyin",
          "keep_full_pinyin": true,
          "keep_joined_full_pinyin": true,
          "keep_first_letter": true,
          "keep_original": true,
          "remove_duplicated_term": true
        }
      },
      "analyzer": {
        "ik_pinyin_analyzer": {
          "type": "custom",
          "tokenizer": "ik_max_word",
          "filter": ["my_pinyin"]
        }
      }
    }
  }
}
# 本节只演示拼音分析链的 settings 配置；字段映射需与该 settings 放在同一索引，完整落地见 §7.1
# 可用 _analyze 直接验证分析器（无需建字段）：GET /my_index/_analyze { "analyzer": "ik_pinyin_analyzer", "text": "编程" }
```

## 7. Mapping 中的分词器配置

### 7.1 字段级配置与 multi-field

```bash
PUT /articles
{
  "settings": {
    "analysis": {
      "filter": {
        "my_pinyin": {
          "type": "pinyin",
          "keep_full_pinyin": true,
          "keep_joined_full_pinyin": true,
          "keep_first_letter": true,
          "keep_original": true,
          "remove_duplicated_term": true
        }
      },
      "analyzer": {
        "ik_pinyin_analyzer": {
          "type": "custom",
          "tokenizer": "ik_max_word",
          "filter": ["my_pinyin"]
        }
      }
    }
  },
  "mappings": {
    "properties": {
      "title": { "type": "text", "analyzer": "ik_max_word", "search_analyzer": "ik_smart" },
      "tags": { "type": "keyword" },
      "content": {
        "type": "text",
        "analyzer": "ik_max_word",
        "search_analyzer": "ik_smart",
        "fields": {
          "pinyin": { "type": "text", "analyzer": "ik_pinyin_analyzer" }
        }
      }
    }
  }
}
```

`fields` 即 multi-field：同一个字段值，用不同方式建多个倒排索引，一个字段同时支持中文搜索和拼音搜索。

### 7.2 text vs keyword

| 类型 | 是否分词 | 适用场景 | 支持的查询 |
| :-- | :-- | :-- | :-- |
| **text** | ✅ 分词建倒排索引 | 全文搜索（标题、内容） | `match`、`match_phrase` |
| **keyword** | ❌ 整值作为一个词项 | 精确匹配（ID、状态、标签） | `term`、`terms`、`range` |

```bash
# ⚠️ term 不分析查询文本，直接匹配词项；text 字段的完整原文通常不构成独立词项，可能查不到
GET /articles/_search
{ "query": { "term": { "title": "Java编程" } } }

# ✅ 全文匹配 text 字段用 match（会先分析查询文本）
GET /articles/_search
{ "query": { "match": { "title": "Java编程" } } }

# ✅ 精确匹配完整值用 keyword 字段 + term
GET /articles/_search
{ "query": { "term": { "tags": "Java" } } }
```

## 8. 分词器选型指南

```mermaid
flowchart TD
    Start["选择分词器"] --> Lang{"文本语言？"}
    Lang -->|"纯英文"| EN["standard"]
    Lang -->|"中文"| CN{"需要什么功能？"}
    CN -->|"基础中文分词"| IK["ik_max_word + ik_smart"]
    CN -->|"中文 + 拼音"| Pinyin["IK + Pinyin 插件"]
    CN -->|"中文 + 同义词"| Syn["IK + synonym 过滤器"]
    Lang -->|"混合语言"| Mix["IK（同时支持中英文）"]
```

| 场景 | 推荐方案 |
| :-- | :-- |
| 英文内容搜索 | `standard`（默认） |
| 中文内容搜索 | `ik_max_word`（索引）+ `ik_smart`（查询） |
| 中文 + 拼音搜索 | IK + Pinyin 插件 + multi-field |
| 中文 + 同义词 | IK + synonym 过滤器 |
| 精确匹配（ID、标签） | `keyword`，不分词 |
| 日志分析 | `pattern`，按自定义分隔符 |

## 9. 常见问题

**Q：为什么 standard 分词器对中文效果差？**

> `standard` 不识别中文词语边界，无空格的中文输入通常被切成单字，语义区分能力弱（见 §4.2 的 `_analyze` 示例）。需要中文词语级检索时改用 IK。

**Q：ik_max_word 和 ik_smart 怎么选？**

> 常见起点是索引用 `ik_max_word`、查询用 `ik_smart`，通过 `analyzer` 和 `search_analyzer` 分别配置。但这并非普遍规律，最终选择应由业务查询模式决定。详见 [§5.3](#index-vs-search)。

**Q：如何让 IK 识别新词？**

> ① 本地词典：`IKAnalyzer.cfg.xml` 里配 `ext_dict` 指向词典文件；② 远程词典：配 `remote_ext_dict` 指向 HTTP 接口，IK 定期轮询热更新，无需重启。

**Q：如何实现拼音搜索？**

> 装 elasticsearch-analysis-pinyin 插件，自定义分词器组合 IK + Pinyin，再用 multi-field 让一个字段同时支持中文和拼音搜索。

**Q：修改分词器后，已有数据要重新索引吗？**

> 取决于改的是哪一部分。修改**索引时**分析器，已有文档的倒排索引不会自动重建，若要让旧数据按新规则分词，需要新建索引并 Reindex。只修改**查询时**分析器，不影响已有倒排索引，但会改变后续查询文本的分析结果。修改 IK 词典，同样不会自动重建已有词项。上线前应分别验证索引时与查询时的分析结果，再决定是否需要 Reindex。
