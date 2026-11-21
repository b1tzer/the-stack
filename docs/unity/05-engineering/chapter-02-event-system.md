---
type: explanation
level: intermediate
---

# 事件系统与解耦

你知道脚本之间要解耦，但"玩家死亡"要同时通知 UI、音效、敌人 AI、存档系统，难道让玩家脚本挨个调用它们吗？读完这一篇，你能说清事件如何解耦，并搭一个简单的全局事件系统。

## 1. 直接调用带来的耦合

看一个典型场景：玩家死亡时，需要：

- 更新 UI 显示"游戏结束"
- 播放死亡音效
- 通知敌人停止攻击
- 存档系统记录

用直接引用，玩家脚本得持有这四个对象的引用，挨个调用：

```csharp
void Die()
{
    ui.ShowGameOver();      // 耦合 UI
    audio.PlayDeathSound(); // 耦合音效
    enemyAI.StopAll();      // 耦合敌人
    saveSystem.Record();    // 耦合存档
}
```

问题很明显：玩家脚本要知道 UI、音效、敌人、存档这些对象的存在。每加一个新系统（比如成就系统），就要改玩家脚本。这就是**耦合**——玩家脚本被迫依赖它本不该关心的东西。

## 2. 事件：只广播，不点名

事件把这个关系倒过来：玩家死亡时只发出一个"我死了"的信号，**不关心谁在听**。谁需要响应，谁自己订阅。

```csharp
using System;

public class PlayerHealth : MonoBehaviour
{
    // 声明一个事件：玩家死亡时触发
    public static event Action OnPlayerDied;

    void Die()
    {
        OnPlayerDied?.Invoke();   // 广播"玩家死了"，不点名通知谁
    }
}
```

其他系统各自订阅：

```csharp
public class UIManager : MonoBehaviour
{
    void OnEnable()  => PlayerHealth.OnPlayerDied += ShowGameOver;
    void OnDisable() => PlayerHealth.OnPlayerDied -= ShowGameOver;

    void ShowGameOver() { /* 显示游戏结束 */ }
}
```

现在玩家脚本不知道 UI、音效、敌人、存档的存在。加成就系统时，只需让成就系统订阅事件，**玩家脚本一行都不用改**。

## 3. 事件的三个要点

- **声明**：`public static event Action OnPlayerDied;`。`Action` 是无参无返回值的委托，事件类型还有很多（带参数的 `Action<int>`、自定义委托等）。
- **触发**：`OnPlayerDied?.Invoke()`。`?.` 表示"有订阅者才调用"，没人订阅也不会报错。
- **订阅/退订**：`+=` 订阅，`-=` 退订。退订和订阅必须配对，通常放 `OnEnable`/`OnDisable`，否则对象销毁后事件还会尝试调用它，导致空引用。

## 4. 用 static 事件 vs 实例事件

上面的 `OnPlayerDied` 是 `static` 事件，任何脚本都能订阅，不用先拿到玩家引用。优点是方便；缺点是全局状态，项目大了之后事件满天飞，难以追踪。

更克制的做法是用**实例事件**，订阅者需要先拿到发布者的引用：

```csharp
public event Action OnDied;   // 实例事件

[SerializeField] private PlayerHealth player;   // 订阅者注入发布者引用

void OnEnable()  => player.OnDied += HandleDeath;
void OnDisable() => player.OnDied -= HandleDeath;
```

实例事件更清晰，但要求订阅者持有发布者引用。折中方案：对少数全局事件（玩家死亡、游戏暂停）用 static，其余用实例事件。

## 5. 搭一个简单的全局事件系统

项目里事件多了，可以集中管理，避免散落各处的 static 事件。一个最小实现：

```csharp
using System;
using System.Collections.Generic;

public static class GameEvents
{
    private static Dictionary<string, Action> events = new Dictionary<string, Action>();

    public static void Subscribe(string name, Action handler)
    {
        if (events.TryGetValue(name, out var existing))
            events[name] = existing + handler;
        else
            events[name] = handler;
    }

    public static void Unsubscribe(string name, Action handler)
    {
        if (events.TryGetValue(name, out var existing))
            events[name] = existing - handler;
    }

    public static void Publish(string name)
    {
        if (events.TryGetValue(name, out var existing))
            existing?.Invoke();
    }
}
```

用法：

```csharp
GameEvents.Subscribe("PlayerDied", ShowGameOver);   // 订阅
GameEvents.Publish("PlayerDied");                    // 触发
GameEvents.Unsubscribe("PlayerDied", ShowGameOver);  // 退订
```

这个实现用字符串当事件名，没有编译期检查，名字拼错不会报错。更严谨的方案用枚举或类型安全的事件包装，但作为理解事件思想的起点足够。

## 6. 什么时候用事件

不是所有通信都要用事件。判断标准：

- **一对一、关系稳定**（玩家调用自己的武器）：直接引用即可，简单直观。
- **一对多、发布者不该知道订阅者**（玩家死亡通知各方）：用事件。
- **订阅者可能频繁增减**：用事件。

事件是解耦工具，不是万能药。滥用事件会让逻辑跳跃、难调试。保持"直接引用优先，确实需要解耦再用事件"。

## 7. 下一步

事件解决了"运行时怎么通知"，下一步解决"数据怎么保存下来"——存档和配置：[数据持久化：PlayerPrefs / JSON / ScriptableObject](./chapter-03-data-persistence.md)。
