---
type: explanation
level: basic
---

# DLL 加载与 Windows API

程序几乎不可能不调用系统功能——读写文件、分配内存、显示窗口、联网。这些功能由 Windows 以 DLL 和 API 的形式提供。这一章讲 DLL 的加载方式，以及逆向中最常打交道的几类 Windows API。

## 1. 静态链接与动态链接

程序要使用外部代码，有两种方式：

- **静态链接**：把外部代码直接复制进最终的可执行文件。文件大，但运行时不依赖外部库。
- **动态链接**：可执行文件里只记录「我需要哪个 DLL 的哪个函数」，运行时由系统把 DLL 加载进来、解析地址。Windows 上 `.exe` 几乎都动态链接系统 DLL。

动态链接的好处是共享：所有程序共用一份 `kernel32.dll`，不用各自复制一份。代价是运行时需要解析——这正是 PE 导入表存在的原因。

## 2. 隐式链接与显式链接

动态链接又分两种：

**隐式链接**：程序在 PE 导入表里声明依赖，加载器在程序启动时自动加载 DLL、填充 IAT。这是最常见的用法，也是静态分析时看导入表能直接看到的依赖。

**显式链接**：程序在运行时调用 `LoadLibrary` 加载 DLL、用 `GetProcAddress` 按函数名查地址。这种依赖**不写在导入表里**，静态分析看不到。

两者的区别对逆向很重要：

- 隐式链接的函数，反汇编器直接标出名字（`call kernel32!CreateFileW`）。
- 显式链接的函数，反汇编里只能看到 `LoadLibrary` 和 `GetProcAddress` 的调用，真实调用的函数名被藏起来了。这是很多恶意软件和加壳程序隐藏行为的手段。

## 3. 核心 DLL 与 API 层次

Windows 的功能按层次组织，逆向中常遇到这几层：

| DLL | 定位 | 常见函数 |
| :-- | :-- | :-- |
| `ntdll.dll` | 最底层，直接对接内核 | `NtCreateFile`、`NtQueryInformationProcess` |
| `kernel32.dll` | 基础 API，进程/内存/文件/线程 | `CreateFileW`、`VirtualAlloc`、`WriteFile` |
| `user32.dll` | 用户界面 | `MessageBoxW`、`CreateWindowExW` |
| `ws2_32.dll` | 网络（Winsock） | `socket`、`connect`、`send`、`recv` |
| `advapi32.dll` | 注册表、服务 | `RegOpenKeyExW`、`RegSetValueExW` |

一个典型的调用链：程序调用 `kernel32.CreateFileW`，它内部转调 `ntdll.NtCreateFile`，再进入内核。逆向用户态程序时，你主要和 `kernel32`、`user32`、`ws2_32` 这些层打交道。

## 4. 从 API 反推程序行为

理解了 API 的层次和分类，就拿到了逆向的「速查表」：看到某个 API 调用，就能推断程序在做什么。

| 导入的 API | 推断的行为 |
| :-- | :-- |
| `CreateFileW` + `WriteFile` | 读写文件 |
| `RegOpenKeyExW` + `RegSetValueExW` | 操作注册表 |
| `socket` + `connect` + `send`/`recv` | 网络通信 |
| `VirtualAlloc` + `VirtualProtect` | 动态分配/修改内存权限（常与壳、注入有关） |
| `CreateRemoteThread` + `WriteProcessMemory` | 进程注入（修改其他进程） |
| `GetProcAddress` + `LoadLibrary` | 动态解析函数（隐藏真实调用） |

静态分析的第一步，往往就是扫一眼导入表，用这张「API 速查表」对程序行为形成初步假设。具体的分析流程在[静态分析](../05-static-analysis/chapter-01-basics.md)展开。

---

> 本章建立的是 DLL 与 API 的图景：动态链接让程序依赖系统 DLL，隐式链接写在导入表里、显式链接藏在运行时；看 API 就能反推程序行为。至此 Windows 底层机制完整。下一阶段进入[静态分析](../05-static-analysis/chapter-01-basics.md)。
