# 启动流程与启动参数

> `SpringApplication.run(App.class, args)` 这行代码背后，是一条从「准备环境」到「发布就绪」的完整流水线。搞懂这条流水线，启动失败时才知道卡在哪一步；`args` 传了什么、`@Value` 为什么取不到值、优雅停机为什么没生效，都能定位。

## 1. 一个 run 拆成三段

Spring Boot 启动不是一步到位，而是分阶段推进。把 `run()` 的内部过程按「是否影响 Bean 装配」分成三段，比死记十几个方法名有用；应用就绪之后的关闭流程单独在 §5 讲：

```txt
准备阶段：推断类型 → 装配 RunListener → 准备 Environment → 打印 Banner
        ↓
装配阶段：创建 ApplicationContext → 应用 Initializer → refresh()
        ↓
收尾阶段：afterRefresh → 执行 Runner → 发布 ready

关闭流程（运行后，见 §5）：收到停机信号 → 优雅停机 → 销毁 Bean
```

`refresh()` 那一段（Bean 的创建、注入、生命周期）已经在 [IoC 容器](../01-core/chapter-02-ioc-container.md) §6 讲过，本章不重复，重点讲 `refresh()` 前后两段——启动参数、启动事件、失败诊断和停机。

## 2. 启动参数：args 去了哪

### 2.1 从字符串数组到 ApplicationArguments

`main(String[] args)` 里的 `args`，`run` 会把它包装成 `ApplicationArguments`：

```java
public static void main(String[] args) {
    SpringApplication.run(MyApplication.class, args);  // args 被解析
}
```

`ApplicationArguments` 是启动参数的统一抽象，把「一堆字符串」变成「选项 + 非选项」的结构：

| 方法 | 作用 | 示例（`--server.port=9090 --verbose app`） |
| :-- | :-- | :-- |
| `getOptionNames()` | 所有 `--` 开头的键 | `["server.port", "verbose"]` |
| `getOptionValues(name)` | 某键的所有值 | `["9090"]` |
| `getNonOptionArgs()` | 非 `--` 开头的参数 | `["app"]` |
| `containsOption(name)` | 是否包含某键 | `true` |

约定很简单：`--key=value` 是带值的选项，`--flag` 是无值的布尔选项，`app` 这类不带 `--` 的是非选项参数。

### 2.2 参数为什么能覆盖配置文件

这些选项最终会进 `Environment`，成为一条 `PropertySource`。这正是 [条件装配与 Profile](../01-core/chapter-07-conditional-profile.md) §4.1 里「命令行参数 > 配置文件」那条链的起点：在 Spring Boot 默认的外部化配置机制下，命令行属性的优先级高于配置文件中的同名属性，所以 `--server.port=9090` 能覆盖配置文件里的端口设置。

### 2.3 两个 Runner

启动参数最常见的消费方式是两个 Runner 接口，它们在 `refresh()` 之后、应用就绪之前被调用：

```java
@Component
public class StartupTask implements ApplicationRunner {
    @Override
    public void run(ApplicationArguments args) {   // 拿到的已是解析好的结构
        if (args.containsOption("init-data")) {
            // 执行初始化
        }
    }
}
```

`CommandLineRunner` 和 `ApplicationRunner` 只差一个参数类型：前者拿原始 `String... args`，后者拿 `ApplicationArguments`。要判断「有没有某个参数」，用后者更方便。多个 Runner 的执行顺序用 `@Order`（或实现 `Ordered`）指定；未指定时，不要依赖它们的执行先后。

## 3. 启动事件：一条可以挂载的链

`run` 的几个关键阶段会发布事件。知道这条链，才能在「Bean 还没建好」时介入——比如在 Environment 就绪后、Bean 装配前改配置。

### 3.1 关键事件点

| 事件 | 时机 | 能做什么 |
| :-- | :-- | :-- |
| `ApplicationStartingEvent` | run 刚开始，Environment 还没建 | 极早期的开关设置 |
| `ApplicationEnvironmentPreparedEvent` | Environment 已就绪 | 增删 PropertySource、改 profile |
| `ApplicationPreparedEvent` | refresh 之前，BeanDefinition 已加载 | 改 BeanDefinition |
| `ApplicationStartedEvent` | refresh 之后，Runner 之前 | 上下文刷新完成，Runner 尚未执行 |
| `ApplicationReadyEvent` | 一切就绪，Runner 已跑完 | 对外宣布服务可用 |
| `ApplicationFailedEvent` | 启动过程抛异常 | 记录失败现场 |

### 3.2 怎么监听

三种方式，从重到轻：

```java
// 1. 实现并注册 ApplicationListener，监听对应的应用事件
@Component
public class MyListener implements ApplicationListener<ApplicationReadyEvent> {
    @Override
    public void onApplicationEvent(ApplicationReadyEvent event) {
        // 服务就绪
    }
}

// 2. @EventListener 注解，更简洁
@Component
public class MyListener {
    @EventListener
    public void onReady(ApplicationReadyEvent event) { }
}
```

`SpringApplicationRunListener` 是更底层的接口，直接参与 `SpringApplication` 的启动生命周期回调。默认实现 `EventPublishingRunListener` 负责把这些生命周期回调转成上面这些 `ApplicationEvent`。自定义 `RunListener` 通过 `META-INF/spring.factories` 里的 `org.springframework.boot.SpringApplicationRunListener` 注册——这条和自动配置类的 `AutoConfiguration.imports` 不是同一个文件，别混。

## 4. 启动失败诊断：FailureAnalyzer

启动报错时，控制台会输出一份「Description / Action」报告，它来自 `FailureAnalyzer`：

```txt
***************************
APPLICATION FAILED TO START
***************************

Description:

Web server failed to start. Port 8080 was already in use.

Action:

Identify and stop the process that's listening on port 8080 or configure this
application to listen on another port.
```

`FailureAnalyzer` 的职责是：把一个冷冰冰的异常（`PortInUseException`）翻译成人能看懂的两句话（Description + Action）。Spring Boot 内置了一组实现，常见的有端口占用、找不到 Bean、数据源创建失败等。

自定义一个：

```java
public class MyFailureAnalyzer implements FailureAnalyzer {
    @Override
    public FailureAnalysis analyze(Throwable failure) {
        if (failure instanceof MyBizException ex) {
            return new FailureAnalysis(
                "业务配置 " + ex.getKey() + " 缺失",
                "检查 application.yml 是否配置了 " + ex.getKey(),
                ex);
        }
        return null;   // 返回 null 表示这个 analyzer 不处理该异常
    }
}
```

通过 `META-INF/spring.factories` 注册：

```properties
org.springframework.boot.diagnostics.FailureAnalyzer=\
com.example.MyFailureAnalyzer
```

返回值是 `null` 时，Spring 会继续尝试下一个 analyzer——这套「谁认得谁处理，否则往下传」的链式机制，是它可扩展的原因。

## 5. 优雅停机：让发版不掉请求

默认情况下，Web 服务器采用立即停机模式，不会等待正在处理的请求完成，在途请求可能还没返回连接就被断——这在滚动发布时表现为「发版瞬间有几条请求失败」。正常的 SIGTERM 关闭流程中，Spring 容器仍会执行关闭和 Bean 销毁；但进程被 SIGKILL 强制终止时，这些回调无法保证执行。

### 5.1 打开开关

```yaml
server:
  shutdown: graceful          # 默认 immediate，改为 graceful
spring:
  lifecycle:
    timeout-per-shutdown-phase: 30s   # 等待进行中请求的最长时间
```

开启后，收到 `SIGTERM` 时：先停止接收新请求，让进行中的请求跑完（最多等 `30s`），再关闭容器、销毁 Bean（触发 `@PreDestroy`）。

### 5.2 与容器编排的配合

K8s 滚动更新时，Pod 会先收到 `SIGTERM`，再等 `terminationGracePeriodSeconds`（默认 30s）强制杀进程。要让优雅停机真正生效，这两个超时必须满足：

```txt
spring.lifecycle.timeout-per-shutdown-phase  <  terminationGracePeriodSeconds
```

`timeout-per-shutdown-phase` 是单个关闭阶段的超时，不是整个关闭流程的总时长。两者相等或前者更大时，Pod 可能在应用完成关闭前被强杀，优雅停机形同虚设。即使前者更小，这个不等式也只是基本配置要求——还得为其他关闭步骤和调度开销预留时间，不能据此保证所有请求都能完成。

## 6. 小结

`run()` 是一条三段流水线：准备（Environment + 参数）→ 装配（refresh）→ 收尾（Runner + ready）；应用就绪后的关闭流程（优雅停机）见 §5。启动参数经 `ApplicationArguments` 解析后进 `Environment`，在默认配置机制下命令行属性优先级高于配置文件同名属性；启动事件链让你在 Bean 装配前后都能介入；`FailureAnalyzer` 把异常翻译成人话；优雅停机靠「graceful 开关 + 两个超时不等式」降低发版掉请求的概率。
