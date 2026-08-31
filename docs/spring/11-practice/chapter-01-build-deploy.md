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

## 6. spring-boot-maven-plugin 其他目标

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

## 7. 小结

fat jar 能自包含运行，靠的是 `repackage` 目标把依赖塞进 `BOOT-INF/lib`、把 `Main-Class` 指向 `JarLauncher`。打包时守住两条：应用模块配 `spring-boot-maven-plugin`，库模块不配；父 pom 统一用 `spring-boot-starter-parent` 管理版本。容器化部署与 GraalVM 原生镜像已独立成章，见 [容器化部署](../10-production/chapter-02-containerization.md) 与 [GraalVM 原生镜像](../10-production/chapter-03-graalvm.md)。
