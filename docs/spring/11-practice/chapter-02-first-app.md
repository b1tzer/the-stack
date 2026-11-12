---
type: tutorial
level: basic
---

# 第一个 Spring Boot 应用

> 前置条件：会使用命令行，本机装有 JDK 17 或更高版本、Maven 3.6 或更高版本。不需要会 Spring。

这一页带你从零写一个能返回 JSON 的 HTTP 接口。不依赖 start.spring.io 生成器（它已不再提供 Spring Boot 3.x），改为手写一个最小 `pom.xml`，每个步骤都给出预期输出，做完就能对照验证。

## 1. 建项目文件

新建一个目录 `demo`，在里面放 `pom.xml`：

```xml
<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 https://maven.apache.org/xsd/maven-4.0.0.xsd">
    <modelVersion>4.0.0</modelVersion>

    <parent>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-starter-parent</artifactId>
        <version>3.5.13</version>
        <relativePath/>
    </parent>

    <groupId>com.example</groupId>
    <artifactId>demo</artifactId>
    <version>0.0.1-SNAPSHOT</version>
    <name>demo</name>

    <properties>
        <java.version>17</java.version>
    </properties>

    <dependencies>
        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter-web</artifactId>
        </dependency>
    </dependencies>

    <build>
        <plugins>
            <plugin>
                <groupId>org.springframework.boot</groupId>
                <artifactId>spring-boot-maven-plugin</artifactId>
            </plugin>
        </plugins>
    </build>
</project>
```

`spring-boot-starter-parent` 负责统一所有依赖的版本，这里只声明一个 `spring-boot-starter-web`，它就带上了内嵌 Tomcat、Spring MVC 和 JSON 序列化。第一次构建会下载依赖，需要联网。

## 2. 写启动类

`src/main/java/com/example/DemoApplication.java`：

```java
package com.example;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication
public class DemoApplication {
    public static void main(String[] args) {
        SpringApplication.run(DemoApplication.class, args);
    }
}
```

`@SpringBootApplication` 是三个注解的组合，其中的 `@ComponentScan` 会扫描 `com.example` 包及其子包里的组件。

## 3. 写第一个接口

先定义一个返回类型 `src/main/java/com/example/Greeting.java`：

```java
package com.example;

public record Greeting(String name, String message) {}
```

再写控制器 `src/main/java/com/example/GreetingController.java`：

```java
package com.example;

import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/greetings")
public class GreetingController {

    private final List<Greeting> greetings = new CopyOnWriteArrayList<>();

    @GetMapping
    public List<Greeting> list() {
        return greetings;
    }

    @PostMapping
    public Greeting create(@RequestBody Greeting greeting) {
        greetings.add(greeting);
        return greeting;
    }
}
```

数据先放在内存列表里，重启会清空；要落到数据库，看 [JPA 与数据访问](../04-data-access/chapter-03-jpa.md)。

## 4. 运行并验证

在 `demo` 目录下运行：

```bash
mvn spring-boot:run
```

日志末尾出现 `Started DemoApplication in ...` 就说明启动成功，默认监听 8080 端口。新开一个终端验证：

```bash
curl http://localhost:8080/api/greetings
```

输出空列表：

```text
[]
```

发一条 POST：

```bash
curl -X POST http://localhost:8080/api/greetings \
  -H "Content-Type: application/json" \
  -d '{"name":"alice","message":"hello"}'
```

输出刚写入的对象：

```text
{"name":"alice","message":"hello"}
```

再 GET 一次：

```text
[{"name":"alice","message":"hello"}]
```

## 5. 常见问题

- **端口被占用**：日志出现 `Port 8080 was already in use`。换端口再跑：`mvn spring-boot:run -Dspring-boot.run.arguments=--server.port=8081`。
- **POST 返回 415**：请求没带 `Content-Type: application/json`，Spring 不知道按 JSON 解析请求体。
- **JDK 版本太低**：启动报 `UnsupportedClassVersionError`。Spring Boot 3.5 需要 JDK 17 到 25。
- **依赖下载慢或失败**：检查网络或换 Maven 镜像；首次运行要拉取较多依赖。

读完这一页，你应该能独立建一个 Spring Boot 项目、写一个返回 JSON 的接口并用 curl 验证，也知道启动失败时先查端口、JDK 和 Content-Type 这三处。

下一步可以看 [自动配置原理](../02-spring-boot/chapter-01-autoconfiguration.md)，理解 `@SpringBootApplication` 背后发生了什么。
