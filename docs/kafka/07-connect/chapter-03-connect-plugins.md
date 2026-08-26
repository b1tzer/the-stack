# 常用连接器插件

## 1. JDBC Connector

```json
{
  "connector.class": "io.confluent.connect.jdbc.JdbcSourceConnector",
  "connection.url": "jdbc:mysql://localhost:3306/mydb",
  "table.whitelist": "users",
  "mode": "incrementing",
  "incrementing.column.name": "id"
}
```

## 2. Debezium (CDC)

```json
{
  "connector.class": "io.debezium.connector.mysql.MySqlConnector",
  "database.hostname": "localhost",
  "database.port": 3306,
  "database.user": "root",
  "database.password": "***",
  "database.server.id": 1,
  "database.include.list": "mydb",
  "database.history.kafka.bootstrap.servers": "localhost:9092",
  "database.history.kafka.topic": "schema-changes"
}
```

## 3. Elasticsearch Connector

```json
{
  "connector.class": "io.confluent.connect.elasticsearch.ElasticsearchSinkConnector",
  "connection.url": "http://localhost:9200",
  "topics": "my-topic",
  "type.name": "_doc",
  "key.ignore": true
}
```

## 4. JDBC Connector 详解

### 4.1 Source Connector（从数据库读取）
```json
{
  "name": "jdbc-source",
  "config": {
    "connector.class": "io.confluent.connect.jdbc.JdbcSourceConnector",
    "connection.url": "jdbc:mysql://localhost:3306/mydb?user=root&password=***",
    "table.whitelist": "users,orders",
    "mode": "incrementing",
    "incrementing.column.name": "id",
    "topic.prefix": "jdbc-",
    "poll.interval.ms": 5000,
    "transforms": "createKey,extractInt",
    "transforms.createKey.type": "org.apache.kafka.connect.transforms.ValueToKey",
    "transforms.createKey.fields": "id",
    "transforms.extractInt.type": "org.apache.kafka.connect.transforms.ExtractField$Key",
    "transforms.extractInt.field": "id"
  }
}
```

### 4.2 Sink Connector（写入数据库）
```json
{
  "name": "jdbc-sink",
  "config": {
    "connector.class": "io.confluent.connect.jdbc.JdbcSinkConnector",
    "connection.url": "jdbc:mysql://localhost:3306/mydb",
    "topics": "user-events",
    "insert.mode": "upsert",
    "pk.mode": "record_key",
    "pk.fields": "id",
    "auto.create": true,
    "auto.evolve": true,
    "delete.enabled": true
  }
}
```

## 5. Debezium CDC 详解

```json
{
  "name": "mysql-cdc",
  "config": {
    "connector.class": "io.debezium.connector.mysql.MySqlConnector",
    "database.hostname": "localhost",
    "database.port": 3306,
    "database.user": "debezium",
    "database.password": "***",
    "database.server.id": 184054,
    "database.server.name": "myserver",
    "database.include.list": "mydb",
    "database.history.kafka.bootstrap.servers": "localhost:9092",
    "database.history.kafka.topic": "schema-changes",
    "table.include.list": "mydb.users,mydb.orders",
    "transforms": "outbox",
    "transforms.outbox.type": "io.debezium.transforms.outbox.EventRouter",
    "transforms.outbox.table.field.event.key": "aggregate_id",
    "transforms.outbox.table.field.event.type": "event_type",
    "transforms.outbox.route.by.field": "aggregate_type"
  }
}
```

## 6. S3 Connector

```json
{
  "name": "s3-sink",
  "config": {
    "connector.class": "io.confluent.connect.s3.S3SinkConnector",
    "s3.bucket.name": "my-kafka-data",
    "s3.region": "us-east-1",
    "topics": "logs,events",
    "storage.class": "io.confluent.connect.s3.storage.S3Storage",
    "format.class": "io.confluent.connect.s3.format.json.JsonFormat",
    "partitioner.class": "io.confluent.connect.storage.partitioner.TimeBasedPartitioner",
    "path.format": "YYYY/MM/dd",
    "locale": "zh_CN",
    "timezone": "Asia/Shanghai",
    "flush.size": 1000,
    "rotate.interval.ms": 3600000
  }
}
```

## 7. 自定义连接器开发

```java
public class MySourceConnector extends SourceConnector {
    private String topic;
    private String connectionString;

    @Override
    public void start(Map<String, String> props) {
        topic = props.get("topic");
        connectionString = props.get("connection.string");
    }

    @Override
    public Class<? extends Task> taskClass() {
        return MySourceTask.class;
    }

    @Override
    public List<Map<String, String>> taskConfigs(int maxTasks) {
        List<Map<String, String>> configs = new ArrayList<>();
        for (int i = 0; i < maxTasks; i++) {
            Map<String, String> config = new HashMap<>();
            config.put("topic", topic);
            config.put("connection.string", connectionString);
            config.put("task.id", String.valueOf(i));
            configs.add(config);
        }
        return configs;
    }

    @Override
    public void stop() {}

    @Override
    public ConfigDef config() {
        return new ConfigDef()
            .define("topic", ConfigDef.Type.STRING, ConfigDef.Importance.HIGH, "Topic name")
            .define("connection.string", ConfigDef.Type.STRING, ConfigDef.Importance.HIGH, "Connection string");
    }

    @Override
    public String version() {
        return "1.0.0";
    }
}
```

## 8. 最佳实践

1. **优先使用成熟的连接器**：Confluent Hub 上有大量经过验证的连接器，避免重复造轮子。
2. **使用 Debezium 进行 CDC**：比轮询方式更实时、更高效，对源数据库压力更小。
3. **配置数据格式转换**：使用 SMT 或自定义转换器，确保数据格式符合目标系统要求。
4. **测试连接器性能**：在生产环境部署前，进行压力测试，确保吞吐量满足需求。
