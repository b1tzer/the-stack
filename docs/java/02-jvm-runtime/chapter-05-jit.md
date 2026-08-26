# JIT 编译

> 压测前 5 分钟 QPS 只有峰值的一半——不是你的代码有问题，是 JVM 在预热。同一段热点代码，跑 10000 次前是解释执行（一次 120ns），跑 10000 次后触发 C2 编译（一次 8ns）——15 倍的差距。更隐蔽的是：预热不充分时上线，前几分钟的慢请求会拖垮采样数据，让你把代码问题误判为性能问题。JIT 不是锦上添花——是会骗你的。

## 1. 为什么需要 JIT

| 模式 | 启动速度 | 峰值性能 | 适用场景 |
|------|---------|---------|---------|
| 解释执行 | 快 | 差 | 小程序、脚本 |
| AOT（提前编译） | 快 | 一般 | 启动敏感场景（GraalVM Native Image） |
| JIT（即时编译） | 慢（需要预热） | 最优 | 长期运行的服务端 |

Java 的答案是**混合模式**：先用解释器快速启动，热点代码交给 JIT 编译优化。

这就是为什么 Java 服务启动后需要"预热"——刚开始是解释执行，性能较差；运行一段时间后，热点代码被 JIT 编译成机器码，性能大幅提升。

### 1.1 解释 vs 编译的性能差距

```java
// 一个简单的方法调用循环
for (int i = 0; i < 100_000_000; i++) {
    sum += compute(i);
}
```

| 执行方式 | 耗时（相对值） | 原因 |
|---------|-------------|------|
| 纯解释执行 | 100x | 每次执行都要解析字节码 |
| C1 编译 | 10x | 机器码，保守优化 |
| C2 编译 | 1x | 机器码，激进优化（内联、逃逸分析、向量化） |

## 2. HotSpot 编译体系

```text
解释执行（Interpreter）
      ↓ 热点探测（方法调用次数 > 阈值）
C1 编译（Client Compiler）—— 快速编译，保守优化
      ↓ 更热（调用次数进一步增加）
C2 编译（Server Compiler）—— 深度编译，激进优化
```

### 2.1 分层编译（Tiered Compilation）

JDK 8+ 默认开启分层编译（`-XX:+TieredCompilation`），将编译分为 5 个层级：

| 层级 | 编译方式 | 特点 |
|------|---------|------|
| Level 0 | 解释执行 | 收集基本 profiling 数据 |
| Level 1 | C1，简单编译 | 不收集 profiling |
| Level 2 | C1，有限 profiling | 收集调用计数和分支概率 |
| Level 3 | C1，完整 profiling | 收集完整的类型信息和分支概率 |
| Level 4 | C2，深度优化 | 基于 profiling 数据做激进优化 |

一个典型的热点方法经历：

```text
方法首次调用 → Level 0（解释执行，收集 profiling）
  ↓ 调用次数增加
Level 3（C1 编译 + 完整 profiling）
  ↓ 调用次数继续增加
Level 4（C2 编译，基于 Level 3 的 profiling 做激进优化）
```

### 2.2 热点探测

JVM 使用**方法调用计数器**和**回边计数器**来判断代码是否"热"：

- **方法调用计数器**：方法被调用的次数，阈值默认 10000 次（`-XX:CompileThreshold`）
- **回边计数器**：循环体执行的次数，阈值默认 10700 次（`-XX:OnStackReplacePercentage`）

两个计数器任一达到阈值，就触发编译。

### 2.3 On-Stack Replacement（OSR）

分层编译有一个实际问题：一个方法正在执行中（比如一个很长的循环），此时达到了编译阈值。方法还在栈上执行，总不能等它返回再用编译后的版本吧？

OSR 解决的就是这个问题——**方法还在执行中，就切换到编译后的机器码**。

```text
方法正在解释执行（Level 0）
  ↓ 循环次数达到阈值
JVM 编译该方法的循环体为机器码
  ↓ 在循环的下一次迭代入口处切换
从解释执行切换到机器码执行（Level 4）
  ↓ 方法返回时
回到正常的分层编译流程
```

OSR 的触发依赖**回边计数器**（循环体执行次数），而非方法调用计数器。这就是为什么一个只调用一次但内部有大量循环的方法也能被 JIT 编译。

OSR 编译的代码质量通常略低于正常编译——因为它需要在循环入口处插入"从解释器栈帧过渡到编译代码栈帧"的桥接代码。但对于长时间运行的循环，OSR 带来的性能提升远大于这个开销。

### 2.4 Profiling 收集的信息

| 信息类型 | 用途 | 示例 |
|---------|------|------|
| 类型 profiling | 虚方法去虚化 | `interface.method()` 只有一个实现 → 直接调用 |
| 分支 profiling | 条件预测 | `if (x > 0)` 99% 为 true → 优先编译 true 分支 |
| 调用 profiling | 方法内联决策 | 被调用方法很小 → 内联 |
| 循环 profiling | 循环展开 | 循环次数为 4 的倍数 → 展开 4 次 |

## 3. 方法内联

**最重要的 JIT 优化，没有之一。**

方法内联将被调用方法的代码直接嵌入调用方，消除方法调用开销（栈帧创建与销毁、参数传递、返回值处理）。

### 3.1 内联的效果

```java
// 内联前
public int add(int a, int b) { return a + b; }
public int calculate() { return add(1, 2) + add(3, 4); }

// 内联后（JIT 优化）
public int calculate() { return 1 + 2 + 3 + 4; }

// 进一步优化（常量折叠）
public int calculate() { return 10; }
```

### 3.2 内联是后续优化的基础

内联不仅消除了方法调用开销，还为后续优化打开了空间：

```text
原始代码:
  result = add(1, 2) + multiply(3, 4);

内联后:
  result = 1 + 2 + 3 * 4;

常量折叠:
  result = 15;

逃逸分析（如果 result 是局部变量）:
  → 标量替换，消除 result 对象
```

没有内联，逃逸分析和常量折叠都无法进行——因为方法调用是"黑盒"，JIT 看不到方法内部。

### 3.3 内联阈值

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `-XX:MaxInlineSize` | 35 字节 | 小于此大小的方法自动内联 |
| `-XX:FreqInlineSize` | 325 字节 | 热点方法的内联阈值 |
| `-XX:MaxInlineLevel` | 9 | 最大内联深度（方法 A 调用 B 调用 C...） |

```java
// 小方法 → 自动内联
public int add(int a, int b) { return a + b; }  // 字节码 < 35 字节

// 大方法 → 通常不会内联
public void process() { /* 100 行代码 */ }  // 字节码 > 325 字节
```

### 3.4 内联与虚方法

虚方法（`invokevirtual`）的目标在编译期不确定——可能是子类的实现。JIT 通过 profiling 收集的信息做**去虚化**：

JIT 通过两种手段做去虚化：

**1. 基于 Class Hierarchy Analysis（CHA）**

如果一个虚方法或接口方法在当前类层次中只有一个实现，JVM 可以在编译时直接内联，不需要等 profiling：

```java
// 类层次分析：当前只有 FinalClass 实现了 Interface
// Interface.method() → 直接内联 FinalClass.method()
// 因为没有其他实现，编译时就能确定目标

// 如果后来加载了新实现 → 去优化
```

CHA 对 `final` 类和 `final` 方法最可靠——它们不可能有子类/重写，编译时目标确定，无需去优化。这是为什么将不会被继承的方法标记为 `final` 能帮助 JIT 优化。

**2. 基于 Profiling 的去虚化**

对于有多个实现的方法，JIT 通过 profiling 发现某个实现占绝对多数（如 99%），就可以做"推测性去虚化"：

```java
interface Parser {
    String parse(String input);
}

// 运行时 99% 的调用是 JsonParser
Parser parser = getParser();
parser.parse(data);  // invokeinterface

// JIT 发现 99% 是 JsonParser → 内联 JsonParser.parse()
// 在内联代码前插入类型检查（Guard）
// 如果遇到其他实现 → 去优化
```

## 4. 逃逸分析与相关优化

[第三章](./chapter-03-object-model)对象模型已经介绍了逃逸分析的概念。JIT 编译器利用逃逸分析的结果做三种优化：

### 4.1 栈上分配

未逃逸的对象在栈帧上创建，方法结束时自动销毁，不需要 GC 回收。这对大量短生命周期对象的场景特别有效。

```java
// 未逃逸：point 只在方法内部使用
public int calculateDistance(int x1, int y1, int x2, int y2) {
    Point p1 = new Point(x1, y1);  // 不逃逸
    Point p2 = new Point(x2, y2);  // 不逃逸
    return (int) Math.sqrt(
        Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2)
    );
}

// JIT 优化后（栈上分配或标量替换）：
// Point 对象完全消失，x1/y1/x2/y2 直接在栈帧的局部变量表中
```

### 4.2 标量替换

将对象拆散为基本类型标量，完全消除对象分配：

```java
// 原始
Point p = new Point(1, 2);
int sum = p.x + p.y;

// 标量替换后
int x = 1, y = 2;
int sum = x + y;
// Point 对象消失了
```

标量替换比栈上分配更彻底——连栈上的对象都不创建，直接用基本类型变量替代。

### 4.3 锁消除

如果对象不逃逸出方法，不可能被其他线程访问，同步操作可以安全去除：

```java
// JIT 发现 sb 不会逃逸
public String concat(String[] parts) {
    StringBuilder sb = new StringBuilder();  // 局部变量，不逃逸
    for (String part : parts) {
        sb.append(part);  // synchronized 块被消除
    }
    return sb.toString();
}
```

`StringBuilder.append()` 内部有 `synchronized`，但 JIT 通过逃逸分析发现 `sb` 不会逃逸出方法，不可能被其他线程访问，因此安全地消除了锁。

### 4.4 逃逸分析的局限

- 逃逸分析本身有开销，不是所有方法都值得分析
- 栈上分配在实际 HotSpot 中实现不完善，更多依赖标量替换
- `-XX:+DoEscapeAnalysis` 默认开启，`-XX:+EliminateAllocations` 默认开启

## 5. 循环优化

JIT 对循环有多种优化手段：

### 5.1 循环展开（Loop Unrolling）

减少循环判断次数，增加每次迭代的工作量：

```java
// 原始
for (int i = 0; i < 4; i++) {
    sum += arr[i];
}

// 展开 4 次
sum += arr[0];
sum += arr[1];
sum += arr[2];
sum += arr[3];
```

循环展开减少了分支判断和循环计数器的开销。JIT 会根据 profiling 数据判断循环次数是否为常数或倍数，决定是否展开。

### 5.2 循环不变量外提（Loop-Invariant Code Motion）

将循环内不变的计算移到循环外：

```java
// 原始
for (int i = 0; i < n; i++) {
    result += arr[i] * Math.PI;  // Math.PI 每次都计算
}

// 优化后
double pi = Math.PI;  // 外提
for (int i = 0; i < n; i++) {
    result += arr[i] * pi;
}
```

### 5.3 向量化（SIMD）

JIT 可以将标量运算替换为 SIMD 指令（如 SSE/AVX），一次处理多个数据：

```java
// 原始：逐个相加
for (int i = 0; i < arr.length; i++) {
    result[i] = a[i] + b[i];
}

// SIMD 优化：一条指令处理 4 个 int（128 位 SSE）
// 一条指令处理 8 个 int（256 位 AVX）
```

向量化需要满足条件：循环体简单、数据对齐、没有循环依赖。

### 5.4 如何验证是否被向量化

JIT 编译日志可以告诉你是否做了向量化：

```bash
# 开启编译日志
-XX:+PrintCompilation
-XX:+UnlockDiagnosticVMOptions
-XX:+LogCompilation
-XX:LogFile=jit.log

# 在日志中搜索 "vector" 或 "SuperWord"
```

更直观的方式是使用 JMH 的 `perfasm` 集成，查看编译后的机器码：

```bash
# 使用 JMH 查看生成的汇编指令
java -jar benchmarks.jar -prof perfasm
```

在输出中搜索 `vmovdqu`（SSE）或 `vmovdqa`（AVX）等 SIMD 指令，确认循环是否被向量化。如果看到标量的 `add`/`mov` 指令而非 SIMD 指令，说明向量化失败——检查循环体是否有数据依赖或方法调用。

## 6. 去优化（Deoptimization）

JVM 有时会"倒退"回解释执行。这是自适应优化的核心机制。

### 6.1 什么时候触发去优化

| 场景 | 原因 |
|------|------|
| 新类加载 | 编译时假设只有一个实现，新实现类加载后假设失效 |
| 类的反初始化 | 类被卸载 |
| 逆优化标志 | 编译代码中嵌入了逆优化检查点 |
| profiling 失效 | 实际执行路径与编译时假设不符 |

### 6.2 去优化的过程

```text
C2 编译（假设只有 1 个实现）
      ↓ 新的实现类被加载
假设失效 → 去优化 → 回到解释执行
      ↓ 重新 profiling
C2 重新编译（考虑多个实现）
```

### 6.3 示例：接口去虚化失败

```java
interface Parser {
    String parse(String input);
}

// 第一阶段：只有 JsonParser 一个实现
Parser parser = getParser();  // JIT 内联 JsonParser.parse()
parser.parse(data);

// 第二阶段：加载了 XmlParser
// → 去优化，回退到解释执行
// → 重新 profiling
// → C2 编译，使用分支预测处理两种实现
```

### 6.4 去优化不是错误

去优化是 JVM 自适应优化的一部分——它不是错误，而是 JVM 根据运行时信息动态调整策略的机制。

```bash
# 观察去优化事件
-Xlog:compilation*=info
# 或使用 JFR 录制 Deoptimization 事件
```

## 7. JIT 相关的生产问题

JIT 在生产环境中可能引发三类隐蔽问题：

### 7.1 问题一：CodeCache 满

JIT 编译的机器码存储在 CodeCache 中（[第二章](./chapter-02-memory-model) 2.4 节）。如果 CodeCache 满了（默认 240MB~480MB），JVM 会停止 JIT 编译，所有代码退回解释执行。

**症状：** 服务运行一段时间后突然变慢，没有 OOM、没有 GC 问题、CPU 使用率正常——但响应时间骤增。

**排查：**

```bash
# 检查 CodeCache 使用情况
jstat -compiler <pid>

# 或通过 JFR 观察 Compilation 事件
# 如果看到 "CodeCache is full" 日志 → 确认是 CodeCache 问题
```

**修复：** 增大 `-XX:ReservedCodeCacheSize`（如 512MB），或检查是否有大量动态生成的代码（如 Groovy 脚本、反射代理）。

### 7.2 问题二：编译线程占用 CPU

JIT 编译在后台线程中执行。当大量方法同时达到编译阈值时（如服务刚启动后的预热阶段），编译线程可能占用显著的 CPU 资源。

**症状：** 服务启动后前几分钟 CPU 使用率偏高，之后恢复正常。

**通常不需要处理**——这是正常的预热行为。如果影响启动速度，可以通过 `-XX:+TieredCompilation -XX:TieredStopAtLevel=1` 先只做 C1 编译（快速），等服务稳定后再允许 C2 编译。

### 7.3 问题三：逆优化风暴

当大量类同时被加载（如应用部署后初始化、热部署），之前编译的代码可能批量去优化。去优化后代码退回解释执行，需要重新 profiling 和编译。

**症状：** 部署后短暂的性能抖动（1~3 分钟），之后恢复正常。

**排查：** 观察 `-Xlog:compilation*=info` 中的 `made not compilable` 和 `deoptimization` 事件数量。

## 8. 实战：观察 JIT 编译

### 8.1 打印编译日志

```bash
# 打印编译信息
-XX:+PrintCompilation

# 输出示例:
#   76   1       3       java.lang.String::hashCode (55 bytes)
#   78   2       4       java.lang.String::hashCode (55 bytes)
#   79   3       3       java.lang.String::charAt (29 bytes)
# 含义：编译ID 编译次数 编译层级(3=C1,4=C2) 方法名 (字节码大小)
```

### 8.2 使用 JITWatch 可视化

JITWatch 是一个 JIT 编译日志分析工具，可以查看哪些方法被内联、哪些被编译、编译后的机器码。

```bash
# 1. 开启编译日志
-XX:+UnlockDiagnosticVMOptions
-XX:+TraceClassLoading
-XX:+LogCompilation
-XX:LogFile=jit.log

# 2. 使用 JITWatch 分析 jit.log
```

### 8.3 使用 JFR 观察 JIT 事件

```bash
jcmd <pid> JFR.start settings=profile filename=jit.jfr duration=60s
```

JFR 中的 JIT 相关事件：
- `CompilerCompilation`：方法被编译
- `CompilerInlining`：方法被内联
- `Deoptimization`：去优化事件

> 本章解释了 Java 为什么越跑越快。下一章将所有 JVM 理论落地为实战——线上问题排查与诊断。
