# 容器化部署

> 把 Spring Boot 应用打包成 Docker 镜像看似简单——`COPY jar → java -jar` 就完事了。但这样每次代码改动都要重新传输 200MB+ 的依赖层，构建慢得让人怀疑人生。分层构建是解决这个问题的关键。

---

## 1. 分层 Dockerfile

### 1.1 Spring Boot 分层机制

Spring Boot 2.3+ 内置了分层机制，将 jar 分为四层：

| 层 | 内容 | 变化频率 | 大小占比 |
|----|------|---------|---------|
| **dependencies** | 第三方依赖 jar | 极低 | ~70% |
| **spring-boot-loader** | Spring Boot 加载器 | 极低 | ~1% |
| **snapshot-dependencies** | SNAPSHOT 依赖 | 低 | ~5% |
| **application** | 应用代码和配置 | 高 | ~24% |

Maven 配置：

```xml
<plugin>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-maven-plugin</artifactId>
    <configuration>
        <layers>
            <enabled>true</enabled>
        </layers>
    </configuration>
</plugin>
```

### 1.2 多阶段构建 Dockerfile

```dockerfile
# ========== 构建阶段 ==========
FROM eclipse-temurin:21-jdk-alpine AS builder
WORKDIR /app

# 只拷贝构建配置（利用 Docker 缓存，依赖不变时不重新下载）
COPY pom.xml mvnw ./
COPY .mvn .mvn
RUN chmod +x mvnw && ./mvnw dependency:go-offline -B

# 拷贝源码并构建
COPY src src
RUN ./mvnw package -DskipTests -B && \
    java -Djarmode=layertools -jar target/*.jar extract --destination extracted

# ========== 运行阶段 ==========
FROM eclipse-temurin:21-jre-alpine AS runtime
WORKDIR /app

# 创建非 root 用户（安全最佳实践）
RUN addgroup -S app && adduser -S app -G app

# 按层拷贝（变化频率从低到高，最大化缓存命中）
COPY --from=builder /app/extracted/dependencies/ ./
COPY --from=builder /app/extracted/spring-boot-loader/ ./
COPY --from=builder /app/extracted/snapshot-dependencies/ ./
COPY --from=builder /app/extracted/application/ ./

# 切换到非 root 用户
USER app

# 暴露端口
EXPOSE 8080

# 健康检查
HEALTHCHECK --interval=30s --timeout=10s --retries=3 --start-period=40s \
  CMD wget -qO- http://localhost:8080/actuator/health || exit 1

# JVM 参数通过环境变量注入（灵活调整）
ENTRYPOINT ["sh", "-c", "java ${JAVA_OPTS:-} org.springframework.boot.loader.launch.JarLauncher"]
```

### 1.3 构建与运行

```bash
# 构建镜像（首次较慢，后续只重建 application 层）
docker build -t order-service:1.0.0 .

# 运行（通过 JAVA_OPTS 注入生产参数）
docker run -d \
  -p 8080:8080 \
  -e JAVA_OPTS="-Xms2g -Xmx2g -XX:+UseG1GC -XX:MaxGCPauseMillis=200" \
  -e SPRING_PROFILES_ACTIVE=prod \
  -e DB_USERNAME=admin \
  -e DB_PASSWORD=secret \
  --name order-service \
  order-service:1.0.0
```

**踩坑提醒：**
- 使用 JRE 而不是 JDK 做运行镜像——JDK 比 JRE 大 200MB+，而且生产环境不需要编译器
- `--start-period` 要留够——Spring Boot 启动可能需要 30-60 秒，这段时间健康检查失败不应重启容器
- 不要在 Dockerfile 中硬编码密码，用环境变量或 Kubernetes Secret

---

## 2. Docker Compose 编排

本地开发和测试时，你需要把应用和它依赖的 MySQL、Redis、RabbitMQ 一起跑起来。

### 2.1 完整编排文件

```yaml
# docker-compose.yml
version: "3.8"

services:
  # ========== 应用服务 ==========
  order-service:
    build:
      context: .
      dockerfile: Dockerfile
    ports:
      - "8080:8080"
    environment:
      SPRING_PROFILES_ACTIVE: docker
      DB_HOST: mysql
      DB_PORT: 3306
      DB_USERNAME: root
      DB_PASSWORD: root123
      REDIS_HOST: redis
      REDIS_PORT: 6379
      RABBITMQ_HOST: rabbitmq
      RABBITMQ_PORT: 5672
    depends_on:
      mysql:
        condition: service_healthy
      redis:
        condition: service_healthy
      rabbitmq:
        condition: service_healthy
    restart: unless-stopped
    deploy:
      resources:
        limits:
          memory: 2G
          cpus: "2.0"
        reservations:
          memory: 512M
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:8080/actuator/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s

  # ========== MySQL ==========
  mysql:
    image: mysql:8.0
    ports:
      - "3306:3306"
    environment:
      MYSQL_ROOT_PASSWORD: root123
      MYSQL_DATABASE: order_db
      MYSQL_CHARACTER_SET_SERVER: utf8mb4
      MYSQL_COLLATION_SERVER: utf8mb4_unicode_ci
    volumes:
      - mysql_data:/var/lib/mysql
      - ./sql/init.sql:/docker-entrypoint-initdb.d/init.sql
    command: >
      --default-authentication-plugin=mysql_native_password
      --innodb-buffer-pool-size=512M
      --max-connections=500
      --slow-query-log=ON
      --long-query-time=1
    healthcheck:
      test: ["CMD", "mysqladmin", "ping", "-h", "localhost", "-uroot", "-proot123"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 30s

  # ========== Redis ==========
  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    command: redis-server --maxmemory 256mb --maxmemory-policy allkeys-lru
    volumes:
      - redis_data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 3

  # ========== RabbitMQ ==========
  rabbitmq:
    image: rabbitmq:3.13-management-alpine
    ports:
      - "5672:5672"
      - "15672:15672"
    environment:
      RABBITMQ_DEFAULT_USER: guest
      RABBITMQ_DEFAULT_PASS: guest
    volumes:
      - rabbitmq_data:/var/lib/rabbitmq
    healthcheck:
      test: ["CMD", "rabbitmq-diagnostics", "-q", "ping"]
      interval: 15s
      timeout: 10s
      retries: 3
      start_period: 20s

volumes:
  mysql_data:
  redis_data:
  rabbitmq_data:
```

### 2.2 环境专用配置

```yaml
# application-docker.yml
spring:
  datasource:
    url: jdbc:mysql://${DB_HOST:localhost}:${DB_PORT:3306}/order_db?useSSL=false&serverTimezone=Asia/Shanghai
  data:
    redis:
      host: ${REDIS_HOST:localhost}
      port: ${REDIS_PORT:6379}
  rabbitmq:
    host: ${RABBITMQ_HOST:localhost}
    port: ${RABBITMQ_PORT:5672}
```

### 2.3 启动顺序与健康检查

```
docker compose up -d
  ↓
MySQL 启动 → healthcheck: mysqladmin ping → ✅ healthy
Redis 启动 → healthcheck: redis-cli ping → ✅ healthy
RabbitMQ 启动 → healthcheck: rabbitmq-diagnostics ping → ✅ healthy
  ↓
order-service 启动（depends_on condition: service_healthy）
  ↓
应用健康检查 → actuator/health → ✅ healthy
```

**踩坑提醒：**
- `depends_on` 只保证 **容器启动** 顺序，不保证 **服务就绪** 顺序。必须配合 `healthcheck + condition: service_healthy`
- `volumes` 要用 **命名卷**（named volume）而不是 bind mount——命名卷由 Docker 管理，数据持久化更可靠
- 生产环境不要用 Docker Compose，用 Kubernetes。Compose 适合本地开发和测试
