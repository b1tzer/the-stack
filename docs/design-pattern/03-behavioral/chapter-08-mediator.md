# 中介者模式（Mediator Pattern）

> **一句话记忆口诀**：中介者用一个中心对象封装对象间的所有交互，从网状耦合变成星型拓扑，聊天室和MQ是最经典的例子。

## 1. 🏠 生活类比

**机场塔台**：飞机之间不直接通信（否则 100 架飞机有 4950 条通信线路），而是统一通过塔台协调起降。每架飞机只知道塔台，不知道其他飞机的存在。

**房产中介**：买房人和卖房人不直接联系，都通过中介沟通。新增一方（如律师）只需通知中介，不需要让所有参与者都认识律师。

## 2. 💩 烂代码：对象间网状耦合

```java
// ❌ 反例：聊天室中每个用户都直接引用其他用户
public class User {
    private String name;
    private List<User> contacts = new ArrayList<>(); // 每个用户维护联系人列表

    public void sendMessage(String msg, User to) {
        to.receive(msg, this); // 直接调用
    }

    public void broadcast(String msg) {
        for (User contact : contacts) {
            contact.receive(msg, this); // 逐一通知
        }
    }

    public void receive(String msg, User from) {
        System.out.println("[" + name + "] 收到来自 " + from.name + " 的消息: " + msg);
    }
}

// N 个用户有 N*(N-1) 个关系！
// 新增一个用户，所有现有用户都要更新联系人列表！
// 移除一个用户，所有用户都要从联系人列表中删除！
```

**问题根因**：对象之间直接交互形成网状耦合，N 个对象有 N² 个关系，难以维护和扩展。

## 3. ✨ 中介者模式方案

```mermaid
flowchart TD
    subgraph 网状耦合（不使用中介者）
        A1[用户A] <--> B1[用户B]
        A1 <--> C1[用户C]
        A1 <--> D1[用户D]
        B1 <--> C1
        B1 <--> D1
        C1 <--> D1
    end

    subgraph 星型耦合（使用中介者）
        M[聊天室-中介者]
        A2[用户A] --> M
        B2[用户B] --> M
        C2[用户C] --> M
        D2[用户D] --> M
        M --> A2
        M --> B2
        M --> C2
        M --> D2
    end
```

## 4. 💻 完整代码实现

```java
import java.util.*;

// ===== 中介者接口 =====
public interface ChatRoom {
    void register(User user);
    void sendMessage(String message, User sender);
    void sendPrivateMessage(String message, User sender, String toName);
}

// ===== 具体中介者：聊天室 =====
public class ChatRoomImpl implements ChatRoom {
    private final Map<String, User> users = new HashMap<>();

    @Override
    public void register(User user) {
        users.put(user.getName(), user);
        System.out.println(user.getName() + " 加入聊天室");
    }

    @Override
    public void sendMessage(String message, User sender) {
        // 中介者负责将消息转发给其他所有用户
        users.values().stream()
             .filter(u -> !u.getName().equals(sender.getName()))
             .forEach(u -> u.receive(message, sender.getName()));
    }

    @Override
    public void sendPrivateMessage(String message, User sender, String toName) {
        User receiver = users.get(toName);
        if (receiver != null) {
            receiver.receive("[私聊] " + message, sender.getName());
        } else {
            sender.receive("用户 " + toName + " 不在线", "系统");
        }
    }
}

// ===== 同事类：用户 =====
public class User {
    private final String name;
    private ChatRoom chatRoom; // 只依赖中介者，不依赖其他 User

    public User(String name) {
        this.name = name;
    }

    public String getName() { return name; }

    public void setChatRoom(ChatRoom chatRoom) {
        this.chatRoom = chatRoom;
        chatRoom.register(this);
    }

    public void send(String message) {
        System.out.println("[" + name + "] 发送: " + message);
        chatRoom.sendMessage(message, this);
    }

    public void sendPrivate(String message, String toName) {
        System.out.println("[" + name + "] 私聊 " + toName + ": " + message);
        chatRoom.sendPrivateMessage(message, this, toName);
    }

    public void receive(String message, String from) {
        System.out.println("[" + name + "] 收到来自 " + from + " 的消息: " + message);
    }
}

// ===== 使用示例 =====
public class Main {
    public static void main(String[] args) {
        ChatRoom room = new ChatRoomImpl();

        User alice = new User("Alice");
        User bob = new User("Bob");
        User charlie = new User("Charlie");

        // 用户加入聊天室（只认识中介者）
        alice.setChatRoom(room);
        bob.setChatRoom(room);
        charlie.setChatRoom(room);

        // 发送群消息
        alice.send("大家好！");

        // 发送私聊消息
        bob.sendPrivate("你好 Alice！", "Alice");

        // 新增用户只需注册，不需要修改其他用户
        User dave = new User("Dave");
        dave.setChatRoom(room);
        dave.send("我来了！");
    }
}
```

### 4.1 进阶示例：表单字段联动

```java
// ===== 场景：注册表单中多个字段相互依赖 =====
// 用户名输入 → 验证是否已存在
// 密码输入 → 强度检测
// 确认密码 → 一致性检查
// 所有字段校验通过 → 启用注册按钮

// 中介者：表单控制器
public class FormMediator {
    private TextField usernameField;
    private PasswordField passwordField;
    private PasswordField confirmPasswordField;
    private Button registerButton;
    private Label messageLabel;

    public void setComponents(TextField username, PasswordField password,
                              PasswordField confirm, Button register, Label message) {
        this.usernameField = username;
        this.passwordField = password;
        this.confirmPasswordField = confirm;
        this.registerButton = register;
        this.messageLabel = message;

        // 注册各字段的变化监听
        username.setOnChange(this::onUsernameChanged);
        password.setOnChange(this::onPasswordChanged);
        confirm.setOnChange(this::onConfirmChanged);
    }

    private void onUsernameChanged(String value) {
        if (value.length() < 3) {
            messageLabel.setText("用户名至少3个字符");
            registerButton.setEnabled(false);
        } else {
            messageLabel.setText("");
            checkFormValid();
        }
    }

    private void onPasswordChanged(String value) {
        if (value.length() < 8) {
            messageLabel.setText("密码至少8个字符");
            registerButton.setEnabled(false);
        } else {
            messageLabel.setText("");
            checkFormValid();
        }
    }

    private void onConfirmChanged(String value) {
        if (!value.equals(passwordField.getValue())) {
            messageLabel.setText("两次密码不一致");
            registerButton.setEnabled(false);
        } else {
            messageLabel.setText("");
            checkFormValid();
        }
    }

    private void checkFormValid() {
        boolean valid = usernameField.getValue().length() >= 3
                && passwordField.getValue().length() >= 8
                && passwordField.getValue().equals(confirmPasswordField.getValue());
        registerButton.setEnabled(valid);
    }
}
// 所有字段只知道中介者，不知道其他字段的存在
```

## 5. 🔧 框架应用

| 框架/类 | 说明 |
| :-- | :-- |
| Spring `ApplicationEventPublisher` | 事件发布者作为中介，解耦生产者和消费者 |
| MQ（Kafka/RabbitMQ） | 消息队列作为中介，解耦生产者和消费者 |
| Spring MVC `DispatcherServlet` | 中央调度器，协调 Controller、ViewResolver 等 |
| `java.util.Timer` | 定时器作为中介，协调多个 TimerTask |
| Netty `EventLoop` | 事件循环作为中介，协调 Channel 和 Handler |

## 6. ⚠️ 适用场景

**适合：**

- 多个对象之间存在**复杂的交互关系**
- 不希望对象之间**直接引用**
- 需要**集中管理**对象间的交互逻辑
- 典型场景：聊天室、表单联动、MQ、调度器

**不适合：**

- 对象之间交互简单，直接调用更清晰
- 中介者本身变得过于复杂（"上帝对象"）

## 7. 🔍 中介者 vs 观察者

| 对比维度 | 中介者模式 | 观察者模式 |
| :-- | :-- | :-- |
| **通信方式** | 通过中介者**集中转发** | Subject **直接通知** Observer |
| **耦合度** | 所有同事类只依赖中介者 | Subject 持有 Observer 列表 |
| **交互复杂度** | N 个对象只有 N 个关系 | N 个对象有 N×M 个关系 |
| **典型例子** | 聊天室、MQ | 事件监听、Spring Event |

> 实际上，Spring 的 `ApplicationEventPublisher` 融合了两种模式：既是中介者（解耦发布者和订阅者），又是观察者（一对多通知）。

> **一句话记忆口诀**：中介者把网状耦合变成星型拓扑，所有交互通过中心对象协调，MQ 和 DispatcherServlet 是最经典的例子。
