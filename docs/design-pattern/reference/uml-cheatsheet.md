# UML 类图速查

## 类的表示

```text
┌─────────────────┐
│     ClassName    │
├─────────────────┤
│ - privateField  │
│ # protectedField│
│ + publicField   │
├─────────────────┤
│ - privateMethod()│
│ # protectedMethod()│
│ + publicMethod() │
└─────────────────┘
```

## 关系符号

| 关系 | 符号 | 说明 | 示例 |
|------|------|------|------|
| 继承 | ──▷ | 子类 extends 父类 | Dog ──▷ Animal |
| 实现 | ─ ─▷ | 类 implements 接口 | Dog ─ ─▷ Pet |
| 关联 | ──→ | 持有引用 | Order ──→ Customer |
| 聚合 | ◇──→ | 整体-部分，可独立存在 | Team ◇──→ Player |
| 组合 | ◆──→ | 整体-部分，不可独立存在 | House ◆──→ Room |
| 依赖 | ─ ─→ | 临时使用 | Service ─ ─→ Repository |

## 关系强度

```text
依赖 < 关联 < 聚合 < 组合 < 继承/实现
（弱）                                    （强）
```

## 常用画法

```text
// 策略模式
┌──────────┐      ┌──────────┐
│ Context  │──────│ Strategy │◁─────┐
│          │      │ +execute()│      │
└──────────┘      └──────────┘  ┌───┴────┐
                                │ ImplA  │
                                │ ImplB  │
                                └────────┘

// 观察者模式
┌──────────┐      ┌──────────┐
│ Subject  │◇─────│ Observer │
│ +attach()│      │ +update()│
│ +notify()│      └──────────┘
└──────────┘            △
                   ┌────┴────┐
                   │Concrete │
                   │Observer │
                   └─────────┘
```
