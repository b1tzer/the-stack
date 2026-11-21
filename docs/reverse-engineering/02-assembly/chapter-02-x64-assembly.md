---
type: explanation
level: basic
---

# x64 汇编与调用约定

静态分析要读的，是 `.text` 节里机器码翻译出来的汇编指令。本文面向 Windows x64，讲 x86-64 的寄存器、寻址、常用指令和调用约定——其中调用约定是读懂函数调用的关键，它和 Linux 的 System V 约定不同，不能混用。

## 1. 寄存器：CPU 手里的变量

寄存器是 CPU 内部极快的一小块存储，是汇编里最常打交道的对象。x64 有 16 个通用寄存器，每个 64 位：

```text
RAX  RBX  RCX  RDX  RSI  RDI  RBP  RSP
R8   R9   R10  R11  R12  R13  R14  R15
```

还有两个特殊寄存器：

- **RIP**：指令指针，指向下一条要执行的指令的地址。不能像普通寄存器那样直接读写。
- **RFLAGS**：标志寄存器，其中若干位记录上一条运算的结果特征，条件跳转靠它。

其中几个有约定俗成的职责，你需要记住：

| 寄存器 | 约定职责 |
| :-- | :-- |
| `RSP` | 栈指针，始终指向栈顶。几乎不做其他用途 |
| `RBP` | 帧指针（可选），指向当前函数栈帧的底部，便于访问局部变量 |
| `RAX` | 函数返回值 |
| `RCX` `RDX` `R8` `R9` | 前四个整数参数（Windows x64 约定） |

其余寄存器在 Windows x64 约定下分为两类：**易失寄存器**（`RAX`、`RCX`、`RDX`、`R8`–`R11`）——被调函数可以随意覆盖，调用者不能指望调用后还保留原值；**非易失寄存器**（`RBX`、`RBP`、`RDI`、`RSI`、`RSP`、`R12`–`R15`）——被调函数如果要使用，必须先保存、返回前恢复。理解这个区分，你才能解释为什么很多函数开头会先 `push rbx`。

## 2. 数据宽度：寄存器的高位和低位

汇编里的操作数必须明确「多宽」，否则同名指令会产生歧义。x64 寄存器可以通过不同名称访问其低位的不同部分。以 `RAX` 为例：

```text
RAX  |·······························| 64 位，整个
EAX  |···············|               | 低 32 位
AX   |·······|                       | 低 16 位
AL   |···|                           | 低 8 位
AH   |   ···|                        | 次低 8 位（仅 RAX/RBX/RCX/RDX 有 AH/BH/CH/DH）
```

常见的宽度后缀：`byte`（8 位）、`word`（16 位）、`dword`（32 位）、`qword`（64 位）。反汇编器里，`mov eax, 1` 和 `mov rax, 1` 是两条不同的指令，前者只动低 32 位（并且会把高 32 位清零），后者动整个 64 位。

一个初学常见困惑：`xor eax, eax` 看起来是「把 EAX 和 EAX 异或」，实际效果是把 EAX 清零，并且因为写 EAX 会清零 RAX 高 32 位，所以等价于 `mov rax, 0`，但机器码更短。看到 `xor eax, eax` 就理解为「RAX = 0」。

## 3. 内存寻址：访问内存里的数据

寄存器容量有限，真正的数据在内存里。x64 通过方括号 `[...]` 表示「取这个地址处的内容」，这叫寻址。最通用的形式是：

```text
[ base + index * scale + displacement ]
```

其中 `base` 是基址寄存器，`index` 是索引寄存器，`scale` 只能是 1、2、4、8，`displacement` 是一个常数偏移。四个部分都可以省略。

看几个实际例子：

```asm
mov  eax, [rcx]        ; 把 RCX 指向的 4 字节读到 EAX
mov  eax, [rcx+8]      ; 读 RCX+8 处的内容
mov  eax, [rsp+20h]    ; 读栈上 rsp+0x20 处的内容（访问局部变量常用）
mov  eax, [rax+rcx*4]  ; 读 rax + rcx*4 处，典型的数组访问：arr[i]
lea  rax, [rcx+8]      ; 把地址 rcx+8 本身放进 RAX，不读内存
```

这里必须分清 `mov` 和 `lea`：`mov rax, [rcx+8]` 是「取 RCX+8 处的**值**」；`lea rax, [rcx+8]` 是「把 RCX+8 这个**地址**」放进 RAX。反汇编里 `lea` 常用来做「加法和取地址」，不碰内存，别把它当读内存。

## 4. 常用指令：先掌握这一小批

反汇编里的指令看似很多，实际分析中反复出现的只有一小批。按用途分类：

**数据移动**

```asm
mov  dst, src   ; 复制
lea  dst, [..]  ; 取地址
push src        ; 压栈
pop  dst        ; 出栈
```

**算术与逻辑**

```asm
add  dst, src   ; dst += src
sub  dst, src   ; dst -= src
inc  dst        ; dst += 1
dec  dst        ; dst -= 1
and  dst, src   ; 按位与
or   dst, src   ; 按位或
xor  dst, src   ; 按位异或（dst == src 时用于清零）
shl  dst, n     ; 左移 n 位
shr  dst, n     ; 逻辑右移 n 位
imul dst, src   ; 有符号乘法
```

**比较与跳转**

```asm
cmp  a, b       ; 计算 a - b，设置标志位，但不保存结果
test a, b       ; 计算 a & b，设置标志位，不保存结果
jmp  target     ; 无条件跳转
je / jz         ; 相等 / 为零 则跳（ZF = 1）
jne / jnz       ; 不等 / 非零 则跳（ZF = 0）
jg              ; 有符号大于则跳
jl              ; 有符号小于则跳
ja              ; 无符号大于则跳
jb              ; 无符号小于则跳
```

**函数调用与返回**

```asm
call target     ; 调用函数：把返回地址压栈，然后跳转
ret             ; 返回：弹出返回地址并跳回
ret n           ; 返回并额外清理 n 字节栈（x64 下少见）
```

一个关键的阅读模式：`cmp a, b` 之后紧跟 `jxx`，翻译成高级语言就是 `if (a 关系 b) goto ...`。例如：

```asm
cmp  eax, 0
jne  label_else    ; if (eax != 0) goto label_else
```

几乎所有的 `if`、`for`、`while`、`switch`，编译后都是「比较 + 条件跳转」的组合。

## 5. Windows x64 调用约定 {#calling-convention}

函数之间如何传参、如何返回值、谁负责清理栈，由「调用约定」规定。Windows x64 使用统一的约定，要点如下（以 Microsoft 官方 [x64 calling convention](https://learn.microsoft.com/en-us/cpp/build/x64-calling-convention) 为准）：

1. **前四个整数或指针参数**依次放在 `RCX`、`RDX`、`R8`、`R9`。浮点参数放 `XMM0`–`XMM3`。
2. **第 5 个及以后的参数**压入栈（按从右到左的顺序）。
3. 调用者在 `call` 之前，要在栈上预留 **32 字节的 shadow space（也叫 home space）**，供被调函数存放前四个寄存器参数。即使参数少于四个，这 32 字节也照常预留。
4. 返回值：整数/指针放 `RAX`，浮点放 `XMM0`。
5. **栈对齐**：进入函数时，`RSP` 必须是 16 字节对齐的（即低 4 位为 0）——准确地说，`call` 之后进入被调函数时，`RSP + 8` 是 16 的倍数。这是最常踩的坑，访问栈参数和局部变量的偏移都建立在这个对齐基础上。

看一个最简例子，C 代码：

```c
int add(int a, int b) {
    return a + b;
}
```

在 Windows x64 下，参数 `a` 在 `RCX`、`b` 在 `RDX`，返回值在 `RAX`。编译器可能直接生成：

```asm
lea  eax, [rcx+rdx]   ; eax = a + b
ret
```

没有栈帧、没有 push/pop——因为函数体太简单，参数和返回值都走寄存器就够了。**这是理解调用约定的最好起点：参数在寄存器里，返回值也在寄存器里。**

## 6. 栈帧：局部变量和嵌套调用放哪 {#stack-frame}

函数一旦有局部变量，或者需要调用别的函数（调用会覆盖易失寄存器），就不能只靠寄存器了，需要**栈帧**。典型做法是：

```asm
; 函数开头（prologue，序言）
push rbp
mov  rbp, rsp
sub  rsp, 40h        ; 在栈上为局部变量预留 0x40 字节

; ... 函数体，用 [rbp-8]、[rbp-10h] 等访问局部变量 ...

; 函数结尾（epilogue，尾声）
add  rsp, 40h        ; 释放局部变量空间
pop  rbp
ret
```

`RBP` 在这里作为帧指针，指向栈帧底部；`[rbp - 偏移]` 访问局部变量，`[rbp + 偏移]` 访问传入参数（如果参数压栈）。这样无论 `RSP` 在函数中如何变化，局部变量和参数的偏移都相对 `RBP` 固定，好读也好编。

不过很多现代编译器在开启优化后，会省略帧指针（只用 `RSP` 计算偏移），反汇编里就没有 `push rbp; mov rbp, rsp` 这段了。所以**看不到帧指针不代表没有栈帧**，只是编译器换了一种记账方式。

看一个完整的对照，C 代码：

```c
int compute(int x, int y) {
    int sum = x + y;
    int diff = x - y;
    return sum * diff;
}
```

一种可能的（未优化的、示意性的）反汇编：

```asm
compute:
    push rbp
    mov  rbp, rsp
    sub  rsp, 16
    mov  [rbp+16], ecx     ; 保存参数 x（实际编译时参数走寄存器，这里为讲解简化）
    mov  [rbp+24], edx     ; 保存参数 y
    mov  eax, [rbp+16]
    add  eax, [rbp+24]
    mov  [rbp-4], eax      ; sum = x + y
    mov  eax, [rbp+16]
    sub  eax, [rbp+24]
    mov  [rbp-8], eax      ; diff = x - y
    mov  eax, [rbp-4]
    imul eax, [rbp-8]      ; sum * diff，结果进 eax
    add  rsp, 16
    pop  rbp
    ret
```

> 注意：这段反汇编是**为了讲清栈帧结构而做的示意**，并非某个特定编译器、特定优化级别的真实输出。真实输出会因编译器（MSVC / MinGW GCC / Clang）和优化级别不同而差异很大，比如优化后可能直接 `lea eax,[rcx+rdx]`、`sub eax`、`imul` 三步结束。读反汇编时先认「模式」（参数在哪、返回值在哪、局部变量在栈上），而不是死记具体序列。

## 7. 阅读反汇编的方法

初看反汇编最容易迷失。建议按这个顺序读：

1. **先定位函数边界**，看 `prologue / epilogue`，反汇编器通常会标出函数起点。
2. **识别参数和返回值**：参数在 `RCX/RDX/R8/R9` 或栈上，返回值在 `RAX`。
3. **找关键调用**：`call` 的目标如果是导入函数（反汇编器会标出名字，如 `call kernel32!CreateFileW`），立刻知道程序在做什么。
4. **把「比较 + 跳转」翻译成 `if`**，把「`cmp` + 循环回跳」翻译成 `while/for`。
5. **不要逐条抠，先看块**：一次看一个「基本块」（一段没有分支的直线代码），理解它整体在做什么，再往下走。

这些技巧，会在[静态分析基础](../05-static-analysis/chapter-01-basics.md)里结合真实工具进一步展开。

## 8. 对照练习目标：把本章串起来

用[编译篇的练习目标](../01-program-basics/chapter-01-c-cpp-compilation.md)里的 `crackme.c`，看它的 `check_serial` 函数如何体现本章所有知识点。源码：

```c
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
```

它的反汇编（未优化、示意）里，几乎每一行都能对应到本章讲过的内容：

```asm
check_serial:
    push rbp                     ; 栈帧：prologue
    mov  rbp, rsp
    sub  rsp, 40h                ; 局部变量 + expected 数组的空间
    mov  [rbp+16], rcx           ; 参数 input（char*）—— x64 第一个参数走 RCX
    ; expected[] 逐字节初始化到栈上
    mov  byte ptr [rbp-32], 63h  ; expected[0] = 0x63
    mov  byte ptr [rbp-31], 5Fh  ; expected[1] = 0x5F
    ...                          ; 其余 6 个字节同理
    xor  ecx, ecx                ; i = 0（xor 自清零）
loop_start:                      ; while 循环
    mov  rax, [rbp+16]           ; rax = input
    movsx edx, byte ptr [rax+rcx] ; edx = input[i]（数组访问：base + index）
    test edx, edx                ; input[i] == 0 ?
    je   end_check               ; 是，退出循环
    movsx eax, byte ptr [rbp-32+rcx] ; eax = expected[i]
    xor  edx, 37h                ; input[i] ^ 0x37
    cmp  edx, eax                ; 和 expected[i] 比较
    jne  return_false            ; 不等，返回 0（if 条件跳转）
    inc  ecx                     ; i++
    jmp  loop_start              ; 循环回跳
return_false:
    xor  eax, eax                ; return 0
    add  rsp, 40h                ; 栈帧：epilogue
    pop  rbp
    ret
end_check:
    ...                          ; 长度校验，返回 1 或 0
```

对照阅读：

- **栈帧**：`push rbp / mov rbp, rsp / sub rsp` 是本章第 6 节的 prologue，`[rbp-32]` 访问局部数组。
- **参数**：`input` 通过 `RCX` 传入（第 5 节调用约定）。
- **数组访问**：`[rax+rcx]` 是「基址 + 索引」寻址（第 3 节）。
- **循环与分支**：`cmp/jne` 是 `if`，`jmp loop_start` 回跳是 `while`（第 4 节）。
- **返回值**：`xor eax,eax` 清零、结果放 `RAX`（第 5 节）。

这就是「把散点知识串成一个真实函数」的样子。建议你亲手用 `cl /Od` 编译 `crackme.c`，在 IDA 或 Ghidra 里看它的真实反汇编，和上面这段对照。

---

> 本章建立的是 x64 汇编的阅读基础：寄存器承担参数和返回值，`cmp + 条件跳转` 构成所有分支，栈帧存放局部变量，Windows x64 调用约定规定前四个参数走 `RCX/RDX/R8/R9`、栈 16 字节对齐。下一章进入程序运行起来之后的状态——[虚拟内存与内存保护](../03-windows-internals/chapter-02-virtual-memory.md)。
