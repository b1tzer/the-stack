# Git 工作流

## 1. GitFlow

```
main ← release ← develop ← feature
                ← hotfix
```

| 分支 | 用途 |
|------|------|
| main | 生产环境 |
| develop | 开发主线 |
| feature/* | 功能开发 |
| release/* | 发布准备 |
| hotfix/* | 紧急修复 |

## 2. Trunk-Based

```
main ← feature (短生命周期)
```

- 所有开发在 main 分支
- 短生命周期 feature 分支
- 持续集成

## 3. 选择建议

| 模型 | 适用场景 |
|------|---------|
| GitFlow | 版本发布、大型团队 |
| Trunk-Based | 持续交付、小团队 |

## 4. Commit 规范

```
<type>(<scope>): <subject>

feat: 新功能
fix: Bug 修复
docs: 文档
style: 格式
refactor: 重构
test: 测试
chore: 构建/工具
```

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

## 6. 代码合并策略

| 策略 | 命令 | 特点 |
|------|------|------|
| Merge | `git merge` | 保留完整历史，产生合并提交 |
| Squash | `git merge --squash` | 压缩为一个提交，历史干净 |
| Rebase | `git rebase` | 线性历史，无合并提交 |

> **核心原则**：Git 工作流没有“最好”，只有“最合适”。小团队用 Trunk-Based，大团队用 GitFlow。关键是团队达成共识并一致执行。
