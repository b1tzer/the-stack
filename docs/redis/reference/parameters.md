# Redis 参数速查

## 内存管理

| 参数 | 默认值 | 推荐值 | 说明 |
|------|--------|--------|------|
| `maxmemory` | 0（不限制） | 物理内存的 70%~80% | 最大内存限制 |
| `maxmemory-policy` | noeviction | allkeys-lru | 淘汰策略 |
| `maxmemory-samples` | 5 | 10 | LRU/TTL 采样精度 |
| `lazyfree-lazy-eviction` | no | yes | 异步淘汰，避免阻塞 |
| `lazyfree-lazy-expire` | no | yes | 异步过期删除 |

## 淘汰策略说明

| 策略 | 范围 | 算法 | 适用场景 |
|------|------|------|----------|
| `noeviction` | - | 不淘汰，写入报错 | 不允许丢数据 |
| `allkeys-lru` | 所有 key | LRU | 通用缓存 |
| `allkeys-lfu` | 所有 key | LFU | 热点数据明显 |
| `volatile-lru` | 有 TTL 的 key | LRU | 缓存+持久混合 |
| `volatile-lfu` | 有 TTL 的 key | LFU | 缓存+持久混合 |
| `volatile-ttl` | 有 TTL 的 key | TTL 最短优先 | 过期数据优先淘汰 |
| `volatile-random` | 有 TTL 的 key | 随机 | 无明确热点 |
| `allkeys-random` | 所有 key | 随机 | 无明确热点 |

## 持久化

| 参数 | 默认值 | 推荐值 | 说明 |
|------|--------|--------|------|
| `save` | 3600 1 300 100 60 10000 | 按业务调整 | RDB 触发条件 |
| `appendonly` | no | yes | 开启 AOF |
| `appendfsync` | everysec | everysec | AOF 刷盘策略 |
| `auto-aof-rewrite-percentage` | 100 | 100 | AOF 重写触发比例 |
| `auto-aof-rewrite-min-size` | 64mb | 256mb | AOF 重写最小大小 |

## 连接与超时

| 参数 | 默认值 | 推荐值 | 说明 |
|------|--------|--------|------|
| `bind` | 127.0.0.1 | 按需配置 | 绑定地址 |
| `port` | 6379 | 6379 | 监听端口 |
| `timeout` | 0（不超时） | 300 | 客户端空闲超时（秒） |
| `tcp-keepalive` | 300 | 60 | TCP 心跳间隔（秒） |
| `maxclients` | 10000 | 10000 | 最大客户端连接数 |

## 性能

| 参数 | 默认值 | 推荐值 | 说明 |
|------|--------|--------|------|
| `hz` | 10 | 10 | 后台任务频率 |
| `io-threads` | 1 | 4~8 | IO 线程数（6.0+） |
| `io-threads-do-reads` | no | yes | 读操作也用多线程（6.0+） |
| `lazyfree-lazy-server-del` | no | yes | 异步删除（DEL 转 UNLINK） |
