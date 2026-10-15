# Spring 核心原理概览

> 你写的 `@Service` 里没有一个 `new`，依赖却都能用；你写的 `@Transactional` 方法里没有一行事务代码，异常却能回滚。前者靠 IoC 容器替你管理对象与依赖，后者靠 AOP 替你包一层代理。Spring 的上层能力大多长在这两套机制上，本专题就从它们讲起。

## 1. 为什么会有 Spring

Spring 不是凭空设计出来的，它是对一个具体历史问题的回应。2002 年前后，Java 企业开发的正路是 J2EE 规范，EJB（Enterprise JavaBeans）是官方钦定的企业级组件模型。但 EJB 2.x 的代价很高：

| EJB 2.x 的负担 | 具体表现 |
| :-- | :-- |
| 组件膨胀 | 一个业务 Bean 要同时写 Home 接口、Local/Remote 接口、实现类和 `ejb-jar.xml`，一个类配多个文件 |
| 强制容器 | Bean 必须跑在 EJB 容器里，离开容器无法运行，写单元测试要先搭起容器环境 |
| 持久化笨重 | 实体 Bean 用 CMP 做对象关系映射，表达能力弱，复杂查询很难写 |
| 侵入性强 | Bean 必须实现 EJB 规定的接口、抛规定的异常，业务代码和框架深度耦合 |

Rod Johnson 在 2002 年出版的《Expert One-on-One J2EE Design and Development》里系统论证了一件事：**没有 EJB，企业应用照样能写好**。他给的替代品是一套朴素的组合，普通 POJO 加依赖注入来组装对象，AOP 来织入横切逻辑。

2003 年这套代码以 Spring 之名开源（Apache 2.0 许可），2004 年 3 月发布 1.0。它要做的只有一件事：把对象从 EJB 容器里解放出来，回到普通 POJO。组装交给 IoC，横切交给 AOP，本专题就围绕这两块地基展开。

## 2. 版本演进

从 2004 年的 1.0 到 2022 年的 6.0，Spring 每次大版本升级都在回应一个具体的问题：

![Spring 生态演进](/spring/spring-core-timeline.svg)

| 版本 | 年份 | 主要变化 |
| :-- | :-- | :-- |
| 1.0 | 2004 | 轻量容器落地，IoC 和 AOP 成型，核心容器、数据访问、Web 三层骨架搭起来 |
| 2.0 / 2.5 | 2006 / 2007 | XML 配置越堆越厚，2.5 引入 `@Autowired`、`@Component`，装配开始从 XML 挪进代码 |
| 3.0 | 2009 | `@Configuration` + `@Bean` 提供了一种不用 XML 的 Java Config 装配方式 |
| 4.0 | 2013 | 全面支持 Java 8，补上 `@RestController`、WebSocket 等 Web 能力 |
| Spring Boot 1.0 | 2014 | Spring 自身的配置又成了负担，Boot 用自动配置加约定优于配置，大幅削减启动配置 |
| 5.0 | 2017 | 引入基于 Reactor 的 WebFlux，为 I/O 密集场景提供非阻塞的响应式栈 |
| 6.0 | 2022 | 基线升到 JDK 17，命名空间从 `javax` 切到 `jakarta`（Jakarta EE 9+），为原生镜像做准备 |

这七个节点的驱动力各有不同。EJB 的开发部署成本催生了轻量容器；XML 配置的膨胀催生了注解装配；注解加手工装配仍繁琐，催生了 Java Config；Spring 自身的配置负担催生了 Boot 的自动配置；同步模型在 I/O 密集场景下的线程开销，催生了 WebFlux。这些机制彼此并不替代，注解与 XML、WebFlux 与 Spring MVC 至今并存，各自解决的是不同阶段最突出的痛点。

## 3. 框架版图

Spring Framework 由多个模块组成，核心容器只是其中一条主线。理解这条主线，可以沿着三层自下而上地读，分层的收益是只想用轻量容器的人不必背上全部依赖：

| 模块 | 层职责 | 关键类型 |
| :-- | :-- | :-- |
| `spring-core` | 不涉及 Bean 概念，提供资源抽象、类型转换、排序等基础工具 | `Resource`、`Ordered` |
| `spring-beans` | 定义 Bean 的元数据与创建工厂，IoC 容器的底座 | `BeanDefinition`、`BeanFactory` |
| `spring-context` | 在 beans 之上叠加事件、国际化、注解配置等应用上下文能力 | `ApplicationContext`、`MessageSource` |

图中箭头即依赖方向，只允许上层依赖下层。由此能推出一个常被问到的结论：`BeanFactory` 定义在 `spring-beans`，`ApplicationContext` 定义在 `spring-context`，后者在前者之上叠加了应用上下文能力，详见 [IoC 容器](./chapter-02-ioc-container.md)。AOP、事务、Web 之所以能同时作用在一个 `@Service` 上，是因为它们共享同一套 Bean 装配：

![Spring 核心模块依赖关系](/spring/spring-core-modules.svg)

## 4. 知识地图

本专题的六个模块连成一条主线。容器先学会创建 Bean（IoC），再看单个 Bean 从创建到销毁的完整流程（生命周期），依赖在这个流程里注入（DI），相互依赖时用三级缓存解开（循环依赖），横切逻辑靠代理增强（AOP），最后按条件决定哪些 Bean 生效（条件装配）。

- **IoC 容器**：入口，先解决「谁创建对象」。容器能创建 Bean，后面的注入、代理才有对象可操作。
- **Bean 生命周期**：单个 Bean 从 `new` 到销毁的完整流程，是注入、循环依赖、代理共同依赖的骨架。
- **依赖注入**：解决「依赖怎么进去」。构造器注入发生在实例化阶段，Setter 和字段注入发生在属性填充阶段，它不是生命周期里的单独一步。
- **AOP**：解决「横切逻辑怎么复用」，代理对象在生命周期「初始化」阶段生成。
- **循环依赖**：注入的极端情况，A 依赖 B、B 又依赖 A。Spring 用三级缓存提前暴露早期引用，解开部分单例循环依赖，三级缓存同时和 AOP 的早期代理有关。
- **条件装配**：解决「哪些 Bean 该生效」，是装配的开关，也是 Spring Boot 自动配置的地基。

![Spring 核心知识地图](/spring/spring-core-mindmap.svg)
