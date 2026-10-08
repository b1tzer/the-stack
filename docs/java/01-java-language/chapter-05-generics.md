# 泛型

> 泛型不是一组需要死记的规则，而是一连串「上一个方案不够用」逼出来的演化：`Object` 存不了类型约束 → 引入类型变量 → 类型变量带来不变性 → 不变太死引出 `extends` / `super` → 编译器检查完，类型信息无处安放 → JVM 只能擦除 → 擦除破坏了多态 → 桥接方法补上。本章沿这条因果链展开。

## 1. Object 为什么不够

### 1.1 泛型出现之前：集合只能存 Object

Java 5 之前，集合类只能存 `Object`：

```java
List list = new ArrayList();
list.add("hello");
list.add(123);           // 可以混入任何类型
list.add(new Date());    // 什么都能放

// 读取时必须强制转型
String s = (String) list.get(0);  // OK
String s2 = (String) list.get(1); // ClassCastException！运行时崩溃
```

### 1.2 Object 的局限，暴露三个问题

`Object` 是所有类的父类，存什么都能放下。但「能放下」不等于「安全」，它带来三个问题：

1. **强制类型转换**：每次取出元素都要强转，代码冗余
2. **运行时错误**：类型错误只能在运行时发现，编译器帮不了你
3. **无法表达约束**：`List` 不能表达「这个列表只能放 String」

这三个问题的共同根源是：**类型信息丢在了程序员的脑子里，而不是类型里。** 程序员知道 `list` 里装的是 `String`，但 `List` 这个类型本身不携带这一信息，编译器也就无从替你验证。要解决，就得让类型本身携带「装的是什么」——这就是类型变量要做的事。

## 2. 为什么需要类型变量

### 2.1 类型变量把检查提前到编译期

Java 5 引入类型参数 `T`，让 `List` 变成 `List<String>`：

```java
List<String> list = new ArrayList<>();
list.add("hello");
list.add(123);           // 编译错误！编译器直接拒绝
```

`T` 是一个占位符：`List<String>` 声明「这个列表装的是 `String`」。编译器拿到这个声明后，就能在**编译期**验证每次 `add` 是否合法，把第 1 章的三类问题一次性消掉——强转不需要了、错误提前暴露了、约束表达出来了。

核心动作只有一句：**把类型检查从运行期提前到编译期。** 2.2 ~ 2.5 讲清 `T` 的各种写法。

### 2.2 泛型类

在类名后加类型参数，类内部即可使用这个类型：

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

`<T>` 是类型参数，使用时传入具体类型（如 `String`），编译器据此保证类型安全。

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

### 2.3 泛型方法

方法也可以有自己的类型参数——是**方法自己的**，不是类的：

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

**类类型参数与方法类型参数的区别**：

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

### 2.4 有界类型参数

类型参数可以加约束，限制可传入的类型范围：

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

`<T extends Comparable<T>>` 的含义：T 必须实现 `Comparable<T>`。`extends` 在此表示「上界」，既可以是类也可以是接口（多个约束用 `&` 连接）：

```java
public static <T extends Serializable & Comparable<T>> void process(T item) { ... }
```

### 2.5 泛型构造方法

构造方法也可以有自己的类型参数（少见）：

```java
public class Event<T> {
    private T data;

    // 泛型构造方法：方法自己的 <T> 遮蔽了类的 <T>
    public <T> Event(T data) {
        this.data = (T) data;  // 注意：这里的 T 是方法的 T，不是类的 T
    }
}
```

这种情况很少用到，知道即可。

## 3. 为什么泛型默认不变

类型变量解决了第 1 章的问题，但立刻引出新问题：类型变量之间是什么关系？

直觉上，既然 `String` is-a `Object`，那 `List<String>` 应该也是 `List<Object>`。

**不是。** 如果允许：

```java
List<String> strings = new ArrayList<>();
List<Object> objects = strings;   // 假设允许
objects.add(123);                 // 往 String 列表里塞了一个 Integer！
String s = strings.get(1);       // ClassCastException
```

一旦允许 `List<String>` 赋给 `List<Object>`，第 2 章建立的编译期检查就被绕过：`objects` 名义上是 `List<Object>`，可以合法地 `add(123)`，但它底层指向只能装 `String` 的列表，类型错误又回到了运行期。

所以 Java 让泛型默认**不变（Invariant）**：

```java
List<String> list = new ArrayList<>();  // OK
List<Object> objects = list;            // 编译错误！
```

不变性不是额外加的规定，它是「类型变量」这个设计本身的必然结果：只要 `List<X>` 能按 X 读写，`List<String>` 和 `List<Object>` 就必须是两个不同的类型，否则编译期检查名存实亡。

## 4. 为什么出现 extends / super

不变性保住了类型安全，但代价是太死板——很多场景只读、或只写，却因「不变」而完全无法复用。于是 Java 提供两个方向的放宽。

### 4.1 只读场景：协变 `? extends`

有些场景只读不写，比如遍历打印。这时可以放宽为协变：

```java
List<? extends Number> list = new ArrayList<Integer>();  // OK
// list 可以指向 Integer 列表、Double 列表等任何 Number 子类的列表

Number n = list.get(0);   // OK，可以安全读取 Number
list.add(123);            // 编译错误！不能写入
```

为什么能读不能写？`list` 实际可能是 `List<Double>`，往里塞 `Integer` 就破坏了类型安全——不变性要防的正是这个。`? extends` 因此**只保证读安全**。

### 4.2 只写场景：逆变 `? super`

另一方向：只需要写、不需要读。用 `? super`：

```java
List<? super Integer> list = new ArrayList<Number>();  // OK
// list 可以指向 Number 列表、Object 列表等任何 Integer 父类的列表

list.add(123);            // OK，可以安全写入 Integer
Object obj = list.get(0); // OK，但只能读取为 Object
```

为什么读只能是 `Object`？`list` 实际可能是 `List<Number>`，取出的元素可能是 `Double`，无法保证是 `Integer`。`? super` 因此**只保证写安全**。

### 4.3 PECS：两条规则合起来的口诀

把 4.1、4.2 的结论压缩成一句可操作的口诀，就是 Josh Bloch 在《Effective Java》里的 PECS：

- 一个泛型结构**产出**数据（Producer），用 `? extends`——只读
- 一个泛型结构**消费**数据（Consumer），用 `? super`——只写

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

PECS 不是新规则，它只是给 4.1、4.2 的推论起了个名字。

### 4.4 无界通配符 `?`

`List<?>` 表示「未知类型的列表」。只能读取（读出来是 `Object`），不能写入（除了 `null`）：

```java
List<?> list = new ArrayList<String>();
Object obj = list.get(0);  // OK
list.add("hello");         // 编译错误
list.add(null);            // OK，null 是任何类型的合法值
```

`?` 适合只读场景，或真的不关心元素类型时使用。

## 5. 编译器如何检查

前四章讲了泛型「是什么」和「怎么用」，但没回答一个基础问题：编译器凭什么能执行这些检查？

答案很简单：**编译器拿得到类型参数。** 源码里写的是 `List<String>`，`<String>` 这个信息在编译期是完整存在的，编译器用它做三件事：

1. **代入**：把 `T` 换成实际类型 `String`，得到 `add(String)`、`get()` 返回 `String`
2. **验证**：检查每次调用传入的类型是否匹配（`list.add(123)` 不匹配 `add(String)`，报错）
3. **推导**：能推断时不要求显式写（`Util.printArray(names)` 推断出 `T = String`）

关键点在于：**这套检查只在编译期存在。** 一旦编译器验证完毕、生成字节码，`<String>` 这个信息就「用完即弃」——它不进入字节码。为什么要丢弃？下一章回答。

## 6. JVM 为什么类型擦除

### 6.1 一个反直觉的事实

```java
List<String> strings = new ArrayList<>();
List<Integer> integers = new ArrayList<>();

strings.getClass() == integers.getClass()  // true!
```

运行时，`List<String>` 和 `List<Integer>` 是同一个类。这说明：**类型参数在编译完成后被擦掉了。**

注意这里的精确表述：JVM 并非不知道对象本身是什么类型——每个对象头里都存着指向其类元数据的指针，`getClass()` 能准确告诉你它是 `ArrayList`。JVM 唯一不知道的，只是 `List<String>` 里 `<String>` 这个**编译期参数**。擦除擦的是参数，不是对象类型。

### 6.2 擦除的机制

编译器在编译时完成第 5 章的检查后，在生成的字节码中**移除类型参数**，替换为它的上界（默认 `Object`）：

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

擦除发生在上界处：`<T extends Number>` 的 T 被擦成 `Number`，无界的 `T` 被擦成 `Object`。

### 6.3 为什么必须擦除：字节码兼容

原因只有一个——**不动字节码格式**。

Java 5 引入泛型时，已有海量 Java 4（无泛型）时代的代码和库在运行。JVM 的字节码格式和指令集是固定协议，不能为泛型加新的操作码。要在这套旧格式上表达泛型，唯一办法是：编译期检查完，运行时把 `T` 擦掉，让带泛型的新代码和旧代码跑在同一个 JVM 上。

擦除不是 bug，是「不改字节码」这个约束下的唯一解。但它有代价，体现在下一节。

### 6.4 擦除的代价：三类限制

运行时没有 T，直接推出三条限制：

**不能用基本类型**：

```java
List<int> list = new ArrayList<>();     // ❌
List<Integer> list = new ArrayList<>();  // ✅ 但有装箱开销
```

T 被擦成 `Object`，而 `int` 不是 `Object`，所以不能作类型参数。

**不能实例化类型参数**：

```java
public <T> T create() {
    return new T();  // ❌ 运行时不知道 T 是什么
}
```

**不能做参数化类型的 instanceof**：

```java
List<String> a = new ArrayList<>();
List<Integer> b = new ArrayList<>();
// 运行时无法区分 a 和 b 的泛型类型

if (list instanceof List<String>) { }  // 编译错误，运行时没有 List<String> 这个类型
```

## 7. 为什么需要 Bridge Method

擦除留下两道裂缝：读取时要强转，继承时多态被破坏。编译器用三件事补上，其中 Bridge Method 是核心。

### 7.1 checkcast：读取处的强转

擦除后 `list.get(0)` 返回 `Object`，编译器在读取处自动插入强转：

```java
// 源码
String s = list.get(0);

// 编译后实际为
String s = (String) list.get(0);  // 对应字节码 checkcast 指令
```

需要澄清一个常见误解：**checkcast 不代表运行时一定不报错。** 它只是一次运行时类型检查，遇到类型不符照样抛 `ClassCastException`：

```java
List<String> list = new ArrayList<>();
List raw = list;          // 原始类型绕过编译期检查
raw.add(123);             // 混入 Integer（堆污染）
String s = list.get(0);   // checkcast 处抛 ClassCastException
```

泛型保证的是：**在正常使用下**，类型错误在编译期就被拦住，checkcast 成了兜底而非日常。但一旦用原始类型绕过编译期检查，checkcast 依然会抛异常——它不能替你挡住所有运行时错误。

### 7.2 桥接方法（Bridge Method）

泛型与继承结合时，擦除会破坏多态：

```java
public interface Container<T> {
    void set(T value);
}

public class StringContainer implements Container<String> {
    @Override
    public void set(String value) { ... }
}
```

擦除后，`Container.set(T)` 变成 `Container.set(Object)`，而 `StringContainer.set(String)` 参数类型不同，不再是覆写——多态失效。

编译器生成一个桥接方法来修补：

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

桥接方法不是新概念，它只是「擦除后签名不一致」这道裂缝上的补丁——父类调用 `set(Object)` 时，通过它转发到真正的 `set(String)`。

### 7.3 Signature 属性：擦掉但没完全擦掉

运行时虽然擦除了类型参数，但 Class 文件里还留了一份——存在 `Signature` 属性中，供反射和框架读取：

```java
public class UserRepository extends JpaRepository<User, Long> { }

Type superclass = UserRepository.class.getGenericSuperclass();
ParameterizedType pt = (ParameterizedType) superclass;
Type[] typeArgs = pt.getActualTypeArguments();
// typeArgs[0] = User.class
// typeArgs[1] = Long.class
```

Spring、MyBatis 等框架大量利用这个能力获取泛型参数。第二卷 Class 文件章节会展开 `Signature` 属性的存储结构。

## 8. 框架如何拿回被擦除的泛型信息

7.3 节留下一个可追问的点：`Signature` 属性在运行时仍可读，框架究竟怎么利用它？Jackson 的 `TypeReference` 是最典型的例子。

```java
// ❌ 擦除导致的问题
List<String> list = objectMapper.readValue(json, List.class);
// 返回的是 List<Object>，不是 List<String>

// ✅ TypeReference 通过匿名子类保留泛型信息
List<String> list = objectMapper.readValue(json, new TypeReference<List<String>>() {});
// 正确返回 List<String>
```

`TypeReference` 依赖 `Signature` 属性：匿名子类的 `getGenericSuperclass()` 能取回 `TypeReference<List<String>>` 的完整泛型信息。这正是第 6 章「运行期擦除、Signature 留底」在真实框架里的落地——擦除没有让泛型信息消失，只是把它从字节码挪进了 `Signature` 属性，谁需要谁去取。

## 9. 未来方向（Project Valhalla）

6.4 节的三类限制，根子都在「类型参数被擦成 `Object`」。Oracle 的 Project Valhalla 要动的正是这个根，而不是给限制打补丁：

- **Specialized Generics**：让 `List<int>` 合法，对应 6.4 的「不能用基本类型」
- **Value Types**：消除装箱，对应 6.4 里 `List<Integer>` 的装箱开销

两条路指向同一件事：让基本类型也能作类型参数。目前仍在开发，但它若落地，第 6 章整条「擦除」因果链会被重写。
