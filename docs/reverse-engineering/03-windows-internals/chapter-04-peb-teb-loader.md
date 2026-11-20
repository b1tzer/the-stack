---
type: explanation
level: intermediate
---

# PEB、TEB 与模块加载

程序运行时会加载多个模块，系统为每个进程和每个线程维护管理结构。这一章讲三个东西：模块基址、PEB（进程环境块）、TEB（线程环境块），以及它们如何串起「从 GS 到函数地址」这条链。

## 1. 模块与模块基址

程序运行时会加载多个**模块（module）**：主程序自己的 `.exe`，以及它依赖的 `.dll`（`ntdll.dll`、`kernel32.dll` 等）。每个模块加载后，在进程地址空间里占据一段连续的内存，这段内存的起始地址叫**模块基址（module base）**。

PE 的 `ImageBase` 字段是模块「首选」加载地址（x64 默认 `0x140000000`），但首选地址不是保证值，两个因素会让实际基址变化：

- **地址冲突**：多个 DLL 首选地址重叠，后面的只能挪到别处。
- **ASLR**：系统故意给模块基址加随机偏移。

因此，你不能假设模块每次都加载在 `ImageBase`。正确的做法是记住一个「偏移」：`函数实际地址 = 模块基址 + RVA`。反汇编器默认按 `ImageBase` 显示地址，调试器则显示真实地址，两者相差一个「基址偏移量」。

## 2. PEB 与 TEB

系统为每个线程和每个进程维护了管理结构，逆向里最常遇到两个：**TEB** 和 **PEB**。

**TEB（Thread Environment Block，线程环境块）**：每个线程一个，记录该线程的栈范围、异常处理链、TLS 等。在 x64 上通过 `GS` 段寄存器访问（x86 是 `FS`）。你在反汇编里看到 `mov rax, gs:[30h]` 这种指令，就是在读 TEB。

**PEB（Process Environment Block，进程环境块）**：每个进程一个，记录进程级信息。它在 TEB 的一个固定偏移处（`TEB.ProcessEnvironmentBlock`，偏移 `0x60`）。所以常见的套路是：

```asm
mov rax, gs:[60h]   ; 从 TEB 取 PEB 地址
```

PEB 里对逆向最有用的，是**已加载模块链表**：`PEB.Ldr` 指向 `PEB_LDR_DATA`，里面维护着进程已加载的所有模块（基址、名称等）。

## 3. GS → PEB → 模块链表 → 函数地址

把上面几个概念串成一条链，就是逆向里反复出现的手法：

```text
GS 段寄存器
  → TEB（线程环境块）
    → PEB（进程环境块，偏移 0x60）
      → PEB.Ldr（PEB_LDR_DATA）
        → 模块链表（记录各模块基址）
          → 找到 kernel32.dll 基址
            → 再找 GetProcAddress → 动态解析任意函数
```

这一套「通过 PEB 找模块基址、再找函数地址」的手法，常被恶意软件和加壳程序用来**不依赖导入表**地动态获取函数。因为导入表会暴露「程序用了哪些函数」，而这种方式把函数名藏起来了，静态分析看不到。

你现在只需知道 PEB/TEB 是什么、为什么反汇编里会出现 `gs:[60h]`；具体利用方式在[反调试与反静态分析](../07-packing/chapter-03-virtualization-anti-debugging.md)和[加壳与脱壳](../07-packing/chapter-01-packing-principle.md)里会用到。

## 4. Loader：谁在加载模块

前面 PE 加载过程讲过，Windows 的**加载器（Loader）** 负责把 PE 文件映射进内存、解析导入表、加载依赖 DLL。这套机制在 `ntdll.dll` 里实现（如 `LdrLoadDll`、`LdrpLoadImportModule` 等内部函数）。

理解 Loader 的存在，能解释几个现象：

- 导入函数的地址是加载时确定的，不是编译时。
- 模块链表、PEB 这些结构是 Loader 维护的。
- 加壳程序往往自己实现一部分「加载」逻辑（还原节区、手工解析导入），绕开标准 Loader，这正是[加壳与脱壳](../07-packing/chapter-01-packing-principle.md)要面对的问题。

---

> 本章建立的是模块加载的管理视图：模块基址受 ASLR 影响而每次变化，PEB/TEB 是定位模块与线程信息的关键结构，GS→PEB→模块链表是动态解析函数的常见路径。下一章看程序如何应对运行时错误——[异常处理机制](./chapter-05-exception-handling.md)。
