# 建造者模式

## 1. 🏠 生活类比

点奶茶：大杯/中杯/小杯 + 去冰/少冰/正常冰 + 三分糖/五分糖/全糖 + 珍珠/椰果。

你不需要记所有组合，一步步选就行。

## 2. 💩 烂代码

```java
// 构造函数参数爆炸
new User("张三", 25, "zhangsan@example.com", "13800138000", 
         "北京市", "朝阳区", "xxx街道", "100000");
// 谁知道第 4 个参数是啥？
```

## 3. ✨ 建造者模式

```java
User user = User.builder()
    .name("张三")
    .age(25)
    .email("zhangsan@example.com")
    .build();
```

## 4. ✨ 实现

```java
import java.util.Objects;

public class User {
    private final String name;
    private final int age;
    private final String email;
    
    private User(Builder builder) {
        this.name = builder.name;
        this.age = builder.age;
        this.email = builder.email;
    }
    
    public static Builder builder() { return new Builder(); }
    
    public static class Builder {
        private String name;
        private int age;
        private String email;
        
        public Builder name(String name) { this.name = name; return this; }
        public Builder age(int age) { this.age = age; return this; }
        public Builder email(String email) { this.email = email; return this; }
        
        public User build() {
            Objects.requireNonNull(name, "name");
            Objects.requireNonNull(email, "email");
            if (age < 0) {
                throw new IllegalArgumentException("age must be >= 0");
            }
            return new User(this);
        }
    }
}
```

`final` 只保证字段赋值后不可变，不保证对象有效。校验放在 `build()`，是因为构造方法是 `private` 的，所有创建都经过 Builder 这一条路径。

## 5. 🔧 框架应用

- Spring: `BeanDefinitionBuilder`
- JDK: `Stream.Builder`（典型的 Builder API）、`StringBuilder`（相似的逐步构建用法，主要解决字符串拼接）
- Lombok: `@Builder`

## 6. ⚠️ 适用场景

- 参数较多且部分可选
- 创建表达式难以阅读
- 需要不可变对象

参数数量只是经验提示，不是硬性门槛。参数少且含义清晰时，优先用构造方法或静态工厂；参数虽多但全部必填、顺序清晰时，也不必强上建造者。
