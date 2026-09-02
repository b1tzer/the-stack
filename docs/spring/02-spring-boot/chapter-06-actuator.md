# Actuator 监控端点

> 应用跑起来了，但你不知道它内部状态如何——Actuator 给你一个「透视镜」。它通过 HTTP 端点暴露应用的健康状态、指标、环境配置等信息，是生产监控的基础设施。日志、链路追踪等更深层的可观测能力，见独立章节。

## 1. Actuator 端点概览

```xml
<!-- 引入 Actuator -->
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-actuator</artifactId>
</dependency>
```

**核心端点一览：**

| 端点 | 路径 | 功能 | 默认暴露 |
|------|------|------|:-------:|
| 健康检查 | `/actuator/health` | 应用健康状态 | ✅ |
| 应用信息 | `/actuator/info` | 应用名称、版本 | ✅ |
| 指标 | `/actuator/metrics` | JVM、HTTP、自定义指标 | ❌ |
| 环境变量 | `/actuator/env` | 所有配置属性 | ❌ |
| Bean 列表 | `/actuator/beans` | 所有 Bean 信息 | ❌ |
| 条件评估 | `/actuator/conditions` | 自动配置生效/未生效原因 | ❌ |
| 配置属性 | `/actuator/configprops` | @ConfigurationProperties 绑定 | ❌ |
| 线程转储 | `/actuator/threaddump` | JVM 线程状态 | ❌ |
| 堆转储 | `/actuator/heapdump` | JVM 堆内存快照 | ❌ |
| Prometheus | `/actuator/prometheus` | Prometheus 格式指标 | ❌ |

```yaml
# 暴露端点配置
management:
  endpoints:
    web:
      exposure:
        include: health,info,prometheus,metrics
  endpoint:
    health:
      show-details: always  # 显示健康检查详情
```

::: warning 生产安全
生产环境不要暴露 `env` 和 `configprops` 端点——它们会泄露数据库密码、API Key 等敏感信息。只暴露 `health`、`info`、`metrics`。
:::

## 2. 健康检查与自定义 Indicator

`/actuator/health` 返回 `UP` 不代表你的业务真的健康——数据库连接池满了但 health 依然是 UP，因为你没有自定义检查。

### 2.1 内置健康指示器

Spring Boot 自动配置了多个健康指示器：

| 指示器 | 检查内容 | 条件 |
|--------|---------|------|
| `DataSourceHealthIndicator` | 数据库连接 | 有 DataSource Bean |
| `RedisHealthIndicator` | Redis 连接 | 有 RedisConnectionFactory |
| `DiskSpaceHealthIndicator` | 磁盘空间 | 默认启用 |
| `PingHealthIndicator` | 应用存活 | 默认启用 |

### 2.2 自定义健康检查

```java
@Component
public class DatabaseHealthIndicator implements HealthIndicator {

    @Autowired
    private DataSource dataSource;

    @Override
    public Health health() {
        try (Connection conn = dataSource.getConnection()) {
            if (conn.isValid(3)) {
                return Health.up()
                    .withDetail("database", "MySQL")
                    .withDetail("connection_pool", getPoolStats())
                    .build();
            }
        } catch (SQLException e) {
            return Health.down()
                .withDetail("error", e.getMessage())
                .build();
        }
        return Health.down().build();
    }

    private Map<String, Object> getPoolStats() {
        return Map.of(
            "active", 5,
            "idle", 15,
            "total", 20
        );
    }
}
```

### 2.3 健康状态聚合

```json
// /actuator/health 响应示例
{
  "status": "UP",
  "components": {
    "db": {
      "status": "UP",
      "details": {
        "database": "MySQL",
        "connection_pool": {
          "active": 5,
          "idle": 15
        }
      }
    },
    "diskSpace": {
      "status": "UP",
      "details": {
        "free": "10GB",
        "threshold": "10MB"
      }
    },
    "customCheck": {
      "status": "DOWN"
    }
  }
}
```

::: warning 性能注意
`HealthIndicator` 的 `health()` 方法会在每次请求 `/actuator/health` 时调用。如果检查逻辑很重（如远程调用），考虑用 `@Scheduled` 缓存结果，避免每次请求都等待。
:::

## 3. 健康检查分组

K8s 的存活探针（liveness）和就绪探针（readiness）需要不同的健康维度，Actuator 用「健康分组」把多个 Indicator 组合成独立的检查端点：

```yaml
management:
  endpoint:
    health:
      probes:
        enabled: true          # 启用 liveness / readiness 探针
      group:
        liveness:
          include: livenessState
        readiness:
          include: readinessState,db
          show-details: always
```

开启后，`/actuator/health/liveness` 和 `/actuator/health/readiness` 各自独立返回。`include` 指定分组包含哪些 Indicator，`show-details` 控制是否显示详情。把「进程活着」和「依赖就绪」分开，正是滚动发布时避免误杀 Pod 的关键。

## 4. 自定义应用信息：InfoContributor

`/actuator/info` 默认只返回空对象，业务信息要靠 `InfoContributor` 补充：

```java
@Component
public class BuildInfoContributor implements InfoContributor {

    @Override
    public void contribute(Info.Builder builder) {
        builder.withDetail("version", "1.0.0")
               .withDetail("buildTime", LocalDateTime.now().toString());
    }
}
```

访问 `/actuator/info` 即可拿到这些键值。它与 `HealthIndicator` 是同一套路——实现接口、注册 Bean，Actuator 自动聚合所有 `InfoContributor` 的输出。

## 5. 自定义端点：@Endpoint

内置端点覆盖不了业务指标时，用 `@Endpoint` 自定义：

```java
@Component
@Endpoint(id = "orderStats")
public class OrderStatsEndpoint {

    @ReadOperation
    public Map<String, Object> stats() {
        return Map.of(
            "pendingCount", 12,
            "todayCount", 356
        );
    }
}
```

两个要点：自定义端点默认不通过 HTTP 暴露，必须在 `management.endpoints.web.exposure.include` 里显式加上它的 id；`@Endpoint` 同时注册 JMX 和 Web，只想走 Web 用 `@WebEndpoint`，只想走 JMX 用 `@JmxEndpoint`。

## 6. 指标监控

指标的完整内容（Micrometer 核心概念、自定义业务指标、Prometheus + Grafana 集成、PromQL 查询）见 [指标监控](../06-observability/chapter-02-metrics.md)，本文只保留端点层面的概览。
