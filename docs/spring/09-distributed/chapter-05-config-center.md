# 配置中心

> 当你的微服务有十几个实例，配置文件散落在各个项目中，改个数据库连接地址需要重启所有服务——这是配置中心要解决的核心问题：**集中管理、动态刷新、环境隔离**。

## 1. Nacos Config 架构

Nacos 使用**长轮询（Long Polling）**机制：客户端每隔 30 秒向服务端发起请求，服务端会 hold 住连接直到配置变更或超时。这样既避免了推送的连接维护成本，又比短轮询更及时。

```text
┌─────────────┐     ①发布配置      ┌─────────────┐
│  管理控制台   │ ──────────────────▶ │  Nacos Server │
└─────────────┘                     └──────┬──────┘
                                           │
                               ②长轮询/推送通知
                                           │
                    ┌──────────────────────┼──────────────────────┐
                    ▼                      ▼                      ▼
             ┌───────────┐          ┌───────────┐          ┌───────────┐
             │ Service-A  │          │ Service-B  │          │ Service-C  │
             └───────────┘          └───────────┘          └───────────┘
```

## 2. Spring Boot 集成

### 2.1 依赖

```xml
<dependency>
    <groupId>com.alibaba.cloud</groupId>
    <artifactId>spring-cloud-starter-alibaba-nacos-config</artifactId>
    <version>2023.0.1.0</version>
</dependency>
<!-- Spring Boot 3.x 需要 -->
<dependency>
    <groupId>org.springframework.cloud</groupId>
    <artifactId>spring-cloud-starter-bootstrap</artifactId>
</dependency>
```

### 2.2 bootstrap.yml 配置

```yaml
spring:
  application:
    name: order-service
  profiles:
    active: dev
  cloud:
    nacos:
      config:
        server-addr: 127.0.0.1:8848
        namespace: dev-namespace-id       # 命名空间隔离环境
        group: DEFAULT_GROUP
        file-extension: yaml
        shared-configs:                    # 共享配置
          - data-id: common-datasource.yaml
            group: SHARED_GROUP
            refresh: true
          - data-id: common-redis.yaml
            group: SHARED_GROUP
            refresh: true
```

### 2.3 Namespace / Group / Data ID 三层结构

```text
Namespace（命名空间）── 通常按环境划分：dev / test / prod
    │
    ├── Group（分组）── 通常按业务域划分：order-group / user-group
    │       │
    │       ├── Data ID: order-service.yml
    │       └── Data ID: common-mq.yml
    │
    └── Group: shared-group
            ├── Data ID: common-redis.yml
            └── Data ID: common-datasource.yml
```

## 3. @RefreshScope 热更新

```java
@RestController
@RefreshScope  // 关键：配置变更时自动刷新 Bean
@Slf4j
public class ConfigController {

    @Value("${order.timeout:30}")
    private int orderTimeout;

    @Value("${order.max-retry:3}")
    private int maxRetry;

    @GetMapping("/config/info")
    public Map<String, Object> getConfig() {
        return Map.of(
            "orderTimeout", orderTimeout,
            "maxRetry", maxRetry
        );
    }
}
```

**@RefreshScope 的工作原理**：

```text
配置变更事件
    │
    ▼
ContextRefresher.refresh()
    │
    ▼
销毁 @RefreshScope 标注的 Bean（从 scope 缓存中移除）
    │
    ▼
下次访问时重新创建 Bean（使用新的 @Value 值）
```

> **踩坑提醒**：
> - `@RefreshScope` 刷新时会 **销毁并重建** Bean，如果 Bean 有状态会丢失
> - 只有通过 `@Value` 和 `@ConfigurationProperties` 绑定的属性才会刷新
> - 如果 Bean 被其他 Bean 以字段注入方式引用，刷新后引用方拿到的仍是旧对象，建议配合 `@Lazy` 或方法注入使用

## 4. 配置优先级

Nacos 配置优先级（从高到低）：

1. `Nacos` 上的配置（远程）
2. `application-{profile}.yml`（本地 profile 配置）
3. `application.yml`（本地默认配置）
4. `@ConfigurationProperties` 默认值
5. `@Value` 默认值

共享配置（shared-configs）的优先级 **低于** 应用自身的 data-id 配置。

## 5. 配置变更监听

```java
@Component
public class ConfigChangeListener {

    @Autowired
    private NacosConfigManager nacosConfigManager;

    @PostConstruct
    public void init() throws NacosException {
        nacosConfigManager.getConfigService()
            .addListener("order-service.yml", "DEFAULT_GROUP",
                new Listener() {
                    @Override
                    public Executor getExecutor() {
                        return null;
                    }

                    @Override
                    public void receiveConfigInfo(String configInfo) {
                        log.info("配置变更: {}", configInfo);
                        refreshCache();
                    }
                });
    }
}
```

## 6. 配置版本管理与灰度发布

### 6.1 版本管理

Nacos 支持配置的历史版本和灰度发布——改配置出问题时能秒级回滚，新配置先给少量实例验证。

```java
@Service
public class NacosConfigManager {

    private final ConfigService configService;

    public NacosConfigManager(ConfigService configService) {
        this.configService = configService;
    }

    // 获取配置的历史版本列表
    public List<ConfigHistory> getHistory(String dataId, String group, int pageNo, int pageSize)
            throws NacosException {
        return configService.getConfigHistory(dataId, group, pageNo, pageSize);
    }

    // 回滚到指定的历史版本
    public boolean rollback(String dataId, String group, String nid) throws NacosException {
        return configService.rollback(dataId, group, nid);
    }
}
```

### 6.2 灰度发布

```
┌─────────────────────────────────────────────────────┐
│                   Nacos 配置中心                       │
├─────────────────────────────────────────────────────┤
│                                                     │
│  data-id: order-service.yaml                        │
│  ┌─────────┐  ┌──────────┐  ┌──────────────────┐   │
│  │ 正式版本  │  │ 灰度版本  │  │ 灰度规则（IP列表）│   │
│  │ timeout=30│  │ timeout=60│  │ 10.0.1.5, .6    │   │
│  └─────────┘  └──────────┘  └──────────────────┘   │
│                                                     │
│  实例 10.0.1.5 → 读取灰度版本 (timeout=60)           │
│  实例 10.0.1.7 → 读取正式版本 (timeout=30)           │
└─────────────────────────────────────────────────────┘
```

```java
@RefreshScope
@Configuration
public class GrayConfig {

    @Value("${feature.gray.enabled:false}")
    private boolean grayEnabled;

    @Value("${feature.gray.ratio:0}")
    private int grayRatio;

    public boolean shouldGray(String userId) {
        if (!grayEnabled) return false;
        return Math.abs(userId.hashCode() % 100) < grayRatio;
    }
}
```

### 6.3 配置变更操作 SOP

1. 修改配置前，先 **导出当前配置** 作为备份
2. 在 Nacos 控制台修改配置并发布
3. 观察灰度实例的日志和指标（1-5 分钟）
4. 灰度验证通过后，全量发布
5. 出现异常，立即使用 **版本回滚** 功能恢复

> **踩坑提醒**：Nacos 的配置回滚 **不会触发 @RefreshScope 刷新**——回滚后需要手动发布一次才能让客户端感知到变更。

## 7. Apollo vs Nacos 对比

| 特性 | Nacos | Apollo |
|------|-------|--------|
| 出品方 | 阿里巴巴 | 携程 |
| 配置变更推送 | 长轮询（准实时） | 推送 + 长轮询（实时） |
| 配置回滚 | ✅ | ✅ |
| 灰度发布 | ✅（IP 级） | ✅（集群级） |
| 权限管理 | 基础 | 完善（审批流程） |
| 多环境 | Namespace | Env（独立部署） |
| 服务发现 | ✅ 内置 | ❌ |
| 国内生态 | ★★★★★ | ★★★★ |

## 8. 最佳实践

1. **配置分离**——业务配置用 Nacos，基础设施配置用 K8s ConfigMap/Secret
2. **敏感信息加密**——密码、密钥等不要明文存储在配置中心
3. **配置变更要有审批**——生产环境配置变更必须经过审核
4. **`@RefreshScope` 慎用**——Bean 重建可能影响有状态的组件
5. **配置降级**——配置中心不可用时，应用应能使用本地缓存的配置启动
