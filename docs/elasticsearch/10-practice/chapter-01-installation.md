# 安装部署与配置

## 1. 安装方式

### 1.1 Docker

> 本地实验示例：以下命令显式关闭安全功能（`xpack.security.enabled=false`）并将端口映射到宿主机，仅适用于受控的本地开发环境。请勿将服务端口直接暴露到不可信网络；生产部署应保持安全功能开启（见第 4 节）。

```bash
docker run -d --name es \
  -e "discovery.type=single-node" \
  -e "xpack.security.enabled=false" \
  -p 9200:9200 -p 9300:9300 \
  elasticsearch:8.12.0
```

### 1.2 apt/yum

> 以下命令依赖已配置的 Elastic 官方软件源，未配置源时会安装失败或装到非预期版本。

```bash
# Debian/Ubuntu
apt install elasticsearch

# RHEL/CentOS
yum install elasticsearch
```

## 2. 核心配置 (elasticsearch.yml)

```yaml
cluster.name: my-cluster
node.name: node-1
network.host: 0.0.0.0
http.port: 9200

# 集群发现
# discovery.seed_hosts：用于发现集群中的节点，属于常规配置
discovery.seed_hosts: ["node-1", "node-2", "node-3"]
# cluster.initial_master_nodes：仅用于新集群首次引导，集群形成后应移除
cluster.initial_master_nodes: ["node-1", "node-2", "node-3"]

# 路径
path.data: /var/lib/elasticsearch
path.logs: /var/log/elasticsearch

# 内存
bootstrap.memory_lock: true
```

## 3. JVM 配置 (jvm.options)

```ini
-Xms4g
-Xmx4g
```

建议：`-Xms` 与 `-Xmx` 设为相同值，避免运行时扩容；堆内存通常不超过物理内存的 50%。在常见 HotSpot 环境中，32GB 可作为评估压缩对象指针（Compressed Oops）的经验参考，实际边界取决于 JVM 配置与对象对齐等因素，并非所有环境的绝对上限。生产部署应先结合节点角色与实际内存评估，再决定是否手动覆盖堆大小。

## 4. 生产环境关键配置

```yaml
# elasticsearch.yml 生产环境配置示例
cluster.name: prod-cluster
node.name: node-1
network.host: 0.0.0.0
http.port: 9200

# 节点角色（本例为混合角色；大型集群可按需将 Master 与 Data 分离到专用节点）
node.roles: ["master", "data"]

# 集群发现
# discovery.seed_hosts：用于发现集群中的节点，属于常规配置
discovery.seed_hosts: ["10.0.0.1", "10.0.0.2", "10.0.0.3"]
# cluster.initial_master_nodes：仅在创建新集群时配置，集群形成后应移除，已有集群的常规配置中不应保留
cluster.initial_master_nodes: ["node-1", "node-2", "node-3"]

# 数据路径（ES 8.x 仅支持单一数据路径；容量与 IO 依赖底层存储布局规划）
path.data: /data/elasticsearch
path.logs: /var/log/elasticsearch

# 内存锁定（避免 swap）
bootstrap.memory_lock: true

# 安全配置：启用安全功能与 Transport TLS；生产环境还需完成证书、信任关系及认证配置，不能仅复制以下开关
xpack.security.enabled: true
xpack.security.transport.ssl.enabled: true

# 跨域配置：仅当浏览器需直接跨源访问 ES 时才开启；Kibana 由服务端访问，通常无需 CORS。通配符 * 仅限受控测试环境
http.cors.enabled: true
http.cors.allow-origin: "*"
```

## 5. 系统配置调优

```bash
# /etc/sysctl.conf - 虚拟内存
vm.max_map_count=262144
vm.swappiness=1

# /etc/security/limits.conf - 文件描述符
elasticsearch soft nofile 65535
elasticsearch hard nofile 65535
elasticsearch soft nproc 4096
elasticsearch hard nproc 4096

# 禁用 swap（swapoff -a 非持久化，重启失效；持久化需注释 /etc/fstab 中 swap 行）
swapoff -a
```

> 说明：`limits.conf` 中的限制不一定被 systemd 启动的服务继承；使用 systemd 管理时，还需在 service 单元中通过 `LimitNOFILE`、`LimitNPROC` 等指令显式设置，否则进程实际生效的限制可能仍是默认值。

## 6. Docker Compose 部署（多节点）

> 教学示例：以下 Compose 演示多节点发现与编排，未配置安全认证与 Transport TLS，不能直接作为生产部署模板。生产环境需另配认证、TLS 与访问策略（见第 4 节）。

```yaml
version: '3'
services:
  es01:
    image: elasticsearch:8.12.0
    environment:
      - node.name=es01
      - cluster.name=prod-cluster
      - discovery.seed_hosts=es01,es02,es03
      - cluster.initial_master_nodes=es01,es02,es03
      - "ES_JAVA_OPTS=-Xms2g -Xmx2g"
    volumes:
      - es-data01:/usr/share/elasticsearch/data
    ports:
      - 9200:9200
    ulimits:
      memlock:
        soft: -1
        hard: -1

  es02:
    image: elasticsearch:8.12.0
    environment:
      - node.name=es02
      - cluster.name=prod-cluster
      - discovery.seed_hosts=es01,es02,es03
      - cluster.initial_master_nodes=es01,es02,es03
      - "ES_JAVA_OPTS=-Xms2g -Xmx2g"
    volumes:
      - es-data02:/usr/share/elasticsearch/data

  es03:
    image: elasticsearch:8.12.0
    environment:
      - node.name=es03
      - cluster.name=prod-cluster
      - discovery.seed_hosts=es01,es02,es03
      - cluster.initial_master_nodes=es01,es02,es03
      - "ES_JAVA_OPTS=-Xms2g -Xmx2g"
    volumes:
      - es-data03:/usr/share/elasticsearch/data

volumes:
  es-data01:
  es-data02:
  es-data03:
```

首次引导完成后，应从各节点的 `cluster.initial_master_nodes` 配置中移除该参数，再重启或更新容器；后续扩容与全集群重启均不应重新设置该参数，以免错误地重新引导出一个不同集群。

## 7. 最佳实践

- **堆内存设置**：`-Xms` 和 `-Xmx` 设为相同值，通常不超过物理内存的 50%，避免运行时扩容
- **启用 memory_lock**：防止 JVM 堆被 swap 到磁盘，严重影响性能
- **单一数据路径**：ES 8.x 仅支持单个 `path.data`，容量与 IO 依赖底层存储布局规划，不通过配置多个数据目录分散压力
- **Master 高可用**：生产集群通常部署三个具备 Master 资格的节点，使一个节点失效后仍保有多数票；这是容错建议，而非所有集群的最低运行条件
- **角色分离按需进行**：大型集群可将 Master 与 Data 分离到专用节点，规模较小时混合角色节点同样可行
