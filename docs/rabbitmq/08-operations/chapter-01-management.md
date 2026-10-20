# 管理与监控

> 监控的目标是在用户发现故障之前发现故障。会敲 `rabbitmqctl` 不等于会运维，真正的能力是看到指标就能判断「这是正常波动还是出问题了」。这一章讲怎么搭起这套判断力，而不是堆命令。

## 1. 三个必盯指标

内存、磁盘和队列堆积是 RabbitMQ 监控里需要优先盯的三类指标。盯住它们，比盯一屏花花绿绿的仪表盘有用得多。

**内存水位**。`vm_memory_high_watermark` 设置内存告警的触发阈值，超过后节点触发内存告警并阻塞发布消息的连接。默认 0.6（相对值，即检测到可用内存的 60%）。告警阈值不能照抄一个数，要看这个值相对水位的余量。内存使用持续逼近水位，可能来自队列堆积，也可能是连接、通道、队列进程或运行时内存增长，要用 `rabbitmq-diagnostics memory_breakdown` 定位具体来源，而不是直接归因于消费不过来。

**磁盘水位**。`disk_free_limit` 默认 50MB，这是给开发环境的，生产必须调大。磁盘告警的意义在于提前量，从「低于阈值」到「磁盘写满」之间要留出足够时间让运维介入。剩余空间告警线要按磁盘消耗速率留足处置时间，而不是剩 100MB 才报警；磁盘消耗不只来自新消息，还有持久化写入、消息分页和其他进程的占用。

**队列堆积**。`messages_ready` 持续上涨是堆积，但「多少算多」没有绝对标准。一条消费速率 1 万 msg/s 的队列积 10000 条只是约 1 秒的工作量，一条 1 msg/s 的队列积 10000 条相当于近 3 小时的工作量。这个估算以消费速率稳定为前提，不能直接用来判断消费者停了多久。阈值必须跟着队列的吞吐走，写死一个 10000 对所有队列一刀切，要么天天误报，要么真出事了不响。

## 2. 指标怎么拿

两个入口，分工不同。

Management UI（15672 端口）适合人肉排查，看单个队列、单个连接的实时状态。Prometheus 适合长期监控和告警，`rabbitmq_prometheus` 插件默认在 15692 端口暴露 `/metrics` 端点，接进 Grafana 或告警系统后可以基于历史基线判断趋势。默认 `/metrics` 只返回节点级聚合指标，队列级指标（如单个队列的消息数、消费者数）要通过 `/metrics/per-object` 采集，逐对象采集在队列数量大时开销明显。

```bash
rabbitmq-plugins enable rabbitmq_management rabbitmq_prometheus
```

单点排查看 Management UI，趋势和告警看 Prometheus。别用 Management UI 当告警源，它只保留近期指标，不适合长期监控存储。

## 3. 关键指标

| 指标 | 含义 | 告警思路 |
| :-- | :-- | :-- |
| `rabbitmq_queue_messages_ready` | 待消费消息数 | 相对队列吞吐定阈值，持续增长或积压超过业务可接受范围时告警 |
| `rabbitmq_queue_messages_unacked` | 已投递未确认 | 持续上涨时检查消费者处理耗时、预取配置与确认行为 |
| `rabbitmq_queue_consumers` | 队列消费者数 | 预期应有消费者的队列，消费者数为 0 时告警 |
| `rabbitmq_connections` | 连接数 | 结合增长速率、业务基线与文件描述符限制排查异常增长 |
| `rabbitmq_process_resident_memory_bytes` | 节点内存占用 | 逼近内存水位线 `rabbitmq_resident_memory_limit_bytes` 时告警 |
| `rabbitmq_disk_space_available_bytes` | 磁盘剩余 | 逼近磁盘水位线 `rabbitmq_disk_space_available_limit_bytes` 时告警 |

这张表里的「告警思路」才是重点。指标名记不住可以查，但每个指标对应什么故障形态要清楚。

## 4. 命令按用途分组

命令不是拿来背的，是按「此刻要回答什么问题」来查的。

看集群是否健康：

```bash
rabbitmqctl cluster_status
rabbitmqctl status
```

看队列状态，判断堆积和消费者：

```bash
rabbitmqctl list_queues name messages_ready messages_unacknowledged consumers
```

看连接和通道，排查连接泄漏：

```bash
rabbitmqctl list_connections name peer_host state
rabbitmqctl list_channels connection_name consumer_count
```

每一条命令都在回答一个具体问题。不知道自己要问什么，敲再多命令也看不出结论。

## 5. 日志

日志位置取决于安装方式。Linux 系统包安装通常在 `/var/log/rabbitmq/` 下，命名带节点名；容器部署可能输出到标准输出，也可以通过配置修改位置。排查前可用 `rabbitmq-diagnostics -q log_location` 确认当前节点的日志位置。默认 info 级别够用，排查时才临时调到 debug，查完调回原级别，长期 debug 会淹没真正有用的信息。

```bash
rabbitmqctl set_log_level debug
# 排查完恢复原级别，如下例恢复为 info
rabbitmqctl set_log_level info
```

日志最有价值的场景是节点启动失败和集群分裂，这两类问题的根因在日志里通常有明确线索。

## 6. 常用运维操作

```bash
rabbitmqctl stop_app          # 停止 RabbitMQ 应用，Erlang 节点仍在运行
rabbitmqctl reset             # 重置节点为初始状态，删除持久化消息与管理数据，执行前需停止应用
rabbitmqctl forget_cluster_node rabbit@failed  # 从当前节点移除已离线的节点，先确认其已永久下线
rabbitmqctl purge_queue queue_name  # 清空指定队列消息，执行前确认业务允许丢弃
```

`reset` 会把节点重置为初始状态，删除持久化消息与管理数据，执行前必须停止应用并确认该节点数据可以丢弃；重新加入集群不是执行它的充分条件。这几条命令用途和风险各不相同，不是一套可依次执行的通用恢复流程，执行前先确认故障类型与影响范围。这些操作对应的故障排查路径见[常见问题排查](chapter-03-troubleshooting.md)。
