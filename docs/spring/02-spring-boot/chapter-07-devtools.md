# DevTools 热部署

> 改一行 Java 代码，传统做法是停掉应用重新 `java -jar`。DevTools 把这个「停掉重来」缩短成一次应用上下文的快速重建，代价是开发期多引入一个依赖。真正要理解的是它的触发边界，哪些文件变化会重启、哪些只会刷新浏览器。

## 1. 原理

DevTools 用两个 ClassLoader 把类分成两类：

- **Base ClassLoader** 加载第三方 jar，这些类在开发期几乎不变
- **Restart ClassLoader** 加载 `target/classes` 下的项目代码，随时会变

检测到符合条件的 classpath 变化后，DevTools 丢弃旧的 Restart ClassLoader、新建实例，并重新启动应用上下文。Base ClassLoader 及其加载的类不动，需要重建的类少，因此通常比重新启动整个 JVM 更快。

容易混淆的一点：**DevTools 的「重启」不是重启 JVM，而是重建 Restart ClassLoader 并重启应用上下文**。它省掉的是加载全部第三方依赖、重新初始化 JVM 这部分时间，而不是省掉整个启动流程。

## 2. 引入依赖

DevTools 是开发期工具，Maven 项目把依赖声明为 `<optional>true</optional>`，避免被下游模块传递引入：

```xml
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-devtools</artifactId>
    <optional>true</optional>
</dependency>
```

Gradle 项目用 `developmentOnly` 达到同样效果：

```groovy
dependencies {
    developmentOnly 'org.springframework.boot:spring-boot-devtools'
}
```

## 3. LiveReload

DevTools 内置 LiveReload 服务器。启用自动重启且浏览器插件已连接后，被监测到的资源变化可以触发浏览器刷新。

> 本文以 Spring Boot 3.x 为基线。LiveReload 自 Spring Boot 4.1.0 起弃用，无替代方案。

## 4. 自动重启的触发机制

自动重启不是「改任何文件都重启」，它有明确的触发边界：

| 变更类型 | 触发行为 |
| :-- | :-- |
| classpath 下被监视到且未被排除的 `.class` 与配置文件变化 | 触发 restart（重建 Restart ClassLoader） |
| `/META-INF/maven`、`/META-INF/resources`、`/resources`、`/static`、`/public`、`/templates`、`**/*Test.class`、`git.properties` 等默认排除路径 | 不触发 restart；若 LiveReload 已启用且客户端已连接，可能触发浏览器刷新 |

默认排除列表里有两个容易忽略的项，测试类（`**/*Test.class`、`**/*Tests.class`）和构建元数据 `git.properties`。改了测试类不会触发重启，这是设计行为而非 bug。

### 4.1 文件监视器如何工作

DevTools 靠轮询检测变化，而不是监听文件系统事件。它每隔 `poll-interval` 扫一次 classpath 目录，发现变化后再等一个 `quiet-period` 静默期，确认没有更多文件落盘才触发重启：

```properties
spring.devtools.restart.poll-interval=1s    # 轮询间隔，默认 1s
spring.devtools.restart.quiet-period=400ms  # 静默期，默认 400ms
```

静默期存在的原因，是 IDE 编译往往一批 class 文件先后落盘，如果发现第一个变化就立刻重启，后面的文件还没写完，重启就会读到不完整的 classpath。`quiet-period` 把连续变化合并成一次重启。网络磁盘慢、IDE 编译慢导致频繁重启或重启过早时，调大这两个值。自动重启默认开启，用 `spring.devtools.restart.enabled=false` 可以整体关闭。

### 4.2 触发文件 trigger-file

IDE 开启自动编译后，一次保存可能触发多次编译事件，DevTools 随之连续重启。用 `trigger-file` 指定一个文件当开关，只有它变化才触发重启：

```properties
spring.devtools.restart.trigger-file=.restart
```

之后想重启就 `touch .restart`，平时编译输出再变也不会误触发。适合多人项目，或不想被频繁重启打断的场景。

### 4.3 排除与额外监视

DevTools 默认监视 classpath 中的目录条目，被监视到且未被排除的变化触发 restart，默认排除路径的变化不触发 restart，静态资源与模板的修改不需要重启应用上下文。通过 `additional-paths` 可以监视 classpath 之外的目录，通过 `additional-exclude` 在默认排除列表基础上追加：

```properties
# application.properties
spring.devtools.restart.additional-exclude=custom-dir/**  # 在默认排除列表基础上追加排除路径
spring.devtools.restart.additional-paths=src/main/conf    # 额外监视的非 classpath 路径
```

`exclude` 和 `additional-exclude` 的区别要分清，`exclude` 替换整个默认列表，`additional-exclude` 在默认列表上追加。只想多排除一个目录时用后者，否则默认排除的静态资源和测试类会重新开始触发重启。

## 5. 使用注意事项

1. **生产环境禁用 DevTools**。依赖声明为 `<optional>true</optional>` 可避免下游模块传递引入；Spring Boot 打包插件默认会从重新打包的归档中排除 DevTools，不要在生产环境强制启用
2. **修改后没有生效，先检查文件是否被监视**。Java 代码要先编译成 classpath 上的 `.class`，DevTools 才检测得到。IDEA 默认不自动编译，需要手动构建（`Cmd+F9` 或 `Ctrl+F9`）或开启 `Build project automatically`；Eclipse 保存即编译。静态资源与模板则检查排除规则、LiveReload 配置及浏览器连接状态

::: warning 反序列化与重启的冲突
DevTools 重启会更换 Restart ClassLoader，使用标准 `ObjectInputStream` 反序列化的对象会因此失败，因为反序列化拿到的还是旧 ClassLoader 的类定义。需要反序列化的场景应改用 Spring 的 `ConfigurableObjectInputStream`，配合 `Thread.currentThread().getContextClassLoader()`。这是官方文档明确记录的已知限制。
:::

## 6. 全局配置

多个项目想统一 trigger-file 或轮询参数时，把配置放到 `$HOME/.config/spring-boot/spring-boot-devtools.properties`，对本机所有使用 DevTools 的应用生效。该文件不支持 profile，也不要放 profile 相关的分段。
