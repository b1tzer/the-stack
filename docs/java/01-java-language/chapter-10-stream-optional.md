# Stream 与 Optional：组合数据处理和缺值

> 方法里连续出现过滤、去重、映射、排序和收集；另一个方法用 `null` 表示查不到配置，又把 `null` 传给下一环。Stream 适合把过滤、转换、排序和汇总等操作组合成一条流水线；Optional 用来明确表示一个结果可能不存在。它们不能代替所有循环，也不会自动处理事务、资源释放或操作失败。

本页面向已经理解 Lambda、集合和 `equals`/`hashCode` 的读者，目标是写出惰性、非干扰、可结束的 Stream，并在真正需要区分缺值时正确使用 Optional。

## 1. Stream 是一次可消费的流水线

Stream 包含三个部分：

```text
数据源 → 中间操作 → 终端操作
List    filter/map   collect/find/forEach
```

- 数据源可以是集合、数组、文件行或生成器。
- `filter`、`map`、`sorted` 等中间操作返回新的 Stream，不立即遍历数据。
- `collect`、`reduce`、`findFirst`、`forEach` 等终端操作触发计算并产生结果。

有些 Stream 会持有外部资源。例如 `Files.lines(path)` 返回的 Stream 需要关闭，通常应使用 try-with-resources。终端操作结束并不等于所有 Stream 关联的资源都会自动关闭，来自文件、目录遍历等资源型 API 的 Stream，应查看相应 API 的关闭要求。

一条 Stream 只能消费一次。终端操作结束后，它已经完成任务，不能再次执行：

```java
Stream<String> names = activeUsers.stream();
List<String> selected = names.filter(name -> name.length() > 3).toList();
// names 已经被消费，不能再调用终端操作
```

需要再次处理时从数据源重新创建 Stream。Stream 不是可重复遍历的容器。

上面的 `toList()` 返回不可修改的 List，后续增删元素会抛 `UnsupportedOperationException`。这与 `Collectors.toList()` 不同，后者不保证返回列表的可修改性。需要可修改结果时，用 `collect(Collectors.toCollection(ArrayList::new))` 明确指定。

## 2. 用流水线表达数据处理

下面的流程读取订单、过滤有效订单，并按客户分组计算金额：

```java
Map<Long, BigDecimal> totalByCustomer = orders.stream()
        .filter(Order::isActive)
        .filter(order -> order.customerId() != null)
        .collect(Collectors.groupingBy(
                Order::customerId,
                Collectors.mapping(
                        Order::amount,
                        Collectors.reducing(BigDecimal.ZERO, BigDecimal::add)
                )
        ));
```

每一项操作都有明确作用：

| 操作 | 类型 | 作用 |
| :-- | :-- | :-- |
| `filter` | 无状态中间操作 | 保留满足谓词的元素 |
| `map` | 无状态中间操作 | 把每个元素转换成另一个值 |
| `distinct` | 有状态中间操作 | 根据 `equals`/`hashCode` 去重 |
| `sorted` | 有状态中间操作 | 缓冲数据后排序 |
| `limit` | 有状态短路操作 | 达到数量后停止 |
| `collect` | 终端操作 | 汇总到 List、Map、拼接字符串或自定义容器 |

有状态操作需要保存跨元素信息，因此 `sorted` 和 `distinct` 通常必须在拿到元素后才能给出结果。不要把它们误认为已经立即执行；执行发生在终端操作。

## 3. 惰性与短路

Stream 先建立操作描述，再由终端操作驱动。短路操作可能不需要处理全部元素：

```java
Instant now = Instant.now();

boolean anyExpired = orders.stream()
        .anyMatch(order -> order.expiresAt().isBefore(now));
```

找到满足条件的元素后，后续元素无需继续处理。如果只关心是否存在满足条件的元素，用 `anyMatch()` 比先过滤再取元素更直接。示例先固定当前时间，避免同一批订单在遍历过程中使用不同的时间基准。

`limit(n)` 最多保留前 n 个元素，允许流水线在结果足够时提前结束。对于有限的顺序 Stream，这通常能减少后续元素处理；在有序并行 Stream 中，为保证结果顺序，`limit()` 可能需要额外协调，不能简单认为它总能按数量精确减少源端工作量。

惰性不是“永远更快”。`sorted` 通常需要缓冲参与排序的元素；`count()` 在源的大小已知、且中间操作不改变元素数量时，可能直接利用已知大小，不执行部分中间操作。加入 `filter` 这类会改变元素数量的操作后，通常需要遍历元素才能得到结果。因此，不要依赖中间操作中的副作用来保证某段代码一定执行。

## 4. 什么时候值得使用并行 Stream

并行 Stream 把源拆分、并行计算，再合并结果。是否值得使用，主要看几个条件：

- 数据量和单个元素的计算成本足以覆盖拆分、调度与合并开销。
- 数据源能有效拆分，数组和常见集合通常比顺序读取的数据源更容易拆分。
- 是否必须保留 encounter order。`findFirst()`、`forEachOrdered()` 能保留顺序语义，但可能增加协调成本。
- 行为参数是否无状态、非干扰；访问共享可变状态时，是否有正确的同步或归约方案。
- `reduce()` 等归约是否满足结合律，并正确提供恒等值，使结果不依赖分组和合并方式。

```java
// 顺序执行；不要默认并行
long activeCount = orders.stream()
        .filter(Order::isActive)
        .count();

// 只有实测有效时才显式并行
long parallelCount = orders.parallelStream()
        .filter(Order::isActive)
        .count();
```

Stream 中的副作用、对外部可变状态的读写，以及不满足排序契约的比较器，都会增加并行处理的复杂度。对于有遇到顺序的 Stream，`sorted()` 会保留相等元素之间原有的相对顺序；对于无序 Stream，则不保证这种稳定性。并行 Stream 还可能使用公共 ForkJoinPool，阻塞 I/O 会占住池中的 worker；需要隔离阻塞任务时，应显式管理执行资源。相关边界见[线程池](../03-java-concurrency/chapter-11-thread-pool.md)和[异步编程](../03-java-concurrency/chapter-12-async-model.md)。

## 5. Optional 表达可能不存在的结果

### 5.1 把 Optional 留在真正有缺值语义的位置

```java
Optional<Customer> customer = customerRepository.findById(customerId);

Customer resolved = customer.orElseThrow(
        () -> new NoSuchElementException("customer not found: " + customerId)
);
```

Optional 用来表达返回结果可能不存在，不负责表示操作是否成功。一个返回 `Optional<Customer>` 的方法，仍然可能因为数据库连接失败而抛出异常。查不到可选配置时可以返回 `Optional.empty()`；违反业务必需条件时应抛出领域异常。不要把所有 `null` 或所有异常都机械替换成 Optional。

### 5.2 区分立即值与延迟值

```java
String normal = optionalConfig.orElse(DEFAULT_TIMEOUT_TEXT);

String lazy = optionalConfig.orElseGet(() -> loadDefaultFromDatabase());
```

`orElse(value)` 的参数在调用前就会计算；`orElseGet(supplier)` 只在 Optional 为空时调用。默认值需要 I/O、解析或创建大对象时，应使用延迟提供者，避免有值时仍执行昂贵操作。

| 方法 | 返回类型 | 典型用途 |
| :-- | :-- | :-- |
| `isPresent()` / `isEmpty()` | `boolean` | 需要明确分支时 |
| `orElse(value)` | 元素类型 | 默认值已经存在且廉价 |
| `orElseGet(supplier)` | 元素类型 | 空值时才计算默认值 |
| `orElseThrow(factory)` | 元素类型 | 缺值违反契约，必须失败 |
| `map` / `filter` | `Optional` | 转换或继续筛选可能存在的值 |

如果没有先确认值存在，直接调用 `get()` 会让缺值以运行时异常的形式暴露。需要默认值时用 `orElse()` 或 `orElseGet()`；缺值违反业务契约时用 `orElseThrow()`。方法参数、字段和序列化边界是否接受 Optional，应由 API 设计决定；局部返回值是它最自然的用途。

### 5.3 Optional 不负责异常组合

Stream 和 Optional 都不会自动捕获 lambda 中的异常。`map`、`filter` 或终端操作抛出的运行时异常会继续传播。需要把外部 I/O 失败转换成缺值时，应在明确的方法边界处理，并决定失败是应记录、返回空，还是继续抛出：

```java
Optional<Customer> customer = customerId == null
        ? Optional.empty()
        : Optional.of(loadCustomer(customerId));
```

这里只有"没有 customerId"是缺值；加载失败仍应进入[异常处理](./chapter-08-exceptions.md)边界，而不是静默变成 `Optional.empty()`。同时注意，`Optional.of()` 不接受 `null`，如果 `loadCustomer()` 返回 null 会抛 `NullPointerException`。只有"查不到"确实是该方法允许的正常结果时，才应考虑让它直接返回 `Optional`，或在明确边界把合法缺值转成 `Optional.empty()`，不要把 `ofNullable()` 当成掩盖契约错误的通用手段。

## 6. 常见错误

| 错误 | 问题 | 修改方向 |
| :-- | :-- | :-- |
| 对已消费 Stream 再次终端调用 | 运行时状态错误 | 从源重新创建 |
| 在 lambda 中修改外部集合 | 并行结果不确定 | 使用 `collect` 或线程安全归约 |
| 把所有空值都变成 Optional | 异常语义被隐藏 | 区分缺值、失败和契约错误 |
| `orElseGet` 写成昂贵的 `orElse` | 有值时仍执行昂贵操作 | 使用 supplier |
| 仅因数据多就 `parallelStream()` | 拆分开销或共享争用 | 测量顺序与并行结果 |
| Stream 链过长且包含副作用 | 难读、难测、难并行 | 提取命名方法，保留纯转换 |

## 7. 下一步

需要回顾集合的选择和相等性规则时，阅读[标准集合](./chapter-09-collections.md)；需要处理失败和资源生命周期时，阅读[异常与资源管理](./chapter-08-exceptions.md)；需要简化数据载体和封闭类型分支时，阅读[现代语言特性](./chapter-11-modern-language-features.md)；生产吞吐和线程归属问题进入[并发性能优化](../06-diagnostics/02-concurrency/chapter-02-concurrency-optimization.md)。

> **官方参考：** [Java SE 21 `java.util.stream` 规约](https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/stream/package-summary.html)、[`Optional`](https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/Optional.html)。
