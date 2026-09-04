---
doc_id: dp-行为型补充-命令迭代器中介者等
title: 行为型补充 — 命令、迭代器、中介者、备忘录、状态、访问者、解释器模式
---

# 行为型补充 — 七种行为型设计模式

> **一句话记忆口诀**：命令封装请求、迭代器遍历集合、中介者解耦交互、备忘录保存快照、状态消灭 if-else、访问者双分派、解释器解析语法。

## 1. 命令模式（Command Pattern）

### 1.1 引入：它解决了什么问题？

当需要将"请求"参数化、排队执行、支持撤销/重做时，直接调用方法无法满足：

```java
// ❌ 反例：遥控器直接调用设备方法，无法撤销、无法排队
public class RemoteControl {
    public void pressButton(String device, String action) {
        if ("light".equals(device) && "on".equals(action)) {
            light.turnOn();
        } else if ("light".equals(device) && "off".equals(action)) {
            light.turnOff();
        } else if ("tv".equals(device) && "on".equals(action)) {
            tv.powerOn();
        }
        // 无法撤销上一步操作！无法记录操作历史！
    }
}
```

**问题根因**：请求的发送者与接收者直接耦合，无法对请求进行参数化、排队、撤销等操作。

### 1.2 类比与定义

**生活类比**：餐厅点餐。顾客（发送者）不直接对厨师（接收者）喊菜，而是写在订单（命令对象）上交给服务员。订单可以排队、可以取消、可以记录历史。

> 命令模式将一个请求封装为一个**对象**，从而使你可以用不同的请求对客户进行参数化，对请求排队或记录日志，以及支持可撤销的操作。

### 1.3 原理与实现

```java
// ===== 命令接口 =====
public interface Command {
    void execute();
    void undo(); // 支持撤销
}

// ===== 具体命令 =====
public class LightOnCommand implements Command {
    private Light light;
    public LightOnCommand(Light light) { this.light = light; }
    @Override
    public void execute() { light.turnOn(); }
    @Override
    public void undo() { light.turnOff(); } // 撤销 = 关灯
}

// ===== 调用者：遥控器 =====
public class RemoteControl {
    private Command lastCommand;
    private Deque<Command> history = new ArrayDeque<>();

    public void pressButton(Command command) {
        command.execute();
        history.push(command);
        lastCommand = command;
    }

    public void pressUndo() {
        if (lastCommand != null) {
            lastCommand.undo();
            history.pop();
        }
    }
}

// ===== 使用 =====
Light light = new Light();
RemoteControl remote = new RemoteControl();
remote.pressButton(new LightOnCommand(light)); // 开灯
remote.pressUndo(); // 撤销 → 关灯
```

### 1.4 在 Spring / JDK 中的应用

| 框架/类 | 说明 |
| :-- | :-- |
| `Runnable` / `Callable` | 将任务封装为对象，提交给线程池执行 |
| 线程池 `ThreadPoolExecutor` | 命令队列（BlockingQueue）存储待执行的任务 |
| Spring Batch `Step` | 每个 Step 是一个命令对象 |
| `javax.swing.Action` | Swing 中的动作命令 |

## 2. 迭代器模式（Iterator Pattern）

### 2.1 引入：它解决了什么问题？

不同的集合（数组、链表、树、哈希表）有不同的遍历方式，客户端需要了解每种集合的内部结构：

```java
// ❌ 反例：遍历方式与集合类型强耦合
String[] array = {"a", "b", "c"};
for (int i = 0; i < array.length; i++) { /* 数组用索引 */ }

LinkedList<String> list = new LinkedList<>();
for (Node node = list.head; node != null; node = node.next) { /* 链表用指针 */ }
// 如果集合类型变了，遍历代码全部要改！
```

### 2.2 类比与定义

**生活类比**：电视遥控器的"下一个频道"按钮。无论电视内部是用数组还是链表存储频道列表，用户只需要按"下一个"就能遍历所有频道。

> 迭代器模式提供一种方法**顺序访问**一个聚合对象中的各个元素，而又不暴露该对象的内部表示。

### 2.3 原理与实现

```java
// ===== 迭代器接口（JDK 已提供） =====
public interface Iterator<E> {
    boolean hasNext();
    E next();
}

// ===== 自定义集合 =====
public class BookShelf implements Iterable<Book> {
    private List<Book> books = new ArrayList<>();

    public void addBook(Book book) { books.add(book); }

    @Override
    public Iterator<Book> iterator() {
        return new BookIterator();
    }

    // 内部迭代器：封装遍历逻辑
    private class BookIterator implements Iterator<Book> {
        private int index = 0;
        @Override
        public boolean hasNext() { return index < books.size(); }
        @Override
        public Book next() { return books.get(index++); }
    }
}

// ===== 使用：统一的遍历方式 =====
BookShelf shelf = new BookShelf();
shelf.addBook(new Book("设计模式"));
shelf.addBook(new Book("重构"));
// for-each 底层就是迭代器模式
for (Book book : shelf) {
    System.out.println(book.getName());
}
```

### 2.4 在 Spring / JDK 中的应用

| 框架/类 | 说明 |
| :-- | :-- |
| `java.util.Iterator` | JDK 标准迭代器接口 |
| `Iterable` + for-each | 语法糖，编译后使用 Iterator |
| `Stream` | Java 8 内部迭代器，支持惰性求值 |
| MyBatis `Cursor` | 大数据量查询的流式迭代器 |
| `ResultSet` | JDBC 结果集遍历 |

## 3. 中介者模式（Mediator Pattern）

### 3.1 引入：它解决了什么问题？

当多个对象之间存在复杂的交互关系时，每个对象都需要持有其他对象的引用：

```java
// ❌ 反例：聊天室中每个用户都直接引用其他用户
public class User {
    private List<User> contacts; // 每个用户都要维护联系人列表
    public void sendMessage(String msg, User to) {
        to.receive(msg); // 直接调用，N 个用户有 N*(N-1) 个关系
    }
}
// 新增一个用户，所有现有用户都要更新联系人列表！
```

**问题根因**：对象之间的交互形成网状结构，耦合度极高，难以维护和扩展。

### 3.2 类比与定义

**生活类比**：机场塔台。飞机之间不直接通信（否则 100 架飞机有 4950 条通信线路），而是统一通过塔台（中介者）协调起降。

> 中介者模式用一个中介对象来封装一系列对象之间的交互，使各对象不需要显式地相互引用，从而使其耦合松散。

### 3.3 原理与实现

```java
// ===== 中介者接口 =====
public interface ChatRoom {
    void sendMessage(String message, User sender);
    void addUser(User user);
}

// ===== 具体中介者 =====
public class ChatRoomImpl implements ChatRoom {
    private List<User> users = new ArrayList<>();

    @Override
    public void addUser(User user) { users.add(user); }

    @Override
    public void sendMessage(String message, User sender) {
        // 中介者负责将消息转发给其他所有用户
        users.stream()
             .filter(u -> u != sender)
             .forEach(u -> u.receive(message, sender.getName()));
    }
}

// ===== 同事类 =====
public class User {
    private String name;
    private ChatRoom chatRoom; // 只依赖中介者，不依赖其他 User

    public User(String name, ChatRoom chatRoom) {
        this.name = name;
        this.chatRoom = chatRoom;
        chatRoom.addUser(this);
    }

    public void send(String message) {
        chatRoom.sendMessage(message, this); // 通过中介者发送
    }

    public void receive(String message, String from) {
        System.out.printf("[%s] 收到来自 %s 的消息: %s%n", name, from, message);
    }
}
```

### 3.4 在 Spring / JDK 中的应用

| 框架/类 | 说明 |
| :-- | :-- |
| Spring `ApplicationEventPublisher` | 事件发布者作为中介，解耦事件生产者和消费者 |
| MQ（Kafka/RabbitMQ） | 消息队列作为中介，解耦生产者和消费者 |
| `java.util.Timer` | 定时器作为中介，协调多个 TimerTask |
| Spring MVC `DispatcherServlet` | 中央调度器，协调 Controller、ViewResolver 等 |

## 4. 备忘录模式（Memento Pattern）

### 4.1 引入：它解决了什么问题？

需要保存对象的历史状态以支持撤销/回滚，但又不想暴露对象的内部实现细节。

### 4.2 类比与定义

**生活类比**：游戏存档。玩家可以在关键节点保存进度（创建备忘录），失败后读取存档恢复到之前的状态，而不需要了解游戏内部的数据结构。

> 备忘录模式在不破坏封装性的前提下，捕获一个对象的**内部状态**，并在该对象之外保存这个状态，以便以后恢复。

### 4.3 原理与实现

```java
// ===== 备忘录：保存状态快照 =====
public class EditorMemento {
    private final String content;
    private final int cursorPosition;
    private final LocalDateTime timestamp;

    public EditorMemento(String content, int cursorPosition) {
        this.content = content;
        this.cursorPosition = cursorPosition;
        this.timestamp = LocalDateTime.now();
    }
    // 只提供 getter，不提供 setter（不可变）
    public String getContent() { return content; }
    public int getCursorPosition() { return cursorPosition; }
}

// ===== 发起人：文本编辑器 =====
public class TextEditor {
    private String content = "";
    private int cursorPosition = 0;

    public void type(String text) {
        content += text;
        cursorPosition = content.length();
    }

    // 创建备忘录（保存当前状态）
    public EditorMemento save() {
        return new EditorMemento(content, cursorPosition);
    }

    // 从备忘录恢复状态
    public void restore(EditorMemento memento) {
        this.content = memento.getContent();
        this.cursorPosition = memento.getCursorPosition();
    }
}

// ===== 管理者：历史记录管理 =====
public class History {
    private Deque<EditorMemento> snapshots = new ArrayDeque<>();

    public void push(EditorMemento memento) { snapshots.push(memento); }
    public EditorMemento pop() { return snapshots.pop(); }
}

// ===== 使用 =====
TextEditor editor = new TextEditor();
History history = new History();

editor.type("Hello");
history.push(editor.save()); // 保存状态

editor.type(" World");
history.push(editor.save()); // 保存状态

editor.restore(history.pop()); // 撤销 → 回到 "Hello World"
editor.restore(history.pop()); // 撤销 → 回到 "Hello"
```

### 4.4 在 Spring / JDK 中的应用

| 框架/类 | 说明 |
| :-- | :-- |
| 数据库 Undo Log | 事务回滚时恢复数据的历史状态 |
| `Serializable` | 序列化就是保存对象状态的一种方式 |
| Spring `@Transactional` 回滚 | 事务失败时恢复到事务开始前的状态 |
| Git 版本控制 | 每次 commit 就是一个备忘录 |

## 5. 状态模式（State Pattern）

### 5.1 引入：它解决了什么问题？

当对象的行为随内部状态改变而改变时，代码中充满状态判断的 if-else：

```java
// ❌ 反例：订单状态判断的 if-else 地狱
public class Order {
    private String state; // "CREATED", "PAID", "SHIPPED", "COMPLETED"

    public void nextStep() {
        if ("CREATED".equals(state)) {
            // 待支付 → 已支付
            pay();
            state = "PAID";
        } else if ("PAID".equals(state)) {
            // 已支付 → 已发货
            ship();
            state = "SHIPPED";
        } else if ("SHIPPED".equals(state)) {
            // 已发货 → 已完成
            complete();
            state = "COMPLETED";
        }
        // 每新增一个状态，所有方法都要加 else if！
    }
}
```

### 5.2 类比与定义

**生活类比**：自动售货机。投币前只能投币，投币后可以选商品或退币，出货后回到初始状态。每个状态下的可用操作不同，状态机自动管理状态转换。

> 状态模式允许对象在内部状态改变时改变它的行为，对象看起来好像修改了它的类。

### 5.3 原理与实现

```java
// ===== 状态接口 =====
public interface OrderState {
    void handle(OrderContext context);
    String getStateName();
}

// ===== 具体状态 =====
public class CreatedState implements OrderState {
    @Override
    public void handle(OrderContext context) {
        System.out.println("订单已创建，执行支付...");
        context.setState(new PaidState()); // 状态转换
    }
    @Override
    public String getStateName() { return "待支付"; }
}

public class PaidState implements OrderState {
    @Override
    public void handle(OrderContext context) {
        System.out.println("订单已支付，执行发货...");
        context.setState(new ShippedState());
    }
    @Override
    public String getStateName() { return "已支付"; }
}

public class ShippedState implements OrderState {
    @Override
    public void handle(OrderContext context) {
        System.out.println("订单已发货，确认收货...");
        context.setState(new CompletedState());
    }
    @Override
    public String getStateName() { return "已发货"; }
}

// ===== 上下文 =====
public class OrderContext {
    private OrderState state;
    public OrderContext() { this.state = new CreatedState(); }
    public void setState(OrderState state) { this.state = state; }
    public void nextStep() { state.handle(this); }
    public String getCurrentState() { return state.getStateName(); }
}

// ===== 使用 =====
OrderContext order = new OrderContext();
order.nextStep(); // 待支付 → 已支付
order.nextStep(); // 已支付 → 已发货
order.nextStep(); // 已发货 → 已完成
```

### 5.4 状态模式 vs 策略模式

| 对比维度 | 状态模式 | 策略模式 |
| :-- | :-- | :-- |
| **切换方式** | 状态自动转换（内部驱动） | 客户端主动选择（外部驱动） |
| **关注点** | 对象在不同状态下的行为差异 | 算法的可替换性 |
| **状态感知** | 状态对象知道下一个状态是什么 | 策略对象不知道其他策略 |
| **典型场景** | 订单状态机、TCP 连接状态 | 排序算法选择、支付方式选择 |

## 6. 访问者模式（Visitor Pattern）

### 6.1 引入：它解决了什么问题？

当需要对一个对象结构中的元素执行多种不同且不相关的操作时，把操作放在元素类中会导致类职责膨胀：

```java
// ❌ 反例：每新增一种操作，所有元素类都要修改
public class Circle {
    public double area() { /* 计算面积 */ }
    public String toJson() { /* 序列化 */ }
    public void render() { /* 渲染 */ }
    // 新增"导出 SVG"操作？Circle、Rectangle、Triangle 全部要改！
}
```

### 6.2 类比与定义

**生活类比**：税务审计。公司的各个部门（元素）结构稳定，但审计方式（访问者）经常变化。新增一种审计方式时，不需要修改部门结构，只需要新增一个审计员。

> 访问者模式将**数据结构**与**数据操作**分离，在不修改数据结构的前提下定义新的操作。

### 6.3 原理与实现

```java
// ===== 访问者接口 =====
public interface ShapeVisitor {
    void visit(Circle circle);
    void visit(Rectangle rectangle);
}

// ===== 元素接口 =====
public interface Shape {
    void accept(ShapeVisitor visitor); // 双分派的关键
}

// ===== 具体元素 =====
public class Circle implements Shape {
    private double radius;
    public Circle(double radius) { this.radius = radius; }
    public double getRadius() { return radius; }
    @Override
    public void accept(ShapeVisitor visitor) {
        visitor.visit(this); // 第二次分派：根据 this 的类型调用对应方法
    }
}

// ===== 具体访问者：计算面积 =====
public class AreaCalculator implements ShapeVisitor {
    private double totalArea = 0;
    @Override
    public void visit(Circle circle) {
        totalArea += Math.PI * circle.getRadius() * circle.getRadius();
    }
    @Override
    public void visit(Rectangle rect) {
        totalArea += rect.getWidth() * rect.getHeight();
    }
    public double getTotalArea() { return totalArea; }
}

// ===== 具体访问者：导出 JSON =====
public class JsonExporter implements ShapeVisitor {
    private List<String> jsonList = new ArrayList<>();
    @Override
    public void visit(Circle circle) {
        jsonList.add("{\"type\":\"circle\",\"radius\":" + circle.getRadius() + "}");
    }
    @Override
    public void visit(Rectangle rect) {
        jsonList.add("{\"type\":\"rect\",\"w\":" + rect.getWidth() + "}");
    }
}

// ===== 使用：新增操作不修改元素类 =====
List<Shape> shapes = List.of(new Circle(5), new Rectangle(3, 4));
AreaCalculator calc = new AreaCalculator();
shapes.forEach(s -> s.accept(calc));
System.out.println("总面积: " + calc.getTotalArea());
```

### 6.4 在 Spring / JDK 中的应用

| 框架/类 | 说明 |
| :-- | :-- |
| 编译器 AST 遍历 | 对语法树节点执行不同操作（类型检查、代码生成） |
| Spring `BeanDefinitionVisitor` | 访问并处理 BeanDefinition 中的属性 |
| `FileVisitor` (NIO) | 遍历文件树时执行不同操作 |

### 6.5 适用条件与局限

- **适用**：数据结构稳定（元素类型不常变），但操作经常变化
- **不适用**：元素类型经常新增（每新增一种元素，所有 Visitor 都要改）

## 7. 解释器模式（Interpreter Pattern）

### 7.1 引入：它解决了什么问题？

当需要解释执行一种特定的"语言"或"表达式"时，硬编码解析逻辑会导致代码难以扩展。

### 7.2 类比与定义

**生活类比**：翻译官。不同语言（表达式）有不同的语法规则，翻译官（解释器）按照语法规则逐步解析并翻译。

> 解释器模式给定一个语言，定义它的文法的一种表示，并定义一个解释器，这个解释器使用该表示来解释语言中的句子。

### 7.3 原理与实现

```java
// ===== 抽象表达式 =====
public interface Expression {
    int interpret();
}

// ===== 终结符表达式：数字 =====
public class NumberExpression implements Expression {
    private int number;
    public NumberExpression(int number) { this.number = number; }
    @Override
    public int interpret() { return number; }
}

// ===== 非终结符表达式：加法 =====
public class AddExpression implements Expression {
    private Expression left, right;
    public AddExpression(Expression left, Expression right) {
        this.left = left;
        this.right = right;
    }
    @Override
    public int interpret() {
        return left.interpret() + right.interpret();
    }
}

// ===== 非终结符表达式：乘法 =====
public class MultiplyExpression implements Expression {
    private Expression left, right;
    public MultiplyExpression(Expression left, Expression right) {
        this.left = left;
        this.right = right;
    }
    @Override
    public int interpret() {
        return left.interpret() * right.interpret();
    }
}

// ===== 使用：构建表达式树并解释执行 =====
// 表达式：(3 + 5) * 2
Expression expr = new MultiplyExpression(
    new AddExpression(new NumberExpression(3), new NumberExpression(5)),
    new NumberExpression(2)
);
System.out.println(expr.interpret()); // 输出 16
```

### 7.4 在 Spring / JDK 中的应用

| 框架/类 | 说明 |
| :-- | :-- |
| Spring EL (SpEL) | `#{user.name}` 表达式解析 |
| 正则表达式 `Pattern` | 正则语法的解释执行 |
| MyBatis 动态 SQL | `<if>`、`<where>` 等标签的解析 |
| `java.text.Format` | 日期/数字格式化表达式 |

### 7.5 适用条件与局限

- **适用**：语法简单、效率要求不高的场景（如配置解析、规则引擎）
- **不适用**：复杂语法（应使用专业的解析器生成工具如 ANTLR）

## 8. 七种模式对比总结

| 模式 | 核心思想 | 解决的问题 | 关键词 |
| :-- | :-- | :-- | :-- |
| **命令模式** | 封装请求 | 请求需要排队/撤销/记录 | 请求对象化、Undo |
| **迭代器模式** | 统一遍历 | 不同集合遍历方式不一致 | hasNext/next |
| **中介者模式** | 集中交互 | 对象间网状耦合 | 星型拓扑 |
| **备忘录模式** | 保存快照 | 需要撤销/回滚到历史状态 | 状态快照、Undo Log |
| **状态模式** | 状态驱动 | 行为随状态变化的 if-else | 状态机、自动转换 |
| **访问者模式** | 分离操作 | 数据结构稳定但操作多变 | 双分派 |
| **解释器模式** | 解析语法 | 需要解释执行特定语言 | 表达式树、文法 |

> **复习检验标准**：能否口述"这个模式解决了什么问题？不用它会怎样？Spring 中哪里用到了？"
