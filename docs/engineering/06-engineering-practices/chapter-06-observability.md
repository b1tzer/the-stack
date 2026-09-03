# 可观测性

> **核心问题**：日志、指标、链路追踪三大支柱如何落地？如何快速定位线上问题？

## 1. 可观测性三大支柱

| 支柱 | 回答的问题 | 工具 |
| :-- | :-- | :-- |
| 日志（Logging） | 发生了什么？ | ELK、Loki |
| 指标（Metrics） | 系统状态如何？ | Prometheus、Grafana |
| 链路追踪（Tracing） | 请求经过了哪些服务？ | SkyWalking、Jaeger |

三者通过 TraceID 串联：日志提供细节，指标提供全局视图，链路追踪提供调用路径。

## 2. 结构化日志

结构化日志的核心：用 JSON 等可解析格式输出，并携带请求上下文（如 userId、traceId），便于 ELK 检索。

> 各框架的结构化日志落地（MDC、Logback 配置）见 [Spring 日志](../../spring/06-observability/chapter-01-logging)。

## 3. 指标监控

指标监控的核心：采集 QPS、响应时间、错误率、资源使用率等时间序列数据，配合告警规则及时发现异常。

> Micrometer 与 Actuator 的指标暴露见 [Spring 指标](../../spring/06-observability/chapter-02-metrics)。

## 4. 链路追踪

链路追踪的核心：为每个请求生成 TraceID，贯穿所有下游调用，定位慢请求与错误传播路径。

> SkyWalking / OpenTelemetry 的接入见 [Spring 链路追踪](../../spring/06-observability/chapter-03-tracing)。

## 5. 监控体系设计

| 层次 | 监控内容 | 告警阈值 |
| :-- | :-- | :-- |
| 基础设施 | CPU、内存、磁盘、网络 | CPU > 80%、内存 > 90% |
| 应用层 | QPS、响应时间、错误率 | 错误率 > 5%、P99 > 1s |
| 业务层 | 订单量、支付成功率 | 支付成功率 < 95% |

## 6. 线上问题定位方法论

### 6.1 三板斧：日志、指标、链路

```txt
发现问题（告警/用户反馈）
    │
    ▼
第一步：看指标（Grafana）—— 确定问题范围和影响
    ▼
第二步：看链路（Jaeger/SkyWalking）—— 定位到具体环节
    ▼
第三步：看日志（Kibana）—— 用 TraceID 找到异常堆栈
    ▼
定位根因，制定修复方案
```

### 6.2 常见问题排查路径

| 问题现象 | 排查步骤 | 常见根因 |
| :-- | :-- | :-- |
| 接口响应变慢 | 看 P99 趋势 → 找慢 Trace → 定位慢在哪个环节 → 看该环节日志 | 慢 SQL、缓存穿透、下游超时、GC 暂停 |
| 偶发 500 错误 | 看错误率分布 → 搜 ERROR 日志 → 看异常堆栈 → 关联 TraceID | 空指针、参数校验失败、并发竞争、连接池耗尽 |
| 内存泄漏 | 看堆内存趋势 → 确认代区 → 生成堆转储 → 分析大对象 | 大集合未清理、ThreadLocal 泄露、缓存无上限 |
| CPU 飙高 | 找高 CPU 进程 → 找高 CPU 线程 → 转 16 进制 → 看线程堆栈 | 死循环、频繁 Full GC、正则回溯 |
| 数据库连接池耗尽 | 看活跃连接数 → 确认是否达上限 → 查慢 SQL → 查事务关闭 | 慢 SQL 占连接、事务未提交、连接泄漏 |

> JVM 诊断工具（jmap、jstack、Arthas）的用法见 [Spring 生产排查](../../spring/06-observability/chapter-04-production-debug)。

> **核心原则**：可观测性不是事后补充，而是从第一天就设计进去。

## 7. 本章小结

可观测性三大支柱各司其职，又通过 TraceID 紧密关联：

| 支柱 | 回答的问题 | 数据形态 | 代表技术栈 |
| :-- | :-- | :-- | :-- |
| **日志** | 发生了什么？ | 离散事件 | Logback → Filebeat → Elasticsearch → Kibana |
| **指标** | 整体状况如何？ | 时间序列数值 | Micrometer → Prometheus → Grafana |
| **链路追踪** | 请求经过了哪里？哪里慢？ | 调用树 | OpenTelemetry → Collector → Jaeger/SkyWalking |

三者不是互斥选择，而是互补关系。日志提供细节，指标提供全局视图，链路追踪提供调用路径。通过 TraceID 将三者串联，才能构建完整的可观测体系。
