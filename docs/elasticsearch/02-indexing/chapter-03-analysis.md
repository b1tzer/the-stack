# 分析器

## 1. 分析器组成

```txt
Character Filter → Tokenizer → Token Filter
     ↓               ↓            ↓
  字符过滤         分词         词元过滤
```

## 2. 内置分析器

| 分析器 | 主要行为 |
| :-- | :-- |
| standard | 默认分析器，按 Unicode 词边界切分并转为小写，不配置停用词 |
| simple | 按非字母字符切分，并将词项转为小写 |
| whitespace | 按空白字符切分，不自动转小写 |
| keyword | 将整个输入作为一个词项，不进行切分 |
| pattern | 按正则表达式切分，默认转为小写，可配置停用词过滤 |

> 上表是内置**分析器**（Analyzer），不是分词器（Tokenizer）。分析器由字符过滤器、分词器、词元过滤器组成，内置分析器封装了预设的处理流程；需要改变流程时，按第 3 节的方式组合组件自定义。

## 3. 自定义分析器

```json
PUT /my-index
{
  "settings": {
    "analysis": {
      "analyzer": {
        "my_analyzer": {
          "type": "custom",
          "tokenizer": "standard",
          "filter": ["lowercase", "my_stop"]
        }
      },
      "filter": {
        "my_stop": {
          "type": "stop",
          "stopwords": ["的", "了", "是"]
        }
      }
    }
  }
}
```

> **注意**：`standard` tokenizer 基于 Unicode 文本分割算法（UAX #29）识别词边界，对英文按单词边界分词，但对连续汉字会**逐字切分**（如 `"搜索引擎"` → `[搜, 索, 引, 擎]`），不能识别中文词语边界。中文场景需要安装第三方分词插件（如 IK），详见 [ES 分词器与中文分词](./chapter-04-chinese-analysis.md)。

## 4. 测试分析器

```json
POST /my-index/_analyze
{
  "analyzer": "my_analyzer",
  "text": "Elasticsearch 是一个分布式搜索引擎"
}
```

上述请求的输出如下（`standard` tokenizer 对中文逐字切分，停用词 `是` 被移除后，后续词项的位置保留了空档）：

```json
{
  "tokens": [
    { "token": "elasticsearch", "position": 0 },
    { "token": "一", "position": 2 },
    { "token": "个", "position": 3 },
    { "token": "分", "position": 4 },
    { "token": "布", "position": 5 },
    { "token": "式", "position": 6 },
    { "token": "搜", "position": 7 },
    { "token": "索", "position": 8 },
    { "token": "引", "position": 9 },
    { "token": "擎", "position": 10 }
  ]
}
```

> 可以看到停用词 `是` 被移除，后续词项的位置保留了相应的位置增量。`standard` tokenizer 将这段中文切成单字，无法提供适合中文语义检索的词语边界。查询文本同样会经过分析，被拆成单字词项；单字词项的区分能力弱，而 `match` 查询默认 `operator` 为 `or`，允许文档只匹配部分词项，进一步扩大了匹配范围，容易引入大量无关结果。中文分词方案见 [ES 分词器与中文分词](./chapter-04-chinese-analysis.md)。

## 5. 常用 Token Filter

| Filter | 作用 | 示例 | 注意事项 |
| :-- | :-- | :-- | :-- |
| `lowercase` | 转小写 | `Hello` → `hello` | 对 CJK 字符无影响 |
| `stop` | 去除停用词 | `[the, is, a, cat]` → `[cat]` | 未配置停用词表时默认使用英语停用词表；中文需显式配置词表，避免误删有业务意义的词 |
| `synonym` | 同义词替换 | `手机` → `手机, 手机设备` | 索引时处理多词同义词可用 `synonym`；搜索时处理多词同义词优先使用 `synonym_graph`，以保留短语查询所需的位置信息 |
| `stemmer` | 词干提取 | `running` → `run`（英语 Porter Stemmer） | 效果取决于语言和算法；不同语言的词干提取行为差异很大 |
| `edge_ngram` | 边缘 n-gram | `search` → `s, se, sea`（部分输出） | 常用于前缀自动补全：索引时生成前缀词项，搜索时用标准分析器，避免对查询词再次展开导致匹配过宽 |

## 6. 分词器最佳实践

- 中文场景可以把索引侧用 `ik_max_word`、搜索侧用 `ik_smart` 作为一种候选方案。前者倾向生成更细的词项集合，后者倾向生成更少的词项，但召回率与精确率最终取决于文档内容、查询方式以及检索结果及其排序，不能仅凭分词数量判断，应通过代表性查询比较不同配置的实际结果再决定。IK 是第三方插件，需单独安装。详见 [ES 分词器与中文分词](./chapter-04-chinese-analysis.md#index-vs-search)。
- 同义词可用文件方式管理，但需保证各节点文件一致并规划更新生效方式；多词同义词在搜索时优先使用 `synonym_graph` 过滤器，索引时处理同义词还需考虑重建索引和词项一致性。
- 自定义分析器上线前，用 `_analyze` 检查代表性文本的词项、位置和大小写是否符合预期；涉及同义词与停用词时，再用实际查询验证召回结果，避免只验证分词输出而遗漏查询行为。
- 自动补全需要让用户输入的部分前缀匹配到完整词项：索引时用 `edge_ngram` 生成前缀词项，搜索时用标准分析器处理输入，让查询词直接匹配已生成的前缀，避免搜索侧再次展开前缀而扩大匹配范围。
- 停用词需按业务定制：确认删除后不会丢失业务需要的检索能力，不要盲目使用默认（英语）列表。

> 分析器决定文本如何转换为词项，倒排索引记录词项与文档的对应关系，查询条件决定如何利用这些词项匹配和排序文档。三者共同影响搜索结果。倒排索引的存储结构见 [倒排索引](./chapter-06-inverted-index.md)，中文分词与查询验证见 [ES 分词器与中文分词](./chapter-04-chinese-analysis.md)。
