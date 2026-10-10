# 设计模式知识库

本页负责选择入口。设计模式解决什么问题、为什么值得学习以及如何入门，见[第一篇“为什么需要设计模式”](./00-intro/chapter-01-why-patterns.md)。

## 从问题进入

| 你现在的问题 | 入口 |
| :-- | :-- |
| 第一次系统认识设计模式 | [为什么需要设计模式](./00-intro/chapter-01-why-patterns.md) |
| 对象创建过程越来越复杂 | [创建型模式对比](./01-creational/chapter-05-creational-comparison.md) |
| 类职责过多或接口不适配 | [结构型模式对比](./02-structural/chapter-08-structural-comparison.md) |
| 分支不断增加或流程难以扩展 | [策略模式](./03-behavioral/chapter-01-strategy.md) |
| 准备把模式落到现有代码 | [重构到设计模式](./04-practice/chapter-04-refactoring-to-patterns.md) |

## 全部章节

**导论**

- [为什么需要设计模式](./00-intro/chapter-01-why-patterns.md)——模式解决什么问题，不学会付出什么代价。

**创建型：对象怎么造出来**

- [工厂模式](./01-creational/chapter-01-factory.md)、[单例模式](./01-creational/chapter-02-singleton.md)、[建造者模式](./01-creational/chapter-03-builder.md)、[原型模式](./01-creational/chapter-04-prototype.md)
- [创建型模式对比 — 选型指南](./01-creational/chapter-05-creational-comparison.md)

**结构型：对象之间怎么拼**

- [适配器模式](./02-structural/chapter-01-adapter.md)、[装饰器模式](./02-structural/chapter-02-decorator.md)、[代理模式](./02-structural/chapter-03-proxy.md)
- [外观、桥接、组合、享元综述](./02-structural/chapter-04-facade.md)，再进入单篇：[桥接模式](./02-structural/chapter-05-bridge.md)、[组合模式](./02-structural/chapter-06-composite.md)、[享元模式](./02-structural/chapter-07-flyweight.md)
- [结构型模式对比 — 选型指南](./02-structural/chapter-08-structural-comparison.md)

**行为型：对象之间怎么协作**

- [策略模式](./03-behavioral/chapter-01-strategy.md)、[观察者模式](./03-behavioral/chapter-02-observer.md)、[模板方法模式](./03-behavioral/chapter-03-template-method.md)、[责任链模式](./03-behavioral/chapter-04-chain-of-responsibility.md)
- [命令、迭代器、中介者、备忘录、状态、访问者、解释器综述](./03-behavioral/chapter-05-command.md)，再进入单篇：[状态模式](./03-behavioral/chapter-06-state.md)、[迭代器模式](./03-behavioral/chapter-07-iterator.md)、[中介者模式](./03-behavioral/chapter-08-mediator.md)、[备忘录模式](./03-behavioral/chapter-09-memento.md)、[访问者模式](./03-behavioral/chapter-10-visitor.md)
- [行为型模式对比 — 选型指南](./03-behavioral/chapter-11-behavioral-comparison.md)

**实践与参考**

- [设计模式入门](./04-practice/chapter-01-getting-started.md)、[Spring 中的设计模式](./04-practice/chapter-02-spring-patterns.md)、[JDK 中的设计模式](./04-practice/chapter-03-jdk-patterns.md)、[反模式](./04-practice/chapter-05-anti-patterns.md)
- 速查：[设计模式速查表](./reference/pattern-cheatsheet.md)、[UML 类图速查](./reference/uml-cheatsheet.md)

## 内容边界

原则、架构和重构方法进入[软件工程知识库](../engineering/index.md)，Spring 与 JDK 中的具体落点分别进入对应技术专题。
