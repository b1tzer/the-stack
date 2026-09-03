---
doc_id: dp-结构型补充-外观桥接组合享元
title: 结构型补充 — 外观、桥接、组合、享元模式
---

# 结构型补充 — 外观、桥接、组合、享元模式

> **一句话记忆口诀**：外观简化入口、桥接分离维度、组合统一树形、享元共享复用。

## 1. 外观模式（Facade Pattern）

### 1.1 引入：它解决了什么问题？

当一个子系统包含多个复杂的类和接口时，客户端需要了解每个类的细节才能完成操作：

```java
// ❌ 反例：客户端直接调用多个子系统，耦合度极高
public class OrderService {
    public void placeOrder(Order order) {
        InventorySystem inventory = new InventorySystem();
        inventory.checkStock(order.getProductId());
        inventory.reserveStock(order.getProductId(), order.getQuantity());
        PaymentSystem payment = new PaymentSystem();
        payment.validateCard(order.getCardNumber());
        payment.charge(order.getAmount());
        ShippingSystem shipping = new ShippingSystem();
        shipping.createShipment(order);
        NotificationSystem notification = new NotificationSystem();
        notification.sendEmail(order.getUserEmail(), "订单已创建");
    }
}
```

**问题根因**：客户端与子系统的多个类直接耦合，调用逻辑分散，维护成本高。

### 1.2 类比与定义

**生活类比**：酒店前台就是外观模式。住客不需要分别联系客房部、餐饮部、保洁部，只需要打电话给前台，前台协调所有部门完成服务。

> 外观模式为子系统中的一组接口提供一个**统一的高层接口**，使子系统更容易使用。

### 1.3 原理与实现

```java
// ===== 外观类：统一入口，封装子系统调用逻辑 =====
public class OrderFacade {
    private final InventorySystem inventory;
    private final PaymentSystem payment;
    private final ShippingSystem shipping;
    private final NotificationSystem notification;

    public OrderFacade(InventorySystem inventory, PaymentSystem payment,
                       ShippingSystem shipping, NotificationSystem notification) {
        this.inventory = inventory;
        this.payment = payment;
        this.shipping = shipping;
        this.notification = notification;
    }

    public boolean placeOrder(Order order) {
        if (!inventory.checkStock(order.getProductId())) return false;
        inventory.reserveStock(order.getProductId(), order.getQuantity());
        payment.charge(order.getAmount());
        shipping.createShipment(order);
        notification.sendEmail(order.getUserEmail(), "订单已创建");
        return true;
    }
}

// ===== 客户端调用 =====
OrderFacade facade = new OrderFacade(inventory, payment, shipping, notification);
facade.placeOrder(order); // 一行代码搞定！
```

### 1.4 在 Spring / JDK 中的应用

| 框架/类 | 说明 |
| :-- | :-- |
| `JdbcTemplate` | 封装了 Connection、Statement、ResultSet 的复杂操作 |
| `SLF4J` | 日志门面，统一 Log4j、Logback 等日志框架的接口 |
| `RestTemplate` | 封装了 HTTP 连接、序列化、错误处理等细节 |
| Spring `ApplicationContext` | 统一了 BeanFactory、ResourceLoader、EventPublisher 等子系统 |

### 1.5 常见误区

- **误区**：外观类变成"上帝类" → 外观类只做**编排和委托**，不包含业务逻辑
- **误区**：有了外观就不能直接访问子系统 → 外观是**可选的便捷入口**，不阻止直接访问

## 2. 桥接模式（Bridge Pattern）

### 2.1 引入：它解决了什么问题？

当一个类存在两个或多个独立变化的维度时，使用继承会导致类爆炸：

```java
// ❌ 反例：形状 × 颜色 = 类爆炸
// 2 种形状 × 3 种颜色 = 6 个类；新增 1 种形状要新增 3 个类！
class RedCircle extends Circle { }
class BlueCircle extends Circle { }
class GreenCircle extends Circle { }
class RedRectangle extends Rectangle { }
class BlueRectangle extends Rectangle { }
class GreenRectangle extends Rectangle { }
```

**问题根因**：多个维度的变化通过继承组合，子类数量呈笛卡尔积增长。

### 2.2 类比与定义

**生活类比**：遥控器（抽象）和电视机（实现）。遥控器有基础版和高级版，电视有索尼和三星。两个维度独立变化，通过"遥控器持有电视引用"来桥接。

> 桥接模式将**抽象部分**与**实现部分**分离，使它们都可以独立变化。

### 2.3 原理与实现

```java
// ===== 实现维度：颜色接口 =====
public interface Color {
    String fill(String shape);
}
public class Red implements Color {
    @Override
    public String fill(String shape) { return "红色的" + shape; }
}
public class Blue implements Color {
    @Override
    public String fill(String shape) { return "蓝色的" + shape; }
}

// ===== 抽象维度：形状 =====
public abstract class Shape {
    protected Color color; // 桥接：持有实现维度的引用
    public Shape(Color color) { this.color = color; }
    public abstract void draw();
}
public class Circle extends Shape {
    private double radius;
    public Circle(double radius, Color color) {
        super(color);
        this.radius = radius;
    }
    @Override
    public void draw() {
        System.out.println(color.fill("圆形") + "，半径=" + radius);
    }
}

// ===== 使用：两个维度自由组合 =====
Shape redCircle = new Circle(5.0, new Red());
Shape blueCircle = new Circle(3.0, new Blue());
// 新增绿色？只需新增 Green 类，不影响任何 Shape 子类！
```

### 2.4 在 Spring / JDK 中的应用

| 框架/类 | 说明 |
| :-- | :-- |
| JDBC `Driver` / `Connection` | 抽象（JDBC API）与实现（各数据库驱动）分离 |
| `PlatformTransactionManager` | 事务管理抽象与具体实现（JDBC/JPA/JTA）分离 |
| SLF4J + Logback/Log4j | 日志抽象与日志实现分离 |

### 2.5 常见误区

- **误区**：桥接模式就是"用组合替代继承" → 桥接强调的是**两个独立变化的维度**通过组合连接
- **误区**：桥接模式和策略模式一样 → 策略关注算法可替换性，桥接关注抽象与实现的分离

## 3. 组合模式（Composite Pattern）

### 3.1 引入：它解决了什么问题？

处理树形结构时，客户端需要区分"叶子节点"和"容器节点"，代码充满类型判断：

```java
// ❌ 反例：到处都是 instanceof 判断
public long calculateSize(Object node) {
    if (node instanceof File) {
        return ((File) node).getSize();
    } else if (node instanceof Directory) {
        long total = 0;
        for (Object child : ((Directory) node).getChildren()) {
            total += calculateSize(child);
        }
        return total;
    }
    throw new IllegalArgumentException("未知类型");
}
```

**问题根因**：叶子节点和容器节点接口不统一，客户端必须区分处理。

### 3.2 类比与定义

**生活类比**：公司组织架构。无论是"部门"还是"员工"，都可以统一执行"计算薪资总额"操作。部门的薪资 = 所有子节点薪资之和。

> 组合模式将对象组合成**树形结构**以表示"部分-整体"的层次结构，使客户端对单个对象和组合对象的使用具有**一致性**。

### 3.3 原理与实现

```java
// ===== 抽象组件 =====
public abstract class FileSystemNode {
    protected String name;
    public FileSystemNode(String name) { this.name = name; }
    public abstract long getSize();
    public abstract void print(String prefix);
}

// ===== 叶子节点：文件 =====
public class FileNode extends FileSystemNode {
    private long size;
    public FileNode(String name, long size) { super(name); this.size = size; }
    @Override
    public long getSize() { return size; }
    @Override
    public void print(String prefix) {
        System.out.println(prefix + "📄 " + name + " (" + size + "B)");
    }
}

// ===== 容器节点：目录 =====
public class DirectoryNode extends FileSystemNode {
    private List<FileSystemNode> children = new ArrayList<>();
    public DirectoryNode(String name) { super(name); }
    public void add(FileSystemNode node) { children.add(node); }
    public void remove(FileSystemNode node) { children.remove(node); }
    @Override
    public long getSize() {
        return children.stream().mapToLong(FileSystemNode::getSize).sum();
    }
    @Override
    public void print(String prefix) {
        System.out.println(prefix + "📁 " + name + " (" + getSize() + "B)");
        children.forEach(child -> child.print(prefix + "  "));
    }
}

// ===== 使用示例 =====
DirectoryNode root = new DirectoryNode("project");
DirectoryNode src = new DirectoryNode("src");
src.add(new FileNode("Main.java", 2048));
src.add(new FileNode("Utils.java", 1024));
root.add(src);
root.add(new FileNode("README.md", 512));
root.print(""); // 统一接口，无需区分文件和目录
```

### 3.4 在 Spring / JDK 中的应用

| 框架/类 | 说明 |
| :-- | :-- |
| `java.awt.Container` / `Component` | Swing 组件树 |
| MyBatis `SqlNode` | 动态 SQL 的 `<if>`、`<choose>`、`<foreach>` 组成树形结构 |
| Spring Security `AccessDecisionVoter` | 投票器组合 |
| Jackson `JsonNode` | ObjectNode 包含子节点，ValueNode 是叶子 |

### 3.5 常见误区

- **误区**：所有树形结构都要用组合模式 → 只有当需要**统一处理叶子和容器**时才需要
- **误区**：叶子节点也要实现 `add()/remove()` → 可以抛出 `UnsupportedOperationException`，或使用"安全组合模式"

## 4. 享元模式（Flyweight Pattern）

### 4.1 引入：它解决了什么问题？

当系统中存在大量相似对象时，每个对象都独立存储会消耗大量内存：

```java
// ❌ 反例：围棋游戏中每个棋子都是独立对象
// 361 个对象中，颜色/形状/纹理只有 2 种组合，大量内存被浪费
for (int i = 0; i < 361; i++) {
    ChessPiece piece = new ChessPiece(color, shape, texture, x, y);
}
```

**问题根因**：大量对象中存在重复的内部状态（不变部分），没有被共享复用。

### 4.2 类比与定义

**生活类比**：共享单车。城市中有成千上万的骑行需求，但不需要每人买一辆自行车。共享单车（享元对象）被多人复用，每次骑行的起点终点（外部状态）不同，但车本身（内部状态）是共享的。

> 享元模式运用共享技术有效地支持大量**细粒度对象**的复用，将对象的状态分为**内部状态**（可共享、不变）和**外部状态**（不可共享、随环境变化）。

### 4.3 原理与实现

```java
// ===== 享元接口 =====
public interface ChessPiece {
    void draw(int x, int y); // x, y 是外部状态
}

// ===== 具体享元：包含内部状态（可共享） =====
public class ConcreteChessPiece implements ChessPiece {
    private final String color;   // 内部状态
    private final String texture; // 内部状态
    public ConcreteChessPiece(String color) {
        this.color = color;
        this.texture = loadTexture(color);
        System.out.println("创建" + color + "棋子（仅创建一次）");
    }
    @Override
    public void draw(int x, int y) {
        System.out.printf("在(%d,%d)绘制%s棋子%n", x, y, color);
    }
}

// ===== 享元工厂：缓存并复用享元对象 =====
public class ChessPieceFactory {
    private static final Map<String, ChessPiece> pieces = new HashMap<>();
    public static ChessPiece getChessPiece(String color) {
        return pieces.computeIfAbsent(color, ConcreteChessPiece::new);
    }
}

// ===== 使用示例 =====
ChessPiece black1 = ChessPieceFactory.getChessPiece("黑"); // 创建
ChessPiece black2 = ChessPieceFactory.getChessPiece("黑"); // 复用！
System.out.println(black1 == black2); // true，同一个对象！
```

### 4.4 在 Spring / JDK 中的应用

| 框架/类 | 说明 |
| :-- | :-- |
| `String` 常量池 | 相同字面量的字符串共享同一个对象 |
| `Integer.valueOf()` | -128~127 范围内的 Integer 对象被缓存复用 |
| `Boolean.valueOf()` | TRUE 和 FALSE 两个实例被全局共享 |
| 数据库连接池 | Connection 对象被多个请求复用 |
| 线程池 | Thread 对象被多个任务复用 |

### 4.5 常见误区

- **误区**：享元模式就是缓存 → 享元强调的是**分离内部状态和外部状态**，缓存只是实现手段
- **误区**：所有重复对象都应该用享元 → 只有当对象数量大、内部状态占比高时才值得使用

```java
// ⚠️ 经典面试题：为什么 Integer 在 -128~127 范围内 == 为 true？
Integer a = 127, b = 127;
System.out.println(a == b); // true —— 享元模式！IntegerCache 缓存
Integer c = 128, d = 128;
System.out.println(c == d); // false —— 超出缓存范围，新对象
// 结论：Integer 比较永远用 equals()，不要用 ==
```

## 5. 四种模式对比总结

| 模式 | 核心思想 | 解决的问题 | 关键词 |
| :-- | :-- | :-- | :-- |
| **外观模式** | 统一入口 | 子系统复杂，客户端调用困难 | 简化、封装、门面 |
| **桥接模式** | 分离维度 | 多维度变化导致类爆炸 | 抽象与实现分离 |
| **组合模式** | 统一接口 | 树形结构中叶子和容器处理不一致 | 部分-整体、递归 |
| **享元模式** | 共享复用 | 大量相似对象消耗过多内存 | 内部状态、外部状态 |

> **复习检验标准**：能否口述"这个模式解决了什么问题？不用它会怎样？Spring 中哪里用到了？"
