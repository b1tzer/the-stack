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

## 2. 迭代器、中介者、备忘录、状态、访问者：进入单页详解

这五个模式的完整讲解各自单独成页，包含生活类比、烂代码对比、完整实现、框架应用和适用场景，本页不重复展开：

- [迭代器模式](./chapter-07-iterator.md)——把遍历从集合中抽离，客户端不再关心底层结构。
- [中介者模式](./chapter-08-mediator.md)——把对象间的网状调用收拢到中介者，降为星型拓扑。
- [备忘录模式](./chapter-09-memento.md)——在不破坏封装的前提下捕获状态快照，用于撤销与回滚。
- [状态模式](./chapter-06-state.md)——把每个状态封装成类，用状态机替代 if-else，状态自行决定何时切换。
- [访问者模式](./chapter-10-visitor.md)——在数据结构稳定的前提下，把多变的操作集中到访问者里。

## 3. 解释器模式（Interpreter Pattern）

### 3.1 引入：它解决了什么问题？

当需要解释执行一种特定的"语言"或"表达式"时，硬编码解析逻辑会导致代码难以扩展。

### 3.2 类比与定义

**生活类比**：翻译官。不同语言（表达式）有不同的语法规则，翻译官（解释器）按照语法规则逐步解析并翻译。

> 解释器模式给定一个语言，定义它的文法的一种表示，并定义一个解释器，这个解释器使用该表示来解释语言中的句子。

### 3.3 原理与实现

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

### 3.4 在 Spring / JDK 中的应用

| 框架/类 | 说明 |
| :-- | :-- |
| Spring EL (SpEL) | `#{user.name}` 表达式解析 |
| 正则表达式 `Pattern` | 正则语法的解释执行 |
| MyBatis 动态 SQL | `<if>`、`<where>` 等标签的解析 |
| `java.text.Format` | 日期/数字格式化表达式 |

### 3.5 适用条件与局限

- **适用**：语法简单、效率要求不高的场景（如配置解析、规则引擎）
- **不适用**：复杂语法（应使用专业的解析器生成工具如 ANTLR）

## 4. 七种模式对比总结

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
