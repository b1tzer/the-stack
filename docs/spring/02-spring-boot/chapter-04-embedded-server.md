# 内嵌容器

> 启动一个 Spring Boot Web 应用，日志里会出现 `Tomcat started on port(s): 8080`。这行字背后不是 `main()` 里 `new` 出来的 Tomcat，而是 Spring 容器初始化过程中被顺带拉起来的一个内嵌实例。本章把这行日志从 `SpringApplication.run()` 追到端口监听。

## 1. 那行日志从哪来

传统 Spring MVC 把 WAR 丢进外部 Tomcat；Spring Boot 反过来，把 Tomcat 当依赖打进 JAR，`java -jar` 启动时应用自己把它拉起来。

![Spring Boot 内嵌容器启动时序](/spring/embedded-server-startup.svg)

四个阶段——入口、容器刷新、建容器、开始监听——是主干；右侧两个虚线块是可干预点，对应「工厂从哪来」和「用户怎么插手」。

## 2. 从 `run()` 到端口监听

### 2.1 入口不在 `main()`，而在 `onRefresh()`

`main()` 里唯一一行 `SpringApplication.run(App.class, args)` 并不直接启动 Tomcat。它判断当前是 Web 应用，创建一个 `ServletWebServerApplicationContext`，然后调用 `refresh()`。

`refresh()` 是所有 Spring 应用上下文的初始化总流程，来自父类 `AbstractApplicationContext`。它内部按固定顺序调用一串模板方法，其中有一个空钩子 `onRefresh()` 留给子类扩展。`ServletWebServerApplicationContext` 重写了这个钩子：

```java
// ServletWebServerApplicationContext（源码简化）
@Override
protected void onRefresh() {
    super.onRefresh();
    try {
        createWebServer();       // 在 refresh() 的这一步把内嵌容器建起来
    } catch (Throwable ex) {
        throw new ApplicationContextException("Unable to start web server", ex);
    }
}
```

**Tomcat 是 Spring 容器初始化过程中被顺带启动的，不是 `main()` 里直接 `new` 出来的**。这解释了为什么启动期的端口冲突异常栈里总能看到 `ServletWebServerApplicationContext`。

### 2.2 `createWebServer()` 只做三件事

简化后只剩三行：

```java
// createWebServer（简化）
private void createWebServer() {
    ServletWebServerFactory factory = getWebServerFactory();          // ① 从 Spring 容器里取工厂 Bean
    this.webServer = factory.getWebServer(getSelfInitializer());      // ② 工厂造出 WebServer 实例
    // ...
    // ③ 后续 finishRefresh() 阶段调用 webServer.start()，真正开始监听
}
```

三行对应图里的 ③.1、③.2 和 ④。

**① 工厂是取来的，不是 `new` 出来的。**
`getWebServerFactory()` 从 `BeanFactory` 里按 `ServletWebServerFactory` 类型取 Bean。工厂事先已经被装配好放进容器——这是 §3 的问题，也是所有可扩展性的地基：既然是 Bean，就能被替换、被 `BeanPostProcessor` 拦截。

**② `getSelfInitializer()` 把 Servlet 注册逻辑塞给容器。**
它返回一个 `ServletContextInitializer`，负责在容器起来时把 `DispatcherServlet`、`Filter` 等注册进 `ServletContext`。没有这一步，容器绑好端口也不知道把请求转发给谁。

**③ 端口是在 `start()` 里才绑的。**
`factory.getWebServer(...)` 返回时 `WebServer` 只是「配置好」，还没监听。真正的绑端口发生在 `refresh()` 后续的 `finishRefresh()` 阶段，那一刻 `Tomcat started on port 8080` 才被打印出来。

### 2.3 主干上的两个接口

```text
ServletWebServerFactory（工厂接口，一个方法）
    getWebServer(ServletContextInitializer...) : WebServer

WebServer（容器实例接口，两个方法）
    start()
    stop()
```

`ServletWebServerApplicationContext` 从头到尾只依赖这两个接口，不直接 `import` 任何 Tomcat / Jetty 的类。换容器等于换工厂 Bean。

## 3. 工厂从哪来

`createWebServer()` 能取到工厂 Bean，是因为 `ServletWebServerFactoryAutoConfiguration` 事先注册好了。它用条件注解按 classpath 依赖选型：

```java
// ServletWebServerFactoryAutoConfiguration（源码简化，只保留 Tomcat 分支）
@AutoConfiguration
@ConditionalOnClass(ServletRequest.class)
@EnableConfigurationProperties(ServerProperties.class)
public class ServletWebServerFactoryAutoConfiguration {

    @Bean
    @ConditionalOnClass(name = "org.apache.catalina.startup.Tomcat")   // classpath 上有 Tomcat 才注册
    @ConditionalOnMissingBean(value = ServletWebServerFactory.class)   // 用户没自己声明工厂才注册
    public TomcatServletWebServerFactory tomcatServletWebServerFactory() {
        return new TomcatServletWebServerFactory();
    }
    // Jetty、Undertow 的工厂方法结构相同，只是 @ConditionalOnClass 换成各自的入口类
}
```

两条注解各自承担一件事：

- `@ConditionalOnClass` 决定「哪个工厂被注册」。默认 `spring-boot-starter-web` 带 Tomcat，命中 Tomcat 分支。
- `@ConditionalOnMissingBean` 决定「自动配置什么时候让路」。用户自己声明 `ServletWebServerFactory` Bean 时，这里就不再注册——这是 §4.2 自定义能生效的根本原因。

闭环：自动配置产出工厂 Bean → `createWebServer()` 取走工厂 → 工厂造出 `WebServer` → `start()` 绑端口。

## 4. 三种动手场景

### 4.1 改配置

九成场景到这一步就够了。`server.*` 前缀的配置绑到 `ServerProperties`，工厂 Bean 创建时读取：

```yaml
server:
  port: 9090
  servlet:
    context-path: /api
  tomcat:
    threads:
      max: 200
    max-connections: 8192
```

生效路径：`@EnableConfigurationProperties(ServerProperties.class)` 把 `ServerProperties` 变成 Bean → Tomcat 工厂 Bean 初始化时读取它 → `createWebServer()` 拿到的工厂已经带上这些值。

### 4.2 `WebServerFactoryCustomizer`

需要动 `Connector`、SSL 底层参数或注册 `LifecycleListener` 时，配置属性覆盖不到，用 `WebServerFactoryCustomizer`：

```java
@Component
public class TomcatCustomizer implements WebServerFactoryCustomizer<TomcatServletWebServerFactory> {

    @Override
    public void customize(TomcatServletWebServerFactory factory) {
        factory.addConnectorCustomizers(connector ->
            connector.setProperty("maxKeepAliveRequests", "200"));
    }
}
```

生效时机对应图里 ③.1 和 ③.2 之间那条虚线：`WebServerFactoryCustomizerBeanPostProcessor` 在工厂 Bean 初始化后、被 `getWebServerFactory()` 取走**之前**，扫描所有 `WebServerFactoryCustomizer` Bean，逐个调用 `customize(factory)`。

::: warning 定制只在启动期一次
`WebServerFactoryCustomizer` 作用于工厂，而工厂只用于「造这一次容器」。运行期动态改端口、动态热切换 SSL 证书，都不是它的职责。
:::

### 4.3 换容器

把 Tomcat 换成 Jetty，只改依赖：

```xml
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-web</artifactId>
    <exclusions>
        <exclusion>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter-tomcat</artifactId>
        </exclusion>
    </exclusions>
</dependency>

<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-jetty</artifactId>
</dependency>
```

对应 §3：Tomcat 类从 classpath 消失，`@ConditionalOnClass` 不再命中 Tomcat 分支；Jetty 类出现，Jetty 分支的工厂方法生效。主干代码（图里 ① 到 ④）一行不改。

::: warning 切换的合理理由
三个内嵌容器在绝大多数业务里性能差异不是瓶颈。切换的常见理由是团队熟悉度或撞上某个容器的已知问题，而不是「另一个更快」这种模糊判断。
:::

关于 `refresh()` 前后完整的启动流程，见 [启动流程与启动参数](./chapter-05-startup.md)；关于 `server.*` 配置绑定的全貌，见 [配置体系](./chapter-03-configuration.md)。
