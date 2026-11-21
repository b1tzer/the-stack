# Unity 游戏开发知识库

本专题面向**会编程但没做过游戏**的开发者，从零讲解 Unity 引擎。读完核心路径后，你能独立搭建 Unity 项目、读懂编辑器工作区、用 C# 脚本做出可运行的小游戏，并理解 Unity 的核心机制。

> 本专题以 **Unity 6.3 LTS（6000.3）** 为验证基准，该版本支持至 2027-12。涉及版本差异的结论都会标明适用版本；版本支持状态见 [Unity 官方支持策略](https://unity.com/releases/unity-6/support)。

## 读者定位与前置知识

- 前置知识：会用任意一门编程语言，了解面向对象的基本概念（类、继承、接口）。
- C# 语言基础请先读 [C# 专题](../csharp/index.md)：类型系统、面向对象、委托与事件、集合与 LINQ 等语言机制由 C# 专题负责，本专题只解释它们在 Unity 中的用法与约定，不重复讲语言本身。

## 内容地图

### 01 上手与工具链

从安装环境到跑通第一个场景。

- [游戏开发与 Unity 的定位](./01-getting-started/chapter-01-why-unity.md)
- [安装 Unity Hub 与选择 LTS 版本](./01-getting-started/chapter-02-installation.md)
- [编辑器界面与工作区](./01-getting-started/chapter-03-editor-workspace.md)
- [第一个项目：场景、GameObject 与组件](./01-getting-started/chapter-04-first-project.md)

### 02 Unity 脚本基础

聚焦 Unity 特有的脚本机制，C# 语言基础见 C# 专题。

- [MonoBehaviour 与生命周期](./02-unity-scripting/chapter-01-monobehaviour-lifecycle.md)
- [常用 API：Transform、Time、GameObject](./02-unity-scripting/chapter-02-core-api.md)
- [输入系统](./02-unity-scripting/chapter-03-input.md)
- [Unity 的 C# 约定：序列化与 Inspector](./02-unity-scripting/chapter-04-serialization-inspector.md)

### 03 场景与核心概念

建立 Unity 的心智模型：坐标系、组件化、预制体、帧循环。

- [场景、坐标系与 Transform](./03-scene-core/chapter-01-scene-transform.md)
- [组件与消息](./03-scene-core/chapter-02-components-messages.md)
- [预制体与实例化](./03-scene-core/chapter-03-prefab-instantiation.md)
- [时间与帧循环](./03-scene-core/chapter-04-frame-loop.md)

### 04 玩法基础

让游戏"能玩"：物理、UI、动画、音频。

- [物理：Rigidbody 与 Collider](./04-gameplay/chapter-01-physics-rigidbody-collider.md)
- [碰撞检测与触发器](./04-gameplay/chapter-02-collision-triggers.md)
- [UI：Canvas 与 UGUI](./04-gameplay/chapter-03-ui-canvas-ugui.md)
- [动画：Animator 与状态机](./04-gameplay/chapter-04-animator.md)
- [音频](./04-gameplay/chapter-05-audio.md)

### 05 工程实践

从"能跑"到"可维护"。

- [脚本架构与组件化设计](./05-engineering/chapter-01-script-architecture.md)
- [事件系统与解耦](./05-engineering/chapter-02-event-system.md)
- [数据持久化：PlayerPrefs / JSON / ScriptableObject](./05-engineering/chapter-03-data-persistence.md)
- [调试与 Profiler](./05-engineering/chapter-04-debugging-profiler.md)
- [版本控制与团队协作](./05-engineering/chapter-05-version-control.md)

### 06 进阶与发布

跨平台打包与性能。

- [跨平台打包与发布](./06-advanced/chapter-01-build-publish.md)
- [性能优化概览](./06-advanced/chapter-02-performance.md)

后续扩展（未开始）：多人游戏与网络、DOTS / ECS。

## 内容边界

- Unity 专题负责引擎本身：编辑器、场景、组件、生命周期、物理、渲染、UI、动画、音频、架构与发布。
- C# 语言机制、.NET 运行时、并发异步由 [C# 专题](../csharp/index.md) 负责，本专题只解释它们在 Unity 中的落地。
- 设计模式、架构原则等跨语言实践由 [设计模式](../design-pattern/index.md) 与 [软件工程](../engineering/index.md) 专题负责。
