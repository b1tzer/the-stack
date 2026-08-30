# 构建与部署

> `mvn package` 打出来的 jar 为什么能直接 `java -jar` 运行？答案是 `spring-boot-maven-plugin` 的 `repackage` 目标把一个「普通 jar」改造成「可执行 fat jar」。这一章讲清楚这个改造过程，以及多模块工程怎么组织才能顺畅打包。

## 1. 为什么 jar 能直接跑

普通的 jar 包依赖外置，运行时需要把一堆依赖 jar 放进 classpath，`java -cp a.jar:b.jar ...` 才能启动。Spring Boot 的产物是 fat jar（也叫 uber jar），把「自己的代码 + 所有依赖 + 一个启动器」塞进一个文件里，所以一行 `java -jar app.jar` 就能跑。

## 2. repackage 做了什么

`spring-boot-maven-plugin` 的 `repackage` 目标在 `mvn package` 阶段执行，把普通 jar 改造成 fat jar：

```xml
<plugin>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-maven-plugin</artifactId>
    <executions>
        <execution>
            <goals>
                <goal>repackage</goal>
            </goals>
        </execution>
    </executions>
</plugin>
```

两个阶段产物的区别：

| 产物 | 内容 | 能否直接运行 |
| :-- | :-- | :-- |
| 普通 jar | 只有你自己的 `.class` | ❌ 需要外置依赖 |
| fat jar | 自己的 class + 依赖 jar + 启动器 | ✅ `java -jar` 直接跑 |

## 3. fat jar 的内部结构

解开一个 fat jar，结构长这样：

```text
app.jar
├── BOOT-INF/
│   ├── classes/                     # 你自己的 .class
│   │   └── com/example/MyApplication.class
│   └── lib/                         # 所有依赖 jar
│       ├── spring-core-6.x.jar
│       ├── spring-boot-3.x.jar
│       └── ...
├── META-INF/
│   └── MANIFEST.MF
└── org/springframework/boot/loader/  # Spring Boot 的启动器类
```

`MANIFEST.MF` 里的两个关键项决定了启动方式：

```text
Main-Class: org.springframework.boot.loader.JarLauncher
Start-Class: com.example.MyApplication
```

`Main-Class` 是 `JarLauncher`，不是你的启动类。`JarLauncher` 先建一个自定义的 `LaunchedURLClassLoader`，把 `BOOT-INF/lib` 下的依赖 jar 逐个加载进来，再反射调用 `Start-Class` 的 `main`。这套「先建类加载器、再找真正的 main」的机制，是 fat jar 能自包含运行的根本原因。

## 4. 多模块工程怎么组织

拆多模块时，只有一个规则要守住：**只有最终可运行的应用模块才配 `spring-boot-maven-plugin`，被依赖的库模块不配。**

```text
demo-parent (pom)
├── demo-common        (jar，库模块，不配插件)
├── demo-service-api   (jar，库模块，不配插件)
├── demo-service       (jar，可执行，配插件)
└── demo-web           (jar，可执行，配插件)
```

父 pom 用 `spring-boot-starter-parent` 做 parent，统一管理版本：

```xml
<parent>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-parent</artifactId>
    <version>3.2.0</version>
</parent>
```

`demo-common` 这种库模块如果也配了 `repackage`，会被改造成 fat jar：`Main-Class` 变成 `JarLauncher`，其他模块引用它时无法按普通 jar 拿到里面的类，编译和运行都会出问题。所以插件只挂在 `demo-service`、`demo-web` 这类可执行模块上。

## 5. Gradle 构建

除了 Maven，Gradle 也是常用构建工具。Spring Boot 提供了对应的 Gradle 插件：

```groovy
// build.gradle
plugins {
    id 'java'
    id 'org.springframework.boot' version '3.2.0'
    id 'io.spring.dependency-management' version '1.1.4'
}

// 可执行 jar 配置
bootJar {
    archiveFileName = 'app.jar'
    mainClass = 'com.example.MyApplication'
}

// 库模块禁用 bootJar，使用普通 jar
tasks.named('jar') {
    enabled = true
}
bootJar {
    enabled = false
}
```

多模块工程中，库模块需要禁用 `bootJar` 并启用普通 `jar`，否则其他模块无法正常引用。

## 6. Docker 多阶段构建

生产部署推荐使用多阶段构建，减小镜像体积：

```dockerfile
# 阶段 1：构建
FROM maven:3.9-eclipse-temurin-17 AS build
WORKDIR /app
COPY pom.xml .
RUN mvn dependency:go-offline
COPY src ./src
RUN mvn package -DskipTests

# 阶段 2：运行
FROM eclipse-temurin:17-jre-alpine
WORKDIR /app
COPY --from=build /app/target/app.jar .
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "app.jar"]
```

镜像体积对比：

| 方式 | 体积 | 原因 |
| :-- | :-- | :-- |
| 直接用 `maven` 镜像 | ~800MB | 包含 Maven + JDK + 源码 |
| 多阶段构建 | ~200MB | 只有 JRE + fat jar |
| `jib` 插件（无 Dockerfile） | ~180MB | Google 出品，自动化最佳 |

## 7. spring-boot-maven-plugin 其他目标

除了 `repackage`，插件还有几个实用目标：

| 目标 | 作用 | 典型场景 |
| :-- | :-- | :-- |
| `repackage` | 打 fat jar | 生产打包 |
| `run` | 直接运行应用 | 开发调试，`mvn spring-boot:run` |
| `start` / `stop` | 后台启动/停止 | 集成测试前启动、测试后停止 |

```bash
# 开发时直接运行（支持热重载）
mvn spring-boot:run

# 指定 profile
mvn spring-boot:run -Dspring-boot.run.profiles=dev

# 传递 JVM 参数
mvn spring-boot:run -Dspring-boot.run.jvmArguments="-Xmx1g -Xms512m"
```

## 8. Docker 分层构建

每次改一行代码就要重新构建整个 Docker 镜像（900MB）——分层 Dockerfile 让依赖层缓存命中，构建从 5 分钟降到 30 秒。

### 8.1 Spring Boot 分层工具

```bash
# 先解压 Fat Jar
mkdir -p target/dependency
cd target/dependency
jar -xf ../my-app-1.0.0.jar

# 查看分层
java -Djarmode=layertools -jar my-app-1.0.0.jar list
# → dependencies
# → spring-boot-loader
# → snapshot-dependencies
# → application
```

### 8.2 分层 Dockerfile

```dockerfile
# 使用 Spring Boot 分层
eclipse-temurin:17-jre-jammy AS builder
WORKDIR /app
COPY target/my-app-1.0.0.jar app.jar
RUN java -Djarmode=layertools -jar app.jar extract

eclipse-temurin:17-jre-jammy
WORKDIR /app
COPY --from=builder /app/dependencies/ ./
COPY --from=builder /app/spring-boot-loader/ ./
COPY --from=builder /app/snapshot-dependencies/ ./
COPY --from=builder /app/application/ ./
ENTRYPOINT ["java", "org.springframework.boot.loader.launch.JarLauncher"]
```

`COPY` 的顺序很重要——把变化频率低的层放前面（依赖），变化频率高的层放后面（代码），这样 Docker Build Cache 才能命中。

## 9. GraalVM 原生镜像

Spring Boot 应用启动要 5 秒、内存占用 300MB——GraalVM 原生镜像让启动降到 0.1 秒、内存 50MB，但代价是构建时间长。

### 9.1 AOT 处理原理

```text
传统 JVM 模式：
  .java → .class → JVM 加载 → 反射/动态代理 → 运行
  （反射在运行时决定，无法提前优化）

GraalVM 原生镜像模式：
  .java → AOT 处理 → .class → Native Image 编译 → 原生可执行文件
  （AOT 提前分析所有反射、代理，生成初始化代码）
```

### 9.2 构建配置

```xml
<!-- 引入 Native Build Tools -->
<plugin>
    <groupId>org.graalvm.buildtools</groupId>
    <artifactId>native-maven-plugin</artifactId>
    <version>0.9.28</version>
    <executions>
        <execution>
            <id>build-native</id>
            <goals>
                <goal>compile-no-fork</goal>
            </goals>
        </execution>
    </executions>
</plugin>
```

```bash
# 构建原生镜像
mvn -Pnative native:compile

# 运行
./target/my-app  # 启动时间 ~0.1s
```

### 9.3 JVM vs Native 对比

| 特性 | JVM 模式 | GraalVM Native |
|------|:-------:|:--------------:|
| 启动时间 | 3-10 秒 | 0.05-0.5 秒 |
| 内存占用 | 200-500 MB | 30-80 MB |
| 峰值性能 | ✅ JIT 优化 | ⚠️ 无 JIT |
| 构建时间 | 30 秒 | 5-15 分钟 |
| 反射支持 | ✅ 原生 | ⚠️ 需配置 |
| 动态代理 | ✅ 原生 | ⚠️ 需配置 |

### 9.4 Spring Boot 3.x 的 AOT 支持

```java
// Spring Boot 3.x 自动处理大部分 AOT 问题
// 但自定义反射需要手动声明
@RegisterReflectionForBinding({MyDto.class, AnotherDto.class})
@SpringBootApplication
public class MyApp {}
```

::: warning 兼容性注意
GraalVM Native Image 不支持所有 Java 特性——动态类加载、`synchronized` 块、某些序列化框架都不完全兼容。在引入 Native 之前，先检查你的依赖是否支持。
:::

## 10. 小结

fat jar 能自包含运行，靠的是 `repackage` 目标把依赖塞进 `BOOT-INF/lib`、把 `Main-Class` 指向 `JarLauncher`。打包时只需守住三条：应用模块配 `spring-boot-maven-plugin`，库模块不配；父 pom 统一用 `spring-boot-starter-parent` 管理版本；Docker 部署用分层构建减小镜像体积、利用缓存加速；对启动速度和内存有极致要求的场景，考虑 GraalVM 原生镜像。
