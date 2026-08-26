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
    .address(Address.builder()
        .city("北京")
        .district("朝阳区")
        .build())
    .build();
```

## 4. ✨ 实现

```java
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
        public User build() { return new User(this); }
    }
}
```

## 5. 🔧 框架应用

- Spring: `BeanDefinitionBuilder`
- JDK: `StringBuilder`、`Stream.Builder`
- Lombok: `@Builder`

## 6. ⚠️ 适用场景

- 参数多（>4 个）
- 参数可选
- 需要不可变对象
