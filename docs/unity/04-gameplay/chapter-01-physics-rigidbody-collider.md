---
type: explanation
level: basic
---

# 物理：Rigidbody 与 Collider

你给物体加了 Rigidbody 它就受重力掉落，但你知道刚体和碰撞体各自负责什么吗？读完这一篇，你能说清 Rigidbody 和 Collider 的分工、三种刚体类型，以及为什么"有碰撞体没刚体"的物体会穿模。

## 1. 物理系统的两个角色

Unity 的物理引擎负责模拟物体的运动、碰撞、重力。它由两类组件配合工作：

- **Rigidbody（刚体）**：让物体**参与物理模拟**——受重力、受力、有速度、参与碰撞响应。
- **Collider（碰撞体）**：定义物体的**碰撞形状**——一个盒子、球体、胶囊或网格，用来判断"两个物体是否碰到"。

打个比方：Collider 是物体的"外形"（碰撞时用这个形状判断），Rigidbody 是物体的"物理身份"（有了它才被物理引擎管理）。两者缺一不可。

## 2. 三种物理身份

一个物体在物理世界里的身份，取决于它有没有 Rigidbody、Rigidbody 是什么类型：

| 类型 | 组合 | 行为 |
| --- | --- | --- |
| 静态碰撞体（Static） | 只有 Collider，没有 Rigidbody | 不动，但能挡住别人。适合地面、墙壁 |
| 动态刚体（Dynamic） | Rigidbody（默认）+ Collider | 受重力和力，能移动、能碰撞。适合角色、掉落的箱子 |
| 运动学刚体（Kinematic） | Rigidbody（勾选 Is Kinematic）+ Collider | 不受物理力，但能推动别人。适合移动平台、门 |

最常见的坑：**给一个只有 Collider 没有 Rigidbody 的物体（静态碰撞体）加移动代码，它会穿模**。因为静态碰撞体物理引擎认为它永远不动，你手动改它的 `Transform` 位置时，物理引擎不会同步，也不产生碰撞响应。要让它动，要么加 Rigidbody，要么把移动交给物理 API。

## 3. Rigidbody 的常用操作

给物体加 Rigidbody 后，通过脚本控制它的运动：

```csharp
Rigidbody rb = GetComponent<Rigidbody>();

rb.AddForce(Vector3.up * 5f, ForceMode.Impulse);   // 施加瞬时冲量（如跳跃）
rb.linearVelocity = new Vector3(0, 0, 10);         // 直接设速度
rb.useGravity = false;                              // 关闭重力
```

- `AddForce`：施加力，`ForceMode.Impulse` 是瞬时冲量（适合跳跃、射击后坐力），`ForceMode.Force` 是持续力。
- `linearVelocity`：Unity 6 的写法，旧版本叫 `velocity`。直接读或写速度。
- `useGravity`：是否受重力。

这些操作要放在 `FixedUpdate` 里，原因见[时间与帧循环](../03-scene-core/chapter-04-frame-loop.md)。

## 4. Collider 的形状

Collider 有不同形状，选择原则是"形状越贴近物体、越简单越好"：

- **Box Collider**：盒子，最常用，适合方形物体。
- **Sphere Collider**：球体，适合球类。
- **Capsule Collider**：胶囊，适合角色。
- **Mesh Collider**：按网格形状，最精确但性能最差，一般只用于静态地形。

碰撞检测的精度取决于 Collider，而不是物体的可见模型。一个复杂的角色模型，碰撞体通常是一个简化胶囊，而不是模型本身的几千个面。

## 5. 动手验证

1. 场景里建一个 Plane（平面，自带 Mesh Collider，静态）和一个 Cube。
2. 给 Cube 加 Rigidbody，运行——Cube 掉落到 Plane 上停住。
3. 移除 Cube 的 Rigidbody，运行——如果给 Cube 加了移动代码，它会穿过 Plane；没代码则静止。

对比第 2、3 步，理解 Rigidbody 是否参与物理的区别。

下一步深入碰撞检测，学会在"物体碰到"和"物体穿过"时触发逻辑：[碰撞检测与触发器](./chapter-02-collision-triggers.md)。
