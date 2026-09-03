# Druid：带监控的连接池

> HikariCP 只做一件事——管好连接；Druid 在做连接池之外，还内置了 SQL 监控、SQL 防火墙、Web 监控和可视化监控台。本章不重复连接池原理，聚焦 Druid 独有的能力、实际输出的日志长什么样，以及怎么用。

## 1. 定位

Druid 是阿里巴巴开源的数据库连接池。它和 HikariCP 解决同一个底层问题——复用物理连接、避免反复建连，但设计取向不同：

| 维度 | HikariCP | Druid |
| :-- | :-- | :-- |
| 定位 | 极致性能的连接池 | 连接池 + 监控 + 安全 |
| SQL 监控 | 无（需外部工具） | 内置 `StatFilter`，统计耗时、慢查询 |
| SQL 防火墙 | 无 | 内置 `WallFilter`，防注入 |
| Web/接口监控 | 无 | 内置 `WebStatFilter`，统计 URI / Session |
| 监控台 | 无 | 内置 Web 页面 `/druid/` |
| 性能 | 更高（`ConcurrentBag` 无锁） | 略低，功能更全 |
| 默认 | Spring Boot 2.x 起默认 | 需手动引入 |

连接池本身的原理——为何建连昂贵、参数如何调——在 [性能优化](./chapter-05-performance.md) §1 已讲，这里不重复。本章只讲 Druid 比 HikariCP 多出来的东西。

## 2. 组件全景

Druid 的能力来自三条互相独立的线：

| 组件 | 类型 | 作用 |
| :-- | :-- | :-- |
| `DruidDataSource` | 数据源 | 连接池本身 |
| `StatFilter` / `WallFilter` 等 | Filter 链 | 拦截 JDBC 调用，采集统计、拦截危险 SQL |
| `WebStatFilter` | Web Filter | 拦截 HTTP 请求，统计 URI / Session |
| `StatViewServlet` | Servlet | 提供监控台与 JSON API |

```txt
   HTTP 请求
      │
      ▼
 ┌──────────────┐     采集 URI/Session     ┌─────────────────┐
 │ WebStatFilter│ ──────────────────────▶ │  StatViewServlet│  ← 监控台 /druid/
 └──────────────┘                         └─────────────────┘
      │                                              ▲
      ▼                                              │     聚合数据
 ┌─────────────┐   JDBC 调用    ┌──────────────────┐  │
 │   应用代码   │  ───────────▶  │ DruidDataSource  │  │
 └─────────────┘               │  Filter 链        │──┘
                               │ stat/wall         │
                               └───────────────────┘
```

## 3. 快速接入

### 3.1 引入依赖

```xml
<dependency>
    <groupId>com.alibaba</groupId>
    <artifactId>druid-spring-boot-starter</artifactId>
    <version>1.2.23</version>
</dependency>
```

::: warning 版本锚点
Spring Boot 3.x 使用 `druid-spring-boot-3-starter`（Jakarta EE 9+、JDK 17+）；Spring Boot 2.x 使用 `druid-spring-boot-starter`。两者配置前缀一致，仅坐标不同。
:::

### 3.2 最小配置

```yaml
spring:
  datasource:
    druid:
      url: jdbc:mysql://localhost:3306/mydb
      username: root
      password: 123456
      driver-class-name: com.mysql.cj.jdbc.Driver
      # 连接池
      initial-size: 5
      min-idle: 5
      max-active: 20
      max-wait: 60000
```

引入 starter 后，Spring Boot 自动配置会把 `DataSource` 换成 `DruidDataSource`，无需写 Java 代码。

## 4. SQL 监控

监控由 `StatFilter` 提供。开启方式有两种，等价：

```yaml
spring:
  datasource:
    druid:
      filters: stat,wall          # 方式一：逗号分隔，用默认配置
      # 方式二：逐个配置，可定制（与方式一任选其一）
      filter:
        stat:
          enabled: true
          merge-sql: true         # 合并同类 SQL，把 ? 替换为参数后归并统计
          slow-sql-millis: 2000   # 超过 2 秒记为慢查询
          log-slow-sql: true      # 慢查询打印日志
```

### 4.1 慢查询日志长什么样

开启 `log-slow-sql` 后，超过阈值的 SQL 会打到应用日志里：

```txt
[main] INFO  com.alibaba.druid.filter.stat.StatFilter - slow sql 2341 millis. select * from orders where user_id = 123 and status = 'PAID' order by create_time desc[]
```

关键字段：`slow sql <耗时> millis` 后面紧跟完整 SQL。定位慢查询时直接 `grep "slow sql"` 即可。

### 4.2 逐条 SQL 日志

配合 `slf4j` 日志 Filter，可以把每条 SQL 的耗时打到日志，排查问题时比监控台更顺手：

```yaml
spring:
  datasource:
    druid:
      filters: stat,slf4j
```

```txt
2026-08-31 11:00:00.123 DEBUG 12345 --- [http-nio-8080-exec-1] c.a.druid.filter.logging.Slf4jLogFilter :
{conn-10001, pstmt-20001} executed. 3.5 millis. select * from users where id = ?
```

### 4.3 `merge-sql` 的作用

不加 `merge-sql`，`select * from user where id = 1` 和 `id = 2` 是两条独立统计；开启后合并为 `select * from user where id = ?` 一条。监控台里的 SQL 列表会干净很多，也更能反映「这条 SQL 模板」的真实频次。

## 5. SQL 防火墙

`WallFilter` 对 SQL 做语法解析，识别注入特征并拦截。它把 SQL 解析成 AST、判断结构是否危险，而非匹配关键词黑名单——因此比正则过滤更可靠。

```yaml
spring:
  datasource:
    druid:
      filter:
        wall:
          enabled: true
          config:
            drop-table-allow: false   # 禁止 DROP TABLE
            delete-allow: false       # 禁止 DELETE
```

被拦截的 SQL 会抛异常，日志类似：

```txt
sql injection violation, comment not allow : select * from users where id = 1 or 1=1
```

## 6. Web 监控

`WebStatFilter` 拦截 HTTP 请求，把「哪个 URI 触发了多少 SQL、耗时多少」关联起来，是监控台「Web 应用」「URI 监控」标签页的数据来源：

```yaml
spring:
  datasource:
    druid:
      web-stat-filter:
        enabled: true
        url-pattern: /*
        exclusions: "*.js,*.gif,*.jpg,*.png,*.css,*.ico,/druid/*"
        session-stat-enable: true       # 开启 Session 统计
        session-stat-max-count: 1000
```

`exclusions` 必须排除静态资源和 `/druid/*`，否则监控台会把对自己的访问也统计进去。

## 7. Spring 监控

通过 AOP 统计 Service/Mapper 方法的调用次数与耗时，需要引入 `spring-boot-starter-aop` 并指定切入点：

```yaml
spring:
  datasource:
    druid:
      aop-patterns: com.example.repository.*
```

不配置 `aop-patterns` 时，「Spring 监控」标签页为空。

## 8. 监控台

```yaml
spring:
  datasource:
    druid:
      stat-view-servlet:
        enabled: true
        url-pattern: /druid/*
        login-username: admin
        login-password: admin
        allow: 127.0.0.1            # 白名单，空 = 全部允许
        reset-enable: false         # 关闭「重置统计」按钮，防误清
```

启动后访问 `http://localhost:8080/druid/`。监控台分多个标签页，核心是前三个：

| 标签页 | 内容 |
| :-- | :-- |
| 数据源 | 活跃连接、空闲连接、等待线程、连接创建/回收耗时 |
| SQL 监控 | 每条 SQL 的执行次数、总耗时、最慢耗时、错误数、执行分布直方图 |
| SQL 防火墙 | 被拦截的 SQL 与拦截类型 |
| Web 应用 / URI | 每个接口的请求次数与耗时 |
| Spring 监控 | `aop-patterns` 命中方法的调用统计 |
| Session 监控 | 活跃 Session 数、创建时间、最后访问时间 |

SQL 监控列表的形态示意：

```txt
+-------------------------------+--------+---------+---------+--------+--------+
| SQL                           | 执行数 | 总耗时  | 最慢    | 平均   | 错误数 |
+-------------------------------+--------+---------+---------+--------+--------+
| select * from orders where .. | 12,345 | 34.5s   | 2.3s    | 2.8ms  | 0      |
| update stock set count = ..   | 8,901  | 8.9s    | 1.1s    | 1.0ms  | 3      |
+-------------------------------+--------+---------+---------+--------+--------+
```

::: warning 安全
`/druid/` 暴露全部 SQL 与表结构。生产环境必须设置 `login-username` / `login-password`，并用 `allow` 限制到运维网段；`deny` 优先于 `allow`。
:::

## 9. JSON API

监控台的数据可通过 JSON API 读取，便于接入自建监控或脚本拉取：

```txt
GET /druid/basic.json         # 数据源基本信息
GET /druid/sql.json           # SQL 统计
GET /druid/wall.json          # 防火墙拦截统计
GET /druid/weburi.json        # URI 访问统计
GET /druid/spring.json        # Spring 方法监控
```

返回为 JSON，可直接被 Prometheus exporter 或定时任务消费。

## 10. 连接泄漏检测

在现代 Spring Boot + MyBatis/JPA 项目里连接耗尽故障的根因，几乎都不是「忘了关连接」，连接由事务管理器和连接池自动归还，没人直接操作 `Connection`。真正的泄漏来自连接被持有过久。

**长事务**：`@Transactional` 方法里调用外部慢服务。事务不结束连接不归还，占用时长等于事务时长，高并发下等效于泄漏。

```java
@Transactional
public void createOrder(Order order) {
    orderMapper.insert(order);
    // ❌ 事务内调用外部服务，连接被持有整个 RPC 耗时
    String result = stockService.checkAndDeduct(order.getSku());
    orderMapper.updateStatus(order.getId(), result);
}
```

**事务内开异步线程**：`@Transactional` 方法里用线程池异步查库。主方法返回后连接随异步任务继续存活，事务上下文错乱。

```java
@Transactional
public void process(Long id) {
    User user = userMapper.selectById(id);
    // ❌ 事务内异步查库，连接被异步线程持有到任务结束
    executor.submit(() -> orderMapper.selectByUserId(user.getId()));
}
```

这两类场景 `close()` 管不到——连接最终会归还，只是归还得太晚。Druid 的 `remove-abandoned` 按「借出时长」判定：超过阈值仍未归还就强制回收，并打印借出位置：

```yaml
spring:
  datasource:
    druid:
      remove-abandoned: true             # 回收超时未归还的连接
      remove-abandoned-timeout: 300      # 借出超过 300 秒即判定泄漏
      log-abandoned: true                # 打印泄漏连接的借出堆栈
```

开启 `log-abandoned` 后，日志会输出泄漏连接的获取位置，堆栈顶部即持有过久的事务方法。

## 11. 密码加密

数据库密码明文写在 `application.yml` 里是安全隐患。Druid 的 `ConfigFilter` 支持密文配置：

```txt
# 1. 用 Druid 自带工具生成密文
java -cp druid-1.2.23.jar com.alibaba.druid.filter.config.ConfigTools 你的明文密码
# 输出 publicKey / password（密文）
```

```yaml
spring:
  datasource:
    druid:
      password: <上一步生成的密文>
      filters: config
      connection-properties: "config.decrypt=true;config.decrypt.key=<上一步的publicKey>"
```

`ConfigFilter` 在建立连接前用公钥解密密文，配置文件中不再出现明文密码。

## 12. 小结

| 要点 | 结论 |
| :-- | :-- |
| 定位 | 连接池 + 监控 + 防火墙，比 HikariCP 多运维能力 |
| SQL 监控 | `StatFilter`，`slow-sql-millis` 慢查询、`merge-sql` 合并 |
| SQL 防火墙 | `WallFilter`，语法级防注入 |
| Web/Spring 监控 | `WebStatFilter` + `aop-patterns` |
| 监控台 | `/druid/`，含数据源、SQL、URI、Session、防火墙等标签页 |
| 连接泄漏 | `remove-abandoned` + `log-abandoned` 打印借出堆栈 |
| 密码加密 | `ConfigFilter` 密文 + 公钥解密 |
| 版本差异 | Spring Boot 3.x 用 `druid-spring-boot-3-starter` |
