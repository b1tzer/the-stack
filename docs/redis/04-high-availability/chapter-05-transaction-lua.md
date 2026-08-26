# 事务与 Lua

> Redis 的事务与 Lua 脚本都能把多条命令组合起来执行，但机制不同：事务强调「入队后一起执行」，Lua 强调「服务端原子脚本」。本章对比两者，讲清各自适用场景。

## 1. MULTI / EXEC

Redis 事务通过 `MULTI`、`EXEC`、`DISCARD` 实现：

```bash
MULTI              # 开启事务
SET a 1            # 入队
INCR a             # 入队
GET a              # 入队
EXEC               # 一次性执行所有命令
```

### 1.1 执行流程

![事务 MULTI/EXEC 执行流程](/redis/04-high-availability-chapter-05-transaction-lua-1.svg)

事务执行期间，命令不会被其他客户端插队，保证**命令序列的原子执行**。

### 1.2 错误处理

Redis 事务的错误分为两类：

| 错误类型 | 触发时机 | 事务行为 |
| :-- | :-- | :-- |
| 语法错误 | 入队时（命令不存在、参数错误） | 整个事务不执行 |
| 运行时错误 | 执行时（类型不匹配） | 出错命令报错，其他命令继续执行 |

### 1.3 不回滚

Redis 事务**不支持回滚**：执行到一半出错，前面已执行的命令不会撤销。这是 Redis 与关系型数据库事务的本质区别——Redis 追求简单高性能，放弃回滚能力。

## 2. WATCH 乐观锁

`WATCH` 用于实现乐观锁：监视一个或多个 key，如果这些 key 在 `EXEC` 前被其他客户端修改，则事务放弃执行。

```bash
WATCH balance          # 监视余额
MULTI
DECRBY balance 100     # 扣款
EXEC                   # 若 balance 被改过，返回 nil（放弃）
```

![WATCH 乐观锁流程](/redis/04-high-availability-chapter-05-transaction-lua-2.svg)

适用场景：需要「读-判断-写」一致性的场景，如余额扣减、库存扣减。若并发冲突频繁，WATCH 会大量重试，性能差。

## 3. Lua 脚本

Lua 脚本在 Redis 服务端执行，整个过程原子，中间不会被其他命令打断。

```lua
-- 原子扣减库存
local stock = tonumber(redis.call('get', KEYS[1]))
if stock > 0 then
    redis.call('decr', KEYS[1])
    return 1
else
    return 0
end
```

```bash
EVAL "脚本内容" 1 stock:1001          # 执行脚本，1 个 key
SCRIPT LOAD "脚本内容"                 # 缓存脚本，返回 SHA1
EVALSHA "sha1值" 1 stock:1001        # 用 SHA1 调用，节省带宽
```

### 3.1 关键点

| 要点 | 说明 |
| :-- | :-- |
| 原子执行 | 脚本执行期间不被打断 |
| redis.call / pcall | 调用 Redis 命令，pcall 出错不中断脚本 |
| SCRIPT LOAD | 预编译脚本，EVALSHA 复用 |
| 随机命令限制 | 集群下脚本内随机命令（如 SPOP）受限 |

> Lua 脚本相比事务的优势：可以在脚本内做逻辑判断（if/else、循环），而事务只是简单地把命令入队后顺序执行。复杂的「读-判断-写」逻辑用 Lua 更合适。

## 4. 事务与 Lua 对比

| 维度 | 事务（MULTI/EXEC） | Lua 脚本 |
| :-- | :-- | :-- |
| 原子性 | 命令序列原子执行 | 脚本整体原子执行 |
| 逻辑判断 | 不支持（只能入队后顺序执行） | 支持（if/else/循环） |
| 回滚 | 不支持 | 不支持 |
| 条件执行 | 用 WATCH 乐观锁实现 | 脚本内直接判断 |
| 适用场景 | 简单批量命令 | 复杂读-判断-写逻辑 |

选型建议：只是把多条命令打包执行，用事务；需要根据数据做判断再决定后续操作，用 Lua。
