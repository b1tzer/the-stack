# Spring 中的设计模式

## 1. 工厂模式

```java
// BeanFactory
BeanFactory factory = new ClassPathXmlApplicationContext("beans.xml");
UserService userService = factory.getBean(UserService.class);
```

## 2. 单例模式

```java
// Spring Bean 默认单例
@Component
public class UserService { /* 单例 */ }

// 也可以指定
@Scope("prototype")
public class UserService { /* 每次 new */ }
```

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

## 4. 模板方法

```java
// JdbcTemplate
jdbcTemplate.query("SELECT * FROM users", (rs, rowNum) -> {
    return new User(rs.getLong("id"), rs.getString("name"));
});
```

## 5. 观察者模式

```java
// Spring Event
applicationContext.publishEvent(new OrderCreatedEvent(order));

@EventListener
public void onOrderCreated(OrderCreatedEvent event) { /* ... */ }
```

## 6. 策略模式

```java
// Resource 接口
Resource resource = new ClassPathResource("config.xml");
Resource resource = new FileSystemResource("/path/to/file");
```

## 7. 责任链模式

```java
// Filter 链
FilterChain chain = ...
chain.doFilter(request, response);
```
*JDK 中的设计模式 →*
