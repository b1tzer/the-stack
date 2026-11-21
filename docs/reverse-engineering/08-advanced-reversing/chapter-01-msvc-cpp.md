---
type: explanation
level: advanced
---

# MSVC C++ 逆向：STL 容器与名字修饰

Windows 商业软件大多用 MSVC 编译的 C++ 编写。分析它们，需要识别 MSVC 特有的产物：名字修饰、`this` 调用约定、STL 容器的内存布局。这一章讲这些「识别特征」。

## 1. MSVC 的名字修饰

C++ 支持重载、命名空间、类，同一个函数名可能对应多个函数。编译器用**名字修饰**（name mangling）把函数签名编码进符号名，以区分它们。

MSVC 的修饰规则形如 `?func@Class@@QEAAHXZ`，GCC 则是 `_ZN5Class4funcEv`（Itanium ABI）。识别修饰风格，能判断程序用哪个编译器编的。

对逆向的意义：

- **有符号的程序**，修饰名能直接还原出函数签名（类名、参数、返回值）。
- **无符号的程序**，反汇编器仍可能根据修饰名恢复部分信息（如果导出了符号）。

大多数商业软件不发布符号，所以名字修饰主要用于「判断编译器」和「理解导出函数」。

## 2. this 调用约定

C++ 成员函数有个隐含参数 `this`，指向对象实例。MSVC x64 下，`this` 用 `RCX` 传递（和普通第一个参数一样）。

所以成员函数调用看起来是：

```asm
lea  rcx, [obj]      ; this 放 rcx
mov  edx, 1          ; 第一个显式参数放 rdx
call Class::method   ; 调用成员函数
```

识别要点：**`RCX` 传的是对象地址（this），后面的寄存器是显式参数**。反编译时，把 `this` 识别出来，成员访问就清晰了（`this->field` 是 `[rcx + offset]`）。

## 3. STL 容器的识别

STL 容器（`std::string`、`std::vector`、`std::map`）有相对固定的内存布局，识别它们能大幅加速分析。不过「固定」是相对的——布局会随 MSVC 版本演进（如 `std::string` 的 SSO 阈值、`std::map` 的节点结构），本文描述的是较新 MSVC 的常见形态，遇到具体目标以实际反汇编为准。

**`std::string`**（MSVC 实现）。小字符串直接内联在对象里（SSO，小字符串优化），大字符串用堆上指针。反汇编里，一个「含指针 + 长度 + 容量」的结构，常是 `std::string`。

**`std::vector`**。典型的「三指针」结构：`begin`、`end`、`capacity`（指向数组开始、末尾、容量末尾）。反汇编里看到「三个连续的指针 + 动态扩容（`realloc` 类调用）」，就是 `vector`。

**`std::map`**。红黑树实现，节点含「父、左、右指针 + 颜色 + 键值」。反汇编里看到「复杂的树节点结构 + 旋转/平衡操作」，就是 `map`。

识别容器后，把它们定义成结构体（上一阶段的方法），反编译产物会从「一堆指针操作」变成「`vec.push_back`、`str +=`」这类可读逻辑。

## 4. C++ 异常处理

C++ 的 `try/throw/catch` 编译后，会生成异常处理表（x64 在 `.pdata` 和 `.xdata` 里），以及栈展开（unwinding）代码。

反汇编里识别 C++ 异常的特征：

- 函数里调用 `__CxxThrowException`（MSVC 的抛异常函数）。
- 大量 `try/catch` 区域对应 `.pdata` 里的展开信息。
- 反编译器会尝试还原 `try/catch` 结构，但复杂的异常流可能还原不准。

理解 C++ 异常的编译形态，才能在反编译产物里正确理解「哪些代码在 try 里、异常被谁捕获」。

## 5. 综合分析策略

分析 MSVC C++ 程序，建议的组合拳：

1. 先看 RTTI 和导出符号，恢复类名（[虚函数表与 RTTI](../05-static-analysis/chapter-03-vtable-rtti.md)）。
2. 识别 STL 容器，定义成结构体（[类型恢复](../05-static-analysis/chapter-02-type-recovery.md)）。
3. 识别 `this` 调用，理解成员函数。
4. 结合反编译伪代码，把逻辑还原成可读的 C++。

这套流程，是把「一个陌生的 MSVC 二进制」变成「能读懂的 C++ 逻辑」的标准路径。

## 6. 完整实例：识别一个 std::vector

用一个最小程序，走一遍「从源码到识别」的完整过程。

```cpp
#include <vector>

void collect(std::vector<int>& v, int n) {
    for (int i = 0; i < n; i++) {
        v.push_back(i);
    }
}
```

用 MSVC 编译后，`collect` 的核心反汇编（示意，非特定优化级别逐字输出）呈现出 `std::vector` 的典型指纹：

```asm
; 循环体里 push_back 的关键部分
mov  rax, [rcx+8]          ; rax = v.end
cmp  rax, [rcx+16]         ; end == capacity ?
je   grow_vector           ; 相等则走扩容分支
mov  [rax], edx            ; *end = i
add  qword ptr [rcx+8], 4  ; end += 1（int 元素占 4 字节）
jmp  next_i
grow_vector:
...                        ; 分配新数组、拷贝旧元素、释放、更新三指针
```

识别要点都在这几行里：

- **三指针布局**：`[rcx]`、`[rcx+8]`、`[rcx+16]` 分别对应 `begin`、`end`、`capacity`。三个连续的指针加上动态扩容，是 `std::vector` 的标志。
- **扩容判断**：`end == capacity` 就跳去扩容。这个「比较两个指针、相等就重新分配」的模式，是识别 `push_back` 的钥匙。
- **写入后指针自增**：`*end = i` 之后 `end += 元素大小`。

在反汇编器里，把 `rcx` 指向的结构定义成「三指针结构体」，反编译产物就会从「一堆指针操作」变成可读的 `v.push_back(i)`。这就是 STL 容器识别对逆向的实际价值。

---

> 本章建立的是 MSVC C++ 的识别特征：名字修饰判断编译器，`this` 走 RCX，STL 容器有固定内存布局，C++ 异常有编译产物。这些是分析 Windows 商业软件的基础。下一章看一个具体的 C++ 框架——[Qt 程序分析](./chapter-02-qt-analysis.md)。
