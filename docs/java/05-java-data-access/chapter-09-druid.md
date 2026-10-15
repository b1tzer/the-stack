# Druid：带监控的连接池

> HikariCP 只做一件事——管好连接；Druid 在做连接池之外，还内置了 SQL 监控、SQL 防火墙、Web 监控和可视化监控台。本章不重复连接池原理，聚焦 Druid 独有的能力、实际输出的日志长什么样，以及怎么用。

## 定位与组件

Druid 是阿里巴巴开源的数据库连接池。它和 HikariCP 解决同一个底层问题——复用物理连接、避免反复建连，但设计取向不同：

| 维度 | HikariCP | Druid |
| :-- | :-- | :-- |
| 定位 | 以连接管理与轻量实现为设计取向 | 连接池 + 监控 + 安全能力 |
| SQL 监控 | 不内置 Druid 式的 SQL 统计与监控台，需外部工具补充 | 内置 `StatFilter`，统计耗时、慢查询 |
| SQL 防火墙 | 无内置与 `WallFilter` 对应的 SQL 防火墙 | 内置 `WallFilter`，防注入 |
| Web/接口监控 | 无 | 内置 `WebStatFilter`，统计 URI / Session |
| 监控台 | 无 | 内置 Web 页面 `/druid/` |
| 性能 | 实现以 `ConcurrentBag` 为主；实际吞吐需压测 | 功能更全；实际吞吐需压测 |
| 默认配置 | 常见 JDBC 自动配置场景下优先使用 | 通常需引入 Druid Starter 并启用对应自动配置 |

连接池为什么存在和通用容量模型见[JDBC 性能瓶颈与连接池](./chapter-03-jdbc-performance-pool.md)，HikariCP 的参数、指标与调优见[数据访问性能优化](./chapter-08-performance.md)。本章只讲 Druid 比 HikariCP 多出来的东西。

### 组件全景

Druid 的功能由连接池、JDBC Filter、Web 过滤器和监控 Servlet 等组件协同提供：

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

## 快速接入

### 引入依赖

```xml
<!-- Spring Boot 2.x -->
<dependency>
    <groupId>com.alibaba</groupId>
    <artifactId>druid-spring-boot-starter</artifactId>
    <version>1.2.23</version>
</dependency>

<!-- Spring Boot 3.x（Jakarta EE 9+、JDK 17+）使用专用 starter，坐标不同 -->
<dependency>
    <groupId>com.alibaba</groupId>
    <artifactId>druid-spring-boot-3-starter</artifactId>
    <version>1.2.23</version>
</dependency>
```

::: warning 版本锚点
Spring Boot 3.x 使用 `druid-spring-boot-3-starter`（Jakarta EE 9+、JDK 17+）；Spring Boot 2.x 使用 `druid-spring-boot-starter`。两者配置前缀一致，仅坐标不同，不要混用。
:::

### 最小配置

```yaml
spring:
  datasource:
    druid:
      url: jdbc:mysql://localhost:3306/mydb
      username: ${DB_USERNAME}
      password: ${DB_PASSWORD}
      driver-class-name: com.mysql.cj.jdbc.Driver
      # 连接池
      initial-size: 5
      min-idle: 5
      max-active: 20
      max-wait: 60000
```

以上容量参数为演示配置方式所用，不代表适用于所有应用的推荐值，应按实际并发与数据库负载调整。

引入与 Spring Boot 版本匹配的 Druid Starter 后，在其自动配置条件满足、且没有被其他配置覆盖数据源选择的情况下，Spring Boot 会创建 `DruidDataSource`，通常无需写 Java 代码。

## SQL 观测与防护

### SQL 监控

监控由 `StatFilter` 提供。下面两种写法都能启用统计，但属于任选其一；需要定制阈值或合并 SQL 时通常使用第二种。

```yaml
spring:
  datasource:
    druid:
      filters: stat,wall          # 方式一：逗号分隔，使用默认配置
```

如需定制统计行为，使用第二种写法，并移除 `filters` 中的 `stat`：

```yaml
spring:
  datasource:
    druid:
      filter:
        stat:
          enabled: true
          merge-sql: true         # 合并同类 SQL，把 ? 替换为参数后归并统计
          slow-sql-millis: 2000   # 超过 2 秒记为慢查询
          log-slow-sql: true      # 慢查询打印日志
```

#### 慢查询日志长什么样

开启 `log-slow-sql` 后，超过阈值的 SQL 会打到应用日志里：

```txt
[main] INFO  com.alibaba.druid.filter.stat.StatFilter - slow sql 2341 millis. select * from orders where user_id = 123 and status = 'PAID' order by create_time desc[]
```

关键字段：`slow sql <耗时> millis` 后面紧跟完整 SQL。定位慢查询时可先用 `grep "slow sql"` 从应用日志中筛选慢 SQL 记录，再结合执行计划、数据库负载和相关时间段的监控指标判断耗时原因。

#### 逐条 SQL 日志

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

#### `merge-sql` 的作用

不加 `merge-sql`，`select * from user where id = 1` 和 `id = 2` 是两条独立统计；开启后合并为 `select * from user where id = ?` 一条。监控台里的 SQL 列表会干净很多，也更便于观察某个 SQL 模板在 Druid 统计范围内的调用频次，但不能据此认定所有实际执行都已被完整捕获。

### SQL 防火墙

`WallFilter` 会解析 SQL，并依据可配置规则识别可疑语句结构。它比单纯匹配关键词更可靠，但不能作为安全边界：解析能力、严格语法检查配置和包装路径都可能造成漏报。参数绑定、最小权限、输入验证和数据库审计仍不可省略。

```yaml
spring:
  datasource:
    druid:
      filter:
        wall:
          enabled: true
          config:
            drop-table-allow: false   # 禁止 DROP TABLE 类操作
            delete-allow: false       # 禁止 DELETE；启用前确认业务确实不需要删除操作
```

被拦截的 SQL 会抛异常，日志类似：

```txt
sql injection violation, comment not allow : select * from users where id = 1 or 1=1
```

## 控制台、Web 监控与 API

### Web 监控

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

`exclusions` 用于排除不需要统计的请求。通常可以排除静态资源，以减少无关数据；如果不希望监控台自身的请求进入 URI 统计，也可以排除 `/druid/*`。具体规则应根据项目的 URL 结构和监控目的调整。

### Spring 监控

通过 AOP 统计 Service/Mapper 方法的调用次数与耗时，需要引入 `spring-boot-starter-aop` 并指定切入点：

```yaml
spring:
  datasource:
    druid:
      aop-patterns: com.example.repository.*
```

不配置 `aop-patterns` 时，「Spring 监控」标签页为空。

### 监控台

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

启动后访问 `http://localhost:8080/druid/`。监控台分多个标签页：

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
`/druid/` 可能暴露 SQL 文本、数据库对象信息与业务访问特征。生产环境必须设置 `login-username` / `login-password`，并用 `allow` 限制到运维网段；`deny` 优先于 `allow`。
:::

### JSON API

监控台的数据可通过 JSON API 读取，便于接入自建监控或脚本拉取：

```txt
GET /druid/basic.json         # 数据源基本信息
GET /druid/sql.json           # SQL 统计
GET /druid/wall.json          # 防火墙拦截统计
GET /druid/weburi.json        # URI 访问统计
GET /druid/spring.json        # Spring 方法监控
```

这些接口返回 Druid 的统计数据，可用于排障脚本或自建采集程序。若要接入 Prometheus，需要编写或使用适配的 exporter，把 JSON 字段转换为 Prometheus 指标，并处理采集频率、指标类型、标签基数与接口访问权限，不能仅凭接口返回 JSON 就认为它能被 Prometheus 直接抓取。

## 连接泄漏与安全

### 连接泄漏检测

连接池耗尽不等于连接泄漏。使用 Spring 事务管理和 MyBatis/JPA 时，框架通常会负责管理连接的获取与归还，但资源使用时间过长、异常路径处理不当或手动 JDBC 代码未正确关闭资源，仍可能导致连接长期无法复用。排查时先区分两类问题：连接没有正常归还，属于泄漏或资源管理问题；连接最终会归还，但被事务、慢 SQL 或其他操作长时间占用，则属于连接占用过久。两者都可能造成连接池耗尽，但处理方式不同。

**长事务**：`@Transactional` 方法里调用外部慢服务。事务内调用外部慢服务会延长事务时长；若该事务已获取连接，连接通常占用至事务结束，外部调用越慢，连接可供其他请求使用的时间越少，高并发下加剧连接池等待，但不等于连接泄漏。

```java
@Transactional
public void createOrder(Order order) {
    orderMapper.insert(order);
    // ❌ 事务内调用外部服务，连接被持有整个 RPC 耗时
    String result = stockService.checkAndDeduct(order.getSku());
    orderMapper.updateStatus(order.getId(), result);
}
```

**在事务方法中启动异步任务**：Spring 的事务上下文通常绑定当前线程，普通线程池任务不会自动继承该事务和绑定连接。异步 Mapper 调用可能在独立会话中执行，无法看到主事务尚未提交的修改；任务完成时机也与主事务提交时机无确定关系。

```java
@Transactional
public void process(Long id) {
    User user = userMapper.selectById(id);
    // 主线程的 Spring 事务上下文不会自动传播到普通线程池任务；异步任务若访问数据库，会在自己的执行上下文中获取连接并按其事务配置执行，不能直接依赖主线程尚未提交的事务
    executor.submit(() -> orderMapper.selectByUserId(user.getId()));
}
```

这类异步使用不会自动“继承主连接”，会引入事务隔离、任务完成时序和额外连接使用问题。若异步任务必须读取主事务提交后的数据，应安排其触发时机，避免先于事务提交执行；允许失败后重试的非关键任务可在事务提交后触发，要求数据库提交与任务投递具备可靠一致性的场景，则应考虑事务消息、Outbox 等方案，而非仅依赖代码执行顺序。

Druid 的 `remove-abandoned` 默认关闭。启用后，连接借出超过超时阈值会被强制关闭，而不是等待线程正常归还，因此可能中断仍在执行的事务。官方仅建议在开发和测试环境使用；生产环境应优先记录借出堆栈、修复泄漏，并为连接获取和语句执行设置合理超时：

```yaml
spring:
  datasource:
    druid:
      remove-abandoned: true             # 仅限开发/测试或经评估的临时诊断
      remove-abandoned-timeout: 300      # 超过 300 秒后强制关闭连接
      log-abandoned: true                # 打印泄漏连接的借出堆栈
```

开启 `log-abandoned` 后，日志会输出泄漏连接的获取位置，堆栈顶部即持有过久的事务方法。

### 密码加密

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

`ConfigFilter` 在建立连接前用公钥解密密文，因此配置文件中无需保存明文密码。但这不等于完成了完整的密钥管理：仍应限制配置文件与密钥材料的访问权限，并评估密文、解密配置及运行环境的泄露风险；生产环境还应优先考虑受控的密钥管理或 Secret 注入机制，并使用与依赖版本一致的 Druid JAR 生成密文、核验解密配置。

## 本章小结

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
