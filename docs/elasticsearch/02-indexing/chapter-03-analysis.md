# 分析器

## 1. 分析器组成

```
Character Filter → Tokenizer → Token Filter
     ↓               ↓            ↓
  字符过滤         分词         词元过滤
```

## 2. 内置分析器

| 分析器 | 说明 |
|--------|------|
| standard | 默认，按单词分词 |
| simple | 按非字母字符分词 |
| whitespace | 按空格分词 |
| keyword | 不分词 |
| pattern | 正则分词 |

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

## 4. 测试分析器

```json
POST /_analyze
{
  "analyzer": "my_analyzer",
  "text": "Elasticsearch 是一个分布式搜索引擎"
}
```

## 5. 常用 Token Filter

| Filter | 作用 | 示例 |
|--------|------|------|
| `lowercase` | 转小写 | `Hello` → `hello` |
| `stop` | 去除停用词 | `[the, is, a, cat]` → `[cat]` |
| `synonym` | 同义词替换 | `手机` → `手机, 手机设备` |
| `stemmer` | 词干提取 | `running` → `run` |
| `edge_ngram` | 边缘 n-gram | `search` → `s, se, sea` |

## 6. 分词器最佳实践

- 索引时用细粒度分词（`ik_max_word`），搜索时用粗粒度（`ik_smart`）
- 同义词建议使用文件方式管理，便于维护
- 自定义分析器上线前务必用 `_analyze` API 验证效果
- 边缘 n-gram 适合搜索自动补全场景
- 停用词需要根据业务场景定制，不要盲目使用默认列表
