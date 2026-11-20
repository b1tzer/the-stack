---
type: howto
level: basic
---

# Ghidra 静态分析与脚本化

> 上一篇用 IDA Pro 完成了静态分析，这一篇用免费的 Ghidra 做同样的事。Ghidra 是 NSA 开源发布的逆向框架，自带反编译器、支持脚本化，是入门和中小规模分析的高性价比选择。

**前置条件**：已读 [IDA Pro](./chapter-04-ida-pro.md)，理解函数、交叉引用、反编译这些概念；电脑上装好了 Ghidra（本文以 11.x～12.x 为准，界面跨版本稳定）和它所要求的 Java 运行环境（Ghidra 11.x 起需要 JDK 17 或更高，具体以官方安装说明为准）。同样拿一个你自己写的小程序练手。

## 1. 安装与启动

Ghidra 是免安装的：从 [ghidra-sre.org](https://ghidra-sre.org/) 下载压缩包，解压后进入目录，双击 `ghidraRun.bat` 启动。首次启动会要求选择 JDK 路径——如果提示找不到 Java，说明 JDK 未安装或版本过低，装好 JDK 再启动即可。

启动后先看到项目管理窗口。Ghidra 用「项目（Project）」来组织分析对象：新建一个项目（`File → New Project`，选 Non-Shared），然后导入你的 `.exe`（`File → Import File`）。导入对话框会识别出文件格式和架构，确认无误后，双击文件进入 **CodeBrowser**——这才是真正干活的主界面。

## 2. 认识 CodeBrowser

CodeBrowser 默认有几个核心区域：

| 区域 | 作用 |
| :-- | :-- |
| **Listing**（中部） | 反汇编视图，相当于 IDA 的 IDA View |
| **Decompiler**（右侧） | 反编译伪代码窗口，Ghidra 免费自带 |
| **Symbol Tree**（左侧） | 函数、导入、导出的树状列表 |
| **Defined Strings**（窗口） | 字符串列表（`Window → Defined Strings` 打开） |

Ghidra 的窗口都可以拖拽重排，入门保持默认即可。反编译窗口**默认会自动跟随 Listing**——你在反汇编里点到哪个函数，右侧就反编译哪个函数，这对快速理解逻辑非常方便。

## 3. 分析：让 Ghidra 先做一轮自动识别

导入文件后，Ghidra 会询问是否运行 **Auto Analyze**（自动分析）。选「Yes」并保持默认选项，它会自动识别函数、分析导入导出、找交叉引用。这一步对应 IDA 加载后的自动分析，**不要跳过**，否则后面连函数都识别不全。

分析完成后，`Symbol Tree` 的 Functions 目录下会列出识别出的函数。如果没有符号，函数名也是 `FUN_140001000` 这种形式，和 IDA 的 `sub_140001000` 对应。

## 4. 定位 main、反编译、查引用

流程和 [IDA Pro](./chapter-04-ida-pro.md) 完全平行，只是快捷键不同：

1. **定位 `main`**：在 Symbol Tree 的 Functions 里找 `main`；无符号时，从入口点（`entry`）追查传入 argc/argv 的调用。
2. **反编译**：点进函数，右侧 Decompiler 自动显示伪代码；也可在 Listing 里把光标停在函数上后，用 `Window → Decompiler` 打开。
3. **查交叉引用**：对函数、字符串、数据，把光标放上去按 **`X`**，弹出引用列表；双击跳转。
4. **重命名**：把光标放在要改名的函数或变量上，按 **`L`**（Label），输入有意义的名字。Ghidra 里变量重命名在反编译窗口直接右键变量名修改。

和 IDA 一样，**「搞懂一个就重命名一个」是 Ghidra 的核心工作习惯**。重命名后，交叉引用、反编译结果都会同步更新，让整个分析越来越清晰。

## 5. 一个示例：与 IDA 篇对照

继续用 [IDA Pro 篇](./chapter-04-ida-pro.md)那个密码校验程序。在 Ghidra 里的分析路径：

1. `Window → Defined Strings` 打开字符串列表，找到 `"Wrong password"`。
2. 双击它跳到数据位置，光标放上去按 `X`，看到唯一引用，跳转到引用处。
3. 该处就是校验逻辑，右侧 Decompiler 已经给出伪代码：

```c
if (strcmp(input, "secret123") == 0) {
    puts("Correct!");
} else {
    puts("Wrong password");
}
```

4. 在 Listing 里核对 `CALL strcmp` 后的 `CMP EAX,0x0` 和 `JNZ` 分支，确认无误。

和 IDA 篇对比可以发现，**两者的分析概念一一对应，只是命名和快捷键不同**。下表是把两篇的对应关系汇总：

| 能力 | IDA | Ghidra |
| :-- | :-- | :-- |
| 反汇编视图 | IDA View | Listing |
| 反编译 | `F5`（Hex-Rays） | Decompiler 窗口（自带） |
| 跳转到地址 | `G` | `G` |
| 交叉引用 | `X` | `X` |
| 重命名 | `N` | `L` |
| 创建函数 | `P` | 右键 `Disassemble` / `Create Function` |
| 保存 | 数据库 `.i64` | 项目 + 分析结果 |

## 6. 脚本化：Ghidra 的独特优势 {#scripting}

Ghidra 相对 IDA 免费版的一大优势是**内置脚本引擎**，支持 Java 和 Python（Jython），能批量、自动化地分析。入口是 `Window → Script Manager`，里面预置了大量官方脚本，也能新建自己的脚本。

一个入门级的 Python 脚本——遍历当前程序所有函数，打印名字和地址：

```python
# 在 Ghidra Script Manager 中新建 Python 脚本运行
listing = currentProgram.getListing()
fm = currentProgram.getFunctionManager()
for func in fm.getFunctions(True):
    print("0x%X\t%s" % (func.getEntryPoint().getOffset(), func.getName()))
```

运行后，控制台会按地址升序打印所有函数。这个脚本本身不复杂，但它展示了脚本化的威力：**同样的「遍历 + 处理」模式，稍加扩展就能做「找出所有调用 `WriteFile` 的函数」「列出所有含某个字符串的函数」这类批量任务**，这是手动点按钮做不到或很慢的。

脚本化适合当你需要重复、批量处理时再深入；日常单文件分析，手动操作足够。

## 7. 失败与回退

- **启动报 Java 错误**：JDK 版本不满足，按官方要求装对应版本并重新指定 JDK 路径。
- **Auto Analyze 没跑或结果不全**：`Analysis → Auto Analyze` 重新运行。
- **误删/误改分析结果想重来**：Ghidra 的改动即时生效但可撤销（`Edit → Undo`）；彻底重来可重新导入文件。

---

> 本章用 Ghidra 完成了和 IDA 相同的静态分析，并引入了脚本化。Ghidra 与 IDA 的分析概念一一对应，区别只在命名和快捷键。下一章转到另一个维度——[动态调试基础](../06-dynamic-debugging/chapter-01-debugging-basics.md)，让程序跑起来观察它。
