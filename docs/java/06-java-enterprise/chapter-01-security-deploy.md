# 企业系统部署

> 应用写完了，怎么打包才能在任何环境一致运行？怎么部署才能快速、可回滚、能弹性伸缩？本章从 Docker 容器化、Kubernetes 编排、多环境配置三个维度，讲清楚企业级 Java 应用的部署方式。

> 认证授权、数据安全已收敛到 [Spring 安全](../../spring/05-security/chapter-01-security-architecture.md) 与 [软件工程 · 安全](../../engineering/07-security/chapter-01-security-overview.md)，本文不再重复。

## 1. Docker 容器化

### 1.1 为什么需要容器化

| 传统部署痛点 | Docker 解决方式 |
|-------------|----------------|
| "在我电脑上能跑" —— 环境不一致 | 打包应用 + 依赖 + 配置为一个镜像，任何环境一致运行 |
| 部署一台机器需要数小时 | `docker run` 秒级启动 |
| 多个应用共享机器，依赖冲突 | 每个容器独立的文件系统和依赖 |
| 扩容需要采购服务器 | 容器秒级水平扩展 |

### 1.2 Dockerfile 示例

```dockerfile
# ========== 构建阶段 ==========
FROM eclipse-temurin:17-jdk-alpine AS builder
WORKDIR /app

# 先复制依赖文件（利用 Docker 缓存层）
COPY pom.xml .
COPY .mvn .mvn
COPY mvnw .
RUN ./mvnw dependency:go-offline -B

# 再复制源码并构建
COPY src ./src
RUN ./mvnw package -DskipTests -B

# ========== 运行阶段 ==========
FROM eclipse-temurin:17-jre-alpine
WORKDIR /app

# 安全：不使用 root 用户运行
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser

# 从构建阶段复制产物
COPY --from=builder /app/target/*.jar app.jar

# JVM 参数：容器感知内存限制
ENV JAVA_OPTS="-XX:+UseContainerSupport \
               -XX:MaxRAMPercentage=75.0 \
               -XX:InitialRAMPercentage=50.0 \
               -Djava.security.egd=file:/dev/./urandom"

# 健康检查
HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
    CMD wget -qO- http://localhost:8080/actuator/health || exit 1

EXPOSE 8080

ENTRYPOINT ["sh", "-c", "java $JAVA_OPTS -jar app.jar"]
```

**构建和运行**：

```bash
# 构建镜像
docker build -t order-service:1.0.0 .

# 运行容器
docker run -d \
    --name order-service \
    -p 8080:8080 \
    -e SPRING_PROFILES_ACTIVE=prod \
    -e DB_URL=jdbc:mysql://db:3306/order_db \
    order-service:1.0.0
```

### 1.3 多阶段构建的价值

多阶段构建（Multi-stage Build）将"编译"和"运行"分离：

```text
构建阶段（builder）          运行阶段（runtime）
┌─────────────────────┐     ┌─────────────────────┐
│ JDK 17 (~300MB)     │     │ JRE 17 (~180MB)     │
│ Maven (~10MB)       │     │                     │
│ 源代码               │     │ app.jar only        │
│ pom.xml             │     │ (~50MB)             │
│                     │     │                     │
│ 输出: app.jar        │──▶  │ 最终镜像: ~230MB    │
└─────────────────────┘     └─────────────────────┘
```

最终镜像不包含 JDK、Maven、源代码，体积大幅缩小，攻击面也更小。

## 2. Kubernetes 基础

### 2.1 核心资源对象

Kubernetes（K8s）是容器编排的事实标准，其核心资源对象如下：

| 资源 | 作用 | 类比 |
|------|------|------|
| **Pod** | 最小部署单元，包含一个或多个容器 | 一个"宿舍"，里面住着一个或多个"人" |
| **Deployment** | 管理 Pod 的副本数、滚动更新、回滚 | 宿舍管理员，确保始终有 N 间宿舍住着人 |
| **Service** | 为一组 Pod 提供稳定的访问入口（负载均衡） | 前台接待，把访客引导到有空位的宿舍 |
| **ConfigMap** | 存储非敏感配置（键值对或文件） | 公告栏上的通知 |
| **Secret** | 存储敏感信息（密码、证书），Base64 编码 | 上锁的保险柜 |

### 2.2 Deployment 示例

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: order-service
  namespace: production
spec:
  replicas: 3                          # 保持 3 个副本
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1                      # 最多多出 1 个 Pod
      maxUnavailable: 0                # 更新时不允许不可用
  selector:
    matchLabels:
      app: order-service
  template:
    metadata:
      labels:
        app: order-service
    spec:
      containers:
        - name: order-service
          image: registry.example.com/order-service:1.2.0
          ports:
            - containerPort: 8080
          env:
            - name: SPRING_PROFILES_ACTIVE
              valueFrom:
                configMapKeyRef:
                  name: order-config
                  key: spring.profiles.active
            - name: DB_PASSWORD
              valueFrom:
                secretKeyRef:
                  name: order-secret
                  key: db-password
          resources:
            requests:
              memory: "512Mi"
              cpu: "500m"
            limits:
              memory: "1Gi"
              cpu: "1000m"
          readinessProbe:              # 就绪探针：准备好才接收流量
            httpGet:
              path: /actuator/health/readiness
              port: 8080
            initialDelaySeconds: 30
            periodSeconds: 10
          livenessProbe:               # 存活探针：挂了就重启
            httpGet:
              path: /actuator/health/liveness
              port: 8080
            initialDelaySeconds: 60
            periodSeconds: 15
```

### 2.3 Service 示例

```yaml
apiVersion: v1
kind: Service
metadata:
  name: order-service
  namespace: production
spec:
  type: ClusterIP                      # 集群内部访问
  selector:
    app: order-service
  ports:
    - port: 80                         # Service 端口
      targetPort: 8080                 # Pod 端口
      protocol: TCP
```

Service 提供稳定的 DNS 名称：`order-service.production.svc.cluster.local`，无论 Pod 如何漂移，其他服务只需通过这个域名访问。

### 2.4 ConfigMap 与 Secret

```yaml
# ConfigMap - 非敏感配置
apiVersion: v1
kind: ConfigMap
metadata:
  name: order-config
  namespace: production
data:
  spring.profiles.active: "prod"
  app.page-size: "20"
  app.cache-ttl: "300"

---
# Secret - 敏感配置
apiVersion: v1
kind: Secret
metadata:
  name: order-secret
  namespace: production
type: Opaque
data:
  db-password: cGFzc3dvcmQxMjM=    # base64("password123")
  jwt-secret: c2VjcmV0S2V5MTIz     # base64("secretKey123")
```

**最佳实践**：ConfigMap 和 Secret 的值可以在 Pod 内以环境变量或文件挂载的方式使用。环境变量适合简单配置，文件挂载适合配置文件（如 `application.yml`）。

## 3. 多环境配置

### 3.1 Spring Profiles 机制

企业应用通常需要在多个环境（开发、测试、预发布、生产）中运行，每个环境的数据库地址、缓存配置、日志级别都不同。Spring Boot 通过 `spring.profiles.active` 机制解决这个问题：

```text
src/main/resources/
├── application.yml              # 公共配置（所有环境共享）
├── application-dev.yml          # 开发环境
├── application-test.yml         # 测试环境
├── application-staging.yml      # 预发布环境
└── application-prod.yml         # 生产环境
```

**公共配置 application.yml**：

```yaml
spring:
  application:
    name: order-service
  jackson:
    date-format: yyyy-MM-dd HH:mm:ss
    time-zone: Asia/Shanghai

# 公共业务配置
order:
  page-size: 20
  max-retry: 3
```

**开发环境 application-dev.yml**：

```yaml
spring:
  datasource:
    url: jdbc:mysql://localhost:3306/order_dev
    username: root
    password: root
  data:
    redis:
      host: localhost
      port: 6379

logging:
  level:
    com.example: DEBUG
    org.springframework: INFO
```

**生产环境 application-prod.yml**：

```yaml
spring:
  datasource:
    url: jdbc:mysql://${DB_HOST:prod-db}:3306/order_prod
    username: ${DB_USERNAME}
    password: ${DB_PASSWORD}
    hikari:
      maximum-pool-size: 20
      minimum-idle: 5
  data:
    redis:
      host: ${REDIS_HOST}
      port: 6379
      password: ${REDIS_PASSWORD}

logging:
  level:
    com.example: WARN
    org.springframework: WARN
```

### 3.2 激活 Profile 的方式

| 方式 | 示例 | 优先级 |
|------|------|--------|
| 命令行参数 | `java -jar app.jar --spring.profiles.active=prod` | 最高 |
| 环境变量 | `SPRING_PROFILES_ACTIVE=prod` | 高 |
| JVM 参数 | `java -Dspring.profiles.active=prod -jar app.jar` | 中 |
| bootstrap.yml | `spring.profiles.active: ${SPRING_PROFILES_ACTIVE:dev}` | 低 |
| 默认值 | `@Profile("dev")` | 最低 |

在 Kubernetes 中，通常通过 ConfigMap 设置环境变量：

```yaml
env:
  - name: SPRING_PROFILES_ACTIVE
    valueFrom:
      configMapKeyRef:
        name: app-config
        key: spring.profiles.active   # 值为 "prod"
```

### 3.3 配置优先级链

Spring Boot 的配置优先级从高到低：

```text
命令行参数 > java:comp/env > 系统属性 > 系统环境变量
> application-{profile}.yml > application.yml > @PropertySource
> 默认属性（SpringApplication.setDefaultProperties）
```

**设计原则**：公共配置放 `application.yml`，环境差异配置放 `application-{profile}.yml`，敏感信息通过环境变量或 Secret 注入，**永远不要将密码写在代码仓库中**。

## 4. 本章小结

容器化部署解决的是「环境一致性」与「交付效率」问题。Docker 把应用和依赖打包成镜像，Kubernetes 管理副本、滚动更新与自愈，Spring Profiles 隔离多环境配置。三者配合，让 Java 应用从「手动部署」走向「声明式交付」。

> 部署上线后，如何知道系统运行得好不好？用户反馈「接口很慢」时如何定位？下一章从日志、指标、链路追踪三大支柱构建可观测体系。

