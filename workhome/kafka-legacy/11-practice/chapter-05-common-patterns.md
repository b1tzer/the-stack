# 常见场景

> Kafka 的典型应用场景概览。具体实现已归入对应专项，此处只保留场景索引与架构示意：
>
> - 通用消息模式（异步解耦、延迟任务、最终一致性）见 [消息场景](../../scenarios/03-messaging/)
> - Spring Kafka 集成实现见 [消息集成](../../spring/07-async-and-messaging/chapter-04-messaging#kafka-integration)
> - 流式处理见 [Kafka Streams](../../kafka/07-streams/chapter-01-streams-basics)
> - 数据管道与 CDC 见 [Kafka Connect](../../kafka/08-connect/chapter-01-connect-basics)

## 1. 日志收集

```txt
App → Kafka → Logstash → Elasticsearch → Kibana
```

## 2. 事件驱动架构

```txt
Service A → Kafka → Service B
                → Service C
                → Service D
```

## 3. 数据管道

```txt
MySQL → Debezium → Kafka → Elasticsearch
                        → Data Warehouse
```

## 4. 流式处理

```txt
Kafka → Kafka Streams/Flink → Kafka
```

## 5. 指标监控

```txt
App → Kafka → Prometheus/Grafana
```
