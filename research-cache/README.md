# 本地研究资料缓存

这个目录用于保存重写文档时需要查阅的一手资料，优先离线检索，只有在本地缓存缺失、版本需要更新或来源发生冲突时才调用搜索 API。

## 使用方式

```bash
# 在已下载资料中检索
./research-cache/search.sh 'Thread.dump_to_file' java

# 下载全部资料；也可以只下载指定 ID
./research-cache/fetch.sh
./research-cache/fetch.sh jdk21-docs
```

`downloads/` 保存原始归档，`extracted/` 保存可直接检索的展开内容。两者已被根目录 `.gitignore` 忽略；`manifest.tsv` 记录来源、版本和 SHA-256，供后续复核。

## 当前资料

- Java SE 21 完整文档：API Javadoc、语言规范、虚拟机规范和工具说明。
- OpenJDK 21u 源码：核对 JDK 行为、实现和内部注释。
- Apache POI 5.4.1 源码与 Javadoc：Office 文档读写的 Java 实现参考。
- ECMA-376 5th edition Parts 1–4：Office Open XML 文件格式规范。

## 检索原则

1. 先用 `search.sh` 查本地缓存。
2. 搜索结果只作为线索；结论回到本地的规范、Javadoc、源码或项目官方文档核对。
3. 版本、默认值或实现发生变化时，直接获取官方原始页面或归档，不重复搜索同一问题。
4. 仍然无法访问时，依次尝试官方镜像、Maven Central、项目仓库和带重试的直接下载。
