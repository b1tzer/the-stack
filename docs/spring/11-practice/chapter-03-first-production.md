# 首次生产部署

## 打包

```bash
# Maven
mvn clean package -DskipTests

# 可执行 JAR
java -jar target/demo-0.0.1-SNAPSHOT.jar \
  --spring.profiles.active=prod \
  --server.port=8080
```

## 生产配置

```yaml
# application-prod.yml
server:
  tomcat:
    max-threads: 200
    min-spare-threads: 20
    max-connections: 8192

spring:
  datasource:
    hikari:
      maximum-pool-size: 30
      minimum-idle: 10
  jpa:
    hibernate:
      ddl-auto: none
    open-in-view: false

logging:
  level:
    root: INFO
    com.example: INFO
  file:
    name: /var/log/app/app.log
```

## Docker 部署

```dockerfile
FROM eclipse-temurin:21-jre-alpine
WORKDIR /app
COPY target/*.jar app.jar
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "app.jar"]
```

```bash
docker build -t myapp .
docker run -d -p 8080:8080 --name myapp myapp
```

## JVM 参数

```bash
java -Xms2g -Xmx2g \
  -XX:+UseG1GC \
  -XX:MaxGCPauseMillis=200 \
  -XX:+HeapDumpOnOutOfMemoryError \
  -XX:HeapDumpPath=/var/log/app/heapdump.hprof \
  -jar app.jar
```

## 健康检查

```yaml
# Docker Compose
healthcheck:
  test: ["CMD", "curl", "-f", "http://localhost:8080/actuator/health"]
  interval: 30s
  timeout: 10s
  retries: 3
```

## 部署检查清单

- [ ] 关闭 `ddl-auto`（设为 `none`）
- [ ] 关闭 `show-sql`
- [ ] 关闭 `open-in-view`
- [ ] 配置合理的连接池大小
- [ ] 开启 Actuator 健康检查
- [ ] 配置日志文件路径和轮转
- [ ] 设置 JVM 堆内存和 OOM dump
- [ ] 配置环境变量注入敏感信息
- [ ] 关闭 Swagger/OpenAPI 文档（生产环境）
