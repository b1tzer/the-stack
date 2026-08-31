# Redis 错误码速查

## 常见错误

| 错误 | 含义 | 原因 | 解决方案 |
|------|------|------|----------|
| `OOM command not allowed` | 内存超限 | 达到 maxmemory 且淘汰策略为 noeviction | 增大 maxmemory 或更换淘汰策略 |
| `LOADING Redis is loading` | 正在加载数据 | RDB/AOF 恢复中 | 等待加载完成 |
| `READONLY You can't write` | 只读副本 | 写请求发到了从节点 | 写操作发主节点 |
| `NOAUTH Authentication required` | 未认证 | 需要密码 | `AUTH password` |
| `ERR invalid password` | 密码错误 | 密码不匹配 | 检查 requirepass 配置 |
| `CROSSSLOT Keys in request` | 集群跨槽 | 多 key 操作不在同一槽 | 使用 `{hashtag}` 确保同槽 |
| `MOVED slot ip:port` | 集群重定向 | 客户端缓存过期 | 更新集群拓扑 |
| `ASK slot ip:port` | 槽迁移中 | 正在 resharding | 发送 ASKING 后重试 |
| `ERR max number of clients` | 连接数超限 | 达到 maxclients | 增大 maxclients 或排查连接泄漏 |
| `BUSYKEY Target key name` | key 已存在 | RENAME 目标 key 已存在 | 先 DEL 或使用 RENAMENX |

## 客户端常见问题

| 现象 | 可能原因 | 排查方向 |
|------|----------|----------|
| 连接超时 | 网络/防火墙/bind 配置 | 检查 telnet、bind、protected-mode |
| 连接被拒 | maxclients 超限 | `INFO clients` 查看连接数 |
| 响应变慢 | 大 key / 阻塞命令 | `SLOWLOG GET` 查看慢日志 |
| 内存持续增长 | 未设过期 / 内存泄漏 | `MEMORY DOCTOR` 诊断 |
