---
type: explanation
level: intermediate
---

# RAG 与向量存储

> 本文以 Spring AI 1.1.x 为准，向量库示例使用 PostgreSQL + pgvector。不同向量库的过滤语法、索引参数和初始化方式存在差异，切换前需逐个核对。

模型不知道你的内部文档，也不该把整库文档塞进提示词。检索增强生成（Retrieval Augmented Generation，RAG）的做法是：先把文档切成片段并转成向量存起来，提问时检索最相关的若干片段，再把这些片段和问题一起交给模型。

它解决的是「知识不在模型参数里」的问题，不解决「模型推理能力不足」的问题。检索到的内容不对，再强的模型也只会更自信地答错。

## 1. 四个阶段与责任划分

| 阶段 | 做什么 | 出问题的表现 | 主要手段 |
| :-- | :-- | :-- | :-- |
| 入库 | 读取、切分、向量化、写入 | 检索永远召回不到正确内容 | 分块策略、元数据 |
| 检索 | 把问题向量化并做相似度搜索 | 召回内容相关度低 | topK、阈值、过滤 |
| 增强 | 把片段拼进提示词 | 回答忽略检索内容 | 模板、上下文顺序 |
| 生成 | 模型基于上下文作答 | 编造、答非所问 | 提示词、评估 |

排查顺序应该反过来：先确认检索结果里有没有正确答案，再看提示词。跳过第一步，很容易把检索问题误判成模型问题。

## 2. 向量化

`EmbeddingModel` 把文本转成定长浮点数组。三条硬约束：

1. **写入和查询必须使用同一个模型。** 换模型意味着向量空间变了，旧向量失效。
2. **维度必须与向量库表结构一致。** 维度不匹配时写入直接失败，或在建索引时报错。
3. **同一段文本在不同模型下的向量不可比较。** 不同厂商、不同版本都算不同模型。

```java
float[] vector = embeddingModel.embed("退款多久到账");
```

选择嵌入模型的权衡：

| 维度 | 托管 API | 本地 ONNX 模型 |
| :-- | :-- | :-- |
| 成本 | 按 token 计费 | 一次性算力投入 |
| 延迟 | 多一次网络往返 | 受本机 CPU/GPU 影响 |
| 数据外发 | 文本会离开内网 | 不出内网 |
| 维护 | 无 | 需要管理模型文件与内存 |

中文场景要确认模型对中文的支持程度，不要直接沿用英文基准的结论。换模型后必须重建索引，这不是可选项。

## 3. VectorStore 接口

Spring AI 把向量库访问拆成只读和读写两个接口：

```java
public interface VectorStoreRetriever {
    List<Document> similaritySearch(SearchRequest request);
}

public interface VectorStore extends DocumentWriter, VectorStoreRetriever {
    void add(List<Document> documents);
    void delete(List<String> idList);
    void delete(Filter.Expression filterExpression);
}
```

最小权限的做法是：只做问答的组件注入 `VectorStoreRetriever`，负责入库的组件才注入 `VectorStore`。这样写入能力不会扩散到读路径。

### 3.1 检索参数

```java
List<Document> docs = vectorStore.similaritySearch(
        SearchRequest.builder()
                .query("退款多久到账")
                .topK(5)
                .similarityThreshold(0.7)
                .filterExpression("tenant == 'acme'")
                .build());
```

| 参数 | 默认值 | 说明 |
| :-- | :-- | :-- |
| `query` | 必填 | 查询文本，由 `EmbeddingModel` 转成向量 |
| `topK` | 4 | 返回的最大片段数 |
| `similarityThreshold` | 0.0（全部接受） | 相似度下限，越接近 1 越严格 |
| `filterExpression` | 无 | 作用于元数据的过滤条件 |

两个默认值都需要注意：`topK=4` 对复杂问题往往不够，`threshold=0.0` 等于不做过滤，会把不相关的片段也拼进上下文。阈值没有通用最优值，必须用自己的问题集测。

相似度分数的含义随度量方式变化（余弦相似度、内积、欧氏距离），跨库比较分数没有意义，只在同一个库内调参。

### 3.2 元数据与过滤

`Document` 由文本、元数据、ID 组成：

```java
Document doc = new Document(
        "退款将在 3 到 5 个工作日到账。",
        Map.of("source", "refund-faq.md", "tenant", "acme", "version", "2.1"));
```

元数据是唯一可过滤的维度。它承担三个职责：租户隔离、版本控制、来源追溯。设计时遵守两条规则：

- **键名稳定**，不要随手改名，过滤表达式依赖它。
- **值保持低基数**，不要放自由文本。

过滤表达式有两种写法，能力等价：

```java
// 字符串 DSL
"tenant == 'acme' && version >= '2.0'"

// 类型化表达式
FilterExpressionBuilder b = new FilterExpressionBuilder();
b.and(b.eq("tenant", "acme"), b.gte("version", "2.0")).build();
```

各向量库对 `IN`、`NIN`、`IS NULL` 的支持并不一致。写跨库代码时只使用等值、比较和 `AND`/`OR` 这些普遍支持的形式，其余在目标库上单独验证。

## 4. 文档入库

Spring AI 的 ETL 拆成三个接口：`DocumentReader`、`DocumentTransformer`、`DocumentWriter`。`VectorStore` 本身就是 `DocumentWriter` 的实现。

```java
TextReader reader = new TextReader(new ClassPathResource("docs/refund-faq.md"));
reader.getCustomMetadata().put("tenant", "acme");

TokenTextSplitter splitter = TokenTextSplitter.builder()
        .withChunkSize(800)
        .withMinChunkSizeChars(350)
        .withPunctuationMarks(List.of('。', '？', '！', '；'))
        .build();

vectorStore.write(splitter.transform(reader.read()));
```

`read()`/`transform()`/`write()` 与 `get()`/`apply()`/`accept()` 是同一接口的两套命名，前者语义更清楚。

`TokenTextSplitter` 的关键默认值：每块 800 token、单块最少 350 字符、按 `.`、`?`、`!` 和换行断句、最多 10000 块。中文文档务必改标点列表，默认的英文标点会让断句位置变得随意。

### 4.1 分块策略

分块决定了检索的粒度，没有通用答案，但有判断依据：

| 文档类型 | 建议粒度 | 理由 |
| :-- | :-- | :-- |
| 制度、FAQ | 300～500 token，按段落 | 一条规则通常在一个段落内 |
| 技术文档 | 按标题层级，500～800 token | 保持章节完整性 |
| 代码 | 按函数或类 | 跨函数的片段没有意义 |
| 表格 | 一行一块，保留表头作为元数据 | 整表检索命中率低 |
| 会议记录 | 按发言人或时间窗 | 保持语境 |

三个经验判断：

- **块太小**，检索命中后缺少上下文，模型容易补全错误信息。
- **块太大**，一个块里混多个主题，相似度被稀释，召回不准。
- **重叠不宜过多**，20% 左右足够；过多会让同一内容重复进入上下文，推高成本。

切分后可以加一步内容增强：在每个块前面拼接所属文档标题和章节路径。这对「答案分散在多个块」的场景效果明显。

### 4.2 更新与删除

文档更新不是「再写一遍」，而是先删旧版本：

```java
vectorStore.delete("docId == 'refund-faq' AND version == '2.0'");
vectorStore.write(splitter.transform(reader.read()));
```

按元数据删除比按 ID 删除慢，可能触发全表扫描。更稳的做法是在业务侧维护「文档 → 分块 ID 列表」的映射，删除时按 ID 批量删。批量删除要分批，一次删几十万条会长时间锁表。

## 5. 快速接入：QuestionAnswerAdvisor

`QuestionAnswerAdvisor` 完成「检索 + 拼接」的标准流程，适合先用起来。

依赖：

```xml
<dependency>
  <groupId>org.springframework.ai</groupId>
  <artifactId>spring-ai-advisors-vector-store</artifactId>
</dependency>
```

用法：

```java
var qaAdvisor = QuestionAnswerAdvisor.builder(vectorStore)
        .searchRequest(SearchRequest.builder()
                .topK(6)
                .similarityThreshold(0.65)
                .build())
        .build();

String answer = chatClient.prompt()
        .user("企业版支持哪些付款方式？")
        .advisors(qaAdvisor)
        .call()
        .content();
```

按请求切换过滤条件：

```java
chatClient.prompt()
        .user(question)
        .advisors(a -> a
                .advisors(qaAdvisor)
                .param(QuestionAnswerAdvisor.FILTER_EXPRESSION, "tenant == 'acme'"))
        .call()
        .content();
```

自定义拼接模板时，模板必须保留两个占位符：`query`（用户问题）和 `question_answer_context`（检索到的上下文）。缺任意一个，检索结果就进不了提示词。

它的局限是流程固定：一次检索、一次拼接。查询改写、多路召回、重排都做不了。

## 6. 模块化：RetrievalAugmentationAdvisor

需要控制检索前后的处理步骤时，使用模块化 RAG。依赖是 `spring-ai-rag`。

```java
Advisor ragAdvisor = RetrievalAugmentationAdvisor.builder()
        .queryTransformers(RewriteQueryTransformer.builder()
                .chatClientBuilder(rewriteChatClientBuilder)
                .build())
        .documentRetriever(VectorStoreDocumentRetriever.builder()
                .vectorStore(vectorStore)
                .similarityThreshold(0.6)
                .topK(6)
                .build())
        .build();
```

可用模块按阶段划分：

| 阶段 | 组件 | 解决的问题 |
| :-- | :-- | :-- |
| 检索前 | `RewriteQueryTransformer` | 口语化、冗长的提问 |
| 检索前 | `CompressionQueryTransformer` | 多轮对话中的指代（「那它呢」） |
| 检索前 | `TranslationQueryTransformer` | 问题语言与嵌入模型不一致 |
| 检索前 | `MultiQueryExpander` | 单一表述召回不全 |
| 检索 | `VectorStoreDocumentRetriever` | 相似度检索 + 过滤 |
| 检索 | `ConcatenationDocumentJoiner` | 合并多路结果并去重 |
| 检索后 | `DocumentPostProcessor` | 重排、压缩、去噪 |
| 生成 | `ContextualQueryAugmenter` | 把上下文与问题合成提示词 |

两个默认行为必须知道：

- **检索为空时，Advisor 会指示模型不要回答。** 这是刻意设计，避免模型在没有依据时编造。需要放行时显式设置 `ContextualQueryAugmenter.builder().allowEmptyContext(true)`。
- **查询改写使用的 `ChatClient` 要单独配置低温度。** 默认温度偏高，改写结果会发散，反而降低检索命中率。

改写和多路召回都会增加一次或多次模型调用，延迟和成本随之上升。先用最简单的检索测出基线，再决定是否加模块。

## 7. pgvector 落地

依赖：

```xml
<dependency>
  <groupId>org.springframework.ai</groupId>
  <artifactId>spring-ai-starter-vector-store-pgvector</artifactId>
</dependency>
```

连接信息走标准数据源，不放在 `spring.ai` 下：

```yaml
spring:
  datasource:
    url: jdbc:postgresql://localhost:5432/app
    username: ${DB_USER}
    password: ${DB_PASSWORD}
  ai:
    vectorstore:
      pgvector:
        initialize-schema: true
        dimensions: 1536
        index-type: HNSW
        distance-type: COSINE_DISTANCE
```

```sql
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS hstore;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
```

四个容易踩的配置：

- **`initialize-schema` 默认是 `false`。** 不显式打开就不会建表和扩展，表现为「表不存在」，而不是启动报错。
- **`dimensions` 必须与嵌入模型一致。** 建表后维度写死在列定义里，改维度只能重建表。
- **HNSW 索引最多支持 2000 维。** 超过时改用 IVFFlat 或精确搜索。
- **`index-type` 的取舍**：HNSW 查询快、建索引慢、占内存，空表也能建；IVFFlat 建索引快、内存占用低，但需要先有数据才能建，召回率依赖参数调优。

生产环境通常把 `initialize-schema` 设为 `false`，由迁移脚本管理扩展和表结构。应用账号不应具备建表权限。

## 8. 质量调优

调优的顺序是「先看召回，再看生成」。用一组有标准答案的问题做回归集，逐条记录检索结果。

| 现象 | 首先检查 | 常见修正 |
| :-- | :-- | :-- |
| 召回的片段与问题无关 | 分块粒度、嵌入模型 | 调整块大小、换模型并重建索引 |
| 召回片段正确但回答没用上 | 提示词模板、片段顺序 | 把最相关的放前面，明确「仅依据上下文回答」 |
| 回答遗漏关键段落 | topK 太小、阈值太严 | 增大 topK，降低阈值 |
| 不同租户互相看到内容 | 过滤条件缺失 | 在检索层强制注入租户过滤，不能依赖调用方 |
| 新文档检索不到 | 入库任务未执行 | 检查 ETL 流水线与索引刷新 |
| 相关性分数普遍偏低 | 维度或模型不一致 | 核对写入与查询是否同一模型 |

阈值调优容易陷入「针对单个问题反复试」。正确做法是先固定 topK 和分块策略，用回归集统计命中率，再小幅调整阈值，观察整体变化。

### 8.1 混合检索与重排

纯向量检索对精确匹配不敏感，例如产品型号、错误码、人名。文档里大量出现这类标识时，通常需要再加一路关键词检索（BM25），合并结果后再做重排。

代价是复杂度：两套索引、两套更新逻辑、合并策略调参。只有在向量检索的召回率稳定不达标时才引入，不要一开始就上。

## 9. 数据安全边界

- 检索层强制注入租户过滤，不要相信调用方传入的过滤条件。
- 入库前清洗文档，剔除密钥、内部地址、个人隐私。
- 向量本身不可逆，但元数据和原文片段可读，向量库的访问权限要按敏感数据对待。
- 不要用用户直接提供的 URL 构造 `DocumentReader`。多数 Reader 基于 `Resource` 客户端实现，用户可控 URL 会带来服务端请求伪造风险。

## 小结

- RAG 的质量由入库和检索决定，提示词只能锦上添花。
- 写入与查询必须使用同一个嵌入模型，换模型就要重建索引。
- `topK` 与 `similarityThreshold` 的默认值几乎总要改，用回归集测，不靠感觉。
- `QuestionAnswerAdvisor` 用于快速接入，需要查询改写或多路召回时改用 `RetrievalAugmentationAdvisor`。
- pgvector 的 `initialize-schema` 默认关闭、维度不可热改、HNSW 有 2000 维上限。
