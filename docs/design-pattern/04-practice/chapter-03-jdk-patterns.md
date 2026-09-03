# JDK 中的设计模式

> **一句话记忆口诀**：JDK 是设计模式的教科书，IO 流是装饰器、Collection 是迭代器、Comparator 是策略、Runtime 是单例。

## 1. 创建型模式在 JDK 中

### 1.1 单例模式：Runtime

```java
// JDK 最经典的单例：Runtime
Runtime runtime = Runtime.getRuntime(); // 全局唯一实例
runtime.exec("notepad.exe");

// 实现方式：饿汉式
public class Runtime {
    private static final Runtime currentRuntime = new Runtime();
    public static Runtime getRuntime() { return currentRuntime; }
    private Runtime() {} // 私有构造
}
```

### 1.2 工厂模式：Calendar / NumberFormat

```java
// Calendar：简单工厂 + 工厂方法
Calendar cal = Calendar.getInstance();        // 简单工厂
Calendar cal2 = Calendar.getInstance(Locale.CHINA); // 不同地区不同实现

// NumberFormat：工厂方法
NumberFormat nf = NumberFormat.getCurrencyInstance();  // 货币格式
NumberFormat pf = NumberFormat.getPercentInstance();   // 百分比格式

// 底层根据参数创建不同的具体实现，客户端不需要知道具体类
```

### 1.3 建造者模式：StringBuilder / Stream.Builder

```java
// StringBuilder：链式构建字符串
String result = new StringBuilder()
    .append("Hello")
    .append(" ")
    .append("World")
    .toString();

// Stream.Builder：构建流
Stream<String> stream = Stream.<String>builder()
    .add("a")
    .add("b")
    .add("c")
    .build();
```

### 1.4 原型模式：clone()

```java
// ArrayList 的 clone
List<String> original = new ArrayList<>(Arrays.asList("a", "b", "c"));
List<String> copy = ((ArrayList<String>) original).clone(); // 浅拷贝

// 注意：clone 是浅拷贝，List 中的元素不会被复制
// 如果元素是可变对象，修改 copy 中的元素会影响 original
```

## 2. 结构型模式在 JDK 中

### 2.1 适配器模式：InputStreamReader

```java
// InputStreamReader 将字节流适配为字符流
// InputStream（字节流接口） → Reader（字符流接口）
InputStream is = new FileInputStream("data.txt");
Reader reader = new InputStreamReader(is, "UTF-8"); // 适配器

// Arrays.asList() 将数组适配为 List
String[] array = {"a", "b", "c"};
List<String> list = Arrays.asList(array); // 数组 → List 适配器
```

### 2.2 装饰器模式：IO 流（最经典！）

```java
// IO 流是装饰器模式的教科书实现
// 基础流：FileInputStream（读文件）
// 装饰器1：BufferedInputStream（加缓冲）
// 装饰器2：DataInputStream（加基本类型读取）

InputStream is = new DataInputStream(         // 装饰器2
                    new BufferedInputStream(   // 装饰器1
                        new FileInputStream("data.bin"))); // 基础组件

// 每层装饰器添加新功能，对调用方透明
// BufferedInputStream：添加 8KB 缓冲区，减少 IO 次数
// DataInputStream：添加 readInt()、readDouble() 等方法

// 经典结构：
// InputStream（抽象组件）
// ├── FileInputStream（具体组件）
// ├── ByteArrayInputStream（具体组件）
// └── FilterInputStream（抽象装饰器）
//     ├── BufferedInputStream（具体装饰器：缓冲）
//     ├── DataInputStream（具体装饰器：基本类型）
//     └── PushbackInputStream（具体装饰器：回退）
```

### 2.3 代理模式：Proxy / InvocationHandler

```java
// JDK 动态代理
Subject real = new RealSubject();
Subject proxy = (Subject) Proxy.newProxyInstance(
    real.getClass().getClassLoader(),
    new Class[]{Subject.class},
    (obj, method, args) -> {
        System.out.println("前置处理");
        Object result = method.invoke(real, args);
        System.out.println("后置处理");
        return result;
    }
);
proxy.request(); // 调用代理方法
```

### 2.4 组合模式：Container / Component

```java
// AWT/Swing 的组件树
// Component 是抽象组件
// Container 是容器（可以包含其他 Component）
// Button、Label 是叶子节点

JFrame frame = new JFrame();          // 容器
JPanel panel = new JPanel();           // 容器
JButton button = new JButton("Click"); // 叶子
panel.add(button);                     // 容器包含叶子
frame.add(panel);                      // 容器包含容器

// 递归操作：frame.setVisible(true) 会递归设置所有子组件
```

### 2.5 享元模式：String 常量池 / IntegerCache

```java
// String 常量池：相同字面量共享同一对象
String a = "hello";
String b = "hello";
System.out.println(a == b); // true，同一个对象！

// Integer 缓存：-128~127 范围内共享
Integer x = 127;
Integer y = 127;
System.out.println(x == y); // true，享元缓存！

Integer m = 128;
Integer n = 128;
System.out.println(m == n); // false，超出缓存范围
```

## 3. 行为型模式在 JDK 中

### 3.1 策略模式：Comparator

```java
// Comparator 是策略模式的经典实现
// 不同的排序策略
List<String> names = Arrays.asList("Charlie", "Alice", "Bob");

// 策略1：按字母排序
names.sort(String::compareTo);

// 策略2：按长度排序
names.sort(Comparator.comparingInt(String::length));

// 策略3：按长度降序
names.sort(Comparator.comparingInt(String::length).reversed());

// 策略4：自定义策略
names.sort((a2, b) -> a2.substring(0, 1).compareTo(b.substring(0, 1)));
```

### 3.2 观察者模式：Observable（已废弃）

```java
// JDK 1.0 的 Observable（JDK 9 废弃，推荐用 Spring Event 或 RxJava）
@Deprecated
public class Observable {
    private Vector<Observer> observers = new Vector<>();
    public void addObserver(Observer o) { observers.add(o); }
    public void notifyObservers() { /* 遍历通知 */ }
}

// 更好的替代：PropertyChangeListener
bean.addPropertyChangeListener("name", evt -> {
    System.out.println("name 变化: " + evt.getOldValue() + " → " + evt.getNewValue());
});
```

### 3.3 模板方法模式：AbstractList / HttpServlet

```java
// AbstractList：定义 List 的骨架，子类实现 get() 和 size()
public abstract class AbstractList<E> implements List<E> {
    // 模板方法：contains() 在 AbstractList 中实现
    public boolean contains(Object o) {
        Iterator<E> it = iterator();
        while (it.hasNext()) {
            if (Objects.equals(it.next(), o)) return true;
        }
        return false;
    }

    // 抽象方法：子类必须实现
    public abstract E get(int index);
    public abstract int size();
}

// ArrayList 实现 get() 和 size()，其他方法从 AbstractList 继承
```

### 3.4 迭代器模式：Iterator / Iterable

```java
// 所有集合都实现了 Iterable，支持 for-each
List<String> list = Arrays.asList("a", "b", "c");
for (String s : list) { // 编译后使用 Iterator
    System.out.println(s);
}

// 编译器将 for-each 转换为：
Iterator<String> it = list.iterator();
while (it.hasNext()) {
    String s = it.next();
    System.out.println(s);
}
```

### 3.5 责任链模式：FilterChain

```java
// Servlet FilterChain 是责任链的经典实现
public interface Filter {
    void doFilter(ServletRequest req, ServletResponse resp, FilterChain chain);
}

// 每个 Filter 决定是否调用 chain.doFilter() 继续传递
public class AuthFilter implements Filter {
    public void doFilter(ServletRequest req, ServletResponse resp, FilterChain chain) {
        if (!isAuthenticated(req)) {
            ((HttpServletResponse) resp).sendError(401);
            return; // 不调用 chain.doFilter()，终止链
        }
        chain.doFilter(req, resp); // 认证通过，继续传递
    }
}
```

### 3.6 命令模式：Runnable / Callable

```java
// Runnable 和 Callable 是命令模式的实现
// 将任务封装为对象，提交给线程池执行

Runnable command = () -> System.out.println("执行任务");
ExecutorService pool = Executors.newFixedThreadPool(4);
pool.submit(command); // 命令排队执行

// Swing Action 也是命令模式
Action action = new AbstractAction("Click") {
    public void actionPerformed(ActionEvent e) {
        System.out.println("按钮被点击");
    }
};
```

## 4. 速查表：JDK 类与设计模式对应

| JDK 类/接口 | 设计模式 | 说明 |
| :-- | :-- | :-- |
| `Runtime.getRuntime()` | 单例 | 全局唯一运行时实例 |
| `Calendar.getInstance()` | 工厂 | 根据地区创建不同实现 |
| `StringBuilder` | 建造者 | 链式构建字符串 |
| `Object.clone()` | 原型 | 克隆对象 |
| `InputStreamReader` | 适配器 | 字节流 → 字符流 |
| `BufferedInputStream` | 装饰器 | 为 InputStream 添加缓冲 |
| `java.lang.reflect.Proxy` | 代理 | JDK 动态代理 |
| `Arrays.asList()` | 适配器 | 数组 → List |
| `String` 常量池 | 享元 | 相同字面量共享对象 |
| `Comparator` | 策略 | 排序策略可替换 |
| `AbstractList` | 模板方法 | 骨架实现 |
| `Iterator` | 迭代器 | 统一遍历接口 |
| `FilterChain` | 责任链 | 请求过滤链 |
| `Runnable` | 命令 | 任务封装 |
| `Observable` | 观察者 | 状态变化通知（已废弃） |
| `Pattern`/`Matcher` | 解释器 | 正则表达式解析 |

## 5. 面试高频问题

**Q：JDK 中哪些地方用了装饰器模式？**

> IO 流是最经典的例子。`FilterInputStream` 是抽象装饰器，`BufferedInputStream`、`DataInputStream` 等是具体装饰器，它们包装 `FileInputStream` 等基础流，层层叠加功能。`Collections.synchronizedList()` 和 `Collections.unmodifiableList()` 也是装饰器，为 List 添加线程安全和不可变特性。

**Q：JDK 中哪些地方用了策略模式？**

> `Comparator` 是最典型的策略模式。不同的比较策略（按字母、按长度、按自定义规则）可以自由切换。`ThreadPoolExecutor` 的拒绝策略（`AbortPolicy`、`CallerRunsPolicy` 等）也是策略模式。`TreeMap` 的排序策略通过构造函数注入。

**Q：为什么 String `"abc" == "abc"` 为 true？**

> 这是享元模式。JVM 维护一个字符串常量池，相同字面量的字符串只创建一个对象，后续引用直接返回池中的对象。所以 `==` 比较的是同一个引用。但 `new String("abc")` 会创建新对象，不在池中，所以 `new String("abc") == "abc"` 为 false。

> **一句话记忆口诀**：JDK 处处是设计模式——IO 流是装饰器、Comparator 是策略、Iterator 是迭代器、Runtime 是单例、Proxy 是代理、Calendar 是工厂。
