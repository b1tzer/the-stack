# Redis 配置参数参考

本页以 Redis 7.4.11 默认配置为基准。“调优方向”不是通用推荐值；实际配置必须结合数据用途、RPO、主机资源和压测结果。修改前使用 `CONFIG GET <参数>` 确认当前实例值，并记录变更原因。

## 内存管理

| 参数 | 默认值 | 调优方向 | 说明 |
| :-- | :-- | :-- | :-- |
| `maxmemory` | 0（不限制） | 根据主机、容器、fork 和增长速度计算 | 最大内存限制 |
| `maxmemory-policy` | noeviction | 缓存可选 LRU/LFU；主数据通常保持 noeviction | 淘汰策略 |
| `maxmemory-samples` | 5 | 压测后提高采样精度 | LRU/TTL 采样精度 |
| `lazyfree-lazy-eviction` | no | yes | 异步淘汰，避免阻塞 |
| `lazyfree-lazy-expire` | no | yes | 异步过期删除 |

## 淘汰策略说明

| 策略 | 范围 | 算法 | 适用场景 |
| :-- | :-- | :-- | :-- |
| `noeviction` | - | 不淘汰，写入报错 | 不能主动丢弃数据的实例 |
| `allkeys-lru` | 所有 key | LRU | 通用缓存 |
| `allkeys-lfu` | 所有 key | LFU | 热点数据明显 |
| `volatile-lru` | 有 TTL 的 key | LRU | 缓存+持久混合 |
| `volatile-lfu` | 有 TTL 的 key | LFU | 缓存+持久混合 |
| `volatile-ttl` | 有 TTL 的 key | TTL 最短优先 | 过期数据优先淘汰 |
| `volatile-random` | 有 TTL 的 key | 随机 | 无明确热点 |
| `allkeys-random` | 所有 key | 随机 | 无明确热点 |

## 持久化

| 参数 | 默认值 | 调优方向 | 说明 |
| :-- | :-- | :-- | :-- |
| `save` | 3600 1 300 100 60 10000 | 按 RPO、fork 成本和恢复时间调整 | RDB 触发条件 |
| `appendonly` | no | 需要命令级恢复点时开启 | 开启 AOF |
| `appendfsync` | everysec | 通常为 everysec，并结合 RPO 压测 | AOF 刷盘策略 |
| `auto-aof-rewrite-percentage` | 100 | 100 | AOF 重写触发比例 |
| `auto-aof-rewrite-min-size` | 64mb | 根据文件增长和恢复时间调整 | AOF 重写最小大小 |

## 连接与超时

| 参数 | 默认值 | 调优方向 | 说明 |
| :-- | :-- | :-- | :-- |
| `bind` | 127.0.0.1 | 私网地址或回环地址 | 绑定地址 |
| `port` | 6379 | 6379 | 监听端口 |
| `timeout` | 0（不超时） | 根据客户端连接模式决定 | 主动断开空闲客户端的秒数 |
| `tcp-keepalive` | 300 | 结合网络和中间设备超时验证 | TCP 心跳间隔（秒） |
| `maxclients` | 10000 | 根据连接池上限和文件描述符预算调整 | 最大客户端连接数 |

## 性能

| 参数 | 默认值 | 调优方向 | 说明 |
| :-- | :-- | :-- | :-- |
| `hz` | 10 | 默认保持 10，有明确需求时再压测调整 | 后台任务频率 |
| `io-threads` | 1 | 压测决定，通常不超过 CPU 核数 | IO 线程数（6.0+） |
| `io-threads-do-reads` | no | 默认保持 no，除非压测证明有收益 | 读操作也使用 IO 线程（6.0+） |
| `lazyfree-lazy-server-del` | no | 大 Key 删除场景压测后开启 | 让服务端 DEL 走异步回收 |
