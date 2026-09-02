# RabbitMQ 参数速查

## Broker 配置（rabbitmq.conf）

| 参数 | 默认值 | 推荐值 | 说明 |
|------|--------|--------|------|
| `listeners.tcp.default` | 5672 | 5672 | AMQP 监听端口 |
| `management.listener.port` | 15672 | 15672 | 管理界面端口 |
| `vm_memory_high_watermark` | 0.6 | 0.6~0.7 | 内存高水位，触发流控 |
| `disk_free_limit.absolute` | 50M | 1G~2G | 磁盘低水位 |
| `channel_max` | 2047 | 2047 | 每连接最大 Channel 数 |
| `heartbeat` | 60 | 30~60 | 心跳间隔（秒） |
| `collect_statistics` | none | coarse | 统计收集粒度 |
| `tcp_listen_options.backlog` | 128 | 1024 | TCP 连接队列 |
| `tcp_listen_options.nodelay` | true | true | Nagle 算法关闭 |

## 队列参数

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `x-max-length` | 不限 | 队列最大消息数 |
| `x-max-length-bytes` | 不限 | 队列最大字节数 |
| `x-message-ttl` | 不限 | 消息过期时间（毫秒） |
| `x-expires` | 不限 | 队列空闲过期时间 |
| `x-dead-letter-exchange` | 无 | 死信交换机 |
| `x-dead-letter-routing-key` | 原 routing key | 死信 routing key |
| `x-max-priority` | 0 | 最大优先级（0=不启用） |
| `x-queue-type` | classic | 队列类型：classic/quorum/stream |
| `x-delivery-limit` | 不限 | Quorum 队列投递次数上限 |

## Quorum 队列参数

| 参数 | 默认值 | 推荐值 | 说明 |
|------|--------|--------|------|
| `x-quorum-initial-group-size` | 不限 | 3~5 | 初始组成员数 |
| `x-delivery-limit` | 20 | 5~20 | 最大重投次数 |
| `x-max-in-memory-length` | 0 | 1000 | 内存中最大消息数 |
| `x-max-in-memory-bytes` | 0 | 100MB | 内存中最大字节数 |

## 流控相关

| 参数 | 说明 |
|------|------|
| `vm_memory_high_watermark` | 内存高水位，超过后阻塞生产者 |
| `vm_memory_high_watermark_paging_ratio` | 开始换页的内存比例 |
| `disk_free_limit` | 磁盘低水位，低于后阻塞生产者 |
| `flow_control` | 流控自动触发 |

## Erlang VM 参数（advanced.config）

| 参数 | 默认值 | 推荐值 | 说明 |
|------|--------|--------|------|
| `+P` | 1048576 | 2097152 | 最大进程数 |
| `+Q` | 262144 | 524288 | 最大端口数 |
| `+zdbbl` | 32768 | 65536 | 分布式缓冲区大小 |
