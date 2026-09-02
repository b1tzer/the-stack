# 常见场景

## 1. 日志收集

```
App → Kafka → Logstash → Elasticsearch → Kibana
```

## 2. 事件驱动架构

```
Service A → Kafka → Service B
                → Service C
                → Service D
```

## 3. 数据管道

```
MySQL → Debezium → Kafka → Elasticsearch
                        → Data Warehouse
```

## 4. 流式处理

```
Kafka → Kafka Streams/Flink → Kafka
```

## 5. 指标监控

```
App → Kafka → Prometheus/Grafana
```

## 6. 场景1：异步解耦

```java
// 订单服务：发送订单创建事件
@Service
public class OrderService {
    @Autowired
    private KafkaTemplate<String, String> kafkaTemplate;

    public Order createOrder(OrderRequest request) {
        // 创建订单
        Order order = orderRepository.save(new Order(request));
        
        // 发送事件（异步通知其他服务）
        kafkaTemplate.send("order-created", order.getId(), toJson(order));
        
        return order;
    }
}

// 库存服务：监听订单创建事件
@Component
public class InventoryConsumer {
    @KafkaListener(topics = "order-created", groupId = "inventory-group")
    public void onOrderCreated(String orderJson) {
        Order order = fromJson(orderJson, Order.class);
        // 扣减库存
        inventoryService.deduct(order.getProductId(), order.getQuantity());
    }
}

// 通知服务：监听订单创建事件
@Component
public class NotificationConsumer {
    @KafkaListener(topics = "order-created", groupId = "notification-group")
    public void onOrderCreated(String orderJson) {
        Order order = fromJson(orderJson, Order.class);
        // 发送通知
        notificationService.sendOrderConfirmation(order.getUserId(), order);
    }
}
```

## 7. 场景2：日志收集（ELK）

```java
// 日志收集器
@Component
public class LogCollector {
    @Autowired
    private KafkaTemplate<String, String> kafkaTemplate;

    public void collectLog(LogEntry log) {
        // 按日志级别路由到不同 Topic
        String topic = switch (log.getLevel()) {
            case ERROR -> "logs-error";
            case WARN -> "logs-warn";
            default -> "logs-info";
        };
        kafkaTemplate.send(topic, log.getService(), toJson(log));
    }
}

// Logstash 配置
// input {
//   kafka {
//     bootstrap_servers => "localhost:9092"
//     topics => ["logs-error", "logs-warn", "logs-info"]
//     group_id => "logstash-group"
//   }
// }
// output {
//   elasticsearch {
//     hosts => ["localhost:9200"]
//     index => "kafka-logs-%{+YYYY.MM.dd}"
//   }
// }
```

## 8. 场景3：CDC（变更数据捕获）

```java
// Debezium CDC 配置
// {
//   "name": "mysql-cdc",
//   "config": {
//     "connector.class": "io.debezium.connector.mysql.MySqlConnector",
//     "database.hostname": "localhost",
//     "database.port": 3306,
//     "database.user": "debezium",
//     "database.password": "***",
//     "database.server.id": 184054,
//     "database.server.name": "myserver",
//     "database.include.list": "mydb",
//     "table.include.list": "mydb.users,mydb.orders",
//     "database.history.kafka.bootstrap.servers": "localhost:9092",
//     "database.history.kafka.topic": "schema-changes"
//   }
// }

// 消费 CDC 事件
@Component
public class CdcConsumer {
    @KafkaListener(topics = "myserver.mydb.users", groupId = "cdc-group")
    public void onUserChange(String cdcEvent) {
        JsonNode event = parseJson(cdcEvent);
        String op = event.get("op").asText(); // c=create, u=update, d=delete
        
        switch (op) {
            case "c", "u" -> {
                JsonNode after = event.get("after");
                // 同步到 Elasticsearch
                elasticsearchClient.index("users", after);
            }
            case "d" -> {
                JsonNode before = event.get("before");
                elasticsearchClient.delete("users", before.get("id").asText());
            }
        }
    }
}
```

## 9. 场景4：延迟队列

```java
// 延迟队列实现（基于时间轮）
@Service
public class DelayQueueService {
    @Autowired
    private KafkaTemplate<String, String> kafkaTemplate;

    public void sendDelayedMessage(String topic, String key, String value, long delayMs) {
        // 计算目标时间
        long targetTime = System.currentTimeMillis() + delayMs;
        
        // 发送到延迟 Topic
        ProducerRecord<String, String> record = new ProducerRecord<>(
            "delay-queue", key, value);
        record.headers().add("target-time", 
            String.valueOf(targetTime).getBytes());
        record.headers().add("original-topic", topic.getBytes());
        
        kafkaTemplate.send(record);
    }
}

// 延迟队列消费者
@Component
public class DelayQueueConsumer {
    @KafkaListener(topics = "delay-queue", groupId = "delay-group")
    public void process(ConsumerRecord<String, String> record) {
        long targetTime = Long.parseLong(
            new String(record.headers().lastHeader("target-time").value()));
        String originalTopic = new String(
            record.headers().lastHeader("original-topic").value());
        
        if (System.currentTimeMillis() >= targetTime) {
            // 到时间了，转发到原始 Topic
            kafkaTemplate.send(originalTopic, record.key(), record.value());
        } else {
            // 还没到时间，重新发送回延迟队列
            kafkaTemplate.send(record);
        }
    }
}
```

## 10. 场景5：分布式事务（Saga 模式）

```java
// Saga 编排器
@Service
public class SagaOrchestrator {
    @Autowired
    private KafkaTemplate<String, String> kafkaTemplate;

    public void executeSaga(OrderSaga saga) {
        // 步骤1：创建订单
        saga.setStatus("CREATING_ORDER");
        kafkaTemplate.send("saga-step", saga.getId(), toJson(saga));
    }

    @KafkaListener(topics = "saga-step", groupId = "saga-group")
    public void onSagaStep(String sagaJson) {
        OrderSaga saga = fromJson(sagaJson, OrderSaga.class);
        
        switch (saga.getStatus()) {
            case "CREATING_ORDER" -> {
                try {
                    orderService.createOrder(saga);
                    saga.setStatus("DEDUCTING_INVENTORY");
                } catch (Exception e) {
                    saga.setStatus("COMPENSATING");
                }
                kafkaTemplate.send("saga-step", saga.getId(), toJson(saga));
            }
            case "DEDUCTING_INVENTORY" -> {
                try {
                    inventoryService.deduct(saga);
                    saga.setStatus("PAYMENT");
                } catch (Exception e) {
                    saga.setStatus("COMPENSATING");
                }
                kafkaTemplate.send("saga-step", saga.getId(), toJson(saga));
            }
            case "COMPENSATING" -> {
                // 回滚操作
                orderService.cancelOrder(saga);
                inventoryService.restore(saga);
                saga.setStatus("FAILED");
            }
        }
    }
}
```

