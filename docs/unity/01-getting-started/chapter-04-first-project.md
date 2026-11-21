---
type: tutorial
level: basic
---

# 第一个项目：场景、GameObject 与组件

你已经认识编辑器界面，会创建物体和切换运行模式。读完这一篇并跟着做，你能做出第一个"会自己动"的项目：一个持续旋转的立方体，并理解这段过程背后「GameObject + 组件 + 脚本」是怎么配合的。

## 1. 新建项目

1. 打开 Unity Hub，点 **New project**。
2. 选择 **Universal 3D** 模板（没有就选 3D 模板），给项目起个名字，选好保存位置。
3. 等编辑器加载完成，你会看到一个默认场景：地上一个平面，还有 `Main Camera` 和 `Directional Light`。

![Unity Hub 的 New project 界面：左侧选模板，右侧设编辑器版本、项目名和保存位置](/unity/01-getting-started-chapter-04-hub-new-project.png)

*图源：[Unity Hub 官方文档](https://docs.unity.com/en-us/hub/new-project)*

模板只是给你一个起点，这些默认物体都可以删改。

## 2. 认识默认场景里的两个物体

在 Hierarchy 里能看到两个默认物体：

- **Main Camera**：摄像机，决定玩家看到什么。没有它，Game 视图就是黑的。
- **Directional Light**：方向光，模拟太阳。没有它，场景里的物体会一片漆黑。

选中它们，在 Inspector 里能看到各自挂的组件。摄像机挂 `Camera` 组件，灯光挂 `Light` 组件。这就是组件模型：不同类型的物体，区别只在于挂了不同的组件。

## 3. 创建一个立方体并让它旋转

### 3.1 创建物体

在 Hierarchy 空白处右键 → **3D Object → Cube**。场景里出现一个立方体。

### 3.2 写第一个脚本

在 Project 窗口底部右键 → **Create → C# Script**，命名为 `Rotator`。双击打开，把内容替换成：

```csharp
using UnityEngine;

public class Rotator : MonoBehaviour
{
    // Unity 每帧调用一次 Update
    void Update()
    {
        // 绕 Y 轴每秒旋转 90 度
        transform.Rotate(0f, 90f * Time.deltaTime, 0f);
    }
}
```

先不展开解释每行含义（下一批会详细讲），这里只需知道：`Update` 每帧执行一次，`Time.deltaTime` 是上一帧到这一帧的秒数，用它乘旋转速度，让旋转速度不随帧率变化。

### 3.3 把脚本挂到物体上

脚本本身不会自动生效，它也是一个组件，需要挂到 GameObject 上：

1. 选中立方体。
2. 把 Project 里的 `Rotator` 脚本**拖到 Inspector 里**（或点 Inspector 底部的 **Add Component**，搜索 `Rotator` 添加）。
3. Inspector 里出现一个 `Rotator` 组件，说明挂载成功。

### 3.4 运行

点工具栏 **Play** 按钮。Game 视图里立方体会绕 Y 轴持续旋转。

**成功标志**：立方体匀速旋转，没有越转越快或卡顿。

如果没转起来，按顺序排查：

| 现象 | 原因 |
| --- | --- |
| 完全不动 | 脚本没挂到立方体上；或脚本有编译错误（看 Console 是否有红字） |
| 报错 `NullReferenceException` 或 `未找到` | 脚本文件名和类名不一致。脚本文件 `Rotator.cs` 里的类必须也叫 `Rotator` |
| 旋转忽快忽慢 | 代码里没乘 `Time.deltaTime` |

## 4. 这里发生了什么：串起三个概念

把这个流程和上一篇的概念对上：

1. **GameObject**：立方体，一个空容器。
2. **组件**：立方体上的 `Transform`、`Mesh Renderer`、`Box Collider`，以及你新加的 `Rotator` 脚本组件。它们各自负责一件事。
3. **脚本**：`Rotator` 是你写的第一个脚本，Unity 每帧调用它的 `Update`，你在里面调用 `transform.Rotate` 改变物体旋转。

`transform` 是脚本组件自动拿到的当前物体 `Transform` 组件的引用，`Rotate` 是 `Transform` 提供的方法。这条"脚本 → 组件 → 引擎能力"的调用链，是 Unity 里所有逻辑的基本形态。

## 5. 下一步

你已经跑通了"创建物体 → 写脚本 → 挂载 → 运行"的完整链路。接下来深入脚本机制，理解 `Update` 到底什么时候被调用、还有哪些类似的生命周期方法：[MonoBehaviour 与生命周期](../02-unity-scripting/chapter-01-monobehaviour-lifecycle.md)。
