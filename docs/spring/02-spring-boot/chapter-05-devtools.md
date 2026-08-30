# DevTools 热部署

## 1. 原理

DevTools 使用双 ClassLoader：
- Base ClassLoader：加载第三方 jar
- Restart ClassLoader：加载项目代码

代码变化时只重启 Restart ClassLoader，速度极快。

## 2. 配置

```xml
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-devtools</artifactId>
    <optional>true</optional>
</dependency>
```

## 3. LiveReload

DevTools 内置 LiveReload 服务器，浏览器安装插件后自动刷新。

## 4. 远程调试配置

### 4.1 远程 DevTools 连接

```xml
<!-- pom.xml -->
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-devtools</artifactId>
    <optional>true</optional>
</dependency>
```

```properties
# application.properties
spring.devtools.remote.secret=mysecret
spring.devtools.remote.restart.enabled=true
```

```bash
# 启动远程应用时启用远程调试
java -agentlib:jdwp=transport=dt_socket,server=y,suspend=n,address=5005 \
     -jar app.jar

# 本地通过 SSH 隧道连接
ssh -L 5005:localhost:5005 user@remote-server
```

### 4.2 IntelliJ IDEA 远程调试

```text
1. Run → Edit Configurations → + → Remote JVM Debug
2. 填写 Host（远程服务器 IP）和 Port（5005）
3. 将 Command line arguments for remote JVM 复制到启动命令
4. 在代码中设置断点
5. 点击 Debug 按钮连接
```

启动命令示例：

```bash
# Spring Boot 项目
java -agentlib:jdwp=transport=dt_socket,server=y,suspend=n,address=*:5005 \
     -jar target/myapp.jar

# 带 Spring 参数
java -agentlib:jdwp=transport=dt_socket,server=y,suspend=n,address=*:5005 \
     -jar target/myapp.jar \
     --spring.profiles.active=dev \
     --server.port=8080
```

### 4.3 Docker 容器远程调试

```dockerfile
# Dockerfile 中暴露调试端口
EXPOSE 8080 5005

ENTRYPOINT ["java", \
    "-agentlib:jdwp=transport=dt_socket,server=y,suspend=n,address=*:5005", \
    "-jar", "app.jar"]
```

```bash
# docker-compose.yml
services:
  app:
    image: myapp:latest
    ports:
      - "8080:8080"
      - "5005:5005"  # 调试端口
    environment:
      - SPRING_PROFILES_ACTIVE=dev
```

```bash
# 启动容器
docker-compose up -d

# 本地 IntelliJ 连接 localhost:5005 进行远程调试
```

### 4.4 Kubernetes 远程调试

```yaml
# deployment.yaml
spec:
  containers:
    - name: myapp
      image: myapp:latest
      ports:
        - containerPort: 8080
        - containerPort: 5005
      env:
        - name: JAVA_TOOL_OPTIONS
          value: "-agentlib:jdwp=transport=dt_socket,server=y,suspend=n,address=*:5005"
      resources:
        limits:
          memory: "512Mi"
          cpu: "500m"
```

```bash
# 端口转发到本地
kubectl port-forward pod/myapp-pod 5005:5005

# 然后 IntelliJ 连接 localhost:5005
```

**最佳实践：**

1. **生产环境禁用远程调试**——开放调试端口是严重安全隐患
2. **开发环境用 DevTools**——代码变更秒级生效，无需重启
3. **远程调试时限制 IP 访问**——只允许开发人员的 IP 连接
4. **Docker 镜像不要包含调试参数**——用环境变量动态注入 `JAVA_TOOL_OPTIONS`
5. **LiveReload 浏览器插件**——前端资源变更自动刷新，提升开发效率
