# CI/CD 流水线

> 手动 `mvn package → scp → ssh restart` 是 2015 年的做法。现代 CI/CD 流水线应该是：代码推送后自动测试、构建镜像、推送仓库、部署到 K8s——全程无人值守。

---

## 1. GitHub Actions 自动化

### 1.1 完整流水线配置

```yaml
# .github/workflows/ci-cd.yml
name: CI/CD Pipeline

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

env:
  REGISTRY: ghcr.io
  IMAGE_NAME: ${{ github.repository }}

jobs:
  # ========== 阶段 1：测试 ==========
  test:
    runs-on: ubuntu-latest
    services:
      mysql:
        image: mysql:8.0
        env:
          MYSQL_ROOT_PASSWORD: test
          MYSQL_DATABASE: test_db
        ports:
          - 3306:3306
        options: >-
          --health-cmd="mysqladmin ping -h localhost"
          --health-interval=10s
          --health-timeout=5s
          --health-retries=5

      redis:
        image: redis:7-alpine
        ports:
          - 6379:6379
        options: >-
          --health-cmd="redis-cli ping"
          --health-interval=10s
          --health-timeout=5s
          --health-retries=3

    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Set up JDK 21
        uses: actions/setup-java@v4
        with:
          java-version: "21"
          distribution: "temurin"
          cache: maven

      - name: Run tests
        run: mvn clean test -B
        env:
          SPRING_DATASOURCE_URL: jdbc:mysql://localhost:3306/test_db
          SPRING_DATASOURCE_USERNAME: root
          SPRING_DATASOURCE_PASSWORD: test
          SPRING_DATA_REDIS_HOST: localhost

      - name: Upload test results
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: test-results
          path: target/surefire-reports/

  # ========== 阶段 2：构建并推送镜像 ==========
  build:
    needs: test
    runs-on: ubuntu-latest
    if: github.event_name == 'push'
    permissions:
      contents: read
      packages: write

    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Set up JDK 21
        uses: actions/setup-java@v4
        with:
          java-version: "21"
          distribution: "temurin"
          cache: maven

      - name: Build JAR
        run: mvn clean package -DskipTests -B

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3

      - name: Login to Container Registry
        uses: docker/login-action@v3
        with:
          registry: ${{ env.REGISTRY }}
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Extract metadata
        id: meta
        uses: docker/metadata-action@v5
        with:
          images: ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}
          tags: |
            type=sha,prefix=
            type=ref,event=branch
            type=semver,pattern={{version}}

      - name: Build and push Docker image
        uses: docker/build-push-action@v5
        with:
          context: .
          push: true
          tags: ${{ steps.meta.outputs.tags }}
          labels: ${{ steps.meta.outputs.labels }}
          cache-from: type=gha
          cache-to: type=gha,mode=max

  # ========== 阶段 3：部署到 K8s ==========
  deploy:
    needs: build
    runs-on: ubuntu-latest
    if: github.ref == 'refs/heads/main'
    environment: production

    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Set up kubectl
        uses: azure/setup-kubectl@v3

      - name: Configure kubeconfig
        run: |
          mkdir -p $HOME/.kube
          echo "${{ secrets.KUBE_CONFIG }}" | base64 -d > $HOME/.kube/config

      - name: Deploy to Kubernetes
        run: |
          kubectl set image deployment/order-service \
            order-service=${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}:${{ github.sha }} \
            -n production
          kubectl rollout status deployment/order-service -n production --timeout=300s

      - name: Verify deployment
        run: |
          kubectl get pods -n production -l app=order-service
          kubectl exec deployment/order-service -n production -- \
            wget -qO- http://localhost:8080/actuator/health
```

### 1.2 流水线执行流程

```
git push main
  ↓
┌─────────────────────────┐
│ Job 1: test             │
│ - checkout              │
│ - setup JDK 21          │
│ - mvn test              │
│ - upload test reports   │
└─────────┬───────────────┘
          ↓ (成功)
┌─────────────────────────┐
│ Job 2: build            │
│ - mvn package           │
│ - docker build          │
│ - docker push           │
└─────────┬───────────────┘
          ↓ (成功)
┌─────────────────────────┐
│ Job 3: deploy           │
│ - kubectl set image     │
│ - rollout status        │
│ - health check          │
└─────────────────────────┘
```

**踩坑提醒：**
- GitHub Actions 的 `services`（MySQL、Redis）只在 **job 级别** 生效，跨 job 需要重新声明
- Docker 镜像 tag 用 Git SHA 而不是 `latest`——`latest` 无法追溯版本，回滚也困难
- 部署阶段建议配置 **Environment Protection Rules**（手动审批），避免误操作直接上生产

---

## 2. 蓝绿部署与滚动更新

### 2.1 蓝绿部署（Blue-Green Deployment）

```
部署前：
┌─────────────────────────────────────┐
│           Load Balancer              │
└──────────┬──────────────────────────┘
           ↓ (100% 流量)
┌─────────────────────────────────────┐
│     蓝环境（当前生产版本 v1.0）        │
│  [Pod-1] [Pod-2] [Pod-3] [Pod-4]    │
└─────────────────────────────────────┘
┌─────────────────────────────────────┐
│     绿环境（新版本 v1.1，待命）        │
│  [Pod-1] [Pod-2] [Pod-3] [Pod-4]    │
└─────────────────────────────────────┘

切换后：
           Load Balancer
               ↓ (100% 流量)
          绿环境 v1.1 ✅
          蓝环境 v1.0（保留，随时回滚）
```

### 2.2 滚动更新（Rolling Update）—— K8s 默认策略

```
阶段 1: 4 个 v1.0 Pod
[v1.0] [v1.0] [v1.0] [v1.0]

阶段 2: 新建 1 个 v1.1，删除 1 个 v1.0
[v1.1] [v1.0] [v1.0] [v1.0]   ← maxSurge=1, maxUnavailable=0

阶段 3: 继续替换
[v1.1] [v1.1] [v1.0] [v1.0]

阶段 4: 完成
[v1.1] [v1.1] [v1.1] [v1.1]
```

### 2.3 K8s 滚动更新配置

```yaml
# k8s/deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: order-service
  namespace: production
spec:
  replicas: 4
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1
      maxUnavailable: 0
  selector:
    matchLabels:
      app: order-service
  template:
    metadata:
      labels:
        app: order-service
        version: v1.1.0
    spec:
      terminationGracePeriodSeconds: 60
      containers:
        - name: order-service
          image: ghcr.io/company/order-service:abc123
          ports:
            - containerPort: 8080
          resources:
            requests:
              memory: "512Mi"
              cpu: "500m"
            limits:
              memory: "2Gi"
              cpu: "2000m"
          readinessProbe:
            httpGet:
              path: /actuator/health/readiness
              port: 8080
            initialDelaySeconds: 30
            periodSeconds: 10
            failureThreshold: 3
          livenessProbe:
            httpGet:
              path: /actuator/health/liveness
              port: 8080
            initialDelaySeconds: 60
            periodSeconds: 15
            failureThreshold: 3
          startupProbe:
            httpGet:
              path: /actuator/health
              port: 8080
            initialDelaySeconds: 10
            periodSeconds: 5
            failureThreshold: 30
          lifecycle:
            preStop:
              exec:
                command: ["sh", "-c", "sleep 10"]
```

### 2.4 优雅关闭配置

```yaml
# application-prod.yml
server:
  shutdown: graceful
  tomcat:
    connection-timeout: 5s

spring:
  lifecycle:
    timeout-per-shutdown-phase: 30s
```

当 Pod 收到 SIGTERM 信号时：
1. K8s 从 Service Endpoint 中摘除该 Pod（不再接收新流量）
2. 执行 preStop hook（sleep 10s，等待 LB 生效）
3. Spring Boot 收到 SIGTERM，开始优雅关闭
4. 等待正在处理的请求完成（server.shutdown=graceful）
5. 超时后强制关闭

### 2.5 蓝绿 vs 滚动更新对比

| 维度 | 蓝绿部署 | 滚动更新 |
|------|---------|---------|
| 停机时间 | 零 | 零 |
| 资源开销 | 2 倍（需要双倍资源） | 1.2-1.5 倍（maxSurge 额外资源） |
| 回滚速度 | 极快（切换流量即可） | 较慢（需要重新部署旧版本） |
| 风险 | 流量切换瞬间所有请求受影响 | 逐步替换，影响范围小 |
| 数据库兼容性 | 需要同时兼容两个版本 | 需要兼容新旧版本 |
| 适用场景 | 重大版本升级、不频繁发布 | 日常迭代、频繁发布 |

**踩坑提醒：**
- 蓝绿部署要求 **数据库 Schema 向前兼容**——新版本的 SQL 变更不能破坏旧版本的运行
- 滚动更新时，`maxUnavailable: 0` 保证零停机，但需要有足够的资源来创建额外的 Pod
- `preStop` 中的 `sleep` 很关键——Service Endpoint 的摘除有延迟（通常 5-10 秒），不 sleep 的话旧 Pod 还会收到新请求
- `startupProbe` 对 Spring Boot 应用特别重要——启动慢的应用如果不配 startupProbe，livenessProbe 会在启动过程中就把 Pod 杀掉
