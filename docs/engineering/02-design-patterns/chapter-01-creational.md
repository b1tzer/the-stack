# 创建型模式

## 1. 工厂方法

```java
interface PaymentFactory {
    Payment create();
}
class AlipayFactory implements PaymentFactory {
    public Payment create() { return new Alipay(); }
}
```

## 2. 抽象工厂

```java
interface UIFactory {
    Button createButton();
    Input createInput();
}
class DarkUIFactory implements UIFactory {
    public Button createButton() { return new DarkButton(); }
    public Input createInput() { return new DarkInput(); }
}
```

## 3. 单例

```java
// 枚举单例（推荐）
enum Singleton {
    INSTANCE;
}

// 双重检查锁
class Singleton {
    private static volatile Singleton instance;
    public static Singleton getInstance() {
        if (instance == null) {
            synchronized (Singleton.class) {
                if (instance == null) instance = new Singleton();
            }
        }
        return instance;
    }
}
```

## 4. 建造者

```java
User user = User.builder()
    .name("张三")
    .age(25)
    .email("zhangsan@example.com")
    .build();
```

## 5. 原型

```java
class Prototype implements Cloneable {
    public Prototype clone() { return (Prototype) super.clone(); }
}
```

## 6. 简单工厂（Simple Factory）

严格来说不属于 GoF 23 种模式，但使用极其频繁。

```java
public class PaymentFactory {
    
    public static Payment create(String type) {
        return switch (type) {
            case "alipay" -> new Alipay();
            case "wechat" -> new WechatPay();
            case "unionpay" -> new UnionPay();
            default -> throw new IllegalArgumentException("不支持的支付方式: " + type);
        };
    }
}

// 使用
Payment payment = PaymentFactory.create("alipay");
payment.pay(BigDecimal.valueOf(99.9));
```

### 6.1 工厂模式选型指南

| 模式 | 复杂度 | 适用场景 |
|------|--------|----------|
| 简单工厂 | 低 | 产品类型少且稳定，不需要频繁新增 |
| 工厂方法 | 中 | 需要通过继承扩展产品类型，每新增产品需一个工厂子类 |
| 抽象工厂 | 高 | 产品有多个维度（如主题+平台），需要创建产品族 |

## 7. 单例模式最佳实践

```java
// 方式一：枚举单例（最佳实践，线程安全，防反射和序列化攻击）
public enum DatabaseConnection {
    INSTANCE;
    
    private final Connection connection;
    
    DatabaseConnection() {
        this.connection = createConnection();
    }
    
    public Connection getConnection() { return connection; }
    
    private Connection createConnection() {
        // 创建数据库连接
        return null;
    }
}

// 使用
Connection conn = DatabaseConnection.INSTANCE.getConnection();

// 方式二：静态内部类（延迟加载，线程安全）
class CacheManager {
    
    private CacheManager() {}
    
    private static class Holder {
        static final CacheManager INSTANCE = new CacheManager();
    }
    
    public static CacheManager getInstance() {
        return Holder.INSTANCE;
    }
}

// 方式三：Spring 中的单例（容器管理，推荐）
@Service  // Spring 默认就是单例
public class UserService {
    // Spring 容器保证全局唯一实例
}
```

## 8. 建造者模式详解

```java
// 使用 Lombok @Builder
@Builder
public class HttpRequest {
    private String url;
    private String method;
    private Map<String, String> headers;
    private String body;
    private int timeout;
}

// 手动实现建造者（无 Lombok 时）
public class DatabaseConfig {
    private final String host;
    private final int port;
    private final String database;
    private final String username;
    private final int maxPoolSize;
    private final long connectionTimeout;
    
    private DatabaseConfig(Builder builder) {
        this.host = builder.host;
        this.port = builder.port;
        this.database = builder.database;
        this.username = builder.username;
        this.maxPoolSize = builder.maxPoolSize;
        this.connectionTimeout = builder.connectionTimeout;
    }
    
    public static class Builder {
        private String host = "localhost";
        private int port = 3306;
        private String database;
        private String username;
        private int maxPoolSize = 10;
        private long connectionTimeout = 30000;
        
        public Builder host(String host) { this.host = host; return this; }
        public Builder port(int port) { this.port = port; return this; }
        public Builder database(String db) { this.database = db; return this; }
        public Builder username(String user) { this.username = user; return this; }
        public Builder maxPoolSize(int size) { this.maxPoolSize = size; return this; }
        public Builder connectionTimeout(long ms) { this.connectionTimeout = ms; return this; }
        
        public DatabaseConfig build() {
            Objects.requireNonNull(database, "database 不能为空");
            Objects.requireNonNull(username, "username 不能为空");
            return new DatabaseConfig(this);
        }
    }
}

// 使用
DatabaseConfig config = new DatabaseConfig.Builder()
    .host("db.example.com")
    .port(5432)
    .database("myapp")
    .username("admin")
    .maxPoolSize(20)
    .build();
```

> **创建型模式的核心意图**：将对象的创建与使用分离，让系统不依赖于对象的创建、组合和表示方式。
