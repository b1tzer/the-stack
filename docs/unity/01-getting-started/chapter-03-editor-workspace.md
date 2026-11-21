---
type: tutorial
level: basic
---

# 编辑器界面与工作区

你已经装好了 Unity Hub 和 Unity 6.3 LTS，能打开一个新项目。读完这一篇并跟着操作，你能认清编辑器默认布局里的每个窗口是干什么的，学会在场景里导航和摆放物体，为下一步写脚本做准备。

## 1. 打开编辑器后的默认布局

新建项目后进入编辑器，屏幕被分成几个区域。Unity 的窗口都可以拖动、停靠，但第一次打开看到的是**默认布局**：

![Unity 编辑器默认布局：顶部工具栏、左侧 Hierarchy、中间 Scene 与 Game 视图、右侧 Inspector、底部 Project 窗口](/unity/01-getting-started-chapter-03-editor-breakdown.png)

*图源：[Unity 官方文档](https://docs.unity3d.com/2021.1/Documentation/Manual/UsingTheEditor.html)，官方布局示意，Unity 6 布局结构一致*

下面逐个说明。先记住名字和位置，不用记每个按钮。

## 2. 五个核心窗口

### 2.1 Hierarchy（层级窗口）

左侧，列出**当前场景里的所有 GameObject**，以树状结构表示父子关系。选中场景里的物体，它会在这里高亮；反过来在这里点击，场景里对应物体也会被选中。

它是你组织场景的入口：新建物体、调整父子关系、删除物体都从这里开始。

### 2.2 Scene 视图（场景视图）

中间上方，是**编辑世界的地方**。你在这里摆放物体、调整位置、预览灯光和材质。它显示的是"编辑器视角"，和玩家最终看到的画面不一定一致。

### 2.3 Game 视图（游戏视图）

和 Scene 视图同一个位置，用顶部 Tab 切换。它显示的是**玩家视角**，即场景里摄像机看到的画面。点工具栏的 Play 按钮后，Game 视图会实时显示游戏运行画面。

### 2.4 Inspector（检视器）

右侧，显示**当前选中物体上挂的所有组件和属性**。在 Hierarchy 或 Scene 里点一个物体，Inspector 就会列出它的 `Transform`、`Mesh Renderer`、`Collider` 等组件。改数值、加组件、删组件都在这里做。

这是理解 Unity 组件模型最直观的地方：选中物体，看它由哪些组件拼成。

### 2.5 Project（项目窗口）

底部左侧，列出**项目目录里的所有资源**：脚本、贴图、模型、材质、预制体等，对应磁盘上 `Assets/` 目录。你把外部资源拖进来，或在这里右键创建新资源。

### 2.6 Console（控制台）

底部和 Project 同位置，用 Tab 切换。显示**日志、警告和报错**。你写的 `Debug.Log` 输出在这里，脚本报错也在这里。排错时先看 Console。

## 3. 在 Scene 视图里导航

Scene 视图右上角有一个 **Scene Gizmo**，它显示当前视角的坐标轴方向，拖动它能快速旋转视角：

![Scene 视图右上角的 Scene Gizmo，显示 x/y/z 轴方向与 Persp 标签](/unity/01-getting-started-chapter-03-scene-gizmo.png)

*图源：[Unity 官方文档](https://docs.unity3d.com/6000.3/Documentation/Manual/SceneViewNavigation.html)*

在 Scene 视图里移动视角是最高频的操作，掌握这三招：

| 操作 | 效果 |
| --- | --- |
| 鼠标右键按住拖动 | 旋转视角（围绕当前焦点） |
| 鼠标中键按住拖动 | 平移视角 |
| 滚动滚轮 | 拉近拉远 |

选不中物体时，先点一下物体再操作；找不到物体时，在 Hierarchy 里双击它的名字，视角会自动聚焦过去。

## 4. 变换工具：移动、旋转、缩放

工具栏左侧有一排工具，对应快捷键 Q/W/E/R/T：

- **W（Move）**：移动物体，显示三个轴向的箭头，拖动箭头沿轴移动。
- **E（Rotate）**：旋转物体，显示三个圆环。
- **R（Scale）**：缩放物体，显示三个轴向的方块。
- **Q（Hand）**：平移视图（和鼠标中键一样）。

在 Scene 里选中一个物体后按 W，拖动物体身上的箭头，同时在 Inspector 里观察 `Transform` 的 Position 数值变化，就能理解"场景里的操作 = 修改 Transform 组件"。

## 5. 动手验证

按下面的步骤走一遍，确认你对窗口的理解正确：

1. 在 Hierarchy 顶部空白处右键，选择 **3D Object → Cube**，场景里出现一个立方体。
2. 在 Inspector 里看它：有 `Transform`、`Mesh Renderer`、`Box Collider` 三个组件。
3. 按 W，在 Scene 里拖动立方体的箭头，看 Inspector 里 Position 变化。
4. 按工具栏的 **Play** 按钮（顶部中间的三角形），Game 视图亮起，显示摄像机看到的画面。
5. 再按一次 Play 退出运行。

如果第 4 步 Game 视图是黑的或看不到立方体，多半是摄像机没对准物体：在 Hierarchy 里选中 `Main Camera`，按 F 让视角聚焦，或用 W 移动立方体到摄像机前方。

走通这个流程后，你已经会"创建物体 → 改 Transform → 运行"这条最基本的操作链。下一步把脚本加进去，让物体自己动起来：[第一个项目：场景、GameObject 与组件](./chapter-04-first-project.md)。
