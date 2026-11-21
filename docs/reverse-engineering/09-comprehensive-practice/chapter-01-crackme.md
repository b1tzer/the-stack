---
type: tutorial
level: intermediate
---

# 序列号校验的完整逆向

> 这一篇把前面的内容串成一个完整案例：一个自己写的、带简单加密校验的 Windows 控制台程序，用静态分析 + 动态调试还原出正确的序列号。

**前置条件**：已读完本专题，会用 Ghidra（或 IDA）做基本静态分析、会用 x64dbg 下断点单步。本案例目标程序由你自己编译，分析它完全合法，普通 Windows 电脑加一个 C 编译器即可。

## 1. 准备目标程序

新建 `crackme.c`，内容如下：

```c
#include <stdio.h>
#include <string.h>

// 校验函数：输入每个字符 XOR 0x37，与硬编码数组比较
int check_serial(const char* input) {
    unsigned char expected[] = {0x63, 0x5F, 0x52, 0x64,
                                0x43, 0x56, 0x54, 0x5C};
    int i = 0;
    while (input[i] && expected[i]) {
        if ((input[i] ^ 0x37) != expected[i])
            return 0;
        i++;
    }
    return input[i] == 0 && expected[i] == 0;
}

int main() {
    char buf[64];
    printf("Enter serial: ");
    fgets(buf, sizeof(buf), stdin);
    buf[strcspn(buf, "\n")] = 0;
    if (check_serial(buf))
        printf("Correct!\n");
    else
        printf("Wrong serial.\n");
    return 0;
}
```

用任意 x64 编译器编译。MSVC 下：

```text
C:\> cl /O2 crackme.c
```

MinGW 下：

```text
C:\> gcc -O2 -o crackme.exe crackme.c
```

先运行一次，确认行为符合预期（输入任意字符串应输出 `Wrong serial.`）。**这就是你接下来要「逆向破解」的对象，答案你已经从源码里知道了——这正好用来验证每一步分析是否正确。**

## 2. 静态分析：还原算法 {#static-analysis}

把 `crackme.exe` 丢进 Ghidra（或 IDA，操作对应关系见 [Ghidra](../05-static-analysis/chapter-05-ghidra.md)）。

**第一步：看字符串。** 打开字符串列表（Ghidra 里 `Window → Defined Strings`），找到 `"Enter serial:"`、`"Correct!"`、`"Wrong serial."`。这一步就定位到了主逻辑所在的范围。

**第二步：定位校验函数。** 对 `"Wrong serial."` 按 `X` 查交叉引用，跳到引用它的代码；向上回溯，找到被调用的校验函数（Ghidra 里形如 `FUN_140001000`）。这就是 `check_serial`。

**第三步：反编译。** 点进 `check_serial`，右侧 Decompiler 给出伪代码，关键部分形如：

```c
if ((input[i] ^ 0x37) != expected[i])
    return 0;
```

同时能看到 `expected` 是一个 8 字节的数组，值为 `0x63 0x5F 0x52 0x64 0x43 0x56 0x54 0x5C`。

**第四步：反推答案。** 校验逻辑是 `input[i] ^ 0x37 == expected[i]`，所以 `input[i] == expected[i] ^ 0x37`。逐字节计算：

```text
0x63^0x37=0x54 'T'  0x5F^0x37=0x68 'h'  0x52^0x37=0x65 'e'  0x64^0x37=0x53 'S'
0x43^0x37=0x74 't'  0x56^0x37=0x61 'a'  0x54^0x37=0x63 'c'  0x5C^0x37=0x6B 'k'
```

得到序列号 **`TheStack`**。到这里，不运行程序就还原出了答案。

## 3. 动态验证：用 x64dbg 确认 {#dynamic-verification}

静态结论要用动态行为验证。用 x64dbg 打开 `crackme.exe`（`F3`，选 64 位调试器）。

**第一步：定位比较点。** 在反汇编面板 `Ctrl+G` 跳到校验函数的比较指令附近（`xor` 后跟 `cmp` 的地方）。在你认为关键的比较指令上按 `F2` 下断点。

**第二步：先输入错误值观察。** `F9` 运行，程序在控制台里等待输入。输入一个明显错误的值（如 `aaaa`），回车。程序命中断点停下。此时单步（`F8`）观察：`xor` 计算出错误结果，`cmp` 不相等，随后走向返回 0 的分支——与你静态分析的结论一致。

**第三步：输入正确值观察。** `Ctrl+F2` 重启，`F9` 运行，输入 `TheStack`，回车。再次命中断点，单步观察：每次 `cmp` 都相等，循环正常走完，最终返回非零。继续 `F9`，控制台打印 `Correct!`。

**结果验证**：动态观察到的分支走向与静态推导完全一致，说明你对算法的还原是正确且完整的。

## 4. 这套分析流程的通用化

把这次做的事抽象成套路，适用于绝大多数入门级 crackme 和 CTF 逆向题：

1. **识别**：`file` / DIE 确认架构、位数、是否加壳。
2. **静态扫线索**：看字符串、导入表，形成「程序在做什么」的假设。
3. **定位关键逻辑**：从字符串/导入函数的交叉引用，追到核心函数。
4. **反编译 + 反推**：还原算法，算出答案或理解分支条件。
5. **动态验证**：下断点、输入测试值、观察分支，确认静态结论。

五个步骤里，静态和动态互相校验，缺一不可。这套流程练熟后，你可以去尝试 CTF 平台（如 HackTheBox、TryHackMe 的 Reversing 板块，或各类 CTF 的 reverse 题目），那些题目本质就是把这个流程套在更复杂的算法上。

## 5. 一个必须重复的安全提醒

这个案例分析的是**你自己编译的程序**，全程可控。真实场景里，如果你要分析来路不明的程序——尤其是恶意软件——必须做到：

- **在隔离环境里做**：虚拟机、断网、快照备份。恶意软件可能加密磁盘、窃取文件、横向传播。
- **不碰真实敏感数据**：虚拟机里不放任何个人文件、不登录个人账号。
- **明确授权边界**：只分析你有权分析的样本，不把逆向能力用于破解他人软件的保护。

安全地练习，才能走得更远。

---

> 本专题到此结束。你已经建立起了 Windows x64 逆向的完整骨架：从文件格式、汇编、内存模型，到静态/动态分析工具，再到反调试与脱壳。剩下的，是在真实题目里反复练习，把「知道」变成「会用」。
