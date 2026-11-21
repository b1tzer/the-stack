---
type: howto
level: intermediate
---

# 跨平台打包与发布

你的游戏只在编辑器里跑，还没变成玩家能下载运行的程序。读完这一篇，你能把项目打包成 Windows 或 macOS 的可执行程序，并理解打包前要检查什么。

## 1. 打包前的准备

打包是把你的场景和资源编译成目标平台能运行的程序。动手前检查三件事：

1. **装好目标平台的模块**。打包到 Windows 需要 Windows Build Support 模块，macOS 需要 macOS Build Support。如果之前装编辑器时没勾，现在去 Unity Hub → Installs → 对应版本 → Add modules 补装。

2. **确认场景在 Build Settings 里**。打包只包含你添加进去的场景。菜单 **File → Build Settings**，把要打包的场景拖进 **Scenes In Build** 列表，第一个场景是启动场景。

3. **检查 Player Settings**。Build Settings 左下角 **Player Settings** 打开项目设置，设置游戏名、公司名、图标、默认分辨率等。

![Player Settings：设置 Company Name、Product Name、图标等项目信息](/unity/06-advanced-chapter-01-player-settings.png)

*图源：[Unity 官方文档](https://docs.unity3d.com/6000.3/Documentation/Manual/PlayerSettings.html)*

## 2. 执行打包

1. 菜单 **File → Build Settings**。
2. 在 **Platform** 列表选择目标平台（Windows、macOS、Linux 等），点 **Switch Platform**（首次切换需要较长时间）。
3. 点 **Build**，选择一个输出目录。
4. 等构建完成。

构建产物是目标平台的可运行程序：

- Windows：一个 `.exe` 加一个同名的 `_Data` 文件夹（两个都要给玩家）。
- macOS：一个 `.app` 包。
- WebGL：一组网页文件，需要托管到服务器才能运行。

**成功标志**：构建结束提示 Build succeeded，输出目录里出现对应平台的可执行文件，双击能运行。

## 3. 构建失败怎么办

| 现象 | 原因与处理 |
| --- | --- |
| Build Settings 里平台是灰的 | 没装该平台的 Build Support 模块，去 Hub 补装 |
| 构建到一半报错 | 看 Console 的具体错误。常见是脚本有编译错误（先修脚本）、或资源缺失 |
| 运行后黑屏 | 启动场景没设置，或场景列表是空的，把场景加进 Scenes In Build |
| 文件很大 | 资源没压缩、或误打包了大量无用资源，检查资源导入设置 |

## 4. 各平台的特殊点

- **移动端（Android/iOS）**：需要安装 JDK、Android SDK，iOS 还需要 macOS 和 Xcode。移动端打包远比桌面复杂，首次构建建议先桌面平台练手。
- **WebGL**：有内存限制（浏览器环境），纹理和资源要更省，构建后要放在 HTTP 服务器（直接双击打开本地文件可能不工作）。
- **桌面平台**：最省事，适合先跑通打包流程。

## 5. 一个最小打包流程

按这个顺序走一遍，把第一个项目打包出来：

1. 打开之前的项目，确认场景在 Scenes In Build 里（没有就 Add Open Scenes）。
2. Build Settings 选 **Windows** 或 **macOS**，Switch Platform。
3. Player Settings 里把 Product Name 改成你的游戏名。
4. 点 Build，选输出目录，等待完成。
5. 到输出目录双击运行，验证游戏能独立于编辑器运行。

走通这个流程，你就完成了"从写代码到产出可运行程序"的完整闭环。

## 6. 下一步

打包出来了，但如果游戏卡，还得优化性能。下一篇讲性能优化概览：[性能优化概览](./chapter-02-performance.md)。
