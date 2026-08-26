# 单例模式

## 1. 🏠 生活类比

一个国家只能有一个总统，一个公司只能有一个 CEO。

## 2. 💩 烂代码

```java
// 每次都 new 一个，浪费资源
Config config1 = new Config();  // 读取配置文件
Config config2 = new Config();  // 又读一次
Config config3 = new Config();  // 再读一次
// 配置文件被读了 3 次！
```

## 3. ✨ 7 种写法

### 3.1 饿汉式（线程安全，推荐简单场景）

```java
class Singleton {
    private static final Singleton INSTANCE = new Singleton();
    public static Singleton getInstance() { return INSTANCE; }
}
```

### 3.2 懒汉式（线程不安全，别用）
```java
class Singleton {
    private static Singleton instance;
    public static Singleton getInstance() {
        if (instance == null) instance = new Singleton(); // 竞态条件！
        return instance;
    }
}
```

### 3.3 双重检查锁（DCL）

```java
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

### 3.4 静态内部类（推荐）

```java
class Singleton {
    private static class Holder {
        static final Singleton INSTANCE = new Singleton();
    }
    public static Singleton getInstance() { return Holder.INSTANCE; }
}
```

### 3.5 枚举单例（Effective Java 推荐，最佳）

```java
enum Singleton {
    INSTANCE;
    public void doSomething() { /* ... */ }
}
```

## 4. 🔧 框架应用

- Spring: Bean 默认单例作用域
- JDK: `Runtime.getRuntime()`

## 5. ⚠️ 适用场景

- 配置管理、连接池、线程池、日志
- 确实只需要一个实例的场景
