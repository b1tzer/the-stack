# 桥接模式（Bridge Pattern）

> **一句话记忆口诀**：桥接分离抽象与实现两个独立变化的维度，用组合替代继承，避免笛卡尔积式的类爆炸。

## 1. 🏠 生活类比

遥控器和电视机是两个独立的东西。遥控器有基础版和高级版，电视有索尼和三星。两个维度自由组合：

- 基础遥控器 + 索尼电视
- 高级遥控器 + 索尼电视
- 基础遥控器 + 三星电视
- 高级遥控器 + 三星电视

如果用继承：`BasicSonyRemote`、`AdvancedSonyRemote`、`BasicSamsungRemote`、`AdvancedSamsungRemote` — 4 个类。新增一个 LG 电视？再加 2 个类！

**桥接模式的做法**：遥控器**持有**电视的引用（组合），两个维度独立变化。

## 2. 💩 烂代码：继承导致类爆炸

```java
// 形状 × 颜色 = 类爆炸
// 2 种形状 × 3 种颜色 = 6 个类
class RedCircle extends Circle {
    public void draw() { drawCircle(); fillRed(); }
}
class BlueCircle extends Circle {
    public void draw() { drawCircle(); fillBlue(); }
}
class GreenCircle extends Circle {
    public void draw() { drawCircle(); fillGreen(); }
}
class RedRectangle extends Rectangle {
    public void draw() { drawRectangle(); fillRed(); }
}
class BlueRectangle extends Rectangle {
    public void draw() { drawRectangle(); fillBlue(); }
}
class GreenRectangle extends Rectangle {
    public void draw() { drawRectangle(); fillGreen(); }
}
// 新增一种颜色？所有形状都要新增子类！
// 新增一种形状？所有颜色都要新增子类！
// N 种形状 × M 种颜色 = N×M 个子类
```

**问题根因**：多个独立变化的维度通过继承耦合，子类数量呈笛卡尔积增长。

## 3. ✨ 桥接模式方案

将"形状"和"颜色"分离为两个独立维度，通过组合连接：

```mermaid
classDiagram
    class Color {
        <<interface>>
        +fill() String
    }
    class Red {
        +fill() String
    }
    class Blue {
        +fill() String
    }
    class Green {
        +fill() String
    }
    class Shape {
        <<abstract>>
        #color Color
        +draw() void
    }
    class Circle {
        -radius double
        +draw() void
    }
    class Rectangle {
        -width double
        -height double
        +draw() void
    }

    Color <|.. Red
    Color <|.. Blue
    Color <|.. Green
    Shape --> Color : 桥接
    Shape <|-- Circle
    Shape <|-- Rectangle
```

## 4. 💻 完整代码实现

```java
// ===== 实现维度：颜色接口 =====
public interface Color {
    String fill();
}

public class Red implements Color {
    @Override
    public String fill() { return "红色"; }
}

public class Blue implements Color {
    @Override
    public String fill() { return "蓝色"; }
}

public class Green implements Color {
    @Override
    public String fill() { return "绿色"; }
}

// ===== 抽象维度：形状 =====
public abstract class Shape {
    protected final Color color; // 桥接：持有实现维度的引用

    public Shape(Color color) {
        this.color = color;
    }

    public abstract void draw();
}

public class Circle extends Shape {
    private final double radius;

    public Circle(double radius, Color color) {
        super(color);
        this.radius = radius;
    }

    @Override
    public void draw() {
        System.out.println("绘制" + color.fill() + "圆形，半径=" + radius);
    }
}

public class Rectangle extends Shape {
    private final double width;
    private final double height;

    public Rectangle(double width, double height, Color color) {
        super(color);
        this.width = width;
        this.height = height;
    }

    @Override
    public void draw() {
        System.out.println("绘制" + color.fill() + "矩形，宽=" + width + "，高=" + height);
    }
}

// ===== 使用示例 =====
public class Main {
    public static void main(String[] args) {
        // 两个维度自由组合
        Shape redCircle = new Circle(5.0, new Red());
        Shape blueCircle = new Circle(3.0, new Blue());
        Shape greenRect = new Rectangle(4.0, 6.0, new Green());

        redCircle.draw();    // 绘制红色圆形，半径=5.0
        blueCircle.draw();   // 绘制蓝色圆形，半径=3.0
        greenRect.draw();    // 绘制绿色矩形，宽=4.0，高=6.0

        // 新增黄色？只需新增 Yellow 类，不影响任何 Shape 子类！
        // 新增三角形？只需新增 Triangle 类，不影响任何 Color 实现！
    }
}
```

### 4.1 进阶示例：多渠道通知系统

```java
// ===== 实现维度：消息发送渠道 =====
public interface MessageSender {
    void send(String title, String content);
}

public class EmailSender implements MessageSender {
    @Override
    public void send(String title, String content) {
        System.out.println("[邮件] " + title + ": " + content);
    }
}

public class SmsSender implements MessageSender {
    @Override
    public void send(String title, String content) {
        System.out.println("[短信] " + title + ": " + content);
    }
}

public class DingTalkSender implements MessageSender {
    @Override
    public void send(String title, String content) {
        System.out.println("[钉钉] " + title + ": " + content);
    }
}

// ===== 抽象维度：消息类型 =====
public abstract class Message {
    protected final MessageSender sender; // 桥接

    public Message(MessageSender sender) {
        this.sender = sender;
    }

    public abstract void send(String content);
}

public class NormalMessage extends Message {
    public NormalMessage(MessageSender sender) { super(sender); }

    @Override
    public void send(String content) {
        sender.send("普通通知", content);
    }
}

public class UrgentMessage extends Message {
    public UrgentMessage(MessageSender sender) { super(sender); }

    @Override
    public void send(String content) {
        sender.send("【紧急】", content + " 请及时处理！");
    }
}

// ===== 使用 =====
Message urgentEmail = new UrgentMessage(new EmailSender());
urgentEmail.send("服务器宕机"); // [邮件] 【紧急】: 服务器宕机 请及时处理！

Message normalDingTalk = new NormalMessage(new DingTalkSender());
normalDingTalk.send("日报已提交"); // [钉钉] 普通通知: 日报已提交
```

## 5. 🔧 框架应用

| 框架/类 | 抽象维度 | 实现维度 | 桥接程度 | 判定依据 |
| :-- | :-- | :-- | :-- | :-- |
| JDBC `Driver`/`Connection` | JDBC 统一访问抽象 | 厂商驱动对 JDBC 契约的实现 | 典型 | 应用通过 JDBC 契约访问数据库，SQL 与数据类型兼容时新增或替换驱动通常不改访问代码 |
| SLF4J + Logback | 日志门面（SLF4J） | 日志实现（Logback/Log4j） | 近似 | 门面与实现可替换，但主要体现门面模式，两个维度独立演化不明显 |
| Spring `Resource` | Resource 接口 | ClassPath/FileSystem/URL | 近似 | 体现统一资源抽象与多种实现的分离，但未必具备两个独立扩展层次的完整结构 |
| `PlatformTransactionManager` | 事务管理 API | JDBC/JPA/JTA 实现 | 近似 | 抽象与实现分离，但主要体现为策略选择，独立演化不明显 |
| `java.util.List` | List 接口 | ArrayList/LinkedList | 结构相似 | 只有接口与实现类的多态，单一变化维度，不构成桥接 |

> 桥接的关键是两个维度**独立演化**，而不是只要存在接口和实现类。上表「近似」和「结构相似」的条目常被误归为桥接，实际更接近策略模式或单纯的多态。

## 6. ⚠️ 适用场景

**适合使用桥接模式的情况：**

- 一个类存在**两个或多个独立变化的维度**
- 不希望因维度组合导致类数量爆炸
- 需要让抽象层与实现层**独立演化**，部分场景还需要在运行期选择或切换实现

**不适合的情况：**

- 只有一个主要变化维度，且不存在需要分离的第二个维度 → 不必引入桥接，可按变化方式选择继承、组合或策略模式
- 两个维度高度依赖同一套变化规则，无法形成有意义的独立抽象 → 拆分收益可能不足以抵消额外复杂度
- 组合数量少、变化稳定，且组合类的维护成本低于引入两层抽象的成本 → 直接继承更简单

## 7. 🔍 桥接模式 vs 策略模式

| 对比维度 | 桥接模式 | 策略模式 |
| :-- | :-- | :-- |
| **设计意图** | 分离两个独立变化维度的耦合 | 封装并替换一组算法或行为 |
| **维度** | 通常两个独立变化的维度 | 通常一个维度（算法选择） |
| **关系** | 抽象层持有实现层引用，双方可沿各自层次扩展 | Context 持有 Strategy，调用方可替换具体策略 |
| **典型场景** | JDBC 驱动、跨平台 UI | 支付方式、排序算法 |

两者结构相似，关键区别在设计意图而非维度数量。桥接侧重解开两个变化维度之间的耦合，策略侧重算法的可替换性；两种意图可以在同一设计中同时存在，不必强行二选一。
