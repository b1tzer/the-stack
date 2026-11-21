---
type: explanation
level: basic
---

# 预制体与实例化

你会创建物体和挂组件了，但如果要生成 100 个相同的敌人，一个个手动摆不现实。读完这一篇，你能说清预制体（Prefab）是什么、怎么创建、怎么在运行时批量生成，以及改一处就能更新所有实例的机制。

## 1. 问题：重复的物体怎么管理

设想你要做一个有 50 个敌人、每个敌人都挂 5 个组件的关卡。手动复制粘贴 50 次，问题随之而来：

- 复制出来的物体是**独立的**，改一个敌人的血量，其他 49 个不变。
- 如果要给所有敌人加一个组件，得改 50 次。

预制体解决的就是这个：把一个"配置好的物体"保存成模板，之后所有实例都引用这个模板，改模板就改所有实例。

## 2. Prefab 是什么

**Prefab（预制体）** 是一个资源文件，保存了一个 GameObject 及其所有组件、属性和子物体的完整配置。它和"复制粘贴"的本质区别是：实例和模板之间保持着关联。

创建预制体：

1. 在场景里配好一个物体（挂好组件、调好参数）。
2. 把它从 Hierarchy 拖到 Project 窗口的某个文件夹里。

Project 里出现的蓝色立方体图标就是 Prefab。此时场景里的原物体变成该 Prefab 的**实例**（Hierarchy 里名字变蓝）。

## 3. 修改传播

双击 Project 里的 Prefab 进入**预制体编辑模式**：

![预制体编辑模式（隔离模式）：Hierarchy 里只显示预制体自身层级](/unity/03-scene-core-chapter-03-prefab-isolation-mode.png)

*图源：[Unity 官方文档](https://docs.unity3d.com/6000.3/Documentation/Manual/PrefabIsolationMode.html)*

或直接在场景里改一个实例：

- **改 Prefab 资产**：所有实例同步更新。比如给 Prefab 加一个组件，场景里所有实例都获得这个组件。
- **改单个实例**：只影响这一个实例，这些改动会成为"覆盖（Override）"，与 Prefab 默认值不同。Inspector 里这些被覆盖的项会用粗体和蓝条标出。

这个机制让你能"全局改"也能"单独调"。比如敌人 Prefab 统一血量为 100，某个 Boss 实例单独覆盖成 1000。

## 4. 运行时实例化：Instantiate

预制体不只是编辑器里的模板，还能在**运行时**用代码批量生成。这是刷怪、子弹、粒子等动态物体的基础：

```csharp
using UnityEngine;

public class Spawner : MonoBehaviour
{
    public GameObject enemyPrefab;   // Inspector 里拖入预制体

    void Start()
    {
        // 在指定位置、无旋转地生成一个实例
        Instantiate(enemyPrefab, new Vector3(0, 0, 0), Quaternion.identity);
    }
}
```

`Instantiate` 返回新实例的引用，可以接着操作它：

```csharp
GameObject go = Instantiate(enemyPrefab, position, rotation);
go.GetComponent<Enemy>().health = 500;   // 生成后修改实例
```

常见的动态生成场景：

- 玩家开火时在枪口生成子弹预制体。
- 定时器每隔一秒在随机位置生成敌人。
- 物体碎裂时生成碎片粒子预制体。

## 5. 销毁实例：Destroy

动态生成的物体通常也要动态销毁，否则会越积越多：

```csharp
Destroy(gameObject);              // 立即销毁当前物体
Destroy(gameObject, 3f);          // 3 秒后销毁
```

子弹飞出一定距离后销毁、敌人死亡后销毁、粒子播完销毁，都靠 `Destroy`。忘掉销毁会造成物体无限堆积，拖慢性能。

## 6. 动手验证

1. 建一个 Cube，加一个 Rigidbody，拖到 Project 里做成 Prefab。
2. 写一个 `Spawner` 脚本，`public GameObject enemyPrefab;`，在 `Start` 里 `Instantiate(enemyPrefab, new Vector3(0, 5, 0), Quaternion.identity);`。
3. 建一个空物体挂 `Spawner`，把 Prefab 拖到 `enemyPrefab` 槽位。
4. 运行，看到场景里多出一个从 (0,5,0) 掉下来的立方体。
5. 回编辑器，给 Prefab 换个颜色，再运行，验证新生成的实例用了新颜色——这就是修改传播。

## 7. 下一步

预制体解决了"物体怎么复用和批量生成"。下一个核心概念是帧循环，理解 `Update` 和 `FixedUpdate` 为什么不同：[时间与帧循环](./chapter-04-frame-loop.md)。
