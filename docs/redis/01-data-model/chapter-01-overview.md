# Redis 概览与定位

> Redis 是一个基于内存的数据结构服务器。理解它的定位，是正确使用它的前提——先看清它是什么、擅长什么、不该用来做什么，再进入细节。

## 1. 什么是 Redis

Redis（Remote Dictionary Server）是一个开源的键值对存储系统，数据保存在内存中，读写速度远超基于磁盘的数据库。它的本质是一个**数据结构服务器**：value 不只是普通字符串，而可以是 String、Hash、List、Set、ZSet 等多种数据结构，并针对每种结构提供原子操作命令。

```text
key  →  value（value 可以是多种数据结构）

"user:123"        →  "{name:'张三', age:25}"     String
"user:123:info"   →  {name, age, email}          Hash
"news:list"       →  [文章3, 文章2, 文章1]         List
"user:123:tags"   →  {Java, 后端, 分布式}          Set
"leaderboard"     →  {张三:100, 李四:200}          ZSet
```

Redis 官方对它的定位是「内存数据结构服务器」，广泛用作缓存、消息队列、分布式锁、排行榜等。它常被放在 MySQL 这类持久化数据库之前，利用内存的高速访问缓解数据库压力。

## 2. 核心特性

| 特性 | 说明 |
| :-- | :-- |
| 快 | 纯内存操作，单机 QPS 轻松突破 10 万 |
| 数据结构丰富 | 5 种基础类型 + 4 种高级类型，覆盖绝大多数业务场景 |
| 原子操作 | 命令由单线程执行，单条命令天然原子，无并发竞争 |
| 持久化 | 提供 RDB 快照与 AOF 日志两种持久化方式 |
| 高可用 | 主从复制、哨兵、集群三种方案逐级演进 |
| 功能扩展 | 支持事务、Lua 脚本、发布订阅、Pipeline 等 |

## 3. 版本演进

![Redis 版本发展时间轴](/redis/01-data-model-chapter-01-overview.svg)

本书聚焦 **Redis 6.0 ~ 7.2**。6.0 起支持多线程网络 IO（命令执行仍单线程），7.0 引入 Functions 和 MP-AOF，7.2 彻底用 listpack 替代 ziplist。自 7.4 起 Redis 切换为 RSALv2 + SSPLv1 双协议，社区出现 Valkey 等开源分支。

## 4. 适用场景与反模式

**适合的场景**：

| 场景 | 说明 |
| :-- | :-- |
| 缓存 | 热点数据缓存，缓解数据库压力 |
| 排行榜 | ZSet 按 score 排序，天然适配 |
| 计数器 | INCR 原子自增，无并发问题 |
| 分布式锁 | SET NX PX 原子加锁 |
| 消息队列 | List 阻塞弹出、Stream 消费者组 |
| 会话存储 | 共享 Session，TTL 自动过期 |

**反模式**（不该把 Redis 当作）：

| 反模式 | 原因 |
| :-- | :-- |
| 主数据库 | 内存容量有限，数据量大时成本高 |
| 强一致存储 | 主从复制异步，可能丢少量数据 |
| 大文件存储 | 大 Key 阻塞命令执行、占用带宽 |
| 关系型查询 | 无 SQL、无复杂关联查询能力 |

## 5. 与 Memcached 对比

Memcached 是另一款常见的内存缓存，二者常被放在一起比较：

| 对比项 | Redis | Memcached |
| :-- | :-- | :-- |
| 数据类型 | 5 种基础 + 4 种高级 | 仅 String |
| 持久化 | 支持 RDB/AOF | 不支持 |
| 集群 | 原生支持主从/哨兵/集群 | 需客户端实现分片 |
| 线程模型 | 单线程 + IO 多路复用 | 多线程 |
| 功能 | 事务、Lua、订阅、Pipeline | 无 |

选择标准：需要丰富数据结构、持久化、高可用时选 Redis；仅做简单 KV 缓存、追求极致简洁时 Memcached 才进入考虑范围。

## 6. 快速上手：启动 Redis 与第一个命令

读十遍不如敲一遍。本节用 Docker 一键拉起 Redis，并完成从连接到关闭的完整流程。后续每章的「实操演示」都基于这个环境。

### 6.1 环境准备

```bash
# 拉取镜像并启动一个 Redis 7 容器（端口 6379）
docker run -d --name redis-demo -p 6379:6379 redis:7

# 进入容器内部的 redis-cli
docker exec -it redis-demo redis-cli
```

进入后，先确认服务活着：

```bash
127.0.0.1:6379> PING
PONG
```

`PONG` 就是 Redis 的「我在」。

### 6.2 第一个键值

```bash
127.0.0.1:6379> SET name redis
OK

127.0.0.1:6379> GET name
"redis"
```

`OK` 是命令执行成功的标志，`"redis"` 是取回的值。再看两个常用命令：

```bash
127.0.0.1:6379> EXISTS name        # 判断 key 是否存在
(integer) 1

127.0.0.1:6379> TTL name           # 查看剩余生存时间（秒）
(integer) -1                       # -1 = 永久有效，-2 = 已不存在

127.0.0.1:6379> EXPIRE name 60     # 设置 60 秒过期
(integer) 1

127.0.0.1:6379> TTL name
(integer) 60                       # 开始倒计时

127.0.0.1:6379> DEL name           # 删除 key
(integer) 1
```

### 6.3 关闭与清理

```bash
127.0.0.1:6379> QUIT              # 退出 redis-cli
```

```bash
docker stop redis-demo && docker rm redis-demo   # 停止并移除容器
```

> 掌握 `SET / GET / DEL / EXISTS / TTL / EXPIRE` 这六个命令，你已经能完成「缓存 + 过期」这一 Redis 最核心的使用场景。其余数据类型只是 value 的形态不同，操作心智完全一致。

### 6.4 本地无 Docker 怎么办

没有 Docker 也可以用官方源安装 Redis，或用 Docker 之外的容器运行时。核心是拿到一个可交互的 `redis-cli`，本文所有命令都在 `redis-cli` 中执行。
