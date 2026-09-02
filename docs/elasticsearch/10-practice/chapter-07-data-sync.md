# 数据同步实战

## 1. 同步方案概览

| 方案 | 实时性 | 一致性 | 复杂度 | 推荐场景 |
|------|--------|--------|--------|---------|
| **Canal + MQ** | 秒级 | 高 | 中 | ✅ 生产环境首选 |
| **双写（异步）** | 秒级 | 较高 | 中 | 无法部署 Canal |
| **定时任务** | 分钟级 | 中 | 低 | 实时性要求低 |
| **Debezium + Kafka** | 秒级 | 高 | 高 | 大规模分布式 |

## 2. Canal + Kafka 方案

### 2.1 架构

```
MySQL → Canal → Kafka → Consumer → Elasticsearch
```

### 2.2 Canal 配置

```yaml
# canal.properties
canal.instance.master.address=127.0.0.1:3306
canal.instance.dbUsername=canal
canal.instance.dbPassword=canal
canal.instance.filter.regex=mydb\\..*
canal.mq.servers=kafka:9092
canal.mq.retries=3
```

### 2.3 消费者实现

```java
@KafkaListener(topics = "canal-topic")
public void syncToES(ConsumerRecord<String, String> record) {
    CanalMessage message = JSON.parseObject(record.value(), CanalMessage.class);

    for (CanalEntry.RowData rowData : message.getData()) {
        String id = getColumnValue(rowData, "id");

        if (message.getType() == CanalEntry.EventType.DELETE) {
            // 删除文档
            esClient.delete(new DeleteRequest("products", id));
        } else {
            // 索引/更新文档
            Map<String, Object> source = buildSource(rowData);
            esClient.index(new IndexRequest("products")
                .id(id)
                .source(source));
        }
    }
}
```

## 3. Debezium + Kafka 方案

### 3.1 Debezium 配置

```json
{
  "name": "mysql-connector",
  "config": {
    "connector.class": "io.debezium.connector.mysql.MySqlConnector",
    "database.hostname": "mysql",
    "database.port": "3306",
    "database.user": "debezium",
    "database.password": "password",
    "database.server.id": "1",
    "database.server.name": "mydb",
    "database.include.list": "mydb",
    "table.include.list": "mydb.products,mydb.orders",
    "database.history.kafka.bootstrap.servers": "kafka:9092",
    "database.history.kafka.topic": "schema-changes"
  }
}
```

## 4. 双写方案

```java
@Service
public class OrderService {

    @Transactional
    public void createOrder(Order order) {
        // 1. 写入 MySQL
        orderMapper.insert(order);

        // 2. 异步写入 ES
        kafkaTemplate.send("es-sync-topic", JSON.toJSONString(order));
    }
}

@KafkaListener(topics = "es-sync-topic")
public void syncToES(String message) {
    Order order = JSON.parseObject(message, Order.class);
    esClient.index(new IndexRequest("orders")
        .id(order.getId())
        .source(JSON.toJSONString(order), XContentType.JSON));
}
```

## 5. 定时增量同步

```java
@Scheduled(fixedRate = 60000) // 每分钟执行
public void incrementalSync() {
    // 查询最近更新的数据
    List<Order> orders = orderMapper.selectByUpdateTimeAfter(lastSyncTime);

    if (!orders.isEmpty()) {
        BulkRequest bulkRequest = new BulkRequest();
        for (Order order : orders) {
            bulkRequest.add(new IndexRequest("orders")
                .id(order.getId())
                .source(JSON.toJSONString(order), XContentType.JSON));
        }
        esClient.bulk(bulkRequest);
        lastSyncTime = orders.get(orders.size() - 1).getUpdateTime();
    }
}
```

## 6. 版本冲突处理

```json
// 使用外部版本号（MySQL 的 update_time）
PUT /orders/_doc/1?version=1681234567&version_type=external
{
  "order_id": "ORD001",
  "amount": 99.9
}

// 使用 retry_on_conflict
POST /orders/_update/1?retry_on_conflict=3
{
  "doc": { "amount": 199.9 }
}
```

## 7. 数据对账

```bash
#!/bin/bash
# check_sync.sh

# MySQL 数据量
MYSQL_COUNT=$(mysql -e "SELECT COUNT(*) FROM orders" -N)

# ES 数据量
ES_COUNT=$(curl -s "localhost:9200/orders/_count" | jq '.count')

echo "MySQL: $MYSQL_COUNT, ES: $ES_COUNT"

if [ "$MYSQL_COUNT" != "$ES_COUNT" ]; then
    echo "数据不一致！需要修复"
fi
```

## 8. 最佳实践

- 生产环境首选 Canal + MQ 方案
- 使用外部版本号处理消息乱序
- 消费者实现幂等（使用文档 ID）
- 定期对账确保数据一致
- 监控同步延迟（MySQL 最新时间 vs ES 最新时间）
- 设置重试机制处理临时故障
- 大批量同步使用 Bulk API
