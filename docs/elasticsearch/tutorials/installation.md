# 安装部署与配置

## 1. 安装方式

### 1.1 Docker

```bash
docker run -d --name es \
  -e "discovery.type=single-node" \
  -e "xpack.security.enabled=false" \
  -p 9200:9200 -p 9300:9300 \
  elasticsearch:8.12.0
```

### 1.2 apt/yum

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
discovery.seed_hosts: ["node-1", "node-2", "node-3"]
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

建议：堆内存不超过物理内存的 50%，不超过 32GB。

## 4. 生产环境关键配置

```yaml
# elasticsearch.yml 生产环境配置示例
cluster.name: prod-cluster
node.name: node-1
network.host: 0.0.0.0
http.port: 9200

# 节点角色（ES 8.x 推荐分离角色）
node.roles: ["master", "data"]

# 集群发现
discovery.seed_hosts: ["10.0.0.1", "10.0.0.2", "10.0.0.3"]
cluster.initial_master_nodes: ["node-1", "node-2", "node-3"]

# 数据路径（建议多盘做 RAID 0 或配置多个路径）
path.data: /data/elasticsearch
path.logs: /var/log/elasticsearch

# 内存锁定（避免 swap）
bootstrap.memory_lock: true

# 安全配置（ES 8.x 默认开启）
xpack.security.enabled: true
xpack.security.transport.ssl.enabled: true

# 跨域配置（如需 Kibana 访问）
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

# 禁用 swap
swapoff -a
```

## 6. Docker Compose 部署（多节点）

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

## 7. 最佳实践

- **堆内存设置**：`-Xms` 和 `-Xmx` 设为相同值，不超过物理内存的 50%，不超过 32GB
- **启用 memory_lock**：防止 JVM 堆被 swap 到磁盘，严重影响性能
- **多路径数据目录**：配置多个 `path.data` 路径，分散 IO 压力
- **生产环境至少 3 个节点**：满足 Master 选举的最低要求（需过半节点存活）
- **专用 Master 节点**：大型集群中，将 Master 和 Data 角色分离
