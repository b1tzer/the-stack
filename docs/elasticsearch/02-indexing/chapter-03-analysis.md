# 分析器

> 分析器（Analyzer）决定了文本如何被分词。分词质量直接影响搜索的准确性和召回率。

## 1. 分析器的组成

```text
文本 → Character Filter → Tokenizer → Token Filter → 词项
       (字符过滤)        (分词器)      (词项过滤)
```

| 组件 | 作用 | 示例 |
|------|------|------|
| Character Filter | 预处理文本（去HTML、替换字符） | 去除 `<b>` 标签 |
| Tokenizer | 将文本拆分为词项 | "Hello World" → ["Hello", "World"] |
| Token Filter | 对词项后处理（小写、同义词、停用词） | "Hello" → "hello" |

## 2. 内置分析器

| 分析器 | 说明 | 适用场景 |
|--------|------|----------|
| standard | 默认，按 Unicode 文本分割 | 英文通用 |
| simple | 按非字母字符分割，转小写 | 简单文本 |
| whitespace | 按空格分割 | 保留大小写 |
| keyword | 不分词，整个文本作为一个词项 | 精确匹配 |
| pattern | 按正则分割 | 自定义分割规则 |
| language | 针对特定语言优化 | 英文、法文等 |

## 3. 分词对比

```text
输入："Hello World, I'm a Developer!"

standard:   ["hello", "world", "i'm", "a", "developer"]
simple:     ["hello", "world", "i", "m", "a", "developer"]
whitespace: ["Hello", "World,", "I'm", "a", "Developer!"]
keyword:    ["Hello World, I'm a Developer!"]
```

## 4. 自定义分析器

```json
PUT /my-index
{
  "settings": {
    "analysis": {
      "analyzer": {
        "my_analyzer": {
          "type": "custom",
          "tokenizer": "standard",
          "char_filter": ["html_strip"],
          "filter": ["lowercase", "stop", "snowball"]
        }
      }
    }
  }
}
```

## 5. 查看分词结果

```json
POST /_analyze
{
  "analyzer": "standard",
  "text": "Hello World"
}

// 结果
{
  "tokens": [
    { "token": "hello", "start_offset": 0, "end_offset": 5 },
    { "token": "world", "start_offset": 6, "end_offset": 11 }
  ]
}
```

## 6. 中文分词

ES 默认的 standard 分析器对中文支持不好（按字分割，不是按词）。需要使用 IK 分词器等插件。

详见 [中文分词](./chapter-04-chinese-analysis.md)。
