---
type: howto
level: intermediate
---

# 调试与 Profiler

游戏出了 Bug 或跑起来卡，你知道要看 Console 和 Profiler，但不知道具体怎么用。读完这一篇，你能用日志、断点和 Profiler 定位问题，区分"找 Bug"和"找性能瓶颈"两件事。

## 1. 找 Bug 和找瓶颈是两回事

先分清两类问题：

- **功能 Bug**：行为不对，比如"扣血扣了两倍""按钮点了没反应"。用日志和断点定位。
- **性能问题**：行为对，但卡、掉帧、内存涨。用 Profiler 定位。

它们的工具不同：Bug 用 `Debug.Log` 和断点，性能用 Profiler。别用 `Debug.Log` 去排查性能（日志本身也有开销），也别用 Profiler 去找逻辑 Bug。

## 2. 用日志定位 Bug

`Debug.Log` 是最常用的排查手段，在关键位置打印状态：

```csharp
void TakeDamage(int amount)
{
    health -= amount;
    Debug.Log($"扣血 {amount}，剩余 {health}");   // 观察数值变化
}
```

Console 窗口（Window → General → Console）显示这些输出，并支持过滤：

![Console 窗口：普通日志、警告和错误三种消息类型](/unity/05-engineering-chapter-04-console.png)

*图源：[Unity 官方文档](https://docs.unity3d.com/6000.3/Documentation/Manual/Console.html)*

- 点击 **Info / Warning / Error** 切换显示类型，只看 Error 能快速定位报错。
- 点击某条日志，能看到它的调用堆栈，点堆栈能跳到对应代码行。

`Debug.Log` 适合快速确认"代码有没有执行到、数值对不对"，但它会留在代码里影响性能和整洁度，排查完应删除，或用 `#if UNITY_EDITOR` 包起来只在编辑器生效。

## 3. 用断点精确定位

日志只能"看"，断点能"停"。在可疑代码行设断点，运行时程序停在那里，你可以逐行查看变量值。

用 Visual Studio 或 Rider 打开项目：

1. 在可疑代码行左侧点一下，设断点（出现红点）。
2. 在 IDE 里点 **Attach to Unity**（附加到 Unity 进程）或直接点调试运行。
3. 游戏运行到断点处暂停，鼠标悬停变量查看当前值，用"单步执行"逐行推进。

断点适合"日志打了但看不出问题"的场景，能直接看到那一时刻所有变量的值。

## 4. 用 Profiler 定位性能瓶颈

游戏卡顿（掉帧）时，打开 **Window → Analysis → Profiler**：

![Profiler 的 Play 模式时间线：各帧的 CPU 耗时分布](/unity/05-engineering-chapter-04-profiler-timeline.png)

*图源：[Unity 官方文档](https://docs.unity3d.com/6000.3/Documentation/Manual/Profiler.html)*

1. 点 Profiler 窗口的 **Record** 按钮开始记录。
2. 运行游戏，跑一段你觉得卡的部分。
3. 停止记录，分析数据。

Profiler 有几个关键区域：

- **CPU Usage**：各系统（渲染、脚本、物理、动画）占用的 CPU 时间。哪个柱子高，哪个是瓶颈。
- **Rendering**：渲染耗时，看 Draw Call 数量、三角形数量。
- **Memory**：内存占用，看是否有泄漏（内存只涨不降）。

在 CPU 图里点最高的帧，下面会列出各函数耗时，找到你自己的脚本方法（名字下面带 `Scripts`），就能定位到"哪个脚本哪一行在拖慢游戏"。

常见性能问题的定位：

| 现象 | 常见原因 | 排查方向 |
| --- | --- | --- |
| 帧率低、CPU 高 | 脚本里每帧做昂贵操作 | CPU 图里找耗时最高的脚本方法 |
| 渲染慢 | Draw Call 过多、模型面数高 | Rendering 图里看 Draw Call 数量 |
| 内存持续涨 | 物体只生成不销毁、资源泄漏 | Memory 图看是否只涨不降 |

## 5. 一个完整排查流程

以"游戏越来越卡"为例：

1. 打开 Profiler，Record 运行游戏，观察到帧率随时间下降。
2. 切到 CPU Usage，发现 `Update` 里某个脚本耗时越来越长。
3. 打开 Memory，发现对象数量持续增长——说明有物体只创建没销毁。
4. 回到代码，找到 `Instantiate` 的地方，确认对应逻辑有没有 `Destroy`。
5. 补上销毁逻辑，重新 Profiler 验证对象数量稳定。

这就是"Profiler 定位 → 代码修复 → 复测"的标准流程。

## 6. 下一步

调试能力齐了。最后解决多人协作的问题——Unity 项目怎么用版本控制：[版本控制与团队协作](./chapter-05-version-control.md)。
