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
| status | Green/Yellow/Red（`_cluster/health` 的 status 字段） |
| number_of_nodes | 节点数 |
| active_shards | 活跃分片数 |
| relocating_shards | 迁移中分片数 |
| initializing_shards | 初始化中分片数 |
| unassigned_shards | 未分配分片数 |

## 3. Prometheus + Grafana

```yaml
# elasticsearch exporter（需与 ES 在同一 Docker 网络）
docker run -d --name es-exporter \
  --network es-net \
  -p 9114:9114 \
  quay.io/prometheuscommunity/elasticsearch-exporter:v1.11.0 \
  --es.uri=http://es-node:9200
```

> `--es.uri` 指向 ES 的容器名或服务名（上例 `es-node`），不能用 `localhost`，否则指向 exporter 自身。认证与 TLS 分开配置：仅认证时用 `http://user:pass@es-node:9200`，也可用 `ES_USERNAME`/`ES_PASSWORD` 环境变量避免凭据进入命令行；启用 HTTPS 时用 `--es.uri=https://...` 并配 `--es.ca`、`--es.client-cert`、`--es.client-private-key` 证书参数。

## 4. 常用监控工具

- Kibana Monitoring
- Prometheus + Grafana
- Elastic APM
- Cerebro

## 5. 关键告警指标

| 指标 | 告警阈值 | 说明 |
| :-- | :-- | :-- |
| 集群状态 Red | 有主分片未分配 | 数据不可用，最高优先级 |
| 集群状态 Yellow | 仅副本未分配且持续一段时间 | 副本缺失，不丢主数据 |
| JVM 堆使用率 | > 80% | 考虑扩容或调优 |
| GC 暂停时间 | 单次长暂停，且频率/时间占比过高 | 结合堆使用率综合判断 |
| 磁盘使用率 | 接近磁盘水位线 | low/high/flood 默认 85%/90%/95%，分别限制分片分配、触发迁移、索引只读，实际值随版本与配置变化 |
| 写入队列 | 持续积压或 rejected 增长（示例 > 100） | 按实际线程池容量调整 |
| 搜索队列 | 持续积压或 rejected 增长（示例 > 1000） | 按实际线程池容量调整 |
| 未分配分片 | 主分片 > 0 即告警 | 副本分片结合持续时间判断，避免恢复期噪声 |

## 6. 集群健康检查脚本

```bash
#!/bin/bash
# es_health_check.sh（人工巡检脚本，单项失败不中断；供监控系统调用时需对每项请求做失败判定）
ES_HOST="http://localhost:9200"

# 集群健康（curl -f 在 HTTP 4xx/5xx 时失败，jq -e 在 status 为空时失败，失败以非零码退出）
health=$(curl -sf "$ES_HOST/_cluster/health" | jq -er '.status') || { echo "无法获取集群状态"; exit 1; }
echo "集群状态: $health"

# 节点信息
echo "节点列表:"
curl -s "$ES_HOST/_cat/nodes?v&h=name,heap.percent,disk.used_percent,cpu"

# 索引大小 Top 10（head -11 保留表头行，依赖固定输出格式）
echo "索引大小 Top 10:"
curl -s "$ES_HOST/_cat/indices?v&s=store.size:desc&h=index,docs.count,store.size" | head -11

# 写入线程池状态（active 活动任务 / queue 排队 / rejected 累计拒绝）
echo "写入线程池状态:"
curl -s "$ES_HOST/_cat/thread_pool/write?v&h=name,active,queue,rejected"
```

## 7. 最佳实践

- 生产环境必须建立指标监控与告警体系（Prometheus + Grafana 是常见组合，并非唯一方案）
- 设置关键指标告警（集群状态、JVM、磁盘、队列）
- 定期检查慢查询日志：用 `index.search.slowlog.threshold.query.warn` 设置阈值，慢查询记录在节点 slowlog 日志中；查询慢日志与 fetch 阶段慢日志用途不同，阈值应结合业务延迟目标设置
- 使用 Kibana Monitoring 查看集群历史趋势
- 监控索引增长速度，提前规划容量
- 排障路径：集群异常先看健康状态与未分配分片原因；延迟/拒绝升高结合线程池 rejected 增量与节点资源定位；恢复后用分片恢复进度与 rejected 增量确认
