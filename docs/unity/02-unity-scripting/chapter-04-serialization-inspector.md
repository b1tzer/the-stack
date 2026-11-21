---
type: explanation
level: basic
---

# Unity 的 C# 约定：序列化与 Inspector

你在脚本里写的 `public float speed` 会出现在 Inspector 里，还能拖拽赋值。读完这一篇，你能说清 Unity 的序列化规则：哪些字段会显示在 Inspector、怎么控制显示、哪些类型能序列化，以及这个机制为什么重要。

## 1. Inspector 为什么会显示字段

Unity 有个叫**序列化（Serialization）** 的机制：把脚本里符合规则的字段保存到磁盘，并在 Inspector 里显示出来供你编辑。

当你写：

```csharp
public class PlayerMovement : MonoBehaviour
{
    public float speed = 5f;
}
```

`speed` 是 public 字段，Unity 会把它序列化，于是 Inspector 里出现一个 `Speed` 输入框。你在编辑器里把 5 改成 10，运行时 `speed` 就是 10，**覆盖了脚本里的默认值**。

![Inspector 里显示脚本组件的序列化字段：Example (Script) 下的 My Name 是可编辑字段](/unity/02-unity-scripting-chapter-04-inspector-fields.png)

*图源：[Unity 官方文档](https://docs.unity3d.com/6000.3/Documentation/Manual/script-Serialization.html)*

这带来一个好处：调参不用改代码。移动速度、跳跃力度、血量这些"希望美术或策划也能调"的数值，暴露到 Inspector 里，改完立刻看效果。

## 2. 控制字段是否显示

### 2.1 public 字段：默认显示

```csharp
public float speed;      // 显示在 Inspector
```

### 2.2 私有字段：用 [SerializeField] 显示

只想在 Inspector 里调、不想让其他类随便改，用私有字段加特性：

```csharp
[SerializeField]
private float speed = 5f;   // 私有，但仍显示在 Inspector
```

这是推荐做法：默认用 `private` + `[SerializeField]`，只有确实需要被其他类访问的字段才用 `public`。它兼顾了封装（外部不能随意改）和可调性（Inspector 能调）。

### 2.3 用 [HideInInspector] 隐藏 public 字段

反过来，public 字段不想显示，加 `[HideInInspector]`：

```csharp
[HideInInspector]
public float cache;   // 对外公开，但不出现在 Inspector
```

## 3. 哪些类型能被序列化

不是所有字段都能在 Inspector 里显示。Unity 支持序列化的类型包括：

- 基础类型：`int`、`float`、`bool`、`string`、`double` 等。
- Unity 结构体：`Vector2`、`Vector3`、`Color`、`Quaternion`。
- 引用类型：`GameObject`、`Transform`、`MonoBehaviour`、`ScriptableObject` 等（可在 Inspector 里拖拽赋值）。
- 上述类型的**数组**和 `List<T>`。

**不能序列化**的常见情况：

- `Dictionary<TKey, TValue>`：不支持，需要额外处理。
- 属性（Property）：`public float Speed { get; set; }` 不会显示，只有字段（field）才序列化。
- `static` 字段：属于类型而非实例，不序列化。
- 自定义类默认不序列化，除非加上 `[System.Serializable]`。

## 4. Inspector 里拖拽赋值：引用类型

引用类型字段最有用的是**拖拽赋值**。例如：

```csharp
[SerializeField]
private GameObject player;
```

Inspector 里会出现一个 `Player` 槽位，把场景里的玩家物体拖进去，脚本里就能用 `player` 引用它，而不需要写 `GameObject.Find`。这比运行时查找更直观、更快、更不易出错。

## 5. 序列化的另一个作用：场景保存

序列化不只是"显示在 Inspector"。你在 Inspector 里改的数值、拖进去的引用，都会随**场景文件**一起保存。下次打开项目，这些值还在。

这也解释了为什么"运行时改的值不会保存"：你在 Play 模式下改 Inspector 数值，退出 Play 后会恢复。因为运行时修改的是内存里的副本，没有写回场景文件。要在运行中持久化数据，需要用 [数据持久化](../05-engineering/chapter-03-data-persistence.md) 里的手段。

## 6. 动手验证

1. 打开之前的 `PlayerMovement` 脚本，把 `speed` 改成 `[SerializeField] private float speed = 5f;`。
2. 回到编辑器，等脚本编译完成，看 Inspector 里 `Speed` 输入框仍然在。
3. 在 Play 前把 Speed 改成 10，运行后物体移动明显变快。
4. 退出 Play，把 Speed 改成 2 再运行，验证 Inspector 的值确实在覆盖脚本默认值。

## 7. 下一步

到这里，「Unity 脚本基础」结束。你已经会写脚本、读输入、调参数。下一篇进入核心概念，理解场景和坐标系统：[场景、坐标系与 Transform](../03-scene-core/chapter-01-scene-transform.md)。
