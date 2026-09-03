# DevOps

> **核心问题**：什么是 DevOps？GitOps 怎么做？如何实现基础设施即代码？

## 1. DevOps 核心理念

| 理念 | 说明 |
| :-- | :-- |
| 自动化 | 一切可重复的操作都应该自动化 |
| 持续改进 | 小步快跑，持续反馈 |
| 共享责任 | 开发和运维共同对系统负责 |
| 可观测性 | 系统状态透明可见 |

## 2. GitOps

```yaml
# GitOps 核心思想：Git 是唯一的事实来源
# 基础设施和应用配置都存储在 Git 仓库中
# 任何变更通过 Git PR 提交，自动化同步到集群

# ArgoCD Application 配置示例
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: order-service
  namespace: argocd
spec:
  project: default
  source:
    repoURL: https://github.com/company/k8s-configs.git
    targetRevision: main
    path: apps/order-service/overlays/production
  destination:
    server: https://kubernetes.default.svc
    namespace: production
  syncPolicy:
    automated:
      prune: true      # 删除 Git 中不存在的资源
      selfHeal: true    # 自动修复手动修改
    syncOptions:
      - CreateNamespace=true
```

## 3. 基础设施即代码（IaC）

```yaml
# Terraform 示例：创建 AWS 资源
resource "aws_db_instance" "main" {
  identifier     = "order-db"
  engine         = "mysql"
  engine_version = "8.0"
  instance_class = "db.r5.large"
  
  allocated_storage = 100
  storage_encrypted = true
  
  db_name  = "orders"
  username = var.db_username
  password = var.db_password
  
  multi_az               = true
  backup_retention_period = 7
  
  tags = {
    Environment = "production"
    Team        = "order"
  }
}

# Helm Chart 示例：部署应用
# values-production.yaml
replicaCount: 3
image:
  repository: registry.example.com/order-service
  tag: "v1.2.0"
resources:
  requests:
    cpu: 500m
    memory: 512Mi
  limits:
    cpu: 1000m
    memory: 1Gi
autoscaling:
  enabled: true
  minReplicas: 3
  maxReplicas: 10
  targetCPUUtilizationPercentage: 70
```

## 4. 环境管理

```java
// 12-Factor App 原则：环境变量管理配置
// application.yml
// server:
//   port: ${SERVER_PORT:8080}
// spring:
//   datasource:
//     url: ${DB_URL}
//     username: ${DB_USERNAME}
//     password: ${DB_PASSWORD}
//   redis:
//     host: ${REDIS_HOST:localhost}

// Kubernetes ConfigMap + Secret
// ConfigMap：非敏感配置
// Secret：敏感配置（密码、密钥）
```

## 5. DevOps 工具链

| 阶段 | 工具 |
| :-- | :-- |
| 代码管理 | GitLab / GitHub |
| CI/CD | GitLab CI / Jenkins / GitHub Actions |
| 容器化 | Docker |
| 编排 | Kubernetes |
| 配置管理 | Helm / Kustomize |
| GitOps | ArgoCD / Flux |
| 基础设施 | Terraform / Pulumi |
| 监控 | Prometheus + Grafana |
| 日志 | ELK / Loki |
| 链路追踪 | SkyWalking / Jaeger |

> **核心原则**：DevOps 不是一个工具或职位，是一种文化。它的核心是打破开发和运维之间的墙，通过自动化和协作，让软件交付更快、更可靠。
