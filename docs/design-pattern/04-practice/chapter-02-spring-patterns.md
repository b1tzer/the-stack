# Spring 中的设计模式

> Spring 是设计模式的大规模实践场，但它的 Bean 工厂、AOP 代理、事件机制落到经典模式上时，语义边界与教科书定义并不完全一致。

## 1. 工厂模式

```java
// BeanFactory
BeanFactory factory = new ClassPathXmlApplicationContext("beans.xml");
UserService userService = factory.getBean(UserService.class);
```

`BeanFactory` 承担对象创建与装配，调用方只向容器要类型，不关心具体实现和构造细节，这正是工厂模式的动机。更多见 [工厂模式](../01-creational/chapter-01-factory.md)。

## 2. 单例模式

```java
// Spring Bean 默认单例
@Component
public class UserService { /* 单例 */ }

// 也可以指定
@Scope("prototype")
public class UserService {
    // 容器每次解析该 Bean 的获取请求时，通常创建一个新实例
}
```

Spring 的"单例"是容器内每个 Bean 定义对应一个共享实例，不是 JVM 全局唯一。线程安全也不由作用域自动保证，仍取决于 Bean 自身是否持有可变状态。prototype Bean 被注入到单例 Bean 时，注入只发生一次，不会在每次调用时重建。更多见 [单例模式](../01-creational/chapter-02-singleton.md)。

## 3. 代理模式

```java
// AOP 动态代理
@Aspect
@Component
public class LogAspect {
    @Before("execution(* com.example.service.*.*(..))")
    public void log(JoinPoint jp) { /* ... */ }
}
```

Spring AOP 通过代理拦截方法调用实现横切逻辑，可用 JDK 动态代理或 CGLIB 两种方式，具体取决于代理配置与默认设置。CGLIB 通过生成子类创建代理，无法代理 final 类，也无法覆写 final 方法。注意自调用失效，同一类内部方法直接互相调用不会经过代理，通知不会生效。更多见 [代理模式](../02-structural/chapter-03-proxy.md)。

## 4. 模板方法

```java
// JdbcTemplate
jdbcTemplate.query("SELECT * FROM users", (rs, rowNum) -> {
    return new User(rs.getLong("id"), rs.getString("name"));
});
```

`JdbcTemplate` 把获取连接、预编译、关闭资源这些固定流程做成模板，同时借助 RowMapper 回调把"结果集如何映射成对象"交给调用方，是模板方法思想与回调机制的结合。更多见 [模板方法](../03-behavioral/chapter-03-template-method.md)。

## 5. 观察者模式

```java
// Spring Event
applicationContext.publishEvent(new OrderCreatedEvent(order));

@EventListener
public void onOrderCreated(OrderCreatedEvent event) { /* ... */ }
```

Spring 事件默认同步执行，发布方会等监听器全部执行完才继续。若在事务提交前发布事件，监听器通过当前事务可见的数据访问路径可能读到尚未提交的修改；而消息发送、缓存写入这类不受数据库事务直接管理的副作用，不会随事务回滚。更多见 [观察者模式](../03-behavioral/chapter-02-observer.md)。

## 6. 策略模式

```java
// Resource 接口
Resource classpathResource = new ClassPathResource("config.xml");
Resource fileResource = new FileSystemResource("/path/to/config.xml");

// 调用方依赖 Resource 抽象，不需要知道资源来自类路径还是文件系统
try (InputStream in = classpathResource.getInputStream()) {
    // 读取资源
}
```

`ClassPathResource` 和 `FileSystemResource` 体现的是 Resource 抽象与多态，更接近"面向接口编程"，还不是完整的策略模式。完整的策略接口、上下文与可替换策略见 [策略模式](../03-behavioral/chapter-01-strategy.md)。

## 7. 责任链模式

```java
// Filter 链
FilterChain chain = ...
chain.doFilter(request, response);
```

Filter 链按顺序逐个处理请求，每个 Filter 决定是否放行到下一个，这是责任链的典型形态。更多见 [责任链模式](../03-behavioral/chapter-04-chain-of-responsibility.md)。

[JDK 中的设计模式 →](./chapter-03-jdk-patterns.md)
