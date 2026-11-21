---
type: explanation
level: basic
---

# 音频

游戏有了画面和交互，还差声音。读完这一篇，你能说清 Unity 音频的三个组件——AudioListener、AudioSource、AudioClip——并给游戏加上背景音乐和音效。

## 1. 音频的三个组件

Unity 的音频由三个组件配合：

| 组件 | 作用 | 位置 |
| --- | --- | --- |
| **AudioListener** | "耳朵"，接收场景里的声音 | 默认挂在 Main Camera 上 |
| **AudioSource** | "喇叭"，播放一个音频 | 挂在你想要发声的物体上 |
| **AudioClip** | 音频文件本身（mp3、wav、ogg 等） | 作为资源导入 Project |

关系是：AudioSource 播放 AudioClip，AudioListener 听到它。场景里通常**只有一个 AudioListener**（在摄像机上），有多个会导致声音混乱。

## 2. 播放背景音乐

背景音乐是循环播放的声音，做法：

1. 把音频文件导入 Project（拖进 `Assets/` 即可）。
2. 选中摄像机（或建一个专门放音乐的物体），加 **Audio Source** 组件。
3. 把音频文件拖到 Audio Source 的 **AudioClip** 槽位。
4. 勾选 **Loop**（循环播放）和 **Play On Awake**（启动即播）。

运行后背景音乐自动循环播放。

## 3. 用脚本播放音效

音效（射击声、拾取声）通常由脚本在特定时机播放：

```csharp
public class SoundPlayer : MonoBehaviour
{
    public AudioClip pickupSound;   // Inspector 里拖入音效
    private AudioSource audioSource;

    void Start()
    {
        audioSource = GetComponent<AudioSource>();
    }

    void OnTriggerEnter(Collider other)
    {
        if (other.CompareTag("Player"))
        {
            audioSource.PlayOneShot(pickupSound);   // 播放一次音效
        }
    }
}
```

`Play()` 和 `PlayOneShot()` 的区别：

- `Play()`：播放 AudioSource 上设置的 Clip，再次调用会**打断**当前播放。适合"按一下就从头播"的背景音。
- `PlayOneShot(clip)`：播放传入的 Clip，**不打断**其他声音，允许多个音效同时叠加。适合频繁触发的音效（连续射击、多个金币）。

音效推荐用 `PlayOneShot`，因为同一个 AudioSource 可以连续播放多个不互相打断的音效。

## 4. 控制音量与空间感

AudioSource 有几个常用属性：

- **Volume**：音量，0 到 1。
- **Spatial Blend**：空间混合，`0` 是 2D（音量不随距离变化，适合 UI 和背景音），`1` 是 3D（离得越远越小声，适合场景里的声音）。
- **Pitch**：音调，改变播放速度，可以做出音效变化。

3D 音效的衰减还依赖 **AudioListener** 的位置（即摄像机位置）——摄像机离声源越远，3D 音效越小声。

## 5. 动手验证

1. 导入一个音频文件（任意 mp3/wav）。
2. 给摄像机加 Audio Source，拖入音频，勾选 Loop 和 Play On Awake，运行——听到循环背景音。
3. 给金币物体加 Audio Source，写脚本在 `OnTriggerEnter` 里 `PlayOneShot`，运行——碰到金币听到一声音效，且不打断背景音。

**成功标志**：背景音乐持续循环，音效在拾取时触发，两者不互相打断。

如果没声音，检查：

| 现象 | 原因 |
| --- | --- |
| 完全没声音 | 没有 AudioListener（摄像机上被删了）；或 AudioSource 没挂 Clip |
| 只有背景音，音效不响 | 脚本里 `PlayOneShot` 的 Clip 没在 Inspector 拖入 |
| 声音太大/太小 | 调 AudioSource 的 Volume |

## 6. 下一步

玩法基础的五篇到此结束，你已经能做"能看、能玩、能听"的游戏原型。接下来进入工程实践，先解决"脚本多了怎么组织"的问题：[脚本架构与组件化设计](../05-engineering/chapter-01-script-architecture.md)。
