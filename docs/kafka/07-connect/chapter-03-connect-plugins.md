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

`mode: incrementing` 依赖 `incrementing.column.name` 指向的那列（这里是 `id`）持续单调递增。Connector 每 `poll.interval.ms`（5 秒）执行一次 `SELECT * FROM users WHERE id > 上次记录的最大 id`，把新增行搬进 Kafka。这决定了它的两个硬伤：

| 局限 | 原因 |
| :-- | :-- |
| 捕获不到 UPDATE | 已读过的行 id 不再大于「上次最大 id」，更新被跳过 |
| 捕获不到 DELETE | 删除的行不存在于结果集，无从感知 |

只要业务表有更新或删除需求，就不能用增量轮询，得换成 §5 的 Debezium CDC。`transforms` 里的 `ValueToKey` + `ExtractField$Key` 是把 `id` 从 value 提取出来作为 Kafka 消息的 Key，这样下游按主键分区分发时，同一行的变更始终落在同一分区。

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

`insert.mode: upsert` 必须配合 `pk.mode: record_key` 一起看：以 Kafka 消息的 Key 作为数据库主键，目标行已存在则更新、不存在则插入。这正是幂等的落地方式——同一条消息重复消费时，执行的是同一条 upsert，不会产生重复行。

`auto.create: true` 和 `auto.evolve: true` 让 Connector 自动建表、自动加列。它省了手写 DDL，但代价是表结构由 Connector 推断生成，字段类型可能不符合预期。生产环境通常先人工建好表、把这两个开关关掉，避免 DDL 失控。

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

Debezium 与 JDBC 轮询的本质区别在数据来源：它读的是 MySQL 的 binlog，而不是反复 `SELECT`。行一旦变更，binlog 立刻产生事件，Debezium 立即捕获并写入 Kafka——实时性来自「事件驱动」，而非「缩短轮询间隔」。这也是它对源库压力更小的原因：不产生查询负载。

三个关键配置的作用：

| 配置 | 作用 |
| :-- | :-- |
| `database.server.name` | 作为生成 Topic 名的前缀，本示例下 Topic 形如 `myserver.mydb.users` |
| `database.history.kafka.topic` | 存储 DDL 历史，实例重启后据此还原表结构才能解析 binlog |
| `database.server.id` | 模拟一个 MySQL 从库的 server-id，binlog 复制协议要求它全局唯一 |

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

S3 不适合逐条写，Connector 先把消息缓存在本地，攒够一批再落一个文件。`flush.size` 与 `rotate.interval.ms` 是两个独立的上限，**谁先到就按谁切文件**：

- `flush.size: 1000`：攒满 1000 条切一个文件，控制单文件行数。
- `rotate.interval.ms: 3600000`：满 1 小时切一个文件，控制单文件的覆盖时间跨度。

两者共同约束文件大小上限。`TimeBasedPartitioner` 按时间生成分区路径（`YYYY/MM/dd`），好处是按天即可定位数据、清理过期文件时直接删整个日期目录。

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

这段骨架揭示了 Connect 的分工：`Connector` 不搬运数据，只负责生成配置；真正干活的是 `Task`。`taskConfigs(maxTasks)` 按 `tasks.max` 返回 N 份配置副本，Worker 据此启动 N 个并行的 `MySourceTask` 实例。所以并行度不是在 Connector 里写死的，而是由 `tasks.max` 决定的——这也解释了 §1 里「`tasks.max` 决定并行度」的落地方式。

## 8. 最佳实践

1. **优先使用成熟的连接器**：Confluent Hub 上有大量经过验证的连接器，避免重复造轮子。
2. **使用 Debezium 进行 CDC**：比轮询方式更实时、更高效，对源数据库压力更小。
3. **配置数据格式转换**：使用 SMT 或自定义转换器，确保数据格式符合目标系统要求。
4. **测试连接器性能**：在生产环境部署前，进行压力测试，确保吞吐量满足需求。
