# 监控

## 1. 集群健康

```json
GET /_cluster/health

GET /_cat/nodes?v
GET /_cat/indices?v
GET /_cat/shards?v
```

## 2. 核心指标

| 指标 | 说明 |
| :-- | :-- |
| cluster_status | Green/Yellow/Red |
| number_of_nodes | 节点数 |
| active_shards | 活跃分片数 |
| relocating_shards | 迁移中分片数 |
| initializing_shards | 初始化中分片数 |
| unassigned_shards | 未分配分片数 |

## 3. Prometheus + Grafana

```yaml
# elasticsearch exporter
docker run -d --name es-exporter \
  -p 9114:9114 \
  justwatch/elasticsearch_exporter \
  --es.uri=http://localhost:9200
```

## 4. 常用监控工具

- Kibana Monitoring
- Prometheus + Grafana
- Elastic APM
- Cerebro

## 5. 关键告警指标

| 指标 | 告警阈值 | 说明 |
| :-- | :-- | :-- |
| 集群状态 | != Green | 检查未分配分片 |
| JVM 堆使用率 | > 80% | 考虑扩容或调优 |
| GC 暂停时间 | > 5s | 老年代 GC 过于频繁 |
| 磁盘使用率 | > 85% | 触发水位线，分片迁移 |
| 写入队列 | > 100 | 写入压力过大 |
| 搜索队列 | > 1000 | 查询压力过大 |
| 未分配分片 | > 0 | 节点故障或磁盘不足 |

## 6. 集群健康检查脚本

```bash
#!/bin/bash
# es_health_check.sh
ES_HOST="http://localhost:9200"

# 集群健康
health=$(curl -s "$ES_HOST/_cluster/health" | jq -r '.status')
echo "集群状态: $health"

# 节点信息
echo "节点列表:"
curl -s "$ES_HOST/_cat/nodes?v&h=name,heap.percent,disk.used_percent,cpu"

# 索引大小
echo "索引大小 Top 10:"
curl -s "$ES_HOST/_cat/indices?v&s=store.size:desc&h=index,docs.count,store.size" | head -11

# 慢查询日志
echo "待处理的写入任务:"
curl -s "$ES_HOST/_cat/thread_pool/write?v&h=name,active,queue,rejected"
```

## 7. 最佳实践

- 生产环境必须部署 Prometheus + Grafana 监控
- 设置关键指标告警（集群状态、JVM、磁盘、队列）
- 定期检查慢查询日志（`index.search.slowlog.threshold.query.warn`）
- 使用 Kibana Monitoring 查看集群历史趋势
- 监控索引增长速度，提前规划容量
