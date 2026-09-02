# DevTools 热部署

## 1. 原理

DevTools 使用双 ClassLoader：
- Base ClassLoader：加载第三方 jar
- Restart ClassLoader：加载项目代码

代码变化时只重启 Restart ClassLoader，速度极快。

## 2. 配置

```xml
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-devtools</artifactId>
    <optional>true</optional>
</dependency>
```

## 3. LiveReload

DevTools 内置 LiveReload 服务器，浏览器安装插件后自动刷新。

## 4. 自动重启的触发机制

自动重启不是「改任何文件都重启」，它有明确的触发边界：

| 变更类型 | 触发行为 |
| :-- | :-- |
| classpath 下的 `.class` 与配置文件变化 | 触发 restart（重建 Restart ClassLoader） |
| `/static`、`/public`、`/templates` 等静态资源变化 | 只触发 LiveReload（浏览器刷新），不重启 |
| `/META-INF/maven`、`/META-INF/resources` | 默认忽略，不触发任何动作 |

这个边界由 DevTools 的文件监视器判断：它监视 classpath 上的目录，只有被 Restart ClassLoader 加载的项目代码变化才触发 restart；静态资源归 LiveReload 管，因为改一个页面不值得重启整个 JVM。

```properties
# application.properties
spring.devtools.restart.enabled=true                    # 是否启用自动重启（默认 true）
spring.devtools.restart.exclude=static/**,public/**     # 额外排除、不触发重启的路径
spring.devtools.restart.additional-paths=src/main/conf  # 额外监视的非 classpath 路径
```

## 5. 最佳实践

1. **生产环境禁用 DevTools**——依赖声明为 `<optional>true</optional>`，确保它不会传递到生产环境
2. **区分重启与刷新**——只有项目代码变化才需要 restart，静态资源变化交给 LiveReload
3. **LiveReload 浏览器插件**——前端资源变更自动刷新，无需手动刷新页面
