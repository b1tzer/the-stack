# 字节码与类加载

> `ServiceLoader.load(Driver.class)` 找 JDBC 驱动——这行代码背后藏了 JVM 最经典的设计冲突。驱动在 classpath 里，但 `ServiceLoader` 用的是 `Thread Context ClassLoader`，而双亲委派要求先问父加载器——结果：核心库 `rt.jar` 里的代码找不到应用路径下的 jar。SPI 打破了双亲委派，不是设计缺陷，是权衡。本章从「为什么需要字节码」到「双亲委派何时该打破」，建立"源码 → 字节码 → JVM"的完整认知。

## 1. 为什么需要字节码

Java 不像 C/C++ 那样直接编译成机器码，而是编译成一种中间格式——字节码（Bytecode），存储在 `.class` 文件中。

### 1.1 三个核心原因

**1. 平台无关。** 同一份 `.class` 文件可以在 Windows、Linux、macOS 的 JVM 上运行。JVM 屏蔽了操作系统的差异。

**2. 运行时优化。** JVM 可以在运行时根据实际执行情况做 JIT 优化——哪些代码最热、哪些分支最常走、哪些对象可以栈上分配。这些信息在编译时无法获得，只有运行时才知道。

**3. 语言生态统一。** Kotlin、Scala、Groovy 等语言都编译到同一套字节码格式。它们共享 JVM 生态——同一个库，Java 写的可以被 Kotlin 调用，Scala 写的可以被 Java 调用。

```text
C/C++：  Source → Machine Code → 只能在特定平台
Java：   Source → Bytecode → JVM → Machine Code → 任何平台
Kotlin： Source → Bytecode → JVM → Machine Code → 任何平台
```

字节码这一层抽象，是 Java 跨平台能力和运行时优化能力的根基。

## 2. Class 文件结构概览

一个 `.class` 文件的结构：

```text
ClassFile {
    u4             magic;              // 魔数：0xCAFEBABE
    u2             minor_version;
    u2             major_version;      // JDK 版本（52=JDK 8, 61=JDK 17）
    u2             constant_pool_count;
    cp_info        constant_pool[...]; // 常量池
    u2             access_flags;       // public / abstract / final 等
    u2             this_class;         // 本类的常量池索引
    u2             super_class;        // 父类的常量池索引
    u2             interfaces_count;
    u2             interfaces[...];    // 实现的接口
    u2             fields_count;
    field_info     fields[...];        // 字段定义
    u2             methods_count;
    method_info    methods[...];       // 方法定义（含字节码指令）
    u2             attributes_count;
    attribute_info attributes[...];    // 属性表
}
```

不需要记住每个字段的偏移量，理解三个核心概念就够了：

### 2.1 常量池（Constant Pool）

常量池是 Class 文件的"信息仓库"——类名、方法名、字段名、字符串字面量、方法描述符都存在这里。

| 常量类型 | 存储内容 | 示例 |
|---------|---------|------|
| CONSTANT_Utf8 | 字符串字面量 | 类名、方法名 |
| CONSTANT_Class | 类或接口的符号引用 | `java/lang/Object` |
| CONSTANT_Methodref | 方法的符号引用 | `println:(Ljava/lang/String;)V` |
| CONSTANT_Fieldref | 字段的符号引用 | `System.out` |

为什么不直接在各处保存字符串？因为常量池通过索引引用，避免重复存储，减小文件体积。

### 2.2 方法表（Methods）

每个方法包含：访问标志、方法名、描述符、属性表。方法的**字节码指令**存储在 `Code` 属性中：

```text
method_info {
    access_flags
    name_index          → 常量池中的方法名
    descriptor_index    → 常量池中的描述符（参数类型和返回类型）
    attributes[] {
        Code {
            max_stack       ← 操作数栈最大深度
            max_locals      ← 局部变量表大小
            code[]          ← 字节码指令数组
            exception_table ← 异常处理表
        }
    }
}
```

### 2.3 属性表（Attributes）

属性表是可扩展的元数据容器。注解存储在 `RuntimeVisibleAnnotations` 中，泛型签名存储在 `Signature` 中，Lambda 信息通过 `BootstrapMethods` 存储。第一卷讲的泛型、注解、Lambda，在 Class 文件中都有对应的存储位置。

## 3. 字节码指令分类认知

JVM 字节码指令约 200 条，不需要全部记住，建立分类认知即可：

### 3.1 加载与存储

将数据在局部变量表和操作数栈之间移动：

```java
int a = 10;        // bipush 10 → istore_1（将 10 压入栈，存到局部变量 1）
int b = a + 20;    // iload_1 → bipush 20 → iadd → istore_2
```

### 3.2 算术运算

`iadd`（int 加）、`lsub`（long 减）、`imul`（int 乘）等。基本类型的算术运算直接映射为字节码指令。

### 3.3 对象操作

```java
User user = new User();     // new User → dup → invokespecial <init>
user.name = "Tom";          // aload_1 → ldc "Tom" → putfield name
String name = user.getName(); // aload_1 → invokevirtual getName
```

### 3.4 方法调用（最重要）

| 指令 | 用途 | 场景 |
|------|------|------|
| `invokevirtual` | 普通实例方法调用 | `user.getName()` |
| `invokestatic` | 静态方法调用 | `Math.max(1, 2)` |
| `invokeinterface` | 接口方法调用 | `list.add(x)` |
| `invokespecial` | 构造方法、private 方法、super 调用 | `new User()` |
| `invokedynamic` | 动态绑定（Lambda、方法引用） | `x -> x + 1` |

`invokevirtual` 是多态的基础——JVM 在运行时根据对象的实际类型查找方法表，决定调用哪个方法。`invokedynamic` 是 Lambda 的基础——第一卷已经讲过，LambdaMetafactory 在运行时生成实现类。

### 3.5 为什么需要五种 invoke？

核心原因：**不同调用方式的查找成本不同。**

| 指令 | 查找方式 | 为什么这样设计 |
|------|---------|---------------|
| `invokevirtual` | 查虚方法表（vtable），固定偏移 | 类的方法表在加载时就确定了，偏移量可缓存 |
| `invokeinterface` | 线性搜索接口方法表（itable） | 接口的方法表位置不固定，无法用偏移量直接定位 |
| `invokespecial` | 编译期直接定位，不走多态 | 构造器、`private` 方法、`super` 调用——目标在编译时已知 |
| `invokestatic` | 编译期直接定位 | 静态方法不存在多态，最简单 |
| `invokedynamic` | 首次执行时绑定，之后可变 | Lambda 和方法引用——调用点在运行时才确定 |

这个差异有实际后果：`invokeinterface` 比 `invokevirtual` 慢，因为接口方法在 itable 中没有固定偏移，每次调用都需要搜索。这也是为什么 JIT 编译器对**接口调用的内联比虚调用更难**——[第五章](./chapter-05-jit)讲方法内联时会回扣这个点。

## 4. 字节码与语言特性的映射

第一卷讲的每个语言特性，在字节码层面都有对应：

| 语言特性 | 字节码层面的体现 |
|---------|---------------|
| 泛型擦除 | `Signature` 属性保留泛型信息，方法体中插入 `checkcast` |
| Lambda | `invokedynamic` + `BootstrapMethods` 属性 |
| 注解 | `RuntimeVisibleAnnotations` / `RuntimeInvisibleAnnotations` 属性 |
| 内部类 | 生成独立的 `Outer$Inner.class` 文件 |
| try-with-resources | 编译器自动在 finally 中插入 `close()` 调用 |
| 自动装箱 | 编译器插入 `Integer.valueOf()` 调用 |

理解这些映射关系，能帮你理解"Java 代码到底变成了什么"，也为后续的字节码增强（ASM、CGLIB、Spring AOP）打下基础。

### 4.1 从字节码视角回看语言特性

表格列出了"是什么"，但更重要的是"这意味着什么"。挑三个展开：

**泛型擦除的字节码证据**

第一卷讲过，`List<String>` 和 `List<Integer>` 编译后是同一个类。字节码层面怎么体现？

```java
// 源码
public void process(List<String> list) { }
public void process(List<Integer> list) { }  // 编译报错！
```

编译后，两个方法的描述符完全相同：`(Ljava/util/List;)V`。`Signature` 属性中保留了泛型信息供反射使用，但方法体中的类型检查是通过编译器插入的 `checkcast` 指令实现的：

```text
// List<String>.get(0) 编译后
invokeinterface List.get:(I)Ljava/lang/Object;
checkcast java/lang/String    // 编译器插入的类型检查
```

这也解释了为什么泛型不能用于基本类型——`checkcast` 只能检查引用类型，`List<int>` 无处可 cast。

**Lambda 不是语法糖的字节码证据**

第一卷论证过"Lambda 不是匿名内部类的语法糖"，字节码是终极证据：

```java
// 匿名内部类 → 编译生成 Outer$1.class（独立的类文件）
Runnable r1 = new Runnable() { public void run() { } };

// Lambda → 只生成一条 invokedynamic 指令
Runnable r2 = () -> { };
```

Lambda 编译后**不生成额外的类文件**。它在字节码中只是一条 `invokedynamic` 指令，指向 `BootstrapMethods` 属性中的 `LambdaMetafactory`。真正的实现类在**首次调用时**由 `LambdaMetafactory` 在内存中动态生成。这就是 Lambda 比匿名内部类轻量的根源——无额外类文件、无额外类加载、首次调用后直接绑定。

**try-with-resources 的异常抑制**

编译器在 finally 中插入的不只是 `close()` 调用，还有异常抑制逻辑：

```java
// 源码
try (InputStream in = new FileInputStream(f)) {
    // 业务逻辑
}
```

编译后的字节码会捕获 `close()` 抛出的异常，并通过 `Throwable.addSuppressed()` 附加到主异常上，而不是吞掉或覆盖。这就是为什么 `try-with-resources` 的异常信息中能看到 `Suppressed:` 标记。

## 5. 类加载的完整生命周期

`.class` 文件不会自动进入 JVM，需要由 ClassLoader 加载。类的生命周期分为七个阶段：

```text
加载（Loading）
  → 验证（Verification）
  → 准备（Preparation）
  → 解析（Resolution）
  → 初始化（Initialization）
  → 使用（Using）
  → 卸载（Unloading）
```

其中验证、准备、解析合称**连接（Linking）**。

### 5.1 各阶段做了什么

| 阶段 | 做了什么 | 为什么要在这步做 |
|------|---------|----------------|
| 加载 | 通过全限定名获取字节流，生成 `Class` 对象 | 将外部字节码转为 JVM 可操作的形式 |
| 验证 | 文件格式、元数据、字节码、符号引用验证 | 防止恶意字节码破坏 JVM |
| 准备 | 为静态变量分配内存并赋零值 | 保证字段在未显式赋值前有默认值 |
| 解析 | 符号引用 → 直接引用 | 将常量池中的符号转为内存中的实际地址 |
| 初始化 | 执行 `<clinit>`（类构造器），真正赋值静态变量 | 保证静态代码块在类首次主动使用时执行 |

### 5.2 符号引用 vs 直接引用

表格中"符号引用 → 直接引用"是最抽象的一行，用一个例子说清楚：

```text
// 编译时：常量池中存储的是符号引用（字符串描述）
CONSTANT_Methodref #15 = #16.#17
  #16 = java/io/PrintStream          // 类名
  #17 = println:(Ljava/lang/String;)V // 方法名 + 描述符

// 运行时解析后：替换成直接引用（内存地址）
// PrintStream 类已加载，println 方法在方法表第 3 个槽位
// 直接引用 = 方法表偏移量 #3（一个数字，可以直接定位）
```

符号引用是**文本描述**（类名、方法名、描述符），直接引用是**内存地址**（偏移量或指针）。解析的本质是把"按名字找人"变成"直接看工位号"。

解析可以在两个时机发生：

- **静态解析**：类加载时就解析。适用于编译期能确定目标的方法——`invokestatic`、`invokespecial`、`final` 方法。
- **动态解析**：第一次调用时才解析。适用于多态方法——`invokevirtual`、`invokeinterface`，因为实际目标取决于运行时对象类型。`invokedynamic` 更极端：每次调用都可能重新解析。

### 5.3 什么时候触发初始化

不是加载就初始化。只有"主动使用"才会触发：

```java
// 触发初始化的场景
new User();                    // new 实例
User.class;                    // 访问类的 Class 对象（JDK 11+）
Class.forName("com.User");    // 反射加载
User.main(args);              // 调用 main 方法

// 不触发初始化的场景
User.class.getName();          // 只引用类名，不触发
User[] arr = new User[10];    // 创建数组，不触发数组元素类的初始化
```

## 6. 双亲委派模型

### 6.1 ClassLoader 的层次结构

```text
Bootstrap ClassLoader（引导类加载器）
  └─ 加载 rt.jar（java.lang.String、java.util.List 等核心类）
  └─ C++ 实现，JVM 内置

Platform ClassLoader（平台类加载器，JDK 9+）
  └─ 替代 JDK 8 的 Extension ClassLoader
  └─ 加载扩展库

Application ClassLoader（应用类加载器）
  └─ 加载 classpath 下的用户代码

自定义 ClassLoader
  └─ 用户自己实现的加载器
```

### 6.2 为什么要向上委托

当一个 ClassLoader 收到加载请求时，它不会自己先加载，而是**先委托给父加载器**。只有父加载器无法加载时，才自己尝试。

```text
Application ClassLoader 收到请求"加载 java.lang.String"
  → 委托给 Platform ClassLoader
    → 委托给 Bootstrap ClassLoader
      → Bootstrap 能加载 → 返回
```

用伪代码表示这个过程，核心在 `ClassLoader.loadClass()` 方法：

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

四步：查缓存 → 委托父加载器 → 父加载器找不到 → 自己加载。这就是双亲委派的全部机制。后面"打破双亲委派"的本质，就是重写 `loadClass()` 方法，跳过或改变第 2 步的委托顺序。

三个核心价值：

**1. 安全。** 用户无法定义一个 `java.lang.String` 来替换核心库的实现。因为加载请求会先到达 Bootstrap ClassLoader，它会加载核心库的版本。

**2. 避免重复加载。** 同一个类只会被加载一次。

**3. 层次化信任。** 核心库（Bootstrap）→ 扩展库（Platform）→ 应用代码（Application），逐级信任。

## 7. 打破双亲委派

并非所有场景都适合向上委托。三个典型案例：

### 7.1 SPI（Service Provider Interface）

JDBC 的 `DriverManager` 在核心库中（Bootstrap ClassLoader 加载），但它需要加载用户提供的数据库驱动（如 `mysql-connector-java`）。核心库无法向下委托给应用类加载器。

解决方案：**线程上下文类加载器（Thread Context ClassLoader）**。

```java
// DriverManager 的核心逻辑
ClassLoader cl = Thread.currentThread().getContextClassLoader();
ServiceLoader<Driver> loadedDrivers = ServiceLoader.load(Driver.class, cl);
```

`Thread.currentThread().getContextClassLoader()` 默认是 Application ClassLoader，核心库通过它"借"应用类加载器来加载驱动。

### 7.2 Tomcat

Tomcat 需要在同一个 JVM 中运行多个 Web 应用，每个应用可能依赖同一个库的不同版本。

解决方案：每个 Web 应用使用独立的 `WebAppClassLoader`，加载顺序与标准双亲委派**相反**：

```text
WebAppClassLoader 加载顺序：
  1. 自己的 /WEB-INF/classes 和 /WEB-INF/lib（优先自己）
  2. 找不到才委托给父加载器
```

标准双亲委派是"先问父亲"，Tomcat 是"先问自己"。这实现了 Web 应用之间的类隔离——App A 用 Guava 28，App B 用 Guava 31，互不干扰。

但隔离有代价：两个 Web 应用中由不同 ClassLoader 加载的同一个类，**类型不兼容**。App A 中 `new Guava()` 创建的对象传给 App B，`instanceof` 会返回 `false`——因为 JVM 认为它们是两个不同的类（全限定名相同但 ClassLoader 不同）。这也是为什么跨应用共享对象需要序列化/反序列化，而不是直接传递引用。

### 7.3 OSGi

OSGi 实现了模块化系统，每个 Bundle（模块）有独立的 ClassLoader。与 Tomcat 的树状结构不同，OSGi 的 ClassLoader 之间是**网状委托关系**：

```text
Bundle A 的 ClassLoader
  ├─ import: org.slf4j（委托给 Bundle B）
  ├─ import: com.google.gson（委托给 Bundle C）
  └─ export: com.mylib.utils（供其他 Bundle 使用）
```

每个 Bundle 通过 `Import-Package` 和 `Export-Package` 声明依赖关系。JVM 同时加载同一个库的多个版本，Bundle 按声明的版本范围解析依赖。这是 Java 模块化的最激进实现，也是后来 Java 9 引入 JPMS（Java Platform Module System）的灵感来源之一。

## 8. 自定义 ClassLoader

### 8.1 核心方法

```java
public class MyClassLoader extends ClassLoader {
    // 方式 1：覆盖 loadClass —— 可以打破双亲委派
    @Override
    public Class<?> loadClass(String name) throws ClassNotFoundException { ... }

    // 方式 2：只覆盖 findClass —— 不打破双亲委派（推荐）
    @Override
    protected Class<?> findClass(String name) throws ClassNotFoundException {
        byte[] bytes = loadClassData(name);  // 从网络/数据库/加密文件读取字节码
        return defineClass(name, bytes, 0, bytes.length);  // 将字节数组转为 Class 对象
    }
}
```

### 8.2 应用场景

- **热部署**：修改代码后，用新的 ClassLoader 重新加载，不需要重启 JVM
- **加密 Class**：Class 文件加密存储，ClassLoader 读取后解密再加载
- **从网络加载**：动态从服务器下载 Class 文件

## 9. 动手：用 javap 看到你代码的字节码

前文讲了这么多字节码概念，不如亲眼看一下。JDK 自带的 `javap` 工具可以反编译 `.class` 文件：

```bash
# 编译一个简单的 Java 文件
javac com/example/Hello.java

# 反编译查看字节码（-v 显示详细信息，-c 显示方法体）
javap -v -c com/example/Hello.class
```

对于这样一段代码：

```java
public class Hello {
    public int add(int a, int b) {
        return a + b;
    }
}
```

`javap -c` 输出：

```text
public int add(int, int);
  Code:
     0: iload_1      // 加载局部变量 1（参数 a）到操作数栈
     1: iload_2      // 加载局部变量 2（参数 b）到操作数栈
     2: iadd         // 弹出两个 int，相加，结果压栈
     3: ireturn      // 返回 int
```

四条指令，和 1.3 节的分类完全对应：`iload`（加载）→ `iadd`（算术）→ `ireturn`（返回）。加上 `-v` 还能看到常量池、`max_stack`、`max_locals` 等元数据。

这个技能在后续章节会反复用到：[第五章](./chapter-05-jit) JIT 编译时看编译器的内联决策，[第六章](./chapter-06-diagnostics)排查时反编译确认线上运行的代码版本。建议现在就试一下。

> 本章建立了"源码 → 字节码 → 类加载"的完整认知。下一章将进入 JVM 运行时数据区——理解堆、栈、方法区的分工与协作，这是一切内存调优和 GC 理解的大前提。
