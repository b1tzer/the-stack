---
type: tutorial
level: basic
---

# 输入系统

你写的物体都是自己动的。读完这一篇并跟着做，你能读取键盘和鼠标输入，让物体"由玩家控制"，并知道 Unity 的两套输入方案该怎么选。

## 1. 两套输入方案

Unity 6 有两套输入系统：

- **Input Manager（旧）**：通过 `Input.GetKey`、`Input.GetAxis` 直接读输入，代码简单，适合快速上手。
- **Input System（新）**：基于事件和动作（Action）的输入抽象，功能更强（支持手柄、触摸、自定义映射），但配置更复杂。

对刚入门、只用键盘鼠标的你，**旧 Input Manager 足够，且代码更直白**。本文用旧系统讲解。新系统会在需要手柄、触屏或多设备重映射时再引入。

## 2. 启用旧 Input Manager

Unity 6 的新项目默认启用的是**新 Input System**。如果直接写 `Input.GetKey`，编译会报错。需要切换：

1. 菜单 **Edit → Project Settings → Player**。
2. 找到 **Other Settings → Active Input Handling**。
3. 改成 **Input Manager (Old)** 或 **Both**（`Both` 两套都能用，推荐）。

改完 Unity 会提示重启编辑器，重启后生效。**成功标志**是 `Input.GetKey` 不再报错。

## 3. 读取键盘输入

`Input` 类提供三种键盘读取方式，区别在"触发时机"：

```csharp
if (Input.GetKeyDown(KeyCode.Space)) { }  // 按下的那一帧为 true，只触发一次
if (Input.GetKey(KeyCode.Space))     { }  // 按住期间每帧为 true
if (Input.GetKeyUp(KeyCode.Space))   { }  // 松开的那一帧为 true，只触发一次
```

- `GetKeyDown` 用于"跳一下"这种一次性动作。
- `GetKey` 用于"按住持续加速"这种持续动作。

## 4. 读取轴向输入：移动

移动通常用方向键或 WASD，用 `Input.GetAxis` 一次拿到一个轴上的连续值：

```csharp
float h = Input.GetAxis("Horizontal");  // 左右：A/D 或 ←/→，返回 -1 到 1
float v = Input.GetAxis("Vertical");    // 前后：W/S 或 ↑/↓，返回 -1 到 1
```

`GetAxis` 返回的是浮点数：按住 D 是 `1`，按住 A 是 `-1`，都不按是 `0`。用它乘速度，就能得到平滑的移动量。

## 5. 完整示例：键盘控制立方体移动

写一个脚本，让立方体在水平面上用 WASD 移动，空格跳跃：

```csharp
using UnityEngine;

public class PlayerMovement : MonoBehaviour
{
    public float speed = 5f;
    public float jumpForce = 5f;

    private Rigidbody rb;

    void Start()
    {
        rb = GetComponent<Rigidbody>();
    }

    void Update()
    {
        // 读取移动输入，组成水平方向向量
        float h = Input.GetAxis("Horizontal");
        float v = Input.GetAxis("Vertical");
        Vector3 move = new Vector3(h, 0, v) * speed;

        // 用刚体速度实现移动（物理相关，但这里是直接改速度）
        rb.linearVelocity = new Vector3(move.x, rb.linearVelocity.y, move.z);

        // 空格跳跃：只有按下的那一帧触发
        if (Input.GetKeyDown(KeyCode.Space))
        {
            rb.AddForce(Vector3.up * jumpForce, ForceMode.Impulse);
        }
    }
}
```

运行前的准备：

1. 场景里建一个 Cube，给它加 **Rigidbody** 组件（Inspector 里 Add Component 搜索 Rigidbody）。
2. 把 `PlayerMovement` 脚本挂到 Cube 上。
3. 点 Play，用 WASD 移动立方体，空格让它跳起来。

**成功标志**：WASD 能水平移动，空格能让立方体跳起，松开按键就停下。

注意：`rb.linearVelocity` 是 Unity 6 的新写法，旧版本叫 `rb.velocity`。本专题以 Unity 6.3 LTS 为准，所以用 `linearVelocity`。

## 6. 常见问题

| 现象 | 原因 |
| --- | --- |
| `Input` 报错或标红 | 没切换 Active Input Handling 到 Old 或 Both，回看第 2 节 |
| 按了没反应 | 脚本没挂到物体上；或物体没有 Rigidbody，`rb` 是 null |
| 移动方向不对 | `GetAxis("Horizontal")` 对应 X 轴、`Vertical` 对应 Z 轴，和场景朝向有关，旋转物体或换轴即可 |
| 跳不起来 | 物体被卡住或 Rigidbody 没加；检查 `jumpForce` 是否太小 |

## 7. 下一步

输入是脚本和玩家之间的桥梁。下一步理解 Unity 脚本特有的"序列化"机制，你会明白为什么脚本里的 `public float speed` 会出现在 Inspector 里、可以随手调参：[Unity 的 C# 约定：序列化与 Inspector](./chapter-04-serialization-inspector.md)。
