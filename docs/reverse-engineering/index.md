# 逆向工程知识库

这套内容面向有一定 C/C++ 编程基础、希望系统掌握 Windows 逆向工程的开发者。它按九个阶段组织：从程序运行基础、汇编、Windows 底层机制，到 PE 格式、静态分析、动态调试，再到加壳脱壳、高级程序逆向和综合实战。

逆向工程是理解「没有源码的程序如何运行」的方法。它产出的是对程序行为的理解，而不是精确复原源码；它的正当用途包括恶意软件分析、漏洞研究、兼容性分析和 CTF 竞赛。未经授权破解商业软件的授权保护在很多司法辖区违法或违反许可协议，本专题不涉及，所有示例均使用自编程序或公开 CTF 题目。

## 内容地图

- **[01 程序运行基础](./01-program-basics/chapter-01-c-cpp-compilation.md)**：[C/C++ 编译过程与优化](./01-program-basics/chapter-01-c-cpp-compilation.md)、[内存模型与函数调用](./01-program-basics/chapter-02-memory-function-call.md)。
- **[02 汇编语言与 CPU 架构](./02-assembly/chapter-01-x86-assembly.md)**：[x86 汇编](./02-assembly/chapter-01-x86-assembly.md)、[x64 汇编](./02-assembly/chapter-02-x64-assembly.md)、[常见编译器代码模式](./02-assembly/chapter-03-compiler-code-patterns.md)。
- **[03 Windows 底层机制](./03-windows-internals/chapter-01-process-thread.md)**：[进程与线程](./03-windows-internals/chapter-01-process-thread.md)、[虚拟内存与内存保护](./03-windows-internals/chapter-02-virtual-memory.md)、[DLL 与 Windows API](./03-windows-internals/chapter-03-dll-api.md)、[PEB/TEB 与模块加载](./03-windows-internals/chapter-04-peb-teb-loader.md)、[异常处理机制](./03-windows-internals/chapter-05-exception-handling.md)。
- **[04 PE 文件格式](./04-pe-format/chapter-01-pe-headers.md)**：[PE 头部](./04-pe-format/chapter-01-pe-headers.md)、[RVA 与三类表](./04-pe-format/chapter-02-address-and-tables.md)、[TLS/资源/Debug](./04-pe-format/chapter-03-tls-resource-debug.md)、[PE 加载过程](./04-pe-format/chapter-04-pe-loading.md)。
- **[05 静态分析](./05-static-analysis/chapter-01-basics.md)**：[静态分析基础](./05-static-analysis/chapter-01-basics.md)、[类型恢复](./05-static-analysis/chapter-02-type-recovery.md)、[虚函数表与 RTTI](./05-static-analysis/chapter-03-vtable-rtti.md)、[IDA Pro](./05-static-analysis/chapter-04-ida-pro.md)、[Ghidra](./05-static-analysis/chapter-05-ghidra.md)。
- **[06 动态调试](./06-dynamic-debugging/chapter-01-debugging-basics.md)**：[调试器的断点与单步机制](./06-dynamic-debugging/chapter-01-debugging-basics.md)、[x64dbg](./06-dynamic-debugging/chapter-02-x64dbg.md)。
- **[07 加壳与脱壳](./07-packing/chapter-01-packing-principle.md)**：[加壳原理与识别](./07-packing/chapter-01-packing-principle.md)、[手动脱壳](./07-packing/chapter-02-manual-unpacking.md)、[虚拟化保护与反调试](./07-packing/chapter-03-virtualization-anti-debugging.md)。
- **[08 高级程序逆向](./08-advanced-reversing/chapter-01-msvc-cpp.md)**：[MSVC C++ 逆向](./08-advanced-reversing/chapter-01-msvc-cpp.md)、[Qt 程序分析](./08-advanced-reversing/chapter-02-qt-analysis.md)、[网络通信与协议分析](./08-advanced-reversing/chapter-03-network-protocol.md)、[授权验证与完整性校验](./08-advanced-reversing/chapter-04-license-integrity.md)。
- **[09 综合逆向实战](./09-comprehensive-practice/chapter-01-crackme.md)**：[序列号校验的完整逆向](./09-comprehensive-practice/chapter-01-crackme.md)。

## 从问题进入

| 你现在的问题 | 入口 |
| :-- | :-- |
| 想理解源码如何变成机器码 | [C/C++ 编译过程与优化](./01-program-basics/chapter-01-c-cpp-compilation.md) |
| 不会读汇编指令、看不懂栈帧 | [x86 汇编](./02-assembly/chapter-01-x86-assembly.md) 与 [x64 汇编](./02-assembly/chapter-02-x64-assembly.md) |
| 不明白调试器里的地址为什么每次都在变 | [虚拟内存与内存保护](./03-windows-internals/chapter-02-virtual-memory.md) |
| 看不懂反汇编窗口里的地址和导入函数 | [PE 头部](./04-pe-format/chapter-01-pe-headers.md) 与 [RVA 与三类表](./04-pe-format/chapter-02-address-and-tables.md) |
| 拿到一个二进制，不知道从哪下手 | [静态分析基础](./05-static-analysis/chapter-01-basics.md) |
| 想还原结构体和 C++ 类 | [类型恢复](./05-static-analysis/chapter-02-type-recovery.md) 与 [虚函数表与 RTTI](./05-static-analysis/chapter-03-vtable-rtti.md) |
| 想下断点、单步、改程序行为 | [调试基础](./06-dynamic-debugging/chapter-01-debugging-basics.md) 与 [x64dbg](./06-dynamic-debugging/chapter-02-x64dbg.md) |
| 程序加壳了，看不到真代码 | [加壳原理与识别](./07-packing/chapter-01-packing-principle.md) 与 [手动脱壳](./07-packing/chapter-02-manual-unpacking.md) |
| 分析 C++ 或 Qt 程序 | [MSVC C++ 逆向](./08-advanced-reversing/chapter-01-msvc-cpp.md) 与 [Qt 程序分析](./08-advanced-reversing/chapter-02-qt-analysis.md) |
| 想把所有技能串起来做一题 | [序列号校验的完整逆向](./09-comprehensive-practice/chapter-01-crackme.md) |

## 内容边界

本专题以 Windows x64（PE）为主线，汇编以 x86-64 为主、x86 为辅，工具以 IDA Pro、Ghidra 和 x64dbg 为主。Linux ELF、macOS Mach-O 的原理相通，但文件格式、调用约定和工具不同，不在本专题展开。

工具界面与版本说明以正文标注的适用版本为准，生产使用前核对对应官方文档。所有示例均使用自编程序或公开 CTF 题目；分析来路不明的程序（尤其是恶意软件）时，务必在隔离环境中进行。
