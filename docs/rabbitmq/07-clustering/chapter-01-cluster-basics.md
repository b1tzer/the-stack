# 集群基础

> RabbitMQ 集群提供高可用和水平扩展能力。真正理解集群，要抓住一个根本区分：元数据是共享的，队列数据不是。这一章围绕这个区分展开。

## 1. 元数据共享，数据不共享

集群里所有节点共享的是元数据，也就是 exchange、queue、binding 的定义。你在任意节点声明一个 exchange，其他节点立刻知道它存在。

队列里的消息数据不是共享的。一个 Classic Queue 的消息由承载它的那个节点管理，其他节点不会自动保存消息副本。客户端可以连接任意节点访问这个队列；如果连的节点不是队列所在节点，相关操作需要集群内部协调和转发。

```txt
Node 1             Node 2             Node 3
└─ Queue A 数据     └─ 无 Queue A 数据  └─ 无 Queue A 数据
（exchange/queue/binding 的元数据各节点都有）
```

所以 Classic 集群提供的是「统一入口」，不是「数据多副本」。队列操作由承载它的节点处理，承载节点故障时，这个队列可能暂时无法访问。

## 2. 元数据存储

RabbitMQ 4.3 使用 Khepri 存储集群元数据，Mnesia 已在 4.3 移除。集群元数据的复制和故障恢复由 Khepri 负责。

旧版文档里的 disc / ram 节点类型是 Mnesia 时代的模型，4.x 已不再适用，不要再照搬旧版的 `join_cluster --ram` 和「至少保留两个 disc 节点」这类说法。

元数据可用性与队列消息数据的可用性是两回事。即使元数据能恢复，没有副本的 Classic Queue 也不会因此多出消息副本。

## 3. 集群搭建

### 3.1 Docker Compose

```yaml
services:
  rabbitmq1:
    image: rabbitmq:4.3-management
    hostname: rabbitmq1
    environment:
      RABBITMQ_ERLANG_COOKIE: "SWQOKODSQALRPCLNMEQG"
    volumes:
      - rabbitmq1_data:/var/lib/rabbitmq

  rabbitmq2:
    image: rabbitmq:4.3-management
    hostname: rabbitmq2
    environment:
      RABBITMQ_ERLANG_COOKIE: "SWQOKODSQALRPCLNMEQG"
    volumes:
      - rabbitmq2_data:/var/lib/rabbitmq

  rabbitmq3:
    image: rabbitmq:4.3-management
    hostname: rabbitmq3
    environment:
      RABBITMQ_ERLANG_COOKIE: "SWQOKODSQALRPCLNMEQG"
    volumes:
      - rabbitmq3_data:/var/lib/rabbitmq

volumes:
  rabbitmq1_data:
  rabbitmq2_data:
  rabbitmq3_data:
```

这个 Compose 文件只是启动了三个独立的 RabbitMQ 节点。共享 Cookie 是节点间认证的前提，不会自动把三个节点组成集群。完整的部署说明见[安装部署](../01-basics/chapter-04-install-config.md)，这里只讲把节点连成集群的关键步骤。

### 3.2 加入集群

```bash
# 在 rabbitmq2 上执行，加入 rabbitmq1
rabbitmqctl join_cluster rabbit@rabbitmq1

# 在 rabbitmq3 上执行，加入同一个集群
rabbitmqctl join_cluster rabbit@rabbitmq2

# 在任意节点验证
rabbitmqctl cluster_status
```

RabbitMQ 4.1 起 `join_cluster` 会自动完成加入前的准备工作，不再需要先 `stop_app`、`reset`、再 `start_app`。旧教程里那三步是 3.x 的流程，4.x 直接 join 即可。

`join_cluster` 是破坏性操作。一个节点不能在保留自身数据的同时加入另一个集群，加入时会清掉节点原有数据。所以只对全新或可清空的节点执行，不能对一个已有数据的生产节点直接 join。

## 4. Erlang Cookie

集群节点通过 Erlang Cookie 认证。所有节点 cookie 必须一致。在常见 Linux 容器部署中，cookie 位于 `/var/lib/rabbitmq/.erlang.cookie`，权限 400。

排查连接失败时要分清两类错误。`unable to connect to epmd` 指向节点发现或网络问题，先查主机名解析、4369 端口连通性和节点是否在运行。`authentication failed` 才指向 Erlang 分布认证失败，此时优先核对 cookie 是否一致。不要把所有连接失败都归因到 cookie 上。

## 5. 集群端口

| 端口 | 用途 |
| :-- | :-- |
| 5672 | AMQP 协议 |
| 15672 | Management UI |
| 4369 | EPMD 节点发现 |
| 25672 | 节点间 Erlang 分布通信 |

这些是默认端口，实际值受配置影响，启用 TLS 或改监听配置后会不同。

4369 是 EPMD 做节点发现用，25672 承担节点间通信。防火墙漏开这两个端口，节点可能直接无法加入集群，也可能在运行期出现节点间通信故障，而不是「能加入但只是状态同步异常」。排查时分别检查端口连通性、节点名解析和认证配置。

## 6. 数据分布 Classic vs Quorum

Classic Queue 的数据在单节点，Quorum Queue 通过 Raft 复制到多个节点。

| 维度 | Classic Queue | Quorum Queue |
| :-- | :-- | :-- |
| 数据副本 | 单份 | 多份（Raft） |
| 读 | 从所属节点 | 从 Leader |
| 所属节点故障 | 队列暂时不可用 | 多数成员可用时选举新 Leader，恢复服务 |

旧版 Classic 通过镜像队列提供复制和故障转移能力，镜像队列自 3.9 弃用、4.0 已移除，见[镜像队列](./chapter-02-mirrored-queue.md)。

选型不能简单说「需要数据不丢就用 Quorum」。Quorum Queue 的数据安全是有条件的：已收到 Publisher Confirm 的消息，在多数副本安全时不会丢；尚未确认的在途消息不享有同等保证。Classic 队列所在节点故障时，队列只是暂时不可用，节点恢复且数据完好就能继续服务；只有数据永久丢失才无法恢复。

性能上，Classic 少了多副本复制和共识的开销，但实际吞吐受消息大小、持久化、确认方式和消费模式影响，不能说它一定「极致吞吐」。需要数据跨节点复制和节点故障容忍时优先 Quorum，能接受单节点故障导致队列短暂不可用、且经过压测确认的，再用 Classic 单节点。

## 7. 一次节点故障演练

假设三节点集群正常运行，Queue A 是包含三个成员的 Quorum Queue，Queue B 是位于 Node 1 的 Classic Queue。现在 Node 1 突然宕机，Node 2 和 Node 3 仍正常运行。

元数据层面，Khepri 需要多数节点才能提交元数据变更。Node 1 故障后，剩余两个节点仍构成多数派，元数据变更可以继续提交；如果剩余节点不足多数，元数据变更会无法提交。所以不能凭 exchange 和 binding 的定义还在，就断定所有发布操作不受影响。

Queue A（Quorum），Node 2 和 Node 3 上的成员仍构成多数派，可以选出新 Leader。选举期间队列操作会短暂中断，新 Leader 就绪后恢复服务。已经收到 Publisher Confirm 的消息在多数副本安全条件下不会丢，尚未确认的在途消息不在此保证内。

Queue B（Classic），数据只在 Node 1，节点宕机后这个队列不可用，消费者连不上，消息取不到。Node 1 恢复且本地数据完好时，队列随节点恢复；如果 Node 1 的数据永久丢失，集群其他节点无法恢复这些消息。

这个场景说明，元数据共享不能替代队列内容复制。需要承受节点故障时，按队列复制方式、消息确认策略和故障恢复目标来选型，而不是一律优先 Quorum。

## 8. 节点故障处理

```bash
# 计划下线：在要下线的节点上执行，停止 RabbitMQ 应用
rabbitmqctl stop_app

# 移除故障节点：在仍可用的集群节点上执行
rabbitmqctl forget_cluster_node rabbit@failed_node
```

这两条命令用于不同场景，不是必须连续执行的步骤。`stop_app` 在要下线的节点上执行，只停应用不停 Erlang 运行时。`forget_cluster_node` 要在仍可用的集群节点上执行，把故障节点从成员关系里移除。

`forget_cluster_node` 只在确认节点不会回来时执行。它修改的是成员关系，不等于删除该节点上的数据。被移除的节点如果之后重新上线，不会自动回到集群，需要根据节点本地状态决定重新加入还是先重置，不能想当然地认为它会变回集群成员。

移除节点也不等于恢复它的队列消息。故障节点上的 Classic Queue 若唯一副本已永久丢失，其他节点无法靠成员关系操作找回这些消息。
