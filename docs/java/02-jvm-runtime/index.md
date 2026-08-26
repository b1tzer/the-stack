# JVM Runtime

> 回答"一行代码如何被 JVM 执行"。覆盖字节码与类加载、运行时数据区、对象布局、GC、JIT、线上排查。

## 章节

- [字节码与类加载](/java/02-jvm-runtime/chapter-01-bytecode-classloading) — Class 文件结构、字节码指令、双亲委派、打破委派
- [JVM 运行时数据区](/java/02-jvm-runtime/chapter-02-memory-model) — 堆/栈/方法区/Metaspace、栈帧、StringTable
- [对象模型](/java/02-jvm-runtime/chapter-03-object-model) — 对象创建、内存布局、Mark Word、Monitor、TLAB、逃逸分析
- [垃圾回收](/java/02-jvm-runtime/chapter-04-gc) — 可达性分析、四种引用、CMS/G1/ZGC
- [JIT 编译](/java/02-jvm-runtime/chapter-05-jit) — 分层编译、方法内联、逃逸分析优化、去优化
- [线上排查与诊断](/java/02-jvm-runtime/chapter-06-diagnostics) — CPU 100%、Heap Dump、Arthas、JFR、参数速查
