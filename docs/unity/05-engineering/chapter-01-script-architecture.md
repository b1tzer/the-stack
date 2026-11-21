---
type: explanation
level: intermediate
---

# 脚本架构与组件化设计

你写了十几个脚本后会发现：脚本之间互相引用，改一处牵动全局，越来越难维护。读完这一篇，你能说清 Unity 脚本的组件化设计原则，学会用单一职责和分层让脚本保持可维护。

## 1. 脚本失控的典型信号

先对照一下，你的项目是否出现这些情况：

- 一个 `Player` 脚本上千行，同时管移动、血量、动画、音效、UI。
- 脚本 A 引用 B，B 又引用 C，C 再引用 A，形成循环依赖。
- 改一个脚本要同时改五六个其他脚本才能编译通过。
- 到处是 `GameObject.Find("xxx")` 和 `GetComponent` 拼凑出来的引用。

这些问题的根源都一样：**脚本承担了太多职责，且相互强耦合**。架构的目标就是拆职责、降耦合。

## 2. 单一职责：一个脚本只做一件事

设计脚本时，问自己："这个脚本的职责能不能用一句话说清？" 说不清，就该拆。

对比两种写法：

```csharp
// 反例：一个脚本做所有事
public class Player : MonoBehaviour
{
    void Update()
    {
        // 移动
        // 播放动画
        // 更新血条 UI
        // 播放脚步声
        // ...
    }
}
```

```csharp
// 正例：拆成多个单一职责的组件
public class PlayerMovement : MonoBehaviour { /* 只管移动 */ }
public class PlayerHealth : MonoBehaviour   { /* 只管血量 */ }
public class PlayerAnimator : MonoBehaviour  { /* 只管动画 */ }
public class FootstepAudio : MonoBehaviour   { /* 只管脚步声 */ }
```

拆分后，每个脚本小而独立，可以单独测试、单独复用。`PlayerHealth` 也能挂在敌人身上用，不依赖"玩家"这个具体身份。

## 3. 组件化：能力可组合

上一批[组件与消息](../03-scene-core/chapter-02-components-messages.md)讲过组合优于继承。落到架构上，就是**把能力做成独立组件，按需组合**：

- 一个"会飞的敌人" = `EnemyHealth` + `EnemyAI` + `Fly` 组件。
- 一个"会飞的道具" = `Pickup` + `Fly` 组件。

`Fly` 组件被两类物体复用，不需要继承关系。这就是组件化的价值：不是"敌人"和"道具"各写一遍飞行逻辑，而是飞行逻辑只写一次。

设计脚本时优先问"这个能力能不能独立成组件"，而不是"这个类该继承谁"。

## 4. 分层：数据、逻辑、表现分离

脚本多了，还需要分层，避免"逻辑和表现搅在一起"。一个常用的三层划分：

- **数据层**：定义"是什么"。用 [ScriptableObject](./chapter-03-data-persistence.md) 存静态配置（敌人血量、移动速度、武器参数）。
- **逻辑层**：定义"怎么做"。MonoBehaviour 脚本处理移动、伤害、状态切换。
- **表现层**：定义"怎么显示"。动画、粒子、音效、UI 的更新。

好处是：调数值改数据层，不用碰逻辑代码；换表现（比如换个动画）不影响逻辑。策划改配置、美术改表现、程序改逻辑，各改各的，减少冲突。

## 5. 依赖注入：引用从外部给，不从内部找

`GameObject.Find` 和 `GetComponent` 到处飞，是耦合的来源。更可控的方式是**从 Inspector 拖拽注入引用**（前面讲过），或用一个中心对象统一提供引用。

```csharp
// 反例：内部到处 Find
void Start()
{
    player = GameObject.Find("Player").GetComponent<PlayerHealth>();
    ui = GameObject.Find("Canvas").GetComponent<UIManager>();
}

// 正例：从 Inspector 注入
[SerializeField] private PlayerHealth player;
[SerializeField] private UIManager ui;
```

从外部注入，脚本不关心"对象在哪、叫什么名字"，只关心"我拿到了引用"。这降低了脚本对场景结构的依赖，也更容易在测试时替换成假对象。

## 6. 动手评估

拿你之前写的脚本，做一次自查：

1. 找出最长的脚本，看它是不是同时管了移动、血量、动画、UI 等多件事。是的话，按单一职责拆开。
2. 数一下脚本里有多少 `GameObject.Find`，把它们换成 Inspector 注入。
3. 把散落在各脚本里的数值（速度、血量、伤害）抽出来，考虑放进 ScriptableObject。

完成这三步，脚本结构会明显清晰。下一步专门解决"脚本之间怎么优雅地通知对方"，即事件系统：[事件系统与解耦](./chapter-02-event-system.md)。
