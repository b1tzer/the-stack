# 标准集合：按契约选择 List、Set、Map

> 用户列表需要频繁按下标读取，却用 `LinkedList`；按邮箱查用户时把整个 `List` 遍历一遍；把含可变字段的对象放进 `HashSet` 后，元素突然“找不到”。这些不是 API 记忆问题，而是没有先明确访问方式、相等性契约和并发边界。

本页面向已经理解类、接口和 `equals`/`hashCode` 的读者，目标是根据数据关系和操作模式选择 `List`、`Set`、`Map`，并知道何时需要并发集合。

## 1. 先按数据关系选容器

| 数据关系 | 首选接口 | 常用实现 |
| :-- | :-- | :-- |
| 允许重复、主要按位置访问 | `List` | `ArrayList` |
| 元素不能重复 | `Set` | `HashSet`、`TreeSet`、`LinkedHashSet` |
| 每个键对应一个值 | `Map` | `HashMap`、`TreeMap`、`LinkedHashMap` |
| 需要先进先出并可能阻塞 | 队列接口 | `Deque`、`BlockingQueue` 家族 |
| 高并发共享修改 | 并发容器 | `ConcurrentHashMap`、并发队列、`CopyOnWriteArrayList` |

先选择接口表达的契约，再选择实现表达的复杂度、顺序和并发能力。不要因为某个类“看起来快”就让它承担不匹配的语义。

## 2. List：顺序与位置访问

### 2.1 ArrayList 与 LinkedList 的实际差异

| 操作 | `ArrayList` | `LinkedList` |
| :-- | :-- | :-- |
| 按下标读取 | 平均 O(1) | O(n) |
| 末尾追加 | 均摊 O(1) | O(1) |
| 中间插入/删除 | 移动元素，O(n) | 找到节点 O(n)，修改链接 O(1) |
| 额外内存 | 连续引用数组的预留空间 | 每个元素保存前后引用 |
| 随机访问 | 适合 | 不适合 |

`LinkedList` 的插入优势只在已经持有正确位置的迭代器或节点时成立。先遍历找到中间位置，再调用 `add(index, value)`，总成本仍然是 O(n)。多数业务列表选择 `ArrayList`；只有实测且访问模式确实匹配时才改用链表。

```java
List<Order> orders = new ArrayList<>();
orders.add(firstOrder);
orders.add(secondOrder);

Order second = orders.get(1);
boolean removed = orders.remove(firstOrder);
```

`remove(Object)` 按 `equals` 查找，`remove(int)` 按下标删除。两者参数含义不同，代码中应避免让易混淆的索引变量与对象重载同时出现。

### 2.2 顺序不是默认保证

`ArrayList` 保持插入位置；`List.of()` 和多数不可变集合也保持元素顺序。普通 `HashSet` 不承诺遍历顺序，需要稳定插入顺序时用 `LinkedHashSet` 或 `LinkedHashMap`，需要按自然顺序时用 `TreeSet` 或 `TreeMap`。

不要依赖未声明的迭代顺序生成分页结果、持久化格式或业务输出。接口没有承诺的顺序，换 JDK、数据分布或实现后可能改变。

## 3. Set：相等性决定“是否重复”

Set 根据元素的相等性判断成员资格。把对象放进 `HashSet` 后，如果参与 `hashCode` 或 `equals` 的字段发生变化，对象可能仍占据原 hash 桶，却无法被再次找到。

```java
record UserKey(long tenantId, String email) {
    UserKey {
        Objects.requireNonNull(email);
        email = email.strip().toLowerCase(Locale.ROOT);
    }
}

Set<UserKey> activeUsers = new HashSet<>();
activeUsers.add(new UserKey(7, "Ada@Example.com"));
boolean exists = activeUsers.contains(new UserKey(7, "ada@example.com"));
```

规则是：

- `equals` 相等的对象必须有相同 `hashCode`。
- 反过来不要求：hash 相同的对象可以不相等。
- 用作 Set 元素或 Map key 的对象，在使用期间不要修改参与相等性的字段。
- 可变业务实体通常应先映射为不可变 key，而不是直接放进 Set/Map。

契约的详细推导见[对象与值语义](./chapter-03-object-values.md)。

## 4. Map：按键访问而不是遍历配对

### 4.1 HashMap、TreeMap 与 LinkedHashMap

| 实现 | 查找/插入平均复杂度 | 顺序 | 适用 |
| :-- | :-- | :-- | :-- |
| `HashMap` | O(1) | 无顺序承诺 | 通用按键查找 |
| `TreeMap` | O(log n) | key 的自然或自定义顺序 | 范围查询、按序遍历 |
| `LinkedHashMap` | O(1) | 插入或访问顺序 | 需要稳定展示顺序、LRU 结构 |

`HashMap` 的 O(1) 是平均情况；hash 冲突、质量差的 key 或特定实现策略可能让局部操作变慢。不要依赖对象默认身份 hash 来表达业务相等。

### 4.2 区分缺值与非法状态

```java
Map<String, Customer> customersById = loadCustomers();

Customer customer = customersById.get(customerId);
if (customer == null) {
    throw new NoSuchElementException("customer not found: " + customerId);
}
```

`null` 同时表示“没有这个键”和可能的错误状态，容易把故障变成静默缺值。返回集合时，可以使用 [Optional](./chapter-10-stream-optional.md)表达“可能不存在”，但先确认调用方确实需要区分缺值与异常。

不同 Map 对 `null` key/value 的支持并不一致。`HashMap` 允许一个 `null` key 和多个 `null` value；并发 Map 的具体策略应查看对应实现契约，不要把 `null` 当作跨实现通用值。

## 5. 迭代、修改与并发

### 5.1 fail-fast 不是同步机制

普通集合在迭代期间检测到结构性修改时，通常抛出 `ConcurrentModificationException`。这是尽最大努力的错误检测，不是线程安全保证：

```java
List<String> ids = new ArrayList<>(sourceIds);
for (String id : ids) {
    if (id.startsWith("old-")) {
        ids.remove(id); // 可能立即失败，也可能延迟到下一次检查
    }
}
```

需要在遍历时删除当前元素，应使用迭代器的 `remove()`；需要保留原列表时，用 stream 或显式构建结果集合。

### 5.2 多线程共享要先问修改模式

| 并发场景 | 方向 |
| :-- | :-- |
| 高并发读、偶尔写配置 | `CopyOnWriteArrayList` |
| 键值高并发读写 | `ConcurrentHashMap` |
| 多生产者/消费者或异步任务 | `BlockingQueue` 家族 |
| 需要复合操作 | `computeIfAbsent`、`merge` 等原子方法 |
| 普通集合被多个线程修改 | 同步边界或并发容器，不能靠外部约定 |

同步包装器只保证单个方法调用的原子性。检查后再执行的复合操作仍可能产生竞态：

```java
// 不是原子操作
if (!cache.containsKey(key)) {
    cache.put(key, load(key));
}
```

并发容器、线程池和生产诊断分别见[并发集合](../03-java-concurrency/chapter-10-concurrent-collections.md)、[线程池](../03-java-concurrency/chapter-11-thread-pool.md)和[并发问题诊断](../06-diagnostics/02-concurrency/chapter-01-concurrency-diagnostics.md)。

## 6. 选择检查清单

1. 数据是否要求唯一、有序或按键访问？
2. 最频繁的操作是按下标、按键、范围还是顺序遍历？
3. key 的 `equals`/`hashCode` 是否稳定且表达业务身份？
4. 是否允许可变元素进入 Set/Map？
5. 集合是否跨线程共享，修改是单次调用还是复合操作？
6. 遍历顺序是否被外部协议或用户界面依赖？

## 7. 下一步

集合给出数据组织方式，[异常与资源管理](./chapter-08-exceptions.md)处理加载和更新失败，[Stream 与 Optional](./chapter-10-stream-optional.md)把过滤、映射和归约组合成数据处理流程。

> **官方参考：** [Java SE 21 `java.util` 规约](https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/package-summary.html)、[`Map`](https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/Map.html)。
