# 分库分表

## 1. 垂直拆分

```
用户库: users, user_profiles
订单库: orders, order_items
商品库: products, categories
```

## 2. 水平拆分

```yaml
# ShardingSphere 配置
spring:
  shardingsphere:
    rules:
      sharding:
        tables:
          orders:
            actual-data-nodes: ds_${0..1}.orders_${0..7}
            database-strategy:
              standard:
                sharding-column: user_id
                sharding-algorithm-name: db_inline
            table-strategy:
              standard:
                sharding-column: order_id
                sharding-algorithm-name: table_inline
```

## 3. 分片策略

| 策略 | 说明 | 适用场景 |
|------|------|---------|
| 范围分片 | 按 ID/时间范围 | 时序数据 |
| 哈希分片 | 按 hash 值 | 均匀分布 |
| 一致性哈希 | 节点变更影响小 | 动态扩容 |

## 4. 分库分表带来的问题

| 问题 | 说明 | 解决方案 |
|------|------|----------|
| 分布式事务 | 跨库事务一致性 | Seata / 最终一致性 |
| 跨库 JOIN | 无法直接 JOIN | 应用层组装 / 冗余数据 |
| 跨库排序分页 | 全局排序困难 | 应用层归并排序 |
| 全局唯一 ID | 自增 ID 冲突 | 雪花算法 / UUID |
| 扩容困难 | 数据迁移复杂 | 一致性哈希 / 预分片 |
| 聚合查询 | COUNT/SUM 需要汇总 | 应用层汇总 / ES |

## 5. 分布式 ID 方案

```java
// 雪花算法 (Snowflake)
public class SnowflakeIdGenerator {
    private final long epoch = 1609459200000L; // 2021-01-01
    private final long datacenterIdBits = 5L;
    private final long workerIdBits = 5L;
    private final long sequenceBits = 12L;
    
    private final long datacenterId;
    private final long workerId;
    private long sequence = 0L;
    private long lastTimestamp = -1L;
    
    public synchronized long nextId() {
        long timestamp = System.currentTimeMillis();
        if (timestamp == lastTimestamp) {
            sequence = (sequence + 1) & ((1 << sequenceBits) - 1);
            if (sequence == 0) timestamp = waitNextMillis(lastTimestamp);
        } else {
            sequence = 0;
        }
        lastTimestamp = timestamp;
        return ((timestamp - epoch) << 22) | (datacenterId << 17) | (workerId << 12) | sequence;
    }
}

// 使用 Leaf / UidGenerator 等成熟方案
// 美团 Leaf: https://github.com/Meituan-Dianping/Leaf
// 百度 UidGenerator: https://github.com/baidu/uid-generator
```

## 6. ShardingSphere 配置实战

```yaml
# ShardingSphere-Proxy 分库分表配置
schemaName: mydb

dataSources:
  ds_0:
    url: jdbc:mysql://192.168.1.100:3306/mydb_0
    username: root
    password: secret
  ds_1:
    url: jdbc:mysql://192.168.1.101:3306/mydb_1
    username: root
    password: secret

rules:
  - !SHARDING
    tables:
      orders:
        actualDataNodes: ds_${0..1}.orders_${0..7}
        databaseStrategy:
          standard:
            shardingColumn: user_id
            shardingAlgorithmName: db_mod
        tableStrategy:
          standard:
            shardingColumn: order_id
            shardingAlgorithmName: table_mod
        keyGenerateStrategy:
          column: order_id
          keyGeneratorName: snowflake
    shardingAlgorithms:
      db_mod:
        type: MOD
        props:
          sharding-count: 2
      table_mod:
        type: MOD
        props:
          sharding-count: 8
    keyGenerators:
      snowflake:
        type: SNOWFLAKE
```

## 7. 最佳实践

1. **能不分就不分** — 单表千万级以内，优化索引和查询即可
2. **垂直拆分优先** — 按业务拆分数据库，简单有效
3. **水平拆分选择合适的分片键** — 查询最频繁的字段
4. **分片数量预估未来 3-5 年** — 避免频繁扩容
5. **使用成熟中间件** — ShardingSphere / Vitess
6. **分布式事务尽量避免** — 最终一致性优先
7. **全局唯一 ID 使用雪花算法** — 性能好，趋势递增

