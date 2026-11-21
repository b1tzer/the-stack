---
type: explanation
level: basic
---

# 常用 API：Transform、Time、GameObject

你理解了生命周期函数，但还不知道该在 `Update` 里调什么。读完这一篇，你能掌握 Unity 脚本里最高频的三类 API——`Transform`（移动旋转缩放）、`Time`（时间）、`GameObject`（对象开关与组件）——并用它们写出常见的移动和交互逻辑。

## 1. Transform：位置、旋转、缩放

每个 GameObject 都有一个 `Transform` 组件，描述它在场景里的空间状态。在脚本里，`transform` 直接指向当前物体自己的 `Transform`。

### 1.1 直接读写属性

```csharp
transform.position = new Vector3(0, 1, 0);  // 世界坐标位置
transform.rotation = Quaternion.identity;   // 旋转（四元数，identity 表示不旋转）
transform.localScale = new Vector3(2, 2, 2); // 缩放
```

- `position` 是世界坐标：物体在整个场景里的位置，单位是米。
- `rotation` 是四元数。初学者不要手动构造四元数，用 `Quaternion.Euler(0, 90, 0)` 表示绕 Y 轴转 90 度。
- `localScale` 是相对父物体的缩放。

### 1.2 相对移动与旋转

用 `Translate` 和 `Rotate` 做"在当前基础上再移动/旋转"，比直接改 `position` 更直观：

```csharp
transform.Translate(0, 0, 1 * Time.deltaTime);   // 每帧向前走一段
transform.Rotate(0, 90 * Time.deltaTime, 0);     // 每帧绕 Y 转一点
```

### 1.3 方向与父子关系

- `transform.forward`：物体朝前的方向（蓝色 Z 轴），移动角色时常用。
- `transform.parent`：父物体的 `Transform`，设 `null` 可以解除父子关系。
- 子物体的 `position` 是相对父物体的本地坐标，`localPosition` 才是；世界坐标要看 `position`。

## 2. Time：与帧率解耦

游戏帧率不固定：高性能机器跑 200 帧/秒，低端机可能只有 30 帧/秒。如果直接写"每帧移动 1 米"，帧率越高物体跑得越快。`Time` 类提供的时间量就是用来消除这个差异的。

| 成员 | 含义 | 用途 |
| --- | --- | --- |
| `Time.deltaTime` | 上一帧到这一帧经过的秒数 | 让"每秒移动多少"与帧率无关 |
| `Time.time` | 游戏开始以来的秒数 | 计时、做延迟 |
| `Time.fixedDeltaTime` | 物理固定步长的秒数（默认 0.02） | 与 `FixedUpdate` 配合 |

正确的帧率无关写法：

```csharp
void Update()
{
    // 每秒移动 5 米，而不是每帧移动 5 米
    transform.Translate(0, 0, 5 * Time.deltaTime);
}
```

`5 * Time.deltaTime` 的含义是：这一帧占了一秒的多少比例，就移动 5 米的多少比例。帧率 200 时 `deltaTime` 约 0.005，每帧移动 0.025 米；帧率 30 时 `deltaTime` 约 0.033，每帧移动 0.165 米。两者每秒都移动 5 米。

**凡是"每秒/每单位时间"的增量，都要乘 `Time.deltaTime`**。漏乘是最常见的新手 bug，表现就是物体在不同帧率下速度不一致。

## 3. GameObject：开关对象与拿组件

### 3.1 激活与禁用

```csharp
gameObject.SetActive(false);   // 禁用当前物体（连同其子物体一起从场景隐藏）
gameObject.SetActive(true);    // 重新启用
```

`gameObject` 指向脚本所挂的 GameObject。`SetActive(false)` 会停止它的 `Update` 等生命周期调用，并触发 `OnDisable`。

### 3.2 获取组件

组件是挂在 GameObject 上的，获取它们用 `GetComponent`：

```csharp
Rigidbody rb = GetComponent<Rigidbody>();   // 拿当前物体上的 Rigidbody
Light l = GetComponent<Light>();            // 拿 Light
```

如果物体上没有该组件，`GetComponent` 返回 `null`。所以在用之前要判空，或确保物体上确实挂了该组件。

### 3.3 查找物体

```csharp
GameObject player = GameObject.Find("Player");        // 按名字找
GameObject cam = GameObject.FindWithTag("MainCamera"); // 按标签找
```

`Find` 遍历整个场景，性能较差，**不要放在 `Update` 里每帧调用**。在 `Start` 或 `Awake` 里找一次、缓存引用，之后复用。

## 4. 一个综合示例：让物体朝向玩家移动

把前面三类 API 串起来：

```csharp
using UnityEngine;

public class ChasePlayer : MonoBehaviour
{
    public float speed = 5f;
    private Transform player;

    void Start()
    {
        // 只在开始时找一次并缓存
        GameObject p = GameObject.FindWithTag("Player");
        if (p != null) player = p.transform;
    }

    void Update()
    {
        if (player == null) return;   // 找不到玩家就什么都不做

        Vector3 dir = (player.position - transform.position).normalized;
        transform.Translate(dir * speed * Time.deltaTime);
    }
}
```

这个脚本每帧做三件事：算出指向玩家的方向、按方向和速度移动、乘 `Time.deltaTime` 保证帧率无关。`normalized` 把方向向量归一化为长度 1，避免距离远时移动变快。

## 5. 下一步

这三类 API 覆盖了大部分基础逻辑。下一步处理玩家输入，让物体"由你控制"而不是自动移动：[输入系统](./chapter-03-input.md)。
