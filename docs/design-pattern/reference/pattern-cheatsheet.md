# 设计模式速查表

## 创建型

| 模式 | 意图 | 关键词 |
| :-- | :-- | :-- |
| [工厂方法](../01-creational/chapter-01-factory.md) | 让子类决定创建什么 | `create()` |
| [抽象工厂](../01-creational/chapter-01-factory.md) | 创建一族产品 | `createA()` + `createB()` |
| [单例](../01-creational/chapter-02-singleton.md) | 全局唯一 | `getInstance()` |
| [建造者](../01-creational/chapter-03-builder.md) | 分步构建复杂对象 | `builder().a().b().build()` |
| [原型](../01-creational/chapter-04-prototype.md) | 克隆对象 | `clone()` |

## 结构型

| 模式 | 意图 | 关键词 |
| :-- | :-- | :-- |
| [适配器](../02-structural/chapter-01-adapter.md) | 接口转换 | `Adapter implements Target` |
| [装饰器](../02-structural/chapter-02-decorator.md) | 动态叠加功能 | `Decorator wraps Component` |
| [代理](../02-structural/chapter-03-proxy.md) | 控制访问 | `Proxy implements Subject` |
| [外观](../02-structural/chapter-04-facade.md) | 统一入口 | `Facade.method()` |
| [桥接](../02-structural/chapter-05-bridge.md) | 抽象与实现分离 | `Abstraction → Implementor` |
| [组合](../02-structural/chapter-06-composite.md) | 树形结构 | `Component.add(child)` |
| [享元](../02-structural/chapter-07-flyweight.md) | 共享细粒度对象 | `FlyweightFactory.get(key)` |

## 行为型

| 模式 | 意图 | 关键词 |
| :-- | :-- | :-- |
| [策略](../03-behavioral/chapter-01-strategy.md) | 算法可替换 | `context.setStrategy(s)` |
| [观察者](../03-behavioral/chapter-02-observer.md) | 一对多通知 | `subject.notify()` |
| [模板方法](../03-behavioral/chapter-03-template-method.md) | 固定流程可变步骤 | `abstract step()` |
| [责任链](../03-behavioral/chapter-04-chain-of-responsibility.md) | 请求沿链传递 | `handler.setNext(h)` |
| [命令](../03-behavioral/chapter-05-command.md) | 请求封装为对象 | `command.execute()` |
| [状态](../03-behavioral/chapter-06-state.md) | 状态决定行为 | `state.handle()` |
| [迭代器](../03-behavioral/chapter-07-iterator.md) | 顺序访问元素 | `iterator.next()` |
| [中介者](../03-behavioral/chapter-08-mediator.md) | 集中交互 | `mediator.notify()` |
| [备忘录](../03-behavioral/chapter-09-memento.md) | 保存/恢复状态 | `memento.getState()` |
| [访问者](../03-behavioral/chapter-10-visitor.md) | 作用于对象族 | `visitor.visit(element)` |
| [解释器](../03-behavioral/chapter-05-command.md) | 定义文法并解释语言 | `expression.interpret()` |

## JDK 中的模式

| 模式 | JDK 实现 |
| :-- | :-- |
| 工厂 | [`Calendar.getInstance()`](../04-practice/chapter-03-jdk-patterns.md) |
| 单例 | [`Runtime.getRuntime()`](../04-practice/chapter-03-jdk-patterns.md) |
| 建造者 | [`Stream.Builder`](../04-practice/chapter-03-jdk-patterns.md) |
| 适配器 | [`Arrays.asList()`](../04-practice/chapter-03-jdk-patterns.md) |
| 装饰器 | [`BufferedReader`](../04-practice/chapter-03-jdk-patterns.md) |
| 代理 | [`Proxy.newProxyInstance()`](../04-practice/chapter-03-jdk-patterns.md) |
| 观察者 | [`Observable`](../04-practice/chapter-03-jdk-patterns.md)（已废弃） |
| 策略 | [`Comparator`](../04-practice/chapter-03-jdk-patterns.md) |
| 模板方法 | [`AbstractList`](../04-practice/chapter-03-jdk-patterns.md) |
| 迭代器 | [`Iterator`](../04-practice/chapter-03-jdk-patterns.md) |

## Spring 中的模式

| 模式 | Spring 实现 |
| :-- | :-- |
| 工厂 | [`BeanFactory`](../04-practice/chapter-02-spring-patterns.md) |
| 单例 | [Bean 默认 Scope](../04-practice/chapter-02-spring-patterns.md) |
| 代理 | [AOP（JDK 动态代理 / CGLIB）](../04-practice/chapter-02-spring-patterns.md) |
| 模板方法 | [`JdbcTemplate`、`RestTemplate`](../04-practice/chapter-02-spring-patterns.md) |
| 观察者 | [`ApplicationEvent`](../04-practice/chapter-02-spring-patterns.md) |
| 策略 | [`Resource` 接口](../04-practice/chapter-02-spring-patterns.md)（资源抽象与多态替换，非经典策略模式） |
| 责任链 | [`HandlerInterceptor`](../04-practice/chapter-02-spring-patterns.md) |
| 适配器 | [`HandlerAdapter`](../04-practice/chapter-02-spring-patterns.md) |
