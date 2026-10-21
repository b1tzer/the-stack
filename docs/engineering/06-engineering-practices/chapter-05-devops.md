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
      prune: true      # 删除受 Argo CD 管理、但已不在期望状态中的资源
      selfHeal: true    # 自动修复手动修改
    syncOptions:
      - CreateNamespace=true
```

Argo CD 的运行机制是一个持续的控制循环：比较 Git 中的期望状态与 Kubernetes 集群的实际状态，发现差异后按同步策略把资源拉向期望状态。`selfHeal` 用于纠正受管理资源的实际状态偏差；`prune` 则删除 Argo CD 管理范围内、已不再出现在期望状态中的资源。两者一旦开启，错误提交或配置误删就可能把错误扩散到集群，因此生产环境通常限制同步权限、对破坏性变更走评审，并评估哪些场景不宜启用自动清理。

GitOps 的核心不是把配置放进 Git，而是持续协调期望状态与实际状态。集群中并非所有状态都能由 Git 完整表达，例如外部托管服务、运行时生成的数据和 Secret 的实际管理方式，都需要额外机制承接。

## 3. 基础设施即代码（IaC）

```terraform
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
```

Helm Chart 示例：部署应用，`values-production.yaml`：

```yaml
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

Terraform 声明式资源示例之外，生产环境的关键在资源生命周期而非语法。`state` 文件跟踪配置与实际资源的关联，敏感值即使标记为 `sensitive` 仍可能落入 state；`terraform plan` 生成的计划文件同样可能包含敏感数据。生产环境应使用受访问控制的远程 state，并配置状态锁定与备份；执行前审查计划中的创建、修改、销毁、替换操作，不能把 plan 当作无风险操作。`sensitive = true` 只控制 CLI 与部分输出的展示，不等于加密，不要把真实密码写进代码或提交版本库，使用受控的秘密注入方式，并限制 state 与计划文件的访问权限。`multi_az = true` 与 `backup_retention_period = 7` 只是配置项，本身不构成完整的灾难恢复方案，高可用、备份与恢复策略需与资源配置配套。

最小生产工作流：

```bash
terraform init
terraform validate
terraform plan -out=tfplan
terraform show tfplan
terraform apply tfplan
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
// Secret：敏感配置的 Kubernetes 资源，Base64 编码不等于加密
// 生产环境：限制 RBAC 读取权限，评估静态数据加密，按威胁模型考虑外部秘密管理系统
// 秘密不写入镜像、不提交 Git、不无控制输出到日志
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

上表是典型分工而非强制架构。Terraform 管理云资源与集群基础设施，Helm 或 Kustomize 渲染 Kubernetes 应用资源模板，Argo CD 协调集群中的应用期望状态。三者协作但不互相替代，必须明确同一资源的管理权归属，避免多个控制器对同一资源重复管理，否则会出现冲突与反复覆盖。应用的配置漂移与回滚，和基础设施的回滚是两回事，需要分开看待。

> **核心原则**：DevOps 不是一个工具或职位，是一种文化。它的核心是打破开发和运维之间的墙，通过自动化和协作，让软件交付更快、更可靠。
