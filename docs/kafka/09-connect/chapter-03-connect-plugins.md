# 常用连接器插件

## 1. JDBC Connector

### 1.1 Source Connector（从数据库读取）

```json
{
  "name": "jdbc-source",
  "config": {
    "connector.class": "io.confluent.connect.jdbc.JdbcSourceConnector",
    "connection.url": "jdbc:mysql://localhost:3306/mydb?user=root&password=***",
    "table.include.list": "users,orders",
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

`mode: incrementing` 依赖 `incrementing.column.name` 指向的列（这里是 `id`）持续单调递增。Connector 每 `poll.interval.ms`（5 秒）轮询一次，示意查询形如 `SELECT * FROM users WHERE id > 上次记录的最大 id`，把新增行搬进 Kafka。这种模式有两个明确的限制：

| 局限 | 原因 |
| :-- | :-- |
| 捕获不到 UPDATE | 已读过的行 id 不再大于「上次最大 id」，更新被跳过 |
| 捕获不到 DELETE | 删除的行不存在于结果集，无从感知 |

incrementing 只能读到新增行，而且递增列并不保证不漏：并发事务下，较大 id 的事务可能先提交，Connector 据此推进 offset 后，较小 id 的事务才提交，这条较小 id 的记录就会被跳过。JDBC Source 还支持 `timestamp` 和 `timestamp+incrementing` 模式：前者依赖能反映修改时间的列来检测更新，后者结合时间戳与递增列，用递增列为每行生成全局唯一的流 offset。它们可以捕获符合条件的更新，但仍不能直接感知物理删除。如果需要可靠捕获新增、更新和删除，应改用 Debezium 这类基于 CDC 的方案。`transforms` 里的 `ValueToKey` + `ExtractField$Key` 是把 `id` 从 value 提取出来作为 Kafka 消息的 Key，这样下游按主键分区分发时，同一行的变更始终落在同一分区。

### 1.2 Sink Connector（写入数据库）

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

`insert.mode: upsert` 必须配合 `pk.mode: record_key`：以 Kafka 消息的 Key 定位目标行，目标表需要存在与 Key 对应的主键或唯一约束，行已存在则更新、不存在则插入。`pk.fields` 从结构化的 Key 中选取主键字段，适用于 `ValueToKey` 生成的 `Struct` 形态的 Key；若 Key 是原始类型，则需按 Connector 版本确认映射方式。在约束和 upsert 语义正确的前提下，重复处理同一条消息不会仅因重试插入重复行。

`delete.enabled: true` 让 Sink 根据 Kafka 中的 tombstone 记录删除目标行，它不会自动感知源库的删除；需要上游发出 tombstone，且同样依赖 `pk.mode: record_key`。

`auto.create: true` 和 `auto.evolve: true` 让 Connector 自动建表、自动加列，省了手写 DDL；代价是表结构由 Connector 推断生成，字段类型可能不符合预期。生产环境通常先人工建好表、把这两个开关关掉，避免 DDL 失控。

## 2. Debezium（CDC）

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
    "topic.prefix": "myserver",
    "database.include.list": "mydb",
    "schema.history.internal.kafka.bootstrap.servers": "localhost:9092",
    "schema.history.internal.kafka.topic": "schema-changes",
    "table.include.list": "mydb.users,mydb.orders"
  }
}
```

Debezium 与 JDBC 轮询的本质区别在数据来源：它读的是 MySQL 的 binlog，而不是反复 `SELECT`。行变更写入 binlog，Debezium 据此生成事件并写入 Kafka，实时性来自事件驱动，而非缩短轮询间隔。相比 JDBC 的周期性查询，它减少了对业务表的查询负载，但初始快照与 binlog 读取仍会消耗源库资源，事件从数据库提交到可供消费也存在延迟。

三个关键配置的作用：

| 配置 | 作用 |
| :-- | :-- |
| `topic.prefix` | Topic 名前缀，本示例下形如 `myserver.mydb.users` |
| `schema.history.internal.kafka.topic` | 存储 DDL 历史，实例重启后据此还原表结构才能解析 binlog |
| `database.server.id` | binlog 复制协议使用的 server-id，同一 MySQL 实例下所有复制客户端必须唯一 |

## 3. Elasticsearch Connector

```json
{
  "name": "es-sink",
  "config": {
    "connector.class": "io.confluent.connect.elasticsearch.ElasticsearchSinkConnector",
    "connection.url": "http://localhost:9200",
    "topics": "my-topic",
    "key.ignore": false
  }
}
```

`key.ignore: false` 让 Connector 用 Kafka 消息的 Key 作为 Elasticsearch 文档 ID，同一业务主键的多次变更会覆盖同一文档。若设为 `true`，文档 ID 改由 topic、分区和 offset 生成，同一主键的不同 offset 会落成不同文档，无法自然覆盖。

## 4. S3 Connector

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

S3 不适合逐条写，Connector 先把消息缓存在本地，攒够一批再落一个文件。`flush.size` 与 `rotate.interval.ms` 是两个独立的切文件条件，任一满足即提交文件：

- `flush.size: 1000`：攒满 1000 条切一个文件，控制单文件行数。
- `rotate.interval.ms: 3600000`：按文件中首条记录的时间戳计算允许的时间跨度。它不是按墙上时钟定时上传，而是靠后续记录的时间戳判断是否超出跨度，低流量下没有新记录时文件会保持打开，直到新记录到来才触发轮转。

`TimeBasedPartitioner` 按时间生成分区路径（`YYYY/MM/dd`），按天定位数据。删除整个日期目录前需确认该路径只包含目标数据，并评估下游查询、审计或重放是否仍依赖这些对象。

## 5. 自定义连接器开发

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

骨架分工：`Connector` 不搬运数据，只生成配置；真正执行数据搬运的是 `Task`。`taskConfigs(maxTasks)` 的参数是框架允许的最大任务数，返回多少份配置，框架据此创建对应数量的 Task。若各 Task 拿到相同的数据范围，只是重复读取，并不会自动并行分片；需要并行时，Connector 应为不同 Task 分配不重叠的工作范围，如表、分区或主键区间。示例中的 `task.id` 只是自定义透传配置，不承担分片职责。这个骨架省略了 `MySourceTask` 的数据读取、offset 记录与恢复等实现。
