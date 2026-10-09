# Redis 知识库

本知识库把 Redis 内容分为四条路径。先根据当前目标选择入口，需要查证细节时再进入参考手册。

## 从零完成第一个应用

适合第一次使用 Redis 的读者。先在本机启动实例，再用基础类型完成计数、缓存、集合运算和排行榜等任务。

- [在本机安装 Redis](./10-practice/chapter-01-installation.md)
- [常见任务上手](./10-practice/chapter-02-first-app.md)
- [首次生产部署](./10-practice/chapter-03-first-production.md)

## 理解 Redis 如何工作

适合需要解释性能、内存和故障现象的读者。先建立数据模型，再理解单机执行、持久化、复制和集群机制。

- [Redis 概览与定位](./01-data-model/chapter-01-overview.md)
- [五种基础数据类型](./01-data-model/chapter-02-basic-types.md)
- [线程模型](./02-standalone-core/chapter-01-thread-model.md)
- [持久化 RDB 与 AOF](./02-standalone-core/chapter-05-persistence.md)
- [高可用方案选型](./04-high-availability/chapter-00-overview.md)
- [主从复制](./04-high-availability/chapter-01-replication.md)

## 完成生产运维

适合负责 Redis 上线、监控和故障处理的读者。按性能基线、排障流程和高可用方案逐步建立运维能力。

- [性能优化](./05-operations/chapter-01-performance.md)
- [阻塞与故障排查](./05-operations/chapter-02-troubleshooting.md)
- [监控告警](./05-operations/chapter-03-monitoring.md)
- [大 Key 与热 Key](./05-operations/chapter-05-big-hot-key.md)
- [上线检查清单](./05-operations/chapter-04-pitfalls.md)

## 进入场景实战

缓存、锁、限流和延迟任务属于应用模式，内容放在场景实战目录。Redis 原理页面负责解释机制，场景页面负责说明如何组合机制解决业务问题。

- [缓存失效与一致性](../scenarios/01-cache/index.md)
- [分布式锁与限流](../scenarios/02-concurrency/index.md)
- [延迟任务与消息模式](../scenarios/03-messaging/index.md)

## 按问题快速查证

- [配置参数参考](./reference/parameters.md)
- [常用命令速查](./reference/commands.md)
- [常见错误与连接问题](./reference/errors.md)

## 版本范围

核心配置和示例以 Redis 7.4.11 为验证基准，核对日期为 2026-10-09。页面涉及历史机制时会标注 6.0、7.0 或 7.2 的引入时间；使用 Redis 8.x 时，应先核对[官方命令](https://redis.io/docs/latest/commands/)、配置默认值和许可证说明。
