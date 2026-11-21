---
type: tutorial
level: basic
---

# 碰撞检测与触发器

物体能碰撞了，但你还需要在"碰到"或"穿过"时执行逻辑——捡金币、踩陷阱、进传送门。读完这一篇并跟着做，你能区分碰撞和触发器，写出"碰到就扣血""穿过就加分"这类逻辑。

## 1. 碰撞和触发器的区别

Unity 的碰撞检测分两种，由 Collider 上的 **Is Trigger** 开关决定：

| 类型 | Is Trigger | 行为 | 回调 |
| --- | --- | --- | --- |
| 碰撞（Collision） | 不勾选 | 物体实体相碰，会弹开、挡住 | `OnCollisionEnter` |
| 触发器（Trigger） | 勾选 | 物体可以穿过，只检测"是否进入" | `OnTriggerEnter` |

- **碰撞**用于"实体接触"：角色撞墙会停住、箱子落地会弹一下。
- **触发器**用于"区域检测"：金币是个触发器，角色穿过它不会被挡住，但会触发"捡到金币"的逻辑。

判断用哪个：这个交互**要不要阻挡物体**？要挡住（墙、地面）用碰撞；不挡、只感知（金币、检查点、伤害区域）用触发器。

## 2. 碰撞回调

当两个都不勾 Is Trigger 的碰撞体接触时，Unity 调用这些方法：

```csharp
void OnCollisionEnter(Collision collision) { }  // 开始接触的瞬间，调用一次
void OnCollisionStay(Collision collision)  { }  // 持续接触期间，每帧调用
void OnCollisionExit(Collision collision)  { }  // 分离的瞬间，调用一次
```

`Collision` 参数里能拿到对方物体：

```csharp
void OnCollisionEnter(Collision collision)
{
    if (collision.gameObject.CompareTag("Enemy"))
    {
        // 碰到敌人
    }
}
```

要让 `OnCollisionEnter` 触发，**至少一方要有 Rigidbody**（通常是被撞的物体）。两个都是静态碰撞体不会触发碰撞回调。

## 3. 触发器回调

勾选 Is Trigger 后，物体之间可以穿过，Unity 调用的是另一组方法：

```csharp
void OnTriggerEnter(Collider other) { }  // 进入触发器区域
void OnTriggerStay(Collider other)  { }  // 停留在触发器内
void OnTriggerExit(Collider other)  { }  // 离开触发器区域
```

注意参数是 `Collider` 而不是 `Collision`。

## 4. 完整示例：捡金币

做一个"角色碰到金币就加分并让金币消失"的功能：

1. 场景里建一个 Sphere，勾选它的 Collider 的 **Is Trigger**，命名为 `Coin`。
2. 给 Coin 写脚本：

```csharp
using UnityEngine;

public class Coin : MonoBehaviour
{
    void OnTriggerEnter(Collider other)
    {
        if (other.CompareTag("Player"))
        {
            Debug.Log("捡到金币！");
            Destroy(gameObject);   // 金币消失
        }
    }
}
```

3. 给玩家物体设置 Tag 为 `Player`（Inspector 顶部的 Tag 下拉，选择或新建 `Player`）。

![Inspector 顶部的 Tag 与 Layer 下拉框](/unity/04-gameplay-chapter-02-tag-layer.png)

*图源：[Unity 官方文档](https://docs.unity3d.com/6000.3/Documentation/Manual/Tags.html)*
4. 给玩家加 Rigidbody（这样玩家移动时能触发触发器回调；触发器检测至少一方有 Rigidbody）。
5. 运行，让玩家穿过 Coin——金币触发回调并消失。

**成功标志**：玩家进入金币区域时 Console 打印"捡到金币"，金币消失。

如果没触发，按顺序排查：

| 现象 | 原因 |
| --- | --- |
| 完全不触发 | 金币 Collider 没勾 Is Trigger；或玩家 Tag 不是 `Player`；或双方都没有 Rigidbody |
| 报错 `MissingComponent` | `CompareTag` 用的 Tag 不存在，先在 Tag 管理器里创建 |

## 5. 一个常见陷阱

`OnTriggerEnter` 要求**至少一方有 Rigidbody**。如果金币和玩家都是"只有 Collider 没有 Rigidbody"的静态物体，触发器回调不会触发。很多新手卡在这里。解决：给玩家（移动方）加 Rigidbody，即使你用手动移动而不是物理驱动。

## 6. 下一步

碰撞和触发器让物体能"互动"。下一步做玩家能看、能点的界面：[UI：Canvas 与 UGUI](./chapter-03-ui-canvas-ugui.md)。
