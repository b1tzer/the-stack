# 单例模式

## 1. 🏠 生活类比

一个国家只能有一个总统，一个公司只能有一个 CEO。

## 2. 💩 烂代码

```java
// 三个组件各自 new 连接池，连接资源被重复占用
HikariDataSource pool1 = new HikariDataSource(); // 组件 A 的连接池
HikariDataSource pool2 = new HikariDataSource(); // 组件 B 又建一个
HikariDataSource pool3 = new HikariDataSource(); // 组件 C 再建一个
// 本可共用一个连接池，却占用了三份连接
```

## 3. ✨ 5 种写法

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
    private static volatile Singleton instance; // volatile 防止指令重排，保证可见性
    public static Singleton getInstance() {
        if (instance == null) {              // 第一次检查，避免每次调用都加锁
            synchronized (Singleton.class) {
                if (instance == null) instance = new Singleton(); // 第二次检查，防止并发重复创建
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
        static final Singleton INSTANCE = new Singleton(); // 首次访问 Holder 时才初始化，利用类加载机制延迟加载
    }
    public static Singleton getInstance() { return Holder.INSTANCE; }
}
```

### 3.5 枚举单例（序列化/反射安全，无特殊约束时优先）

```java
enum Singleton {
    INSTANCE;
    public void doSomething() { /* ... */ }
}
```

## 4. 🔧 框架应用

- Spring: Bean 默认单例作用域，由容器管理生命周期，与手写 GoF 单例职责不同
- JDK: `Runtime.getRuntime()`

更多见 [Spring 中的设计模式](../04-practice/chapter-02-spring-patterns.md)。

## 5. ⚠️ 适用场景

- 配置管理、连接池、线程池、日志
- 确实只需要一个实例的场景

静态单例通常只保证同一类加载器加载的该类对应一个实例，不保证跨类加载器或跨进程唯一。集群范围内的唯一性通常需要借助数据库约束或分布式锁等机制，不能靠单例模式保证。

实际项目通常由依赖注入容器（Spring）管理共享实例，而非手写私有构造器加静态方法。详见 [创建型模式对比](./chapter-05-creational-comparison.md) 与 [反模式](../04-practice/chapter-05-anti-patterns.md)。
