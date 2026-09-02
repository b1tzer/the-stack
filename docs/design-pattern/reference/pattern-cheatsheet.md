# 设计模式速查表

## 创建型

| 模式 | 意图 | 关键词 |
|------|------|--------|
| 工厂方法 | 让子类决定创建什么 | `create()` |
| 抽象工厂 | 创建一族产品 | `createA()` + `createB()` |
| 单例 | 全局唯一 | `getInstance()` |
| 建造者 | 分步构建复杂对象 | `builder().a().b().build()` |
| 原型 | 克隆对象 | `clone()` |

## 结构型

| 模式 | 意图 | 关键词 |
|------|------|--------|
| 适配器 | 接口转换 | `Adapter implements Target` |
| 装饰器 | 动态叠加功能 | `Decorator wraps Component` |
| 代理 | 控制访问 | `Proxy implements Subject` |
| 外观 | 统一入口 | `Facade.method()` |
| 桥接 | 抽象与实现分离 | `Abstraction → Implementor` |
| 组合 | 树形结构 | `Component.add(child)` |
| 享元 | 共享细粒度对象 | `FlyweightFactory.get(key)` |

## 行为型

| 模式 | 意图 | 关键词 |
|------|------|--------|
| 策略 | 算法可替换 | `context.setStrategy(s)` |
| 观察者 | 一对多通知 | `subject.notify()` |
| 模板方法 | 固定流程可变步骤 | `abstract step()` |
| 责任链 | 请求沿链传递 | `handler.setNext(h)` |
| 命令 | 请求封装为对象 | `command.execute()` |
| 状态 | 状态决定行为 | `state.handle()` |
| 迭代器 | 顺序访问元素 | `iterator.next()` |
| 中介者 | 集中交互 | `mediator.notify()` |
| 备忘录 | 保存/恢复状态 | `memento.getState()` |
| 访问者 | 作用于对象族 | `visitor.visit(element)` |

## JDK 中的模式

| 模式 | JDK 实现 |
|------|----------|
| 工厂 | `Calendar.getInstance()` |
| 单例 | `Runtime.getRuntime()` |
| 建造者 | `StringBuilder` |
| 适配器 | `Arrays.asList()` |
| 装饰器 | `BufferedReader` |
| 代理 | `Proxy.newProxyInstance()` |
| 观察者 | `Observable`（已废弃） |
| 策略 | `Comparator` |
| 模板方法 | `AbstractList` |
| 迭代器 | `Iterator` |

## Spring 中的模式

| 模式 | Spring 实现 |
|------|-------------|
| 工厂 | `BeanFactory` |
| 单例 | Bean 默认 Scope |
| 代理 | AOP（JDK 动态代理 / CGLIB） |
| 模板方法 | `JdbcTemplate`、`RestTemplate` |
| 观察者 | `ApplicationEvent` |
| 策略 | `Resource` 接口 |
| 责任链 | `HandlerInterceptor` |
| 适配器 | `HandlerAdapter` |
