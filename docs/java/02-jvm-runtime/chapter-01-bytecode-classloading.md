# 字节码到 ClassLoader

> 一个 `.java` 文件躺在磁盘上，自己不会运行。`javac` 先把它编译成 `.class`，JVM 再加载、连接并初始化类，最后解释或编译执行方法中的字节码。这条从「磁盘文件」到「运行中程序」的链路，是本文的主线，也是整个 JVM Runtime 的骨架。后面讲运行时数据区、对象模型、GC、JIT，都挂在这条链的某个环节上。

![Java 程序从源码到 CPU 执行的完整链路](/java/jvm-runtime-overview.svg)

## 1. 全景：一条链看懂 JVM Runtime

上图是本专题的总地图，下面五个环节依次回答一个问题：

| 环节 | 产物 | 谁在做 |
| :-- | :-- | :-- |
| `.java` → `.class` | 字节码文件 | `javac` |
| `.class` → 运行时 `Class` | 内存中的类元数据 | ClassLoader + JVM |
| `Class` → 执行 | 方法里的字节码指令 | JVM 解释器 |
| 字节码 → 机器码 | CPU 能执行的指令 | Interpreter / JIT |
| 机器码 → 运行 | 程序的结果 | CPU |

本文只讲前三个环节，最后两个环节属于[第五章 JIT 编译](./chapter-05-jit.md)。但这条链必须一次立完整，否则后面每一章都只是孤立的碎片，读者不知道它们各自挂在哪一环。

### 1.1 为什么中间要多一层字节码

源码不直接编译成机器码，而是先到字节码，这一步换来三样东西。

**平台无关。** `.class` 不针对任何操作系统，同一份文件可以在 Windows、Linux、macOS 的 JVM 上运行。JVM 屏蔽了操作系统之间的差异。

**运行时优化。** 哪些代码最热、哪些分支最常走、哪些对象可以栈上分配，这些信息编译时拿不到，只有运行时才知道。留出字节码这一层，JVM 才能在运行时根据真实执行情况做 JIT 优化。若直接编译成机器码，这些机会就没了。

**语言生态统一。** Kotlin、Scala、Groovy 都编译到同一套字节码，共享同一个 JVM 生态：Java 写的库能被 Kotlin 调用，反过来也行。字节码是这条生态链的公共约定。

## 2. .class 是一份二进制程序描述文件

先纠正一个直觉：`.class` 不是「Java 类」。Java 类是你脑子里的概念，`.class` 是这个概念在磁盘上的序列化结果：一份 JVM 定义的二进制文件，用来描述一个类的全部信息。

它描述的东西很多，但理解三类就够：

### 2.1 常量池：程序引用的信息

一个类要引用别的类、别的字段、别的方法，这些「引用」在 `.class` 里不是直接写地址，而是写成符号，集中放在常量池里。

| 常量类型 | 存的是什么 | 示例 |
| :-- | :-- | :-- |
| `CONSTANT_Utf8` | 字符串 | 类名、方法名 |
| `CONSTANT_Class` | 类/接口的符号引用 | `java/lang/Object` |
| `CONSTANT_Methodref` | 方法的符号引用 | `println:(Ljava/lang/String;)V` |
| `CONSTANT_Fieldref` | 字段的符号引用 | `System.out` |

用索引引用而不在各处重复存字符串，是为了省体积。但常量池真正的意义在 §4.2 才浮现：它存的是**符号引用**，运行时要被替换成**直接引用**。

### 2.2 字段与方法：类的结构

`fields[]` 描述这个类有哪些字段，`methods[]` 描述有哪些方法。每个方法记录访问标志、方法名、描述符（参数和返回类型）。这些是类的骨架。

### 2.3 Code 属性：方法如何执行

方法「声明了什么」和方法「怎么执行」是两回事。骨架在 `methods[]` 里，而方法体的执行逻辑存在一个叫 `Code` 的属性里：

```txt
Code {
    max_stack       ← 操作数栈最大深度
    max_locals      ← 局部变量表大小
    code[]          ← 字节码指令数组
    exception_table ← 异常处理表
}
```

`code[]` 就是真正的字节码指令序列。第一节里讲的 `.class → 执行`，执行的就是这个数组。

> 完整的 ClassFile 结构远不止这些（还有 `magic`、`access_flags`、`attributes` 等），但不需要背。理解「常量池 + 结构 + Code」这三类，就抓住了 `.class` 的本质。要看到完整结构，用 §3.5 的 `javap -v`。

## 3. JVM 是一个栈式虚拟机

`.class` 里的指令，由 JVM 来执行。但 JVM 的执行方式和物理 CPU 完全不同：CPU 用寄存器，JVM 用**操作数栈**。这个差异是理解字节码的钥匙。

### 3.1 执行模型：局部变量表 + 操作数栈

每调用一个方法，JVM 就创建一个**栈帧**，里面有两个关键结构：

- **局部变量表**：存放 `this`、方法参数、方法内的局部变量，按索引访问。
- **操作数栈**：指令操作的工作区。字节码指令不直接操作内存，只和这个栈打交道：需要数据就压栈，运算就从栈顶弹出操作数、把结果压回。

局部变量表是存储，操作数栈是计算。指令在两者之间搬运数据。

### 3.2 完整走一遍 add

拿一个最简单的方法看整个过程：

```java
public class Calculator {
    public int add(int a, int b) {
        return a + b;
    }
}
```

`javap -c` 反编译出四条指令：

```txt
public int add(int, int);
  Code:
     0: iload_1
     1: iload_2
     2: iadd
     3: ireturn
```

调用 `add(3, 5)` 时，栈帧的局部变量表是 `[this, 3, 5]`（`this` 占 0 号位，`a` 占 1 号，`b` 占 2 号），操作数栈初始为空。逐步执行：

```txt
iload_1   把局部变量 1（a=3）压入栈   操作数栈 [] → [3]
iload_2   把局部变量 2（b=5）压入栈   操作数栈 [3] → [3, 5]
iadd      弹出 3 和 5，相加，压回     操作数栈 [3, 5] → [8]
ireturn   弹出 8，作为返回值返回      操作数栈 [8] → 返回 8
```

这就是「栈式虚拟机」的全部含义：**运算都发生在操作数栈上，局部变量表只是存储**。对比寄存器式 CPU，`add(3,5)` 大概是一条指令直接操作两个寄存器；JVM 则是先 `iload` 把值搬上栈，再 `iadd`。多出来的搬运指令，代价是性能，换来的是同一套字节码可以在任何架构上跑：栈模型不需要知道目标机器有几个寄存器。

### 3.3 方法调用：五种 invoke

方法调用是字节码里最重要的指令，五种 `invoke` 各管一类场景：

| 指令 | 用途 | 例子 |
| :-- | :-- | :-- |
| `invokevirtual` | 普通实例方法 | `user.getName()` |
| `invokestatic` | 静态方法 | `Math.max(1, 2)` |
| `invokeinterface` | 接口方法 | `list.add(x)` |
| `invokespecial` | 构造器、private、super | `new User()` |
| `invokedynamic` | 动态绑定（Lambda、方法引用） | `x -> x + 1` |

为什么要分五种而不是一种？因为**不同调用方式的查找成本不一样**：

| 指令 | 查找方式 | 为什么 |
| :-- | :-- | :-- |
| `invokevirtual` | 查虚方法表（vtable），固定偏移 | 方法表加载时就定了，偏移可缓存 |
| `invokeinterface` | 搜索接口方法表（itable） | 接口方法位置不固定，无法用偏移直定位 |
| `invokespecial` | 编译期直接定位 | 构造器、private、super 的目标编译时已知 |
| `invokestatic` | 编译期直接定位 | 静态方法无多态 |
| `invokedynamic` | 首次执行时绑定，之后可变 | 调用点运行时才确定 |

这个差异有实际后果：`invokeinterface` 比 `invokevirtual` 慢，因为接口方法在 itable 里没有固定偏移，每次调用都要搜索。这也是为什么 JIT 对接口调用的内联比虚调用更难。[第五章 JIT](./chapter-05-jit.md)讲方法内联时会回扣这里。

### 3.4 语言特性在字节码里的样子

知道字节码怎么执行后，回头再看[Java 语言核心](../01-java-language/chapter-01-why-java.md)，就能看清“编译器到底把它们变成了什么”。

**泛型擦除的证据。** `List<String>` 和 `List<Integer>` 编译后是同一个类。证据在字节码里：两个方法 `process(List<String>)` 和 `process(List<Integer>)` 的描述符都是 `(Ljava/util/List;)V`，因此重载冲突、编译报错。方法体里，编译器插入 `checkcast` 做运行时类型检查：

```txt
// List<String>.get(0) 编译后
invokeinterface List.get:(I)Ljava/lang/Object;
checkcast java/lang/String    // 编译器插入的类型检查
```

这也解释了泛型为什么不能用于基本类型：`checkcast` 只认引用类型，`List<int>` 无处可 cast。

**Lambda 不是语法糖的证据。** 匿名内部类会生成 `Outer$1.class` 独立文件，Lambda 编译后**不生成任何类文件**，只在字节码里留下一条 `invokedynamic`，指向 `BootstrapMethods` 里的 `LambdaMetafactory`。真正的实现类在首次调用时才由 `LambdaMetafactory` 在内存里生成。这就是 Lambda 比匿名内部类轻量的根源：无额外类文件、无额外类加载。

**try-with-resources 的异常抑制。** 编译器在 finally 里插入的不只是 `close()`，还有异常抑制逻辑：捕获 `close()` 抛出的异常，用 `Throwable.addSuppressed()` 附加到主异常上，而不是吞掉或覆盖。所以 `try-with-resources` 的异常堆栈里能看到 `Suppressed:` 标记。

### 3.5 动手：用 javap 看字节码

概念讲得再多，不如亲眼确认一次。`javap` 是 JDK 自带的字节码反编译工具：

```bash
javac com/example/Calculator.java
javap -c com/example/Calculator.class    # -c 显示方法体，-v 显示全部元数据
```

对 §3.2 的 `add` 方法，`javap -c` 输出的就是那四条指令。加上 `-v` 还能看到 §2 讲的常量池、`max_stack`、`max_locals`。这个工具后面会反复用到：[JIT 编译](./chapter-05-jit.md)解释内联决策，[JVM 线上诊断](../06-diagnostics/01-jvm/chapter-01-jvm-diagnostics.md)用它确认线上运行的代码版本。

## 4. .class 如何进入 JVM

`.class` 是磁盘上的死文件，自己不会进入 JVM。需要有人把它读成字节流、交给 JVM 校验、转成运行时能用的 `Class` 对象。这个「有人」就是 ClassLoader。

「字节码」和「类加载」的关系在这里接上了：**字节码是 `.class` 里的静态内容，类加载是把这些内容带进 JVM、变成运行时 `Class` 的动作。**

### 4.1 五个阶段：从字节流到运行时 Class

ClassLoader 把 `.class` 交进来之后，JVM 还要经过一系列处理，一个类才能被使用：

```txt
Loading（加载）→ Verification（验证）→ Preparation（准备）→ Resolution（解析）→ Initialization（初始化）
```

其中验证、准备、解析合称**连接（Linking）**。

| 阶段 | 做了什么 | 为什么这一步不可省 |
| :-- | :-- | :-- |
| 加载 | 按全限定名读字节流，生成 `Class` 对象 | 把外部字节码变成 JVM 能操作的形式 |
| 验证 | 校验文件格式、元数据、字节码、符号引用 | 挡住恶意或损坏的字节码 |
| 准备 | 为静态变量分配内存并赋零值 | 保证字段在显式赋值前有确定值 |
| 解析 | 符号引用 → 直接引用 | 把常量池里的符号换成内存地址 |
| 初始化 | 执行 `<clinit>`，真正给静态变量赋值 | 静态代码块在首次主动使用时才执行 |

### 4.2 符号引用 → 直接引用 {#resolution}

五个阶段里，「解析」最抽象，也最关键，它就是「静态 `.class`」变成「运行时 `Class`」的具体转换点。

编译时，常量池里存的是**符号引用**，一段文本描述：

```txt
CONSTANT_Methodref #15 = #16.#17
  #16 = java/io/PrintStream
  #17 = println:(Ljava/lang/String;)V
```

运行时解析后，它被替换成**直接引用**，一个内存地址：

```txt
PrintStream 已加载，println 在方法表第 3 个槽位
直接引用 = 方法表偏移量 #3
```

符号引用是「按名字找人」，直接引用是「看工位号」。解析的本质，就是把前者换成后者。

解析有两个时机：

- **静态解析**：类加载时就解析。适用编译期能确定目标的方法：`invokestatic`、`invokespecial`、`final` 方法。
- **动态解析**：首次调用时才解析。适用多态方法：`invokevirtual`、`invokeinterface`，实际目标取决于运行时对象类型。`invokedynamic` 更极端，每次调用都可能重新解析。

### 4.3 什么时候触发初始化

不是加载就初始化。只有「主动使用」才触发：

```java
new User();                          // 创建实例
User.staticMethod();                 // 调用静态方法
int x = User.staticField;            // 读写静态字段（非常量）
Class.forName("com.example.User");   // 反射，默认触发初始化
```

下面的操作**不会**触发：

```java
User.class;                          // class 字面量：只拿 Class 对象，不初始化
User[] arr = new User[10];           // 创建数组：不初始化元素类
int y = User.MAX;                    // 编译期常量（static final 且值可内联）：编译时已替换
```

## 5. 为什么需要 ClassLoader 层级

ClassLoader 的职责是「找到字节码并交给 JVM」。那自然产生一个问题：如果多个 ClassLoader 都能加载同一个类，该由谁负责？

答案是**双亲委派**。

### 5.1 双亲委派：先问父加载器

JVM 的 ClassLoader 是一个层次结构：

```txt
Bootstrap ClassLoader（引导类加载器）
  └─ 加载核心类（java.lang.String 等），C++ 实现，JVM 内置
Platform ClassLoader（平台类加载器，JDK 9+，替代 Extension）
  └─ 加载平台扩展库
Application ClassLoader（应用类加载器）
  └─ 加载 classpath 下的用户代码
自定义 ClassLoader
  └─ 你自己实现的加载器
```

当一个 ClassLoader 收到加载请求，它**不自己先加载，而是先向上委托给父加载器**，父加载器搞不定才自己来。核心逻辑在 `ClassLoader.loadClass()`：

```java
protected Class<?> loadClass(String name, boolean resolve) {
    Class<?> c = findLoadedClass(name);      // 1. 已经加载过？直接返回
    if (c == null) {
        try {
            if (parent != null) {
                c = parent.loadClass(name);   // 2. 委托父加载器
            } else {
                c = findBootstrapClass(name); // 3. 到顶了，找 Bootstrap
            }
        } catch (ClassNotFoundException e) {
            // 父加载器没找到，继续
        }
        if (c == null) {
            c = findClass(name);              // 4. 父加载器搞不定，自己来
        }
    }
    return c;
}
```

四步：查缓存 → 委托父加载器 → 父加载器找不到 → 自己加载。所谓「打破双亲委派」，本质就是重写 `loadClass()`，改变第 2 步的委托顺序。

这套规则换来三样东西：

**安全。** 用户无法定义一个 `java.lang.String` 替换核心库实现，加载请求会先到 Bootstrap，它加载的永远是核心库那个版本。

**避免重复加载。** 同一个类只被加载一次。

**层次化信任。** 核心库 → 平台库 → 应用代码，逐级信任，越靠近根的越不可被应用层篡改。

### 5.2 什么时候必须打破它

双亲委派不是放之四海皆准。三个场景下，「先问父加载器」反而出错。

**SPI：核心库要反向加载应用库。** JDBC 的 `DriverManager` 在核心库（Bootstrap 加载），但它要加载用户放进 classpath 的数据库驱动。核心库的父加载器到 Bootstrap 就停了，够不着应用层的驱动。解法是**线程上下文类加载器**：

```java
ClassLoader cl = Thread.currentThread().getContextClassLoader();
ServiceLoader<Driver> loadedDrivers = ServiceLoader.load(Driver.class, cl);
```

`getContextClassLoader()` 默认返回 Application ClassLoader，核心库借它「向下」加载应用驱动。这是打破双亲委派，不是缺陷，是 SPI 这种「接口在核心、实现在应用」的架构必须付出的权衡。

**Tomcat：一个 JVM 里隔离多个 Web 应用。** 多个应用可能依赖同一个库的不同版本。Tomcat 给每个应用一个 `WebAppClassLoader`，加载顺序和标准双亲委派**相反**：先加载自己的 `/WEB-INF/classes` 和 `/WEB-INF/lib`，找不到才委托父加载器。于是 App A 用 Guava 28、App B 用 Guava 31，互不干扰。

但隔离有代价：两个应用中由不同 ClassLoader 加载的「同一个类」，**类型不兼容**。App A 里 `new Guava()` 的对象传给 App B，`instanceof` 返回 `false`：因为 JVM 认为它们是两个不同的类（全限定名相同、ClassLoader 不同）。所以跨应用共享对象要序列化，而不是直接传引用。

**OSGi：模块化的极端。** 每个 Bundle 有独立 ClassLoader，彼此是**网状委托**而非树状：

```txt
Bundle A 的 ClassLoader
  ├─ import: org.slf4j（委托给 Bundle B）
  ├─ import: com.google.gson（委托给 Bundle C）
  └─ export: com.mylib.utils（供其他 Bundle 使用）
```

每个 Bundle 用 `Import-Package` / `Export-Package` 声明依赖，JVM 同时加载同一个库的多个版本，按版本范围解析。这是 Java 模块化最激进的实现，也是 JDK 9 引入 JPMS 的灵感来源之一。

### 5.3 自定义 ClassLoader 的本质

要扩展加载行为，只需继承 `ClassLoader` 并覆盖一个方法：

```java
public class MyClassLoader extends ClassLoader {
    // 只覆盖 findClass，不打破双亲委派（推荐）
    @Override
    protected Class<?> findClass(String name) throws ClassNotFoundException {
        byte[] bytes = loadClassData(name);   // 从网络 / 数据库 / 加密文件读字节码
        return defineClass(name, bytes, 0, bytes.length);  // 字节数组 → Class 对象
    }
}
```

覆盖 `findClass` 保留双亲委派，覆盖 `loadClass` 则打破它。典型场景：热部署（新 ClassLoader 重新加载，无需重启 JVM）、加密 Class、从网络动态加载。

---

> 本文建立的是「源码 → 字节码 → 运行时 Class → 执行」这条链。下一章进入 JVM 运行时数据区，堆、栈、方法区的分工，理解字节码执行时数据到底放在哪里，这是一切内存调优和 GC 理解的前提。
