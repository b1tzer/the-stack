# 读写分离

## 1. 方案配置

### 1.1 ProxySQL

```ini
# proxysql.cnf
mysql_variables:
    threads=4
    max_connections=2048

mysql_servers:
    - address: 192.168.1.100
      port: 3306
      hostgroup: 10  # 写组
    - address: 192.168.1.101
      port: 3306
      hostgroup: 20  # 读组
    - address: 192.168.1.102
      port: 3306
      hostgroup: 20  # 读组

mysql_query_rules:
    - match_pattern: "^SELECT"
      destination_hostgroup: 20
      apply: 1
```

### 1.2 MySQL Router

```bash
mysqlrouter --bootstrap root@192.168.1.100:3306 --user=mysql
systemctl start mysqlrouter
```

### 1.3 Spring Boot 配置

```yaml
spring:
  datasource:
    write:
      url: jdbc:mysql://192.168.1.100:3306/mydb
    read:
      url: jdbc:mysql://192.168.1.101:3306/mydb
```

## 2. 整体架构

### 2.1 读写分离架构

```
                     ┌──────────────┐
                     │   应用层      │
                     └──────┬───────┘
                            │
                     ┌──────▼───────┐
                     │   代理层      │  ProxySQL / MySQL Router / ShardingSphere
                     └──────┬───────┘
                            │
              ┌─────────────┼─────────────┐
              │             │             │
       ┌──────▼──────┐ ┌───▼──────┐ ┌───▼──────┐
       │   主库(写)   │ │  从库1(读)│ │  从库2(读)│
       └─────────────┘ └──────────┘ └──────────┘
```

## 3. 进阶方案

### 3.1 ProxySQL 高级配置

```sql
-- 连接 ProxySQL 管理接口
mysql -h 127.0.0.1 -P 6032 -u admin -padmin

-- 添加后端 MySQL 服务器
INSERT INTO mysql_servers (hostgroup_id, hostname, port) VALUES
    (10, '192.168.1.100', 3306),  -- 写组
    (20, '192.168.1.101', 3306),  -- 读组
    (20, '192.168.1.102', 3306);  -- 读组

-- 配置查询规则
INSERT INTO mysql_query_rules (rule_id, match_pattern, destination_hostgroup, apply) VALUES
    (1, '^SELECT .* FOR UPDATE', 10, 1),  -- SELECT FOR UPDATE 发往写组
    (2, '^SELECT', 20, 1);                -- 普通 SELECT 发往读组

-- 加载配置
LOAD MYSQL SERVERS TO RUNTIME;
LOAD MYSQL QUERY RULES TO RUNTIME;
SAVE MYSQL SERVERS TO DISK;
SAVE MYSQL QUERY RULES TO DISK;

-- 监控后端状态
SELECT * FROM monitor.mysql_server_connect_log ORDER BY time_start_us DESC LIMIT 10;
SELECT * FROM monitor.mysql_server_replication_lag_log ORDER BY time_start_us DESC LIMIT 10;
```

### 3.2 ShardingSphere-JDBC 读写分离

```yaml
# application.yml
spring:
  shardingsphere:
    datasource:
      names: master,slave0,slave1
      master:
        type: com.zaxxer.hikari.HikariDataSource
        driver-class-name: com.mysql.cj.jdbc.Driver
        jdbc-url: jdbc:mysql://192.168.1.100:3306/mydb
        username: root
        password: secret
      slave0:
        type: com.zaxxer.hikari.HikariDataSource
        driver-class-name: com.mysql.cj.jdbc.Driver
        jdbc-url: jdbc:mysql://192.168.1.101:3306/mydb
        username: root
        password: secret
      slave1:
        type: com.zaxxer.hikari.HikariDataSource
        driver-class-name: com.mysql.cj.jdbc.Driver
        jdbc-url: jdbc:mysql://192.168.1.102:3306/mydb
        username: root
        password: secret
    rules:
      readwrite-splitting:
        data-sources:
          myds:
            write-data-source-name: master
            read-data-source-names: slave0,slave1
            load-balancer-name: round-robin
        load-balancers:
          round-robin:
            type: ROUND_ROBIN
```

## 4. 注意事项

### 4.1 读写分离注意事项

| 问题 | 原因 | 解决方案 |
| :-- | :-- | :-- |
| 写后读不一致 | 主从复制延迟 | 强制走主库 / 半同步复制 |
| 从库数据过期 | 复制中断 | 监控复制状态，自动摘除故障节点 |
| 事务内读写 | 事务中可能读到旧数据 | 事务内所有操作走主库 |

```java
// Spring 中强制走主库
@Target({ElementType.METHOD, ElementType.TYPE})
@Retention(RetentionPolicy.RUNTIME)
public @interface MasterRoute {}

// AOP 切面实现
@Aspect
@Component
public class MasterRouteAspect {
    @Before("@annotation(masterRoute)")
    public void forceMaster(MasterRoute masterRoute) {
        DynamicDataSource.useMaster();
    }
    
    @After("@annotation(masterRoute)")
    public void clearMaster() {
        DynamicDataSource.clear();
    }
}

// 使用
@Service
public class OrderService {
    @MasterRoute  // 强制走主库
    public Order getOrderAfterCreate(Long orderId) {
        return orderRepository.findById(orderId);
    }
}
```

## 5. 最佳实践

1. **写后读走主库** — 避免主从延迟导致数据不一致
2. **监控从库延迟** — 延迟超过阈值自动摘除
3. **使用连接池** — 减少连接建立开销
4. **读写分离中间件选择** — ProxySQL（运维友好）> ShardingSphere（Java 生态）> MySQL Router（官方）
5. **从库数量合理** — 2-3 个从库即可满足大多数场景
