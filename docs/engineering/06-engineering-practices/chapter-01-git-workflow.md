# Git 工作流

## 1. GitFlow

```txt
main ← release ← develop ← feature
  ↑
  └── hotfix（切自 main，修复后合回 main 与 develop）
```

| 分支 | 用途 |
| :-- | :-- |
| main | 生产环境 |
| develop | 开发主线 |
| feature/* | 功能开发 |
| release/* | 发布准备 |
| hotfix/* | 紧急修复 |

- release 切自 develop，发布完成后合回 main 与 develop
- hotfix 切自 main，修复后同时合回 main 与 develop

## 2. Trunk-Based

```txt
main ← feature (短生命周期)
```

- 主干是唯一长期分支，变更快速、持续集成
- 短生命周期 feature 分支
- 依靠功能开关、自动化测试与主干保护降低集成风险

## 3. 选择建议

| 模型 | 适用场景 |
| :-- | :-- |
| GitFlow | 并行维护多个版本、发布节奏固定 |
| Trunk-Based | 高频集成与持续交付、自动化测试成熟 |

选择依据是发布方式、并行维护的版本数、集成频率与自动化测试能力，而非团队规模。

## 4. Commit 规范

```txt
<type>(<scope>): <subject>

feat: 新功能
fix: Bug 修复
docs: 文档
style: 格式
refactor: 重构
test: 测试
chore: 构建/工具
```

> 以上为 Conventional Commits 风格约定，并非 Git 内置强制规则。

## 5. 分支管理最佳实践

### 5.1 分支命名规范

```bash
# 功能分支
feature/user-login
feature/JIRA-1234-order-payment

# 修复分支
fix/memory-leak-in-cache
hotfix/production-payment-error

# 发布分支
release/v1.2.0
```

### 5.2 Commit 规范详解

```bash
# Conventional Commits 格式
# <type>(<scope>): <subject>

# type 类型
# feat:     新功能
# fix:      Bug 修复
# docs:     文档变更
# style:    代码格式
# refactor: 重构
# perf:     性能优化
# test:     测试相关
# chore:    构建/工具变更
```

### 5.3 Git Hooks 自动化

```bash
# .husky/pre-commit
# 运行 lint 检查和单元测试
```

> 本地 Hook 可被 `git commit --no-verify` 绕过，只能作为辅助；关键质量门禁需在 CI 中强制执行。

## 6. 代码合并策略

| 策略 | 命令 | 特点 |
| :-- | :-- | :-- |
| Merge | `git merge` | 保留分支关系；快进时不产生合并提交，非快进时产生合并提交 |
| Squash | `git merge --squash` | 将变更压入暂存区，不自动提交，需手动 `git commit` |
| Rebase | `git rebase` | 重放提交通常会生成新的提交对象，形成线性历史 |

## 7. 工作流与质量门禁的闭环

分支策略本身不保证代码质量，还需与代码审查和持续集成配合：

```txt
开发提交 → PR / 合并请求 → 自动化检查与代码审查 → 合并主干 → 部署验证
```

各环节的强制门禁（PR 审核、CI 检查）详见 [代码审查](./chapter-02-code-review.md) 与 [CI/CD](./chapter-04-cicd.md)。

> **核心原则**：Git 工作流没有“最好”，只有“最合适”。真正的选择依据是发布方式、并行维护的版本数、集成频率与自动化测试能力，而非团队规模。关键是团队达成共识并一致执行。
