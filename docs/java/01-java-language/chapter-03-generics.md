# 泛型

> `List<String>` 运行时不是 `List<String>`——是 `List`。编译器替你做了 `(String) list.get(0)`，但 JVM 不知道你存的到底是什么。类型擦除不是 bug——是 Java 5 在不动字节码格式的前提下、把泛型塞进 Java 1.0 的 class 文件的唯一办法。代价会以各种隐晦的方式让你撞墙：桥接方法、堆污染、`instanceof` 对参数化类型返回 false——这些不是"高级特性"，是你迟早要排查的那种线上问题。

## 1. 为什么需要泛型：从 Object 到类型安全

### 1.1 Java 5 之前的问题

在泛型出现之前，Java 的集合类只能存储 `Object`：

```java
List list = new ArrayList();
list.add("hello");
list.add(123);           // 可以混入任何类型
list.add(new Date());    // 什么都能放

// 读取时必须强制转型
String s = (String) list.get(0);  // OK
String s2 = (String) list.get(1); // ClassCastException！运行时崩溃
```

问题总结：

1. **强制类型转换**：每次从集合取出元素都要强转，代码冗余
2. **运行时错误**：类型错误只能在运行时发现，编译器帮不了你
3. **无法表达类型约束**：`List` 不能表达"这个列表只能放 String"

### 1.2 泛型的解决方案

Java 5 引入泛型后：

```java
List<String> list = new ArrayList<>();
list.add("hello");
list.add(123);           // 编译错误！编译器直接拒绝
```

核心思想：**将类型约束从运行期提前到编译期。** 编译器在编译时就检查类型安全，消除了运行时的 `ClassCastException`。

## 2. 泛型类与泛型方法的定义

理解了"为什么需要泛型"，接下来解决"怎么写"。泛型可以用在类和方法两个层面。

### 2.1 泛型类

在类名后面加类型参数，类内部就可以使用这个类型：

```java
public class Box<T> {
    private T value;

    public Box(T value) {
        this.value = value;
    }

    public T getValue() {
        return value;
    }

    public void setValue(T value) {
        this.value = value;
    }
}

// 使用
Box<String> stringBox = new Box<>("hello");
String s = stringBox.getValue();  // 不需要强制转换

Box<Integer> intBox = new Box<>(42);
Integer i = intBox.getValue();
```

`<T>` 是类型参数，使用时传入具体类型（如 `String`），编译器保证类型安全。

多个类型参数用逗号分隔：

```java
public class Pair<K, V> {
    private K key;
    private V value;

    public Pair(K key, V value) {
        this.key = key;
        this.value = value;
    }
    // getter/setter 省略
}

Pair<String, Integer> entry = new Pair<>("age", 25);
```

### 2.2 泛型方法

方法也可以有自己的类型参数——注意是**方法自己的**类型参数，不是类的：

```java
public class Util {
    // 泛型方法：<T> 声明在返回类型之前
    public static <T> void printArray(T[] array) {
        for (T element : array) {
            System.out.println(element);
        }
    }
}

// 使用：类型推断，不需要显式指定
String[] names = {"Alice", "Bob"};
Util.printArray(names);  // 编译器推断 T = String
```

**类类型参数 vs 方法类型参数的区别**：

```java
public class Box<T> {
    // T 是类的类型参数，所有方法都能用
    private T value;

    // 这个方法用的是类的 T
    public T getValue() { return value; }

    // <U> 是方法自己的类型参数，只有这个方法能用
    public <U> void inspect(U other) {
        System.out.println("T: " + value + ", U: " + other);
    }
}

Box<String> box = new Box<>("hello");
box.inspect(42);  // U 是 Integer，T 是 String，互不影响
```

### 2.3 有界类型参数

类型参数可以加约束，限制传入的类型范围：

```java
// T 必须是 Comparable 的实现类
public static <T extends Comparable<T>> T findMax(T[] array) {
    T max = array[0];
    for (T element : array) {
        if (element.compareTo(max) > 0) {
            max = element;
        }
    }
    return max;
}

Integer[] nums = {3, 1, 4, 1, 5};
Integer max = findMax(nums);  // 5

// findMax(new Object[]{...})  // 编译错误！Object 没有实现 Comparable
```

`<T extends Comparable<T>>` 的含义：T 必须实现 `Comparable<T>` 接口。`extends` 在这里表示"上界"，既可以是类也可以是接口（多个约束用 `&` 连接）：

```java
// 多个约束
public static <T extends Serializable & Comparable<T>> void process(T item) { ... }
```

### 2.4 泛型构造方法

构造方法也可以有自己的类型参数（虽然少见）：

```java
public class Event<T> {
    private T data;

    // 泛型构造方法：方法自己的 <T> 遮蔽了类的 <T>
    public <T> Event(T data) {
        this.data = (T) data;  // 注意：这里的 T 是方法的 T，不是类的 T
    }
}
```

实际上这种情况很少用到，知道即可。

## 3. 泛型与类型系统：为什么 List\<String\> 不是 List\<Object\>

这是很多人理解困难的地方。直觉上，既然 `String` is-a `Object`，那 `List<String>` 应该也是 `List<Object>` 吧？

**不是。** 如果允许：

```java
List<String> strings = new ArrayList<>();
List<Object> objects = strings;   // 假设允许
objects.add(123);                 // 往 String 列表里塞了一个 Integer！
String s = strings.get(1);       // ClassCastException
```

这就是为什么 Java 泛型默认是**不变的（Invariant）**：

```java
List<String> list = new ArrayList<>();  // OK
List<Object> objects = list;            // 编译错误！
```

### 3.1 协变与逆变

Java 通过通配符来实现有限的协变和逆变：

**协变（Covariance）—— `? extends`：**

```java
List<? extends Number> list = new ArrayList<Integer>();  // OK
// list 可以指向 Integer 列表、Double 列表等任何 Number 子类的列表

Number n = list.get(0);   // OK，可以安全读取 Number
list.add(123);            // 编译错误！不能写入
```

为什么不能写入？因为 `list` 可能是 `List<Double>`，往里塞 `Integer` 就出问题了。`? extends` 保证了**读取安全**。

**逆变（Contravariance）—— `? super`：**

```java
List<? super Integer> list = new ArrayList<Number>();  // OK
// list 可以指向 Number 列表、Object 列表等任何 Integer 父类的列表

list.add(123);            // OK，可以安全写入 Integer
Object obj = list.get(0); // OK，但只能读取为 Object
```

为什么读取只能是 `Object`？因为 `list` 可能是 `List<Number>`，取出的元素可能是 `Double`，不能保证是 `Integer`。`? super` 保证了**写入安全**。

## 4. 通配符与 PECS 原则

### 4.1 PECS：Producer Extends, Consumer Super

这是 Java 泛型使用的工程规则，来自 Josh Bloch 的《Effective Java》：

- 如果一个泛型结构**产出**数据（Producer），用 `? extends`
- 如果一个泛型结构**消费**数据（Consumer），用 `? super`

```java
// Producer：从 list 中读取数据
public void printAll(List<? extends Number> list) {
    for (Number n : list) {    // 安全读取为 Number
        System.out.println(n);
    }
}

// Consumer：往 list 中写入数据
public void addIntegers(List<? super Integer> list) {
    list.add(1);    // 安全写入 Integer
    list.add(2);
}
```

### 4.2 无界通配符 `?`

`List<?>` 表示"未知类型的列表"。只能读取（读出来是 `Object`），不能写入（除了 `null`）：

```java
List<?> list = new ArrayList<String>();
Object obj = list.get(0);  // OK
list.add("hello");         // 编译错误
list.add(null);            // OK，null 是任何类型的合法值
```

`?` 适合只读场景，或者你真的不关心元素类型时使用。

## 5. 类型擦除：Java 泛型的核心设计

### 5.1 运行时看不到泛型

这是 Java 泛型最重要的特性，也是最容易让人困惑的特性：

```java
List<String> strings = new ArrayList<>();
List<Integer> integers = new ArrayList<>();

strings.getClass() == integers.getClass()  // true!
```

运行时，`List<String>` 和 `List<Integer>` 是同一个类——泛型信息被"擦除"了。

### 5.2 擦除的机制

编译器在编译时检查泛型类型安全，然后在生成的字节码中**移除泛型类型参数**，替换为它们的上界（通常是 `Object`）：

```java
// 源码
public class Box<T> {
    private T value;
    public T getValue() { return value; }
    public void setValue(T value) { this.value = value; }
}

// 编译后（擦除后）
public class Box {
    private Object value;
    public Object getValue() { return value; }
    public void setValue(Object value) { this.value = value; }
}
```

### 5.3 为什么选择擦除

原因只有一个：**向后兼容**。

Java 5 引入泛型时，已经存在大量用 Java 4（没有泛型）编写的代码和库。JVM 不需要改变，原有的 JVM 可以直接运行带有泛型的新代码——因为字节码中泛型信息已经被擦除了。

这是一个务实但有代价的设计：

```java
// ❌ 不能用基本类型作为泛型参数
List<int> list = new ArrayList<>();  // 编译错误
List<Integer> list = new ArrayList<>();  // 必须用包装类型

// ❌ 不能 new T()
public <T> T create() {
    return new T();  // 编译错误，运行时不知道 T 是什么
}

// ❌ 不能 instanceof 泛型
if (list instanceof List<String>) { }  // 编译错误
```

## 6. 擦除之后：桥接方法、类型转换与字节码

### 6.1 编译器自动插入类型转换

擦除后，编译器在必要的地方自动插入类型转换：

```java
// 源码
String s = list.get(0);

// 编译后实际为
String s = (String) list.get(0);  // 对应字节码 checkcast 指令
```

这就是为什么运行时不会出错——编译器帮你加了强制转换。

### 6.2 桥接方法（Bridge Method）

泛型与继承结合时，编译器会自动生成桥接方法来保证多态正确性：

```java
public interface Container<T> {
    void set(T value);
}

public class StringContainer implements Container<String> {
    @Override
    public void set(String value) { ... }
}
```

擦除后，`Container.set(T)` 变成了 `Container.set(Object)`，但 `StringContainer.set(String)` 参数类型不同——多态失效了。

编译器自动生成一个桥接方法：

```java
// 编译器生成的桥接方法
public class StringContainer implements Container<String> {
    public void set(String value) { ... }

    // 桥接方法：参数类型是 Object，内部转发给 set(String)
    @Override
    public void set(Object value) {
        this.set((String) value);  // 强制转换 + 转发
    }
}
```

### 6.3 Signature 属性

虽然运行时擦除了泛型，但 Class 文件中仍然保留了泛型信息——存储在 `Signature` 属性中。这供反射和框架使用：

```java
// 通过反射获取泛型信息
public class UserRepository extends JpaRepository<User, Long> { }

Type superclass = UserRepository.class.getGenericSuperclass();
ParameterizedType pt = (ParameterizedType) superclass;
Type[] typeArgs = pt.getActualTypeArguments();
// typeArgs[0] = User.class
// typeArgs[1] = Long.class
```

Spring、MyBatis 等框架大量利用这个能力来获取泛型参数。第二卷 Class 文件章节会详细展开 `Signature` 属性的存储结构。

## 7. 泛型的限制与未来

### 7.1 当前限制

**不能使用基本类型：**
```java
List<int> list = new ArrayList<>();     // ❌
List<Integer> list = new ArrayList<>();  // ✅ 但有装箱开销
```

**不能实例化类型参数：**
```java
public <T> T create() {
    return new T();  // ❌
}
```

**运行期类型缺失：**
```java
List<String> a = new ArrayList<>();
List<Integer> b = new ArrayList<>();
// 运行时无法区分 a 和 b 的泛型类型
```

### 7.2 未来方向（Project Valhalla）

Oracle 正在开发的 Project Valhalla 计划解决这些问题：

- **Specialized Generics**：让泛型支持基本类型，`List<int>` 将成为可能
- **Value Types**：消除装箱开销，统一基本类型与引用类型

这些改进将从根本上改变 Java 的类型系统和性能特征，但目前仍在开发中。

## 8. 泛型在框架中的应用

泛型在主流 Java 框架中无处不在：

| 框架 / 场景 | 泛型用法 | 解决的问题 |
|-------------|----------|-----------|
| 集合框架 | `List<T>`、`Map<K,V>` | 类型安全的容器 |
| Spring | `getBean(Class<T>)` | 返回类型自动匹配 |
| MyBatis | `BaseMapper<T>` | 通用 CRUD 操作 |
| CompletableFuture | `CompletableFuture<T>` | 异步结果的类型安全 |
| Jackson | `TypeReference<T>` | 反序列化时保留泛型信息 |

以 Jackson 的 `TypeReference` 为例：

```java
// ❌ 擦除导致的问题
List<String> list = objectMapper.readValue(json, List.class);
// 返回的是 List<Object>，不是 List<String>

// ✅ TypeReference 通过匿名子类保留泛型信息
List<String> list = objectMapper.readValue(json, new TypeReference<List<String>>() {});
// 正确返回 List<String>
```

`TypeReference` 利用了泛型擦除保留在 `Signature` 属性中的特性——匿名子类的 `getGenericSuperclass()` 可以获取到 `TypeReference<List<String>>` 的完整泛型信息。

> 本章从"为什么需要泛型"出发，覆盖了类型安全、通配符与 PECS、类型擦除的原理与代价、桥接方法、以及泛型在框架中的工程应用。下一章《注解与 Lambda》将完成 Java 语言层的最后两块拼图：元数据驱动编程和行为抽象。
