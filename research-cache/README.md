# 本地研究资料缓存

这个目录保存 `~/projects/source/tech-knowledge` 未覆盖的一手资料，并为已覆盖资料提供补充缓存。缓存是**第二优先级本地来源**，不得覆盖知识库中同产品、同版本的结论。

## 检索顺序

1. 先查 `~/projects/source/tech-knowledge`，通过其 `metadata/`、`sources/`、`docs/` 和检索脚本确认产品、版本与来源。
2. 知识库未覆盖所需资源时，再用 `research-cache/search.sh` 查询缓存。
3. 两个本地来源均不足、版本不适用或需要当前行为时，才进行联网检索。

OpenJDK 源码和版本元数据以知识库固定的 `jdk-21.0.12.1-ga` / `eac07229cf6c` 为准。本缓存不再登记旧的未固定 OpenJDK 源码归档；遗留文件即使仍存在也不得作为可检索资源。

## 使用方式

```bash
# 查看可用资源及其产品、版本、类型
./research-cache/search.sh --list

# 按 manifest ID 检索
./research-cache/search.sh 'XWPFDocument' --resource poi-ooxml-sources

# 按产品、版本和资料类型检索
./research-cache/search.sh 'Workbook' \
  --product 'Apache POI' --version 5.4.1 --kind source

# 下载全部资料，或只下载指定 ID
./research-cache/fetch.sh
./research-cache/fetch.sh poi-ooxml-sources
```

`search.sh` 不允许不带资源范围的全缓存扫描。它会校验下载完成标记和 SHA-256，并在结果前打印资源 ID、产品、版本、ref/commit、类型、来源和本地路径。

`downloads/` 保存原始归档，`extracted/` 保存可直接检索的展开内容。两者已被根目录 `.gitignore` 忽略；`manifest.tsv` 记录资源类型、产品、版本、ref/commit、来源 URL 和 SHA-256。

## 当前资料

- Java SE 21 完整文档：API Javadoc、语言规范、虚拟机规范和工具说明；源码查证仍优先使用知识库。
- Apache POI 5.4.1 源码与 Javadoc：Office 文档读写的 Java 实现参考。
- ECMA-376 5th edition Parts 1–4：Office Open XML 文件格式规范。

## 检索原则

1. 搜索结果只作为线索；结论必须回到对应的规范、Javadoc、源码或官方文档原文。
2. 每次引用缓存资料都记录 manifest ID、产品、版本、ref/commit 和 primary URL。
3. 版本、默认值或实现发生变化时，获取官方原始页面或归档，不把缓存快照描述成当前行为。
4. 本地资料仍不足时，依次尝试官方镜像、Maven Central、项目仓库和带重试的直接下载。
