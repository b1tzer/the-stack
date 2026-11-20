---
type: explanation
level: intermediate
---

# RVA 与三类表：导入、导出、重定位

上一章讲 PE 的头部，这一章讲「地址」和「表」。地址是 PE 格式里最容易搞混、也最影响实际分析的概念；导入表、导出表、重定位表则是理解程序行为的三张关键表。

## 1. RVA、VA 与文件偏移

PE 里同时存在三套地址，必须分清：

- **文件偏移（File Offset / FOA）**：数据在磁盘文件里的位置。十六进制查看器显示的就是它。
- **RVA（Relative Virtual Address，相对虚拟地址）**：数据被加载进内存后，相对 `ImageBase` 的偏移。
- **VA（Virtual Address，虚拟地址）**：`VA = ImageBase + RVA`。这是调试器、反汇编器里显示的内存地址。

PE 头里记录的地址几乎都是 RVA，而你在十六进制查看器里找数据用的是文件偏移。两者在文件对齐和内存对齐一致时相同，不一致时就会错位——文件里节区按 `FileAlignment`（如 `0x200`）对齐，加载进内存后按 `SectionAlignment`（如 `0x1000`）对齐，中间的差就是偏移量。

换算关系：对某个 RVA `R`，先找到它落在哪个节区（该节区的 `VirtualAddress ≤ R < VirtualAddress + VirtualSize`），则：

```text
File Offset = PointerToRawData + (R - VirtualAddress)
```

例如 RVA `0x1010` 落在 `.text` 节（`VirtualAddress = 0x1000`，`PointerToRawData = 0x400`），则文件偏移为 `0x400 + (0x1010 - 0x1000) = 0x410`。

**一个必须记住的结论：同一个数据的文件偏移和 RVA 通常不相等。** 在十六进制查看器里看到一个地址，别直接拿去反汇编器里搜索，先确认它是哪种地址。反汇编器和调试器默认显示的都是 VA，PE 工具（如 PE-bear、CFF Explorer）会同时给你看文件偏移和 RVA，方便对照。

## 2. 导入表：程序依赖谁

一个 `.exe` 几乎不可能不调用外部函数——读写文件要 `CreateFileW`，分配内存要 `VirtualAlloc`，输出要 `WriteFile`。这些函数由系统 DLL（如 `kernel32.dll`、`ntdll.dll`）提供，程序通过**导入表**声明自己依赖哪些 DLL 的哪些函数。

导入表的结构大致是：每个被依赖的 DLL 有一个 `IMAGE_IMPORT_DESCRIPTOR`，它串起一个 `IMAGE_THUNK_DATA` 数组，逐个列出导入函数的名称（或序号）。加载器在程序启动时解析这些项，把函数的真实内存地址填入 **IAT（Import Address Table，导入地址表）**。

对逆向的意义在于：**导入表是理解程序行为的第一线索。** 一个程序导入了 `CreateFileW`、`WriteFile`，大概率在读写文件；导入了 `RegOpenKeyExW`、`RegSetValueExW`，大概率在操作注册表；导入了网络相关函数，大概率要联网。静态分析的第一步，往往就是扫一眼导入表，对「这个程序想干什么」形成初步假设。

## 3. 导出表：DLL 提供什么

`.exe` 一般很少导出函数，导出表主要在 `.dll` 里。一个 DLL 把它愿意对外提供的函数登记在导出表里，供其他程序通过 `GetProcAddress` 查找。

导出表对逆向的用处是：**当你分析一个 DLL 时，导出表告诉你它对外暴露了哪些入口**，这是理解该 DLL 功能的骨架。恶意软件分析里，也常通过导出函数名（如 `Install`、`Start`）快速定位核心逻辑。

## 4. 重定位表：基址变了怎么办

程序编译时，链接器假设镜像会被加载到 `ImageBase` 指定的首选地址，于是把一些绝对地址直接写死在代码里。但系统可能因为地址冲突或 **ASLR（地址空间布局随机化）** 把它加载到别处。这时就需要**重定位表**：它记录「代码里哪些位置写了绝对地址」，加载器在基址变化时统一把这些位置加上偏移量，修正指针。

重定位表对逆向的直接影响是：**开启 ASLR 的模块，每次运行加载的基址都不同**，所以你在调试器里看到的绝对地址无法跨运行复现，必须用「模块基址 + 偏移」来描述位置。反汇编器处理时会把地址显示成相对形式，避免误导。

---

> 本章建立的是 PE 的地址模型和三张关键表：RVA、VA、文件偏移三套地址要能互相换算；导入表揭示程序依赖，导出表揭示 DLL 对外提供，重定位表支撑 ASLR 下的基址修正。下一章看 PE 里其余的内容——[TLS、资源节与 Debug Directory](./chapter-03-tls-resource-debug.md)。
