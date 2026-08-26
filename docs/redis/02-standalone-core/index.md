# 单机内核

> 回答「为什么快、数据如何落盘」。从线程模型与 IO 多路复用，到命令执行链路，再到持久化与内存管理，理解 Redis 单机运行的核心机制。

## 章节

- [线程模型](chapter-01-thread-model) — 单线程、IO 多路复用、Reactor、6.0 多线程
- [命令执行与 RESP](chapter-02-command-resp) — RESP 协议、命令解析、命令表查找、执行钩子
- [RDB 持久化](chapter-03-rdb) — 快照原理、fork 与 COW、配置与优缺点
- [AOF 与混合持久化](chapter-04-aof) — AOF 原理、重写、混合持久化、选型
- [过期删除](chapter-05-expiration) — 过期键存储、惰性删除、定期删除
- [内存淘汰](chapter-06-eviction) — maxmemory、8 种策略、LRU/LFU、内存碎片
