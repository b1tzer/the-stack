---
type: explanation
level: intermediate
---

# 数据持久化：PlayerPrefs / JSON / ScriptableObject

你需要在游戏里保存数据——最高分、音量设置、玩家存档、敌人配置。读完这一篇，你能说清 Unity 的三种数据持久化手段各自适合什么场景，并写出 JSON 存档。

## 1. 三种手段，三种场景

Unity 保存数据主要有三种方式，先看对比，再逐个深入：

| 手段 | 存什么 | 适合 | 不适合 |
| --- | --- | --- | --- |
| **PlayerPrefs** | 简单键值对 | 音量、最高分、是否通关等少量设置 | 复杂结构、大量数据 |
| **JSON 文件** | 结构化数据 | 游戏存档、玩家属性、背包等 | 极高频读写 |
| **ScriptableObject** | 编辑器资产 | 静态配置（敌人参数、武器数据、关卡配置） | 运行时要改的存档 |

选择原则：**少量简单设置用 PlayerPrefs，复杂存档用 JSON 文件，静态配置用 ScriptableObject**。

## 2. PlayerPrefs：简单键值对

PlayerPrefs 是 Unity 内置的键值存储，用起来最简单：

```csharp
PlayerPrefs.SetInt("HighScore", 100);       // 存整数
PlayerPrefs.SetFloat("Volume", 0.8f);       // 存浮点
PlayerPrefs.SetString("PlayerName", "Alex"); // 存字符串

int score = PlayerPrefs.GetInt("HighScore", 0);   // 读，不存在时返回默认值 0
PlayerPrefs.Save();   // 立即写入磁盘
```

数据存在系统规定的位置（Windows 在注册表、macOS 在 `~/Library/Preferences`）。`GetInt` 的第二个参数是键不存在时返回的默认值。

PlayerPrefs 的局限：

- 只能存 int、float、string 三种类型。
- 存复杂数据（背包列表、玩家属性）要手动序列化成字符串，很别扭。
- 数据明文可被玩家轻易修改，不适合防作弊的关键数据。

所以 PlayerPrefs 只用于"丢了也无所谓"的设置项。

## 3. JSON 文件：结构化存档

存档数据通常是一组有结构的信息（玩家等级、背包、任务进度），用 JSON 序列化 + 文件读写最合适。

先定义一个可序列化的存档类：

```csharp
[System.Serializable]
public class SaveData
{
    public int level;
    public int coins;
    public List<string> inventory;
}
```

用 `JsonUtility` 序列化和反序列化：

```csharp
using System.IO;
using UnityEngine;

public class SaveSystem : MonoBehaviour
{
    private string path;

    void Start()
    {
        path = Path.Combine(Application.persistentDataPath, "save.json");
    }

    public void Save(SaveData data)
    {
        string json = JsonUtility.ToJson(data);   // 对象 → JSON 字符串
        File.WriteAllText(path, json);
    }

    public SaveData Load()
    {
        if (!File.Exists(path)) return new SaveData();   // 首次无存档
        string json = File.ReadAllText(path);
        return JsonUtility.FromJson<SaveData>(json);     // JSON → 对象
    }
}
```

两个关键点：

- **`Application.persistentDataPath`**：持久化数据目录，各平台不同，但都是"应用卸载前一直保留"的位置。不要硬编码路径，用它。
- **`[System.Serializable]`**：存档类必须加这个特性，`JsonUtility` 才能序列化它。

`JsonUtility` 的局限是不支持顶层数组和 `Dictionary`。需要这些时用第三方库（如 Newtonsoft.Json），但初学者先用 `JsonUtility` 够用。

## 4. ScriptableObject：静态配置

配置数据（每种敌人的血量、每种武器的伤害）不该硬编码在脚本里，也不该做成场景里的物体。ScriptableObject 是"数据资产"，在编辑器里像普通资源一样创建和编辑。

```csharp
using UnityEngine;

[CreateAssetMenu(fileName = "EnemyConfig", menuName = "Game/Enemy Config")]
public class EnemyConfig : ScriptableObject
{
    public string enemyName;
    public int health;
    public float speed;
    public float attackDamage;
}
```

创建：Project 右键 → **Create → Game → Enemy Config**，生成一个 `.asset` 文件。在 Inspector 里填好数值，然后让脚本引用它：

```csharp
public class Enemy : MonoBehaviour
{
    public EnemyConfig config;   // Inspector 里拖入配置资产

    void Start()
    {
        health = config.health;
    }
}
```

好处：同一个 `EnemyConfig` 资产可以被多个敌人引用，改资产就改所有引用它的敌人；不同敌人用不同资产即可。这让"调数值"从"改代码"变成"改资产"，策划也能做。

## 5. 三种手段组合使用

一个完整游戏的存档方案通常是组合：

- **ScriptableObject**：存敌人的血量、速度等静态配置，策划在编辑器里调。
- **PlayerPrefs**：存音量、画质等少量设置。
- **JSON 文件**：存玩家存档（等级、背包、进度），运行时读写。

运行时修改的数据（存档）和编辑器里配置的数据（ScriptableObject）要分开——ScriptableObject 在运行时改的值不会自动保存回资产文件，它本质上是"只读配置"。

## 6. 动手验证

1. 写一个 `SaveData` 类和 `SaveSystem`，在游戏里改几个值（金币、等级），调用 `Save`。
2. 停止运行再重新运行，调用 `Load` 读回数值，验证数据确实持久化了。
3. 用 `Application.persistentDataPath` 打印出存档文件的实际位置，去磁盘上找到 `save.json` 打开看内容。

**成功标志**：退出运行后重新运行，之前保存的数值能读回来；磁盘上能找到对应的 JSON 文件。

## 7. 下一步

数据能存了。下一步学会在项目出问题时定位和排查：[调试与 Profiler](./chapter-04-debugging-profiler.md)。
