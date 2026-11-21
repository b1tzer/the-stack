---
type: tutorial
level: basic
---

# UI：Canvas 与 UGUI

游戏里需要血条、按钮、分数这些界面元素。读完这一篇并跟着做，你能创建 Canvas 和常用 UI 控件，理解屏幕空间坐标系，并让按钮响应点击。

## 1. Canvas 是所有 UI 的根

UI 元素（文字、按钮、图片）都放在 **Canvas（画布）** 下面。Canvas 是一个特殊组件，它把子物体渲染成屏幕上的界面，而不是 3D 世界里的物体。

创建 UI：Hierarchy 空白处右键 → **UI → Canvas**，会自动生成一个 Canvas 和一个 **EventSystem**（事件系统，处理点击、拖拽等 UI 交互，不能删）。

Canvas 的 **Render Mode** 决定 UI 怎么显示：

- **Screen Space - Overlay**（默认，最常用）：UI 直接贴在屏幕上，永远在 3D 画面之上，适合血条、按钮、HUD。
- **Screen Space - Camera**：UI 在摄像机前面，可以受摄像机视角影响。
- **World Space**：UI 在 3D 世界里，适合游戏内的指示牌、血条挂在角色头顶。

新手先只用 Overlay。

## 2. 常用控件

在 Canvas 下右键 → UI，能看到常用控件：

| 控件 | 用途 |
| --- | --- |
| **Text** | 显示文字（新版推荐用 TextMeshPro 的 Text） |
| **Button** | 按钮，带点击事件 |
| **Image** | 显示图片，可做血条、图标 |
| **Slider** | 滑动条，做音量、血条 |
| **Input Field** | 输入框 |

每个 UI 元素都是一个 GameObject，挂的是 `RectTransform`（`Transform` 的 UI 版本，用锚点和边距定位）加对应的 UI 组件。

## 3. 锚点与定位

UI 元素的定位靠 **RectTransform** 的**锚点（Anchor）**，这是 UI 和 3D 物体最大的不同：

- 锚点决定元素**相对屏幕哪个位置对齐**：锚在左上角，元素就固定在左上角；锚在中心，元素在屏幕中央。
- 屏幕大小变化时，锚点固定的元素会跟着对齐，适合做"血条永远在左上角"这类需求。

Inspector 里 RectTransform 顶部的方框图标可以快速设置锚点预设（比如"拉伸铺满""左上角"）。

## 4. 完整示例：一个计分按钮

做一个"点击按钮，分数加一"的界面：

1. 建 Canvas（UI → Canvas）。
2. 在 Canvas 下建一个 Button（UI → Button），再建一个 Text（UI → Text）。
3. 写脚本，处理按钮点击和分数显示：

```csharp
using UnityEngine;
using UnityEngine.UI;

public class ScoreCounter : MonoBehaviour
{
    public Text scoreText;   // Inspector 里拖入 Text
    private int score;

    public void AddScore()
    {
        score++;
        scoreText.text = "分数：" + score;
    }
}
```

4. 把脚本挂到 Canvas 上，把 Text 拖到 `scoreText` 槽位。
5. 选中 Button，在 Inspector 的 **Button** 组件下方找到 **OnClick** 区域，点 `+` 添加一个事件：
   - 把挂了脚本的 Canvas 拖到事件槽位；
   - 从函数下拉里选 `ScoreCounter.AddScore`。
6. 运行，点按钮，分数递增。

![Button 组件的 On Click 列表：点击 + 号添加事件绑定](/unity/04-gameplay-chapter-03-ui-button-onclick.png)

*图源：[Unity 官方文档](https://docs.unity3d.com/6000.3/Documentation/Manual/UIE-uGUI-button-callback.html)*

**成功标志**：每次点击按钮，Text 显示的数字加一。

这一步的关键是第 5 步——UI 事件通过 Inspector 的 OnClick 绑定到脚本方法，这是 UI 交互的通用模式。

## 5. 常见问题

| 现象 | 原因 |
| --- | --- |
| UI 不显示 | Canvas 没建，或元素不在 Canvas 下；或 Render Mode 不对 |
| 按钮点了没反应 | EventSystem 被删了；或 OnClick 没绑定正确的方法 |
| UI 在 Game 视图里位置不对 | 锚点设置问题，检查 RectTransform 的锚点 |
| 文字显示为粉色 | 用了旧版 Text 但项目启用了 TextMeshPro，改用 TextMeshPro 的 Text |

## 6. 下一步

界面做完了。下一步让角色和物体动起来，理解动画状态机：[动画：Animator 与状态机](./chapter-04-animator.md)。
