---
type: howto
level: intermediate
---

# System.Text.Json：序列化与反序列化

本页说明如何用 `System.Text.Json` 在对象和 JSON 之间转换，配置命名和忽略规则，以及如何自定义。前置：会 C# 类型和属性（见[面向对象](./chapter-04-oop.md)）。

## 1. 基本序列化

`JsonSerializer.Serialize` 把对象转成 JSON，`Deserialize` 反向：

```csharp
var order = new Order { Id = 1, Total = 99.9m };
string json = JsonSerializer.Serialize(order);
// {"Id":1,"Total":99.9}

var back = JsonSerializer.Deserialize<Order>(json);
```

默认情况下，属性名按原样输出（PascalCase），这是 `System.Text.Json` 的默认约定。

## 2. 命名与忽略

Web API 通常用 camelCase（小驼峰），用 `JsonSerializerOptions` 配置：

```csharp
var options = new JsonSerializerOptions
{
    PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
    WriteIndented = true,
    DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
};

string json = JsonSerializer.Serialize(order, options);
// {"id":1,"total":99.9}（Total 为 null 时省略）
```

`DefaultIgnoreCondition` 设为 `WhenWritingNull` 会省略 `null` 属性，减少响应体积。ASP.NET Core 默认就用 camelCase。

## 3. 属性控制

用特性按属性定制：

```csharp
class User
{
    public string Name { get; set; }

    [JsonIgnore]                    // 不序列化
    public string PasswordHash { get; set; }

    [JsonPropertyName("displayName")] // 改名
    public string DisplayName { get; set; }
}
```

`[JsonIgnore]` 排除敏感字段（如密码哈希），`[JsonPropertyName]` 覆盖属性名。特性是声明式、与类绑定的配置，适合「这个类型固定如此」的场景。

## 4. 枚举与字符串

默认枚举序列化为数字。需要可读性时转成字符串：

```csharp
var options = new JsonSerializerOptions
{
    Converters = { new JsonStringEnumConverter() }
};
```

`JsonStringEnumConverter` 把枚举序列化为名称而不是数字，便于阅读和调试，但反序列化时对名称大小写敏感。

## 5. 自定义转换器

需要特殊序列化逻辑时，实现 `JsonConverter<T>`：

```csharp
class DateTimeConverter : JsonConverter<DateTime>
{
    public override DateTime Read(ref Utf8JsonReader reader, Type typeToConvert,
        JsonSerializerOptions options) => DateTime.Parse(reader.GetString());

    public override void Write(Utf8JsonWriter writer, DateTime value,
        JsonSerializerOptions options) => writer.WriteStringValue(value.ToString("yyyy-MM-dd"));
}
```

自定义转换器适合「某个类型有统一的特殊格式」。注意转换器会应用于该类型的所有出现位置。

## 6. 源码生成器

反射序列化有运行时开销，`System.Text.Json` 提供源码生成器，编译期生成序列化代码：

```csharp
[JsonSerializable(typeof(Order))]
internal partial class AppJsonContext : JsonSerializerContext { }

string json = JsonSerializer.Serialize(order, AppJsonContext.Default.Order);
```

源码生成器省去反射，提升性能，且支持 AOT（见[JIT 与 AOT](../02-dotnet-runtime/chapter-04-jit-aot.md)）。性能敏感的序列化或 AOT 场景用它。

## 7. 失败信号

- 反序列化时 JSON 结构与类型不匹配：属性被忽略或抛 `JsonException`，检查 JSON 是否与模型对应。
- 大小写不一致（默认区分大小写）：`PropertyNameCaseInsensitive = true` 可放宽。
- 未知字段默认被忽略，不会报错。

## 8. 后续阅读

- [特性](./chapter-06-attributes.md)解释 `[JsonIgnore]` 等特性的机制。
- [反射](./chapter-12-reflection.md)解释默认序列化如何用反射。
- [ASP.NET Core 配置与日志](../04-aspnet-core/chapter-06-configuration-logging.md)解释 Web 里的 JSON 配置。

> 本页的技术边界按 .NET 10 / C# 14 核对；`System.Text.Json` 自 .NET Core 3.0 引入，是 .NET 默认序列化库。官方参考：[System.Text.Json](https://learn.microsoft.com/en-us/dotnet/standard/serialization/system-text-json/)。
