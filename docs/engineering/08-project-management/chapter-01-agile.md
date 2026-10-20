# 敏捷开发

## 1. Scrum

| 角色 | 职责 |
| :-- | :-- |
| Product Owner | 需求管理、优先级排序 |
| Scrum Master | 流程守护、障碍移除 |
| Developers | 负责 Sprint Backlog 与可用增量，贯彻质量要求 |

Product Owner、Scrum Master 和 Developers 是 Scrum Team 的三种责任领域（accountabilities），不是组织架构中的三个固定岗位。

| 仪式 | 频率 | 时长 |
| :-- | :-- | :-- |
| Sprint Planning | 每 Sprint 开始 | 2-4h |
| Daily Scrum | 每天 | 15min |
| Sprint Review | 每 Sprint 结束 | 1-2h |
| Retrospective | 每 Sprint 结束 | 1h |

上表时长是实践参考，不是 Scrum 的统一强制要求。以 Sprint Planning 为例，Scrum Guide 给出的时间盒上限为一个月 Sprint 对应 8 小时，较短 Sprint 通常更短。

## 2. Kanban

- 可视化工作流
- 限制在制品（WIP）
- 管理流动
- 持续改进

## 3. 敏捷 vs 瀑布

| 特性 | 敏捷 | 瀑布 |
| :-- | :-- | :-- |
| 需求 | 可变 | 固定 |
| 交付 | 持续 | 一次性 |
| 反馈 | 快速 | 延迟 |
| 风险 | 早期发现 | 后期发现 |

这张表适合入门概览，不能直接作为工程选型依据。敏捷不必然意味着持续发布到生产，团队可以迭代开发、集中发布；瀑布式项目也可以通过原型、阶段评审和增量验证提前发现风险。真正决定选型的是需求不确定性、反馈成本、系统风险、合规约束和发布机制。敏捷和瀑布是不同的计划与反馈策略，不是「灵活」与「僵化」的简单对立，混合治理与迭代交付可以并存。

## 4. Scrum 实战详解

### 4.1 用户故事模板

```markdown
# 用户故事

**作为** [角色]
**我想要** [功能]
**以便** [价值]

## 验收标准
- [ ] 条件 1
- [ ] 条件 2
- [ ] 条件 3

## 示例
作为 一个注册用户
我想要 修改我的收货地址
以便 在下单时选择正确的配送地址

验收标准：
- [ ] 用户可以添加最多 10 个收货地址
- [ ] 用户可以设置一个默认地址
- [ ] 地址信息包含：省、市、区、详细地址、收货人、手机号
- [ ] 手机号格式校验
- [ ] 删除默认地址前必须先指定新的默认地址，避免出现无默认地址的非法状态
- [ ] 并发修改同一地址不丢失更新，后写覆盖先写或提示冲突
```

### 4.2 Sprint Planning 实践

```markdown
# Sprint Planning 输出

## Sprint 目标
本 Sprint 完成订单取消功能的开发和测试。

## Sprint Backlog
| 任务 | 负责人 | 故事点 | 状态 |
| :-- | :-- | :-- | :-- |
| 订单取消 API | 张三 | 3 | TODO |
| 库存恢复逻辑 | 李四 | 2 | TODO |
| 退款对接 | 王五 | 5 | TODO |
| 前端取消页面 | 赵六 | 3 | TODO |
| 集成测试 | 张三 | 2 | TODO |

## 容量评估
团队速率：20 点/Sprint
本 Sprint 承诺：15 点（预留 buffer）

Sprint Planning 的决策顺序是先定 Sprint Goal，再据容量、历史速率、依赖和风险制定计划。历史速率是预测参考，不是个人绩效指标，也不构成必须完成的承诺。Sprint Backlog 由 Developers 为实现 Sprint Goal 制定并持续调整，示例中的负责人列只是协作安排，不是 Scrum 的强制规则。Sprint Goal 通常保持稳定，若已失去意义，Product Owner 可以取消整个 Sprint。
```

### 4.3 Daily Scrum 实践

```markdown
# 每日 Scrum（15 分钟，俗称站会）

每人回答三个问题：
1. 昨天完成了什么？
2. 今天计划做什么？
3. 有什么阻碍？

避免：
- 详细的技术讨论（会后单独讨论）
- 变成汇报会（是同步信息，不是汇报工作）
- 超过 15 分钟（设置计时器）
```

### 4.4 Sprint Retrospective 实践

```markdown
# 回顾会议模板

## 做得好的（继续保持）
- 代码评审质量提升
- 测试覆盖率从 60% 提升到 75%

## 需要改进的
- 需求变更太频繁，影响开发节奏
- 跨团队沟通效率低

## 行动项
| 行动 | 负责人 | 截止日期 |
| :-- | :-- | :-- |
| 建立需求变更审批流程 | PO | 下周五 |
| 每周与支付团队同步一次 | TL | 立即执行 |
```

## 5. Scrum vs Kanban 选型

| 维度 | Scrum | Kanban |
| :-- | :-- | :-- |
| 节奏 | 固定 Sprint（1-4 周） | 持续流动 |
| 角色 | PO、SM、Developers | 不强制角色划分 |
| 变更 | Sprint Goal 稳定，Backlog 可协商 | 按优先级与 WIP 限制流入 |
| 适用场景 | 复杂问题、需求演进 | 需求频繁变化、运维团队 |

> **敏捷的本质**：不是遵循某个框架的仪式，而是快速反馈、持续改进。如果站会变成了形式主义，那就改掉它。敏捷是手段，不是目的。

## 关联阅读

敏捷流程本身不能保证软件可交付，还需要工程实践支撑短反馈周期：

- [Git 工作流](../06-engineering-practices/chapter-01-git-workflow.md)
- [代码评审](../06-engineering-practices/chapter-02-code-review.md)
- [CI/CD 持续集成与持续交付](../06-engineering-practices/chapter-04-cicd.md)
