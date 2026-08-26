# 缓存工程

> 回答「如何用好缓存」。从三大缓存问题（穿透、击穿、雪崩）到缓存一致性，再到大 Key 与热 Key 治理，理解缓存作为业务集成层的正确用法。

## 章节

- [缓存穿透](chapter-01-penetration) — 布隆过滤器、缓存空值
- [缓存击穿](chapter-02-breakdown) — 互斥锁、逻辑过期
- [缓存雪崩](chapter-03-avalanche) — TTL 随机化、多级缓存、熔断降级
- [缓存一致性](chapter-04-consistency) — Cache Aside、延迟双删、Canal
- [大 Key 与热 Key](chapter-05-big-hot-key) — 定义、危害、发现、处理
